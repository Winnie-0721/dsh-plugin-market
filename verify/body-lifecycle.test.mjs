/**
 * 请求体生命周期回归（审查 TASK-02 / P2）。
 *
 * 复现出来的真实缺陷（`_verify/lifecycle-probe.mjs`、`_verify/release-timeout-shape.mjs`，
 * Node v24.21.0 本机实测）：
 *   客户端声明 `Content-Length: 100`、只发一部分就**保持连接不动**时，
 *   `readJsonBody` 的超时能回 408（v1.2.0 修的），响应也确实送达（实测 8/8 收到），
 *   但那条请求在 Node 眼里**永远没有结束**——它还在等剩下的字节，keep-alive
 *   连接因此既不能复用也不会关闭。实测：50 个卡住的请求 ⇒
 *   `server.getConnections()=50` 全挂着；一个慢客户端能把宿主 socket 表耗光。
 *   已有的 robustness 测试[2]只断言 Promise settle、从不写响应也不看连接，所以漏了。
 *
 * 修复手段也是量的（不是猜的）：
 *   `Connection: close` 头 ⇒ 响应 8/8、释放 8/8，**且完全不碰 socket**；
 *   `req.resume()` 单独用 ⇒ 释放 0/8（Node 仍按「请求进行中」扣着连接）——
 *   所以「drain 掉就好」这个直觉在这条路上是错的。
 *   `detachSocket()` 在 Node 24 直接抛 ERR_INTERNAL_ASSERTION（实测崩溃）。
 *   审查明令「不要未经测试就 destroy socket」，而 close 头已经足够：能优雅关
 *   就不要掐（掐了客户端可能把 ECONNRESET 当传输失败去重试写操作）。
 *
 * 另两条实测事实决定了测试怎么写的：
 *   1) `req.readableEnded` 在 'request' 回调那一刻对 GET、对**完整**小 POST 都是
 *      `false`（`_verify/readable-ended-probe.mjs`）——所以它不能当同步判据，
 *      判据只能是「我们是否还没把体读干净」这个由调用方知道的事实。
 *   2) 客户端断开时 Promise 多快 settle **取决于宿主有没有装 'clientError' 处理器**
 *      （`_verify/disconnect-matrix.mjs`：没装 ⇒ ~30ms 走 req 'error'；装了 ⇒
 *      Node 直接丢弃这条请求，我们的 handler 根本不会被调用，也就无所谓 settle）。
 *      这条不是产品能控制的，所以断言的是**有界**，不是某条具体路径。
 *
 * 用法：node verify/body-lifecycle.test.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'

import { readJsonObject, readJsonBody, sendError, MAX_BODY_BYTES } from '../plugin-market/lib/http.js'

let passed = 0
const failures = []
async function checkAsync(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name} [${Date.now() - t0}ms]`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}
function closeConnections(server) {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
  return new Promise((resolve) => server.close(resolve))
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function connectionCount(server) {
  return new Promise((resolve) => server.getConnections((error, n) => resolve(n)))
}
function activeTimers() {
  return process._getActiveHandles().filter((h) => h.constructor?.name === 'Timeout').length
}

const STALL_HEAD = (length, { keepAlive = true } = {}) =>
  `POST / HTTP/1.1\r\nHost: x\r\nConnection: ${keepAlive ? 'keep-alive' : 'close'}\r\n` +
  `Content-Type: application/json\r\nContent-Length: ${length}\r\n\r\n`

/**
 * 裸 net 客户端：完整发出**请求头**（不能被截在头里，否则 Node 还没解析出请求，
 * 测的就不是这条路径），只发一部分请求体，然后**保持连接不动**。
 * 同时记录「收到的响应」与「连接是否被关闭」——两者都要，缺一个就是这次的教训。
 */
async function stallRequest(port, { bodySoFar, declaredLength, waitMs = 2500 }) {
  const socket = net.connect(port, '127.0.0.1')
  const state = { text: '', closed: false, closedAt: 0 }
  socket.on('data', (chunk) => { state.text += chunk.toString('utf8') })
  socket.on('close', () => { if (!state.closed) { state.closed = true; state.closedAt = Date.now() } })
  socket.on('error', () => { state.closed = true })
  const started = Date.now()
  await new Promise((resolve) => socket.once('connect', resolve))
  socket.write(STALL_HEAD(declaredLength) + bodySoFar)
  const deadline = started + waitMs
  while (!state.closed && Date.now() < deadline) await sleep(20)
  const elapsed = state.closedAt ? state.closedAt - started : -1
  try { socket.destroy() } catch { /* 已关 */ }
  return { ...state, elapsed }
}

