/**
 * 客户端错误文案与开关回执的行为回归（门禁执行）。
 *
 * 为什么需要它：`verify/error-classify.test.mjs` 只**直接调用** `fileLockedDetail` /
 * `registryUnreachableDetail` / `shortFailureText`，并用正则断言 `message:` 那一行——
 * 也就是说 `errorCopy` 这个**真正决定用户看到哪段文案**的函数，在整个 `verify/` 里
 * **从未被执行过**。于是它对前两者的组合逻辑可以悄悄写错而全绿：
 * 第二轮独立审计就抓到一个真实的 HIGH——命中 registry-unreachable 之后，
 * why 又被宿主的通用句覆盖，把 76110d9 那次修复整个抵消掉。
 *
 * 做法：把 client.js 里的真实函数抠出来，在**同一个作用域**求值后真调
 * （t 用透传桩，返回 key 本身，这样「选中了哪个前缀」直接体现在结果里）。
 *
 * 用法：node verify/client-errorcopy.test.mjs
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

/** 从源码里按括号配平抠出一段（`var X = {` 或 `function X(`）。 */
function grab(signature) {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`抠不到：${signature}`)
  let i = source.indexOf('{', start)
  let depth = 0
  for (let j = i; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1
    else if (source[j] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, j + 1)
    }
  }
  throw new Error(`括号不配平：${signature}`)
}

// errorCopy 依赖 ERROR_PREFIXES + 三个 detail 函数（它们互相调用，必须同作用域）
const bundle = [
  grab('var ERROR_PREFIXES = {') + ';',
  grab('function fileLockedDetail('),
  grab('function supplyChainDetail('),
  grab('function registryUnreachableDetail('),
  grab('function shortFailureText('),
  grab('function errorCopy(')
].join('\n')
const built = new Function('t', `${bundle}\nreturn { errorCopy, fileLockedDetail, supplyChainDetail, registryUnreachableDetail, shortFailureText, ERROR_PREFIXES };`)
// t 桩返回 key 本身：结果里出现 "err.registry-unreachable.why" 就说明选中了那段文案
const api = built((key) => key)
assert.equal(typeof api.errorCopy, 'function', '前置条件：必须抠到真实的 errorCopy')
assert.equal(typeof api.supplyChainDetail, 'function', '前置条件：必须抠到真实的 supplyChainDetail')

console.log('\n[1] errorCopy：命中的专属解释不得被宿主的通用句覆盖（HIGH，v1.2.0 修）')
check('operation-error + 网络诊断 ⇒ why 仍是「连不上源」的专属解释', () => {
  // 这是**真实且被文档记录**的场景：宿主把 pnpm 非 0 退出归成 operation-error
  // （index.js 的 projectChangeError 默认码就是它），而 operation-error **不在**
  // ERROR_PREFIXES 里。修复前：known=false 让最后那句 `copy.why = message` 生效，
  // 把 why 覆盖成「宿主执行这个操作时报错。」——正是 76110d9 要消灭的那句话。
  const copy = api.errorCopy({
    code: 'operation-error',
    message: '宿主执行这个操作时报错。',
    diagnostic: 'ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/x: ECONNRESET (Request took 72331ms)'
  })
  assert.equal(copy.title, 'err.registry-unreachable.title', '标题要指向「连不上 npm 源」')
  assert.equal(copy.why, 'err.registry-unreachable.why', 'why 必须保留专属解释，不能被覆盖')
  assert.equal(copy.next, 'err.registry-unreachable.next')
  assert.match(String(copy.message), /ECONNRESET/, '详情行要露出诊断原文')
})
check('对照：未命中任何专属规则时，未知码仍把宿主原话塞进 why（兜底不能砍掉）', () => {
  const copy = api.errorCopy({ code: 'operation-error', message: '宿主原话：磁盘满了' })
  assert.equal(copy.why, '宿主原话：磁盘满了', '没有专属解释时仍应显示宿主原话')
  assert.equal(copy.title, 'err.unknown.title')
})
check('对照：占用类优先于网络，且 why 不被覆盖', () => {
  const copy = api.errorCopy({
    code: 'operation-error',
    message: '宿主执行这个操作时报错。',
    diagnostic: 'EPERM: operation not permitted, scandir D:\\x'
  })
  assert.equal(copy.title, 'err.file-locked.title', '诊断里混着 registry 字样时也要认占用')
  assert.equal(copy.why, 'err.file-locked.why')
})
check('对照：known 的码仍走自己的文案，why 不被宿主原话覆盖', () => {
  const copy = api.errorCopy({ code: 'install-failed', message: '宿主原话', diagnostic: 'ECONNRESET' })
  assert.equal(copy.why, 'err.registry-unreachable.why', '装了网就给网的专属 why')
  const plain = api.errorCopy({ code: 'install-failed', message: '宿主原话' })
  assert.equal(plain.why, 'err.install-failed.why')
})

