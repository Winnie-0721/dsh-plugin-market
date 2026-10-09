/**
 * 行为回归：宿主「构建脚本待批准」这条路径。
 *
 * 真实案例（用户报「还是安装不了」）：装 @linxin666/dsh-remote-web-ui 时，它的依赖
 * cloudflared 有 postinstall（下载二进制），pnpm 11 忽略构建脚本并以**非零**退出。
 * 宿主把这次 installBundle 折成 ChangeResult：{ error:..., pendingBuilds:['cloudflared'] }，
 * 也就是「没装成，但只差用户批准一下」。
 *
 * 这个 bug：sendChangeResult 对 `application:'failed'` 回 ok:false，而客户端 requestJSON
 * 在 `payload.ok !== true` 时**直接抛错**——于是客户端「读 payload.pendingBuilds 弹批准框」
 * 那段是**死代码**，永远走不到；用户只会看到一条普通错误，**没有任何批准入口**。
 *
 * 这个套件把两端钉在一起：服务端必须让 ok:true（pendingBuilds 是「可继续」不是「失败到底」），
 * 客户端才可能弹批准框。
 *
 * 用法：node verify/build-approval.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hostSource = readFileSync(new URL('../plugin-market/lib/index.js', import.meta.url), 'utf8')
const httpSource = readFileSync(new URL('../plugin-market/lib/http.js', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../plugin-market/lib/client.js', import.meta.url), 'utf8')

/**
 * 从给定源码里按函数名抠出函数源码。
 *
 * 注意：**必须先跳过参数表**——`sendJson(res, status, payload, extraHeaders = {})` 里有
 * 一个 `{}` 默认值，直接找第一个 `{` 会在 `{}` 处就配平返回，截出一个残缺的签名
 *（我第一版就是这么写的，报 `Unexpected token 'function'`）。
 */
function grab(src, sig) {
  const s = src.indexOf(sig)
  if (s < 0) return ''
  // 1) 先配对参数表的括号，找到函数体的起始 '{'
  let paren = 0
  let bodyStart = -1
  for (let i = src.indexOf('(', s); i < src.length; i++) {
    if (src[i] === '(') paren++
    else if (src[i] === ')') {
      paren--
      if (paren === 0) {
        // 参数表结束：下一个 '{' 就是函数体
        bodyStart = src.indexOf('{', i)
        break
      }
    }
  }
  if (bodyStart < 0) return ''
  // 2) 再配对函数体的花括号
  let d = 0
  let j = bodyStart
  for (; j < src.length; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}') { d--; if (d === 0) break }
  }
  return src.slice(s, j + 1).replace(/^export /m, '')
}

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

// 把服务端**真的** sendChangeResult 抠出来执行（不是用正则去匹配它的源码形状）。
// 形状断言测不出 `ok` 的推导行为——本轮我已经栽过一次同类跟头。
function loadSendChangeResult() {
  assert.ok(hostSource.includes('export function sendChangeResult('), '找不到 sendChangeResult')
  const fnSource = grab(hostSource, 'export function sendChangeResult(')
  // 依赖的辅助函数一起注入：sendChangeResult 用到 sendJson（在 http.js）、错误投影与文案工具（在 index.js）。
  const helpers = [
    grab(httpSource, 'export function sendJson('),
    grab(hostSource, 'function optionalText('),
    grab(hostSource, 'function projectChangeError('),
    grab(hostSource, 'function warningsOf('),
    grab(hostSource, 'function tail('),
    // sendChangeResult 现在还会调 noteRestartFromResult 记账「待重启」。
    // 本套件不测那件事（由 host-contract.test.mjs 的 [P] 覆盖），但**必须注入**，
    // 否则整个沙箱在 ReferenceError 上炸掉、这一整套会假红。
    // （我加了记账之后就是这么把本套件弄挂的：改一个函数要连带看谁在抠它执行。）
    grab(hostSource, 'function noteRestartFromResult(')
  ]
    .filter(Boolean)
    .join('\n')
  // 模块级常量与错误码表：本套件不测它们的内容，注入等价占位即可。
  const tables = `
    const MANAGEMENT_MESSAGE = new Map()
    const MANAGEMENT_HINT = new Map()
    const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
    // noteRestartFromResult 读写的模块级记账变量（本套件不测它，占位即可）。
    const restartPending = { names: [], marketVersion: null, at: 0 }
  `
  const sandbox = new Function(`${tables}\n${helpers}\n${fnSource}\nreturn sendChangeResult`)
  return sandbox()
}

