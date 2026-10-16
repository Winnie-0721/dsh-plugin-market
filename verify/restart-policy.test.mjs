/**
 * 「按需重启」判定回归（`plugin-market/lib/restart-policy.js`）。
 *
 * 每条都对应一个**真实事故**或一次实测，不是风格偏好：
 *   1. systemd 的假阳性防护——`INVOCATION_ID` 是**继承**的，只看它会把普通桌面终端、
 *      CI runner 的一键重启也关掉（比要修的 bug 更坏），所以必须有第二个信号（父进程）；
 *   2. `ppid === 1` 只覆盖 **system unit**；user unit 的主进程父进程是普通 PID、
 *      comm 才是 systemd（参考实现 #471 的真事故：只判 ppid 导致服务被永久杀掉）；
 *   3. 调试器闸门**不可**被 allowRestart 覆盖，且按 token 前缀判（`inspect-tool.js`
 *      这种路径不能误命中）；
 *   4. 重启围墙比普通写操作更严：直连回环 + 无转发痕 + **Host 是回环权威**
 *      （DNS rebinding 页面能经由自己的域名打到 127.0.0.1，只有 Host 伪造不了）；
 *   5. `/status` 的预测（reachable）**故意不含 Origin**——同源 GET 本就不带 Origin，
 *      含进去会让所有正常请求都显示"不可重启"；
 *   6. 每种不可用原因要给出**不同的下一步**（合成一句会让用户去试不可能成功的办法）。
 *
 * 契约依据：docs/API-CONTRACT.md §2.10。
 */
import assert from 'node:assert/strict'
import {
  detectedDebugger,
  detectedSupervisor,
  directLoopbackRequest,
  isDesktopManagedHost,
  isLoopbackAuthority,
  restartAllowed,
  restartBlockedHint,
  restartDecision,
  restartReachableFrom,
  setDetectedDebuggerOverride,
  trustedRestartRequest
} from '../plugin-market/lib/restart-policy.js'

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

/** 干净环境：不继承本机任何标记（否则测试会随跑测试的机器而变）。 */
const clean = { env: {}, ppid: 999, parentComm: () => 'bash' }
const mk = (address, headers) => ({ socket: { remoteAddress: address }, headers })

console.log('\n[1] detectedSupervisor：两个信号缺一不可（假阳性防护）')

check('两个标记都接受（INVOCATION_ID / JOURNAL_STREAM 都是 systemd 的）', () => {
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'abc' }, 999, () => 'systemd'), 'systemd')
  assert.equal(detectedSupervisor({ JOURNAL_STREAM: '8:1' }, 999, () => 'systemd'), 'systemd')
})

check('**继承来的标记不算数**：终端里的 node 父进程是 shell ⇒ 不是监管关系', () => {
  // 这是本模块最重要的一条。INVOCATION_ID 被所有后代继承：Linux 上一个普通桌面
  // 终端（shell 源自 user session unit）也带着它。把它当所有权 = 关掉大量
  // "重启其实完全没问题"的宿主。
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'abc' }, 999, () => 'bash'), null)
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'abc' }, 999, () => 'zsh'), null)
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'abc' }, 999, () => 'node'), null, 'CI agent 也是 node')
})

check('user unit：父进程 comm 是 systemd 就够了（不要求 ppid===1）', () => {
  // systemd --user 的主进程是普通 PID。参考实现 #471：只判 ppid===1 会把 user unit
  // 判成"没人管"，然后一键重启真的把服务永久杀掉。
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'abc' }, 4321, () => 'systemd'), 'systemd')
})

check('system unit：ppid===1 成立', () => {
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'abc' }, 1, () => 'node'), 'systemd')
})

check('没有环境标记 ⇒ 不是，哪怕 ppid===1', () => {
  assert.equal(detectedSupervisor({}, 1, () => 'systemd'), null)
})

check('空串标记视作未设置（`INVOCATION_ID=` 是"没设"，不是"设了空值"）', () => {
  assert.equal(detectedSupervisor({ INVOCATION_ID: '' }, 999, () => 'systemd'), null)
})

