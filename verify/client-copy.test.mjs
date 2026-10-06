/**
 * 客户端文案与动效的不变量测试（离线、只读源码）。
 *
 * 这里防的是三类"改了就悄悄坏"的问题：
 *  1. zh / en 键集漂移——只补中文，英文用户看到键名或空白；
 *  2. 代码里 t("x.y") 但词典里没有——界面直接显示原始键；
 *  3. 动效写法退化——最典型的是升入动画用了 forwards/both，把 transform 钉死在末帧，
 *     于是卡片 hover 抬升、按钮按下缩放全部失效（本仓库真的这么错过一次）；
 *     以及在基础样式里写 opacity:0，导致关掉动效（prefers-reduced-motion）后内容不可见。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(process.argv[2] ?? 'plugin-market/lib/client.js', 'utf8')
let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

// ── 取词典：两段语言块按 "      zh: {" / "      en: {" 定位 ───────────
const zhAt = source.indexOf('      zh: {')
const enAt = source.indexOf('      en: {')
assert.ok(zhAt > 0 && enAt > zhAt, '应当能找到 zh / en 两段词典')
const zhBlock = source.slice(zhAt, enAt)
const enBlock = source.slice(enAt, source.indexOf('    };', enAt))

const KEYS = /"([A-Za-z][A-Za-z0-9._-]*)":/g
const keysOf = (block) => new Set([...block.matchAll(KEYS)].map((m) => m[1]))
const zhKeys = keysOf(zhBlock)
const enKeys = keysOf(enBlock)

// 代码里实际用到的键：字面量 + 前缀拼接（t("err." + code)）
// 前缀要用 (?<![A-Za-z0-9_$.]) 锚住 t 本身，否则 inject("x") / get("x") 里末尾那个 t( 会被误当成 t()。
const usedLiteral = new Set(
  [...source.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*"([A-Za-z][A-Za-z0-9._-]*)"/g)]
    .map((m) => m[1])
    // 以点结尾的是前缀（t("err." + code)），由下面的动态前缀规则负责，不是完整键。
    .filter((key) => !key.endsWith('.')),
)
const dynamicPrefixes = [...source.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*"([A-Za-z][A-Za-z0-9._-]*\.)"\s*\+/g)].map((m) => m[1])
// 键名由变量拼出来的命名空间（t() 的实参不是字面量，静态扫描看不到）：
//   err.     ← "err." + error.code
//   fiber.   ← formatPhaseLabel 里按 phase 拼
//   readonlyReason. ← "readonlyReason." + bundle.readOnlyReason
//   capability.     ← capabilityLabel 里按 token 拼
//   sort.    ← SORTS[].key 交给 t(key)
const VARIABLE_NAMESPACES = ['err.', 'fiber.', 'readonlyReason.', 'capability.', 'sort.']
// 词典里本身不是给 t() 用的（纯数据键），显式列出而不是放宽规则
const NON_T_KEYS = new Set([])

console.log('\n[1] 词典完整性')
check('zh 与 en 的键集完全一致（数量与内容都一致）', () => {
  const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k))
  const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k))
  assert.deepEqual(onlyZh, [], `只有中文的键：${onlyZh.join(', ')}`)
  assert.deepEqual(onlyEn, [], `只有英文的键：${onlyEn.join(', ')}`)
  assert.equal(zhKeys.size, enKeys.size)
})
check('代码里出现的每个 t("字面量键") 都在词典里（两种语言都要有）', () => {
  const missing = [...usedLiteral].filter((key) => !zhKeys.has(key) || !enKeys.has(key))
  assert.deepEqual(missing, [], `代码用了但词典缺失：${missing.join(', ')}`)
})
check('词典里除动态前缀外的键都真的被用到（没有僵尸文案）', () => {
  const dynamic = (key) => dynamicPrefixes.some((prefix) => key.startsWith(prefix)) || VARIABLE_NAMESPACES.some((prefix) => key.startsWith(prefix))
  const unused = [...zhKeys].filter((key) => !usedLiteral.has(key) && !dynamic(key) && !NON_T_KEYS.has(key))
  assert.deepEqual(unused, [], `没有引用的文案键：${unused.join(', ')}`)
})
check('新增的两组文案职责齐全（自更新 / 可更新列表 / 三个错误码）', () => {
  for (const key of [
    'action.checkSelf', 'action.checkingSelf', 'action.updateSelf', 'action.updatingSelf',
    'action.recheckSelf', 'action.checkUpdates', 'action.updateAllCount', 'action.updatingAll',
    'updates.title', 'updates.entryBadge', 'updates.hint', 'updates.batchProgress', 'updates.empty.title', 'updates.empty.body',
    'notice.selfFound', 'notice.selfCurrent', 'notice.selfUpdated', 'notice.updatesFound', 'notice.updatesNone',
    'notice.updateAllStart', 'notice.updateAllDone', 'notice.updateAllNone', 'tab.updates',
    'err.self-update-unavailable.title', 'err.self-update-integrity.title', 'err.self-update-download.title',
    'err.file-locked.title', 'err.file-locked.why', 'err.file-locked.next', 'err.file-locked.row',
  ]) {
    assert.ok(zhKeys.has(key), `缺少文案键 ${key}`)
  }
  // 「已是最新」与裸「一键更新」随按钮状态机改版删除：一个有歧义（插件明明有更新），一个只剩带计数的版本。
  assert.equal(zhKeys.has('action.selfCurrent'), false, '「已是最新」文案应已删除')
  assert.equal(zhKeys.has('action.updateAll'), false, '裸「一键更新」应已删除（只剩带计数的 updateAllCount）')
})
check('更新失败的「文件被占用」类错误有可操作回执（照 dsh-market 的 windows-file-locked 分类）', () => {
  // 1) 能识别 EPERM/EACCES/拒绝访问（诊断或消息任一命中）
  assert.match(source, /function fileLockedDetail\(error\)/, '要有占用识别函数')
  assert.match(source, /EPERM\|EACCES\|EBUSY\|operation not permitted\|Access is denied/, '识别模式要覆盖 pnpm 的 EPERM 与 Windows 拒绝访问')
  // 2) 三处渲染都接上：错误气泡三段式、可更新行内短句、已安装行错误
  assert.match(source, /locked \? "err\.file-locked"/, 'errorCopy 命中时要切到 file-locked 文案')
  assert.match(source, /fileLockedDetail\(error\) \? t\("err\.file-locked\.row"\)/, '可更新行内失败要显示占用短句')
  assert.match(source, /fileLockedDetail\(bundle\.error\)/, '已安装行错误也要走占用识别')
  // 3) 详情行要露出 diagnostic 原文（此前 EPERM 从未被渲染）
  assert.match(source, /message: locked \|\| message/, '命中时详情行用诊断原文')
})
check('回执文案精简（用户反馈：toast 尽量短）', () => {
  assert.match(zhBlock, /"notice\.refreshOk": "已刷新 \{count\} 个插件"/, '刷新回执只留计数')
  assert.match(zhBlock, /"notice\.updatesFound": "\{count\} 个插件有新版本。"/, '发现回执一句话')
  assert.match(zhBlock, /"notice\.updatesNone": "全部都是最新版本。"/, '无更新回执一句话')
  assert.match(zhBlock, /"notice\.updateAllDone": "更新完成：成功 \{ok\}、失败 \{fail\}。"/, '批量汇总去后缀')
  // 英文侧同步精简，且不残留旧长句
  assert.equal(enBlock.includes('Catalog refreshed: {count} plugins'), false, 'en 旧刷新长句应已删除')
  assert.equal(enBlock.includes('Update all finished'), false, 'en 旧汇总长句应已删除')
})
check('「检查更新」单按钮状态机：检查过才给一键更新/重新检查，页脚旧按钮已合并删除', () => {
  assert.match(zhBlock, /"action\.checkUpdates": "检查更新"/, '初始态文案是「检查更新」')
  assert.match(source, /var checked = props\.checkPhase === "checked";/, '三态里的 checked 来自页面状态')
  assert.match(source, /onClick: canUpdateAll \? props\.onUpdateAll : props\.onCheckUpdates/, '同一颗按钮按状态切换点击目标')
  assert.match(source, /checked \? t\("action\.recheckSelf"\) : t\("action\.checkUpdates"\)/, '检查过没更新 → 重新检查；没检查过 → 检查更新')
  assert.match(source, /function checkUpdates\(\)/, '要有检查入口函数')
  assert.match(source, /onCheckUpdates: checkUpdates/, '按钮要接上检查入口')
  assert.match(source, /setCheckPhase\("checked"\)/, '批量跑完也要进入已检查态')
  // 页脚那颗独立的「重新检查」合并进上面这颗按钮：UpdatesPane 里不该再有 drawerFoot。
  const pane = source.slice(source.indexOf('function UpdatesPane'), source.indexOf('function MarketPage'))
  assert.equal(pane.includes('dshpm-drawerFoot'), false, '页脚按钮已合并删除')
  // 两颗按钮风格统一（用户要求：旁边那颗也用 primary）
  assert.match(pane, /className: "dshpm-btn dshpm-btn--primary" \+ \(self\.available/, '插件市场更新按钮与左按钮同为 primary')
})
check('restart-required 计为成功：装好了待重启不是失败（用户报的「成功 0、失败 2」）', () => {
  assert.match(source, /function noticeFromResult/, '结果映射函数')
  assert.match(source, /kind: "warn", applied: true/, 'restart-required：警示气泡但 applied=true')
  assert.match(source, /kind: "info", applied: false/, 'cancelled / 无变更不计成功')
  assert.match(source, /report\(\{ ok: outcome\.applied === true/, '行内结果按 applied 计，不按气泡级别')
  assert.match(source, /if \(outcome && outcome\.ok\) ok\+\+; else fail\+\+;/, '批量汇总按 outcome.ok（即 applied）计数')
})
check('重启助手：横幅点亮 → POST /restart → 先见过死才自动刷新（不假装重启完成）', () => {
  // 端点与错误码
  assert.match(source, /requestJSON\("\/restart", \{ method: "POST"/, '客户端要真的会调 /restart')
  assert.match(source, /"restart-failed": true/, 'restart-failed 要进错误码表（errorCopy 才有三段式文案）')
  // 点亮：安装/更新/卸载/开关/自更新回来的 restart-required、requiresRestart 都要接上
  const lightUps = [...source.matchAll(/noteRestartFrom\(payload\)/g)]
  assert.ok(lightUps.length >= 4, `各写操作都要点亮重启横幅，当前只有 ${lightUps.length} 处`)
  assert.match(source, /payload\.application === "restart-required" \|\| payload\.requiresRestart === true/, '点亮条件覆盖两种写法')
  // 探活回路：宿主死掉期间先记下「见过死」，之后 /status 恢复才刷新页面
  assert.match(source, /restartSawDownRef\.current = true/, '宿主死掉期间要记下「见过死」')
  assert.match(source, /if \(restartSawDownRef\.current\)/, '刷新必须以「见过死」为前提')
  assert.match(source, /window\.location\.reload\(\)/, '宿主回来后要自动恢复页面')
  assert.match(source, /notice\.restartTimeout/, '等不到宿主要如实提示，不能一直转圈')
  // 幂等与可定位性
  assert.match(source, /if \(restart && restart\.phase === "restarting"\) return;/, '重启中要挡掉重复点击')
  assert.match(source, /dshpm-restartBtn/, '重启按钮要有稳定类名（e2e 用它定位）')
  // 文案键齐全（zh/en 键集一致性由上面的通用检查兜底，这里点名关键键）
  for (const key of [
    'action.restart', 'action.restarting', 'restart.bannerTitle', 'restart.bannerBody',
    'restart.title', 'notice.restartQueued', 'notice.restartTimeout',
    'err.restart-failed.title', 'err.restart-failed.why', 'err.restart-failed.next',
  ]) {
    assert.ok(zhKeys.has(key), `缺少文案键 ${key}`)
    assert.ok(enKeys.has(key), `英文缺少文案键 ${key}`)
  }
})

// ── 取样式表：模板字面量 var STYLES = `...` ─────────────────────────
const TICK = String.fromCharCode(96)
const stylesAt = source.indexOf(`var STYLES = ${TICK}`)
assert.ok(stylesAt > 0, '应当能找到 STYLES 模板字面量')
const stylesEnd = source.indexOf(TICK + ';', stylesAt)
assert.ok(stylesEnd > stylesAt, 'STYLES 模板字面量应当有结束反引号')
const css = source.slice(stylesAt + (`var STYLES = ${TICK}`).length, stylesEnd)

console.log('\n[2] 动效写法（防"动画把 hover 钉死"与"关掉动画后不可见"）')
check('样式表里有完整的 @keyframes 定义，且被引用的都在', () => {
  const defined = new Set([...css.matchAll(/@keyframes\s+([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]))
  const referenced = new Set([...css.matchAll(/animation:\s*([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]).filter((name) => !name.startsWith('none')))
  const missing = [...referenced].filter((name) => !defined.has(name))
  assert.deepEqual(missing, [], `被引用但没定义的动画：${missing.join(', ')}`)
  for (const required of ['dshpm-rise', 'dshpm-fade', 'dshpm-expand', 'dshpm-slidein', 'dshpm-pop', 'dshpm-breathe', 'dshpm-glow', 'dshpm-slide', 'dshpm-countdown', 'dshpm-shimmer', 'dshpm-spin']) {
    assert.ok(defined.has(required), `缺少关键帧 ${required}`)
  }
})
check('升入类动画一律用 backwards：用 forwards/both 会把 transform 钉在末帧', () => {
  const offenders = [...css.matchAll(/animation:([^;{}]*);/g)]
    .map((m) => m[1])
    .filter((decl) => /\b(forwards|both)\b/.test(decl))
    // 允许的唯一例外：提示条倒计时线（纯装饰，没有 hover 位移）
    .filter((decl) => !/dshpm-countdown/.test(decl))
  assert.deepEqual(offenders, [], `这些动画用了 forwards/both：${offenders.join(' | ')}`)
})
check('带 hover 位移的类没有被 forwards/both 动画占住 transform', () => {
  for (const selector of ['.dshpm-card', '.dshpm-row', '.dshpm-updateRow', '.dshpm-btn', '.dshpm-entry']) {
    const rules = [...css.matchAll(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1])
    for (const body of rules) {
      if (!/animation:/.test(body)) continue
      assert.ok(!/\b(forwards|both)\b/.test(body), `${selector} 的动画用了 forwards/both，会钉死 transform`)
    }
  }
})
check('基础样式里没有给会被动画的元素写 opacity:0', () => {
  // 关掉动效时元素必须直接可见：只允许在 @keyframes 的 from 里出现 opacity:0。
  const withoutKeyframes = css.replace(/@keyframes[^}]*\}[^}]*\}/g, '')
  const offenders = [...withoutKeyframes.matchAll(/([^{}]+)\{([^}]*opacity\s*:\s*0[^}]*)\}/g)]
    .map((m) => m[1].trim())
    .filter((selector) => !/prefers-reduced-motion|data-open="false"|dshpm-skeleton/.test(selector))
  assert.deepEqual(offenders, [], `这些规则在基础态把元素设成不可见：${offenders.join(' | ')}`)
})
check('prefers-reduced-motion 里同时关掉 animation 与 transition', () => {
  const at = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(at > 0, '必须有 prefers-reduced-motion 分支')
  const block = css.slice(at, css.indexOf('}', css.indexOf('{', at)) + 1)
  assert.match(block, /animation\s*:\s*none/, 'reduced-motion 下必须关掉动画')
  assert.match(block, /transition\s*:\s*none/, 'reduced-motion 下必须关掉过渡')
  assert.match(block, /dshpm-root/, 'reduced-motion 分支要覆盖面板内所有元素')
})

console.log('\n[3] 新增 UI 的标记与位置')
check('样式表定义了新增组件：面板、角标、倒计时线', () => {
  for (const selector of ['.dshpm-updatesPanel', '.dshpm-entryBadge', '.dshpm-count', '.dshpm-noticeTimer', '.dshpm-updateRow', '.dshpm-selfNote']) {
    assert.ok(css.includes(selector), `样式表缺少 ${selector}`)
  }
  // 顶部黑条进度条已删（截图反馈：标题上方那条黑杠不要了）；进度改由按钮 spinner + aria-busy + toast 承担。
  assert.equal(css.includes('.dshpm-progress'), false, '顶部进度条样式应已删除')
  assert.equal(source.includes('dshpm-progress'), false, '顶部进度条节点应已删除')
})
check('回执是悬浮气泡（Android toast）：fixed + 贴底居中 + 不占文档流', () => {
  const rules = css.match(/\.dshpm-notice\s*\{[^}]*\}/g) || []
  const base = rules.find((rule) => /position:/.test(rule))
  assert.ok(base, '应当有一条带 position 的 .dshpm-notice 基础规则')
  assert.match(base, /position:\s*fixed/, '气泡必须是 fixed 定位（不占文档流，出现时不推挤布局）')
  assert.match(base, /bottom:\s*\d+px/, '气泡要贴视口底部')
  assert.match(base, /margin:\s*0 auto/, '气泡要水平居中')
  assert.match(base, /max-width:/, '气泡要有最大宽度，长文案换行而不是撑满整屏')
  const relative = rules.filter((rule) => /position:\s*relative/.test(rule))
  assert.deepEqual(relative, [], '后面的规则不得写 position:relative 把 fixed 盖回文档流')
  assert.match(css, /@keyframes dshpm-toastin/, '气泡要有自己的入场动画 keyframes')
})
check('头部只留「刷新目录」，两个更新类按钮搬进可更新页（用户要求删掉右上角那两个）', () => {
  // 被删掉的是头部的「更新插件」与「检查市场更新」：前者被第三个页签取代，后者搬进可更新页。
  assert.equal(source.includes('dshpm-btn--updates'), false, '头部的「更新插件」按钮应已删除')
  assert.match(source, /refreshing \? t\("action\.refreshing"\) : t\("action\.refresh"\)/, '「刷新目录」必须还在头部')
  // 用户要求：刷新目录只在「发现」页签出现——已安装/可更新页没有目录列表。
  assert.match(source, /tab === "discover" \? el\("button"/, '刷新目录按钮要按 tab 条件渲染')
  assert.match(source, /刷新目录.*只在「发现」页签出现|只在「发现」页签出现/, '要有注释说明为何只在发现页')
  assert.equal(source.includes('t("action.updates")'), false, 'action.updates 文案随按钮一起删除（否则就是僵尸文案）')
  const actionsAt = source.indexOf('className: "dshpm-updatesActions"')
  assert.ok(actionsAt > 0, '可更新页页头要有按钮区')
  assert.ok(actionsAt < source.indexOf('t("action.updateAllCount"'), '一键更新按钮渲染在按钮区里')
  assert.match(source, /onUpdateAll: updateAll/, '一键更新按钮要接到 updateAll')
  assert.match(source, /self\.available \? self\.onApply : self\.onCheck/, '检查市场更新要接到自更新状态机')
})
check('已安装列表两个页签都会加载（角标与列表都依赖它）', () => {
  const at = source.indexOf('React.useEffect(function () {')
  const block = source.slice(source.indexOf('两个页签都要拉') - 200, source.indexOf('两个页签都要拉') + 400)
  assert.ok(block.includes('loadInstalled()'), '应当无条件加载已安装列表')
  assert.ok(!/if \(tab !== "installed"\) return undefined;\s*\n\s*loadInstalled/.test(source), '不应再按页签条件加载')
  assert.ok(at > 0)
})
check('写操作只重读已安装列表：/status 挂载时读一次、目录只在刷新目录时重抓（性能）', () => {
  // /status 只回 plugin.version + manager.available，写操作不改变它 → 不该挂在任何 tick 上。
  assert.match(source, /React\.useEffect\(function \(\) \{\s*\n\s*loadStatus\(\);\s*\n\s*\}, \[\]\);/,
    'loadStatus 必须只在挂载时读一次（依赖数组为空）')
  assert.equal(source.includes('loadStatus();\n      }, [tick]'), false, 'loadStatus 不该再挂在写操作的 tick 上')
  // 目录重抓只由「刷新目录」触发（bumpCatalog），不被写操作连带。
  assert.match(source, /function bumpCatalog\(\)/, '要有独立的目录重读入口')
  assert.match(source, /\[tab, query, category, sort, page, catalogTick\]/, '目录 effect 依赖 catalogTick 而非写操作 tick')
  assert.match(source, /\[installedTick\]/, '已安装 effect 依赖 installedTick')
  // 刷新目录成功/失败都要同时重抓目录 + 重读已安装（updateAvailable 依赖目录 join）。
  assert.match(source, /bumpCatalog\(\);\s*\n\s*bumpTick\(\);/, '刷新目录后要同时重抓目录与重读已安装')
  // 写操作函数仍只调 bumpTick（只重读已安装），不碰目录。
  assert.equal(/\[tick\]/.test(source), false, '不应再存在共享的 [tick] 依赖')
})
check('自更新按钮四态状态机：插件市场更新/正在更新…/更新成功/再次检查', () => {
  assert.match(source, /selfPhase === "checking" \? t\("action\.checkingSelf"\)/)
  assert.match(source, /selfPhase === "installing" \? t\("action\.updatingSelf"\)/)
  assert.match(source, /selfPhase === "done" \? t\("action\.selfDone"\)/)
  assert.match(source, /selfAvailable \? t\("action\.updateSelf"/)
  // 检查完没有新版本 →「再次检查」：左边那颗是插件的「重新检查」，右边这颗是市场的，
  // 两颗黑按钮写一样的字分不清（用户点名要文字区分）。
  assert.match(source, /selfPhase === "ready" \? t\("action\.recheckSelfOnly"\)/)
  assert.match(zhBlock, /"action\.recheckSelfOnly": "再次检查"/, '右键就绪态文案与左键「重新检查」不同')
  assert.match(zhBlock, /"action\.checkingSelf": "正在更新…"/, '点击后显示「正在更新…」')
  assert.match(zhBlock, /"action\.selfDone": "更新成功"/, '装完显示「更新成功」')
  assert.match(zhBlock, /"action\.checkSelf": "插件市场更新"/, '按钮已按用户要求改名')
  assert.equal(zhBlock.includes('"action.selfCurrent"'), false, '「已是最新」挨着插件更新只会误导')
  // 用户报「第一次进入这个界面怎么会是再次检查」：启动时的自动检查没更新时必须留在初始态，
  // 「再次检查」只属于用户手动点过的那次（runSelfCheck 的 manual 区分）。
  assert.match(source,
    /manual === true \|\| \(info && info\.updateAvailable === true\) \? "ready" : "idle"/,
    '自动检查无更新回 idle（首次进入仍是「插件市场更新」），手动查过或有新版本才 ready')
  const selfCheckAt = source.indexOf('function checkSelfUpdate')
  const applySelfAt = source.indexOf('function applySelfUpdate')
  assert.ok(selfCheckAt > 0 && applySelfAt > selfCheckAt, 'checkSelfUpdate 仍在 applySelfUpdate 之前')
  assert.match(source.slice(selfCheckAt, applySelfAt), /\}, true\);/,
    '页面按钮那次必须传 manual=true（查完没更新才落「再次检查」）')
})
check('入口与反馈：页签是入口，两个新按钮各带忙碌态 + 回执；自动检查规则齐全', () => {
  // 入口：头部按钮删掉后，第三个页签是唯一入口，点它仍要给回执。
  assert.match(source, /function goUpdates\(\)/, '打开可更新页签的入口函数')
  assert.match(source, /onClick: goUpdates/, '第三个页签要接到这个入口')
  assert.match(source, /loadInstalled\(\{ announce: true \}\)/, '打开页签要触发带回执的重读')
  assert.match(source, /t\("notice\.updatesFound"/, '有更新要给回执')
  assert.match(source, /t\("notice\.updatesNone"/, '没有更新也要给回执')
  // 新按钮 1：检查市场更新（原头部按钮搬来）
  assert.match(source, /"aria-busy": self\.busy \? "true" : "false"/, '检查市场更新要暴露 aria-busy')
  assert.match(source, /runSelfCheck\(function \(error, info\)/, '检查结果要回到回执气泡')
  // 新按钮 2：合并后的「检查更新 / 一键更新 / 重新检查」单按钮
  assert.match(source, /"aria-busy": \(batchRunning \|\| checking\) \? "true" : "false"/, '合并按钮（检查与批量）要暴露 aria-busy')
  assert.match(source, /t\("notice\.updateAllStart"/, '一键更新开始要有回执')
  assert.match(source, /t\("notice\.updateAllDone"/, '一键更新结束要有汇总回执')
  assert.match(source, /outcome && outcome\.pending/, '卡在「要批准构建脚本」时必须暂停批量')
  // 自动检查规则（用户定的）：启动查一次本体更新，之后每小时查一次插件更新
  assert.match(source, /PLUGIN_CHECK_INTERVAL_MS = 60 \* 60 \* 1000/, '每小时检查一次插件更新')
  assert.match(source, /startUpdateScheduler\(\);/, 'apply 里要启动调度')
  assert.match(source, /if \(schedulerStarted\) return;/, '调度必须有守卫，不能重复建定时器')
  assert.match(source, /runSelfCheck\(\);/, '启动时检查一次本体更新')
})
check('回执气泡有退场：先 data-open=false 沉下去，200ms 后才卸载', () => {
  assert.match(source, /var NOTICE_CLOSE_MS = 200;/, '退场时长常量')
  assert.match(css, /\.dshpm-notice\[data-open="false"\][^}]*opacity:0/, '退场态规则')
  assert.match(source, /dismissNotice\(\)/, '关闭必须走 dismissNotice，而不是直接 setNotice(null)')
  assert.match(source, /open: noticeClosing \? false : true/, '渲染时把退场态传给气泡')
  assert.match(css, /backdrop-filter:blur/, '气泡加了毛玻璃质感')
})
check('第三个页签「可更新」：排在已安装右边、带计数角标、切过去渲染整页内容', () => {
  // 页签栏与页面都由注册表生成（MARKET_TABS / MARKET_PANES）：顺序 = 数组顺序，
  // 加页面只改这两处。所以这里钉的是「注册表里的顺序」，而不是三段硬编码的 JSX。
  const tabsAt = source.indexOf('var MARKET_TABS = [')
  const panesAt = source.indexOf('var MARKET_PANES = {')
  assert.ok(tabsAt > 0, '必须有页签注册表 MARKET_TABS（新增页面只改这里）')
  assert.ok(panesAt > tabsAt, '必须有页面注册表 MARKET_PANES，且排在页签注册表之后')
  const tabsBlock = source.slice(tabsAt, panesAt)
  const discoverAt = tabsBlock.indexOf('t("tab.discover")')
  const installedAt = tabsBlock.indexOf('t("tab.installed")')
  const updatesAt = tabsBlock.indexOf('t("tab.updates")')
  assert.ok(discoverAt > 0 && installedAt > discoverAt, '页签顺序：发现 → 已安装')
  assert.ok(updatesAt > installedAt, '页签顺序：已安装 → 可更新（用户圈的位置）')
  assert.match(tabsBlock, /id: "updates", label: t\("tab\.updates"\), badge: function \(\) \{ return updateCount; \}, onClick: goUpdates \}/,
    '「可更新」的角标计数与入口（goUpdates）都从注册表里声明')
  // 页面渲染也查表：UpdatesPane 在注册表之后、且由 MARKET_PANES 里的函数渲染。
  assert.match(source, /el\(UpdatesPane/, '第三个页签要渲染自己的页面组件')
  assert.ok(source.indexOf('el(UpdatesPane') > panesAt, '页面组件由 MARKET_PANES 渲染，不在正文里写死分支')
  assert.equal(source.includes('tab === "installed"'), false, '页面切换不许再用嵌套三元写死（加页面会越写越乱）')
  for (const id of ['discover', 'installed', 'updates']) {
    assert.match(source, new RegExp(`\\n\\s+${id}: function \\(\\) \\{`), `MARKET_PANES 要有 ${id} 的渲染函数`)
  }
  // 抽屉必须退场：页签取代了它，不能两套并存
  assert.equal(source.includes('UpdatesDrawer'), false, '抽屉组件应已移除（由页签取代）')
  assert.equal(source.includes('scrollIntoView'), false, '不再需要滚动定位：内容现在整页出现')
  assert.match(source, /entryCount > 0 \? el\("span", \{ className: "dshpm-count" \}/, '页签要带可更新计数角标')
})
check('三个页签页面统一布局：共用一个外壳 + 固定页签高度（用户报「高度不对齐」）', () => {
  // 用户截图：三个页签各自的页面内容起点/高度不一样，切一下就跳。修法是给页面加统一外壳，
  // 并把页签按钮的高度固定（有没有角标都一样高）——这样后续新增页面天然对齐。
  assert.match(css, /\.dshpm-root > \.dshpm-page\s*\{[^}]*display:flex[^}]*flex-direction:column[^}]*gap:12px/,
    '页面外壳 .dshpm-page 要统一纵向间距')
  assert.match(css, /\.dshpm-root > \.dshpm-page\s*\{[^}]*flex:1 0 auto/, '页面外壳要撑满剩余高度（内容短时三页等高），且不参与收缩')
  assert.match(css, /\.dshpm-tab\s*\{[^}]*min-height:\d+px/, '页签按钮高度要固定，加不加角标都一样高')
  assert.match(source, /el\("div", \{ className: "dshpm-page", "data-page": tab, role: "tabpanel" \}, activePane\(\)\)/,
    '渲染处必须把当前页套进统一外壳（新增页面自动继承）')
  // 页面级节距只有一个单位：外壳、根容器、两个页面内容容器的 gap 都是 12px。
  assert.match(css, /\.dshpm-root \{[^}]*gap:12px/, '面板根节距 12px')
  assert.match(css, /\.dshpm-installed \{ display:flex; flex-direction:column; gap:12px; \}/, '已安装/发现页内容容器节距 12px')
  assert.match(css, /\.dshpm-updatesPanel \{[^}]*gap:12px/, '可更新页内容容器节距 12px')
})
check('搜索框只有一个清除键：样式表关掉 Chromium 原生的 ::-webkit-search-cancel-button', () => {
  // 用户截图（2026-10-06）：搜索框聚焦且有值时出现两个清除键——我们 .dshpm-search 里那颗，
  // 加上 Chromium 给 input[type=search] 画的原生 ✕（按 accent-color 上色，所以是蓝的）。
  // 原生那颗不在 DOM 里，数不出来，所以先在样式表层面钉死；真机行为由 market-ui.e2e.mjs 的
  // [3a]（聚焦输入 + 截图 market-search-clear.png）与本条一起兜底。
  const rules = (css.match(/\.dshpm-input::-webkit-search-cancel-button\s*\{[^}]*\}/g) || []).join('\n')
  assert.ok(rules.length > 0, '必须有 .dshpm-input::-webkit-search-cancel-button 规则')
  assert.match(rules, /-webkit-appearance:\s*none/, '原生取消按钮要 -webkit-appearance:none')
  assert.match(rules, /display:\s*none/, '还要 display:none（连它的点击热区一起去掉）')
  // 输入框保持 type=search（role=searchbox 语义），靠上面的样式而不是改类型来去重；
  // 我们那颗仍在：有值才出现，点击走 onQueryClear（resetFilters 连筛选一起清）。
  assert.match(source, /type: "search"/, '搜索框仍是 type=search（语义留给原生，视觉交给我们的按钮）')
  assert.match(source, /props\.queryInput\s*\? el\("button"/, '清除键按输入值条件渲染')
  assert.match(source, /onClick: props\.onQueryClear/, '清除键要接 onQueryClear 而不是靠浏览器默认行为')
})

console.log('')
if (failures.length > 0) {
  console.log(`客户端文案与动效不变量：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`客户端文案与动效不变量：${passed}/${passed} 全通过`)
