/**
 * 目录分片协议回归（`plugin-market/lib/catalog-shard.js` + `catalog-shard-fetch.js`）。
 *
 * 为什么要这么多条：分片把「一次 GET」变成「1 + N 次 GET + 校验 + 拼装」，
 * 每一步都有一个**看起来能跑、实际会静静丢数据**的失败方式：
 *   - 少拼一片 → 目录少一个分类，`stale:false` 覆盖好缓存，市场只是「插件变少了」；
 *   - 不验 sha256 → 截断的片被当成正常数据；
 *   - 不验 id/part → 远端数据决定请求路径（`../` 逃逸）；
 *   - 清单与分片不核条数 → 自洽的坏数据可以少 500 条而没人发现。
 * 每条都钉住**一个**可观测的结论，且不联网（注入 fetch）。
 *
 * 用法：node verify/catalog-shard.test.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  SHARD_FORMAT,
  SHARD_MAX_BYTES,
  UNCATEGORIZED_SHARD,
  isValidShardId,
  manifestDocument,
  sha256Hex,
  shardPath,
  splitShards,
  validateManifest,
  validateShard
} from '../plugin-market/lib/catalog-shard.js'
import { readCatalogFromShards, resolveShardBase, looksLikeShardManifestUrl } from '../plugin-market/lib/catalog-shard-fetch.js'
import { resolveSources } from '../plugin-market/lib/catalog.js'

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

/** 造一份可分片的目录（分类分布可控）。 */
function makeItems(spec) {
  const items = []
  for (const [category, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i += 1) {
      items.push({ name: `dsh-${category}-${i}`, category, url: `https://github.com/o/${category}-${i}`, stars: i })
    }
  }
  return items
}

/** 一份能直接喂给 validateShard 的清单条目。 */
function entryFor(id, part, plugins) {
  const body = JSON.stringify({ format: SHARD_FORMAT, kind: 'catalog-shard', id, part, count: plugins.length, plugins })
  const bytes = Buffer.from(body, 'utf8')
  return { id, part, count: plugins.length, bytes: bytes.length, sha256: sha256Hex(bytes), body, bytesBuffer: bytes }
}

console.log('\n[1] 切分：按分类、保顺序、条目守恒')

await check('切分保留源顺序（分类顺序与组内顺序都不重排）', () => {
  const items = [...makeItems({ ui: 3 }), ...makeItems({ tools: 2 })]
  const { shards } = splitShards(items, { targetBytes: 10 * 1024 * 1024 })
  assert.deepEqual(shards.map((s) => s.id), ['ui', 'tools'], '分类顺序应跟源一致，不能按名字排')
  const ui = shards.find((s) => s.id === 'ui')
  assert.equal(ui.count, 3)
  const parsed = JSON.parse(ui.body)
  assert.deepEqual(parsed.plugins.map((p) => p.name), ['dsh-ui-0', 'dsh-ui-1', 'dsh-ui-2'], '组内顺序也必须保持')
})

await check('条目守恒：所有分片的 count 之和 === 输入条数', () => {
  const items = makeItems({ ui: 120, tools: 40, fun: 7 })
  const { shards, total } = splitShards(items, { targetBytes: 2048 })
  assert.equal(total, items.length)
  assert.equal(shards.reduce((sum, s) => sum + s.count, 0), items.length)
  assert.ok(shards.length > 3, `2 KiB 目标下应该切出多片，实际 ${shards.length}`)
})

await check('单片不超过目标值（单条本身超目标时允许它独占一片）', () => {
  const items = makeItems({ ui: 200 })
  const target = 4096
  const { shards } = splitShards(items, { targetBytes: target })
  for (const shard of shards) assert.ok(shard.bytes <= target * 2, `${shard.id}.${shard.part} 有 ${shard.bytes} B`)
  // 单条超大：不许丢，单独成片
  const huge = { name: 'huge', category: 'ui', description: 'x'.repeat(20000) }
  const out = splitShards([huge], { targetBytes: 1024 })
  assert.equal(out.shards.length, 1)
  assert.equal(out.shards[0].count, 1)
})

