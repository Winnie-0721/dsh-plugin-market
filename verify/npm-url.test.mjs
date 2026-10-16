/**
 * npm tarball URL 与重定向的 SSRF 防护回归（审查任务 2 / P1）。
 *
 * 威胁形状（审查点名、代码确认）：`dist.tarball` 是**元数据里的字符串**，以前被
 * 直接 fetch 且 `redirect:'follow'` 盲目跟随每一跳。一个被污染/恶意的镜像可以让
 * 宿主进程去请求非预期目标：
 *   - `file:` / `data:` / `javascript:` 等协议；
 *   - 带 userinfo 的 URL（凭据外带、主机伪装）；
 *   - 重定向到 127.0.0.1:[端口] / 169.254.169.254（云元数据）/ 10.x / 192.168.x
 *     ——宿主进程在用户机器上，这就是一张内网探测图。
 *
 * 规则（平衡"拒恶意"与"别用白名单误伤合法镜像"——审查原话）：
 *   - **与操作员配置的 registry 同源** ⇒ 允许，即使是 http/回环——那是用户明确指名的
 *     本地镜像（verdaccio），测试夹具也靠这条活着；
 *   - **异源目标**（元数据给的新 URL、以及每一跳重定向）⇒ 必须 https、无 userinfo、
 *     主机不是回环/私网/链路本地/多播/保留段、不是 *.localhost；
 *     公共 CDN 主机照常放行（不设域名白名单）。
 *   - 重定向改为**手动逐跳**，每跳先验后请求——"危险目标没有被实际请求"是本文件的
 *     核心不变式，用请求记录证明，不是用返回码推断。
 *
 * 用法：node verify/npm-url.test.mjs
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { Buffer } from 'node:buffer'

import { validateRemoteTarget, readCatalogFromNpm, MAX_NPM_REDIRECTS } from '../plugin-market/lib/catalog-npm.js'

let passed = 0
const failures = []
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
function check(name, fn) {
  return checkAsync(name, async () => fn())
}

const REG = 'https://registry.npmmirror.com'

console.log('\n[1] 纯判定：validateRemoteTarget（先验后请求的那道闸）')

await check('与配置的 registry 同源 ⇒ 放行（默认镜像正常路径）', () => {
  const out = validateRemoteTarget(`${REG}/dsh-plugin-catalog/-/x.tgz`, REG)
  assert.equal(out.ok, true)
})

await check('异源但合法的公共 CDN（https、公网主机）⇒ 放行——不设域名白名单', () => {
  const out = validateRemoteTarget('https://cdn.example.com/pkg/-/x.tgz', REG)
  assert.equal(out.ok, true)
})

await check('操作员显式配置的本地镜像：registry 本身就是 http 回环 ⇒ 同源放行', () => {
  const local = 'http://127.0.0.1:4873'
  const out = validateRemoteTarget(`${local}/pkg/-/x.tgz`, local)
  assert.equal(out.ok, true, 'verdaccio/离线夹具这类明确配置的镜像不能被 SSRF 规则误伤')
})

await check('协议拒绝：file/data/javascript/blob', () => {
  for (const bad of ['file:///etc/passwd', 'data:text/plain;base64,AA==', 'javascript:alert(1)', 'blob:http://x/y', 'gopher://h/x']) {
    const out = validateRemoteTarget(bad, REG)
    assert.equal(out.ok, false, `${bad} 必须被拒`)
    assert.match(out.reason, /协议/, `${bad} 的拒绝理由应是协议：${out.reason}`)
  }
})

await check('userinfo 拒绝（凭据外带与主机伪装两用）', () => {
  const out = validateRemoteTarget('https://user:pass@cdn.example.com/x.tgz', REG)
  assert.equal(out.ok, false)
  assert.match(out.reason, /userinfo/)
  // 异源带空 userinfo 也一样拒（`@evil.com` 是经典的"看起来像合法主机"绕法）。
  const bare = validateRemoteTarget('https://registry.npmmirror.com@evil.com/x.tgz', REG)
  assert.equal(bare.ok, false, '@evil.com 形式必须被拒')
})

await check('异源指向内网/元数据地址全部拒绝', () => {
  const hostiles = [
    'https://127.0.0.1:6379/x',
    'https://localhost:8080/x',
    'https://svc.localhost/x',
    'https://[::1]:9/x',
    'https://0.0.0.0/x',
    'https://10.1.2.3/x',
    'https://172.16.0.1/x',
    'https://192.168.1.5/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/x', // CGNAT
    'https://224.0.0.1/x', // 多播/保留
    'https://metadata.google.internal/x',
    'https://metadata.goog/x',
  ]
  for (const url of hostiles) {
    const out = validateRemoteTarget(url, REG)
    assert.equal(out.ok, false, `${url} 必须被拒`)
    assert.match(out.reason, /内网|回环|保留|本机主机名|云元数据/, `${url} 的理由应是地址段/主机名：${out.reason}`)
  }
})

await check('进制绕过：十进制 127.0.0.1（2130706433）也被拒——按整数 IPv4 归一化检查', () => {
  // 用 https 写，确保走的是地址段判定而不是协议判定（协议那条另有测试）。
  const out = validateRemoteTarget('https://2130706433/x', REG)
  assert.equal(out.ok, false, `应被拒，实际放行：${JSON.stringify(out)}`)
  assert.match(out.reason, /内网|回环|保留/)
})

await check('异源降级成 http 明文 ⇒ 拒（同源才允许操作员自己配的 http）', () => {
  const out = validateRemoteTarget('http://mirror-somewhere.example/x.tgz', REG)
  assert.equal(out.ok, false)
  assert.match(out.reason, /https/)
})

console.log('\n[2] 端到端：readCatalogFromNpm 用假 fetch，验证「危险目标没被实际请求」')

function redirectStub(routes) {
  const requested = []
  const cancelled = []
  const fake = async (url) => {
    requested.push(String(url))
    const hop = routes[String(url)]
    if (hop === undefined) return { ok: false, status: 404, headers: { get: () => null } }
    if (hop.redirect !== undefined) {
      // 被跳过的那一跳也要能被观测到「正文有没有被吸掉」——`redirect:'manual'` 下
      // 不消费 body 会让底层连接一直挂着（这是我引入手动重定向才有的面）。
      cancelled.push(String(url))
      return {
        ok: false, status: 302,
        headers: { get: (k) => (String(k).toLowerCase() === 'location' ? hop.redirect : null) },
        body: { cancel: async () => { hop.cancelled = true } }
      }
    }
    const bytes = Buffer.isBuffer(hop.bytes) ? hop.bytes : Buffer.from(hop.body ?? '')
    return {
      ok: true, status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? String(bytes.length) : null) },
      arrayBuffer: async () => bytes,
      text: async () => bytes.toString('utf8')
    }
  }
  fake.requested = requested
  fake.routes = routes
  return fake
}

function sri(bytes) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

/** 最小合法 tar：单条目 package/plugins.json。 */
function tarWith(jsonText) {
  const name = 'package/plugins.json'
  const content = Buffer.from(jsonText, 'utf8')
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644', 100, 'utf8')
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'utf8')
  header.write('ustar', 257, 'utf8')
  let sum = 0
  for (let i = 0; i < 512; i += 1) sum += header[i]
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8')
  const pad = (512 - (content.length % 512)) % 512
  return Buffer.concat([header, content, Buffer.alloc(pad), Buffer.alloc(1024)])
}

