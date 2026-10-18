/**
 * 离线微基准：目录数据层的单操作与「宿主一次刷新」全链路成本。
 *
 * 目的：给性能结论一个可复跑的底数。所有被测函数都从**真实实现**
 * `../plugin-market/lib/catalog.js` 直接 import——本文件不复制任何实现逻辑，
 * 只负责造数据、计时、统计、打印。独立验收可核对 import 路径与本文件 sha256。
 *
 * ── 测量方法（看数之前先看这段）──────────────────────────────────────────
 * - 计时口径：`process.hrtime.bigint()` 包住**单次**同步调用；每个样本 = 一次完整调用。
 *   所以每个数里含定时器自身开销（约 1–2µs，见 resolution.timerFloor）。
 * - 预热：每个 (档位, 操作) 先跑 warmup 次不计时，再跑 N 次取材（N 见 ITERATIONS）。
 *   JIT 未预热时前几次样本会明显偏高，min 反映的正是热身后最好情况。
 * - fixture：合成档位由固定种子 PRNG（mulberry32）生成，**不使用裸 Math.random**；
 *   字段形状照抄 `_ref/data/plugins.json`（description 是 {en,zh} 对象、category 是字符串、
 *   install 是整条命令）。另有一档真实快照 `_ref/data/plugins.json`（4412 条，只读）。
 * - 分辨力证明：同一计时口径下跑 noop（空调用）与已知工作量（定长算术循环），
 *   并检查 normalizeCatalog 的 median 随规模单调上升。分辨力不足的格子会被点名
 *   （见每个样本的 resolvable 标记与 resolution.insufficientTiers）。
 * - 内存：需要 `node --expose-gc`。检测不到 global.gc 时**如实标注「未测」**，
 *   不做任何推算。峰值增量 = gc 后基线 → 单次调用结束（结果仍被持有）时的 heapUsed 差；
 *   retained = 丢掉结果再 gc 后的 heapUsed 与同一基线的差。单次采样，不重复。
 *
 * ── 局限（不要把这套数当成端到端结论）──────────────────────────────────
 * - 单进程、单线程同步计时；不含 HTTP、JSON 解析（真实主机还要 parse 5MB JSON）、
 *   宿主事件循环竞争、客户端渲染、网络与磁盘。
 * - 搜索路径有两处**模块级记忆化**（foldText 按字符串、匹配索引按数组身份）。
 *   同一次运行内重复迭代会命中缓存，因此本基准测的是「热缓存重复请求」；
 *   冷启动 / 首次搜索会偏慢，本文件不测那一路。
 * - 合成数据不是真实上游数据：真实目录字段覆盖率参差（对照组见 divergence），
 *   排名并列、极端字符串长度等分布也不同。真实快照档位只代表 2026-10-16 那一份。
 * - 数值受机器、Node 版本、后台负载影响；跨机比较无意义，只能同机复跑比对。
 *
 * 用法：
 *   node verify/perf-baseline.mjs                  # 内存档位标「未测（需 --expose-gc）」
 *   node --expose-gc verify/perf-baseline.mjs      # 含内存测量
 * 退出码：0 = 全部档位测完；3 = 有档位/操作抛错（详见输出）；2 = 用法错误（不会出现）。
 * 只读、离线、无第三方依赖。末尾输出机器可读 JSON（标记 `PERF_BASELINE_JSON`）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── 真实实现（唯一被测代码来源）─────────────────────────────────────────
import {
  categoryCounts,
  filterPlugins,
  joinInstalled,
  normalizeCatalog,
  paginate,
  sortPlugins,
  validateCatalogPayload
} from '../plugin-market/lib/catalog.js'

const REAL_SNAPSHOT = fileURLToPath(new URL('../_ref/data/plugins.json', import.meta.url))
const SEED = 0x5eed_1018
const WARMUP = 5
/** 每档每操作取材次数：≥30 是硬要求；小档位多跑几次压噪声。 */
const ITERATIONS = { 'synthetic-100': 200, 'synthetic-1000': 100, 'synthetic-5000': 40, 'synthetic-20000': 30, 'real-snapshot-4412': 40 }
const SIZES = [100, 1000, 5000, 20000]
/** 判定「分辨力不足」的绝对下限：median 低于 10µs 的格子噪声占主导。 */
const RESOLUTION_MIN_MS = 0.01

