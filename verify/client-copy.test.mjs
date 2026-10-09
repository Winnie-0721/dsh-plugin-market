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
  // 两处行内短句现在共用 shortFailureText（此前各写一遍同样的三元表达式，改一处就会漂移）
  assert.match(source, /function shortFailureText\(error\)/, '要有共用的行内短句函数')
  assert.match(source, /if \(fileLockedDetail\(error\) !== ""\) return t\("err\.file-locked\.row"\);/, '占用类要给可照做的短句')
  assert.equal(/fileLockedDetail\(error\) \? t\("err\.file-locked\.row"\)/.test(source), false, '行内不许再各写一遍三元表达式')
  assert.match(source, /t\("installed\.rowError", \{ message: shortFailureText\(bundle\.error\)/, '已安装行错误走同一个短句函数')
  assert.match(source, /text: shortFailureText\(error\)/, '可更新行内失败走同一个短句函数')
  // 3) 详情行要露出诊断原文（此前 EPERM 与网络失败都只显示宿主通用句）
  // v1.2.0 起供应链策略失败也走这条路（它排在占用之前）：三级串联，缺一级就退回通用句。
  assert.match(source, /message: supply \|\| locked \|\| unreachable \|\| message/, '命中时详情行用诊断原文（供应链、占用、网络三种都算）')
})
check('连不上 npm 源要给出「配镜像」的可操作回执（浏览走镜像、安装走 pnpm 的 registry）', () => {
  // 真实案例：用户报「装了俩个插件都没成功」。其中一个的 pnpm 日志里 34 次请求全是
  // registry.npmjs.org、0 次镜像，ECONNRESET / Request took 72331ms 刷满整页；
  // 而界面只写「宿主执行这个操作时报错。看宿主日志里的 pnpm 输出」——用户不可能从
  // 那句话推断出「去配个镜像」。这两条通道不同正是「能浏览、能点、一下载就失败」的原因。
  assert.match(source, /function registryUnreachableDetail\(error\)/, '要有 npm 源不可达识别函数')
  // 只认具体网络签名：裸 network/registry 会把「版本不兼容」「包不存在」也改写文案
  const fn = source.slice(source.indexOf('function registryUnreachableDetail'), source.indexOf('function registryUnreachableDetail') + 1400)
  assert.match(fn, /ECONNRESET\|ETIMEDOUT/, '要覆盖 ECONNRESET/ETIMEDOUT')
  assert.match(fn, /UND_ERR/, '要覆盖 pnpm 的 UND_ERR_* 系列')
  assert.match(fn, /Request took \\d\+ms/, '要覆盖 pnpm 的 Request took Nms')
  assert.match(fn, /ERR_PNPM_FETCH/, '要覆盖 pnpm 的 fetch 错误码')
  assert.equal(/\[.*\bnetwork\b.*\]/.test(fn.replace(/ECONNRESET[^/]*/, '')), false, '不许把裸 network 词放进匹配集')
  // 占用的判定优先：诊断里也可能混着 registry 字样，不能被抢走
  assert.match(fn, /if \(fileLockedDetail\(error\) !== ""\) return "";/, '占用优先于网络')
  // errorCopy 要切到新文案，且排除了已知码的通用文案
  assert.match(source, /: unreachable !== "" \? "err\.registry-unreachable"/, 'errorCopy 命中时切到 registry-unreachable 文案')
  // 两种语言都要有，且建议必须是「在 profile 目录建 .npmrc」（已核实 pnpm 的 cwd 就是 profile 目录）
  assert.match(zhBlock, /"err\.registry-unreachable\.next": "[^"]*\.npmrc/, '中文建议要给出 .npmrc')
  assert.match(zhBlock, /registry=https:\/\/registry\.npmmirror\.com/, '中文建议要给出可用的镜像地址')
  assert.match(enBlock, /"err\.registry-unreachable\.next": "[^"]*\.npmrc/, '英文建议也要给出 .npmrc')
  assert.match(enBlock, /registry=https:\/\/registry\.npmmirror\.com/, '英文建议也要给出镜像地址')
  assert.match(zhBlock, /"err\.registry-unreachable\.row"/, '行内短句键存在')
  assert.match(enBlock, /"err\.registry-unreachable\.row"/, '行内短句键存在（en）')
  // 文案里不许出现渲染给用户的字面占位符（宿主只暴露 profile 名字，不给目录）
  assert.equal(source.includes('{profileDir}'), false, '不许有渲染不出来的占位符')
  assert.match(zhBlock, /DSH_HOME\/profiles\/<profile>/, '中文要给出可自行代入的路径形式')
})
check('被 pnpm 供应链策略拦下 ≠ 连不上源：不许再劝人配镜像（v1.2.0 修）', () => {
  // 真实案例：用户报「dsh-mobile 更新失败」。三条日志都以
  // ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION 失败，且末尾都带
  // `GET https://registry.npmmirror.com/....tgz error (UND_ERR_DESTROYED)`。
  // 那一行是**结果**（校验一失败 pnpm 就放弃下载），不是原因；但网络正则会命中它，
  // 于是修复前 errorCopy 给出 title=连不上源 / next=配镜像——方向完全错。
  assert.match(source, /function supplyChainDetail\(error\)/, '要有供应链策略识别函数')
  assert.match(source, /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION/, '要认 pnpm 的策略错误码')
  assert.match(source, /minimumReleaseAge cutoff/, '要认它的英文说明')
  // 优先级：network 路径必须先把自己让开，否则供应链失败仍会被判成网络
  assert.match(source, /if \(supplyChainDetail\(error\) !== ""\) return "";/, '网络路径要先排除供应链失败')
  assert.match(source, /var prefix = supply \? "err\.supply-chain"/, 'errorCopy 命中供应链时要切到专属文案')
  // 三档顺序：供应链 > 占用 > 网络
  const shortFn = source.slice(source.indexOf('function shortFailureText'), source.indexOf('function shortFailureText') + 500)
  const iSupply = shortFn.indexOf('err.supply-chain.row')
  const iLocked = shortFn.indexOf('err.file-locked.row')
  const iNet = shortFn.indexOf('err.registry-unreachable.row')
  assert.ok(iSupply >= 0 && iLocked >= 0 && iNet >= 0, '三档都要在短句函数里')
  assert.ok(iSupply < iLocked && iLocked < iNet, '顺序必须是供应链 > 占用 > 网络')
  // 中英都要有，且 next 不许再指向 .npmrc/镜像（那对这个问题无效）
  for (const block of [zhBlock, enBlock]) {
    assert.match(block, /"err\.supply-chain\.title"/, '缺 title')
    assert.match(block, /"err\.supply-chain\.why"/, '缺 why')
    assert.match(block, /"err\.supply-chain\.next"/, '缺 next')
    assert.match(block, /"err\.supply-chain\.row"/, '缺 row')
  }
  const zhSupplyNext = /"err\.supply-chain\.next": "([^"]+)"/.exec(zhBlock)
  assert.ok(zhSupplyNext, 'zh 的 supply-chain.next 应存在')
  assert.equal(/\.npmrc|registry=/.test(zhSupplyNext[1]), false, '供应链的 next 不许再劝人配镜像')
  assert.match(zhSupplyNext[1], /minimumReleaseAgeExclude/, '要给出真正的解法（豁免清单）')
  // v1.2.0 第六轮修正：文案原来教「写一条版本并集」，但那**只在当次生效**——pnpm 自己会把
  // 触发的版本追加到列表末尾，而第一条同名规则先命中就 return，追加的那条永远被挡住。
  // （真实复现：0.66.0 就是这么被追加进去、然后被挡住的。）现在必须教**裸包名**。
  assert.match(zhSupplyNext[1], /只认\*\*第一个\*\*同名规则/, '要提醒同名规则只有第一条生效')
  assert.match(zhSupplyNext[1], /追加到列表末尾/, '要提醒 pnpm 会把版本追加到末尾（这才是「并集只能生效一次」的原因）')
  assert.match(zhSupplyNext[1], /裸包名/, '要给出不会被追加破坏的写法')
  assert.equal(
    /dsh-context@0\.64\.0 \|\| 0\.65\.0/.test(zhSupplyNext[1]),
    false,
    '不许再教「版本并集」——它下次就会被 pnpm 的追加破坏'
  )
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
check('「检查更新」单按钮状态机：有更新就给一键更新，页脚旧按钮已合并删除', () => {
  assert.match(zhBlock, /"action\.checkUpdates": "检查更新"/, '初始态文案是「检查更新」')
  // 用户第四轮修正：主动作由**数据**决定——列表里有可更新插件时，按钮直接就是「一键更新（N）」，
  // 不该先逼用户点一次「检查更新」（那一页打开时列表和角标早就把 N 摆出来了）。
  // `checked` 只保留「没有更新时」区分「检查更新 / 重新检查」这一个用途。
  assert.match(source, /var canUpdateAll = bundles\.length > 0;/, '有更新即可一键更新，不再要求先手动检查')
  assert.equal(
    /var canUpdateAll = checked && bundles\.length > 0/.test(source),
    false,
    '旧的「必须先点过检查才给一键更新」必须已删除'
  )
  assert.match(source, /var checked = props\.checkPhase === "checked";/, 'checked 仍保留（用于没有更新时的「重新检查」）')
  assert.match(source, /onClick: canUpdateAll \? props\.onUpdateAll : props\.onCheckUpdates/, '同一颗按钮按状态切换点击目标')
  assert.match(source, /checked \? t\("action\.recheckSelf"\) : t\("action\.checkUpdates"\)/, '没有更新时：检查过 → 重新检查；没检查过 → 检查更新')
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
  // 点亮：安装/更新/卸载/开关/自更新回来的 restart-required、requiresRestart 都要接上。
  // v1.2.0 起带 options（label / defer / marketVersion），所以按前缀匹配而不是 `(payload)`。
  const lightUps = [...source.matchAll(/noteRestartFrom\(payload, \{/g)]
  assert.ok(lightUps.length >= 5, `各写操作都要点亮重启横幅，当前只有 ${lightUps.length} 处`)
  assert.match(source, /payload\.application === "restart-required" \|\| payload\.requiresRestart === true/, '点亮条件覆盖两种写法')
  // 探活回路：宿主死掉期间先记下「见过死」，之后 /status 恢复才刷新页面
  assert.match(source, /restartSawDownRef\.current = true/, '宿主死掉期间要记下「见过死」')
  assert.match(source, /if \(restartSawDownRef\.current\)/, '刷新必须以「见过死」为前提')
  assert.match(source, /window\.location\.reload\(\)/, '宿主回来后要自动恢复页面')
  assert.match(source, /notice\.restartTimeout/, '等不到宿主要如实提示，不能一直转圈')
  // 幂等与可定位性（v1.2.0：startRestart 改成返回 Promise，好让弹窗能接住失败）
  assert.match(source, /if \(restart && restart\.phase === "restarting"\) return Promise\.resolve\(\);/, '重启中要挡掉重复点击')
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
check('「重试」必须重抓它自己那一页的数据（审计发现的死键）', () => {
  // 发现页的数据来自 /catalog，effect 依赖 catalogTick；曾经这里误接 bumpTick()
  // （只动 installedTick），于是「重试」点了不发任何 /catalog 请求，报错框永远留在屏幕上
  // ——用户唯一的自救路径是个死键。已安装页的 onRetry 才该接 bumpTick。
  // 用两个页签挂载点之间的区间界定发现页，避免固定字窗截断（这份挂载块有 30 行）。
  const discoverAt = source.indexOf('el(DiscoverPane, {')
  const installedAt = source.indexOf('el(InstalledPane, {')
  assert.ok(discoverAt > 0 && installedAt > discoverAt, '找到两个页签的挂载点且顺序正确')
  const discoverBlock = source.slice(discoverAt, installedAt)
  assert.match(discoverBlock, /onRetry: function \(\) \{ bumpCatalog\(\); \}/,
    '发现页 onRetry 必须调 bumpCatalog()（重抓目录）')
  assert.equal(/onRetry: function \(\) \{ bumpTick\(\); \}/.test(discoverBlock), false,
    '发现页的 onRetry 不许接成 bumpTick（点了不发 /catalog，报错框留在屏幕上）')
  // 对照：已安装页仍然接 bumpTick（它的数据来自 /installed，不是目录）
  const installedBlock = source.slice(installedAt, source.indexOf('var activePane'))
  assert.ok(installedBlock.length > 100, '截到了已安装页挂载块')
  assert.match(installedBlock, /onRetry: function \(\) \{ bumpTick\(\); \}/,
    '已安装页那一份仍要接 bumpTick（它读的是 /installed）')
})
check('退场计时器只准清掉「为它起的那条」回执（审计发现的 200ms 吞新回执）', () => {
  // 旧写法 setTimeout 里无条件 setNotice(null)：退场窗口（200ms）内来了新回执，
  // 旧计时器到期会把**新回执**也清掉——新回执本该活 NOTICE_DISMISS_MS(4600ms)。
  assert.match(source, /noticeClosingRef/, '要记住退场计时器是为哪条回执起的')
  // 关键：必须在**排队之前**把目标取值存进局部变量。setNotice 的函数式 updater 是等渲染时
  // 才执行的，若在它之前清掉 ref，比较时两边都是 null、判定失败，回执永远关不掉
  //（这个 bug 真发生过：正则形状断言放过了它，真实浏览器 e2e 抓到「提示条没自动收起」）。
  assert.match(source, /var closing = noticeClosingRef\.current;\s*\n\s*noticeClosingRef\.current = null;\s*\n\s*setNotice\(function \(current\) \{\s*\n\s*return current === closing \? null : current;/,
    '必须先取值到局部变量，再用它比对')
  // 反向：不许在 updater 内部引用 ref（那是上面那个 bug 的形状）
  const dismissAt = source.indexOf('function dismissNotice()')
  const dismissBlock = source.slice(dismissAt, dismissAt + 1100)
  assert.equal(/current === noticeClosingRef\.current/.test(dismissBlock), false,
    'updater 内不许直接读 ref（会被同步清空，判定永远失败）')
  assert.equal(/setNotice\(null\);/.test(dismissBlock), false,
    'dismissNotice 的计时器里不许再有无条件 setNotice(null)')
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
  // 英文表也必须不同——审计发现这里曾经两张表都叫 "Check again"：zh 区分了、en 没区分，
  // 而门禁只断言了 zh（`enBlock` 是独立的表，漏一条就漏一种语言）。
  assert.match(enBlock, /"action\.recheckSelf": "Re-check plugins"/, 'en 左键文案')
  assert.match(enBlock, /"action\.recheckSelfOnly": "Check again"/, 'en 右键就绪态文案')
  assert.notEqual(
    enBlock.match(/"action\.recheckSelf": "([^"]+)"/)[1],
    enBlock.match(/"action\.recheckSelfOnly": "([^"]+)"/)[1],
    'en 的两颗黑按钮文案也不许相同'
  )
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
check('三个页签页面统一布局：共用一个外壳 + 固定页签高度（用户报「高度不对齐」）', () => {  // 用户截图：三个页签各自的页面内容起点/高度不一样，切一下就跳。修法是给页面加统一外壳，
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
check('搜索框只有一个清除键：样式表关掉 Chromium 原生的 ::-webkit-search-cancel-button', () => {  // 用户截图（2026-10-06）：搜索框聚焦且有值时出现两个清除键——我们 .dshpm-search 里那颗，
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
check('错误归类与目录过期原因：两条真实可达的文案路径', () => {
  // ① 「返回的不是 JSON」不能再归成 internal。用户报过/实测过：反向代理返回一段 HTML 时，
  //    codeForStatus(200) 落到 "internal"，界面写「宿主内部出错 / 看宿主日志」——明明是被代理拦了；
  //    而 err.badResponse.* 三段文案（「可能被代理或旧版本宿主拦截」）此前**没有任何地方产生**
  //    badResponse 这个码，是死文案。
  assert.match(source, /function codeForBadBody\(status\)/, '要有专用的「正文形状不对」归类函数')
  assert.match(source, /if \(status >= 400\) return codeForStatus\(status\);/, '4xx/5xx 仍按状态码归类')
  assert.match(source, /return "badResponse";/, '2xx 却给出非 JSON 时归到 badResponse')
  assert.match(source, /var shapeCode = codeForBadBody\(response\.status\);/, '解析正文失败处要用新函数')
  assert.match(source, /"badResponse": true/, 'badResponse 必须在 ERROR_PREFIXES 里（否则又落回 unknown）')
  // ② why 也要传插值变量：err.badResponse.why 里有 {status}，不传会把字面量渲染给用户。
  assert.match(source, /why: t\(prefix \+ "\.why", \{ status: status \}\)/, 'why 文案要传 {status}')
  assert.match(zhBlock, /"err\.badResponse\.why": "[^"]*HTTP \{status\}[^"]*"/, '中文 why 里确实有 {status} 占位符')
})
check('目录过期横幅要显示真实原因（用户报「原因未知」）', () => {
  // 服务端两种形态：/status 的 catalog.error 是**字符串错误码**（catalog.js 置 `error = result.code`），
  // /catalog 的 catalog 对象不带 error。旧代码只按对象读 error.message/.code → reason 永远是
  // 「原因未知」，用户无法判断是网络、限流还是源站挂了。
  assert.match(source, /function staleReason\(staleSource\)/, '要有集中的原因推导函数')
  assert.match(source, /if \(typeof raw === "string" && raw !== ""\) return codeLabel\(raw\);/, '字符串错误码要直接用')
  assert.match(source, /var text = raw\.message \|\| raw\.code;/, '对象形态仍要支持')
  assert.match(source, /return t\("catalog\.stale\.noReason"\);/, '真拿不到才说「原因未知」')
  assert.match(source, /reason: staleReason\(staleSource\)/, '横幅要用这个函数取原因')
  assert.match(source, /return label === key \? code : label \+ "（" \+ code \+ "）";/, '认不出的码原样显示，不要丢掉信息')
})
check('忙碌态按作业 key 归位：并发操作不互相清空', () => {
  // 装 A 的同时点装 B：旧代码 clearJob() 无条件 setJob(null)，A 完成时把 B 的忙碌态也清掉，
  // 界面显示空闲、按钮解除禁用 → 用户再点一次就是重复安装。
  assert.match(source, /function clearJob\(key\)/, 'clearJob 必须接收自己的 key')
  assert.match(source, /if \(key !== undefined && previous\.key !== key\) return previous;/, '不是自己的作业不清')
  assert.match(source, /function jobRunning\(key\)/, '要有同步可见的「在跑」判定')
  assert.match(source, /var jobKeysRef = React\.useRef\(\{\}\)/, '判定读 ref（同一批事件里 state 还是旧值）')
  // 所有 clearJob 调用都必须带上 key，否则等于回到旧的「清空一切」行为。
  const bare = [...source.matchAll(/clearJob\(\)/g)].length
  assert.equal(bare, 0, `还有 ${bare} 处 clearJob() 没带 key`)
})
check('同 key 守卫必须回调 onDone，否则「一键更新」永久卡死', () => {
  // 实测过的死锁：一键更新顺序执行靠 updateBundle 的 onDone 推进；
  // 若守卫只 `return`（不回调），撞上同 key 的那一步既不发请求也不回调 → step() 断掉、
  // batch 永远 running、按钮被自己的守卫挡住 → 整个会话内一键更新彻底失效。
  assert.match(source, /if \(jobRunning\(jobKey\)\) \{[\s\S]{0,200}report\(/, '守卫命中也要 report，让 step 继续')
  assert.match(source, /"notice\.installBusy"/, '跳过时要有文案说明')
  // batch 的计数：跳过的既不算成功也不算失败，但必须继续推进。
  assert.match(source, /outcome && outcome\.skipped/, '批量要识别 skipped')
  assert.match(source, /notice\.installBusy": "\{name\} 正在装\/更新，已跳过。"/, '中文文案')
  // 已安装页那颗更新按钮要跟「可更新」页一样受 batchRunning 约束（否则用户能从两页插同一颗）。
  assert.match(source, /disabled: locked \|\| props\.busy \|\| props\.batchRunning/, '已安装页更新按钮要禁 batchRunning')
  assert.match(source, /batchRunning: !!\(batch && batch\.running\)/, 'batchRunning 要传进 InstalledPane')
})
check('分页超出末页时收敛：不会出现「第 5/2 页」+ 空网格', () => {
  // 客户端只在改搜索条件时重置页码，目录刷新让它变短时不会重置；
  // 后端收敛到末页后这里也就自然一致了。同时把 requestedPage 交出来便于诊断。
  assert.match(source, /var page = payload\.page \|\| \{ page: 1, pages: 1, total: items\.length \};/, '仍按响应里的 page 渲染')
  assert.match(source, /onPage: function \(value\) \{ setPage\(value < 1 \? 1 : value\); \}/, '页码下限仍是 1')
})


check('装后激活校验：回读状态决定文案，不再一律写「已安装」（v1.1.7）', () => {
  // 错过的样子：宿主回 applied 就写「已安装 {name}」。而 applied 也可能意味着
  // 「装进了 node_modules，但 profile 的 bundle 列表里从来没有它」——绿色回执 + 插件不出现。
  assert.match(source, /function activationNotice\(activation, name\)/, '要有集中的激活状态→文案函数')
  for (const key of ['notice.installLive', 'notice.installInert', 'notice.installBroken', 'notice.installDisabled', 'notice.installUnknown']) {
    // 收尾引号必须有：`t("notice.installLive"` 会被 `t("notice.installLiveMismatch"` 前缀满足，
    // 那正是「一条走兜底路径也能满足的断言」——测了等于没测。
    assert.match(source, new RegExp(`t\\("${key.replace('.', '\\.')}",`), `要渲染 ${key}`)
  }
  // 六种状态各自的分支都在（restart 交给原来的重启文案，所以这里没有 restart 分支）。
  assert.match(source, /if \(state === "live"\)/, 'live 分支')
  assert.match(source, /if \(state === "inert"\)/, 'inert 分支')
  assert.match(source, /if \(state === "broken"\)/, 'broken 分支')
  assert.match(source, /if \(state === "disabled"\)/, 'disabled 分支')
  assert.match(source, /if \(state === "unknown"\)/, 'unknown 分支')
  // **版本回读对不上时必须改口**：目录说 0.63.0、磁盘还是 0.62.3，不能写「已更新」。
  assert.match(source, /activation\.versionMatches === false && installed/, '版本不一致要单独给文案')
  assert.match(source, /"notice\.installLiveMismatch"/, '要有版本不一致的文案')
  // inert / broken 不能计成功：它们会进「一键更新」的 ok 计数，谎报成功比不说更糟。
  assert.match(source, /if \(state === "inert"\) return \{ kind: "warn", applied: false/, 'inert 不算成功')
  assert.match(source, /if \(state === "broken"\) return \{ kind: "error", applied: false/, 'broken 不算成功')
  // changed === false（宿主说这次什么都没改）时保留「没有产生变更」，除非版本对不上。
  assert.match(source, /if \(detailed !== null && \(changed !== false \|\| mismatch\)\) base = detailed;/, '没变更时不要被「并已在运行」盖掉')
  // activation 缺省时行为完全不变（老宿主/老响应形状不能受影响）。
  assert.match(source, /if \(!activation \|\| typeof activation\.state !== "string"\) return null;/, '没有 activation 时返回 null，保持原文案')
})


check('重启询问弹窗：装完主动问一次，批量只问一次（v1.2.0）', () => {
  // 需求：装完还要手动去横幅找重启按钮很麻烦 → 装完主动问「立即重启 / 稍后重启」。
  assert.match(source, /function RestartAskModal\(props\)/, '要有弹窗组件')
  assert.match(source, /t\("restartAsk\.title"\)/, '标题')
  assert.match(source, /t\("restartAsk\.now"\)/, '「立即重启」')
  assert.match(source, /t\("restartAsk\.later"\)/, '「稍后重启」')
  // **默认与安全项**：破坏性的「立即重启」不能是默认/自动聚焦的那个。
  assert.match(source, /className: "dshpm-btn dshpm-btn--quiet",\s*\n\s*"data-action": "later"/, '「稍后重启」是安静样式的那颗')
  assert.match(source, /node\.querySelector\('\[data-action="later"\]'\)/, '打开时焦点落在「稍后重启」上')
  // Esc 与点遮罩 = 稍后重启（不是「取消安装」——东西已经装好了，绝不回滚）。
  assert.match(source, /event\.key === "Escape" \|\| event\.key === "Esc"/, 'Esc 等同稍后重启')
  assert.match(source, /if \(event\.target === event\.currentTarget\) props\.onLater\(\)/, '点遮罩等同稍后重启')
  // **批量只弹一次**：这是最容易做坏的地方——若每步都弹，「一键更新（N）」会弹 N 次。
  const deferred = [...source.matchAll(/defer: silent === true/g)]
  assert.equal(deferred.length, 1, '批量路径（silent）必须把询问延后')
  assert.match(source, /if \(opts\.defer !== true\) maybeAskRestart\(/, 'defer 时不弹窗，只记账')
  assert.match(source, /maybeAskRestart\(null\);/, '批量收尾（finish）统一问一次')
  // 弹窗重复性：已经开着就不再弹；问过的名字不再问第二次（否则「稍后重启」形同虚设）。
  assert.match(source, /if \(restartAskRef\.current !== null\) return;/, '已经开着就不重复弹')
  assert.match(source, /askedRestartRef\.current\.names\[names\[i\]\] !== true/, '只对没问过的名字弹')
  // 重启失败必须关掉弹窗：否则它会永远停在「正在重启」，而重启根本没发生。
  assert.match(source, /setRestartAsk\(null\);\s*\n\s*setNotice\(\{ kind: "error", error: error \}\)/, '重启失败要关弹窗')
  // 弹窗不进 .dshpm-root（否则撞上 e2e [8]「直接子项不得被压扁」）。
  assert.match(source, /el\(React\.Fragment, null,\s*\n\s*el\("div", \{\s*\n\s*className: "dshpm-root"/, 'root 外面要包一层 Fragment')
  assert.match(source, /className: "dshpm-modalLayer"/, '覆盖层有自己的类名')
  // 弹窗不在 .dshpm-root 里，所以 reduced-motion 必须单独把 modalLayer 列进去。
  assert.match(css, /\.dshpm-modalLayer, \.dshpm-modalLayer \*[^{]*\{\s*animation:none !important/, 'reduced-motion 要覆盖弹窗')
  // 只动 transform/opacity，且入动画用 backwards（门禁通用规则也会兜，这里点名）。
  assert.match(css, /\.dshpm-modalCard \{ animation:dshpm-rise[^}]*backwards/, '卡片入动画用 backwards')
})


console.log('')
if (failures.length > 0) {
  console.log(`客户端文案与动效不变量：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`客户端文案与动效不变量：${passed}/${passed} 全通过`)