console.log('\n[2] 供应链冷静期失败不得被误判成「连不上 npm 源」（HIGH，v1.2.0 修）')
// 这是从真实失败日志 operation-CQMIcN/pnpm.log 里抄下来的原文（用户报「dsh-mobile 更新失败」）。
// 关键点：这段日志**同时**含 UND_ERR_DESTROYED 和 registry.npmmirror.com —— 网络正则必然命中。
// 修复前实测：title=err.registry-unreachable.title、next=err.registry-unreachable.next，
// 也就是让用户去「配镜像」，而真正原因是 pnpm 11 默认 24h 发布冷静期拒了整个 lockfile。
// 配镜像、换源都不可能修好，属于「自信地指错方向」。
const REAL_SUPPLY_CHAIN_LOG = [
  '? Verifying lockfile against supply-chain policies (72 entries)...',
  'Progress: resolved 1, reused 0, downloaded 0, added 0',
  '✗ Lockfile failed supply-chain policy check (72 entries in 153ms)',
  '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:',
  '  dsh-context@0.65.0 was published at 2026-10-07T09:44:32.122Z, within the minimumReleaseAge cutoff (2026-10-07T04:35:12.281Z)',
  '[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.',
  '[WARN] GET https://registry.npmmirror.com/dsh-mobile/-/dsh-mobile-0.6.0.tgz error (UND_ERR_DESTROYED). Will retry in 10 seconds. 2 retries left.'
].join('\n')

