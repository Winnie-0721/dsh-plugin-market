/**
 * 行为回归：「不说谎」两条路径（NEW-1 批准死路 / NEW-2 自更新假绿灯）。
 *
 * 这两条都是本轮审查从真实源码里挖出来的、现有 17 个套件**没有覆盖**的缺陷：
 *
 * NEW-1（HIGH）：批准后再提交仍 pending 时，客户端 `setPending(null)` 关掉确认条，
 *   而 `stale-approval` 的 hint 又让用户「重新点一次安装，按提示批准构建脚本」——
 *   但提示条已经没了，hint 指向一个不存在的 UI。结果是死路：点一次就断头，
 *   这个插件在这台机器上永远装不上。
 *
 * NEW-2（HIGH）：`applySelfUpdate().then()` 无条件 `markSelfDone()` + 绿色
 *   `notice.selfUpdated`，根本不读 `payload.application` / `payload.error`。
 *   宿主回 `application:'failed'`（HTTP 200，因为 `ok` 规则只在无 pendingBuilds 时为
 *   false）时，一次失败的自更新被渲染成成功。这条在 docs/ROADMAP.md P1.5 与
 *   docs/API-CONTRACT.md §2.9 里都记过，但**测试从未钉住**——本套件把它钉死。
 *
 * 方法与本仓库其它套件一致：把真实函数抠出来（`grab`）在同作用域真调，
 * 读它的返回值/状态变化；源码形状断言只用来兜「函数还在」。
 *
 * 用法：node verify/truth-report.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const clientSource = readFileSync(join(here, '..', 'plugin-market', 'lib', 'client.js'), 'utf8')
const hostSource = readFileSync(join(here, '..', 'plugin-market', 'lib', 'index.js'), 'utf8')

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

/** 从源码里按签名抠出函数源码（参数表与函数体都要配对，同 build-approval 套件）。 */
function grab(src, sig) {
  const s = src.indexOf(sig)
  if (s < 0) return ''
  let paren = 0
  let bodyStart = -1
  for (let i = src.indexOf('(', s); i < src.length; i++) {
    if (src[i] === '(') paren++
    else if (src[i] === ')') {
      paren--
      if (paren === 0) {
        bodyStart = src.indexOf('{', i)
        break
      }
    }
  }
  if (bodyStart < 0) return ''
  let d = 0
  let j = bodyStart
  for (; j < src.length; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}') {
      d--
      if (d === 0) break
    }
  }
  return src.slice(s, j + 1).replace(/^export /m, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW-2：自更新失败不许亮绿灯
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把 `applySelfUpdate` 抠出来真跑。
 *
 * 它依赖的只有：`selfUpdate`（state）、`setSelfCheck`、`startJob`、`clearJob`、
 * `markSelfDone`、`noteRestartFrom`、`setNotice`、`mountedRef`、`t`、`api`。
 * 全部用可观测的桩替掉，然后喂一个 HTTP 200 但 `application:'failed'` 的 payload，
 * 看它到底把状态机推到哪、发了哪条回执。
 */
function loadApplySelfUpdate(payload) {
  const src = grab(clientSource, 'function applySelfUpdate()')
  assert.ok(src !== '', '找不到 applySelfUpdate')
  const calls = { markSelfDone: 0, notice: null, phase: null, noteRestart: null }
  const state = {
    selfUpdate: { phase: 'ready', data: { latest: '9.9.9' }, error: null },
    mounted: true
  }
  const deps = {
    setSelfCheck(next) {
      calls.phase = next.phase
      state.selfUpdate = next
    },
    startJob() {},
    clearJob() {},
    markSelfDone() {
      calls.markSelfDone += 1
    },
    noteRestartFrom(payloadArg, opts) {
      calls.noteRestart = { payload: payloadArg, opts }
    },
    setNotice(notice) {
      calls.notice = notice
    },
    api: {
      applySelfUpdate() {
        return Promise.resolve(payload)
      }
    },
    t(key, vars) {
      return vars ? `${key}:${JSON.stringify(vars)}` : key
    },
    get mountedRef() {
      return { current: state.mounted }
    },
    get selfUpdate() {
      return state.selfUpdate
    }
  }
  // `new Function` 里按词法引用注入桩：把函数体里的自由变量解析到 deps 上。
  const runner = new Function(
    'deps',
    `${Object.keys(deps)
      .map((k) => `var ${k} = deps.${k};`)
      .join('\n')}\n${src}\nreturn applySelfUpdate;`
  )
  return { apply: runner(deps), calls, state }
}

console.log('\n[NEW-2] 自更新失败不得亮绿灯（HTTP 200 + application:failed 仍是失败）')
await checkAsync('application:"failed" ⇒ 不调用 markSelfDone、不发绿色 selfUpdated', async () => {
  const { apply, calls } = loadApplySelfUpdate({
    ok: true,
    application: 'failed',
    from: '1.0.0',
    to: '9.9.9',
    requiresRestart: true,
    error: { code: 'install-failed', message: '宿主装失败' }
  })
  apply()
  // 让 .then 链跑完
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(calls.markSelfDone, 0, '失败时不得 markSelfDone（那会亮「更新成功」）')
  assert.ok(calls.notice !== null, '失败必须给一条回执')
  assert.notEqual(calls.notice.kind, 'success', `失败回执不得是 success，实际 ${calls.notice.kind}`)
  assert.ok(
    !String(calls.notice.text || '').includes('notice.selfUpdated'),
    `失败回执不得是绿色 selfUpdated 文案，实际 ${calls.notice.text}`
  )
})
await checkAsync('application:"applied" ⇒ 正常亮绿灯（收紧不许误伤成功路径）', async () => {
  const { apply, calls } = loadApplySelfUpdate({
    ok: true,
    application: 'applied',
    from: '1.0.0',
    to: '9.9.9',
    requiresRestart: true
  })
  apply()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(calls.markSelfDone, 1, '成功时才 markSelfDone')
  assert.equal(calls.notice.kind, 'success')
  assert.match(String(calls.notice.text), /notice\.selfUpdated/)
})
await checkAsync('不带 application 的空结果 ⇒ 按 failed 处理（不许默认成功）', async () => {
  const { apply, calls } = loadApplySelfUpdate({ ok: true })
  apply()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(calls.markSelfDone, 0, '没有 application 说明宿主没确认过，不许当成功')
  assert.notEqual(calls.notice && calls.notice.kind, 'success')
})
check('源码形状：applySelfUpdate 必须读 payload.application（不能无条件成功）', () => {
  const src = grab(clientSource, 'function applySelfUpdate()')
  assert.ok(
    /application/.test(src),
    'applySelfUpdate 的 then 里必须判断 payload.application，否则失败会被渲染成成功'
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// NEW-1：批准死路——确认条被关掉，而 hint 让用户去找它
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n[NEW-1] 批准后再提交仍 pending ⇒ 确认条不许被关掉（否则 hint 指向不存在的 UI）')
check('submitInstall 的 approvedBuilds 分支必须保留 pending（setPending(null) 是死路）', () => {
  // 当前实现：`setPending(null)` 关掉确认条 + buildsStillPending 提示说「请重试」，
  // 而宿主 MANAGEMENT_HINT['stale-approval'] 说「重新点一次安装，按提示批准构建脚本」——
  // 提示已经没了，用户没有第二次入口。修法是保留确认条（允许再点一次）或给出真能走通的下一步。
  const submitSrc = grab(clientSource, 'function submitInstall(')
  assert.ok(submitSrc !== '', '找不到 submitInstall')
  // 定位「已带 approvedBuilds 仍 pending」的子分支
  const stillIdx = submitSrc.indexOf('approvedBuilds && approvedBuilds.length')
  assert.ok(stillIdx > 0, 'submitInstall 里必须有「已批准仍 pending」的子分支')
  const stillBranch = submitSrc.slice(stillIdx, submitSrc.indexOf('} else {', stillIdx))
  // 注意：注释里提到 setPending(null) 不算——只看**实际调用**（行首不是 // 的那行）。
  const liveLines = stillBranch.split('\n').filter((line) => !/^\s*\/\//.test(line))
  assert.ok(
    !/setPending\((?:\s*)null(?:\s*)\)/.test(liveLines.join('\n')),
    '已批准仍 pending 时不得关掉确认条（setPending(null)）：那会移除唯一的批准入口，让用户再没有第二次机会'
  )
  assert.ok(
    /setPending\(\{ name: requestName/.test(stillBranch),
    '已批准仍 pending 时必须重新弹出确认条（setPending({...})），否则用户没有第二次入口'
  )
})
check('stale-approval 的 hint 不得指向已消失的确认条（与客户端行为一致）', () => {
  // 宿主把 stale-approval 的 hint 写成「重新点一次安装，按提示批准构建脚本」，
  // 但如果客户端已经关掉了提示条，这句话就是指向不存在的 UI。二者必须一致：
  // 要么客户端保留提示条（上面那条测），要么 hint 改成不依赖提示条的下一步。
  // 宿主对 stale-approval 有两个说法：MANAGEMENT_MESSAGE（发生了什么）与
  // MANAGEMENT_HINT（现在怎么办）。要核对的是**hint**——那才是指路的那句。
  const hintMatch = /'stale-approval':\s*'([^']*)',\s*\n\s*'[^']*':\s*'([^']*)'/s.exec(
    hostSource.slice(hostSource.indexOf('const MANAGEMENT_HINT'))
  ) ?? /'stale-approval':\s*'([^']+)'/.exec(hostSource.slice(hostSource.indexOf('const MANAGEMENT_HINT')))
  assert.ok(hintMatch, '宿主必须有 stale-approval 的 hint（在 MANAGEMENT_HINT 里）')
  const hint = hintMatch[1]
  const stillPendingBranchHasSetPendingNull = (() => {
    const submitSrc = grab(clientSource, 'function submitInstall(')
    const stillIdx = submitSrc.indexOf('approvedBuilds && approvedBuilds.length')
    if (stillIdx <= 0) return false
    const stillBranch = submitSrc.slice(stillIdx, submitSrc.indexOf('} else {', stillIdx))
    const liveLines = stillBranch.split('\n').filter((line) => !/^\s*\/\//.test(line))
    return /setPending\((?:\s*)null(?:\s*)\)/.test(liveLines.join('\n'))
  })()
  if (stillPendingBranchHasSetPendingNull) {
    // 客户端关掉了确认条 ⇒ hint 不能让人去找它
    assert.ok(
      !/按提示批准/.test(hint),
      `客户端已关掉确认条，hint「${hint}」却让用户「按提示批准」——指向不存在的 UI`
    )
  } else {
    // 客户端保留了确认条 ⇒ hint 必须与之呼应（告诉用户入口还在）。
    assert.ok(
      /确认条|重新点/.test(hint),
      `客户端保留了确认条，hint「${hint}」应当说明入口还在（重新点一次即可）`
    )
  }
})
check('buildsStillPending 的文案必须给出可执行的下一步（不能只说「请重试」）', () => {
  const zh = /"notice\.buildsStillPending":\s*"([^"]+)"/.exec(clientSource)
  assert.ok(zh, 'zh 必须有 notice.buildsStillPending')
  const text = zh[1]
  // 「重试」在确认条被关掉的场景下是无效建议（点了还是同一条路）。文案要给出真出路。
  assert.ok(
    /终端|allowBuilds|pnpm-workspace/.test(text),
    `buildsStillPending「${text}」只说重试不够——确认条已被关掉，必须给出能真走通的下一步`
  )
})

console.log('')
if (failures.length > 0) {
  console.log(`不说谎回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  for (const f of failures) console.log(`  ✗ ${f.name}: ${f.message}`)
  process.exit(1)
}
console.log(`不说谎回归：${passed}/${passed} 全通过`)
