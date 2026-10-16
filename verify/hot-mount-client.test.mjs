/**
 * 行为回归：热挂载的**客户端文案与横幅**（免重启这条路最后一段）。
 *
 * 为什么单独一个套件：host 半把 `hotMounted: true` 放进响应体，只是为了有证据；真正决定
 * 用户看到什么的是这里。两个最容易做坏的点，都属于「说假话」：
 *
 *   1. 宿主回 `application:'restart-required'`，但市场已经替它挂上了 → 若照着 application
 *      写「重启 DSH 后生效」，用户会看到一条假的待重启提示，而东西已经在跑；
 *   2. `noteRestartFrom` 是**横幅当场点亮**的来源 → 热挂载成功却还走这条，横幅会显示
 *      「还有 1 项变更需重启」。
 *
 * 手法与 truth-report / restart-unsupported 一致：把真函数抠出来，在真作用域里调用，
 * 断言返回值（不是源码形状）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const src = readFileSync(join(here, '..', 'plugin-market', 'lib', 'client.js'), 'utf8')

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

/** 花括号配对抠函数（与其它套件同法）。 */
function grab(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start !== -1, `找不到 ${signature}`)
  const open = source.indexOf('{', start + signature.length - 1)
  const paren = source.indexOf('(', start + signature.length)
  const from = open === -1 || (paren !== -1 && paren < open) ? paren : open
  const closer = source[from] === '(' ? ')' : '}'
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const c = source[i]
    if (c === source[from]) depth += 1
    else if (c === closer) {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`未闭合：${signature}`)
}

/**
 * 在一个干净作用域里求值 noticeFromResult + activationNotice。
 * `t` 回显 key（并代入 vars），这样断言的是**选了哪个 key、带了什么变量**——
 * 文案本身改字不会让这个套件假红。
 */
function noticeApi() {
  const bundle = [
    // TASK-02 noticeFromResult 会先查 application 是否在封闭集合里，
    // 沙箱必须注入**真的**那份（写死等价占位就等于不测这条链）。
    grab(src, 'var CHANGE_APPLICATIONS = {'),
    grab(src, 'function applicationKnown('),
    grab(src, 'function activationNotice('),
    grab(src, 'function noticeFromResult(')
  ].join('\n')
  return new Function(
    't',
    `${bundle}\nreturn { noticeFromResult, activationNotice };`
  )((key, vars) => {
    if (!vars) return key
    let out = key
    for (const [k, v] of Object.entries(vars)) out += `|${k}=${String(v)}`
    return out
  })
}

const api = noticeApi()

console.log('\n[1] 热挂载成功：不写「重启后生效」')
check('hotMounted:true ⇒ 成功级别 + installHotMounted（不是 installRestart）', () => {
  const outcome = api.noticeFromResult(
    // 宿主原话就是 restart-required —— 这正是要盖掉的那一条。
    { application: 'restart-required', changed: true, hotMounted: true },
    'install',
    'dsh-hot'
  )
  assert.equal(outcome.kind, 'success', `级别应为成功，实际 ${outcome.kind}`)
  assert.equal(outcome.applied, true)
  assert.ok(outcome.text.startsWith('notice.installHotMounted'), `文案应为 hotMounted，实际 ${outcome.text}`)
  assert.equal(/installRestart/.test(outcome.text), false, '不许出现「重启 DSH 后生效」')
})
check('hotMounted:true 时 activation 不许把这句话盖回去（丢掉「不用重启」最关键的信息）', () => {
  const outcome = api.noticeFromResult(
    {
      application: 'restart-required',
      changed: true,
      hotMounted: true,
      // 宿主半会把 activation 一起带回来（挂上之后我们改成 live+hot）。
      activation: { state: 'live', installed: '1.0.0', expected: '1.0.0' }
    },
    'install',
    'dsh-hot'
  )
  assert.equal(outcome.text.startsWith('notice.installHotMounted'), true, `不该被 activation 覆盖，实际 ${outcome.text}`)
})
check('反向对照：没有 hotMounted 时，restart-required 仍写「重启后生效」（不能被改坏）', () => {
  const outcome = api.noticeFromResult(
    { application: 'restart-required', changed: true },
    'install',
    'dsh-plain'
  )
  assert.equal(outcome.kind, 'warn')
  assert.ok(outcome.text.startsWith('notice.installRestart'), `实际 ${outcome.text}`)
})

console.log('\n[2] 热挂载失败：把原因说出来，不是只说「要重启」')
check('hotMounted:false + 原因 ⇒ 带原因的 installHotMountFailed', () => {
  const outcome = api.noticeFromResult(
    { application: 'restart-required', changed: true, hotMounted: false, hotMountReason: 'patch 含配置行' },
    'install',
    'dsh-half'
  )
  assert.equal(outcome.kind, 'warn')
  assert.equal(outcome.applied, true, '装是装上了，只是没热挂载——不能计为失败')
  assert.ok(outcome.text.startsWith('notice.installHotMountFailed'), `实际 ${outcome.text}`)
  assert.match(outcome.text, /reason=patch 含配置行/, '原因必须传进文案，否则用户不知道市场试过、也不知道为什么没成')
})
check('hotMounted:false 但没带原因 ⇒ 退回通用的「重启后生效」，不渲染一个空的 {reason}', () => {
  const outcome = api.noticeFromResult(
    { application: 'restart-required', changed: true, hotMounted: false },
    'install',
    'dsh-half2'
  )
  assert.ok(outcome.text.startsWith('notice.installRestart'), `实际 ${outcome.text}`)
  assert.equal(/reason=/.test(outcome.text), false, '没有原因时不带空的 reason 变量')
})
check('hotMounted:false 且 changed:false ⇒ 保留「没有产生变更」（那是更重要的信息）', () => {
  const outcome = api.noticeFromResult(
    { application: 'applied', changed: false, hotMounted: false, hotMountReason: 'x' },
    'install',
    'dsh-nc'
  )
  assert.equal(outcome.text, 'notice.noChange', `实际 ${outcome.text}`)
})