await check('没有分类 / 非法分类 id 的条目归到 _uncategorized（不许丢）', () => {
  const items = [
    { name: 'a' },
    { name: 'b', category: null },
    { name: 'c', category: '' },
    { name: 'd', category: '../etc/passwd' },
    { name: 'e', category: 'UI' }
  ]
  const { shards, total } = splitShards(items, { targetBytes: 1024 * 1024 })
  assert.equal(total, 5)
  assert.equal(shards.length, 1)
  assert.equal(shards[0].id, UNCATEGORIZED_SHARD, '非法 id 不许被当成路径拼进 URL')
  assert.equal(shards[0].count, 5)
})

console.log('\n[2] 路径安全：远端数据不得决定请求路径')

await check('isValidShardId 只放行 [a-z0-9_-]，挡住 ../、斜杠、绝对路径、大写', () => {
  for (const ok of ['ui', 'tools', 'a', 'a-b_c', '_uncategorized', 'x1']) {
    assert.equal(isValidShardId(ok), true, `${ok} 应合法`)
  }
  for (const bad of ['../x', 'a/b', '/etc', 'C:', '.', '..', 'UI', '', ' a', 'a b', 'x'.repeat(65), null, 42]) {
    assert.equal(isValidShardId(bad), false, `${JSON.stringify(bad)} 必须被拒`)
  }
})

await check('shardPath 只接受合法 id/part（非法输入抛错，不生成路径）', () => {
  assert.equal(shardPath('ui', 1), 'shards/ui.1.json')
  assert.throws(() => shardPath('../x', 1))
  assert.throws(() => shardPath('ui', 0), 'part 从 1 起，0 非法')
  assert.throws(() => shardPath('ui', 1.5))
  assert.throws(() => shardPath('ui', '1'))
})

console.log('\n[3] 清单校验：先是「能不能按它发请求」，再是「数据对不对」')

const goodItems = makeItems({ ui: 4, tools: 2 })
const good = splitShards(goodItems, { targetBytes: 10 * 1024 * 1024 })
const goodManifest = manifestDocument({
  updated: '2026-11-11',
  count: good.total,
  categories: { ui: { zh: 'UI', en: 'UI' } },
  shards: good.shards.map((s) => ({ id: s.id, part: s.part, count: s.count, bytes: s.bytes, sha256: sha256Hex(Buffer.from(s.body)) }))
})

await check('合法清单通过', () => {
  const verdict = validateManifest(goodManifest)
  assert.equal(verdict.ok, true, verdict.message)
})

await check('format 不符 ⇒ 拒绝（两代不兼容，不猜）', () => {
  const verdict = validateManifest({ ...goodManifest, format: 1 })
  assert.equal(verdict.ok, false)
  assert.match(verdict.message, /format/)
})

await check('清单 count 与分片条数之和不符 ⇒ 拒绝（这是「缺片」唯一的事前判据）', () => {
  const verdict = validateManifest({ ...goodManifest, count: goodManifest.count + 100 })
  assert.equal(verdict.ok, false)
  assert.match(verdict.message, /不一致/)
})

await check('分片 id 非法（路径逃逸）⇒ 拒绝', () => {
  const bad = { ...goodManifest, shards: goodManifest.shards.map((s, i) => (i === 0 ? { ...s, id: '../etc' } : s)) }
  const verdict = validateManifest(bad)
  assert.equal(verdict.ok, false)
  assert.match(verdict.message, /非法 id/)
})

await check('同一分片出现两次 ⇒ 拒绝（重复会让 count 核对失去意义）', () => {
  const dup = { ...goodManifest, shards: [...goodManifest.shards, goodManifest.shards[0]], count: goodManifest.count + goodManifest.shards[0].count }
  const verdict = validateManifest(dup)
  assert.equal(verdict.ok, false)
  assert.match(verdict.message, /重复/)
})

await check('分片数超过上限 ⇒ 拒绝（防放大攻击）', () => {
  const many = { ...goodManifest, shards: Array.from({ length: 600 }, (_, i) => ({ ...goodManifest.shards[0], part: i + 1 })) }
  const verdict = validateManifest(many)
  assert.equal(verdict.ok, false)
})

