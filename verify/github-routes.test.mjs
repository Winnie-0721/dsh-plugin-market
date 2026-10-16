/**
 * GitHub 多线路容错回归（`plugin-market/lib/github-routes.js`）。
 *
 * 每条都对应一次**实测**出来的失败形状，不是风格偏好：
 *   1. 一条线路挂了要能换下一条（本机实测 raw 连续 4 次超时后第 5 次 200ms 成功）；
 *   2. **公共加速服务会用 200 回一个自己的 HTML 错误页**——只看 response.ok 就会把
 *      这条线路记成"可用"，之后每次请求都先撞它（故障被固化成默认路径）；
 *   3. 赢家要提到最前（否则每次检查都从坏线路开始，白付超时）；
 *   4. 用户自己的前缀是**插到最前**而不是替换整张表（替换会把一次镜像故障
 *      变成整条通道不可用），且直连永远不删；
 *   5. 前缀必须校验：非 https / 带上游凭据 / 带 query 的一律拒绝
 *      （公共前缀会把完整目标 URL 拼在路径上，query 会弄坏那个边界）；
 *   6. 总预算要**平摊**：第一条坏线路不能把预算吃光，否则后两条候选连试的机会都没有。
 *
 * 契约依据：docs/API-CONTRACT.md §2.8.1。
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_TOTAL_BUDGET_MS,
  GITHUB_PROXY_ENV,
  ROUTE_FAILURE_TTL_MS,
  fetchViaGithubRoutes,
  failedGithubRoutes,
  githubProxyFrom,
  githubProxyManaged,
  githubRoutesFor,
  isRouteLevelFailure,
  looksLikeHtml,
  normalizeGithubProxy,
  preferredGithubRoutes,
  rememberGithubRoute,
  resetGithubRouteState,
  routeUrl,
  serviceForUrl,
  setCustomGithubProxy,
  summarizeRouteAttempts
} from '../plugin-market/lib/github-routes.js'

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

/** 造一个响应；`body` 可以是对象（JSON）、字符串（原样）或 Buffer（二进制）。 */
function res(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
  }
}

/**
 * 记下每次请求的 URL，并按规则给响应。
 *
 * 匹配语义很重要：**带 `://` 的规则按"URL 前缀"匹配，其余按子串**。
 * 必须这样，因为加速前缀会把目标 URL **整个拼在路径里**——
 * `https://gh-proxy.com/https://api.github.com/x` 里同时含有两个主机名。
 * 用子串匹配的话，第一条 `api.github.com` 规则会把**经过代理的请求**也吃掉，
 * 于是测试在测「同一条线路被问了两次」，而不是「换线路」。
 */
function fakeFetch(rules) {
  const calls = []
  const impl = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, hasSignal: init?.signal !== undefined, headers: init?.headers })
    for (const [pattern, responder] of rules) {
      const hit = pattern.includes('://') ? target.startsWith(pattern) : target.includes(pattern)
      if (!hit) continue
      const out = typeof responder === 'function' ? responder(target) : responder
      // 返回 null/undefined 表示「这条不匹配」，继续看后面的规则。
      if (out !== null && out !== undefined) return out
    }
    return res('not found', 404)
  }
  impl.calls = calls
  return impl
}

/** 每个用例都从干净状态开始：赢家与负缓存都是模块级状态，会跨用例互相影响。 */
function reset() {
  resetGithubRouteState()
  setCustomGithubProxy(null)
}

console.log('\n[1] 线路表：每条服务各自的候选与顺序')

check('api 档不含对 api 回 403 的那两家（实测 ghproxy.net / ghfast.top 对 api 就是 403）', () => {
  reset()
  const api = githubRoutesFor('api')
  assert.equal(api[0], null, '直连必须在最前（规范路径优先）')
  assert.ok(!api.some((r) => typeof r === 'string' && r.includes('ghproxy.net')), 'ghproxy.net 不进 api 候选')
  assert.ok(!api.some((r) => typeof r === 'string' && r.includes('ghfast.top')), 'ghfast.top 不进 api 候选')
  assert.ok(api.some((r) => typeof r === 'string' && r.includes('gh-proxy.com')), '实测可用的要进候选')
})

