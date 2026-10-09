/**
 * host 半的契约回归（`verify/` 下所有 *.test.mjs 都由 release.ps1 门禁执行）。
 *
 * 每条都对应一个真实存在过的缺陷，而不是风格偏好：
 *   1. `sendError` 把 `diagnostic` 丢了 → 契约 §2.8 的字段永远拿不到，客户端靠它做
 *      「文件被占用」的可操作提示；
 *   2. `ok: error === null` 把宿主的 `application:'failed'` 报成成功 → 客户端渲染绿色
 *      「已安装」并计为成功；
 *   3. 重名插件「第一个匹配就装」→ 用户请求 `dsh-memory` 会随机装上别人的包；
 *   4. 重启端点在**安排退出之前**写响应 → 响应写失败后 `already:true` 让重启永久失效；
 *   5. 宿主错误码当对象键 → `__proto__` 之类拿到 Object.prototype 的值。
 *
 * 用法：node verify/host-contract.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { sendError, sendJson, createRouteTable } from '../plugin-market/lib/http.js'
import { sendChangeResult, findCatalogItem, verifyActivation, noteRestartFromResult, restartPendingSnapshot } from '../plugin-market/lib/index.js'
import { buildHelperCommand, buildRestartPayload, spawnRestartHelper } from '../plugin-market/lib/restart.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const indexSource = readFileSync(new URL('../plugin-market/lib/index.js', import.meta.url), 'utf8')

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
function capture() {
  const res = {
    status: null,
    headers: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
    end(body) { this.body = body; this.writableEnded = true }
  }
  return res
}

console.log('\n[1] sendError：diagnostic 必须真的出现在响应体里')
check('diagnostic 被透传（契约 §2.8）', () => {
  // 错过的样子：sendError 只读 message/hint，传进来的 diagnostic 被静默丢掉，
  // 于是「更新通道没有回应」这类错误永远不带「每个源各自为什么失败」。
  const res = capture()
  sendError(res, 502, 'self-update-unavailable', {
    message: '更新源都没回应。',
    hint: '稍后重试。',
    diagnostic: 'jsDelivr：HTTP 403；GitHub：timeout'
  })
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.diagnostic, 'jsDelivr：HTTP 403；GitHub：timeout')
})
check('没有 diagnostic 时不凭空造字段', () => {
  const res = capture()
  sendError(res, 500, 'internal')
  const payload = JSON.parse(res.body)
  assert.equal(Object.hasOwn(payload.error, 'diagnostic'), false)
})
check('空的 diagnostic 字符串不写入', () => {
  const res = capture()
  sendError(res, 500, 'internal', { diagnostic: '' })
  assert.equal(Object.hasOwn(JSON.parse(res.body).error, 'diagnostic'), false)
})
check('message/hint 覆盖仍然生效', () => {
  const res = capture()
  sendError(res, 400, 'bad-request', { message: '自定义', hint: '自定义提示' })
  const payload = JSON.parse(res.body)
  assert.equal(payload.error.message, '自定义')
  assert.equal(payload.error.hint, '自定义提示')
})

console.log('\n[2] 变更结果：ok 不能只看 error（行为测试，真调 handler）')
check('ok 在 application:"failed" 时为 false，且 cancelled 带 error 时仍为 true', () => {
  // 只 grep 源码形状测不出行为（等价的写法改一下顺序就会假红）。这里直接调真实的
  // sendChangeResult 路径：用假 res 捕获响应体，逐种 application 核对 ok。
  // 错过的样子：`ok: error === null`——宿主的 ChangeResult 里 error 是可选的，
  // `application:'failed'` 不带 error 时被报成 ok:true，客户端渲染绿色「已安装」并计为成功。
  const cases = [
    // [application, error, 期望 ok]
    ['applied', null, true],
    ['restart-required', null, true],
    ['failed', null, false],
    ['failed', { code: 'operation-error' }, false],
    // cancelled 是用户自己取消的：即便宿主带一个 error 说明原因，也要 ok:true，
    // 否则 requestJSON 抛错、客户端「已取消」文案永远不可达。
    ['cancelled', { code: 'operation-error' }, true],
    ['cancelled', null, true],
  ]
  for (const [application, error, expected] of cases) {
    const res = capture()
    sendChangeResult(res, { changed: true, application, error }, 'install')
    const payload = JSON.parse(res.body)
    assert.equal(
      payload.ok,
      expected,
      `application=${application} error=${error ? 'set' : 'null'} → ok 应为 ${expected}`
    )
  }
})

console.log('\n[3] 重名插件：不猜，报歧义（行为测试，真调 findCatalogItem）')
check('身份字段命中即确定（id / npm / url 都是唯一身份）', () => {
  const items = [
    { id: 'aaa/dup', name: 'dup', owner: 'aaa', npm: 'dup-npm', url: 'https://github.com/aaa/dup' },
    { id: 'bbb/dup', name: 'dup', owner: 'bbb', npm: null, url: 'https://github.com/bbb/dup' },
  ]
  assert.equal(findCatalogItem(items, 'aaa/dup').item?.id, 'aaa/dup', 'id 精确命中')
  assert.equal(findCatalogItem(items, 'dup-npm').item?.id, 'aaa/dup', 'npm 精确命中')
  assert.equal(findCatalogItem(items, 'https://github.com/bbb/dup').item?.id, 'bbb/dup', 'url 精确命中')
  for (const key of ['aaa/dup', 'dup-npm', 'https://github.com/bbb/dup']) {
    assert.equal(findCatalogItem(items, key).ambiguous, false, `${key} 不该判歧义`)
  }
})
check('显示名唯一才确定；**重名时报歧义且不返回任何条目**', () => {
  // 错过的样子：id/npm/url/name 混在一个 `Array.find` 里 → 第一个匹配就装。
  // 真实目录 195 个重名（`dsh-memory` 对应 10 条 5 个不同 spec），用户请求重名插件会装上别人的包。
  const items = [
    { id: 'aaa/dup', name: 'dup', owner: 'aaa', npm: null, url: 'https://github.com/aaa/dup' },
    { id: 'bbb/dup', name: 'dup', owner: 'bbb', npm: null, url: 'https://github.com/bbb/dup' },
  ]
  const hit = findCatalogItem(items, 'dup')
  assert.equal(hit.ambiguous, true, '重名必须报歧义')
  assert.equal(hit.item, null, '歧义时绝不能返回其中任意一个')
  const single = findCatalogItem([items[0]], 'dup')
  assert.equal(single.ambiguous, false, '只有一条时不算歧义')
  assert.equal(single.item?.id, 'aaa/dup')
})
check('找不到 / null 输入都如实返回「没有」而不是猜一个', () => {
  const items = [{ id: 'aaa/x', name: 'x', owner: 'aaa', npm: null, url: 'https://github.com/aaa/x' }]
  assert.deepEqual(findCatalogItem(items, 'nope'), { item: null, ambiguous: false })
  assert.deepEqual(findCatalogItem(items, null), { item: null, ambiguous: false })
})
check('install 路由遇到歧义回 400 bad-request，而不是随便装一个', () => {
  assert.match(indexSource, /found\.ambiguous/, 'install 路由必须检查歧义')
  assert.match(indexSource, /市场不猜/, '要给用户一句可照做的说明')
})

console.log('\n[4] 重启端点：先安排退出，再写响应')
check('setTimeout(process.exit) 出现在 sendJson 之前（源码顺序）', () => {
  // 错过的样子：先 sendJson 再 setTimeout——响应写失败（客户端切走/代理断开）时
  // 异常被外层吞掉，退出永远不会被安排，而 restart.js 已置 requested，
  // 之后每次点击都回 already:true 并跳过安排 → 重启功能永久失效。
  const at = indexSource.indexOf('async restart(req, res) {')
  assert.ok(at > 0, '找得到 restart handler')
  const body = indexSource.slice(at, at + 1400)
  const exitAt = body.indexOf('process.exit(0)')
  const sendAt = body.indexOf('sendJson(res, 200')
  assert.ok(exitAt > 0 && sendAt > 0, '两处都要在')
  assert.ok(exitAt < sendAt, `安排退出必须先于写响应（exit@${exitAt} send@${sendAt}）`)
})

console.log('\n[5] 宿主错误码映射表：原型键不能穿过去')
check('MANAGEMENT_MESSAGE / MANAGEMENT_HINT 是 Map（不是对象字面量）', () => {
  // 错过的样子：对象字面量 + `TABLE[code]`，`code='__proto__'` 拿到 Object.prototype
  // 的对象，`code='constructor'` 拿到函数——契约要求 message 是字符串。
  assert.match(indexSource, /const MANAGEMENT_MESSAGE = new Map\(Object\.entries\(\{/)
  assert.match(indexSource, /const MANAGEMENT_HINT = new Map\(Object\.entries\(\{/)
  assert.match(indexSource, /MANAGEMENT_MESSAGE\.get\(code\)/)
  assert.match(indexSource, /MANAGEMENT_HINT\.get\(code\)/)
})

console.log('\n[6] 重启助手：' + "'error' 监听先于任何提早返回")
check('spawn 之后立刻挂 error 监听（源码顺序）', () => {
  const source = readFileSync(new URL('../plugin-market/lib/restart.js', import.meta.url), 'utf8')
  const spawnAt = source.indexOf('built.spawnImpl(')
  const onErrorAt = source.indexOf("child.on('error'")
  const pidCheckAt = source.indexOf('if (pid <= 0)')
  assert.ok(spawnAt > 0 && onErrorAt > spawnAt, "error 监听要在 spawn 之后")
  assert.ok(onErrorAt < pidCheckAt, "error 监听必须在 pid<=0 那条提早返回之前（否则未处理的 'error' 会崩宿主）")
})
check('payload 校验：非法 pid / execPath / args 一律拒绝，不 spawn', () => {
  assert.equal(buildRestartPayload({ pid: 0, execPath: 'x', args: [] }), null)
  assert.equal(buildRestartPayload({ pid: 1, execPath: '', args: [] }), null)
  assert.equal(buildRestartPayload({ pid: 1, execPath: 'x', args: [1] }), null)
  assert.ok(buildRestartPayload({ pid: 1, execPath: 'x', args: [] }) !== null)
})
check('助手脚本缺失时在 spawn 之前就拒绝', () => {
  const built = buildHelperCommand({ pid: 1, execPath: 'node', args: [], helperFile: 'no/such/helper.cjs', existsSyncImpl: () => false })
  assert.equal(built.ok, false)
})
check('spawn 返回没有 pid 时不抛错（异步 ENOENT 形状）且状态不置位', () => {
  // 真 spawn 一个不存在的可执行文件：pid 是 undefined 且错误是异步事件。
  // 这里只验返回值（不真的等事件）——事件监听顺序由上面那条源码断言钉住。
  const state = { requested: false, pid: null }
  const result = spawnRestartHelper({
    state,
    pid: process.pid,
    execPath: 'E:/definitely/not/here/dsh-helper-missing.exe',
    args: [],
    spawnImpl: () => ({ pid: undefined, on() {}, unref() {} })
  })
  assert.equal(result.ok, false)
  assert.equal(state.requested, false, '启动失败不得把 requested 置位（否则重试拿到 already:true）')
})

console.log('\n[7] 目录响应带上过期原因：/catalog 必须给 error')
check('catalog 响应里有 error 字段（客户端靠它显示过期原因）', () => {
  // 客户端 staleSource 优先取 /catalog 的 catalog 对象；如果这里不带 error，
  // 「目录已过期」横幅的原因就永远是「原因未知」——只有 /status 那份带 error（字符串错误码）。
  assert.match(
    indexSource,
    /source: cache\.source,\s*\n\s*stale: cache\.stale === true,\s*\n\s*(?:\/\/[^\n]*\n\s*)*error: cache\.error \?\? null/,
    'catalog 响应必须带 error: cache.error ?? null'
  )
  assert.match(indexSource, /requestedPage: pageInfo\.requestedPage/, 'page 里要有 requestedPage')
})

console.log('\n[8] 路由表：重复注册的行为是明确的')
check('同一路径再注册会覆盖（所以 GET/POST 必须合并成一个 handler）', () => {
  // 这不是 bug，是必须被记住的约束：index.js 的 /self-update 因此合并成一个 handler。
  const table = createRouteTable()
  table.on('/x', ['GET'], () => {})
  table.on('/x', ['POST'], () => {})
  assert.deepEqual(table.paths(), ['/x'])
})
check('/self-update 在 index.js 里只注册一次且含 GET/POST', () => {
  assert.match(indexSource, /\.on\(`\$\{ROUTE_PREFIX\}\/self-update`, \['GET', 'POST'\]/)
})

console.log('\n[9] 装后激活校验：回读宿主状态，不说谎（行为测试，真调 verifyActivation）')
/** 造一份 bundle 快照 Map（和小写键的实现一致）。 */
function snap(list) {
  const map = new Map()
  for (const b of list) {
    map.set(b.name.toLowerCase(), {
      name: b.name,
      version: b.version ?? null,
      enabled: b.enabled !== false,
      failed: b.failed === true
    })
  }
  return map
}
check('新条目出现且启用 ⇒ live；版本一致时 versionMatches 为 true', () => {
  const out = verifyActivation({
    application: 'applied',
    before: snap([]),
    after: snap([{ name: 'dsh-foo', version: '0.63.0' }]),
    candidates: ['dsh-foo'],
    expectedVersion: '0.63.0'
  })
  assert.equal(out.state, 'live')
  assert.equal(out.installed, '0.63.0')
  assert.equal(out.versionMatches, true)
  assert.equal(out.enabled, true)
})
check('application=restart-required 时不许报 live（宿主原话是还没生效）', () => {
  // 错过的样子：只看「条目在列表里」就报 live——重启前新代码并没有生效。
  const out = verifyActivation({
    application: 'restart-required',
    before: snap([]),
    after: snap([{ name: 'dsh-foo', version: '1.2.0' }]),
    candidates: ['dsh-foo'],
    expectedVersion: '1.2.0'
  })
  assert.equal(out.state, 'restart')
})
check('**磁盘版本与目录版本不一致时 versionMatches=false**（界面不能写「已更新」）', () => {
  // 错过的样子：pnpm 说成功、目录说有 0.63.0，磁盘上还是 0.62.3，界面照样报成功。
  const out = verifyActivation({
    application: 'applied',
    before: snap([{ name: 'dsh-foo', version: '0.62.3' }]),
    after: snap([{ name: 'dsh-foo', version: '0.62.3' }]),
    candidates: ['dsh-foo'],
    expectedVersion: '0.63.0'
  })
  assert.equal(out.state, 'live')
  assert.equal(out.versionMatches, false)
  assert.equal(out.installed, '0.62.3')
  assert.ok(out.reasons.includes('version-mismatch'))
})
check('宿主报成功但列表里没有它 ⇒ inert（以前完全看不见的一类）', () => {
  const out = verifyActivation({
    application: 'applied',
    before: snap([]),
    after: snap([]),
    candidates: ['dsh-not-a-bundle'],
    expectedVersion: '1.0.0'
  })
  assert.equal(out.state, 'inert')
  assert.ok(out.reasons.includes('not-in-bundle-list'))
})
check('条目在列表里但自身带 error ⇒ broken；停用 ⇒ disabled', () => {
  const broken = verifyActivation({
    application: 'applied',
    before: snap([]),
    after: snap([{ name: 'dsh-foo', failed: true }]),
    candidates: ['dsh-foo']
  })
  assert.equal(broken.state, 'broken')
  const disabled = verifyActivation({
    application: 'applied',
    before: snap([]),
    after: snap([{ name: 'dsh-foo', enabled: false }]),
    candidates: ['dsh-foo']
  })
  assert.equal(disabled.state, 'disabled')
})
check('读不回列表 / 没有基线且找不到它的名字 / 新条目多个分不清 ⇒ unknown，不猜一个状态出来', () => {
  const noRead = verifyActivation({ application: 'applied', before: snap([]), after: null, candidates: ['x'] })
  assert.equal(noRead.state, 'unknown')
  assert.ok(noRead.reasons.includes('read-back-unavailable'))
  // 没有基线（读不到装前快照）时：**认不出归因，但列表里有它就照样报 live**，
  // 同时用 `no-baseline` 记下「这不是这次操作装上的证据」。把已知的「它在跑」降级成
  // unknown 反而是另一种不诚实。
  const noBaselineButPresent = verifyActivation({
    application: 'applied',
    after: snap([{ name: 'x' }]),
    candidates: ['x']
  })
  assert.equal(noBaselineButPresent.state, 'live')
  assert.ok(noBaselineButPresent.reasons.includes('no-baseline'))
  // 没有基线**且**列表里也找不到它：既可能是没落地、也可能是包名与 bundle 名毫无关系 → 不猜。
  const noBaselineNotFound = verifyActivation({
    application: 'applied',
    after: snap([{ name: 'other' }]),
    candidates: ['x']
  })
  assert.equal(noBaselineNotFound.state, 'unknown')
  // 一次多出两个 bundle 且候选名匹配不上任何唯一一个：不挑一个报 live。
  const ambiguous = verifyActivation({
    application: 'applied',
    before: snap([]),
    after: snap([{ name: 'a' }, { name: 'b' }]),
    candidates: ['c']
  })
  assert.equal(ambiguous.state, 'unknown')
  assert.ok(ambiguous.reasons.includes('ambiguous-bundle'))
})
check('**同一个候选名重复出现不算歧义**（更新已装插件时 100% 命中这条：拿回 live 而不是 unknown）', () => {
  // 真实调用点 install()：candidates: [hit?.npm, hit?.name, hit?.id, requestedSpec, requestedName]。
  // 客户端「更新」发的是 submitInstall({ name: bundle.name, spec: bundle.name })，
  // 而目录里 npm / name / id 常常等于或包含同一个包名 → 同一个字符串在数组里出现 3~5 次。
  // 更新**已装**插件时 before 里已有它（appeared 为空），于是走到 present 分支；
  // 以前 present.length 数的是**出现次数**而不是**不同名字的个数**，重复候选被当成
  // 「有多个候选都在列表里」→ reasons 里写 ambiguous-bundle、state 变 unknown，
  // 客户端就把一次成功的更新渲染成「已安装，但这次没能回读装载状态」。
  // 实测真实目录（4412 条）：2288 个有 npm 的条目 **全部** 会误报，版本对不上时真正
  // 该报的「版本没落地」告警也被这条误报盖掉（versionMatches=false 的升级分支走不到）。
  const out = verifyActivation({
    application: 'applied',
    before: snap([{ name: 'dsh-kaomoji', version: '0.1.4' }]),
    after: snap([{ name: 'dsh-kaomoji', version: '0.1.5' }]),
    // 同一个名字出现多次（npm / name / requestedSpec / requestedName 撞在一起）+ 一个不同的 id
    candidates: ['dsh-kaomoji', 'dsh-kaomoji', 'TianJie52009/dsh-kaomoji', 'dsh-kaomoji', 'dsh-kaomoji'],
    expectedVersion: '0.1.5'
  })
  assert.equal(out.state, 'live', '重复的候选名不该让状态降级成 unknown')
  assert.equal(out.installed, '0.1.5')
  assert.equal(out.versionMatches, true)
  assert.ok(!out.reasons.includes('ambiguous-bundle'), '不得报 ambiguous-bundle')
  // 反向保证：**不同**名字同时命中两个不同 bundle 时，仍然必须拒绝猜。
  const realAmbiguous = verifyActivation({
    application: 'applied',
    before: snap([]),
    after: snap([{ name: 'dsh-a' }, { name: 'dsh-b' }]),
    candidates: ['dsh-a', 'dsh-b']
  })
  assert.equal(realAmbiguous.state, 'unknown', '两个不同名字各自命中一个 bundle 才算真歧义')
  assert.ok(realAmbiguous.reasons.includes('ambiguous-bundle'))
})
check('失败 / 取消 / 还在等批准构建脚本时不给激活状态（不该谈 inert）', () => {
  // 这是最容易误报的一种：宿主回 failed 或 pendingBuilds，回读必然「没落地」，
  // 不看这两个条件就会把一次「等用户批准」说成 inert（插件有问题）。
  const base = { before: snap([]), after: snap([]), candidates: ['x'] }
  assert.equal(verifyActivation({ ...base, application: 'failed' }), null)
  assert.equal(verifyActivation({ ...base, application: 'cancelled' }), null)
  assert.equal(verifyActivation({ ...base, application: 'overridden' }), null)
  assert.equal(verifyActivation({ ...base, application: 'applied', pending: true }), null)
})
check('激活状态进入了 install 的响应体（真调 sendChangeResult 读 body）', () => {
  const res = capture()
  const activation = verifyActivation({
    application: 'restart-required',
    before: snap([]),
    after: snap([{ name: 'dsh-foo', version: '1.0.0' }]),
    candidates: ['dsh-foo'],
    expectedVersion: '1.0.0'
  })
  sendChangeResult(res, { changed: true, application: 'restart-required' }, 'install', activation)
  const payload = JSON.parse(res.body)
  assert.equal(payload.activation.state, 'restart')
  // 不传 activation 时字段**不出现**（老客户端的响应形状不变）。
  const res2 = capture()
  sendChangeResult(res2, { changed: true, application: 'applied' }, 'install')
  assert.equal('activation' in JSON.parse(res2.body), false, '没传时不得凭空造一个 activation')
})
check('install 路由真的做了前后快照并传给 sendChangeResult（源码形状）', () => {
  assert.match(indexSource, /const before = await captureBundles\(manager\)/, '装之前要有基线')
  assert.match(indexSource, /const after = await captureBundles\(manager\)/, '装之后要回读')
  assert.match(indexSource, /sendChangeResult\(res, result, 'install', activation\)/, '要把 activation 传进去')
})