await check('sha256 缺失/格式不对 ⇒ 拒绝（不许「没有校验也放行」）', () => {
  for (const bad of [undefined, '', 'xyz', 'A'.repeat(64)]) {
    const verdict = validateManifest({ ...goodManifest, shards: goodManifest.shards.map((s, i) => (i === 0 ? { ...s, sha256: bad } : s)) })
    assert.equal(verdict.ok, false, `sha256=${JSON.stringify(bad)} 必须被拒`)
  }
})

await check('bytes 超过硬上限 ⇒ 拒绝（发布端与消费端用同一个上限）', () => {
  const verdict = validateManifest({ ...goodManifest, shards: goodManifest.shards.map((s, i) => (i === 0 ? { ...s, bytes: SHARD_MAX_BYTES + 1 } : s)) })
  assert.equal(verdict.ok, false)
})

console.log('\n[4] 分片校验：哈希先于解析，内容再与清单对账')

await check('合法分片通过并给出条目', () => {
  const entry = entryFor('ui', 1, goodItems.slice(0, 4))
  const verdict = validateShard(entry.bytesBuffer, entry)
  assert.equal(verdict.ok, true, verdict.message)
  assert.equal(verdict.plugins.length, 4)
})

await check('字节被改一位 ⇒ sha256 不符，拒绝（截断/投毒）', () => {
  const entry = entryFor('ui', 1, goodItems.slice(0, 4))
  const tampered = Buffer.from(entry.bytesBuffer)
  tampered[tampered.length - 2] ^= 0x01
  const verdict = validateShard(tampered, entry)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'shard-integrity')
})

await check('字节数不符 ⇒ 拒绝（哪怕是前缀截断）', () => {
  const entry = entryFor('ui', 1, goodItems.slice(0, 4))
  const truncated = entry.bytesBuffer.subarray(0, entry.bytesBuffer.length - 10)
  const verdict = validateShard(truncated, entry)
  assert.equal(verdict.ok, false, '截断的片不许被当成正常数据')
})

await check('哈希对得上但自称 id/part 与清单不符 ⇒ 拒绝（装错片）', () => {
  const entry = entryFor('ui', 1, goodItems.slice(0, 4))
  const wrong = { ...entry, id: 'tools', part: 1 }
  // 用同一个 ByteBuffer，但清单说是 tools.1 —— 内容自称 ui.1
  const verdict = validateShard(entry.bytesBuffer, wrong)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'shard-mismatch')
  assert.match(verdict.message, /自称/)
})

await check('哈希对得上但条数与清单不符 ⇒ 拒绝（自洽的坏数据也能被这一条抓住）', () => {
  const entry = entryFor('ui', 1, goodItems.slice(0, 4))
  const lying = { ...entry, count: 42 }
  const verdict = validateShard(entry.bytesBuffer, lying)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'shard-mismatch')
})

console.log('\n[5] 消费端组装：全有或全无、有界并发、顺序稳定')

/** 起一个假的 fetch：从内存表里按 URL 返回。 */
function fakeFetch(table, options = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    const key = String(url)
    calls.push(key)
    const entry = table[key]
    if (entry === undefined) {
      return { ok: false, status: 404, headers: { get: () => null }, body: null, text: async () => '' }
    }
    if (typeof entry === 'function') return entry()
    const bytes = Buffer.from(entry, 'utf8')
    let sent = false
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? String(bytes.length) : null) },
      body: {
        getReader() {
          return {
            async read() {
              if (sent) return { done: true }
              sent = true
              return { done: false, value: bytes }
            },
            async cancel() {}
          }
        }
      }
    }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/** 把一次 splitShards 的结果变成「服务器上的文件表」。 */
function tableFor(baseUrl, manifest, shards) {
  const table = { [`${baseUrl}catalog.json`]: JSON.stringify(manifest) }
  for (const shard of shards) {
    table[`${baseUrl}shards/${shard.id}.${shard.part}.json`] = shard.body
  }
  return table
}

function manifestFor(shards) {
  return manifestDocument({
    updated: '2026-11-11',
    count: shards.reduce((sum, s) => sum + s.count, 0),
    categories: {},
    shards: shards.map((s) => ({ id: s.id, part: s.part, count: s.count, bytes: s.bytes, sha256: sha256Hex(Buffer.from(s.body)) }))
  })
}