console.log('\n[3] 老客户端形状不变：没尝试热挂载时不出现这个字段')
check('payload 没有 hotMounted 时，applied 走原来的 installApplied', () => {
  const outcome = api.noticeFromResult({ application: 'applied', changed: true }, 'install', 'dsh-old')
  assert.equal(outcome.kind, 'success')
  assert.ok(outcome.text.startsWith('notice.installApplied'), `实际 ${outcome.text}`)
})
check('undefined / null 字段都不算「热挂载过」', () => {
  for (const value of [undefined, null, 0, 'yes']) {
    const outcome = api.noticeFromResult({ application: 'restart-required', changed: true, hotMounted: value }, 'install', 'x')
    assert.ok(outcome.text.startsWith('notice.installRestart'), `hotMounted=${String(value)} 不该被当成 true，实际 ${outcome.text}`)
  }
})

console.log('\n[4] 横幅不许为热挂载过的插件亮起')
check('noteRestartFrom 遇 hotMounted:true 直接返回，不记账也不弹窗', () => {
  const body = grab(src, 'function noteRestartFrom(')
  const seen = { names: [], asked: 0, restart: 0 }
  const fn = new Function(
    'restartNamesRef', 'setRestart', 'maybeAskRestart',
    `${body}\nreturn noteRestartFrom;`
  )(
    { current: seen.names },
    () => { seen.restart += 1 },
    () => { seen.asked += 1 }
  )
  fn({ application: 'restart-required', hotMounted: true }, { label: 'dsh-hot' })
  assert.deepEqual(seen.names, [], '热挂载成功不该进待重启名单')
  assert.equal(seen.restart, 0, '不该点亮横幅')
  assert.equal(seen.asked, 0, '不该弹重启询问')
})
check('反向对照：同样 payload 去掉 hotMounted ⇒ 照常记账并点亮（守住这条路径）', () => {
  const body = grab(src, 'function noteRestartFrom(')
  const seen = { names: [], asked: 0, restart: 0 }
  const fn = new Function(
    'restartNamesRef', 'setRestart', 'maybeAskRestart',
    `${body}\nreturn noteRestartFrom;`
  )(
    { current: seen.names },
    () => { seen.restart += 1 },
    () => { seen.asked += 1 }
  )
  fn({ application: 'restart-required' }, { label: 'dsh-plain' })
  assert.deepEqual(seen.names, ['dsh-plain'])
  assert.equal(seen.restart, 1)
  assert.equal(seen.asked, 1)
})

console.log('\n[5] /status 水合时按 hotMounts 过滤（两半版本不一致也不说假话）')
check('hydrate：在 hotMounts 里的名字不进待重启名单', () => {
  const body = grab(src, 'function hydrateRestartFromStatus(')
  const seen = { names: [], restart: 0 }
  const fn = new Function(
    'restartNamesRef', 'setRestart',
    `${body}\nreturn hydrateRestartFromStatus;`
  )(
    { current: seen.names },
    () => { seen.restart += 1 }
  )
  fn({ pendingRestart: { names: ['a', 'b'], marketVersion: null }, hotMounts: ['B'] })
  assert.deepEqual(seen.names, ['a'], `大小写不敏感地滤掉已热挂载的 b，实际 ${JSON.stringify(seen.names)}`)
  assert.equal(seen.restart, 1, '还有 a 待重启，横幅该亮')
})
check('hydrate：全被热挂载滤掉且没有 marketVersion ⇒ 不点亮横幅', () => {
  const body = grab(src, 'function hydrateRestartFromStatus(')
  const seen = { names: [], restart: 0 }
  const fn = new Function(
    'restartNamesRef', 'setRestart',
    `${body}\nreturn hydrateRestartFromStatus;`
  )(
    { current: seen.names },
    () => { seen.restart += 1 }
  )
  fn({ pendingRestart: { names: ['only'], marketVersion: null }, hotMounts: ['only'] })
  assert.deepEqual(seen.names, [])
  assert.equal(seen.restart, 0, '没有真待重启项就不该亮横幅')
})
check('hydrate：没有 hotMounts 字段（老宿主半）⇒ 行为与从前一致，不过滤', () => {
  const body = grab(src, 'function hydrateRestartFromStatus(')
  const seen = { names: [], restart: 0 }
  const fn = new Function(
    'restartNamesRef', 'setRestart',
    `${body}\nreturn hydrateRestartFromStatus;`
  )(
    { current: seen.names },
    () => { seen.restart += 1 }
  )
  fn({ pendingRestart: { names: ['x'], marketVersion: null } })
  assert.deepEqual(seen.names, ['x'])
  assert.equal(seen.restart, 1)
})
check('hydrate：只有 marketVersion（市场自更新）时照旧点亮，不被 hotMounts 影响', () => {
  const body = grab(src, 'function hydrateRestartFromStatus(')
  const seen = { names: [], restart: 0 }
  const fn = new Function(
    'restartNamesRef', 'setRestart',
    `${body}\nreturn hydrateRestartFromStatus;`
  )(
    { current: seen.names },
    () => { seen.restart += 1 }
  )
  fn({ pendingRestart: { names: [], marketVersion: '9.9.9' }, hotMounts: [] })
  assert.deepEqual(seen.names, [])
  assert.equal(seen.restart, 1, '市场自更新有待重启项时必须点亮')
})

console.log(`\nhot-mount-client: ${passed}/${passed + failures.length} 通过`)
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 条：`)
  for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`)
  process.exit(1)
}
