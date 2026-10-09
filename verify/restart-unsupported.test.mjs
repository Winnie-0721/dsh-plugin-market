/**
 * 行为回归：桌面版「重启 DSH」的两条真实路径（NEW-3 / NEW-4）。
 *
 * 背景（每一步都读过源码确认）：
 *   1. 桌面壳管理的宿主 → `/status` 报 `restart.available:false` → 客户端 `restartAvailable=false`；
 *   2. 但横幅按钮与询问窗的「立即重启」**不经过这个判定**就调 `startRestart()`：
 *        - `restartNow()` 无条件 `startRestart()`（询问窗是挂在 `restartAsk` 上的，而
 *          `maybeAskRestart` 才读 `restartAvailable`——`hydrateRestartFromStatus` **不读**，
 *          横幅点亮即可能带上按钮）；
 *        - 横幅的 `restartAvailable ? … : null` 只控制按钮的有无，而 `restartAvailable`
 *          默认 true（读不到 `/status` 时），且 `pendingRestart` 水合会先把横幅点亮。
 *   3. 宿主回 `409 restart-unsupported` → `startRestart().catch` → `setNotice({kind:"error"})`
 *      → `errorCopy(error)`。
 *
 * NEW-3（HIGH）：`errorCopy` 的兜底是 `if (known) … else 塞 error.message 进 why`，
 *   而 `requestJSON` 抛的 marketError 把宿主的 message 放在 `message` 上——**专属文案
 *   `err.restart-unsupported.*` 一次都没被渲染**：标题是 `err.unknown.title`、why 是宿主
 *   原话「桌面版不能在市场里一键重启。」，`next` 才是唯一有意义的一句。专属文案成死文案。
 *
 * NEW-4（HIGH）：`/restart` 是**本模块唯一不读 body 的 200**。`startRestart()` 的
 *   `.then(beginRestartProbe)` 与 `.catch` 之间没有分支：`api.restart()` 成功 resolve
 *   就进探活。桌面版宿主 `spawnRestartHelper()` 返回 `ok:false` → 端点回 **409**，
 *   但假如哪天这条被改成 200（或某个代理改写状态码），客户端会亮起「正在重启 DSH，
 *   稍候页面会自己恢复…」而宿主从未退出——**假的进行中，永不到达，没有超时兜底**。
 *   本套件同时钉住：`/restart` 的响应体必须被读取，且 `restart-unsupported` 必须让
 *   状态机回到可重试的 `failed` 而不是停在 `restarting`。
 *
 * 方法与本仓库其它套件一致：把真函数抠出来（`grab`）在同作用域真调。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const clientSource = readFileSync(join(here, '..', 'plugin-market', 'lib', 'client.js'), 'utf8')

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
async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

/** 花括号/圆括号配对抠函数（与 truth-report 同法）。 */
function grab(src, signature) {
  const s = src.indexOf(signature)
  assert.ok(s !== -1, `找不到 ${signature}`)
  const open = src.indexOf('{', s + signature.length - 1)
  const paren = src.indexOf('(', s + signature.length)
  const start = open === -1 || (paren !== -1 && paren < open) ? paren : open
  const closer = src[start] === '(' ? ')' : '}'
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === src[start]) depth += 1
    else if (c === closer) {
      depth -= 1
      if (depth === 0) return src.slice(s, i + 1)
    }
  }
  throw new Error(`未闭合：${signature}`)
}

// ── [1] errorCopy 对 restart-unsupported 必须给出专属三段式 ──────────────────
console.log('\n[1] 409 restart-unsupported 的三段式文案')

const errBundle = [
  grab(clientSource, 'var ERROR_PREFIXES = {') + ';',
  grab(clientSource, 'function fileLockedDetail('),
  grab(clientSource, 'function supplyChainDetail('),
  grab(clientSource, 'function registryUnreachableDetail('),
  grab(clientSource, 'function shortFailureText('),
  grab(clientSource, 'function errorCopy(')
].join('\n')

const errApi = new Function(
  't',
  `${errBundle}\nreturn { errorCopy, ERROR_PREFIXES };`
)((key, vars) => {
  // t 返回 key 本身（选中哪个前缀直接体现在结果里），与 client-errorcopy 同法。
  if (vars && vars.status !== undefined && typeof key === 'string' && key.indexOf('{status}') !== -1) {
    return key.replace('{status}', String(vars.status))
  }
  return key
})

check('restart-unsupported 在 ERROR_PREFIXES 里（已知码）', () => {
  assert.equal(errApi.ERROR_PREFIXES['restart-unsupported'], true)
})

