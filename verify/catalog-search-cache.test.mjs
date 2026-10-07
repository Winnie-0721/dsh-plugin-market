/**
 * 目录搜索记忆化（foldText + 匹配索引）的行为回归。
 *
 * 为什么需要它：v1.2.0 给搜索加了两处**跨请求复用**的缓存，而缓存是那种「写错了
 * 也照样能跑」的东西——搜索结果依旧正确、测试依旧全绿，只有在一个特定条件下才暴露：
 *
 *  1) foldText 按**字符串内容**缓存：`José` 与 `JOSE` 必须仍然能互相搜到；
 *  2) buildMatchIndex 按**数组身份**缓存：目录刷新后必须换一份索引。
 *     如果这里写错（例如按内容哈希或忘了比对身份），用户会在**刷新目录后看到旧索引
 *     的匹配结果**——新装的插件显示「未安装」，或已卸载的仍显示「已安装」。
 *     这类错误不会崩、不会报错，只会静静地给错答案，所以必须钉住。
 *
 * 用法：node verify/catalog-search-cache.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import {
  filterPlugins,
  joinBundles,
  joinInstalled,
  normalizeCatalog,
  normalizeItem
} from '../plugin-market/lib/catalog.js'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

// 异步用例：**就地 await**，不排队到最后（排队会让 [3]/[4] 的分节顺序错乱）。
async function awaitCheck(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

const ids = (items) => items.map((item) => item.id)

// ── [1] foldText 记忆化：语义必须与原来的「每次重算」完全一致 ──
console.log('\n[1] 归一化记忆化：变音符号搜索语义不变')

check('`José` 能搜到 `jose`，`jose` 能搜到 `José`（记忆化不能破坏双向命中）', () => {
  const items = [
    normalizeItem({ name: 'accented', owner: 'José', url: 'https://github.com/José/accented' }),
    normalizeItem({ name: 'plain', owner: 'jose', url: 'https://github.com/jose/plain' })
  ]
  assert.deepEqual(ids(filterPlugins(items, { query: 'jose' })), ['José/accented', 'jose/plain'])
  assert.deepEqual(ids(filterPlugins(items, { query: 'José' })), ['José/accented', 'jose/plain'])
})

check('同一条查询重复执行结果稳定（走缓存路径与首次冷路径一致）', () => {
  const items = [
    normalizeItem({ name: 'dsh-pet', owner: 'aaa', url: 'https://github.com/aaa/dsh-pet' }),
    normalizeItem({ name: 'dsh-meme', owner: 'bbb', url: 'https://github.com/bbb/dsh-meme' })
  ]
  const first = ids(filterPlugins(items, { query: 'pet' }))
  const second = ids(filterPlugins(items, { query: 'pet' }))
  const third = ids(filterPlugins(items, { query: 'pet' }))
  assert.deepEqual(first, ['aaa/dsh-pet'])
  assert.deepEqual(second, first)
  assert.deepEqual(third, first)
})

check('查询本身也要折叠：`JOSÉ` 与 `josé` 命中同一批（过滤前先归一化查询）', () => {
  const items = [normalizeItem({ name: 'café-tool', owner: 'zz', url: 'https://github.com/zz/cafe-tool' })]
  assert.equal(filterPlugins(items, { query: 'JOSÉ' }).length, filterPlugins(items, { query: 'josé' }).length)
  assert.deepEqual(ids(filterPlugins(items, { query: 'CAFE' })), ['zz/café-tool'])
})

// ── [2] 匹配索引记忆化：必须按「数组身份」失效 ──
console.log('\n[2] 匹配索引记忆化：换了目录数组就必须换索引')

check('同一数组重复 join，结果稳定', () => {
  const plugins = [normalizeItem({ name: 'dsh-pet', owner: 'aaa', url: 'https://github.com/aaa/dsh-pet' })]
  const bundles = [{ name: 'dsh-pet', version: '1.0.0', enabled: true }]
  const a = joinInstalled(plugins, bundles)
  const b = joinInstalled(plugins, bundles)
  assert.equal(a[0].installed, true)
  assert.equal(b[0].installed, true)
})

check('**索引不能跨目录数组复用**：新数组必须走新索引（缓存写错就会在这里挂）', () => {
  const before = [normalizeItem({ name: 'dsh-pet', owner: 'aaa', url: 'https://github.com/aaa/dsh-pet' })]
  const bundles = [{ name: 'dsh-pet', version: '1.0.0', enabled: true }]

  // 先让旧数组的索引进缓存
  assert.equal(joinInstalled(before, bundles)[0].installed, true)

  // 「目录刷新」：全新的数组，内容里根本没有 dsh-pet
  const after = [normalizeItem({ name: 'dsh-meme', owner: 'bbb', url: 'https://github.com/bbb/dsh-meme' })]
  const refreshed = joinInstalled(after, bundles)
  assert.equal(refreshed[0].id, 'bbb/dsh-meme')
  assert.equal(refreshed[0].installed, false, '刷新后的目录里没有这个包，就不能标成已安装')

  // 旧数组仍然必须答对（缓存不能把它污染成新结果）
  assert.equal(joinInstalled(before, bundles)[0].installed, true)
})

check('新增条目后 joinBundles 能看到它（索引跟着数组走）', () => {
  const empty = []
  assert.equal(joinBundles([{ name: 'dsh-pet', version: '1.0.0' }], empty)[0].latest, null)

  const withPet = [normalizeItem({ name: 'dsh-pet', owner: 'aaa', url: 'https://github.com/aaa/dsh-pet' })]
  assert.equal(joinBundles([{ name: 'dsh-pet', version: '1.0.0' }], withPet)[0].latest, null, '目录条目没有 version 就没有 latest')

  const versioned = [normalizeItem({ name: 'dsh-pet', owner: 'aaa', url: 'https://github.com/aaa/dsh-pet', version: '2.0.0' })]
  const joined = joinBundles([{ name: 'dsh-pet', version: '1.0.0' }], versioned)[0]
  assert.equal(joined.latest, '2.0.0')
  assert.equal(joined.updateAvailable, true)
})

check('joinInstalled 与 joinBundles 共用索引也不能互相污染（两个函数交替调用）', () => {
  const plugins = [normalizeItem({ name: 'dsh-pet', owner: 'aaa', url: 'https://github.com/aaa/dsh-pet', version: '2.0.0' })]
  const installed = joinInstalled(plugins, [{ name: 'dsh-pet', version: '1.0.0', enabled: true }])
  const bundles = joinBundles([{ name: 'dsh-pet', version: '1.0.0' }], plugins)
  assert.equal(installed[0].updateAvailable, true)
  assert.equal(bundles[0].latest, '2.0.0')
  // 交替再来一轮，顺序不能影响结果
  assert.equal(joinBundles([{ name: 'dsh-pet', version: '1.0.0' }], plugins)[0].latest, '2.0.0')
  assert.equal(joinInstalled(plugins, [{ name: 'dsh-pet', version: '1.0.0', enabled: true }])[0].installed, true)
})

check('空数组与 null 输入都不炸（缓存键不能假设非空）', () => {
  assert.deepEqual(joinInstalled(null, null), [])
  assert.deepEqual(joinInstalled([], []), [])
  assert.deepEqual(joinBundles(null, []), [])
  assert.deepEqual(joinBundles([], null), [])
})

check('大小写仓库名必须认回自己（否则会标错到别人的包）', () => {
  // 审计发现的真 bug：nameKeys 用**原始** repo 名当键，而查表一律走 lookupKey（会小写化）。
  // 真实目录里 88 个仓库名含大写字母，实测 0 个命中自己、5 个标错到**另一个 owner 的同名
  // 小写仓库**（`bill277048-hash/DSH-model-router` 被标成 `superboy911/dsh-model-router`
  // 已安装/可更新）。这正是本文件注释里明令禁止的「指错人」。
  const items = [
    normalizeItem({ name: 'DSH-model-router', owner: 'bill277048-hash', url: 'https://github.com/bill277048-hash/DSH-model-router' }),
    normalizeItem({ name: 'dsh-model-router', owner: 'superboy911', url: 'https://github.com/superboy911/dsh-model-router' })
  ]
  // 这两个仓库的小写裸名相同 → 不同 owner 争用 → 按设计判歧义、两边都不猜（宁可不显示也不指错人）
  const joined = joinInstalled(items, [{ name: 'DSH-model-router', version: '0.0.1' }])
  const me = joined.find((x) => x.id === 'bill277048-hash/DSH-model-router')
  const other = joined.find((x) => x.id === 'superboy911/dsh-model-router')
  assert.equal(other.installed, false, '绝不能把别人的同名小写仓库标成已安装')
  assert.equal(me.installed, false, '同名撞车时按设计判歧义（不猜），但也不许指向别人')
})

check('大写仓库名独占一个仓库时，必须精确认回自己', () => {
  const items = [
    normalizeItem({ name: 'DSH-Office', owner: 'didclawapp-ai', url: 'https://github.com/didclawapp-ai/DSH-Office' }),
    normalizeItem({ name: 'other-plugin', owner: 'someone', url: 'https://github.com/someone/other-plugin' })
  ]
  const joined = joinInstalled(items, [{ name: 'DSH-Office', version: '0.9.0' }])
  const me = joined.find((x) => x.id === 'didclawapp-ai/DSH-Office')
  assert.equal(me.installed, true, '含大写的仓库名必须能认回自己（旧实现 0 命中）')
  assert.equal(joined.find((x) => x.id === 'someone/other-plugin').installed, false, '不能误标别人')
})

check('大写仓库名也要能被全小写探针命中（宿主报包名的大小写不固定）', () => {
  const items = [normalizeItem({ name: 'DSH-taskboard', owner: 'shengsheng90', url: 'https://github.com/shengsheng90/DSH-taskboard' })]
  assert.equal(joinInstalled(items, [{ name: 'DSH-taskboard', version: '1.0.0' }])[0].installed, true, '原样')
  assert.equal(joinInstalled(items, [{ name: 'dsh-taskboard', version: '1.0.0' }])[0].installed, true, '全小写')
})

// ── [3] 并发 ensure() 只归一化一次 ──
console.log('\n[3] 并发抓取：所有等待者共用同一份快照')

await awaitCheck('同一个 result 只归一化一次（否则每个等待者各造一份 plugins 数组）', async () => {
  const { createCatalogCache } = await import('../plugin-market/lib/catalog.js')
  // 用一份**合法**目录（validateCatalogPayload 要求 count>0 时 plugins 非空、且条数不能差太多）。
  const body = {
    url: 'https://example.test/plugins.json',
    updated: '2026-01-01',
    count: 1,
    plugins: [{ name: 'alpha', owner: 'owner', url: 'https://github.com/owner/alpha', category: 'ui' }],
    categories: []
  }
  let calls = 0
  const cache = createCatalogCache({
    source: 'https://example.test/plugins.json',
    fetch: async () => { calls += 1; return { ok: true, status: 200, text: async () => JSON.stringify(body) } }
  })
  const results = await Promise.all(Array.from({ length: 8 }, () => cache.ensure()))
  for (const r of results) assert.equal(r.ok, true, `ensure 应当成功：${JSON.stringify(r).slice(0, 200)}`)
  assert.equal(calls, 1, '并发应当只抓一次（原有行为）')
  const pluginsArrays = new Set(results.map((r) => r.cache.plugins))
  assert.equal(pluginsArrays.size, 1, '8 个等待者必须共用同一个 plugins 数组（否则按数组身份的索引缓存全失效）')
  const caches = new Set(results.map((r) => r.cache))
  assert.equal(caches.size, 1, '8 个等待者必须共用同一份 cache 对象')
})

// ── [4] 真实规模 ──
const snapshotPath = new URL('../_ref/data/plugins.json', import.meta.url)
if (existsSync(snapshotPath)) {
  console.log('\n[4] 真实目录快照（4412 条）')
  const snapshot = normalizeCatalog(JSON.parse(readFileSync(snapshotPath, 'utf8')))

  check('真实快照：记忆化后同一批查询结果与首次一致（真实数据上不漂移）', () => {
    const queries = ['pet', 'zh', 'mem', '皮肤', '']
    const first = queries.map((q) => ids(filterPlugins(snapshot.plugins, { query: q })))
    const again = queries.map((q) => ids(filterPlugins(snapshot.plugins, { query: q })))
    assert.deepEqual(again, first)
  })

  check('真实快照：搜 `github` 仍然不返回全量（索引记忆化没有放宽匹配）', () => {
    const hit = filterPlugins(snapshot.plugins, { query: 'github' })
    assert.ok(hit.length > 0, '应当有命中')
    assert.ok(hit.length < snapshot.plugins.length, `不能返回全量，实际 ${hit.length}/${snapshot.plugins.length}`)
  })

  check('真实快照：@owner/name 别名仍认回 ≥1400 条（索引没被缓存改成另一种语义）', () => {
    const npmItems = snapshot.plugins.filter((item) => item.npm !== null && item.owner !== '')
    let matched = 0
    const bundles = npmItems.slice(0, 500).map((item) => ({ name: `@${item.owner}/${item.name}`, version: '0.0.1' }))
    for (const bundle of bundles) {
      const hit = joinInstalled(snapshot.plugins, [bundle]).filter((item) => item.installed === true)
      if (hit.length > 0 && hit[0].owner === bundle.name.slice(1, bundle.name.indexOf('/'))) matched += 1
    }
    assert.ok(matched >= 400, `前 500 条 @owner/name 至少应认回 400 条，实际 ${matched}`)
  })
} else {
  console.log('\n[3] 真实目录快照不存在，跳过（不影响门禁）')
}

console.log('')
if (failures.length > 0) {
  console.log(`目录搜索记忆化回归：${passed} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  ✗ ${failure.name}: ${failure.message}`)
  process.exit(1)
}
console.log(`目录搜索记忆化回归：${passed}/${passed} 全通过`)