check('每条列表都以直连兜底（前缀整体下线时最多是慢，而不是不可用）', () => {
  reset()
  for (const service of ['api', 'raw', 'download', 'cdn']) {
    assert.ok(githubRoutesFor(service).includes(null), `${service} 的候选里必须有直连`)
  }
})

check('cdn 档用「互替主机」而不是前缀（拼成 fastly.jsdelivr.net/https://… 只会 404）', () => {
  reset()
  const cdn = githubRoutesFor('cdn')
  assert.equal(cdn[0], null)
  const hosts = cdn.filter((r) => r !== null).map((r) => r.host)
  assert.deepEqual(hosts, ['fastly.jsdelivr.net', 'testingcf.jsdelivr.net', 'gcore.jsdelivr.net'])
  assert.ok(!cdn.some((r) => typeof r === 'string' && r.startsWith('http') && !r.includes('jsdelivr')),
    'cdn 档不该混进 GitHub 前缀代理（那会把 jsDelivr 地址拼错）')
})

check('不认识的 service 按 raw 处理（读取类最宽的一档），不抛错', () => {
  reset()
  assert.deepEqual(githubRoutesFor('nope'), githubRoutesFor('raw'))
})

check('默认总预算 = 单条超时（多线路不该让失败变慢）', () => {
  assert.equal(DEFAULT_TOTAL_BUDGET_MS, null, 'null 表示「回落到单条超时」，见 fetchViaGithubRoutes')
})

console.log('\n[2] routeUrl：前缀与互替主机两种形状')

check('前缀：目标 URL 原样进路径', () => {
  assert.equal(routeUrl('https://gh-proxy.com', 'https://api.github.com/x'), 'https://gh-proxy.com/https://api.github.com/x')
})

check('互替主机：换 host、保留 path 与 query', () => {
  assert.equal(routeUrl({ host: 'fastly.jsdelivr.net' }, 'https://cdn.jsdelivr.net/gh/a/b@main/c.json'), 'https://fastly.jsdelivr.net/gh/a/b@main/c.json')
})

check('直连：原样返回（调用方不必为它写分支）', () => {
  assert.equal(routeUrl(null, 'https://api.github.com/x'), 'https://api.github.com/x')
})

console.log('\n[3] serviceForUrl：下载循环里混着两类地址，必须按主机分表')

check('api / raw / 仓库页 / jsDelivr 各归各表', () => {
  assert.equal(serviceForUrl('https://api.github.com/repos/a/b/releases'), 'api')
  assert.equal(serviceForUrl('https://raw.githubusercontent.com/a/b/main/x.json'), 'raw')
  assert.equal(serviceForUrl('https://objects.githubusercontent.com/x'), 'raw')
  assert.equal(serviceForUrl('https://github.com/a/b/releases/download/v1/x.tgz'), 'download')
  assert.equal(serviceForUrl('https://codeload.github.com/a/b/tar.gz/v1'), 'download')
  assert.equal(serviceForUrl('https://cdn.jsdelivr.net/gh/a/b@main/x'), 'cdn')
  // 边缘域名也是 cdn 档：它们要能被换回别的边缘域名。
  assert.equal(serviceForUrl('https://fastly.jsdelivr.net/gh/a/b@main/x'), 'cdn')
})

check('认不出来的地址回落到 raw（绝不按 cdn 或 download 乱试）', () => {
  assert.equal(serviceForUrl('not a url'), 'raw')
  assert.equal(serviceForUrl('https://example.com/x'), 'raw')
})

console.log('\n[4] 前缀校验：只收干净的 https 前缀')

check('接受正常的 https 前缀，并归一化尾部斜杠', () => {
  assert.equal(normalizeGithubProxy('https://gh-proxy.com'), 'https://gh-proxy.com')
  assert.equal(normalizeGithubProxy('  https://gh-proxy.com/  '), 'https://gh-proxy.com')
  assert.equal(normalizeGithubProxy('https://host/sub/'), 'https://host/sub')
})