check('parentComm 读不到（非 Linux / 权限不足）⇒ 如实返回"不是"，不抛', () => {
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'x' }, 999, () => { throw new Error('ENOENT /proc') }), null)
  assert.equal(detectedSupervisor({ INVOCATION_ID: 'x' }, 999, () => null), null)
})

check('本机真实环境不该被误判为 systemd（这台是 Windows，跑得通才说明防护成立）', () => {
  // 真实进程状态：本机没有 INVOCATION_ID，也没有 /proc。
  if (process.platform === 'win32') {
    assert.equal(detectedSupervisor(), null)
  } else {
    console.log(`      （非 win32，跳过真实环境断言：得到 ${detectedSupervisor()}）`)
  }
})

console.log('\n[2] detectedDebugger：按 token 前缀判，不用子串')

check('inspector.url() 有值', () => {
  assert.equal(detectedDebugger('ws://127.0.0.1:9229/uuid', [], ''), 'inspector')
})

check('execArgv / NODE_OPTIONS 里的 inspect 系列标志', () => {
  assert.equal(detectedDebugger('', ['--inspect'], ''), 'inspector')
  assert.equal(detectedDebugger('', ['--inspect-brk=0.0.0.0:9229'], ''), 'inspector')
  assert.equal(detectedDebugger('', ['--inspect-wait'], ''), 'inspector')
  assert.equal(detectedDebugger('', [], '--max-old-space-size=4096 --inspect'), 'inspector')
})

check('**路径里含 inspect 不算**（`inspect-tool.js` 这类误命中会把按钮无故藏起来）', () => {
  assert.equal(detectedDebugger('', ['/usr/lib/node_modules/inspect-tool.js'], ''), null)
  assert.equal(detectedDebugger('', ['--require=./my-inspect-helper.cjs'], ''), null)
  assert.equal(detectedDebugger('', [], 'NODE_OPTIONS=./inspect.js'), null)
})

check('普通启动 / 空输入', () => {
  assert.equal(detectedDebugger('', [], ''), null)
  assert.equal(detectedDebugger('', ['--max-old-space-size=4096'], ''), null)
  assert.equal(detectedDebugger('', [], '   '), null)
})

check('本机真实环境不是调试器（这条同时证明回调默认值是安全的）', () => {
  assert.equal(detectedDebugger(), null)
})

console.log('\n[3] isDesktopManagedHost：两个信号（v1.2.0 原有的那条判定，必须保持）')

check('node 模式 + IPC 通道 = 桌面壳管理的宿主', () => {
  assert.equal(isDesktopManagedHost({ env: { ELECTRON_RUN_AS_NODE: '1' }, connected: true, hasSend: true }), true)
})

check('缺任一条件都不算（终端 dsh web 不能被误伤）', () => {
  assert.equal(isDesktopManagedHost({ env: { ELECTRON_RUN_AS_NODE: '1' }, connected: false, hasSend: false }), false)
  assert.equal(isDesktopManagedHost({ env: {}, connected: true, hasSend: true }), false)
  assert.equal(isDesktopManagedHost({ env: { ELECTRON_RUN_AS_NODE: '0' }, connected: true, hasSend: true }), false)
})

console.log('\n[4] restartDecision：合成顺序（运行期闸门 > 显式设置 > 自动识别）')

check('调试器**不可**被 allowRestart: true 覆盖（与 systemd 不同：没有哪种部署该这样）', () => {
  const d = restartDecision({ allowRestart: true }, { ...clean, inspectorUrl: 'ws://x/1' })
  assert.equal(d.allowed, false)
  assert.equal(d.reason, 'inspector')
})

check('显式 true 能覆盖 systemd 的自动识别（用户对自己的部署有陈述权）', () => {
  assert.equal(restartAllowed({ allowRestart: true }, { env: { INVOCATION_ID: 'x' }, ppid: 999, parentComm: () => 'systemd' }), true)
})