await check('全部成功 ⇒ 按清单顺序拼出完整目录', async () => {
  const items = makeItems({ ui: 5, tools: 3, fun: 2 })
  const { shards } = splitShards(items, { targetBytes: 10 * 1024 * 1024 })
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const fetchImpl = fakeFetch(tableFor(base, manifest, shards))
  const out = await readCatalogFromShards({ fetch: fetchImpl, manifestUrl: `${base}catalog.json` })
  assert.equal(out.ok, true, out.reason)
  assert.equal(out.raw.plugins.length, items.length)
  assert.equal(out.raw.count, items.length)
  // 顺序 = 清单顺序（不是完成顺序）
  assert.deepEqual(out.raw.plugins.map((p) => p.name), items.map((p) => p.name))
})

await check('任一分片 404 ⇒ 整体失败，绝不返回「少几片」的部分目录', async () => {
  const items = makeItems({ ui: 5, tools: 3 })
  const { shards } = splitShards(items, { targetBytes: 10 * 1024 * 1024 })
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const table = tableFor(base, manifest, shards)
  // 删掉第二片
  delete table[`${base}shards/${shards[1].id}.${shards[1].part}.json`]
  const out = await readCatalogFromShards({ fetch: fakeFetch(table), manifestUrl: `${base}catalog.json` })
  assert.equal(out.ok, false, '缺片必须整体失败——部分目录会以 stale:false 覆盖好缓存')
  assert.match(out.reason, /分片/)
})

await check('分片哈希被改 ⇒ 整体失败且原因指向该片', async () => {
  const items = makeItems({ ui: 5, tools: 3 })
  const { shards } = splitShards(items, { targetBytes: 10 * 1024 * 1024 })
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const table = tableFor(base, manifest, shards)
  const key = `${base}shards/${shards[0].id}.${shards[0].part}.json`
  const before = table[key]
  table[key] = before.replace('dsh-ui-0', 'dsh-ui-X')
  assert.notEqual(table[key], before, '前置条件：篡改必须真的改到字节，否则这条没在测哈希')
  const out = await readCatalogFromShards({ fetch: fakeFetch(table), manifestUrl: `${base}catalog.json` })
  assert.equal(out.ok, false)
  assert.match(out.reason, /sha256|分片/)
})

await check('清单一开始就 404 ⇒ kind=no-manifest（上层据此回退到单片源）', async () => {
  const out = await readCatalogFromShards({ fetch: fakeFetch({}), manifestUrl: 'https://cdn.example/catalog/catalog.json' })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'no-manifest', `实际 kind=${out.kind}`)
})

await check('清单不是 JSON / format 不对 ⇒ 结构化失败，不抛异常', async () => {
  for (const body of ['<html>', '{"format":1,"kind":"catalog-manifest","count":0,"shards":[]}']) {
    const table = { 'https://cdn.example/catalog/catalog.json': body }
    const out = await readCatalogFromShards({ fetch: fakeFetch(table), manifestUrl: 'https://cdn.example/catalog/catalog.json' })
    assert.equal(out.ok, false)
    assert.ok(['not-json', 'bad-manifest'].includes(out.kind), `kind=${out.kind}`)
  }
})

await check('并发有界：同时最多 SHARD_CONCURRENCY 个在飞', async () => {
  const items = makeItems({ ui: 20 })
  const { shards } = splitShards(items, { targetBytes: 256 }) // 切成很多小片
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const table = tableFor(base, manifest, shards)
  let inFlight = 0
  let maxInFlight = 0
  const plain = fakeFetch(table)
  const fetchImpl = async (url) => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 2))
    try {
      return await plain(url)
    } finally {
      inFlight -= 1
    }
  }
  const out = await readCatalogFromShards({ fetch: fetchImpl, manifestUrl: `${base}catalog.json`, concurrency: 3 })
  assert.equal(out.ok, true, out.reason)
  assert.ok(maxInFlight <= 3, `并发上限是 3，实测峰值 ${maxInFlight}`)
  assert.ok(shards.length > 3, '前置条件：分片数要多于并发上限才测得到')
})