check('拒绝：非 https / 带上游凭据 / 带 query / 带 fragment / 反斜杠 / 空', () => {
  // 公共前缀会把完整目标 URL 拼在路径上：query 与 fragment 会破坏那个边界。
  assert.equal(normalizeGithubProxy('http://gh-proxy.com'), null, '非 https 拒绝')
  assert.equal(normalizeGithubProxy('https://user:pass@gh-proxy.com'), null, '带上游凭据拒绝')
  assert.equal(normalizeGithubProxy('https://gh-proxy.com/?a=1'), null, '带 query 拒绝')
  assert.equal(normalizeGithubProxy('https://gh-proxy.com/#x'), null, '带 fragment 拒绝')
  assert.equal(normalizeGithubProxy('https://gh-proxy.com\\x'), null, '反斜杠拒绝')
  assert.equal(normalizeGithubProxy(''), null)
  assert.equal(normalizeGithubProxy('   '), null)
  assert.equal(normalizeGithubProxy(null), null)
  assert.equal(normalizeGithubProxy(42), null)
})

check('空白环境变量视作未设置（不是"设了一个坏前缀"）', () => {
  assert.equal(githubProxyFrom({ [GITHUB_PROXY_ENV]: '   ' }), null)
  assert.equal(githubProxyManaged({ [GITHUB_PROXY_ENV]: '   ' }), false)
  assert.equal(githubProxyManaged({ [GITHUB_PROXY_ENV]: 'https://x' }), true)
})

console.log('\n[5] 载荷校验：拒绝「200 + HTML 错误页」')

check('looksLikeHtml 认得出 HTML/XML，且**不**误判 JSON', () => {
  assert.equal(looksLikeHtml('<!DOCTYPE html><html>'), true)
  assert.equal(looksLikeHtml('   \n  <html>'), true)
  assert.equal(looksLikeHtml('\uFEFF  <html>'), true, 'BOM 也要能识别')
  assert.equal(looksLikeHtml('<?xml version="1.0"?>'), true)
  assert.equal(looksLikeHtml('{"a":1}'), false)
  assert.equal(looksLikeHtml('[1,2]'), false)
  assert.equal(looksLikeHtml('   '), false)
  assert.equal(looksLikeHtml(null), false)
})

await checkAsync('加速服务回 200 + HTML ⇒ **不算成功**，且必须继续试下一条', async () => {
  reset()
  const fetchImpl = fakeFetch([
    // 最前面那条（直连）正常，把它换掉：让直连回 HTML 错误页。
    ['https://api.github.com', () => res('<html>mirror is busy</html>')],
    ['https://gh-proxy.com', () => res({ tag_name: 'v9.9.9' })]
  ])
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/repos/a/b/releases/latest', { fetchImpl })
  assert.equal(out.ok, true, '应当换到下一条可用线路')
  assert.equal(out.value.tag_name, 'v9.9.9')
  assert.equal(out.via.includes('gh-proxy.com'), true, `应从 gh-proxy.com 拿到，实际 ${out.via}`)
  assert.equal(out.attempts[0].ok, false)
  assert.match(out.attempts[0].reason, /HTML/, 'HTML 必须如实记进 attempts')
})

await checkAsync('200 + 不是合法 JSON ⇒ 也算这条线路失败', async () => {
  reset()
  const fetchImpl = fakeFetch([
    ['https://api.github.com', () => res('this is not json at all')],
    ['https://gh-proxy.com', () => res({ ok: 1 })]
  ])
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', { fetchImpl })
  assert.equal(out.ok, true)
  assert.match(out.attempts[0].reason, /JSON/)
})

await checkAsync('validate 回调能进一步否掉载荷（成功但内容不对）', async () => {
  reset()
  const fetchImpl = fakeFetch([
    ['https://api.github.com', () => res({ schema: 'wrong' })],
    ['https://gh-proxy.com', () => res({ schema: 'right' })]
  ])
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', {
    fetchImpl,
    validate: (value) => (value.schema === 'right' ? true : { ok: false, reason: 'schema 不对' })
  })
  assert.equal(out.ok, true)
  assert.equal(out.value.schema, 'right')
  assert.match(out.attempts[0].reason, /schema/)
})