check('显式 true 能覆盖桌面壳的自动识别', () => {
  assert.equal(restartAllowed({ allowRestart: true }, { ...clean, env: { ELECTRON_RUN_AS_NODE: '1' }, connected: true, hasSend: true }), true)
})

check('显式 false ⇒ disabled（即使用户环境本来没问题）', () => {
  const d = restartDecision({ allowRestart: false }, clean)
  assert.equal(d.allowed, false)
  assert.equal(d.reason, 'disabled')
})

check('桌面壳 ⇒ desktop', () => {
  const d = restartDecision({}, { ...clean, env: { ELECTRON_RUN_AS_NODE: '1' }, connected: true, hasSend: true })
  assert.equal(d.allowed, false)
  assert.equal(d.reason, 'desktop')
})

check('systemd ⇒ systemd', () => {
  const d = restartDecision({}, { env: { INVOCATION_ID: 'x' }, ppid: 999, parentComm: () => 'systemd' })
  assert.equal(d.allowed, false)
  assert.equal(d.reason, 'systemd')
})

check('干净环境 ⇒ 允许，且 reason 是 null（不是字符串 "null"）', () => {
  const d = restartDecision({}, clean)
  assert.deepEqual(d, { allowed: true, reason: null })
})

check('config 可能是 undefined / 字符串 / 数组（本插件没有 Config schema）⇒ 不能抛', () => {
  // cordis 的 resolveConfig 在没有 runtime.Config 时原样返回，所以 config 会是
  // profile 里写什么就是什么。这条路径在 /status 第一跳上跑，抛出去 = 市场打不开。
  for (const value of [undefined, null, 'nonsense', 42, [], true]) {
    const d = restartDecision(value, clean)
    assert.equal(d.allowed, true, `config=${JSON.stringify(value)} 应被当作"用户没表态"`)
  }
})

check('allowRestart 只认布尔 true：字符串 "true" 不算（不能靠真假值蒙对）', () => {
  const d = restartDecision({ allowRestart: 'true' }, clean)
  assert.equal(d.allowed, false)
  assert.equal(d.reason, 'disabled', '写了值但不是 true ⇒ 按"确实关掉了"处理并说明')
})

check('config 是对象但没写 allowRestart ⇒ 走自动识别（不等于关掉）', () => {
  assert.equal(restartAllowed({ other: 1 }, clean), true)
})

console.log('\n[5] restartBlockedHint：每种原因给出**不同的下一步**')

check('四种原因的文案互不相同，且各自点名正确的入口', () => {
  const hints = { systemd: restartBlockedHint('systemd'), desktop: restartBlockedHint('desktop'), inspector: restartBlockedHint('inspector'), disabled: restartBlockedHint('disabled') }
  const values = Object.values(hints)
  assert.equal(new Set(values).size, 4, '四种原因的说明不能合成一句')
  assert.match(hints.systemd, /systemctl/, 'systemd 要给 systemctl 入口')
  assert.match(hints.desktop, /关掉窗口|打开/, '桌面壳要给"关窗重开"')
  assert.match(hints.inspector, /调试/, '调试器要说清是调试会话')
  assert.match(hints.disabled, /allowRestart/, '显式关闭要告诉用户改哪个键')
  assert.ok(!/关掉窗口/.test(hints.systemd), 'systemd 下说"关窗重开"是毫无意义的（没有窗口）')
})

check('未知原因 ⇒ 回落到通用说明，不返回 undefined', () => {
  assert.equal(typeof restartBlockedHint('bogus'), 'string')
  assert.equal(typeof restartBlockedHint(null), 'string')
  assert.ok(restartBlockedHint('bogus').length > 0)
})

console.log('\n[6] isLoopbackAuthority：Host 必须点名回环（DNS rebinding 那道闸）')

