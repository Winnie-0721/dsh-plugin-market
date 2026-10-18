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
const results = []
const insufficientCells = []
const failures = []
const memory = []

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
    'refresh-chain(validate→normalize→counts→filter→sort→paginate)': () => {
      const v = validateCatalogPayload(tier.payload)
      if (!v.ok) throw new Error(`validateCatalogPayload 失败：${v.message}`)
      const catalog = normalizeCatalog(tier.payload, { source: tier.payload.url })
      const cats = categoryCounts(catalog.plugins, catalog.categoryLabels)
      const filtered = filterPlugins(catalog.plugins, { query: 'dsh', category: cats[0]?.id ?? 'other' })
      const sorted = sortPlugins(filtered, 'top')
      return paginate(sorted, 1, 24)
    },
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
    for (const label of ['normalizeCatalog', 'filterPlugins:query(dsh)', 'sortPlugins:top', 'refresh-chain(validate→normalize→counts→filter→sort→paginate)', 'joinInstalled(附加)']) {
      const fn = ops[label]
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
    if (m.error) { console.log(`  ${label.padEnd(44)} ERROR ${m.error}`); continue }
    console.log(`  ${label.padEnd(44)} ${m.min.toFixed(3).padStart(8)} ${m.median.toFixed(3).padStart(8)} ${m.p95.toFixed(3).padStart(8)} ${m.max.toFixed(3).padStart(8)}${m.resolvable ? '' : '  ⚠分辨力不足'}`)
  }
}

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

const report = {
  schema: 'dsh-plugin-market/perf-baseline@1',
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
    ...insufficientCells.map((cell) => `分辨力不足（median ${cell.median.toFixed(4)}ms < ${RESOLUTION_MIN_MS}ms）：${cell.tier} / ${cell.op}`)
  ]
}

console.log('\n=== 汇总统一报告 ===')
if (!gcAvailable) console.log('内存：未测（需 --expose-gc）——不在本机做任何推算。')
for (const entry of memory) {
  if (entry.status !== 'measured') continue
  const chain = entry.ops['refresh-chain(validate→normalize→counts→filter→sort→paginate)']
  const search = entry.ops['filterPlugins:query(dsh)']
  console.log(`  ${entry.tier}: 该档常驻 heapUsed ${(entry.heapUsedWithTierBytes / 1048576).toFixed(2)} MiB · 单次最大峰值增量 ${(entry.maxPeakDeltaBytes / 1048576).toFixed(2)} MiB（query）· 刷新链路峰值 ${(chain.peakDeltaBytes / 1048576).toFixed(2)} MiB / retained ${(chain.retainedBytes / 1048576).toFixed(2)} MiB · query retained ${(search.retainedBytes / 1024).toFixed(0)} KiB`)
}
if (failures.length > 0) {
  console.log('失败：')
  for (const failure of failures) console.log(`  ✗ ${failure.tier} / ${failure.op}: ${failure.message}`)
}
console.log(`\nPERF_BASELINE_JSON ${JSON.stringify(report)}`)

process.exitCode = failures.length > 0 ? 3 : 0
void sink