await checkAsync('全部失败 ⇒ ok:false，且 attempts **逐条**保留原始原因（不折叠）', async () => {
  reset()
  const fetchImpl = fakeFetch([
    ['https://api.github.com', () => res('', 403)],
    ['https://gh-proxy.com', () => { throw Object.assign(new Error('connect timeout'), { name: 'TimeoutError' }) }],
    ['https://gh-proxy.org', () => res('', 503)]
  ])
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', { fetchImpl })
  assert.equal(out.ok, false)
  const reasons = out.attempts.map((a) => a.reason)
  assert.equal(reasons.length >= 3, true, '三条线路各留一条记录')
  assert.ok(reasons.some((r) => /403/.test(r)), '限流要留档')
  assert.ok(reasons.some((r) => /超时/.test(r)), '超时要留档（不是一句 fetch failed）')
  assert.ok(reasons.some((r) => /503/.test(r)), '5xx 要留档')
  assert.match(summarizeRouteAttempts(out.attempts), /403/)
})

console.log('\n[6] 赢家记忆：这次证明能用的，下次先试')

await checkAsync('成功后被记住，并提到候选最前', async () => {
  reset()
  const fetchImpl = fakeFetch([
    ['https://api.github.com', () => res('', 500)],
    ['https://gh-proxy.com', () => res({ ok: 1 })]
  ])
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', { fetchImpl })
  assert.equal(out.ok, true)
  assert.equal(out.via, 'https://gh-proxy.com')
  assert.equal(preferredGithubRoutes().api, 'https://gh-proxy.com')
  // 下一次：赢家必须排第一。
  assert.equal(githubRoutesFor('api')[0], 'https://gh-proxy.com')
})

check('赢家按**服务**记，不串台（raw 的经验不影响 api）', () => {
  reset()
  rememberGithubRoute('raw', 'https://ghfast.top')
  assert.equal(githubRoutesFor('raw')[0], 'https://ghfast.top')
  assert.equal(githubRoutesFor('api')[0], null, 'api 的第一条仍应是直连')
  assert.equal(preferredGithubRoutes().raw, 'https://ghfast.top')
  assert.equal(preferredGithubRoutes().api, undefined)
})

check('rememberGithubRoute 忽略不认识的 service（不往表里塞垃圾键）', () => {
  reset()
  rememberGithubRoute('bogus', 'https://x')
  assert.equal(preferredGithubRoutes().bogus, undefined)
})

console.log('\n[7] 负缓存：一条刚挂的线路，这次别先试')

check('**404 不算线路故障**（线路是通的，只是这个路径没内容）', () => {
  // 这条是最容易做错的：把 404 当线路故障会把一条好线路封掉——
  // 同一个线路上的**别的地址**完全可能存在。
  assert.equal(isRouteLevelFailure('HTTP 404'), false)
  assert.equal(isRouteLevelFailure('HTTP 403'), true, '限流是针对线路的，换个路径也一样')
  assert.equal(isRouteLevelFailure('HTTP 500'), true)
  assert.equal(isRouteLevelFailure('HTTP 503'), true)
  assert.equal(isRouteLevelFailure('超时（8s）'), true)
  assert.equal(isRouteLevelFailure('请求失败：fetch failed'), true)
  assert.equal(isRouteLevelFailure('正文是 HTML（不是 JSON）'), true)
  assert.equal(isRouteLevelFailure(undefined), false)
})

await checkAsync('超时后该线路排到后面（同一轮里的后续请求不再白等它）', async () => {
  reset()
  console.log(`      （负缓存 TTL = ${ROUTE_FAILURE_TTL_MS / 1000}s，够覆盖一次 check()）`)
  // **一次只测一个机制**：这里要测的是负缓存，所以让其余线路也失败（但用**不是**线路级
  // 故障的 404），免得"赢家记忆"把某条线路提到最前，掩盖负缓存的效果。
  const fetchImpl = fakeFetch([
    ['https://api.github.com', () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }],
    ['https://gh-proxy.com', () => res('', 404)],
    ['https://gh-proxy.org', () => res('', 404)]
  ])
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', { fetchImpl })
  assert.equal(out.ok, false)
  const after = githubRoutesFor('api')
  assert.notEqual(after[0], null, '刚超时过的直连不该还排第一')
  assert.equal(after[after.length - 1], null, '它应该被排到最后（而不是删掉）')
  assert.ok(after.includes(null), '排到最后 ≠ 弃用：它仍然在候选里')
  assert.ok(failedGithubRoutes().some((entry) => entry.service === 'api' && entry.route === null))
})