function metadataFor(tarball, bytes, extra = {}) {
  return JSON.stringify({
    name: 'dsh-plugin-catalog', version: '1.9.0',
    dist: { tarball, integrity: sri(bytes), ...extra }
  })
}

const GOOD_JSON = JSON.stringify({ count: 1, plugins: [{ name: 'p', owner: 'o', description: 'd', stars: 1, url: 'https://github.com/o/p' }] })
const GOOD_TGZ = gzipSync(tarWith(GOOD_JSON))
const META_URL = `${REG}/dsh-plugin-catalog/latest`

await check('合法同源镜像全流程 ⇒ 成功，且只请求了元数据与 tarball 两跳', async () => {
  const tarball = `${REG}/dsh-plugin-catalog/-/dsh-plugin-catalog-1.9.0.tgz`
  const fake = redirectStub({
    [META_URL]: { body: metadataFor(tarball, GOOD_TGZ) },
    [tarball]: { bytes: GOOD_TGZ }
  })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, true, out.reason)
  assert.equal(out.raw.count, 1)
  assert.deepEqual(fake.requested, [META_URL, tarball])
})

await check('元数据把 tarball 指到内网地址 ⇒ 拒绝，且**内网目标从未被请求**', async () => {
  const evil = 'http://127.0.0.1:6379/x.tgz'
  const fake = redirectStub({ [META_URL]: { body: metadataFor(evil, GOOD_TGZ) } })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, false)
  assert.match(out.kind, /unsafe-url/)
  assert.ok(!fake.requested.includes(evil), `内网目标被实际请求了！requested=${fake.requested}`)
})

await check('重定向第一跳逃到内网 ⇒ 拒，危险目标不被请求', async () => {
  const tarball = `${REG}/pkg/-/a.tgz`
  const internal = 'http://169.254.169.254/latest/meta-data/iam/'
  const fake = redirectStub({
    [META_URL]: { body: metadataFor(tarball, GOOD_TGZ) },
    [tarball]: { redirect: internal }
  })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, false)
  assert.match(out.kind, /unsafe-url/)
  assert.ok(!fake.requested.some((u) => u.includes('169.254')), `元数据服务被实际请求了！${fake.requested}`)
})

