/**
 * 「按需重启」：能不能重启**按部署环境判**，而不是一律拒绝或一律允许。
 *
 * 现状（v1.2.0）只有一条判定：`isDesktopManagedHost()`（桌面壳）→ 拒绝。那是对的，
 * 但只覆盖了一种监管者。其余两种真实部署形态各自会出人命，而且**失败方式不一样**：
 *
 *   1. **systemd 服务**（`KillMode=control-group`，默认值）：宿主被 `process.exit` 之后，
 *      systemd 会把整个 cgroup 清掉——**包括那个本该把替代进程拉起来的分离助手**。
 *      结果是服务被杀、没有人拉起来（参考实现 #229 的真实事故：
 *      「杀死了服务但是无法重复启动服务」）。
 *   2. **桌面壳（Electron）**：壳自己持有单实例锁，替代进程启动即被挡下并静默退出；
 *      宿主已经 exit，于是应用整个关掉、不会自己回来（本仓库实测：exit=0、无输出、231–391ms）。
 *   3. **调试器附着**：`--inspect` 下重启会把调试会话打断。这个不该写进"部署"配置里
 *      （调试结束就该恢复），所以它是一条独立的运行期闸门。
 *
 * 所以这一层做三件事：
 *   - `detectedSupervisor()`：识别 systemd（两个信号，见下），认出就默认关闭一键重启；
 *   - `detectedDebugger()`：识别调试器，运行期闸门，**显式 true 也不覆盖**；
 *   - `restartAllowed()`：把上面两条与用户显式设置合成一个答案。
 *
 * ## 为什么 systemd 的判定要两个信号
 *
 * `INVOCATION_ID` 是**继承**的：一个 unit 的所有后代都带着它，Linux 上一台普通桌面
 * 终端（它的 shell 源自某个 user session unit）和 CI runner（agent 自己是个 unit）都有。
 * 只看这个变量会把大量"重启其实完全没问题"的宿主也关掉——那是比要修的 bug 更坏的 bug。
 *
 * 第二个信号是**父进程**：只有「unit 自己的主进程」才由 systemd 直接 fork。
 * 一个终端的 node 父进程是 shell、CI 里是 agent。判定写成 `ppid === 1 || 父进程 comm 是 systemd`：
 *   - `ppid === 1` 只对 **system unit** 成立；
 *   - **user unit**（`systemd --user`）的主进程父进程是一个普通 PID，`comm` 才是 `systemd`
 *     ——参考实现 #471 就是因为只判 `ppid === 1`，把 user unit 判成"没人管"，
 *     然后一键重启真的把服务永久杀掉（日志齐全：干净 SIGTERM 退出 → `Restart=on-failure`
 *     不触发 → `KillMode=mixed` 在助手拉起替代进程前 SIGKILL 掉它）。
 *   `/proc` 只在 Linux 有，而 systemd 也只在 Linux——范围正好对齐；读不到就如实返回"不是"。
 *
 * pm2 与 launchd **故意不识别**：pm2 的 `pm_id` 同样是继承的，而它的 God daemon 不是 PID 1，
 * 没有第二个信号可以区分"是 pm2 的服务"与"只是 pm2 的后代"；launchd 连标记都没有。
 * 猜一个就会把上面那个假阳性重新引入。这两种部署要靠显式的 `allowRestart: false`——
 * 自动识别是**安全网**，不是那个选项的替代品。
 *
 * ## 显式设置仍然优先
 *
 * 用户写了 `allowRestart: true` 就是对自己部署的陈述（已经配了 `KillMode=process`，
 * 或者外面套了一层能活下来的 wrapper）。那不该被自动识别推翻——自动识别的价值在于
 * 「用户没写任何东西时，默认值落在安全的一侧」，而不是替用户改主意。
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** 延迟取 inspector 模块：它只在真的需要判定时才加载（静态 import 会强制加载）。 */
const require = createRequire(import.meta.url)
let inspectorModule
function inspectorUrl() {
  if (inspectorModule === undefined) {
    try {
      inspectorModule = require('node:inspector')
    } catch {
      inspectorModule = null
    }
  }
  try {
    const url = inspectorModule?.url?.()
    return typeof url === 'string' ? url : ''
  } catch {
    return ''
  }
}

/** 调试器闸门的覆盖（测试/诊断用）。`undefined` = 用真实信号。 */
let debuggerOverride

/** 显式覆盖调试器判定；传 `undefined` 恢复真实检测。 */
export function setDetectedDebuggerOverride(value) {
  debuggerOverride = value === undefined || value === null ? undefined : value
}