check('已知码必须走 err.restart-unsupported 前缀，而不是 err.unknown', () => {
  // 宿主真实的 409 错误体：{ code, message, hint }，requestJSON 抛 marketError。
  const copy = errApi.errorCopy({
    code: 'restart-unsupported',
    status: 409,
    message: '桌面版不能在市场里一键重启。',
    hint: '请用桌面壳自己的入口重启（关掉窗口再打开应用），或在应用内安装完插件后按提示手动重启。'
  })
  assert.equal(copy.title, 'err.restart-unsupported.title', `标题走了兜底：${copy.title}`)
  assert.equal(copy.why, 'err.restart-unsupported.why', `why 被宿主原话覆盖了：${copy.why}`)
  assert.equal(copy.next, 'err.restart-unsupported.next')
  assert.equal(copy.code, 'restart-unsupported')
})

check('反向对照：未知码仍然把宿主原话塞进 why（兜底不能被修掉）', () => {
  const copy = errApi.errorCopy({ code: 'some-brand-new-code', message: '宿主的原话。' })
  assert.equal(copy.title, 'err.unknown.title')
  assert.match(copy.why, /宿主的原话/, '未知码必须保留宿主原话，否则「原因未知」')
})

// ── [2] /restart 必须读响应体，且 restart-unsupported 不许停在 restarting ──
console.log('\n[2] /restart 响应必须被读取，失败要交还按钮')

check('/restart 调用读取了响应体（不是 fire-and-forget）', () => {
  const src = grab(clientSource, 'function startRestart()')
  assert.match(
    src,
    /api\.restart\(\)\.then\(function \(/,
    'startRestart 必须接住 /restart 的响应体'
  )
  assert.ok(
    src.indexOf('beginRestartProbe()') !== -1,
    '成功才进探活回路'
  )
})

check('失败分支必须回到 failed（可重试）并关掉询问窗', () => {
  const src = grab(clientSource, 'function startRestart()')
  assert.match(src, /setRestart\(\{ pending: true, phase: "failed" \}\)/, '失败要回 failed')
  assert.match(src, /setRestartAsk\(null\)/, '失败要关掉询问窗（否则永远停在「正在重启」）')
  assert.match(src, /setNotice\(\{ kind: "error", error: error \}\)/, '失败要给错误回执')
})

await checkAsync('restart-unsupported 的响应必须让状态机离开 restarting（行为，不是源码形状）', async () => {
  // 真调 startRestart：把它的依赖（setRestart / setNotice / api / job / batch…）全部桩掉。
  const src = grab(clientSource, 'function startRestart(')
  const seen = { restart: [], notice: null, asked: [], probed: 0 }
  const api = {
    restart: () => Promise.reject(
      Object.assign(
        new Error('桌面版不能在市场里一键重启。'),
        { code: 'restart-unsupported', status: 409, hint: '用桌面壳自己的入口重启。' }
      )
    )
  }
  const fn = new Function(
    'setRestart', 'setNotice', 'api', 'beginRestartProbe', 'setRestartAsk', 'restart', 'job', 'batch', 't',
    `${src}\nreturn startRestart;`
  )(
    (next) => seen.restart.push(next),
    (next) => { seen.notice = next },
    api,
    () => { seen.probed += 1 },
    (next) => seen.asked.push(next),
    { pending: true, phase: 'idle' },
    null,
    null,
    (key) => key
  )
  await fn()
  assert.equal(seen.probed, 0, '失败时绝不进探活（宿主根本没退出）')
  const last = seen.restart[seen.restart.length - 1]
  assert.equal(last.phase, 'failed', `最后状态必须是 failed，实际 ${JSON.stringify(last)}`)
  assert.equal(seen.notice.kind, 'error')
  assert.match(seen.notice.error.code, /restart-unsupported/)
  assert.deepEqual(seen.asked, [null], '询问窗要被关掉')
})

// ── [3] known 码的 why 不得被宿主 message 覆盖（NEW-3 的根因断言） ──────────
console.log('\n[3] 已知码的 why 必须是专属文案，宿主原话只属于未知码')

check('已知码 + 非空 message ⇒ why 不被覆盖（修复点的直接断言）', () => {
  const copy = errApi.errorCopy({
    code: 'restart-unsupported',
    status: 409,
    message: '桌面版不能在市场里一键重启。',
    hint: '请用桌面壳自己的入口重启。'
  })
  assert.notEqual(copy.why, '桌面版不能在市场里一键重启。', '宿主原话把专属 why 覆盖了')
  assert.equal(copy.why, 'err.restart-unsupported.why')
})

check('另一个已知码同样不被覆盖（不能只修 restart-unsupported 一处）', () => {
  const copy = errApi.errorCopy({ code: 'install-failed', message: '宿主 installBundle 抛错。' })
  assert.equal(copy.why, 'err.install-failed.why', `实际 ${copy.why}`)
})

console.log(`\nrestart-unsupported: ${passed}/${passed + failures.length} 通过`)
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 条：`)
  for (const f of failures) console.log(`  - ${f.name}`)
  process.exit(1)
}