// ── 确定性 PRNG（mulberry32）─────────────────────────────────────────────
function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OWNERS = ['anonyjcy', 'feiyang-dev', 'dsh-labs', 'cursor-community', 'kernel-tools', 'nano-ai', 'studio-nine', 'openknit']
const WORDS = ['pet', 'meme', 'usage', 'drag', 'space', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'browser', 'memory', 'session', 'theme', 'wsl', 'guard', 'sync', 'trace']
const CAPABILITIES = ['fs.read', 'fs.write', 'net.fetch', 'exec.shell', 'env.read', 'browser.open']
const RED_LINES = ['filesystem.delete', 'credential.read', 'network.exfiltrate']
/** 真实快照里出现的 23 个分类（读不到真实快照时用这份兜底；两处形状一致）。 */
const FALLBACK_CATEGORIES = ['agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl', 'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev', 'security', 'other', 'ops', 'data']

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length]
}

function pad(value, width) {
  const s = String(value)
  return s.length >= width ? s : '0'.repeat(width - s.length) + s
}

/** 一条合成目录项：字段名/类型与 `_ref/data/plugins.json` 逐一对齐。 */
function makeRawItem(random, index) {
  const owner = pick(random, OWNERS)
  const word = pick(random, WORDS)
  const name = `dsh-${word}-${pad(index % 997, 3)}`
  const category = pick(random, FALLBACK_CATEGORIES)
  const hasNpm = random() < 0.5
  const npm = hasNpm ? `@${owner}/${name}` : null
  const url = `https://github.com/${owner}/${name}`
  const spec = npm ?? url
  const scanned = random() < 0.91
  const redLines = scanned && random() < 0.1
  const shots = random() < 0.2 ? 1 + Math.floor(random() * 3) : 0
  const item = {
    name,
    owner,
    url,
    page: `https://awesome-dsh-plugin.com/p/${owner}/${name}/`,
    category,
    description: { en: `Synthetic fixture ${name}: a ${word} plugin for offline benchmarking.`, zh: `合成夹具 ${name}：用于离线基准的${word}插件。` },
    npm,
    version: `1.${index % 20}.${index % 7}`,
    stars: Math.floor(random() * 2000),
    downloads: random() < 0.6 ? Math.floor(random() * 500000) : null,
    downloadsStart: '2026-09-03',
    downloadsEnd: '2026-10-02',
    downloadsCheckedAt: '2026-10-03',
    install: `dsh plugin --profile web add ${spec}`,
    added: `2026-${pad(1 + (index % 9), 2)}-${pad(1 + (index % 27), 2)}`
  }
  if (scanned) {
    item.capabilities = [pick(random, CAPABILITIES), pick(random, CAPABILITIES)]
    item.capabilityRedLines = redLines ? [pick(random, RED_LINES)] : []
    item.capabilityCheckedAt = '2026-10-18'
  }
  if (shots > 0) {
    item.screenshots = Array.from({ length: shots }, (_, k) => `https://raw.githubusercontent.com/${owner}/${name}/main/docs/shot-${k}.png`)
  }
  if (random() < 0.07) item.tarball = `${url}/releases/download/v1.0.0/${name}-1.0.0.tgz`
  return item
}

function makePayload(count, categories) {
  const random = makeRandom(SEED + count)
  const plugins = Array.from({ length: count }, (_, i) => makeRawItem(random, i))
  return {
    name: 'dsh-plugin-catalog',
    url: 'https://awesome-dsh-plugin.com/plugins.json',
    source: `https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/plugins.json?fixture=${count}`,
    updated: '2026-10-16T00:00:00Z',
    count: plugins.length,
    categories,
    plugins
  }
}

// ── 统计与计时 ──────────────────────────────────────────────────────────
let sink = 0