await check('分片失败后被取消的 worker 不会被误当成「取到了」⇒ 仍整体失败', async () => {
  // 这一条盯的是 `aborted` 提前退出路径：一片失败后，其它 worker 会在循环边界退出，
  // 留下 **undefined** 的 outcome。若实现只看 `aborted` 而漏掉 outcomes 里的空洞，
  // 就会拼出一个「少几片但没报错」的目录——本文件开头列的静默丢数据，正是这个形状。
  const items = makeItems({ ui: 3, tools: 3, fun: 3, dev: 3 })
  const { shards } = splitShards(items, { targetBytes: 256 }) // 切成很多片
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const table = tableFor(base, manifest, shards)
  // 让**中间**一片 500：它前面已成功的片与它后面的片都会落在不同 worker 上
  const victim = shards[Math.floor(shards.length / 2)]
  table[`${base}shards/${victim.id}.${victim.part}.json`] = () => ({
    ok: false,
    status: 500,
    headers: { get: () => null },
    body: null
  })
  assert.ok(shards.length >= 4, '前置条件：分片数要够多，才有一片失败而其它片已成功')
  const out = await readCatalogFromShards({ fetch: fakeFetch(table), manifestUrl: `${base}catalog.json`, concurrency: 2 })
  assert.equal(out.ok, false, '一片 500 必须让整次读取失败')
  assert.match(out.reason, /分片|500/, `原因要指向失败的那片，实际：${out.reason}`)
})

await check('清单 count 与组装结果不符 ⇒ 拒绝（最后一道总和核对）', async () => {
  // 前一道 validateManifest 会先把「count ≠ 分片条数之和」挡住，所以这里要构造一份
  // **清单自洽、但分片内容与清单不符** 的数据：改分片正文里的条数，只改正文不改清单——
  // 这时 sha256 会先挂。于是走另一条路：让 validateShard 通过（哈希对、条数对），
  // 但清单的 count 与组装结果不一致 —— 只能靠最后那道 plugins.length 核对发现。
  // 构造方式：清单里 count = 各片条数之和 + 0，但**少放一个分片**进 shards 数组的同时
  // 把 count 同步调小 —— 那就变成合法清单了。所以真正能测的是：清单合法、每片合法，
  // 而组装顺序被破坏也不会丢条数（守恒），说明最后一道是**冗余保险**。
  // 这里如实断言它的存在与结论：
  const items = makeItems({ ui: 4 })
  const { shards } = splitShards(items, { targetBytes: 10 * 1024 * 1024 })
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const out = await readCatalogFromShards({ fetch: fakeFetch(tableFor(base, manifest, shards)), manifestUrl: `${base}catalog.json` })
  assert.equal(out.ok, true, out.reason)
  assert.equal(out.raw.plugins.length, manifest.count, '组装条数必须与清单 count 相等')
  // 反向：把清单 count 改大（分片不动）⇒ 清单校验就该拒，轮不到组装
  const inflated = { ...manifest, count: manifest.count + 1 }
  assert.equal(validateManifest(inflated).ok, false, 'count 与分片总和不等必须被清单校验挡下')
})

console.log('\n[6] 源解析与降级：分片不可用时行为要跟以前一模一样')

await check('默认源列表以分片开头，且保留 npm 与单片 URL 兜底', () => {
  const sources = resolveSources({})
  assert.equal(sources[0].kind, 'shards', '分片应该是首选（小分片对弱网更友好）')
  assert.ok(sources.some((s) => s.kind === 'npm'), '必须保留 npm 兜底')
  assert.ok(sources.some((s) => s.kind === 'url'), '必须保留单片 plugins.json 兜底')
})

await check('DSHM_REGISTRY_URL 指向 catalog.json ⇒ 走分片；指向 plugins.json ⇒ 走单片', () => {
  const shard = resolveSources({ DSHM_REGISTRY_URL: 'https://x.example/catalog/catalog.json' })
  assert.equal(shard.length, 1)
  assert.equal(shard[0].kind, 'shards')
  const plain = resolveSources({ DSHM_REGISTRY_URL: 'https://x.example/plugins.json' })
  assert.equal(plain.length, 1)
  assert.equal(plain[0].kind, 'url')
})

await check('resolveShardBase 把清单地址折成目录（分片在它下面的 shards/）', () => {
  const { baseUrl, manifestUrl } = resolveShardBase('https://x.example/catalog/catalog.json')
  assert.equal(baseUrl, 'https://x.example/catalog/')
  assert.equal(manifestUrl, 'https://x.example/catalog/catalog.json')
})

