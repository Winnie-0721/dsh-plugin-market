/**
 * 稳健性回归（`verify/` 下所有 *.test.mjs 都由 release.ps1 门禁执行）。
 *
 * 为什么需要它：这一批是**第二轮独立审计**在 catalog-npm.js / http.js 里找出的真实缺陷，
 * 而这些模块此前在 `verify/` 里**一条断言都没有**（grep `catalog-npm|fileFromTarball|
 * readJsonBody|normalizeLabels` 全无命中）。它们的共同点是「不输入恶意数据就永远看不出问题」：
 * 解压炸弹、卡住的请求体、`__proto__` 键——正常路径全绿，只在边界上出事。
 *
 * 每条都先复现过真实的错，再钉住正确行为；注释写清「错在哪儿」与可达性。
 * 用法：node verify/robustness.test.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { gzipSync } from 'node:zlib'

import {
  MAX_TARBALL_BYTES,
  fileFromTarball
} from '../plugin-market/lib/catalog-npm.js'
import { readJsonBody, BODY_READ_TIMEOUT_MS } from '../plugin-market/lib/http.js'
import { normalizeLabels, sortPlugins, normalizeItem } from '../plugin-market/lib/catalog.js'

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

console.log('\n[1] gunzip 解压炸弹：必须有输出上限')
check('gzip 炸弹被挡在分配之前（不是先解压再检查长度）', () => {
  // 反向保证：正常的小 tarball 仍要能解压出来。
  // 255 KiB 压缩 → 256 MB 解压：integrity 校验挡不住它（校验的是**压缩**字节，
  // 而且那个 hash 来自同一份元数据），所以必须在解压这一步限长。
  const bomb = gzipSync(Buffer.alloc(256 * 1024 * 1024), { level: 9 })
  assert.ok(bomb.length < 1024 * 1024, `前置条件：炸弹压缩后应远小于 1 MiB，实际 ${bomb.length}`)
  assert.throws(
    () => fileFromTarball(bomb, 'plugins.json'),
    (error) => error.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|output length/i.test(String(error.message)),
    '超限解压必须抛错（ERR_BUFFER_TOO_LARGE），不得静默分配 256 MB'
  )
  assert.ok(MAX_TARBALL_BYTES > 0 && MAX_TARBALL_BYTES <= 64 * 1024 * 1024, '上限本身应是个合理的小值')
})
check('正常小 tarball 仍能解压（上限不能误伤）', () => {
  // 造一个最小的合法 tar，内含 plugins.json
  const content = Buffer.from(JSON.stringify({ count: 0, plugins: [] }), 'utf8')
  const header = Buffer.alloc(512)
  header.write('plugins.json', 0, 'utf8')
  header.write('0000644', 100, 'utf8') // mode
  header.write('0000000', 108, 'utf8') // uid
  header.write('0000000', 116, 'utf8') // gid
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'utf8') // size
  header.write('00000000000', 136, 'utf8') // mtime
  header.write('0', 156, 'utf8') // type = regular
  header.write('ustar', 257, 'utf8')
  // checksum：先按空格算，再写入
  let sum = 0
  for (let i = 0; i < 512; i += 1) sum += header[i]
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8')
  const tar = Buffer.concat([header, content, Buffer.alloc(1024 - (content.length % 512))])
  const file = fileFromTarball(gzipSync(tar), 'plugins.json')
  assert.ok(file !== null, '正常 tarball 必须能取到条目')
  assert.equal(file.toString('utf8'), content.toString('utf8'))
})

console.log('\n[2] 请求体读取：卡住的连接不能把 handler 永远挂住')
await checkAsync('客户端发一半就不动 ⇒ 超时后 settle（以前永远不 settle）', async () => {
  // 错过的样子：readJsonBody 只有 end / error 两个出口。客户端声明 Content-Length: 100、
  // 只发 10 字节后保持连接不动 → Promise 永不 settle，handler 与 socket 一起挂住
  // （宿主默认 requestTimeout 300s 也只是把「永远」变成「五分钟」）。
  const server = http.createServer()
  let socket = null
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    socket = net.connect(port, '127.0.0.1')
    await new Promise((resolve) => socket.once('connect', resolve))

    let outcome = null
    server.on('request', (req) => {
      // 用 300ms 上限做实测，避免测试变慢
      readJsonBody(req, 64 * 1024, 300).then((result) => { outcome = result })
    })
    socket.write('POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"a":1}')
    await new Promise((resolve) => setTimeout(resolve, 900))
    assert.ok(outcome !== null, '超时后必须 settle（否则 handler 无限期挂着）')
    assert.equal(outcome.ok, false)
    assert.equal(outcome.code, 'bad-request')
    assert.match(outcome.message, /超时/)
  } finally {
    // **必须 finally 清理**：断言失败（实现回归）时 socket 还在，会把这个测试进程一直挂住
    // ——我第一版就踩了这个坑，变异测试因此跑了 5 分钟不结束。
    if (socket !== null) socket.destroy()
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    server.close()
  }
})
check('默认超时常量存在且是个小值（不能退化成靠宿主 300s 兜底）', () => {
  assert.ok(Number.isFinite(BODY_READ_TIMEOUT_MS), '必须有默认超时常量')
  assert.ok(BODY_READ_TIMEOUT_MS > 0 && BODY_READ_TIMEOUT_MS <= 60_000, `默认超时应 ≤60s，实际 ${BODY_READ_TIMEOUT_MS}`)
})
await checkAsync('正常请求体仍能读到（超时不能误伤）', async () => {
  const server = http.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  let outcome = null
  server.on('request', (req, res) => {
    readJsonBody(req).then((r) => {
      outcome = r
      // 必须回响应并收尾，否则客户端一直等（我第一版就漏了这句，测试自己挂住了）。
      res.writeHead(r.ok === true ? 200 : 400, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  const body = JSON.stringify({ name: 'x' })
  await new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', resolve) }
    )
    req.on('error', resolve)
    req.end(body)
  })
  assert.ok(outcome !== null, '正常请求必须 settle')
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.value, { name: 'x' })
  server.close()
})

console.log('\n[3] normalizeLabels：__proto__ 不得走原型 setter')
check('经 JSON.parse 的 __proto__ 键被当成普通分类标签', () => {
  // 错过的样子：`const labels = {}` + `labels['__proto__'] = 值` 走原型 setter，
  // 声明的标签不成为 own key，同时把对象原型换掉；categoryCounts 之后读 labels[id]
  // 可能渲染注入文案（审计实测）。已确认未污染 Object.prototype。
  const raw = JSON.parse('{"__proto__":{"zh":"注入","en":"INJECTED"},"ui":{"zh":"界面","en":"UI"}}')
  const labels = normalizeLabels(raw)
  assert.equal(Object.getPrototypeOf(labels), null, '必须是无原型对象')
  assert.ok(Object.hasOwn(labels, '__proto__'), '__proto__ 应成为普通 own key')
  assert.deepEqual({ ...labels.__proto__ }, { zh: '注入', en: 'INJECTED' }, '声明内容应被如实保留为普通值')
  assert.deepEqual({ ...labels.ui }, { zh: '界面', en: 'UI' })
  // 未污染全局
  assert.equal({}.polluted, undefined)
  assert.equal(Object.prototype.zh, undefined)
})
check('空/非法输入返回空表且不抛错', () => {
  for (const bad of [null, undefined, 42, 'x', [], true]) {
    const labels = normalizeLabels(bad)
    assert.equal(Object.keys(labels).length, 0)
  }
})

console.log('\n[4] sortPlugins：原型键不得绕过「未知排序」守卫')
check('constructor / toString / valueOf 与普通未知值一样明确报错', () => {
  // 错过的样子：`comparators[sort]` 走原型链，'constructor'/'toString' 命中原型函数，
  // `=== undefined` 守卫被绕过 → Array.sort 拿到假比较器（返回字符串），顺序无意义；
  // 'valueOf' 抛的是与「未知排序」无关的 TypeError。
  const items = [normalizeItem({ name: 'b' }), normalizeItem({ name: 'a' })]
  for (const bad of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'nope', '__proto__']) {
    assert.throws(
      () => sortPlugins(items, bad),
      (error) => /未知排序/.test(String(error.message)),
      `sort=${bad} 应报「未知排序」，实际错误信息不符`
    )
  }
})
check('四种合法排序仍然工作', () => {
  const items = [normalizeItem({ name: 'b', stars: 1 }), normalizeItem({ name: 'a', stars: 2 })]
  assert.equal(sortPlugins(items, 'name')[0].name, 'a')
  assert.equal(sortPlugins(items, 'top')[0].name, 'a')
  assert.equal(sortPlugins(items, 'new').length, 2)
  assert.equal(sortPlugins(items, 'downloads').length, 2)
})

console.log('')
if (failures.length > 0) {
  console.log(`稳健性回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`稳健性回归：${passed}/${passed} 全通过`)
}
