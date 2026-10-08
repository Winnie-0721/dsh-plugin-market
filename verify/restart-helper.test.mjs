/**
 * 重启助手回归测试（离线；绝不重启真实 DSH）。
 *
 * 覆盖两层：
 *  1. 纯函数面——载荷校验、启动规格（detached / 隐藏黑窗 / ELECTRON_RUN_AS_NODE）、幂等；
 *  2. 真助手行为——用 node 当替身宿主跑真 restart-helper.cjs：
 *     a. 父进程已死 → 拉起「新进程」，且拉起前删掉了 ELECTRON_RUN_AS_NODE（桌面端铁律）；
 *     b. 父进程活着 → 等到期限直接放弃，绝不拉起（防双实例）。
 *
 * 契约依据：docs/API-CONTRACT.md §2.10。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RESTART_EXIT_DELAY_MS,
  RESTART_HELPER_WAIT_MS,
  buildHelperCommand,
  buildRestartPayload,
  helperPath,
  isDesktopManagedHost,
  spawnRestartHelper
} from '../plugin-market/lib/restart.js'

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
async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(100)
  }
  assert.fail(message)
}

console.log('\n[1] 启动规格（纯函数）')

check('**桌面壳管理的宿主必须拒绝一键重启**（否则杀掉应用且不会有替代品起来）', () => {
  // 第四轮独立审计报的 HIGH，我核对了壳内源码与活动进程表确认：
  //   7872  `DeepSeek Harness.exe`                        ← GUI 主进程，持有 Electron 单实例锁
  //   19496 `…exe --expose-internals <entry> …`           ← 宿主，7872 用 stdio 末项 'ipc' 拉起的子进程
  // 壳源码（app.asar/lib/main.js）：`spawn(this.node, ['--expose-internals', entry, …],
  //   { stdio: ['ignore','pipe','pipe','ipc'], env: desktopNodeEnvironment(...) })`，
  // 而 desktopNodeEnvironment 设 `ELECTRON_RUN_AS_NODE: '1'`；
  // `claimDesktopSingleInstance()` 里 `if (!application.requestSingleInstanceLock()) application.quit()`。
  // 助手删掉那个变量后拉起同一个 exe = **启动 GUI**，它拿不到锁 → 立刻 quit（实测 exit=0、无输出、231–391ms），
  // 于是 19496 已退出、替代品也死了，**整个应用什么都不剩**。
  // 所以这条路必须**提前拒绝**，而不是先退出再赌。
  const isDesktop = isDesktopManagedHost({ env: { ELECTRON_RUN_AS_NODE: '1' }, connected: true, hasSend: true })
  assert.equal(isDesktop, true, 'node 模式 + IPC 通道 = 桌面壳管理的宿主')

  // 判定的两个必要条件缺一不可，避免误伤：
  // 终端里 `dsh web` 的宿主没有 IPC 通道（process.connected 为 false），重启是正常可用的。
  assert.equal(isDesktopManagedHost({ env: { ELECTRON_RUN_AS_NODE: '1' }, connected: false, hasSend: false }), false,
    '没有 IPC 通道 ⇒ 不是桌面壳管理的宿主（终端启动的宿主不能被误伤）')
  assert.equal(isDesktopManagedHost({ env: {}, connected: true, hasSend: true }), false,
    '没有 ELECTRON_RUN_AS_NODE ⇒ 不是桌面端（普通 node 宿主）')

  // 而且真的拒绝，且**不 spawn**、不置 requested（否则第二次点击会回 already:true 却不重启）。
  const spawns = []
  const outcome = spawnRestartHelper({
    state: {},
    desktopManaged: true,
    spawnImpl: () => { spawns.push(1); return { pid: 123, on() {}, unref() {} } }
  })
  assert.equal(outcome.ok, false, '桌面端必须拒绝')
  assert.equal(outcome.code, 'desktop-managed')
  assert.match(outcome.hint, /关掉窗口再打开|单实例锁/, '要给出正确的入口，而不是「重试」')
  assert.equal(spawns.length, 0, '拒绝时绝不能 spawn 助手（否则宿主仍会退出）')

  // 反向保证：非桌面端必须照常工作（收紧不能把正常路径一起掐掉）。
  const okSpawns = []
  const ok = spawnRestartHelper({
    state: {},
    desktopManaged: false,
    pid: process.pid,
    execPath: process.execPath,
    args: ['-e', '0'],
    spawnImpl: () => { okSpawns.push(1); return { pid: 456, on() {}, unref() {} } }
  })
  assert.equal(ok.ok, true, '非桌面端仍要能重启')
  assert.equal(okSpawns.length, 1)
})

check('helper 脚本文件存在（随包发布：package.json files 含 lib/）', () => {
  assert.ok(existsSync(helperPath()), `找不到 ${helperPath()}`)
})

check('载荷校验：不合法参数返回 null（调用方按启动失败报错，不 spawn）', () => {
  assert.equal(buildRestartPayload({ pid: 0, execPath: 'x', args: [] }), null, 'pid 必须是正整数')
  assert.equal(buildRestartPayload({ pid: 42 }), null, '缺 execPath')
  assert.equal(buildRestartPayload({ pid: 42, execPath: 'x' }), null, '缺 args')
  assert.equal(buildRestartPayload({ pid: 42, execPath: 'x', args: [1] }), null, 'args 必须全是字符串')
  assert.equal(buildRestartPayload({ pid: 42, execPath: 'x', args: [], waitMs: 10 }), null, 'waitMs 下限保护')
  const payload = buildRestartPayload({ pid: 42, execPath: process.execPath, args: ['--flag'] })
  const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  assert.deepEqual(decoded, { pid: 42, execPath: process.execPath, args: ['--flag'], waitMs: RESTART_HELPER_WAIT_MS, pollMs: 300 })
})

check('启动规格：detached + 不弹黑窗 + 以 node 身份跑助手（ELECTRON_RUN_AS_NODE=1）', () => {
  const built = buildHelperCommand({ pid: 42, execPath: process.execPath, args: ['a'] })
  assert.equal(built.ok, true, JSON.stringify(built))
  assert.equal(built.command.options.detached, true, '宿主退出不能带走助手')
  assert.equal(built.command.options.windowsHide, true, 'Windows 上不能弹黑窗')
  assert.equal(built.command.options.env.ELECTRON_RUN_AS_NODE, '1', '桌面端要靠它以 node 跑脚本')
  assert.equal(built.command.args[0], helperPath(), '第一个参数是助手脚本')
  assert.ok(Number.isInteger(RESTART_EXIT_DELAY_MS) && RESTART_EXIT_DELAY_MS >= 300 && RESTART_EXIT_DELAY_MS <= 5000, '退出延迟要给响应留落地时间')
})

check('helper 文件缺失 → spawn 之前就拒绝（绝不「先退出再说」）', () => {
  const built = buildHelperCommand({ helperFile: join(tmpdir(), 'dshpm-definitely-missing.cjs'), pid: 1, execPath: 'x', args: [] })
  assert.equal(built.ok, false)
  assert.match(built.message, /不见了/, '要说清楚是脚本不见了')
})

check('幂等：第二次请求不拉第二个助手（双助手 = 双宿主）', () => {
  const state = {}
  const spawns = []
  const fakeSpawn = () => {
    spawns.push(1)
    return { pid: 777, on() {}, unref() {} }
  }
  const opts = { state, spawnImpl: fakeSpawn, pid: 1, execPath: process.execPath, args: [] }
  const first = spawnRestartHelper(opts)
  const second = spawnRestartHelper(opts)
  assert.equal(first.ok, true)
  assert.equal(first.pid, 777)
  assert.equal(second.ok, true)
  assert.equal(second.already, true, '第二次要回 already')
  assert.equal(spawns.length, 1, '只 spawn 了一次')
})

check('spawn 直接抛错 → 如实报失败（带宿主原因，不装成功）', () => {
  const state = {}
  const result = spawnRestartHelper({
    state,
    spawnImpl: () => { throw new Error('boom') },
    pid: 1,
    execPath: process.execPath,
    args: []
  })
  assert.equal(result.ok, false)
  assert.match(result.hint, /boom/, '错误原因要带到 hint 里')
})

check('生产调用形状：端点是不带参数调用的，默认载荷必须是当前宿主自己（用户实测踩过）', () => {
  // 回归背景：早先版本没给默认值，真实调用 100% 落进「重启参数不合法」，
  // 用户点「重启 DSH」直接报错——当时的单元测试全都显式传参，恰好绕过这条路径。
  const state = {}
  const seen = {}
  const fakeSpawn = (file, args) => {
    seen.file = file
    seen.payload = JSON.parse(Buffer.from(args[1], 'base64').toString('utf8'))
    return { pid: 4242, on() {}, unref() {} }
  }
  const result = spawnRestartHelper({ state, spawnImpl: fakeSpawn })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(seen.payload.pid, process.pid, 'pid 必须是当前进程')
  assert.equal(seen.payload.execPath, process.execPath, 'execPath 必须是当前可执行文件')
  assert.deepEqual(seen.payload.args, process.argv.slice(1), 'args 必须是原命令行（去掉 execPath）')
})

console.log('\n[2] 真助手行为（node 替身宿主，不碰真实 DSH）')

const tmp = mkdtempSync(join(tmpdir(), 'dshpm-restart-test-'))
try {
  await checkAsync('父进程已死 → 拉起新进程，且拉起前删掉 ELECTRON_RUN_AS_NODE', async () => {
    // 先造一个「确定死透」的进程号：起一个短命子进程，等它退出后用它的 pid。
    const corpse = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    await new Promise((resolve) => corpse.on('exit', resolve))
    const deadPid = corpse.pid
    assert.ok(Number.isInteger(deadPid), '应当拿到替身宿主的 pid')

    const marker = join(tmp, 'launched.json')
    const payload = buildRestartPayload({
      pid: deadPid,
      execPath: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ elec: process.env.ELECTRON_RUN_AS_NODE || 'unset' }))`],
      waitMs: 5000,
      pollMs: 100
    })
    const helper = spawn(process.execPath, [helperPath(), payload], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    })
    helper.unref()
    await waitFor(() => existsSync(marker), 8000, '父进程死了，助手应拉起新进程并写入 marker')
    const info = JSON.parse(readFileSync(marker, 'utf8'))
    assert.equal(info.elec, 'unset', '拉起前必须删掉 ELECTRON_RUN_AS_NODE（否则桌面端变 node 模式黑窗）')
  })

  await checkAsync('父进程活着 → 等到期限就放弃，绝不拉起（防双实例）', async () => {
    const marker = join(tmp, 'never.json')
    const payload = buildRestartPayload({
      pid: process.pid, // 测试进程自己：肯定一直活着
      execPath: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`],
      waitMs: 700,
      pollMs: 100
    })
    const helper = spawn(process.execPath, [helperPath(), payload], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    })
    helper.unref()
    await delay(1600)
    assert.equal(existsSync(marker), false, '父进程没死，绝不能拉起第二个实例')
  })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const total = passed + failures.length
console.log(`\n重启助手回归：${failures.length ? `${passed}/${total} 通过，失败：${failures.join('；')}` : `${total}/${total} 全通过`}`)
if (failures.length > 0) process.exit(1)