await check('合法的两跳重定向（302 → 公共 CDN）⇒ 成功，并记录经过的跳', async () => {
  const tarball = `${REG}/pkg/-/a.tgz`
  const cdn = 'https://cdn.example.com/pkg/a.tgz'
  const fake = redirectStub({
    [META_URL]: { body: metadataFor(tarball, GOOD_TGZ) },
    [tarball]: { redirect: cdn },
    [cdn]: { bytes: GOOD_TGZ }
  })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, true, out.reason)
  assert.deepEqual(fake.requested, [META_URL, tarball, cdn])
  // 被跳过的那一跳的正文必须被吸掉：`redirect:'manual'` 下留着不消费 = 连接泄漏。
  assert.equal(fake.routes[tarball].cancelled, true, '302 那一跳的 body 没有被 cancel——连接会挂住')
})

await check('重定向环/超长链 ⇒ 有界失败，不无限跟随', async () => {
  const tarball = `${REG}/pkg/-/a.tgz`
  const hops = {}
  hops[tarball] = { redirect: `${REG}/hop/1` }
  for (let i = 1; i <= 12; i += 1) hops[`${REG}/hop/${i}`] = { redirect: `${REG}/hop/${i + 1}` }
  const fake = redirectStub({
    [META_URL]: { body: metadataFor(tarball, GOOD_TGZ) },
    ...hops
  })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, false)
  assert.match(out.kind, /redirect/)
  // 请求次数有界：1 元数据 + 1 起始 + MAX_NPM_REDIRECTS 跳。
  assert.ok(fake.requested.length <= 2 + MAX_NPM_REDIRECTS, `跟随了 ${fake.requested.length} 次，超出上界`)
})

await check('经合法重定向投毒的 tarball：字节与 dist.integrity 不符 ⇒ 仍被拒、数据不被使用', async () => {
  const tarball = `${REG}/pkg/-/a.tgz`
  const cdn = 'https://cdn.example.com/pkg/a.tgz'
  const evilTgz = gzipSync(tarWith(JSON.stringify({ count: 1, plugins: [{ name: 'evil', owner: 'x', description: 'd', stars: 1, url: 'https://github.com/x/evil' }] })))
  const fake = redirectStub({
    // 元数据的 integrity 是**好包**的哈希；CDN 给的是坏包。
    [META_URL]: { body: metadataFor(tarball, GOOD_TGZ) },
    [tarball]: { redirect: cdn },
    [cdn]: { bytes: evilTgz }
  })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, false)
  assert.match(out.kind, /integrity/)
})

await check('畸形元数据（不是 JSON）⇒ bad kind，绝不抛穿到调用方', async () => {
  const fake = redirectStub({ [META_URL]: { body: '<html>oops</html>' } })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, false)
  assert.equal(typeof out.reason, 'string')
})

await check('元数据缺 dist.tarball / 缺 version ⇒ 拒绝', async () => {
  for (const meta of [
    JSON.stringify({ version: '1.0.0' }),
    JSON.stringify({ dist: { tarball: `${REG}/a.tgz`, integrity: sri(GOOD_TGZ) } })
  ]) {
    const fake = redirectStub({ [META_URL]: { body: meta } })
    const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
    assert.equal(out.ok, false)
  }
})

await check('操作员本地镜像（http://127.0.0.1:4873）：同源 tarball 全流程可用', async () => {
  const local = 'http://127.0.0.1:4873'
  const metaUrl = `${local}/dsh-plugin-catalog/latest`
  const tarball = `${local}/dsh-plugin-catalog/-/dsh-plugin-catalog-1.9.0.tgz`
  const fake = redirectStub({
    [metaUrl]: { body: metadataFor(tarball, GOOD_TGZ) },
    [tarball]: { bytes: GOOD_TGZ }
  })
  const out = await readCatalogFromNpm({ registry: local, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, true, `本地镜像不该被误伤：${out.reason}`)
})

await check('重定向 Location 是相对路径 ⇒ 基于当前跳解析后照常校验', async () => {
  const tarball = `${REG}/pkg/-/a.tgz`
  // 相对 Location 先落到 /pkg/b.tgz（仍同源），再从那里 302 到内网 ⇒ 第二跳必须被拦。
  const internal = 'http://10.0.0.9/b.tgz'
  const fake = redirectStub({
    [META_URL]: { body: metadataFor(tarball, GOOD_TGZ) },
    [tarball]: { redirect: '/pkg/b.tgz' },
    [`${REG}/pkg/b.tgz`]: { redirect: internal }
  })
  const out = await readCatalogFromNpm({ registry: REG, pkg: 'dsh-plugin-catalog' }, { fetch: fake })
  assert.equal(out.ok, false)
  assert.match(out.kind, /unsafe-url/)
  assert.ok(!fake.requested.includes(internal), `内网目标被实际请求：${fake.requested}`)
})

const total = passed + failures.length
console.log(`\nnpm URL/重定向回归：${failures.length ? `${passed}/${total} 通过，失败：${failures.join('；')}` : `${total}/${total} 全通过`}`)
if (failures.length > 0) process.exit(1)