/** 读 `pid` 的 comm，读不到返回 null。 */
function readParentComm(pid) {
  if (process.platform !== 'linux') return null
  try {
    return readFileSync(`/proc/${String(pid)}/comm`, 'utf8').trim()
  } catch {
    return null
  }
}

/**
 * 本进程的监管者，认不出返回 null。
 *
 * 两个信号缺一不可（见文件头的完整推理）：环境标记是**继承**的，父进程才是区分
 * 「我是这个 unit 的主进程」与「我只是它的后代」的那一条。
 *
 * @param env - 读 INVOCATION_ID / JOURNAL_STREAM 的环境。
 * @param ppid - 父进程号，缺省 `process.ppid`。
 * @param parentComm - 读父进程 comm 的函数（测试注入）。
 * @returns `'systemd'` 或 `null`。
 */
export function detectedSupervisor(env = process.env, ppid = process.ppid, parentComm = readParentComm) {
  const set = (name) => typeof env?.[name] === 'string' && env[name] !== ''
  if (!set('INVOCATION_ID') && !set('JOURNAL_STREAM')) return null
  if (ppid === 1) return 'systemd'
  try {
    if (parentComm(ppid) === 'systemd') return 'systemd'
  } catch {
    return null
  }
  return null
}

/** `--inspect` 系列标志（按 token 前缀判，不用子串——`inspect-tool.js` 这种路径不能误命中）。 */
function argvHasInspectFlag(tokens) {
  for (const token of tokens) {
    if (typeof token !== 'string') continue
    if (token === '--inspect' || token === '--inspect-wait') return true
    if (token.startsWith('--inspect=') || token.startsWith('--inspect-brk')) return true
  }
  return false
}

/**
 * 本进程是不是在调试器下，是就返回 `'inspector'`，否则 null。
 *
 * 三个来源依次看：`inspector.url()`（覆盖启动时的 `--inspect`、运行期 `inspector.open()`、
 * SIGUSR1 附着）、`process.execArgv`、`NODE_OPTIONS`。
 *
 * **显式 `allowRestart: true` 也不覆盖这条**：与 systemd 不同，「从市场界面杀掉一个
 * 正被调试的宿主」不存在任何一种合理的部署形态。这里是**运行期**闸门而不是配置项，
 * 因为调试结束就该自动恢复——把它写进配置会让开关在调试器断开之后仍然停在关闭态。
 */
export function detectedDebugger(inspectorUrlOverride, execArgv, nodeOptions) {
  if (debuggerOverride !== undefined) return debuggerOverride
  const url = inspectorUrlOverride === undefined ? inspectorUrl() : inspectorUrlOverride
  if (typeof url === 'string' && url !== '') return 'inspector'
  const argv = execArgv === undefined ? process.execArgv : execArgv
  if (argvHasInspectFlag(Array.isArray(argv) ? argv : [])) return 'inspector'
  const options = nodeOptions === undefined ? (process.env.NODE_OPTIONS ?? '') : nodeOptions
  const text = typeof options === 'string' ? options.trim() : ''
  if (text !== '' && argvHasInspectFlag(text.split(/\s+/))) return 'inspector'
  return null
}

/**
 * 本进程是不是**官方桌面壳（Electron）管理的宿主子进程**。
 *
 * 这是 v1.2.0 就有的判定，原样保留（推理见 restart.js 的长注释）：
 * 桌面端拓扑是「GUI 主进程持单实例锁 → spawn(node, ['--expose-internals', entry, …],
 * { env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: [...,'ipc'] })」。两个信号缺一不可：
 * 只看 `ELECTRON_RUN_AS_NODE` 会误伤本模块自己的助手（它也设这个变量）；
 * 而终端 `dsh web` 的宿主没有 IPC 通道（`process.connected` 为 false），那条路重启是好的。
 */
export function isDesktopManagedHost(options = {}) {
  const env = options.env ?? process.env
  const connected = options.connected ?? (typeof process.connected === 'boolean' ? process.connected : false)
  const hasSend = options.hasSend ?? typeof process.send === 'function'
  return env.ELECTRON_RUN_AS_NODE === '1' && connected === true && hasSend === true
}