/** 走完产品路径的服务器：readJsonObject（含它写的错误响应）。 */
function productServer(timeoutMs, limit = MAX_BODY_BYTES) {
  const server = http.createServer(async (req, res) => {
    const read = await readJsonObject(req, res, timeoutMs, limit)
    if (read.ok !== true) return // readJsonObject 已经写过响应
    // 成功路径：把读到的对象原样回出去，断言才好写（塞进 error.message 会被转义）
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, value: read.value }))
  })
  return server
}

console.log('\n[1] 发一半就停：响应要收到、连接更要被**释放**（实测缺陷就在这半）')

await checkAsync('超时 ⇒ 客户端收到 408 JSON 错误', async () => {
  const server = productServer(300)
  const port = await listen(server)
  try {
    const out = await stallRequest(port, { bodySoFar: '{"a":1}', declaredLength: 100, waitMs: 2500 })
    assert.match(out.text, /^HTTP\/1\.1 408/, `客户端应收到 408，实际首行：${out.text.split('\r\n')[0] || '（无响应）'}`)
    assert.match(out.text, /"code":"bad-request"/, '错误码要按契约 §1 走')
    assert.match(out.text, /"message":"请求体读到一半就超时了。"/, '文案要原样送达')
  } finally {
    await closeConnections(server)
  }
})

await checkAsync('超时 ⇒ 连接被关闭释放（修复前实测 0/8 释放、服务器 100% 挂住）', async () => {
  const server = productServer(300)
  const port = await listen(server)
  try {
    const out = await stallRequest(port, { bodySoFar: '{"a":1}', declaredLength: 100, waitMs: 2500 })
    assert.equal(out.closed, true, '连接必须被关闭——响应送达但连接永远挂着就是这条缺陷')
    assert.ok(out.elapsed > 0 && out.elapsed < 2400, `关闭应发生在超时点附近而不是等满窗口（实测 ${out.elapsed}ms）`)
    assert.equal(await connectionCount(server), 0, '服务端计数也要归零，不能只靠客户端自己断')
  } finally {
    await closeConnections(server)
  }
})

await checkAsync('50 个卡住的请求不累积连接、不堆积定时器', async () => {
  const server = productServer(150)
  const port = await listen(server)
  const timersBefore = activeTimers()
  const sockets = []
  try {
    for (let i = 0; i < 50; i += 1) {
      const socket = net.connect(port, '127.0.0.1')
      sockets.push(socket)
      socket.on('error', () => {})
      await new Promise((resolve) => socket.once('connect', resolve))
      socket.write(STALL_HEAD(100) + '{"a":1}')
    }
    await sleep(1200)
    assert.equal(await connectionCount(server), 0, '50 个卡住的请求后服务器仍持有连接——慢客户端耗尽 socket 表的路径')
    const timersAfter = activeTimers()
    assert.ok(timersAfter <= timersBefore + 2, `定时器句柄 ${timersBefore} → ${timersAfter}：超时定时器没被清`)
  } finally {
    for (const socket of sockets) { try { socket.destroy() } catch { /* 忽略 */ } }
    await closeConnections(server)
  }
})

await checkAsync('Content-Type 不对且请求体没读完 ⇒ 同样要释放（早拒分支从没碰过 req）', async () => {
  const server = http.createServer((req, res) => {
    readJsonObject(req, res, 1000).then((read) => { if (read.ok !== true) return })
  })
  const port = await listen(server)
  const socket = net.connect(port, '127.0.0.1')
  let text = ''
  let closed = false
  socket.on('data', (chunk) => { text += chunk.toString('utf8') })
  socket.on('close', () => { closed = true })
  socket.on('error', () => {})
  try {
    await new Promise((resolve) => socket.once('connect', resolve))
    socket.write('POST / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\nContent-Type: text/plain\r\nContent-Length: 100\r\n\r\npartial')
    const deadline = Date.now() + 2500
    while (!closed && Date.now() < deadline) await sleep(20)
    assert.match(text, /HTTP\/1\.1 400/, `应收到 400 说明：${text.split('\r\n')[0] || '（无响应）'}`)
    assert.match(text, /application\/json/, '错误响应本身仍是 JSON')
    assert.equal(closed, true, '早拒路径（实测 P2 探针：留下僵尸连接）也要释放')
    assert.equal(await connectionCount(server), 0)
  } finally {
    // destroy 必须在 finally：断言抛错时客户端连接若留着，[5] 的「无残留句柄」自查
    // 会抓到它——这一条就是这么发现的。
    try { socket.destroy() } catch { /* 忽略 */ }
    await closeConnections(server)
  }
})