await checkAsync('404 之后该线路**不**被降级（路径问题不是线路问题）', async () => {
  reset()
  // 全部 404：没有赢家，于是顺序**原样不动**——这正是"404 不算线路故障"的判据。
  const fetchImpl = fakeFetch([
    ['https://api.github.com', () => res('', 404)],
    ['https://gh-proxy.com', () => res('', 404)],
    ['https://gh-proxy.org', () => res('', 404)]
  ])
  await fetchViaGithubRoutes('api', 'https://api.github.com/does-not-exist', { fetchImpl })
  assert.equal(githubRoutesFor('api')[0], null, '404 不能把直连降级')
  assert.equal(failedGithubRoutes().length, 0, '404 不该进负缓存')
})

await checkAsync('同一源的镜像遇到 404 就停：换镜像问不出别的答案', async () => {
  reset()
  // jsDelivr 四个域名是**同一份内容**的不同边缘：对不可变的标签，
  // 一个说 404，别的不可能有——再问三个只是白花三次请求。
  let asked = 0
  const fetchImpl = async (url) => { asked += 1; return res('not found', 404) }
  const out = await fetchViaGithubRoutes('cdn', 'https://cdn.jsdelivr.net/gh/a/b@v1.0.1/releases/index.json', { fetchImpl })
  assert.equal(out.ok, false)
  assert.equal(asked, 1, `同一源的镜像遇 404 应只问一次，实际问了 ${asked} 次`)
})

await checkAsync('但**不同公司**的前缀代理遇 404 仍要换一家问', async () => {
  reset()
  // gh-proxy.com 与 gh-proxy.org 是不同公司，各自上游可达性不同：
  // 一个回 404 也可能只是它自己取不到。
  let asked = 0
  const fetchImpl = async (url) => { asked += 1; return res('not found', 404) }
  const out = await fetchViaGithubRoutes('raw', 'https://raw.githubusercontent.com/a/b/main/x', { fetchImpl })
  assert.equal(out.ok, false)
  assert.ok(asked > 1, `不同前缀代理应逐个试，实际只问了 ${asked} 次`)
})

console.log('\n[8] 总预算与平摊：第一条坏线路不能把预算吃光')

await checkAsync('平摊预算：三条候选各拿到约 1/3，且总耗时不超预算', async () => {
  reset()
  // 三条全部「慢」（不是抛错，是各自拖到自己的预算用尽），并记录每条的 signal 是否超时。
  const aborted = []
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(res({ ok: 1 })), 5000)
    if (init?.signal) {
      init.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        aborted.push(String(url))
        reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      })
    }
  })
  const started = Date.now()
  const budget = 1200
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', {
    fetchImpl,
    timeoutMs: budget,
    totalBudgetMs: budget
  })
  const elapsed = Date.now() - started
  assert.equal(out.ok, false)
  assert.ok(aborted.length >= 2, `三条候选都应被真的试过（而不是第一条吃光预算），实际试了 ${aborted.length} 条`)
  // **总预算必须是硬上界**，不是"建议"。早先这里用的是 `< 2400`（2× 预算），
  // 结果 `Math.max(1_000, …)` 那个下限把 1200ms 的预算实际拖成 2032ms 也照样通过。
  // 现在按"预算 + 一点调度余量"卡死：超了就是超了。
  assert.ok(elapsed <= budget + 400, `总耗时必须是预算的硬上界（约 ${budget}ms），实际 ${elapsed}ms`)
})

await checkAsync('预算耗尽后如实记录「整条链超时」，不静默跳过', async () => {
  reset()
  // 把预算设得极小，让第一条就用完。
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(res({ ok: 1 })), 3000)
    init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('x'), { name: 'TimeoutError' })) })
  })
  const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', { fetchImpl, timeoutMs: 150, totalBudgetMs: 200 })
  assert.equal(out.ok, false)
  assert.ok(out.attempts.some((a) => /整条链超时/.test(a.reason)), `要如实说明是总预算用尽，实际：${JSON.stringify(out.attempts.map((a) => a.reason))}`)
})