console.log('\n[P] 待重启记账：刷新页面不再丢（v1.2.0 第六轮）')
/**
 * 抠出「待重启记账」那两个真函数，在**全新作用域**里求值——拿到一个干净的模块实例。
 * 为什么需要：模块级记账是共享状态，前面的用例已经把它写脏了；
 * 在同一个实例里断言「初始是 null」永远不可能失败（我第一版就是那种假测试）。
 * 做法与 client-errorcopy.test.mjs 的 grab 一致：抠真源码、不复制逻辑。
 */
function buildFreshLedger() {
  function grab(signature) {
    const start = indexSource.indexOf(signature)
    if (start < 0) throw new Error(`抠不到：${signature}`)
    let i = indexSource.indexOf('{', start)
    let depth = 0
    for (let j = i; j < indexSource.length; j += 1) {
      if (indexSource[j] === '{') depth += 1
      else if (indexSource[j] === '}') {
        depth -= 1
        if (depth === 0) return indexSource.slice(start, j + 1)
      }
    }
    throw new Error(`括号不配平：${signature}`)
  }
  const body = [
    // optionalText 是这两个函数的依赖（真源码里也是这么用的）
    grab('function optionalText('),
    grab('const restartPending = {'),
    grab('export function noteRestartFromResult(').replace('export function', 'function'),
    grab('export function restartPendingSnapshot(').replace('export function', 'function'),
    'return { noteRestartFromResult, restartPendingSnapshot };'
  ].join('\n')
  return new Function(body)()
}