console.log('\n[2] 客户端中途断开：settle 必须有界、连接不残留')

await checkAsync('客户端 destroy ⇒ Promise 在有界时间内 settle（不靠等满超时以外的事）', async () => {
  let outcome = null
  const settledAt = { t: 0 }
  const timeoutMs = 800
  // 不装 clientError 处理器：那会改变 Node 的处理路径（实测断开时 ~30ms 走 req 'error'，
  // 装了处理器则整条请求被丢弃、handler 都不跑）。两种形态下产品代码都不该无限挂。
  const server = http.createServer((req, res) => {
    readJsonBody(req, 64 * 1024, timeoutMs).then((r) => { outcome = r; settledAt.t = Date.now() })
  })
  const port = await listen(server)
  const socket = net.connect(port, '127.0.0.1')
  try {
    const started = Date.now()
    await new Promise((resolve) => socket.once('connect', resolve))
    socket.write(STALL_HEAD(100) + '{"a":1}')
    await sleep(120)
    socket.destroy()
    const deadline = Date.now() + timeoutMs + 1500
    while (outcome === null && Date.now() < deadline) await sleep(20)
    assert.notEqual(outcome, null, `断开后必须在 ${timeoutMs}ms 超时之内 settle`)
    assert.equal(outcome.ok, false)
    assert.match(outcome.message, /断了|超时/, `断开该走这两条之一，实际：${outcome.message}`)
    assert.ok(settledAt.t - started <= timeoutMs + 1200, `settle 耗时 ${settledAt.t - started}ms 超出有界窗口`)
    await sleep(150)
    assert.equal(await connectionCount(server), 0, '断开后服务器仍持有连接')
  } finally {
    try { socket.destroy() } catch { /* 忽略 */ }
    await closeConnections(server)
  }
})

console.log('\n[3] 超限：客户端要收到**说明**而不是被掐（现有行为要保住）')

await checkAsync('请求体超上限 ⇒ 400 + 可解释的说明（不是 ECONNRESET）', async () => {
  const limit = 64
  const server = http.createServer((req, res) => {
    readJsonBody(req, limit, 5000).then((r) => {
      if (r.ok !== true) sendError(res, r.status, r.code, { message: r.message, hint: r.hint })
      else { res.writeHead(200); res.end('{}') }
    })
  })
  const port = await listen(server)
  const socket = net.connect(port, '127.0.0.1')
  try {
    const big = 'a'.repeat(400)
    let text = ''
    let closed = false
    socket.on('data', (chunk) => { text += chunk.toString('utf8') })
    socket.on('close', () => { closed = true })
    socket.on('error', () => { closed = true })
    await new Promise((resolve) => socket.once('connect', resolve))
    socket.write(`POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${big.length}\r\n\r\n${big}`)
    // **轮询而不是 Promise.race([close, sleep(3000)])**：race 提前赢了之后那条 3s 定时器
    // 还是挂着的（ref'd），会把测试进程多拖满 3 秒——门禁时长就是这么被我涨上去的。
    const deadline = Date.now() + 3000
    while (!closed && Date.now() < deadline) await sleep(20)
    assert.equal(closed, true, '3s 内连接应收尾')
    assert.match(text, /HTTP\/1\.1 400/, `应收到 400，实际首行：${text.split('\r\n')[0] || '（无响应）'}`)
    assert.match(text, /请求体超过 1 KiB 上限|请求体超过 0 KiB 上限/, '要带可解释的说明')
    assert.match(text, /"code":"bad-request"/)
  } finally {
    try { socket.destroy() } catch { /* 忽略 */ }
    await closeConnections(server)
  }
})

console.log('\n[4] 反向对照：正常路径不能被修复弄坏')

/**
 * [4] 的三条都走真实 http.request。这里**必须用 agent:false**：全局 agent 会把
 * 响应用完的连接池化留着（实测把测试进程多拖住 ~3s，白涨门禁时长）。
 * 产品语义不受影响——这几条断言看的是响应状态/正文/header，不是连接复用；
 * 「不误关 keep-alive」那条直接读 response header 里的 connection 值。
 */