/**
 * 能不能一键重启，以及**为什么不能**。
 *
 * 返回 `{ allowed, reason }`：`reason` 是可读的机器原因（`'systemd'` / `'desktop'` /
 * `'inspector'` / `'disabled'`），客户端据此给不同文案——「桌面版请关窗重开」与
 * 「这是 systemd 服务，请用 systemctl restart」是两句不同的话，不能都写成一句。
 *
 * 判定顺序（先看无法被配置覆盖的运行期闸门）：
 *   1. 调试器 → 拒绝（显式 true 也不覆盖）；
 *   2. 用户显式设置 → 直接采用；
 *   3. 桌面壳 → 拒绝；
 *   4. systemd → 拒绝；
 *   5. 其余 → 允许。
 */
export function restartDecision(config = {}, options = {}) {
  const env = options.env ?? process.env
  const ppid = options.ppid ?? process.ppid
  const parentComm = options.parentComm ?? readParentComm
  // config 来自 profile 的 `config:` 段，本插件没有 Config schema（cordis 会原样透传），
  // 所以它可能是 undefined / null / 字符串 / 数组。只认「对象上的 allowRestart」，
  // 其余一律当作"用户没表态"——在这里对一个非对象取属性会抛错，而这条路径在
  // 启动时就会跑（/status 第一跳），抛出去会让整个市场打不开。
  const settings = config !== null && typeof config === 'object' ? config : {}
  const explicit = settings.allowRestart

  const debuggerKind = detectedDebugger(options.inspectorUrl, options.execArgv, options.nodeOptions)
  if (debuggerKind !== null) return { allowed: false, reason: 'inspector' }

  if (explicit !== undefined) {
    return { allowed: explicit === true, reason: explicit === true ? null : 'disabled' }
  }

  if (isDesktopManagedHost({ env, connected: options.connected, hasSend: options.hasSend })) {
    return { allowed: false, reason: 'desktop' }
  }

  const supervisor = detectedSupervisor(env, ppid, parentComm)
  if (supervisor !== null) return { allowed: false, reason: supervisor }

  return { allowed: true, reason: null }
}

/** 便捷包装：只问能不能。 */
export function restartAllowed(config = {}, options = {}) {
  return restartDecision(config, options).allowed === true
}

/**
 * 把「为什么不能重启」翻成给用户看的一句话。
 *
 * 每一种原因对应**不同的下一步动作**，混成一句会让用户去试一个不可能成功的办法
 * （参考实现 #782 的教训：状态轮询要能说出横幅上为什么没有按钮）。
 */
export function restartBlockedHint(reason) {
  switch (reason) {
    case 'systemd':
      return '当前宿主是 systemd 服务：systemd 默认 KillMode=control-group，会连重启助手一起清掉，'
        + '结果服务被杀且不会自己回来。请用 systemctl restart <服务名> 重启。'
        + '（若你的 unit 已配好 KillMode=process 并能自行拉起，可在 profile 的 config 下写 allowRestart: true 覆盖这个判断。）'
    case 'desktop':
      return '当前宿主由桌面壳启动，它自己持有单实例锁——从市场拉起的替代进程会被锁挡下并静默退出，'
        + '结果是应用整个关掉且不会自己回来。请用桌面壳自己的入口重启：关掉窗口再打开应用。'
    case 'inspector':
      return '当前宿主正被调试器附着（--inspect），重启会打断调试会话，所以这里不提供一键重启。'
        + '这个判断不能被 allowRestart 覆盖；要恢复一键重启请先断开调试器。'
    case 'disabled':
      return '当前 profile 显式关掉了允许重启。要恢复：把 config 下的 allowRestart 改成 true 或删掉它，'
        + '然后重启 DSH。'
    default:
      return '这个环境里不能用一键重启；请手动重启 DSH。'
  }
}

/**
 * Origin 与 Host 是不是同一个权威（authority）。
 *
 * **不能直接比 `new URL(origin).host === host`**：URL 会把**默认端口**去掉
 * （`http://127.0.0.1:80` 的 `.host` 是 `127.0.0.1`），而 Host 头可能写成
 * `127.0.0.1:80`。两者其实是同一个权威，直接比就判成不一致 —— 于是本机页面的
 * 重启请求被自己拒掉（实测：`::ffff:127.0.0.1` + `Host: 127.0.0.1:80` → false）。
 *
 * 所以按「主机名（大小写无关）+ 有效端口」比：端口缺省时按协议补
 * （http→80、https→443），两边都补完再比。
 */