check('回环权威（带端口 / IPv6 方括号 / 裸主机）', () => {
  assert.equal(isLoopbackAuthority('127.0.0.1:19387'), true)
  assert.equal(isLoopbackAuthority('127.0.0.1'), true)
  assert.equal(isLoopbackAuthority('localhost:8080'), true)
  assert.equal(isLoopbackAuthority('localhost'), true)
  assert.equal(isLoopbackAuthority('[::1]:3000'), true)
  assert.equal(isLoopbackAuthority('[::1]'), true)
  assert.equal(isLoopbackAuthority('0.0.0.0'), true)
})

check('**攻击者域名一律拒绝**，尤其是看起来像回环的那些', () => {
  assert.equal(isLoopbackAuthority('evil.com'), false)
  assert.equal(isLoopbackAuthority('evil.com:19387'), false)
  // 这两个是重点：前缀/后缀里带 127.0.0.1 的域名仍然不是回环权威。
  assert.equal(isLoopbackAuthority('127.0.0.1.evil.com'), false)
  assert.equal(isLoopbackAuthority('localhost.evil.com'), false)
  assert.equal(isLoopbackAuthority('evil.com/localhost'), false)
  assert.equal(isLoopbackAuthority(''), false)
  assert.equal(isLoopbackAuthority(undefined), false)
  assert.equal(isLoopbackAuthority('   '), false)
})

console.log('\n[7] 重启围墙：trustedRestartRequest（端点 enforcing）')

check('回环对端 + Host 回环 + Origin 与 Host 一致 ⇒ 放行', () => {
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' })), true)
  assert.equal(trustedRestartRequest(mk('::1', { host: '[::1]:19387', origin: 'http://[::1]:19387' })), true)
  assert.equal(trustedRestartRequest(mk('::ffff:127.0.0.1', { host: '127.0.0.1:80', origin: 'http://127.0.0.1:80' })), true)
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: 'localhost:19387', origin: 'http://localhost:19387' })), true)
})

check('**默认端口等价**：Origin 省掉 :80 而 Host 写着 :80（同一个权威，不能拒）', () => {
  // 这条是我自己的测试抓出来的真 bug：`new URL('http://127.0.0.1:80').host` 会把默认端口
  // **去掉**（得到 `127.0.0.1`），拿它和 `127.0.0.1:80` 直接比就判成不一致——于是用户
  // 在 80 端口上打开 DSH 时，点重启会被自己的围墙拒掉。
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:80', origin: 'http://127.0.0.1:80' })), true)
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1', origin: 'http://127.0.0.1:80' })), true)
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:80', origin: 'http://127.0.0.1' })), true)
  // https 默认 443 同理。
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: 'localhost:443', origin: 'https://localhost' })), true)
  // 但**端口确实不同**时仍然必须拒（等价规则不能变成"忽略端口"）。
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:81', origin: 'http://127.0.0.1:80' })), false)
  // **显式写了同一个 host:port ⇒ 同一个权威**，哪怕协议不同。
  // 这不是放宽：防的是"另一个权威"（DNS rebinding / 跨源页面），而 host+port 相同
  // 就是同一个权威；协议那一维在这里判不出攻击，参考实现（`parsed.host === host`）同理。
  // 真正挡住攻击的是「对端回环 + 无转发痕 + Host 是回环权威」这三条。
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:19387', origin: 'https://127.0.0.1:19387' })), true)
  // 主机名不同也不能因为端口一样就放过。
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: 'localhost:80', origin: 'http://127.0.0.1:80' })), false)
})

check('出现任何转发痕迹 ⇒ 拒绝（回环对端此时是代理，不是用户本人）', () => {
  const base = { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { ...base, 'x-forwarded-for': '1.2.3.4' })), false)
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { ...base, 'x-real-ip': '1.2.3.4' })), false)
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { ...base, forwarded: 'for=1.2.3.4' })), false)
})

check('DNS rebinding：对端是回环但 Host 是攻击者域名 ⇒ 拒绝', () => {
  // 这是"只查 remoteAddress"会漏掉的那一类：页面能让浏览器经由攻击者控制的域名
  // 访问到 127.0.0.1，地址证明不了什么，而 Host/Origin 都写着攻击者的域名。
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: 'evil.com', origin: 'http://evil.com' })), false)
})

