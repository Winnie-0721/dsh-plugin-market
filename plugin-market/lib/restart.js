/**
 * 重启助手（host 半）：把「重启 DSH」从一句提示变成一个真动作。
 *
 * 形态是**分离等待再拉起**（detached wait-and-relaunch），与官方 dsh-market 的做法同构：
 *   1. 端点先 spawn 一个脱离宿主进程的助手（detached），确认拿到 pid 才回 200；
 *   2. 宿主在响应落地后自己 process.exit（RESTART_EXIT_DELAY_MS 给响应留时间）；
 *   3. 助手轮询父进程死亡（有界等待 RESTART_HELPER_WAIT_MS），然后用宿主原来的
 *      execPath + argv 重新拉起进程——单实例锁、端口占用这类「新旧实例打架」的问题
 *      都因为「等死透了再起」而不存在。
 *
 * 关键细节（每条都是会真出事的）：
 *   - 助手用 ELECTRON_RUN_AS_NODE=1 才能在桌面端（Electron）里当 node 跑脚本；
 *     拉起新宿主前必须把这个变量**删掉**，否则桌面端会被当成 node 模式拉起（黑窗、没界面）。
 *   - 助手必须 detached：宿主退出不能把它一起带走；windowsHide 避免 Windows 上弹黑窗。
 *   - 助手活着不等于重启会成功：helper 脚本文件缺失、参数不合法都在 spawn 前拒绝，
 *     绝不「先退出再说」——宿主一旦退出，没人再负责把新进程拉起来。
 *   - 幂等：同一次重启流程里第二次请求不再 spawn 第二个助手（两个助手会拉起两个宿主）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 响应落地到进程退出的延迟：短到用户不等，长到 TCP 缓冲一定写出去。 */
export const RESTART_EXIT_DELAY_MS = 900

/** 助手等父进程死亡的上限；到点还没死就放弃（绝不无父拉起，避免双实例）。 */
export const RESTART_HELPER_WAIT_MS = 60 * 1000

/** 助手的轮询间隔。 */
export const RESTART_HELPER_POLL_MS = 300

/** 助手脚本：与本模块同目录，随包发布（package.json files 含 lib/）。 */
export function helperPath() {
  return fileURLToPath(new URL('./restart-helper.cjs', import.meta.url))
}

/**
 * 组装传给助手的载荷（base64(JSON) 单参数，避免命令行转义问题）。
 * 参数不合法返回 null，调用方按「启动失败」报错，不 spawn。
 */
export function buildRestartPayload(options = {}) {
  const pid = Number(options.pid)
  const execPath = typeof options.execPath === 'string' ? options.execPath : ''
  const args = Array.isArray(options.args) ? options.args : null
  const waitMs = Number.isFinite(options.waitMs) ? Number(options.waitMs) : RESTART_HELPER_WAIT_MS
  const pollMs = Number.isFinite(options.pollMs) ? Number(options.pollMs) : RESTART_HELPER_POLL_MS
  if (!Number.isInteger(pid) || pid <= 0) return null
  if (execPath === '') return null
  if (args === null || args.some((value) => typeof value !== 'string')) return null
  if (waitMs < 100 || pollMs < 10) return null
  const payload = { pid, execPath, args, waitMs, pollMs }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

/**
 * 助手的启动规格（纯函数，便于测试）：{ ok, command } | { ok:false, message, hint }。
 * spawnImpl / existsSyncImpl 可注入——测试不真拉进程。
 */
export function buildHelperCommand(options = {}) {
  const spawnImpl = options.spawnImpl || spawn
  const existsSyncImpl = options.existsSyncImpl || existsSync
  const script = typeof options.helperFile === 'string' ? options.helperFile : helperPath()
  if (!existsSyncImpl(script)) {
    return {
      ok: false,
      message: '重启助手脚本不见了。',
      hint: `找不到 ${script}；重新安装插件（或从 GitHub Release 重装本体）后再试。`
    }
  }
  const payload = buildRestartPayload(options)
  if (payload === null) {
    return {
      ok: false,
      message: '重启参数不合法。',
      hint: '宿主没能给出自己的进程信息（pid/execPath/argv）；手动重启 DSH 后再试。'
    }
  }
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  return {
    ok: true,
    command: {
      file: options.execPath || process.execPath,
      args: [script, payload],
      options: {
        // detached：宿主退出不带走助手；stdio inherit：终端启动的宿主，重启后日志还在同一控制台；
        // windowsHide：Windows 上不弹黑窗。
        detached: true,
        stdio: 'inherit',
        windowsHide: true,
        env
      }
    },
    spawnImpl: spawnImpl
  }
}

/**
 * 启动助手。返回 { ok:true, pid, already? } | { ok:false, message, hint }。
 * state 可注入（测试用），默认是模块级的这一次重启的记账。
 */
export function spawnRestartHelper(options = {}) {
  const state = options.state || restartState
  if (state.requested === true) {
    // 幂等：上一次请求已经把助手安排好了，回 already 而不是再拉一个（双助手 = 双宿主）。
    return { ok: true, pid: state.pid, already: true }
  }
  // 默认参数就是**当前宿主进程自己**：端点调用就是 spawnRestartHelper()（不带参数）。
  // 这里必须给默认值——早先版本没给，结果真实调用 100% 落进「重启参数不合法」，
  // 用户实测点「重启 DSH」直接报错（单元测试都显式传参，恰好绕过了这条生产路径）。
  const built = buildHelperCommand({
    pid: process.pid,
    execPath: process.execPath,
    args: process.argv.slice(1),
    ...options
  })
  if (built.ok !== true) {
    return { ok: false, message: built.message, hint: built.hint }
  }
  try {
    const child = built.spawnImpl(built.command.file, built.command.args, built.command.options)
    // 'error' 监听必须在任何提早 return **之前**挂上：spawn 失败（如 ENOENT、可执行文件被
    // 自更新换掉）是**异步**事件，child.pid 只是 undefined，spawn 本身不抛错。早先这里先
    // 判 pid<=0 再挂监听，那条路径会把一个没人处理的 'error' 事件留在 EventEmitter 上，
    // Node 直接以未捕获异常终止宿主——用户看到 500 之后进程就没了。
    if (child && typeof child.on === 'function') {
      child.on('error', (error) => {
        console.error('[deepseek-harness-market] 重启助手异常：', error)
      })
    }
    const pid = child && typeof child.pid === 'number' ? child.pid : 0
    if (pid <= 0) {
      if (child && typeof child.unref === 'function') child.unref()
      return {
        ok: false,
        message: '重启助手没能启动。',
        hint: '看宿主日志里 deepseek-harness-market 的记录；仍不行就手动重启 DSH。'
      }
    }
    if (typeof child.unref === 'function') child.unref()
    state.requested = true
    state.pid = pid
    return { ok: true, pid }
  } catch (error) {
    return {
      ok: false,
      message: '重启助手没能启动。',
      hint: `宿主报错：${error && error.message ? error.message : String(error)}；手动重启 DSH 后再试。`
    }
  }
}

/** 模块级记账：一次重启只需要一个助手。 */
const restartState = { requested: false, pid: null }