check('真实失败日志 ⇒ 供应链文案，不是「连不上源」', () => {
  const copy = api.errorCopy({
    code: 'operation-error',
    message: '宿主执行这个操作时报错。',
    diagnostic: REAL_SUPPLY_CHAIN_LOG
  })
  assert.equal(copy.title, 'err.supply-chain.title', '标题必须指向供应链策略')
  assert.equal(copy.why, 'err.supply-chain.why', 'why 必须解释发布冷静期')
  assert.equal(copy.next, 'err.supply-chain.next', 'next 不能是「配镜像」')
  assert.notEqual(copy.next, 'err.registry-unreachable.next', '绝不能建议配镜像')
  assert.match(String(copy.message), /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION/, '详情行保留 pnpm 原文')
})
check('只用错误码也能认（诊断被截断时仍要认得出）', () => {
  const copy = api.errorCopy({ code: 'install-failed', message: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION' })
  assert.equal(copy.title, 'err.supply-chain.title')
})
check('对照：真正的网络故障仍然报「连不上源」（不能因为收紧而误伤）', () => {
  const copy = api.errorCopy({
    code: 'operation-error',
    message: '宿主执行这个操作时报错。',
    diagnostic: 'ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/x: ECONNRESET (Request took 72331ms)'
  })
  assert.equal(copy.title, 'err.registry-unreachable.title', '没有策略码时必须仍是网络文案')
  assert.equal(copy.next, 'err.registry-unreachable.next')
})
check('对照：占用类仍优先于供应链与网络', () => {
  const copy = api.errorCopy({
    code: 'operation-error',
    diagnostic: 'EPERM: operation not permitted, scandir D:\\x'
  })
  assert.equal(copy.title, 'err.file-locked.title')
})
check('短回执也要用供应链那句（shortFailureText 三条路径一致）', () => {
  assert.equal(api.shortFailureText({ diagnostic: REAL_SUPPLY_CHAIN_LOG }), 'err.supply-chain.row')
  assert.equal(api.shortFailureText({ diagnostic: 'EPERM: x' }), 'err.file-locked.row')
  assert.equal(api.shortFailureText({ diagnostic: 'ECONNRESET' }), 'err.registry-unreachable.row')
})
check('registryUnreachableDetail 自身也要拒绝供应链诊断（纵深防御）', () => {
  // 这条断言是被**变异测试**逼出来的：原本我只断言 errorCopy 的结果，于是把
  // `if (supplyChainDetail(error) !== "") return "";` 这一行删掉，整套测试依然全绿
  // ——说明它当时并不是「承重」的（两条调用路径都先判了供应链）。
  // 保留它是纵深防御：将来任何新调用点只要直接用 registryUnreachableDetail，
  // 就不会把策略失败重新说成「连不上源」。这条断言让这份意图变成可验证的。
  assert.equal(
    api.registryUnreachableDetail({ diagnostic: REAL_SUPPLY_CHAIN_LOG }),
    '',
    '供应链诊断不得被网络路径认领'
  )
  assert.notEqual(
    api.registryUnreachableDetail({ diagnostic: 'ECONNRESET' }),
    '',
    '真正的网络诊断仍要认领'
  )
})
check('三档优先级在源码里是「供应链 > 占用 > 网络」（顺序写错就会退回误判）', () => {
  const body = api.shortFailureText.toString()
  const iSupply = body.indexOf('supply-chain.row')
  const iLocked = body.indexOf('file-locked.row')
  const iNet = body.indexOf('registry-unreachable.row')
  assert.ok(iSupply >= 0 && iLocked >= 0 && iNet >= 0, '三档都要在')
  assert.ok(iSupply < iLocked && iLocked < iNet, `顺序应为供应链<占用<网络，实际 ${iSupply}/${iLocked}/${iNet}`)
})
check('zh/en 两张表都有 supply-chain 三条文案（缺 en 会显示 key）', () => {
  for (const suffix of ['title', 'why', 'next', 'row']) {
    const needle = `"err.supply-chain.${suffix}":`
    const count = source.split(needle).length - 1
    assert.equal(count, 2, `err.supply-chain.${suffix} 应在 zh/en 各有一条，实际 ${count}`)
  }
})

console.log('\n[3] 开关回执必须看 changed / application，不能只看有没有 error（MEDIUM-HIGH，v1.2.0 修）')
// toggleNotice 与 SORTS 同级，是 var/function 声明；单独抠出来。
const toggleSrc = grab('function toggleNotice(')
const toggleApi = new Function('t', `${toggleSrc}\nreturn { toggleNotice };`)((key, vars) =>
  vars && vars.name ? `${key}:${vars.name}` : key)

check('application=cancelled（不带 error）⇒ 不能报绿色成功', () => {
  // 宿主的 /toggle 用 ok = application==='cancelled' ? true : (...)，所以 cancelled 会
  // **正常 resolve**，以前那条 `kind: payload.error ? "error" : "success"` 就报了成功。
  const notice = toggleApi.toggleNotice({ ok: true, application: 'cancelled' }, 'some-bundle', true)
  assert.equal(notice.kind, 'info')
  assert.equal(notice.applied, false)
  assert.match(notice.text, /notice\.toggleCancelled/)
})
check('changed=false ⇒ 说「没有产生变更」，不说「已启用」', () => {
  const notice = toggleApi.toggleNotice({ ok: true, changed: false, application: 'applied' }, 'some-bundle', true)
  assert.equal(notice.kind, 'info')
  assert.equal(notice.applied, false)
  assert.match(notice.text, /notice\.noChange/)
})
check('真正变更 ⇒ 绿色成功（不能因为收紧而误伤）', () => {
  const on = toggleApi.toggleNotice({ ok: true, changed: true, application: 'applied' }, 'x', true)
  assert.equal(on.kind, 'success')
  assert.equal(on.applied, true)
  assert.match(on.text, /notice\.toggleEnabled:x/)
  const off = toggleApi.toggleNotice({ ok: true, changed: true, application: 'applied' }, 'x', false)
  assert.match(off.text, /notice\.toggleDisabled:x/)
})

console.log('\n[3b] 开关的另外两种真实结果不得谎报成功（v1.2.0 第六轮）')
// 实测依据：在 scratch profile 上真打 POST /toggle，宿主回
//   {"ok":true,"changed":true,"application":"applied",...}   ← 热生效（HMR）
// 而宿主的 setPluginEnabled 还会在某条件下 return "overridden"（index.js:1658），
// 以及 change() 在 hmr 缺席时给 "restart-required"。这两条都是**可达**的。
// 修复前 toggleNotice 对二者都回「已启用 {name}」绿色成功——把「没生效」说成「生效了」。
check('application=restart-required ⇒ 必须说「重启 DSH 后生效」，不能说成已生效', () => {
  const on = toggleApi.toggleNotice({ ok: true, changed: true, application: 'restart-required' }, 'p', true)
  assert.notEqual(on.kind, 'success', '还没生效不能报绿色成功')
  assert.match(on.text, /notice\.toggleRestartOn/)
  assert.doesNotMatch(on.text, /notice\.toggleEnabled/)
  assert.equal(on.applied, true, '已写入待重启：算「改动已受理」，与安装路径口径一致')
  const off = toggleApi.toggleNotice({ ok: true, changed: true, application: 'restart-required' }, 'p', false)
  assert.match(off.text, /notice\.toggleRestartOff/)
  assert.doesNotMatch(off.text, /notice\.toggleDisabled/)
})
check('application=overridden ⇒ 必须说「被覆盖层压住」，不能报成已生效', () => {
  const on = toggleApi.toggleNotice({ ok: true, changed: true, application: 'overridden' }, 'p', true)
  assert.notEqual(on.kind, 'success', '被覆盖层压住不算生效')
  assert.match(on.text, /notice\.toggleOverriddenOn/)
  assert.doesNotMatch(on.text, /notice\.toggleEnabled/)
  // 与安装路径的差别是**有意的**：安装问「包装上了吗」（装上了 → true），
  // 开关问「状态真的切过去了吗」（被压住 → 没有）。两个问题不同，答案就该不同。
  assert.equal(on.applied, false, '请求的状态没有生效')
  const off = toggleApi.toggleNotice({ ok: true, changed: true, application: 'overridden' }, 'p', false)
  assert.match(off.text, /notice\.toggleOverriddenOff/)
})
check('四条新文案 zh/en 都要有（缺 en 会直接显示 key）', () => {
  for (const k of ['toggleRestartOn', 'toggleRestartOff', 'toggleOverriddenOn', 'toggleOverriddenOff']) {
    const needle = `"notice.${k}":`
    const count = source.split(needle).length - 1
    assert.equal(count, 2, `notice.${k} 应在 zh/en 各有一条，实际 ${count}`)
  }
})
check('两条开关路径都改用了这个函数（源码形状：不得再手写 kind 三元）', () => {
  assert.equal(
    /kind: payload && payload\.error \? "error" : "success"/.test(source),
    false,
    '旧的「只看 error」三元必须已删除'
  )
  const uses = source.match(/setNotice\(toggleNotice\(payload,/g) ?? []
  assert.equal(uses.length, 2, `toggleBundle 与 toggleEntry 都应改用 toggleNotice，实际 ${uses.length} 处`)
})

console.log('\n[4] readOnlyReason.not-removable 必须有文案（否则开关被误解锁）')
check('zh/en 两张表都定义了 not-removable', () => {
  const code = source
  // zh 表与 en 表各一次
  const hits = code.match(/"readonlyReason\.not-removable":\s*"[^"]+"/g) ?? []
  assert.equal(hits.length, 2, `zh/en 各应有一条，实际 ${hits.length}`)
})
check('宿主的三个 READ_ONLY_CODES 在客户端都有文案（不许漏）', () => {
  // 与 plugin-market/lib/index.js 的 READ_ONLY_CODES 对齐。
  // 注意这里用字符串拼接而不是 new RegExp 模板：在 new RegExp 的字符串里写
  // `\\.` 会变成「字面反斜杠 + 任意字符」，反而匹配不上（我第一版就踩了这个坑）。
  for (const reasonCode of ['management-required', 'unaddressable', 'not-removable']) {
    const needle = `"readonlyReason.${reasonCode}":`
    const count = source.split(needle).length - 1
    assert.equal(count, 2, `readonlyReason.${reasonCode} 应在 zh/en 各有一条，实际 ${count}`)
  }
})

console.log('\n[5] 请求 URL 构建：孤立代理项不得让整个面板崩掉（HIGH，v1.2.0 修）')
const sanitizeSrc = grab('function sanitizeUrlText(')
const appendSrc = grab('function appendParam(')
const urlApi = new Function(`${sanitizeSrc}\n${appendSrc}\nreturn { appendParam, sanitizeUrlText };`)()
check('孤立代理项被替换，encodeURIComponent 不再抛 URIError', () => {
  const parts = []
  // 修复前：appendParam 内部 encodeURIComponent('abc\uD83D') 直接抛 URIError: URI malformed，
  // 抛点在 catalog useEffect 里且 bundle 无 error boundary ⇒ 市场面板整棵卸载。
  urlApi.appendParam(parts, 'query', 'abc\uD83D')
  assert.equal(parts.length, 1)
  assert.match(parts[0], /^query=/)
  assert.equal(parts[0].includes('%EF%BF%BD'), true, '孤立代理项应被换成 U+FFFD 后再编码')
})
check('合法的 emoji（成对代理）必须原样保留', () => {
  const parts = []
  urlApi.appendParam(parts, 'query', 'pet😀')
  const decoded = decodeURIComponent(parts[0].slice('query='.length))
  assert.equal(decoded, 'pet😀', '成对代理不能被误伤成 U+FFFD')
})
check('孤立高/低代理项、首尾孤立都能处理', () => {
  for (const bad of ['\uD83D', '\uDE00', 'a\uD83Db', '\uD83D\uD83D', '\uDE00\uDE00']) {
    const parts = []
    urlApi.appendParam(parts, 'query', bad)
    assert.equal(parts.length, 1, `不应抛错：${JSON.stringify(bad)}`)
  }
})
check('普通文本、空值、数字不受影响', () => {
  const parts = []
  urlApi.appendParam(parts, 'query', '普通中文 & = #?')
  urlApi.appendParam(parts, 'sort', 'top')
  urlApi.appendParam(parts, 'empty', '')
  urlApi.appendParam(parts, 'nil', null)
  assert.equal(parts.length, 2, '空串与 null 应被跳过')
  assert.equal(decodeURIComponent(parts[0].slice('query='.length)), '普通中文 & = #?')
})

console.log('\n[6] 待重启横幅的水合：刷新页面后不能把「还没生效」丢掉（v1.2.0 第六轮）')
// 真跑 hydrateRestartFromStatus：它依赖 restartNamesRef / setRestart 两个外部名字，
// 用桩注入（这也是真实调用点用的同一套数据形状）。
const hydrateSrc = grab('function hydrateRestartFromStatus(')
function makeHydrator(initialRestart) {
  const ref = { current: [] }
  let seen = initialRestart
  const fn = new Function(
    'restartNamesRef', 'setRestart',
    `${hydrateSrc}\nreturn hydrateRestartFromStatus;`
  )(
    ref,
    (updater) => { seen = typeof updater === 'function' ? updater(seen) : updater }
  )
  return { fn, ref, get restart() { return seen } }
}

check('宿主的 pendingRestart 会把横幅点亮（这正是刷新页面后的路径）', () => {
  const h = makeHydrator(null)
  h.fn({ pendingRestart: { names: ['dsh-mobile'], marketVersion: null } })
  assert.ok(h.restart !== null, '收到待重启项后横幅必须点亮')
  assert.equal(h.restart.pending, true)
  assert.equal(h.restart.phase, 'idle')
  assert.deepEqual(h.ref.current, ['dsh-mobile'], '包名要进名单（横幅正文要用）')
})
check('宿主说没有待重启项时**什么都不做**（不清掉已有的，避免假阴性）', () => {
  const h = makeHydrator({ pending: true, phase: 'idle' })
  h.fn({ pendingRestart: null })
  assert.equal(h.restart.pending, true, '不能因为一次 null 就把横幅撤掉')
  h.fn({})
  assert.equal(h.restart.pending, true)
})
check('正在重启中时不许被退回 idle（否则按钮从「正在重启」变回可点）', () => {
  const h = makeHydrator({ pending: true, phase: 'restarting' })
  h.fn({ pendingRestart: { names: ['x'], marketVersion: null } })
  assert.equal(h.restart.phase, 'restarting', 'restarting 必须被保留')
})
check('重复水合不产生重复名字（刷新两次不该出现两条同名）', () => {
  const h = makeHydrator(null)
  h.fn({ pendingRestart: { names: ['dup', 'dup'], marketVersion: null } })
  h.fn({ pendingRestart: { names: ['dup'], marketVersion: null } })
  assert.deepEqual(h.ref.current, ['dup'], `应去重，实际 ${JSON.stringify(h.ref.current)}`)
})
check('市场版版本也能水合（正文要说「插件市场已更新到 v…」）', () => {
  const h = makeHydrator(null)
  h.fn({ pendingRestart: { names: [], marketVersion: '1.2.0' } })
  assert.ok(h.restart !== null, '只有 marketVersion、没有包名时也要点亮横幅')
})
check('形状不对的输入不炸（宿主旧版本没有这个字段）', () => {
  const h = makeHydrator(null)
  for (const bad of [null, undefined, {}, { pendingRestart: 'x' }, { pendingRestart: 1 }, { pendingRestart: [] }]) {
    h.fn(bad)
  }
  assert.equal(h.restart, null, '不认识的东西不该凭空点亮横幅')
})

console.log('')
if (failures.length > 0) {
  console.log(`客户端文案/回执回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`客户端文案/回执回归：${passed}/${passed} 全通过`)
}