check('Origin 与 Host 不一致 ⇒ 拒绝（跨源页面）', () => {
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:19387', origin: 'http://evil.com' })), false)
})

check('进程控制**不接受**缺 Origin 的请求（与下载那条不同）', () => {
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:19387' })), false)
})

check('非回环对端（局域网 / 其它地址）⇒ 拒绝', () => {
  assert.equal(trustedRestartRequest(mk('192.168.1.5', { host: '192.168.1.5:19387', origin: 'http://192.168.1.5:19387' })), false)
  assert.equal(trustedRestartRequest(mk('10.0.0.1', { host: '10.0.0.1:19387', origin: 'http://10.0.0.1:19387' })), false)
})

check('Origin 非 http(s) 协议 / 无法解析 ⇒ 拒绝', () => {
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:1', origin: 'file:///x' })), false)
  assert.equal(trustedRestartRequest(mk('127.0.0.1', { host: '127.0.0.1:1', origin: 'not a url' })), false)
})

check('请求对象残缺（无 socket / 无 headers）⇒ 拒绝而不是抛', () => {
  assert.equal(trustedRestartRequest({}), false)
  assert.equal(trustedRestartRequest({ headers: {} }), false)
  assert.equal(trustedRestartRequest(null), false)
})

console.log('\n[8] /status 的预测：reachable 与 enforcing 共用底层，但**刻意不含 Origin**')

check('无 Origin 的同源 GET（正是 /status 的形状）⇒ reachable 为 true', () => {
  // 若把 Origin 写进预测，这条会变 false，于是所有正常用户都看到"不可重启"——
  // 那是个比"少给一个按钮"严重得多的 bug。
  assert.equal(restartReachableFrom(mk('127.0.0.1', { host: '127.0.0.1:19387' })), true)
})

check('同一个请求拿去 POST ⇒ trusted 为 false（预测不是授权）', () => {
  const req = mk('127.0.0.1', { host: '127.0.0.1:19387' })
  assert.equal(restartReachableFrom(req), true)
  assert.equal(trustedRestartRequest(req), false)
})

check('预测与 enforcing 对"真的过不了"的请求一致为 false（不会说能点却 403）', () => {
  for (const req of [
    mk('192.168.1.5', { host: '192.168.1.5:1', origin: 'http://192.168.1.5:1' }),
    mk('127.0.0.1', { host: '127.0.0.1:1', origin: 'http://127.0.0.1:1', 'x-forwarded-for': '1.2.3.4' }),
    mk('127.0.0.1', { host: 'evil.com', origin: 'http://evil.com' })
  ]) {
    assert.equal(restartReachableFrom(req), false)
    assert.equal(trustedRestartRequest(req), false)
  }
})

check('directLoopbackRequest 就是两者的公共底层（不含 Origin 的那一半）', () => {
  const noOrigin = mk('127.0.0.1', { host: '127.0.0.1:19387' })
  assert.equal(directLoopbackRequest(noOrigin), true)
  assert.equal(restartReachableFrom(noOrigin), directLoopbackRequest(noOrigin))
})

console.log('\n[9] setDetectedDebuggerOverride：只给测试/诊断用')

check('覆盖能强制返回指定值，也能恢复真实检测', () => {
  try {
    setDetectedDebuggerOverride('inspector')
    assert.equal(detectedDebugger('', [], ''), 'inspector')
    assert.equal(restartDecision({ allowRestart: true }, clean).allowed, false, '覆盖期间连显式 true 也挡')
    setDetectedDebuggerOverride(null)
    assert.equal(detectedDebugger('', [], ''), null, '恢复真实检测（本机没有调试器）')
  } finally {
    setDetectedDebuggerOverride(null)
  }
})

const total = passed + failures.length
console.log(`\n按需重启判定回归：${failures.length ? `${passed}/${total} 通过，失败：${failures.join('；')}` : `${total}/${total} 全通过`}`)
if (failures.length > 0) process.exit(1)
