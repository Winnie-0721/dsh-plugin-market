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

console.log('\n[4] 详情是弹出对话框（用户要求，参照会话清理的确认框）')

check('详情不再内嵌在卡片里渲染', () => {
  // 错过两次，别再退回去：
  //   ① 内嵌在卡片里 → 被塞进 232px 网格窄列，截图/红线长句挤成一坨（「展开太丑」）
  //   ② 跨整行独立卡片 → 宽度够了，但它在文档流里，展开会顶动列表、视线要跟着滚
  //   ③ 现在：居中对话框
  const cardStart = clientSource.indexOf('function PluginCard(props)')
  assert.ok(cardStart > 0)
  const cardEnd = clientSource.indexOf('function PluginDetailDialog(', cardStart)
  assert.ok(cardEnd > cardStart, 'PluginCard 后面应当跟着 PluginDetailDialog')
  const cardBody = clientSource.slice(cardStart, cardEnd)
  assert.doesNotMatch(cardBody, /el\(PluginDetails/, 'PluginCard 里**不许**再渲染 PluginDetails')
})

check('对话框组件存在、带 data-detail-for + 关闭键 + 三段结构', () => {
  assert.match(clientSource, /function PluginDetailDialog\(/, '要有详情对话框组件')
  const start = clientSource.indexOf('function PluginDetailDialog(')
  const body = clientSource.slice(start, start + 5200)
  assert.match(body, /"data-detail-for"/, '要能定位它是给哪一条的（e2e/排查都靠它）')
  assert.match(body, /IconClose/, '右上角要有 ×')
  assert.match(body, /dshpm-detailDialogHead/, '要有标题行')
  assert.match(body, /dshpm-detailDialogBody/, '要有可滚动的内容区')
  assert.match(body, /dshpm-detailDialogActions/, '要有底部操作行（对话框形态）')
  assert.match(body, /el\(PluginDetails/, '对话框里渲染 PluginDetails')
  assert.match(body, /role:\s*"dialog"/, '要有 dialog role')
  assert.match(body, /"aria-modal":\s*"true"/)
})

check('对话框是浮层，不参与网格布局', () => {
  // 这是「对话框」与「跨行卡片」的根本区别：不再有 grid-column 那种网格内定位。
  const rule = clientSource.match(/\.dshpm-modalCard\.dshpm-detailDialog\s*\{[^}]*\}/)
  assert.ok(rule, '要有 .dshpm-modalCard.dshpm-detailDialog 规则（双类提高特异性）')
  assert.doesNotMatch(rule[0], /grid-column/, '对话框不参与网格布局')
  // 反向：旧的跨行卡片规则必须已被删除
  assert.equal(/\.dshpm-detailCard\s*\{/.test(clientSource), false, '旧的 .dshpm-detailCard 规则应当已删除')
})

check('内容区自己滚（min-height:0 是 flex 子项能滚的必要条件）', () => {
  const rule = clientSource.match(/\.dshpm-detailDialogBody\s*\{[^}]*\}/)
  assert.ok(rule, '要有 .dshpm-detailDialogBody 规则')
  assert.match(rule[0], /overflow:auto/, '内容区要能滚')
  assert.match(rule[0], /min-height:0/, 'flex 子项不给 min-height:0 就滚不起来（会被内容撑开）')
})

check('对话框渲染在网格**外面**（所以打开/关闭不顶动列表）', () => {
  const gridAt = clientSource.indexOf('className: "dshpm-grid"')
  assert.ok(gridAt > 0)
  const dialogAt = clientSource.indexOf('el(PluginDetailDialog')
  assert.ok(dialogAt > gridAt, '对话框要出现在网格之后/之外')
  // 网格的 map 里不该再有 Fragment 包裹「卡片 + 详情」的老写法
  const gridSeg = clientSource.slice(gridAt, gridAt + 1500)
  assert.doesNotMatch(gridSeg, /el\(PluginDetailDialog/, '对话框不能在网格的 map 里渲染')
})

check('打开/关闭时焦点会归还（键盘用户不丢位置）', () => {
  const start = clientSource.indexOf('function PluginDetailDialog(')
  const body = clientSource.slice(start, start + 5200)
  assert.match(body, /document\.activeElement/, '要记录打开前的焦点')
  assert.match(body, /previous\.focus\(\)/, '关掉后要把焦点还回去')
  assert.match(body, /Escape/, 'Esc 要能关')
  assert.match(body, /"Tab"/, '要有 Tab 焦点陷阱')
})

console.log('')
if (failures.length > 0) {
  console.log(`目录新字段适配：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`目录新字段适配：${passed}/${passed + failures.length} 通过`)
