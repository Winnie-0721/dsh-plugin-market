/**
 * 上游目录新字段的适配回归（门禁执行）。
 *
 * ## 背景：上游数据源升级了
 * 数据源仓库 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 的 plugins.json
 * （经 npm 包 `dsh-plugin-catalog` 镜像发布，版本 2026.1018.7716，5786 条）新增了市场
 * **完全没接**的字段。权威 schema 在它的 `scripts/build-site.mjs` 里，这里逐条对齐语义。
 *
 * 实测字段分布（2026-10-18 拉取真实 plugins.json，_verify/upstream-plugins.json）：
 *
 *   downloadsStart/End/CheckedAt  2947 条  下载量统计区间（downloads 是**近 30 天**）
 *   capabilities                  5275 条  能力标签（市场已接）
 *   capabilityRedLines            5275 条  **能力红线**（597 条非空！）
 *   capabilityCheckedAt           5275 条  扫描时间
 *   screenshots                   1289 条  截图（只允许 GitHub 自家 host）
 *   tarball                        581 条  作者声明的预构建产物
 *
 * ## 三条不能读错的语义（上游注释原文 + 实测）
 *
 * 1. **「缺失」≠「干净」**。build-site.mjs：
 *    「An entry absent here was NOT scanned — the surfaces print that as 未检出, never as clean.」
 *    实测：capabilities 与 capabilityRedLines 是**一起出现/一起缺失**的（都 5275 条），
 *    缺失的 511 条是**没扫过**，不是「没有能力」也不是「没有红线」。
 *    把「未扫描」渲染成空白/绿色，等于给一个没检查过的插件背书。
 *
 * 2. **downloads 的 null ≠ 0**。上游注释：
 *    「null for the ~60% of entries with no npm package at all — a coverage gap, not a zero.
 *      Consumers must tell "not published" apart from "published, unused".」
 *    实测：null 2839 条（其中无 npm 2819、有 npm 但还没探到 20），**0 条**是真的 0。
 *    市场现在写 `formatCount(item.downloads || 0)` ⇒ 把 2839 条「没数据」显示成「↓ 0」。
 *
 * 3. **screenshots 只许 GitHub 自家 host**。上游白名单：
 *    raw.githubusercontent.com / user-images.githubusercontent.com /
 *    camo.githubusercontent.com / github.com。
 *    理由（原文）：「a third-party image host would let a list PR plant a tracking pixel in
 *    every storefront user's browser」。实测 3650 个 URL 全部落在
 *    raw.githubusercontent.com(3620) 与 github.com(30)。
 *    市场渲染时必须**再校验一次**：上游今天合规不代表缓存里的旧数据合规，
 *    而且这条约束的价值恰恰是防「数据被投毒」——不能只信数据源自己。
 *
 * 4. **tarball 是「只能这样装」的兜底**。上游：有些插件只发布构建产物、从源码装不了，
 *    `github:owner/repo` 会给用户一条坏命令。581 条有 tarball。
 *    市场必须能让用户拿到它（命令里用它），而不是永远给 `github:` 那条。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { normalizeItem, normalizeCatalog, filterPlugins, sortPlugins } from '../plugin-market/lib/catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const catalogSource = readFileSync(join(here, '..', 'plugin-market', 'lib', 'catalog.js'), 'utf8')
const clientSource = readFileSync(join(here, '..', 'plugin-market', 'lib', 'client.js'), 'utf8')

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

// ── 1. normalizeItem 必须把新字段搬进来（含「缺失」与「空」的区分）────────────
console.log('\n[1] normalizeItem：新字段要搬进来，且区分「未扫描」与「扫过但没红线」')

check('扫描过的条目：capabilities / redLines / scannedAt 三者都带出来', () => {
  const item = normalizeItem({
    name: 'dsh-x', owner: 'a', npm: 'dsh-x', version: '1.0.0',
    capabilities: ['network', 'env'],
    capabilityRedLines: ['reads credentials/secrets AND has network access'],
    capabilityCheckedAt: '2026-10-17T00:00:00.000Z'
  })
  assert.deepEqual(item.capabilities, ['network', 'env'])
  assert.deepEqual(item.capabilityRedLines, ['reads credentials/secrets AND has network access'],
    '**红线必须搬进来**：597 条有告警，市场现在一条都不显示')
  assert.equal(item.capabilityCheckedAt, '2026-10-17T00:00:00.000Z', '扫描时间要带出来（可信度）')
})

check('**未扫描**的条目：三个字段都是 null，而不是空数组', () => {
  // 上游：缺失 = 没扫过，必须能和「扫过但干净」区分开。
  // 空数组会被读成「扫过了、没问题」，那是在给没检查过的插件背书。
  const item = normalizeItem({ name: 'dsh-y', owner: 'b', npm: 'dsh-y', version: '1.0.0' })
  assert.equal(item.capabilities, null, '未扫描 ⇒ capabilities 为 null（不是 []）')
  assert.equal(item.capabilityRedLines, null, '未扫描 ⇒ redLines 为 null（不是 []）')
  assert.equal(item.capabilityCheckedAt, null)
})

check('扫过但**没有红线**：redLines 是空数组（与「未扫描」的 null 不同）', () => {
  const item = normalizeItem({
    name: 'dsh-z', owner: 'c', npm: 'dsh-z', version: '1.0.0',
    capabilities: ['fs-read'],
    capabilityRedLines: [],
    capabilityCheckedAt: '2026-10-17T00:00:00.000Z'
  })
  assert.deepEqual(item.capabilityRedLines, [], '扫过、没红线 ⇒ []（可以显示「未发现红线」）')
  assert.deepEqual(item.capabilities, ['fs-read'])
})

check('screenshots 搬进来并做 host 白名单过滤', () => {
  const item = normalizeItem({
    name: 'dsh-shot', owner: 'd', npm: 'dsh-shot', version: '1.0.0',
    screenshots: [
      'https://raw.githubusercontent.com/o/r/HEAD/a.png',
      'https://user-images.githubusercontent.com/1/2.png',
      'https://camo.githubusercontent.com/abc',
      'https://github.com/o/r/raw/main/b.png',
      'https://evil.example.com/track.gif',      // 必须被丢掉
      'http://raw.githubusercontent.com/o/r/c.png' // 非 https 也要丢
    ]
  })
  assert.deepEqual(item.screenshots, [
    'https://raw.githubusercontent.com/o/r/HEAD/a.png',
    'https://user-images.githubusercontent.com/1/2.png',
    'https://camo.githubusercontent.com/abc',
    'https://github.com/o/r/raw/main/b.png'
  ], '只保留上游白名单里的 GitHub host，且必须 https')
})

check('没有 screenshots 字段 ⇒ null（不是 []，避免渲染出空画廊）', () => {
  assert.equal(normalizeItem({ name: 'dsh-n', owner: 'e', npm: 'dsh-n' }).screenshots, null)
})

check('downloads 的 null 必须保留为 null（不能折成 0）', () => {
  const noNpm = normalizeItem({ name: 'git-only', owner: 'f', url: 'https://github.com/f/git-only' })
  assert.equal(noNpm.downloads, null, '没有 npm 包 ⇒ downloads 是 null，不能是 0')
  const zero = normalizeItem({ name: 'zero', owner: 'g', npm: 'zero', downloads: 0 })
  assert.equal(zero.downloads, 0, '**真的 0** 要保留成 0（与 null 区分）')
})

check('downloadsStart / downloadsEnd / downloadsCheckedAt 带出来（下载量的时间口径）', () => {
  const item = normalizeItem({
    name: 'dsh-d', owner: 'h', npm: 'dsh-d', downloads: 123,
    downloadsStart: '2026-09-18', downloadsEnd: '2026-10-17', downloadsCheckedAt: '2026-10-18T00:00:00.000Z'
  })
  assert.equal(item.downloadsStart, '2026-09-18')
  assert.equal(item.downloadsEnd, '2026-10-17')
  assert.equal(item.downloadsCheckedAt, '2026-10-18T00:00:00.000Z')
})

check('tarball 带出来，且只接受 https 的 .tgz/.tar.gz 形状', () => {
  const ok = normalizeItem({
    name: 'dsh-t', owner: 'i', tarball: 'https://github.com/o/r/releases/download/v1/x-1.0.0.tgz'
  })
  assert.equal(ok.tarball, 'https://github.com/o/r/releases/download/v1/x-1.0.0.tgz')
  // 形状不对的一律丢掉：这是要被塞进安装命令里的字符串。
  for (const bad of ['file:///etc/passwd', 'https://evil.com/x.zip', 'javascript:alert(1)', 'http://github.com/a.tgz']) {
    assert.equal(normalizeItem({ name: 'x', owner: 'j', tarball: bad }).tarball, null, `应拒绝 ${bad}`)
  }
})

// ── 2. 契约不变量：新字段不能破坏既有行为 ────────────────────────────────────
console.log('\n[2] 既有契约不能被新字段破坏')

check('未扫描的条目仍然可以被搜索到（能力字段不参与搜索，也不能让条目消失）', () => {
  const items = [
    normalizeItem({ name: 'alpha', owner: 'a', npm: 'alpha', description: '描述A', capabilities: ['network'] }),
    normalizeItem({ name: 'beta', owner: 'b', npm: 'beta', description: '描述B' }) // 未扫描
  ]
  assert.equal(filterPlugins(items, { query: 'beta' }).length, 1, '未扫描的条目必须仍可搜到')
  assert.equal(filterPlugins(items, { query: 'alpha' }).length, 1)
})

check('排序不受新字段影响（未扫描条目不能因为 null 掉到异常位置）', () => {
  const items = [
    normalizeItem({ name: 'a', owner: 'x', npm: 'a', stars: 10, downloads: null }),
    normalizeItem({ name: 'b', owner: 'y', npm: 'b', stars: 5, downloads: 100 })
  ]
  const byTop = sortPlugins(items, 'top').map((i) => i.name)
  assert.deepEqual(byTop, ['a', 'b'], '按 star 排序不受 downloads 的 null 影响')
  const byDl = sortPlugins(items, 'downloads').map((i) => i.name)
  assert.equal(byDl[0], 'b', '按下载量排序时，有值的应排在 null 前面（不能把 null 当 0 并列）')
})

check('normalizeCatalog 对新字段宽容：缺字段/类型不对都不抛错', () => {
  const snapshot = normalizeCatalog({
    count: 2,
    plugins: [
      { name: 'p1', owner: 'o', capabilityRedLines: 'not-an-array', screenshots: 'nope', downloads: 'abc' },
      { name: 'p2', owner: 'o', tarball: 123, downloadsStart: {} }
    ]
  })
  assert.equal(snapshot.plugins.length, 2)
  assert.equal(snapshot.plugins[0].capabilityRedLines, null, '类型不对 ⇒ null，不能把字符串当数组')
  assert.equal(snapshot.plugins[0].screenshots, null)
  assert.equal(snapshot.plugins[0].downloads, null, '非数字 downloads ⇒ null')
  assert.equal(snapshot.plugins[1].tarball, null)
})

// ── 3. 客户端：安全信息必须真的显示出来 ──────────────────────────────────────
console.log('\n[3] 客户端必须显示红线与「未扫描」，且下载量不能把 null 说成 0')

check('客户端渲染红线（有告警时必须出现在详情里）', () => {
  assert.match(clientSource, /capabilityRedLines/, '客户端必须读 capabilityRedLines')
  assert.match(clientSource, /detail\.redLines|redLine/i, '要有红线的展示位置与文案键')
})

check('客户端区分「未扫描」与「扫过无红线」', () => {
  // 未扫描必须显式写出来（未检出），不能留空白。
  assert.match(clientSource, /notScanned|未扫描|未检出/, '必须有「未扫描/未检出」这一态')
})

check('下载量不再把 null 渲染成 0', () => {
  const at = clientSource.indexOf('meta.downloads')
  assert.ok(at > 0, '找得到 meta.downloads 的用法')
  const uses = [...clientSource.matchAll(/t\("meta\.downloads"[^)]*\)/g)].map((m) => m[0])
  assert.ok(uses.length > 0, '至少要有一处渲染下载量')
  for (const use of uses) {
    assert.doesNotMatch(use, /item\.downloads \|\| 0/, `下载量不能用 || 0 把 null 折成 0：${use}`)
  }
})

check('截图加载失败要降级成链接（图床在国内常连不上，不能留破图）', () => {
  // 实测（2026-10-18）：raw.githubusercontent.com 在本机网络下 HEAD 请求全部 fetch failed
  // （与 GitHub 直连被 reset 同因）。「数据合规」与「用户能看到」是两件事，所以要有一层降级。
  assert.match(clientSource, /onError/, '截图必须有 onError 降级')
  assert.match(clientSource, /detail\.screenshotFailed/, '降级文案要存在（不能静默留空白）')
  const thumbStart = clientSource.indexOf('function ScreenshotThumb(')
  assert.ok(thumbStart > 0, '要有 ScreenshotThumb')
  const thumb = clientSource.slice(thumbStart, thumbStart + 1400)
  assert.match(thumb, /href:\s*props\.src/, '降级后要给出原图链接（用户可自己开代理/换网络）')
  assert.match(thumb, /target:\s*"_blank"/, '新窗口打开，不把市场页面顶掉')
  assert.match(thumb, /rel:\s*"noreferrer"/, '带 noreferrer，不泄露来源')
})

console.log('')
if (failures.length > 0) {
  console.log(`目录新字段适配：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`目录新字段适配：${passed}/${passed + failures.length} 通过`)