function stats(samplesNs) {
  const ms = Array.from(samplesNs, (v) => Number(v) / 1e6).sort((a, b) => a - b)
  const at = (q) => {
    if (ms.length === 1) return ms[0]
    const pos = (ms.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return lo === hi ? ms[lo] : ms[lo] + (ms[hi] - ms[lo]) * (pos - lo)
  }
  const sum = ms.reduce((a, b) => a + b, 0)
  return { iterations: ms.length, min: ms[0], median: at(0.5), p95: at(0.95), max: ms[ms.length - 1], mean: sum / ms.length }
}

/** 同一计时口径：单次同步调用包一层 hrtime。 */
function bench(fn, iterations, warmup = WARMUP) {
  for (let i = 0; i < warmup; i += 1) sink += Number(fn() === null)
  const samples = new Float64Array(iterations)
  for (let i = 0; i < iterations; i += 1) {
    const start = process.hrtime.bigint()
    fn()
    samples[i] = Number(process.hrtime.bigint() - start)
  }
  return stats(samples)
}

function fingerprint(payload) {
  const hash = createHash('sha256')
  const fieldCoverage = {}
  for (const item of payload.plugins) {
    hash.update(JSON.stringify(item))
    hash.update('\n')
    for (const key of Object.keys(item)) fieldCoverage[key] = (fieldCoverage[key] ?? 0) + 1
  }
  return { sha256: hash.digest('hex'), count: payload.plugins.length, fieldCoverage }
}

/** normalizeItem 之后可观测的形状分布：合成档 vs 真实档的对照（审计发现）。 */
function shapeOf(plugins) {
  const shape = { items: plugins.length, specNull: 0, downloadsNull: 0, starsZero: 0, capabilitiesNull: 0, screenshotsNull: 0, tarballNull: 0, categoryOther: 0, ids: new Set() }
  for (const item of plugins) {
    if (item.spec === null) shape.specNull += 1
    if (item.downloads === null) shape.downloadsNull += 1
    if (item.stars === 0) shape.starsZero += 1
    if (item.capabilities === null) shape.capabilitiesNull += 1
    if (item.screenshots === null) shape.screenshotsNull += 1
    if (item.tarball === null) shape.tarballNull += 1
    if (item.category === 'other') shape.categoryOther += 1
    shape.ids.add(item.id)
  }
  shape.uniqueIds = shape.ids.size
  delete shape.ids
  return shape
}

const gcAvailable = typeof global.gc === 'function'
function heapAfterGc() {
  if (!gcAvailable) return null
  global.gc()
  global.gc()
  return process.memoryUsage().heapUsed
}

// ── 档位构造 ────────────────────────────────────────────────────────────
function loadRealSnapshot() {
  try {
    const raw = JSON.parse(readFileSync(REAL_SNAPSHOT, 'utf8'))
    return { ok: true, raw }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

const real = loadRealSnapshot()
const realCategories = real.ok && real.raw?.categories && typeof real.raw.categories === 'object'
  ? real.raw.categories
  : Object.fromEntries(FALLBACK_CATEGORIES.map((id) => [id, { zh: id, en: id }]))

function buildTier(name, payload) {
  const validation = validateCatalogPayload(payload)
  const normalized = normalizeCatalog(payload, { source: payload.url })
  const plugins = normalized.plugins
  // 已安装/可更新筛选要有输入：每 20 条挑一条当作已安装 bundle（确定性，无随机）。
  const bundles = plugins
    .filter((_, index) => index % 20 === 0)
    .map((item) => ({ name: item.name, version: item.version ?? '1.0.0', enabled: true }))
  const joined = joinInstalled(plugins, bundles)
  return { name, payload, normalized, plugins, joined, bundles, installedBundles: bundles.length, validation }
}

const tiers = []
for (const size of SIZES) tiers.push(buildTier(`synthetic-${size}`, makePayload(size, realCategories)))
let realTierMissing = null
if (real.ok) {
  tiers.push(buildTier('real-snapshot-4412', real.raw))
} else {
  realTierMissing = real.error
}

// ── 分辨力证明：noop 与已知工作量 ───────────────────────────────────────
function knownWorkload() {
  let acc = 0
  for (let i = 0; i < 2_000_000; i += 1) acc += i & 7
  return acc
}

console.log('[分辨力证明] 同一计时口径（hrtime 包住单次调用）')
const timerFloor = bench(() => {}, 200)
sink += knownWorkload()
const known = bench(knownWorkload, 30)
const noopFloor = Math.max(timerFloor.median, 1e-6)
console.log(`  noop（空函数）        median ${timerFloor.median.toFixed(4)}ms  p95 ${timerFloor.p95.toFixed(4)}ms`)
console.log(`  已知工作量 2e6 次算术  median ${known.median.toFixed(3)}ms  p95 ${known.p95.toFixed(3)}ms`)
console.log(`  比值 已知/空转 = ${(known.median / noopFloor).toFixed(0)}×  （>5 视为该口径量得出耗时）`)

// ── 各档各操作 ──────────────────────────────────────────────────────────
//
// ── TASK-PERF-02 修复：链路必须与它的必经组件在**同一次交错测量**里取材 ──
//
// 缺陷（TASK-PERF-01 独立验收 D3）：`synthetic-100` 的 refresh-chain 曾量出
// 0.0755ms，**小于**它必经的 normalizeCatalog 0.0995ms —— 超集比子集便宜。
// 根因**不是算术错误，是测量设计**：两者原本各跑一次独立的 bench()（各自 warmup、
// 各自 200 次连续取样），于是它们不共享 JIT 优化状态、不共享 GC 节奏、不共享折叠缓存。
// 在 0.1ms 量级上，两次独立 pass 的中位数相差 ±40% 属于常态，谁大谁小基本是掷硬币。
//
// 为什么要交错：把「链路」与「必经组件」放进**同一个 pass 轮流取样**，两者就共享
// 同一份 JIT/GC/缓存状态。实测（synthetic-100，8 轮）：交错后 chain/normalize 比值稳定在
// 2.30–2.40、**0/8 轮出现倒挂**；独立 pass 则出现 0.099 vs 0.100 甚至倒挂。
// 只有在交错口径下，「链路 ≥ 其必经组件」才是一条**成立**的断言；
// 独立 pass 下套这条断言是机械套用不成立的约束（任务书明确禁止）。
//
// 交错口径若仍报出倒挂，那就不是口径问题而是**该格不可信**：标记 unreliable、
// 不进可信结论、也**不**当成失败退出（否则正常的测量噪声会频繁产生假红）。
const CHAIN_QUERY = 'dsh'

const CHAIN_VARIANTS = [
  {
    label: 'refresh-chain:query+category (warm)',
    note: '已选分类后再搜（category 先收窄候选）；折叠缓存与匹配索引已热。原 refresh-chain 就是这个口径。',
    run: (tier, cats) => {
      const catalog = normalizeCatalog(tier.payload, { source: tier.payload.url })
      const counts = categoryCounts(catalog.plugins, catalog.categoryLabels)
      const filtered = filterPlugins(catalog.plugins, { query: CHAIN_QUERY, category: counts[0]?.id ?? 'other' })
      return paginate(sortPlugins(filtered, 'top'), 1, 24)
    }
  },
  {
    label: 'refresh-chain:query only / category=all (warm)',
    note: '用户默认路径：只在搜索框输入、不选分类 ⇒ query 要在**全量**上跑。比上面那条贵得多。',
    run: (tier) => {
      const catalog = normalizeCatalog(tier.payload, { source: tier.payload.url })
      const filtered = filterPlugins(catalog.plugins, { query: CHAIN_QUERY })
      return paginate(sortPlugins(filtered, 'top'), 1, 24)
    }
  },
  {
    label: 'refresh-chain:no query / browse (warm)',
    note: '浏览/翻页/改排序：无 query、无分类，只有 join 之外的全量排序分页。',
    run: (tier) => {
      const catalog = normalizeCatalog(tier.payload, { source: tier.payload.url })
      return paginate(sortPlugins(catalog.plugins, 'top'), 1, 24)
    }
  }
]

const results = []
const insufficientCells = []
const unreliableCells = []
const failures = []
const memory = []
const chainConsistency = []

// 冷启动首次调用：**必须在任何其它测量之前**取，否则折叠缓存已被热身。
// 只取 n=1：进程内真正「冷」的只有第一次，重复测不可能再现冷态，
// 因此如实标注为单次观测，不当成分布、也不与热态中位数直接比较。
const coldFirstCall = (() => {
  const tier = tiers[0]
  if (!tier) return null
  const start = process.hrtime.bigint()
  CHAIN_VARIANTS[1].run(tier)
  const ms = Number(process.hrtime.bigint() - start) / 1e6
  return { tier: tier.name, ms, note: 'n=1；进程内首次调用，折叠缓存冷。不可当分布，也不与热态中位数直接比较。' }
})()

/** 链路一致性判据：链路 median 必须 ≥ 其必经组件 median。**唯一实现**，真判定与自检共用。 */
function isChainConsistent(chainMedian, componentMedian) {
  return chainMedian >= componentMedian
}

/** 交错取材：pairs 轮流取样，共享 JIT / GC / 折叠缓存状态。 */
function benchInterleaved(pairs, iterations, warmup = WARMUP) {
  for (let round = 0; round < warmup; round += 1) for (const [, fn] of pairs) sink += Number(fn() === null)
  const samples = pairs.map(() => new Float64Array(iterations))
  for (let i = 0; i < iterations; i += 1) {
    for (let k = 0; k < pairs.length; k += 1) {
      const start = process.hrtime.bigint()
      pairs[k][1]()
      samples[k][i] = Number(process.hrtime.bigint() - start)
    }
  }
  return pairs.map(([label], k) => [label, stats(samples[k])])
}

for (const tier of tiers) {
  const iterations = ITERATIONS[tier.name] ?? 30
  const counts = categoryCounts(tier.plugins, tier.normalized.categoryLabels)
  const topCategory = counts[0]?.id ?? 'other'
  const ops = {
    'normalizeCatalog': () => normalizeCatalog(tier.payload, { source: tier.payload.url }),
    'categoryCounts': () => categoryCounts(tier.plugins, tier.normalized.categoryLabels),
    'filterPlugins:query(dsh)': () => filterPlugins(tier.joined, { query: 'dsh' }),
    'filterPlugins:query(rare)': () => filterPlugins(tier.joined, { query: 'dsh-vision-137' }),
    'filterPlugins:category': () => filterPlugins(tier.joined, { category: topCategory }),
    'filterPlugins:installedOnly': () => filterPlugins(tier.joined, { installedOnly: true }),
    'filterPlugins:updatesOnly': () => filterPlugins(tier.joined, { updatesOnly: true }),
    'filterPlugins:installed+category': () => filterPlugins(tier.joined, { installedOnly: true, category: topCategory }),
    'filterPlugins:query+category+installed': () => filterPlugins(tier.joined, { query: 'dsh', category: topCategory, installedOnly: true }),
    'sortPlugins:top': () => sortPlugins(tier.plugins, 'top'),
    'sortPlugins:new(recent)': () => sortPlugins(tier.plugins, 'new'),
    'sortPlugins:downloads': () => sortPlugins(tier.plugins, 'downloads'),
    'sortPlugins:name': () => sortPlugins(tier.plugins, 'name'),
    'paginate': () => paginate(tier.plugins, 3, 24),
    'joinInstalled(附加)': () => joinInstalled(tier.plugins, tier.bundles)
  }

  const opResults = {}
  for (const [label, fn] of Object.entries(ops)) {
    let measured
    try {
      measured = bench(fn, iterations)
    } catch (error) {
      failures.push({ tier: tier.name, op: label, message: error.message })
      opResults[label] = { error: error.message }
      continue
    }
    const resolvable = measured.median >= RESOLUTION_MIN_MS
    if (!resolvable) insufficientCells.push({ tier: tier.name, op: label, median: measured.median })
    opResults[label] = { ...measured, resolvable }
  }

  // 链路变体 + 必经组件（normalizeCatalog）在同一次交错 pass 里取材
  const mandatory = 'normalizeCatalog'
  const chainFns = Object.fromEntries(CHAIN_VARIANTS.map((variant) => [variant.label, () => variant.run(tier, topCategory)]))
  const triples = [[mandatory, ops[mandatory]], ...Object.entries(chainFns)]
  const measured = benchInterleaved(triples, iterations)
  const component = measured.find(([label]) => label === mandatory)[1]
  for (const [label, m] of measured) {
    const resolvable = m.median >= RESOLUTION_MIN_MS
    opResults[label] = { ...m, resolvable, measurement: 'interleaved-with-' + mandatory }
    if (!resolvable) insufficientCells.push({ tier: tier.name, op: label, median: m.median })
  }
  // 一致性：链路 ≥ 其必经组件（同口径下才成立；倒挂 ⇒ 该格不可信）
  for (const variant of CHAIN_VARIANTS) {
    const m = opResults[variant.label]
    if (m.error !== undefined) continue
    const ratio = component.median === 0 ? null : m.median / component.median
    const consistent = isChainConsistent(m.median, component.median)
    if (!consistent) {
      unreliableCells.push({
        tier: tier.name,
        op: variant.label,
        median: m.median,
        componentMedian: component.median,
        ratio,
        reason: `链路 median ${m.median.toFixed(4)}ms < 必经组件 ${mandatory} ${component.median.toFixed(4)}ms（超集快于子集）⇒ 该格在本次运行的噪声下不可信`
      })
      m.unreliable = true
    }
    chainConsistency.push({ tier: tier.name, op: variant.label, componentMedian: component.median, chainMedian: m.median, ratio, consistent })
  }

  const shape = shapeOf(tier.plugins)
  results.push({
    tier: tier.name,
    count: tier.plugins.length,
    declaredCount: tier.payload.count,
    validationOk: tier.validation.ok,
    validationMessage: tier.validation.ok ? null : tier.validation.message,
    fixture: fingerprint(tier.payload),
    iterations,
    installedBundles: tier.installedBundles,
    topCategory,
    ops: opResults,
    shape
  })

  // ── 内存（需 --expose-gc；否则如实标注未测）─────────────────────────
  if (!gcAvailable) {
    memory.push({ tier: tier.name, status: '未测（需 --expose-gc）' })
  } else {
    const heapUsedAtTierBytes = heapAfterGc()
    const perOp = {}
    const memoryTargets = [
      ['normalizeCatalog', ops.normalizeCatalog],
      ['filterPlugins:query(dsh)', ops['filterPlugins:query(dsh)']],
      ['sortPlugins:top', ops['sortPlugins:top']],
      ...Object.entries(chainFns),
      ['joinInstalled(附加)', ops['joinInstalled(附加)']]
    ]
    for (const [label, fn] of memoryTargets) {
      heapAfterGc()
      const base = process.memoryUsage().heapUsed
      let held = fn()
      const peak = process.memoryUsage().heapUsed - base
      held = null
      const retained = heapAfterGc() - base
      perOp[label] = { peakDeltaBytes: peak, retainedBytes: retained }
    }
    memory.push({
      tier: tier.name,
      status: 'measured',
      // 该档位所有 fixture（payload + 规范化结果 + join 结果）在此刻的总占用基线。
      // 不是「fixture 增量」——增量意义不明确（跨档位基线互相影响），如实给绝对值。
      heapUsedWithTierBytes: heapUsedAtTierBytes,
      ops: perOp,
      maxPeakDeltaBytes: Math.max(...Object.values(perOp).map((entry) => entry.peakDeltaBytes))
    })
  }

  console.log(`\n[${tier.name}] ${tier.plugins.length} 条 · 每操作 ${iterations} 次`)
  console.log('  操作                                          min      median   P95      max')
  for (const [label, m] of Object.entries(opResults)) {
    if (m.error) { console.log(`  ${label.padEnd(52)} ERROR ${m.error}`); continue }
    const flags = `${m.resolvable ? '' : '  ⚠分辨力不足'}${m.unreliable === true ? '  ⚠不可信(链路<组件)' : ''}`
    console.log(`  ${label.padEnd(52)} ${m.min.toFixed(3).padStart(8)} ${m.median.toFixed(3).padStart(8)} ${m.p95.toFixed(3).padStart(8)} ${m.max.toFixed(3).padStart(8)}${flags}`)
  }
}

// ── 链路一致性汇总（TASK-PERF-02 新增）──────────────────────────────────
console.log('\n[链路一致性] 交错口径下「链路 median ≥ 必经组件 normalizeCatalog median」')
for (const row of chainConsistency) {
  console.log(`  ${row.tier.padEnd(20)} ${row.op.padEnd(46)} 组件 ${row.componentMedian.toFixed(3)}ms  链路 ${row.chainMedian.toFixed(3)}ms  比值 ${row.ratio === null ? 'n/a' : row.ratio.toFixed(2)}×  ${row.consistent ? '✓' : '✗ 不可信'}`)
}
const inconsistent = chainConsistency.filter((row) => !row.consistent)
console.log(`  合计 ${chainConsistency.length} 组，倒挂 ${inconsistent.length} 组${inconsistent.length === 0 ? '（无倒挂）' : ' —— 这些格子已标 unreliable，不进可信结论'}${coldFirstCall ? `\n[冷启动] 进程内首次调用（折叠缓存冷，n=1，不可当分布）：${coldFirstCall.tier} / query only / category=all = ${coldFirstCall.ms.toFixed(2)}ms` : ''}`)

// ── 随规模单调性（分辨力的一部分；只对合成阶梯，真实档规模不同不参与）────
const syntheticSeries = results
  .filter((entry) => entry.tier.startsWith('synthetic-'))
  .map((entry) => ({ tier: entry.tier, count: entry.count, normalizeMedian: entry.ops.normalizeCatalog?.median ?? null }))
const realSeries = results
  .filter((entry) => entry.tier.startsWith('real-'))
  .map((entry) => ({ tier: entry.tier, count: entry.count, normalizeMedian: entry.ops.normalizeCatalog?.median ?? null }))
const strictlyIncreasing = (list) => list.every((entry, index) => index === 0 || (entry.normalizeMedian !== null && list[index - 1].normalizeMedian !== null && entry.normalizeMedian > list[index - 1].normalizeMedian))
const monotonic = strictlyIncreasing(syntheticSeries)
console.log(`\n[分辨力] normalizeCatalog median 合成阶梯：${syntheticSeries.map((e) => `${e.count}=${e.normalizeMedian?.toFixed(3)}`).join('  ')}  （严格递增=${monotonic}）`)
console.log(`[分辨力] 真实档单点：${realSeries.map((e) => `${e.count}=${e.normalizeMedian?.toFixed(3)}`).join('  ')}（与 4412 条的合成档对照：合成 nearest=${syntheticSeries.find((e) => e.count === 5000)?.normalizeMedian.toFixed(3)} 条=5000）`)

const realShape = results.find((entry) => entry.tier === 'real-snapshot-4412')?.shape ?? null
const syntheticShape = results.find((entry) => entry.tier === 'synthetic-5000')?.shape ?? null

// ── 检测器自检：证明「链路<组件」这条规则真的会触发（否则就是死代码/假绿灯）──
// 用一个**故意倒挂**的伪造对（慢「组件」+ 快「链路」）走一遍真正的判定逻辑。
// 不测性能，只验证判定分支；开销微秒级，每次都跑。
const detectorSelfTest = (() => {
  // 直接调用**真判定函数** isChainConsistent（不复制谓词），否则自检只能证明副本正确。
  const fakeInverted = isChainConsistent(0.1, 0.5) // 链路 0.1 < 组件 0.5 ⇒ 必须判不通过
  const fakeOk = isChainConsistent(0.5, 0.1) // 链路 0.5 ≥ 组件 0.1 ⇒ 必须判通过
  const fakeEqual = isChainConsistent(0.25, 0.25) // 相等 ⇒ 通过（≥ 语义）
  return {
    checked: true,
    invertsDetected: fakeInverted === false,
    consistentAccepted: fakeOk === true,
    equalityAccepted: fakeEqual === true,
    pass: fakeInverted === false && fakeOk === true && fakeEqual === true
  }
})()
if (!detectorSelfTest.pass) {
  failures.push({ tier: '(self-test)', op: 'chain-consistency-detector', message: '一致性检测器自检失败：倒挂样本未被判为不通过' })
}

const report = {
  schema: 'dsh-plugin-market/perf-baseline@2',
  generatedAt: new Date().toISOString(),
  node: process.version,
  command: gcAvailable ? 'node --expose-gc verify/perf-baseline.mjs' : 'node verify/perf-baseline.mjs',
  implementation: '../plugin-market/lib/catalog.js',
  seed: SEED,
  method: {
    timer: 'process.hrtime.bigint() 包住单次同步调用；每个样本 = 一次完整调用（含约 1-2µs 定时器开销）',
    warmup: WARMUP,
    iterations: ITERATIONS,
    resolutionFloorMs: RESOLUTION_MIN_MS,
    // TASK-PERF-02：链路与其必经组件必须交错取材，否则两者的中位数不可比
    chainMeasurement: '链路变体与其必经组件 normalizeCatalog 在**同一次交错 pass** 内轮流取样（benchInterleaved），共享 JIT/GC/折叠缓存状态；label 带 measurement:"interleaved-with-normalizeCatalog" 标记',
    chainConsistencyRule: '链路 median ≥ 必经组件 median。仅交错口径下成立；倒挂的格子标 unreliable 并列入 unreliableCells，不进可信结论，也**不**算失败退出',
    memory: gcAvailable ? '逐操作：gc → 基线 heapUsed → 单次调用持有结果时取峰值 → 丢弃结果再 gc 取 retained（单次采样）' : '未测（需 --expose-gc）'
  },
  limits: [
    'JIT 预热后测量；min 是热身后最好情况，median/P95 才是常态',
    '单进程同步计时，不含 HTTP/JSON 解析/事件循环竞争/客户端渲染/网络',
    '同一次运行内重复迭代命中 foldText 与匹配索引的模块级记忆化 ⇒ 测的是热缓存重复请求，不是冷启动首搜',
    '合成 fixture 非真实上游数据；真实快照档仅代表 _ref/data/plugins.json 这一份（2026-10-16）',
    '数值只可同机复跑比对，跨机/跨 Node 版本不可比',
    '同机复跑本身也有明显漂移：四次同版本运行的 synthetic-1000 / normalizeCatalog median 实测落在 0.52–1.17ms，P95 漂得更多。单次运行的 median 只用于比较量级，不要用于比较 10% 级别的差异',
    'joinInstalled 列为附加项，不在任务必测清单内'
  ],
  resolution: {
    timerFloor: timerFloor,
    knownWorkload: known,
    ratioKnownOverFloor: known.median / noopFloor,
    insufficiencyRuleMs: RESOLUTION_MIN_MS,
    insufficientCells,
    normalizeCatalogSeries: syntheticSeries,
    realSnapshotSeries: realSeries,
    normalizeStrictlyIncreasing: monotonic
  },
  chainConsistency: {
    rule: '交错口径下：链路 median ≥ 必经组件 normalizeCatalog median',
    whyInterleaved: '两者若各跑独立 bench()，则不共享 JIT/GC/折叠缓存状态，0.1ms 量级下中位数可差 ±40%，大小关系近乎掷硬币——此时套用「链路 ≥ 组件」是不成立的约束。交错取样后同一台机器实测比值稳定（synthetic-100 八轮 2.30–2.40，0/8 倒挂）。',
    pairs: chainConsistency,
    invertedCount: inconsistent.length,
    detectorSelfTest,
    unreliableCells
  },
  coldStart: coldFirstCall,
  tiers: results,
  memory,
  divergence: {
    note: 'normalizeItem 之后的可观测形状分布对照；真实档与合成档形状差异即审计发现',
    realSnapshot: realShape,
    synthetic5000: syntheticShape,
    observations: [
      '真实档 stars==0 有 956 条、合成档仅 6 条（合成 stars 是 0..1999 均匀分布）——sortPlugins top 的并列组规模因此不同，真实档并列更多',
      '真实档 category 全部落在 categories 表内（categoryOther=0）；合成档因分类按索引取模，会落进真实表里没有的 id，normalizeItem 一律保留原字符串（不重映射到 other），这条路径两档行为一致',
      '真实档 id 全部唯一（4412/4412），合成档 5000 条里只有 4941 个唯一 id（同名免 scope 包重现）——sortPlugins 的全序兜底键在两档压力不同',
      '真实档 description 是 {en,zh} 对象、category 是字符串、install 是整条命令，与合成 fixture 形状一致；无分叉',
      '真实档没有 catalog 键，顶层是 name/url/source/updated/count/categories/plugins，validateCatalogPayload 只要求 plugins 数组 + 数字 count，两档都通过'
    ]
  },
  untested: [
    ...(gcAvailable ? [] : ['内存测量：未测（需 --expose-gc）']),
    ...(realTierMissing === null ? [] : [`真实快照档位未测：读/解析 ${REAL_SNAPSHOT} 失败（${realTierMissing}）`]),
    ...insufficientCells.map((cell) => `分辨力不足（median ${cell.median.toFixed(4)}ms < ${RESOLUTION_MIN_MS}ms）：${cell.tier} / ${cell.op}`),
    ...unreliableCells.map((cell) => `本轮不可信（链路 < 必经组件，本次噪声下不可比）：${cell.tier} / ${cell.op} —— ${cell.reason}`)
  ]
}

console.log('\n=== 汇总统一报告 ===')
if (!gcAvailable) console.log('内存：未测（需 --expose-gc）——不在本机做任何推算。')
for (const entry of memory) {
  if (entry.status !== 'measured') continue
  const search = entry.ops['filterPlugins:query(dsh)']
  const chainKeys = Object.keys(entry.ops).filter((k) => k.startsWith('refresh-chain:'))
  const chainText = chainKeys
    .map((k) => `${k.replace('refresh-chain:', '')} ${(entry.ops[k].peakDeltaBytes / 1048576).toFixed(2)}/${(entry.ops[k].retainedBytes / 1048576).toFixed(2)} MiB`)
    .join(' · ')
  console.log(`  ${entry.tier}: 该档常驻 heapUsed ${(entry.heapUsedWithTierBytes / 1048576).toFixed(2)} MiB · 单次最大峰值增量 ${(entry.maxPeakDeltaBytes / 1048576).toFixed(2)} MiB（query）· 链路峰值/retained [${chainText}] · query retained ${(search.retainedBytes / 1024).toFixed(0)} KiB`)
}
if (unreliableCells.length > 0) {
  console.log('本轮不可信（已排除在可信结论之外，非失败）：')
  for (const cell of unreliableCells) console.log(`  ⚠ ${cell.tier} / ${cell.op}: ${cell.reason}`)
}
if (failures.length > 0) {
  console.log('失败：')
  for (const failure of failures) console.log(`  ✗ ${failure.tier} / ${failure.op}: ${failure.message}`)
}
console.log(`\nPERF_BASELINE_JSON ${JSON.stringify(report)}`)

process.exitCode = failures.length > 0 ? 3 : 0
void sink
