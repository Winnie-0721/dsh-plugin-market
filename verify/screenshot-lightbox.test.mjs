/**
 * 截图全屏查看（lightbox）的回归（门禁执行）。
 *
 * 用户要求：「点击截图可以全屏看」。
 *
 * 为什么不是给 <img> 挂 onClick：img 不可聚焦、没有 role，键盘用户按不到、
 * 读屏器也不会说「这里可以点」。必须包一层真正的 button。
 *
 * 为什么浮层要挂成兄弟节点（不是详情卡的子节点）：与重启弹窗同一套约定——
 * 任何成为被几何断言盯着的容器子项，都可能撞上「直接子项不得被压扁」（e2e [8]）。
 *
 * 退出路径必须有三条（Esc / 点遮罩 / × 按钮）：全屏覆盖层如果只剩一个出口，
 * 而那个出口又恰好被别的东西挡住，用户就被困住了。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'plugin-market', 'lib', 'client.js'), 'utf8')

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

function grep(name) {
  // 用函数**起点到下一个顶层函数**之间的整段，而不是按花括号配平：
  // 这两种函数体里都有 `t("...")` 这种字符串，配平算法会把 `{` 当代码块（第一版就栽在这，
  // 报「按钮没有可访问名」——其实 aria-label 就在那儿）。对齐到下一个 function 更稳，
  // 且足够覆盖「这个函数里有什么」的断言。
  const start = source.indexOf(name)
  if (start < 0) throw new Error(`找不到：${name}`)
  const next = source.indexOf('\n    function ', start + name.length)
  return source.slice(start, next < 0 ? start + 4000 : next)
}

console.log('\n[1] 缩略图必须是个真正可聚焦的按钮')

check('缩略图包在 <button> 里，而不是给 <img> 挂 onClick', () => {
  const body = grep('function ScreenshotThumb(')
  assert.match(body, /el\("button"/, '必须是 button（img 不可聚焦、键盘用户按不到）')
  assert.match(body, /onClick:\s*function\s*\(\)\s*\{\s*props\.onZoom/, '点击要回调 onZoom')
  // 注意写成 "aria-label"（带引号）：JSX hyperscript 的属性名是带引号的字符串键，
  // 裸写 aria-label 匹配不到（第一版就是这样误报「没有可访问名」）。
  assert.match(body, /"aria-label":/, '按钮要有可访问名（读屏器要说清这里能点）')
  // 反向：不许把 onClick 直接挂到 img 上
  const imgPart = body.slice(body.indexOf('el("img"'))
  assert.doesNotMatch(imgPart.slice(0, 400), /onClick:/, 'img 上不许挂 onClick')
})

check('加载失败时**不给全屏**，直接给原图链接（否则会打开一个空浮层）', () => {
  const body = grep('function ScreenshotThumb(')
  // failed 分支应当是 <a href=原图>
  const failedBranch = body.slice(body.indexOf('if (failed)'), body.indexOf('el("button"'))
  assert.match(failedBranch, /el\("a"/, '失败时是链接')
  assert.match(failedBranch, /href:\s*props\.src/, '指向原图')
  assert.match(failedBranch, /target:\s*"_blank"/)
  assert.match(failedBranch, /rel:\s*"noreferrer"/)
})

console.log('\n[2] 全屏浮层：结构与退出路径')

check('浮层复用 .dshpm-modalLayer（既有层级与定位约定）', () => {
  const body = grep('function ScreenshotLightbox(')
  assert.match(body, /dshpm-modalLayer/, '复用既有覆盖层类名')
  assert.match(body, /role:\s*"dialog"/, '要有 dialog role')
  assert.match(body, /"aria-modal":\s*"true"/)
})

check('浮层背景的选择器**必须比 .dshpm-modalLayer 更特异**（否则深色被盖掉）', () => {
  // 真实 bug（真浏览器实测）：只写 `.dshpm-lightboxLayer { background:深色 }` 时，
  // 它与 `.dshpm-modalLayer` 特异性相同（0,1,0），而后者定义在后面 ⇒ 后者的
  // `background:var(--dsw-alias-bg-overlay,…)` 覆盖深色。量到的背景是 rgb(233,236,242)
  // 浅灰，浅色截图铺上去整屏看着像「一片白」。
  // 这个断言原本只检查「类名出现过」，所以漏掉了它 —— 现在钉特异性。
  const at = source.indexOf('.dshpm-modalLayer.dshpm-lightboxLayer')
  assert.ok(at > 0, '主规则必须写成 `.dshpm-modalLayer.dshpm-lightboxLayer`（0,2,0）')
  const rule = source.slice(at, source.indexOf('}', at) + 1)
  assert.match(rule, /background:\s*rgba\(15,17,21,\.82\)/, '深色遮罩要在这条更高特异性的规则里')
  // 反向：不许再有一条单类的 .dshpm-lightboxLayer { background }（那会被覆盖，等于没写）
  const singleClassBg = /(?:^|\n)\.dshpm-lightboxLayer\s*\{[^}]*background:/.test(source)
  assert.equal(singleClassBg, false, '不能保留一条单类的 background 规则（它会被 .dshpm-modalLayer 覆盖）')
})

check('三条退出路径都在：Esc / 点遮罩 / 关闭按钮', () => {
  const body = grep('function ScreenshotLightbox(')
  assert.match(body, /Escape/, 'Esc 要能关（键盘用户）')
  assert.match(body, /removeEventListener\("keydown"/, '卸载时必须解绑监听（否则泄漏且关掉后还响应）')
  assert.match(body, /event\.target === event\.currentTarget/, '点遮罩关闭：只认遮罩自身，点图不关')
  // "data-action" 同理是带引号的字符串键。
  assert.match(body, /"data-action":\s*"close"/, '有显式的关闭按钮')
})

check('浮层挂在详情对话框之后，是它的兄弟节点', () => {
  // v1.3.0：详情从「跨行卡片」改成了弹出对话框（PluginDetailDialog），这条断言随之改名字，
  // 但守的东西没变：全屏浮层必须是**兄弟节点**、且出现在对话框内容之后 ——
  // 不能塞进任何被几何断言盯着的容器里（与重启弹窗同一套约定）。
  const body = grep('function PluginDetailDialog(')
  assert.match(body, /el\(React\.Fragment,\s*null/, '对话框外层要包 Fragment')
  const fragAt = body.indexOf('el(React.Fragment')
  const layerAt = body.indexOf('el(ScreenshotLightbox')
  assert.ok(layerAt > fragAt, '浮层在 Fragment 里、与对话框并列')
  // 对话框卡片必须在浮层之前闭合：即 ScreenshotLightbox 不出现在 modalCard 的 children 里
  const cardAt = body.indexOf('dshpm-detailDialog",')
  const detailsAt = body.indexOf('el(PluginDetails', cardAt)
  assert.ok(detailsAt > cardAt && layerAt > detailsAt,
    '浮层要出现在对话框内容之后（作为兄弟），不能在对话框内部')
})

console.log('\n[3] 图片显示与可访问性')

check('全屏图用 object-fit:contain 且不超视口（不裁切、不失真）', () => {
  const rule = source.match(/\.dshpm-lightboxImg\s*\{[^}]*\}/)
  assert.ok(rule, '要有 .dshpm-lightboxImg 规则')
  assert.match(rule[0], /object-fit:contain/, 'contain 而不是 cover：截图边缘常有关键信息')
  assert.match(rule[0], /max-height:/, '不能超出视口高度')
  assert.match(rule[0], /max-width:/, '不能超出视口宽度')
})

check('深色遮罩上的链接与关闭键用浅色（否则在 .82 黑底上看不见）', () => {
  assert.match(source, /\.dshpm-lightboxLayer \.dshpm-link\s*\{[^}]*color:/,
    '浮层里的链接要单独指定浅色')
  assert.match(source, /\.dshpm-lightboxLayer \.dshpm-iconBtn\s*\{[^}]*color:/,
    '浮层里的关闭键要单独指定浅色')
  // 反向：不能为了这个去改**全局** .dshpm-link 的颜色（详情卡里那个还在白底上）。
  // 正则必须锚行首：`/\.dshpm-link\s*\{/` 会先命中 `.dshpm-lightboxLayer .dshpm-link {`
  // ——那是浮层里那条（本来就是白色），第一版就把它当成「全局规则被改白」误报了。
  const globalLink = source.match(/^\.dshpm-link\s*\{[^}]*\}/m)
  assert.ok(globalLink, '要有全局 .dshpm-link 规则（行首）')
  assert.match(globalLink[0], /--dsw-alias-brand-primary/, '全局链接色必须仍走品牌色')
  assert.doesNotMatch(globalLink[0], /--dsw-alias-bg-layer-1/, '全局链接色不能被改成白色')
})

check('文案键齐全（中英各一条，否则僵尸文案检查会红）', () => {
  for (const key of ['detail.screenshotZoom', 'detail.screenshotOpen']) {
    const hits = [...source.matchAll(new RegExp(`"${key.replace(/\./g, '\\.')}":`, 'g'))].length
    assert.equal(hits, 2, `${key} 应当中英各一条，实测 ${hits}`)
  }
})

check('浮层的图片也带 referrerPolicy=no-referrer（不把当前地址带给图床）', () => {
  const body = grep('function ScreenshotLightbox(')
  assert.match(body, /referrerPolicy:\s*"no-referrer"/)
})

console.log('\n[4] STYLES 模板里不许出现裸反引号（本轮反复栽的坑）')

check('STYLES 模板内部没有多余的裸反引号', () => {
  // 真实事故（本轮发生两次）：CSS 在 `var STYLES = \`...\`` 模板字符串里，
  // 注释里写一个反引号就会**提前结束字符串**，后面的 CSS 被当成 JS 解析。
  // 更难受的是：有时它恰好是合法语法 —— `node --check` 通过、门禁全绿，
  // 但浏览器里整个客户端起不来（实测报 "detailDialogBody is not defined"，
  // 页面显示 "Failed to load plugins"，面板根本不挂载）。
  // 所以这条检查必须留在门禁里，不能只靠人工记住。
  const declAt = source.indexOf('var STYLES =')
  assert.ok(declAt > 0, '要能找到 var STYLES =')
  const open = source.indexOf('`', declAt)
  let close = -1
  for (let i = open + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue }
    if (source[i] === '`') { close = i; break }
  }
  assert.ok(close > open, '要能找到 STYLES 的收尾反引号')
  const body = source.slice(open + 1, close)
  const stray = []
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes('`')) stray.push({ lineNo: i + 1, text: lines[i].trim().slice(0, 100) })
  }
  assert.deepEqual(stray, [], '模板内部出现裸反引号会截断字符串（把 ` 换成普通文字）')
})

check('STYLES 模板之后没有漏出来的 CSS 行', () => {
  // 截断的另一种表现：CSS 漏到字符串外面，变成 JS 里的裸语句。
  const declAt = source.indexOf('var STYLES =')
  const open = source.indexOf('`', declAt)
  let close = -1
  for (let i = open + 1; i < source.length; i += 1) {
    if (source[i] === '\\') { i += 1; continue }
    if (source[i] === '`') { close = i; break }
  }
  const after = source.slice(close + 1)
  const leaked = after.split('\n').filter((l) => /^\s*\.dshpm-[A-Za-z-]+\s*\{/.test(l))
  assert.deepEqual(leaked, [], '模板之后出现 CSS 行说明模板被截断了')
})

console.log('')
if (failures.length > 0) {
  console.log(`截图全屏查看：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`截图全屏查看：${passed}/${passed + failures.length} 通过`)