check('restart-required 会被记账，/status 的 pendingRestart 带出包名', () => {
  const res = capture()
  sendChangeResult(res, { changed: true, application: 'restart-required', target: 'dsh-mobile' }, 'install')
  const snap = restartPendingSnapshot()
  assert.ok(snap !== null, 'restart-required 之后必须有待重启快照')
  assert.ok(snap.names.includes('dsh-mobile'), `包名要进名单，实际 ${JSON.stringify(snap.names)}`)
})
check('requiresRestart:true 也记账（宿主两种写法都要认）', () => {
  const res = capture()
  sendChangeResult(res, { changed: true, application: 'applied', requiresRestart: true, target: 'dsh-two' }, 'install')
  assert.ok(restartPendingSnapshot().names.includes('dsh-two'))
})
check('applied（已经热生效）**不**记账——装了新包不该提示重启', () => {
  const before = JSON.stringify(restartPendingSnapshot())
  const res = capture()
  sendChangeResult(res, { changed: true, application: 'applied', target: 'dsh-three' }, 'install')
  const after = restartPendingSnapshot()
  const names = after === null ? [] : after.names
  assert.equal(names.includes('dsh-three'), false, 'applied 不该进待重启名单')
  assert.equal(JSON.stringify(after), before, '快照不应被 applied 改动')
})
check('failed / cancelled 都不记账（没改成就别提重启）', () => {
  const before = JSON.stringify(restartPendingSnapshot())
  const r1 = capture()
  sendChangeResult(r1, { changed: false, application: 'failed', target: 'dsh-four' }, 'install')
  const r2 = capture()
  sendChangeResult(r2, { changed: false, application: 'cancelled', target: 'dsh-five' }, 'install')
  const snap = restartPendingSnapshot()
  const names = snap === null ? [] : snap.names
  assert.equal(names.includes('dsh-four'), false)
  assert.equal(names.includes('dsh-five'), false)
  assert.equal(JSON.stringify(snap), before)
})
check('同一个包重复记账只留一条（幂等，不是数组追加）', () => {
  const r1 = capture()
  sendChangeResult(r1, { changed: true, application: 'restart-required', target: 'dsh-six' }, 'install')
  const r2 = capture()
  sendChangeResult(r2, { changed: true, application: 'restart-required', target: 'dsh-six' }, 'install')
  const hits = restartPendingSnapshot().names.filter((n) => n === 'dsh-six').length
  assert.equal(hits, 1, `应去重，实际出现 ${hits} 次`)
})
check('市场自更新的版本号单独记（正文要说「插件市场已更新到 v…」）', () => {
  noteRestartFromResult({ application: 'restart-required', requiresRestart: true, to: '1.2.0' }, null)
  const snap = restartPendingSnapshot()
  assert.equal(snap.marketVersion, '1.2.0', '市场版版本要单独带出来，不能混进插件名单')
})
check('没有待重启项时快照是 null（客户端据此不显示横幅）', () => {
  // 必须用一个**全新的实例**：上面那些用例已经把模块级记账写脏了，
  // 在同一个实例里断言「初始是 null」是永远不可能失败的假测试。
  // （我第一版就是这么写的，还把它当成通过——那等于没测。）
  // 这里沿用 client-errorcopy 的抠函数做法：把真实源码抠出来在**新作用域**里求值，
  // 既是同步的，又拿到一个干净实例。
  const fresh = buildFreshLedger()
  assert.equal(fresh.restartPendingSnapshot(), null, '全新实例里没有待重启项，必须是 null')
  fresh.noteRestartFromResult({ application: 'applied', target: 'nope' }, null)
  assert.equal(fresh.restartPendingSnapshot(), null, 'applied 不该让它变成非 null')
  fresh.noteRestartFromResult({ application: 'restart-required', target: 'yes' }, null)
  const snap = fresh.restartPendingSnapshot()
  assert.notEqual(snap, null, 'restart-required 之后必须非 null')
  assert.deepEqual(snap.names, ['yes'], '只该有那一个名字')
})
check('名单有上限 32 条（长时间不重启不会无限增长）', () => {
  for (let i = 0; i < 40; i += 1) {
    const res = capture()
    sendChangeResult(res, { changed: true, application: 'restart-required', target: `dsh-cap-${i}` }, 'install')
  }
  const snap = restartPendingSnapshot()
  assert.ok(snap.names.length <= 32, `上限应为 32，实际 ${snap.names.length}`)
  assert.ok(snap.names.includes('dsh-cap-39'), '最新的必须保留（淘汰最旧的）')
})
check('/status 真的带上了 pendingRestart（源码形状：不是只记不报）', () => {
  // **必须限定在 status handler 的切片里**：`pendingRestart: restartPendingSnapshot()`
  // 在 self-update 里也有一处，全文件正则会被那一处满足——
  // 于是「把 /status 那行删掉」也能通过（变异测试 M4 就是这么漏掉的，我第一版写法不合格）。
  const from = indexSource.indexOf('async status(req, res)')
  const to = indexSource.indexOf('async catalog(req, res', from)
  assert.ok(from > 0 && to > from, '要能切出 status handler')
  const statusBody = indexSource.slice(from, to)
  assert.match(statusBody, /pendingRestart: restartPendingSnapshot\(\)/, '/status 要把快照带出去（刷新页面才能恢复横幅）')
})
check('客户端会用 /status 的 pendingRestart 水合横幅（两侧接上，缺一即断）', () => {
  const client = readFileSync(new URL('../plugin-market/lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /function hydrateRestartFromStatus\(/, '要有水合函数')
  assert.match(client, /hydrateRestartFromStatus\(payload\)/, 'loadStatus 成功后要调用它')
  assert.match(client, /payload\.pendingRestart/, '要读宿主给的字段（名字对齐，不能各写各的）')
  assert.match(client, /pendingRestart\.marketVersion/, '市场版版本也要接')
  // 水合**不许弹窗**：刷新页面突然跳出「立即重启/稍后重启」是一次打扰；
  // 横幅常驻已足够。弹窗只属于「当场做完写操作」那条路径。
  const fn = client.slice(
    client.indexOf('function hydrateRestartFromStatus('),
    client.indexOf('function maybeAskRestart(')
  )
  assert.equal(/maybeAskRestart\(/.test(fn), false, '水合路径不许弹窗')
})

console.log('')
if (failures.length > 0) {
  console.log(`host 契约回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`host 契约回归：${passed}/${passed} 全通过`)
}