// sendChangeResult 直接写 res：用假 res 捕获它发出的 JSON。
function callSendChangeResult(result, stage) {
  let captured = null
  const res = {
    writeHead() {},
    setHeader() {},
    end(body) { captured = JSON.parse(body) },
    writableEnded: false
  }
  loadSendChangeResult()(res, result, stage)
  assert.ok(captured !== null, 'sendChangeResult 应当发出 JSON')
  return captured
}

console.log('\n[1] 服务端：待批准构建必须是「可继续」，不能是「失败到底」')
check('宿主返回 pendingBuilds 时 application 是 failed，ok 必须是 true（否则客户端拿不到它）', () => {
  // 宿主：cloudflared 的 postinstall 未获批准 → pnpm 非零退出 → installBundle 抛
  // → change() 折成 { application:'failed', error, pendingBuilds:['cloudflared'] }
  const payload = callSendChangeResult(
    { application: 'failed', error: { code: 'build-blocked', message: '构建脚本待批准' }, pendingBuilds: ['cloudflared'] },
    'install'
  )
  assert.deepEqual(payload.pendingBuilds, ['cloudflared'], 'pendingBuilds 要透传出去')
  assert.equal(payload.ok, true, 'pendingBuilds 非空时 ok 必须为 true，否则客户端 requestJSON 直接抛错、丢掉 pendingBuilds')
})
check('真正的失败（无 pendingBuilds）仍然 ok:false（不能为了修这条把所有失败都放行）', () => {
  const payload = callSendChangeResult({ application: 'failed', error: { code: 'install-failed' } }, 'install')
  assert.equal(payload.ok, false)
})
check('cancelled 仍然放行（原有语义不能回退）', () => {
  assert.equal(callSendChangeResult({ application: 'cancelled' }, 'install').ok, true)
})
check('成功（restart-required / applied）仍 ok:true', () => {
  assert.equal(callSendChangeResult({ application: 'restart-required' }, 'install').ok, true)
  assert.equal(callSendChangeResult({ application: 'applied' }, 'install').ok, true)
})
check('pendingBuilds 里的非字符串被过滤掉（脏数据不该进 UI）', () => {
  const payload = callSendChangeResult({ application: 'failed', pendingBuilds: ['ok-pkg', 42, null, { x: 1 }] }, 'install')
  assert.deepEqual(payload.pendingBuilds, ['ok-pkg'])
  assert.equal(payload.ok, true)
})

console.log('\n[2] 客户端：拿到 pendingBuilds 必须能弹批准框，而不是掉进 catch')
check('客户端读 pendingBuilds 的分支在 then 里存在（有批准入口）', () => {
  assert.match(clientSource, /if \(payload\.pendingBuilds && payload\.pendingBuilds\.length\)/, '要有 pendingBuilds 分支')
  assert.match(clientSource, /setPending\(\{ name: requestName/, '要弹出批准框（setPending）')
  assert.match(clientSource, /t\("pending\.approve"\)/, '批准框要有「批准」按钮')
})
check('requestJSON 对 ok!==true 会抛错——所以服务端不修，客户端这段就是死代码', () => {
  assert.match(clientSource, /if \(payload\.ok !== true\) \{/, 'requestJSON 确实在 ok!==true 时抛错')
})
check('批准后要用 approvedBuilds 重装（形成闭环）', () => {
  assert.match(clientSource, /body\.approvedBuilds = approvedBuilds/, '批准后要回传 approvedBuilds')
  assert.match(hostSource, /options\.approvedBuilds = approved/, '宿主要把 approvedBuilds 交给 installBundle')
})
check('「批准了但还待批准」要如实说，不能静默成功', () => {
  assert.match(clientSource, /notice\.buildsStillPending/, '仍待批准时要给提示')
  assert.match(clientSource, /notice\.buildsPending/, '首次待批准时要给提示')
})

console.log('')
if (failures.length > 0) {
  console.log(`构建批准路径回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  for (const f of failures) console.log(`  ✗ ${f.name}: ${f.message}`)
  process.exit(1)
}
console.log(`构建批准路径回归：${passed}/${passed} 全通过`)