function sameAuthority(origin, hostHeader) {
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const expectedPort = parsed.port !== '' ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80)
  const actual = splitAuthority(hostHeader)
  if (actual === null) return false
  const actualPort = actual.port !== null ? actual.port : expectedPort
  // 两边都去方括号再比：`new URL('http://[::1]:x').hostname` 是 **`[::1]`**（带括号），
  // 而 Host 头拆出来的 hostname 是 `::1`（无括号）——不归一化就永远判不一致，
  // IPv6 下的本机页面会被自己的围墙拒掉（实测）。
  return stripBrackets(actual.hostname).toLowerCase() === stripBrackets(parsed.hostname).toLowerCase()
    && actualPort === expectedPort
}

/** 去掉 IPv6 的方括号。 */
function stripBrackets(hostname) {
  const text = String(hostname)
  return text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
}

/** 把 `host[:port]`（IPv6 是 `[::1][:port]`）拆成 `{hostname, port}`；port 缺省为 null。 */
function splitAuthority(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  if (text.startsWith('[')) {
    const end = text.indexOf(']')
    if (end === -1) return null
    const hostname = text.slice(1, end)
    const rest = text.slice(end + 1)
    if (rest === '') return { hostname, port: null }
    if (!rest.startsWith(':')) return null
    const port = Number(rest.slice(1))
    return Number.isInteger(port) && port > 0 && port < 65536 ? { hostname, port } : null
  }
  const colon = text.lastIndexOf(':')
  // 没有冒号 ⇒ 无端口。多于一个冒号且不是 IPv6 方括号形式 ⇒ 不是合法权威。
  if (colon === -1) return { hostname: text, port: null }
  if (text.indexOf(':') !== colon) return null
  const hostname = text.slice(0, colon)
  if (hostname === '') return null
  const port = Number(text.slice(colon + 1))
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) return null
  return { hostname, port }
}

/**
 * 端点判定用的「可信重启请求」围墙。
 *
 * 除同源之外还要**直连回环**，因为转发来的请求不是用户本人：
 *   - 对端必须是 `127.0.0.1` / `::1`（含 `::ffff:127.0.0.1` 这种映射形式）；
 *   - 出现任何转发痕迹（`Forwarded` / `X-Forwarded-For` / `X-Real-IP`）就拒绝——
 *     回环对端此时是个代理，不是用户；
 *   - **Host 必须是回环权威**。只有"对端是回环"不够：DNS rebinding 页面能让浏览器
 *     经由攻击者控制的域名访问到 127.0.0.1，此时地址证明不了什么，而 Host 与 Origin
 *     都写着攻击者的域名。Host 是攻击者伪造不了的那一项。
 *
 * Origin 只在这里判；`restartReachableFrom`（给 /status 用的**预测**）故意不含 Origin，
 * 因为普通的同源 GET 不带 Origin——把 Origin 写进预测会让所有正常请求都显示"不可重启"。
 */
export function trustedRestartRequest(request) {
  if (!directLoopbackRequest(request)) return false
  const origin = request?.headers?.origin
  const host = request?.headers?.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  return sameAuthority(origin, host)
}

/** 直连回环判定（不含 Origin）——端点 enforcing 与 /status 预测共用一个，避免两处漂移。 */
export function directLoopbackRequest(request) {
  const address = request?.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const headers = request?.headers ?? {}
  if (headers.forwarded !== undefined || headers['x-forwarded-for'] !== undefined || headers['x-real-ip'] !== undefined) {
    return false
  }
  return isLoopbackAuthority(headers.host)
}

/**
 * `/status` 对「同源页面的重启请求能不能过围墙」的**预测**。
 *
 * 刻意不含 Origin（同源 GET 本就不带），也不构成授权——POST 那条路仍然跑完整判定。
 * 意义在于：横幅能说出**为什么**没有按钮，而不是渲染一个必然 403 的按钮。
 */
export function restartReachableFrom(request) {
  return directLoopbackRequest(request)
}

/** Host 是不是回环权威（`127.0.0.1`、`localhost`、`[::1]`，可带端口）。 */
export function isLoopbackAuthority(host) {
  if (typeof host !== 'string' || host.trim() === '') return false
  const value = host.trim()
  // 带端口：IPv6 是 `[::1]:port`，IPv4/域名是 `host:port`。
  let hostname = value
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end === -1) return false
    hostname = value.slice(1, end)
  } else {
    const colon = value.lastIndexOf(':')
    if (colon !== -1) hostname = value.slice(0, colon)
  }
  const lowered = hostname.toLowerCase()
  return lowered === 'localhost' || lowered === '127.0.0.1' || lowered === '::1' || lowered === '0.0.0.0'
}
