/**
 * 重启助手（detached helper）：等宿主进程退出，再用它原来的命令行把进程拉回来。
 *
 * 由 lib/restart.js 以 `node restart-helper.cjs <base64(payload)>` 启动，detached：
 * 宿主 process.exit 不会把它带走。载荷字段：
 *   { pid, execPath, args, waitMs, pollMs }
 *   pid     —— 要等死的宿主进程号
 *   execPath/args —— 重新拉起用的可执行文件与完整 argv（宿主自己的 process.argv）
 *   waitMs  —— 等待上限：父进程一直不死就放弃，绝不无父拉起（防双实例）
 *   pollMs  —— 轮询间隔
 *
 * 两条铁律：
 *   1. 父进程**真的不在了**才拉起（kill(pid, 0) 抛错才算死；EPERM 视为还活着）；
 *   2. 拉起前删掉 ELECTRON_RUN_AS_NODE——本助手自己就是靠它以 node 身份跑的，
 *      留着它会把新宿主也变成 node 模式（桌面端黑窗、没界面）。
 */
'use strict'

const { spawn } = require('node:child_process')

function readPayload() {
  const raw = process.argv[2]
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
    if (!payload || typeof payload !== 'object') return null
    if (!Number.isInteger(payload.pid) || payload.pid <= 0) return null
    if (typeof payload.execPath !== 'string' || payload.execPath === '') return null
    if (!Array.isArray(payload.args) || payload.args.some((value) => typeof value !== 'string')) return null
    const waitMs = Number.isFinite(payload.waitMs) && payload.waitMs >= 100 ? payload.waitMs : 60000
    const pollMs = Number.isFinite(payload.pollMs) && payload.pollMs >= 10 ? payload.pollMs : 300
    return { pid: payload.pid, execPath: payload.execPath, args: payload.args, waitMs, pollMs }
  } catch {
    return null
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM：进程存在但不是我们的——按「还活着」处理，宁可多等也不双开。
    return !!(error && error.code === 'EPERM')
  }
}

const payload = readPayload()
if (payload === null) {
  // 载荷不合法：不猜、不拉起，安静退出（宿主侧已经在 spawn 前校验过，这里是兜底）。
  process.exit(0)
}

const deadline = Date.now() + payload.waitMs
const timer = setInterval(() => {
  if (isAlive(payload.pid)) {
    if (Date.now() >= deadline) {
      // 父进程一直没死：放弃。此时拉起 = 双实例（端口、单实例锁都会撞）。
      clearInterval(timer)
      process.exit(0)
    }
    return
  }
  clearInterval(timer)
  const env = { ...process.env }
  // 关键：助手靠 ELECTRON_RUN_AS_NODE 以 node 身份运行；新宿主必须以正常身份启动。
  delete env.ELECTRON_RUN_AS_NODE
  try {
    // detached 是**实测必需**（Windows 上非 detached 的子进程会随创建者退出一起被带走，
    // 本仓库的探针：detached-delay 存活、node-delay 全灭）——不加它，助手一退出，
    // 刚拉起的宿主就没了，重启表现为「黑一下然后什么都没发生」。
    // 代价（如实记录）：重启后的进程不在终端的默认 Ctrl+C 目标里，结束它要用
    // DSH 自己的退出方式或 taskkill；见 docs/RELEASING.md §5。
    const child = spawn(payload.execPath, payload.args, { stdio: 'inherit', env, detached: true, windowsHide: true })
    if (child && typeof child.on === 'function') {
      // 实测：spawn 失败（ENOENT）的 'error' 事件约 1ms 后才到，而本函数紧接着就同步
      // process.exit(0)，所以**这个 handler 当前不可达**（独立审计发现，我用探针复现：
      // 传不存在的 execPath，助手 exit 0 且 stdout/stderr 全空）。
      // 仍然保留它，是因为它同时是「万一将来去掉下面那次同步 exit」的保险：
      // EventEmitter 在**没有** 'error' 监听时会直接抛，把助手变成非 0 退出。
      // 实测去掉监听在当前写法下也是 exit 0（同步退出先于事件），所以留着是零成本的防御。
      // 客户端的恢复手段不依赖这里：它有界等待超时后会提示用户手动重启。
      child.on('error', () => {
        process.exit(0)
      })
    }
    if (child && typeof child.unref === 'function') child.unref()
  } catch {
    process.exit(0)
  }
  process.exit(0)
}, payload.pollMs)