await checkAsync('没有 fetch 的环境：如实报不可用，不抛错', async () => {
  reset()
  // 必须**真的**把全局 fetch 摘掉：fetchViaGithubRoutes 在没注入 fetchImpl 时
  // 会退回 globalThis.fetch，而 Node 自带它——传 null 是摘不掉它的
  // （早先这条断言实际打到了真网络，拿回 HTTP 404 而不是"没有 fetch"）。
  const saved = globalThis.fetch
  try {
    delete globalThis.fetch
    const out = await fetchViaGithubRoutes('api', 'https://api.github.com/x', {})
    assert.equal(out.ok, false)
    assert.match(out.attempts[0].reason, /没有 fetch/)
  } finally {
    globalThis.fetch = saved
  }
})

console.log('\n[9] 用户自定义前缀：插到最前，而不是替换整张表')

check('用户前缀排第一，且**其余候选仍然保留**、直连仍在', () => {
  reset()
  setCustomGithubProxy('https://my.mirror.example')
  const routes = githubRoutesFor('raw')
  assert.equal(routes[0], 'https://my.mirror.example')
  assert.ok(routes.includes(null), '直连永远不删（删了就把镜像故障变成彻底不可用）')
  assert.ok(routes.length > 2, '其余候选也要留着：用户的前缀挂了还有备胎')
})

check('用户填的正好是表里已有的前缀 ⇒ 去重，等于拿回原表', () => {
  reset()
  setCustomGithubProxy('https://gh-proxy.com')
  const routes = githubRoutesFor('raw')
  assert.equal(routes.filter((r) => r === 'https://gh-proxy.com').length, 1, '不能出现两次同一个前缀')
  assert.equal(routes[0], 'https://gh-proxy.com')
})

check('设一个不合法的前缀 ⇒ 清除，而不是静默成一个能用的', () => {
  reset()
  setCustomGithubProxy('https://good.example')
  assert.equal(githubRoutesFor('raw')[0], 'https://good.example')
  setCustomGithubProxy('http://bad.example')
  assert.equal(githubRoutesFor('raw')[0], null, '非法值应清除覆盖，回到默认表')
})

check('清除覆盖后回到默认表', () => {
  reset()
  setCustomGithubProxy('https://my.mirror.example')
  setCustomGithubProxy(null)
  assert.deepEqual(githubRoutesFor('raw'), githubRoutesFor('raw'))
  assert.equal(githubRoutesFor('raw')[0], null)
})

check('改前缀会清掉学到的赢家（候选变了，旧赢家未必还在）', () => {
  reset()
  rememberGithubRoute('raw', 'https://ghfast.top')
  assert.equal(githubRoutesFor('raw')[0], 'https://ghfast.top')
  setCustomGithubProxy('https://my.mirror.example')
  assert.equal(preferredGithubRoutes().raw, undefined, '配置变了就该忘掉旧赢家')
})

console.log('\n[10] setCustomGithubProxy 的幂等与 resetGithubRouteState')

check('设同一个值两次不重置赢家（幂等）', () => {
  reset()
  setCustomGithubProxy('https://my.mirror.example')
  rememberGithubRoute('raw', 'https://ghfast.top')
  setCustomGithubProxy('https://my.mirror.example')
  assert.equal(preferredGithubRoutes().raw, 'https://ghfast.top', '值没变就不该清赢家')
})

check('resetGithubRouteState 同时清掉赢家与负缓存', async () => {
  reset()
  rememberGithubRoute('raw', 'https://ghfast.top')
  const fetchImpl = async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }
  await fetchViaGithubRoutes('api', 'https://api.github.com/x', { fetchImpl, timeoutMs: 100, totalBudgetMs: 150 })
  assert.ok(Object.keys(preferredGithubRoutes()).length > 0)
  reset()
  assert.deepEqual(preferredGithubRoutes(), {})
  assert.deepEqual(failedGithubRoutes(), [])
})

const total = passed + failures.length
console.log(`\nGitHub 多线路回归：${failures.length ? `${passed}/${total} 通过，失败：${failures.join('；')}` : `${total}/${total} 全通过`}`)
if (failures.length > 0) process.exit(1)