function oneShot(port, { method = 'POST', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: '/', agent: false, headers },
      (res) => {
        let acc = ''
        res.on('data', (chunk) => { acc += chunk })
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, acc }))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

await checkAsync('正常小请求体照常读到对象（成功路径不受影响）', async () => {
  const server = productServer(1000)
  const port = await listen(server)
  try {
    const body = JSON.stringify({ name: 'a/b', spec: 'x' })
    const out = await oneShot(port, {
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      body
    })
    assert.equal(out.status, 200, `正常请求应走成功分支，实际：${out.acc}`)
    const parsed = JSON.parse(out.acc)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.value.name, 'a/b', '读到的对象要原样交给业务')
  } finally {
    await closeConnections(server)
  }
})

await checkAsync('空请求体仍按契约交给字段校验（不是 408、也不是被掐）', async () => {
  const server = productServer(400)
  const port = await listen(server)
  try {
    const out = await oneShot(port, { headers: { 'content-type': 'application/json' }, body: undefined })
    assert.equal(out.status, 200, `空体不该被判超时：${out.acc}`)
    assert.deepEqual(JSON.parse(out.acc).value, {}, '空体该回 {}，让字段校验去说「缺哪个字段」')
  } finally {
    await closeConnections(server)
  }
})

await checkAsync('非法 JSON（体已读完）⇒ 400 说明，且服务端不抢着关连接', async () => {
  const server = productServer(1000)
  const port = await listen(server)
  const socket = net.connect(port, '127.0.0.1')
  let text = ''
  socket.on('data', (chunk) => { text += chunk.toString('utf8') })
  socket.on('error', () => {})
  try {
    // 必须用 keep-alive 的**裸连接**客户端测这条：`agent:false` 会自带
    // `Connection: close` 请求头，服务端如实回 close——那测的是客户端的意愿，
    // 不是服务端的收尾规则（我前两版分别栽在这个假红和「忘了挂 data 监听器」上）。
    const body = '{oops'
    await new Promise((resolve) => socket.once('connect', resolve))
    socket.write(`POST / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    const deadline = Date.now() + 1500
    while (!/"error"/.test(text) && Date.now() < deadline) await sleep(20)
    const head = text.split('\r\n\r\n')[0]
    assert.match(head, /HTTP\/1\.1 400/, `应收到 400：${head.split('\r\n')[0] || '（无响应）'}`)
    assert.match(text, /不是合法的 JSON/)
    // 这条请求的体**读完了**，连接本可复用：不该被服务端单方面加 Connection: close
    //（判据要精确到「没读完」，对所有失败一刀切会误伤浏览器 keep-alive 的正常报错）。
    assert.ok(!/^connection:\s*close/im.test(head), `读完体的 400 不该关连接：\n${head}`)
    assert.match(head, /keep-alive/i, 'Node 应如实回 keep-alive')
  } finally {
    try { socket.destroy() } catch { /* 忽略 */ }
    await closeConnections(server)
  }
})

console.log('\n[5] 套件自己也得守规矩（否则门禁时长就是下一个「僵尸连接」）')

await checkAsync('跑完后没有残留的服务端 socket / 活动请求（除 stdio 管道）', async () => {
  // 这条不是装饰：第一版套件跑完进程还要多活 ~3s（`Promise.race` 输掉的那条 3s 定时器
  // 仍 ref 着 + 全局 agent 池化的 keep-alive 连接），门禁时长被它从 2.7s 顶到 5.4s。
  // 一个「测资源释放」的套件自己漏资源，是最不该犯的错。
  await sleep(150)
  const handles = process._getActiveHandles()
  const lingering = handles.filter((h) => {
    const name = h?.constructor?.name
    if (name !== 'Socket') return false
    if (h.fd === 0 || h.fd === 1 || h.fd === 2) return false // stdio 管道由外层命令持有
    return true
  })
  assert.equal(lingering.length, 0, `残留 ${lingering.length} 个非 stdio socket：` +
    lingering.map((h) => `fd=${h.fd} remote=${h.remoteAddress}:${h.remotePort} server=${!!h._server}`).join(', '))
  const requests = process._getActiveRequests().length
  assert.equal(requests, 0, `还有 ${requests} 个活动请求没落地`)
})

console.log('')
if (failures.length > 0) {
  console.log(`请求体生命周期回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`请求体生命周期回归：${passed}/${passed} 全通过`)
}