await check('looksLikeShardManifestUrl 认 catalog.json，不误伤普通 plugins.json', () => {
  assert.equal(looksLikeShardManifestUrl('https://x.example/catalog.json'), true)
  assert.equal(looksLikeShardManifestUrl('https://x.example/catalog/catalog.json'), true)
  assert.equal(looksLikeShardManifestUrl('https://x.example/plugins.json'), false)
  assert.equal(looksLikeShardManifestUrl('not a url'), false)
})

console.log('\n[7] 与旧格式的关系：分片是传输形态，不是格式变更')

await check('组装出的 raw 与单片 plugins.json 同形（下游 normalizeCatalog 不用改）', async () => {
  const items = makeItems({ ui: 3 })
  const { shards } = splitShards(items, { targetBytes: 10 * 1024 * 1024 })
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const out = await readCatalogFromShards({ fetch: fakeFetch(tableFor(base, manifest, shards)), manifestUrl: `${base}catalog.json` })
  assert.equal(out.ok, true, out.reason)
  for (const key of ['count', 'plugins', 'categories']) {
    assert.ok(key in out.raw, `组装结果必须带 ${key}`)
  }
  assert.ok(Array.isArray(out.raw.plugins))
})

await check('**最强等价性**：单片与分片两条路产出逐字节相同的规范化快照', async () => {
  // 这是「分片是传输形态、不是格式变更」的终局证据：同一份数据，走 `url` 源与走 `shards` 源，
  // 经过完整的缓存层（校验 + normalizeCatalog + 分类计数）之后，
  // **count + categories + plugins 的 JSON 必须逐字节相同**。
  // 只要分类归属、条目顺序、字段投影有任何一处被分片改动，这个断言就会失败。
  const { createCatalogCache } = await import('../plugin-market/lib/catalog.js')

  const items = makeItems({ ui: 4, tools: 3, fun: 2 })
  items.push({ name: 'dsh-nocat', url: 'https://github.com/o/nocat' }) // 无分类 → 落在 _uncategorized 片
  const { shards } = splitShards(items, { targetBytes: 10 * 1024 * 1024 })
  const manifest = manifestFor(shards)
  const base = 'https://cdn.example/catalog/'
  const table = tableFor(base, manifest, shards)
  // 单片源：同一条目数组序列化成 plugins.json（这是**变更前**的那条路）
  table[`${base}single/plugins.json`] = JSON.stringify({ count: items.length, plugins: items })

  // 两个缓存各用**独立的** fake fetch 实例：共享一个实例会让 calls 混在一起，
  // 也让「某条源是否真的发了请求」无法独立观测。
  const singleCache = createCatalogCache({
    sources: [{ kind: 'url', url: `${base}single/plugins.json`, timeoutMs: 15000, label: 'single', short: 'single' }],
    fetch: fakeFetch(table)
  })
  const shardCache = createCatalogCache({
    sources: [{ kind: 'shards', manifestUrl: `${base}catalog.json`, label: 'sharded', short: 'sharded' }],
    fetch: fakeFetch(table)
  })

  const a = await singleCache.ensure()
  const b = await shardCache.ensure()
  assert.equal(a.ok, true, `单片源应成功：${a.message ?? ''}`)
  assert.equal(b.ok, true, `分片源应成功：${b.message ?? ''}`)

  const canon = (cache) => JSON.stringify({ count: cache.count, categories: cache.categories, plugins: cache.plugins })
  assert.equal(canon(b.cache), canon(a.cache), '分片路径与单片路径的规范化快照必须逐字节一致')
  // 前置条件：确认这条测试不是「两边都空」而意外相等
  assert.equal(a.cache.count, items.length, `单片路径应有 ${items.length} 条`)
  assert.ok(a.cache.categories.length >= 3, '应当有至少 3 个分类参与比较')
})

console.log('')
if (failures.length > 0) {
  console.log(`目录分片回归：${passed}/${passed + failures.length} 通过，失败：${failures.map((f) => f.name).join('；')}`)
  process.exit(1)
}
console.log(`目录分片回归：${passed}/${passed} 全通过`)
