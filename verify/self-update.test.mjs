/**
 * 市场自更新通道的回归测试（离线、确定性）。
 *
 * 为什么必须覆盖这几条：这条链路上任何一处放宽都会变成「装了一个没验过的东西」——
 * 版本比较错会让「已是最新」骗人，路径/哈希/产物自证三道校验少一道就等于没有校验。
 * 另外 apply() 必须证明自己**在拒绝时根本没有调用 pluginManager**，否则「拒绝」只是文案。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import {
  compareVersions,
  createSelfUpdater,
  isNewer,
  isReleaseTarballPath,
  isSha256Hex,
  pickLatestVersion,
  readArtifactManifest,
  readIndex,
  verifySha256Hex,
} from '../plugin-market/lib/self-update.js'

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}
async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

// ── 造一个真实的 USTAR tarball（不引 tar 库：读端解析的就是这个格式）──
function tarEntry(name, content) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  Buffer.from(content).copy(padded)
  return Buffer.concat([header, padded])
}

function makeTarball(name, version, extraFiles = []) {
  const parts = [tarEntry('package/package.json', JSON.stringify({ name, version, dsh: { bundle: {} } }))]
  for (const [file, body] of extraFiles) parts.push(tarEntry(file, body))
  parts.push(Buffer.alloc(1024)) // 两个空块结尾
  return gzipSync(Buffer.concat(parts))
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// ── 1. 版本比较 ─────────────────────────────────────────────────────
console.log('\n[1] 版本比较（严格 MAJOR.MINOR.PATCH）')
check('1.2.0 < 1.10.0（按数字比，不是字典序）', () => {
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1)
})
check('v 前缀与去前缀等价', () => {
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0)
})
check('2.0.0 > 1.99.99', () => {
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
})
check('不可解析的版本一律返回 null：不猜预发布号', () => {
  for (const bad of ['1.2', '1.2.3.4', '1.2.3-rc.1', '', 'x.y.z', null, undefined, 123]) {
    assert.equal(compareVersions(bad, '1.0.0'), null, `应当拒绝 ${String(bad)}`)
  }
})
check('isNewer 只在严格更高时为真', () => {
  assert.equal(isNewer('1.0.1', '1.0.0'), true)
  assert.equal(isNewer('1.0.0', '1.0.0'), false)
  assert.equal(isNewer('0.9.9', '1.0.0'), false)
})
check('isNewer 对不可比较的版本返回 null，不折叠成「没有更新」', () => {
  // 错过的样子：`compareVersions(...) === 1` 把 null 压成 false，于是本机是合法 npm 预发布号
  // （`1.1.5-rc.1`）时，check() 报 updateAvailable:false、apply() 回
  // `{ok:true, application:'up-to-date'}` —— 把「无法比较」谎称成「已是最新」。
  assert.equal(isNewer('1.1.6', '1.1.5-rc.1'), null)
  assert.equal(isNewer('1.1.6', '1.1.5+build.7'), null)
  assert.equal(isNewer('1.1.6', 'garbage'), null)
})
checkAsync('本机版本不可解析时 check 如实报通道不可用（不是「已是最新」）', async () => {
  const updater = createSelfUpdater({ current: '1.1.5-rc.1', fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }) })
  const result = await updater.check()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-unavailable')
})
check('pickLatestVersion 取最大且忽略垃圾项', () => {
  assert.equal(pickLatestVersion(['1.0.10', 'v1.0.2', 'bogus', '1.1.0', '1.0.9']), '1.1.0')
  assert.equal(pickLatestVersion(['bogus', '']), null)
})

// ── 2. 清单校验 ─────────────────────────────────────────────────────
console.log('\n[2] index.json 的路径与哈希校验')
check('tarball 路径必须落在 releases/*.tgz', () => {
  assert.equal(isReleaseTarballPath('releases/deepseek-harness-market-1.1.0.tgz'), true)
  for (const bad of ['../evil.tgz', 'releases/../../evil.tgz', '/abs/evil.tgz', 'releases/x.tar', 'https://cdn/x.tgz', null]) {
    assert.equal(isReleaseTarballPath(bad), false, `应当拒绝 ${String(bad)}`)
  }
})
check('sha256 必须是 64 位十六进制', () => {
  assert.equal(isSha256Hex('a'.repeat(64)), true)
  assert.equal(isSha256Hex('A'.repeat(64)), false)
  assert.equal(isSha256Hex('a'.repeat(63)), false)
})
check('verifySha256Hex 认可正确哈希、拒绝被改过的字节', () => {
  const bytes = Buffer.from('hello')
  assert.equal(verifySha256Hex(bytes, sha256(bytes)).ok, true)
  assert.equal(verifySha256Hex(Buffer.from('hellp'), sha256(bytes)).ok, false)
  assert.equal(verifySha256Hex(bytes, 'not-a-hash').ok, false)
})
check('readIndex 丢掉结构不对的条目，并在缺 latest 时自己推', () => {
  const index = readIndex({
    versions: [
      { version: '1.0.0', tag: 'v1.0.0', tarball: 'releases/a-1.0.0.tgz', sha256: 'b'.repeat(64), versionCode: 10000 },
      { version: 'nope', tarball: 'releases/b.tgz' },
      { version: '1.1.0', tag: 'v1.1.0', tarball: '../evil.tgz', sha256: 'c'.repeat(64) },
    ],
  })
  assert.equal(index.versions.length, 2, '只有两个版本结构合法')
  assert.equal(index.latest.version, '1.1.0', 'latest 缺失时按最高版本推')
  const suspicious = index.versions.find((entry) => entry.version === '1.1.0')
  assert.equal(suspicious.tarball, null, '路径不合法的 tarball 必须被置空，而不是原样采信')
})
check('readIndex 对不认识的结构返回 null', () => {
  assert.equal(readIndex(null), null)
  assert.equal(readIndex({}), null)
  assert.equal(readIndex({ versions: [], latest: 42 }), null)
})

// ── 3. 产物自证 ─────────────────────────────────────────────────────
console.log('\n[3] 产物自证（解 tarball 读 package/package.json）')
check('能读出包名与版本', () => {
  const verdict = readArtifactManifest(makeTarball('deepseek-harness-market', '1.1.0'))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.name, 'deepseek-harness-market')
  assert.equal(verdict.version, '1.1.0')
})
check('没有 package/package.json 的 tarball 被拒绝', () => {
  const bytes = gzipSync(Buffer.concat([tarEntry('package/other.json', '{}'), Buffer.alloc(1024)]))
  assert.equal(readArtifactManifest(bytes).ok, false)
})
check('不是 tarball 的字节被拒绝（不抛异常）', () => {
  assert.equal(readArtifactManifest(Buffer.from('not a tarball')).ok, false)
})

// ── 4. check() 的源选择与缓存 ────────────────────────────────────────
console.log('\n[4] check()：源顺序、版本判定、10 分钟缓存')

const REPO_INDEX = (version, tarballVersion = version) => ({
  channel: 'jsdelivr',
  latest: { version, tag: `v${version}`, versionCode: 10100, tarball: `releases/deepseek-harness-market-${tarballVersion}.tgz`, sha256: 'd'.repeat(64), bytes: 1234, build: '+1.abc1234', releasedAt: '2026-10-04T00:00:00Z' },
  versions: [],
})

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    for (const [pattern, responder] of routes) {
      if (String(url).includes(pattern)) {
        const out = typeof responder === 'function' ? responder(url) : responder
        // 返回 null/undefined 表示「这条不匹配」，继续看后面的规则。
        if (out !== null && out !== undefined) return out
      }
    }
    return { ok: false, status: 404, text: async () => 'not found' }
  }
  impl.calls = calls
  return impl
}

await checkAsync('标签列表 → 该标签的 index.json → 判定有更新', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.0.0' }, { version: '1.1.0' }, { version: '1.0.9' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.2', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.latest, '1.1.0')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.installable, true)
  assert.equal(result.channel, 'jsdelivr-tags')
  assert.equal(result.url, 'https://cdn.jsdelivr.net/gh/Winnie-0721/dsh-plugin-market@v1.1.0/releases/deepseek-harness-market-1.1.0.tgz')
  assert.equal(result.sha256, 'd'.repeat(64))
})

await checkAsync('当前版本等于最新：updateAvailable=false（不提示更新）', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.1.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.updateAvailable, false)
  assert.equal(result.installable, false)
})

await checkAsync('第一个源不可用时继续问下一个，且如实记下每个源的原因', async () => {
  const fetchImpl = fakeFetch([
    ['api.github.com', { ok: false, status: 403, text: async () => '{"message":"API rate limit exceeded"}' }],
    ['data.jsdelivr.com', { ok: false, status: 503, text: async () => '' }],
    ['@main/releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'jsdelivr-index')
  assert.ok(result.attempts.some((attempt) => /403/.test(attempt.reason)), 'GitHub 限流要留记录')
  assert.ok(result.attempts.some((attempt) => /503/.test(attempt.reason)), '镜像 503 也要留记录')
})

await checkAsync('源报了一个更高版本却拿不到它的清单时，不得用更旧的候选盖成「已是最新」', async () => {
  // 真实场景（v1.1.6 起）：GitHub Release 附件缺 digest → 回落到该标签的 releases/index.json，
  // 而这份清单自 v1.1.6 起已从仓库下线 → 404；同时 jsDelivr 只索引到旧版本。
  // 修复前：best = 旧的 1.1.5，updateAvailable = false → 界面显示「插件市场已是最新（v1.1.5）」。
  const fetchImpl = fakeFetch([
    ['api.github.com', jsonResponse({ tag_name: 'v1.1.6', assets: [{ name: 'deepseek-harness-market-1.1.6.tgz' }] })],
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.5' }] })],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.1.5', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, false, '不得报成功')
  assert.equal(result.code, 'self-update-unavailable')
  assert.match(result.message, /1\.1\.6/, '要说清是哪个版本验不了')
  assert.notEqual(result.updateAvailable, false, 'updateAvailable 不得是 false（那是「已是最新」的谎）')
})

await checkAsync('正常的「有更新」路径不受影响（1.1.5 → 1.1.6）', async () => {
  const fetchImpl = fakeFetch([
    ['api.github.com', jsonResponse({ tag_name: 'v1.1.6', assets: [{ name: 'deepseek-harness-market-1.1.6.tgz' }] })],
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.5' }, { version: '1.1.6' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.6'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.1.5', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.updateAvailable, true, '必须有更新（这条与上一条共同保证「不谎称已是最新」的修复没有误伤正常路径）')
  assert.equal(result.latest, '1.1.6')
})

await checkAsync('第一个源就给出更高版本时早退出，不再问其余源', async () => {  const fetchImpl = fakeFetch([
    ['api.github.com', jsonResponse({ tag_name: 'v1.1.0' })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '9.9.9' }] })],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.latest, '1.1.0')
  assert.equal(result.channel, 'github-release')
  assert.equal(fetchImpl.calls.some((url) => url.includes('data.jsdelivr.com')), false, '已有明确答案就不该再问 jsDelivr')
})

await checkAsync('GitHub 附件带 digest：不查仓库里的 releases/index.json 也能给出可安装条目', async () => {
  const digestHex = 'a'.repeat(64)
  const fetchImpl = fakeFetch([
    ['api.github.com', jsonResponse({
      tag_name: 'v1.1.0',
      published_at: '2026-10-05T17:33:36Z',
      assets: [
        { name: 'deepseek-harness-market-1.1.0.tgz', size: 465679, digest: `sha256:${digestHex}` },
        { name: 'version.json', size: 219, digest: `sha256:${'b'.repeat(64)}` },
      ],
    })],
    // 故意不给 releases/index.json：releases/ 目录已从仓库移除，GitHub 源必须自给自足。
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'github-release')
  assert.equal(result.latest, '1.1.0')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.installable, true)
  assert.equal(result.sha256, digestHex, 'sha256 来自附件 digest')
  assert.equal(result.bytes, 465679, '字节数来自附件 size')
  assert.equal(result.versionCode, 10100, 'versionCode 由版本号按公式算出')
  assert.equal(result.releasedAt, '2026-10-05T17:33:36Z')
  assert.equal(result.url, 'https://cdn.jsdelivr.net/gh/Winnie-0721/dsh-plugin-market@v1.1.0/releases/deepseek-harness-market-1.1.0.tgz')
  assert.equal(fetchImpl.calls.some((url) => url.includes('releases/index.json')), false, '不该再去仓库里找清单')
})

await checkAsync('GitHub 附件缺 digest 时退回老路：仍按标签里的 index.json 取条目', async () => {
  const fetchImpl = fakeFetch([
    ['api.github.com', jsonResponse({ tag_name: 'v1.1.0', assets: [{ name: 'deepseek-harness-market-1.1.0.tgz', size: 123 }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'github-release')
  assert.equal(result.sha256, 'd'.repeat(64), '退回清单里的哈希')
})

await checkAsync('三个源都挂了：如实报不可用，并带三条源记录（外加有界的标签探测）', async () => {
  const fetchImpl = fakeFetch([])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-unavailable')
  const sourceAttempts = result.attempts.filter((attempt) => attempt.id !== 'tag-probe')
  assert.equal(sourceAttempts.length, 3, '三个列表源各留一条记录')
  assert.ok(sourceAttempts.every((attempt) => attempt.ok === false))
  // 列表全挂时仍会探一次标签（任意标签是按需取的，可能只有它通），但必须有界。
  assert.equal(result.attempts.filter((attempt) => attempt.id === 'tag-probe').length, 3)
})

await checkAsync('10 分钟内复用缓存，不再打网络', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  await updater.check({ force: true })
  const afterFirst = fetchImpl.calls.length
  await updater.check({})
  assert.equal(fetchImpl.calls.length, afterFirst, '第二次应命中缓存')
  await updater.check({ force: true })
  assert.ok(fetchImpl.calls.length > afterFirst, 'force 必须绕过缓存')
})

await checkAsync('标签列表慢了一拍（刚发版）时改用 @main 的清单：不能因为第一个源半残就放弃', async () => {
  // 实测场景：刚推完 v1.1.0，jsDelivr 的标签列表还只有 1.0.2，而 @v1.0.2/releases/index.json
  // 是 404（那个版本还没有 releases/ 目录）；此时 @main 上的清单已经是 1.1.0。
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.0.0' }, { version: '1.0.2' }] })],
    ['@v1.0.2/releases/index.json', { ok: false, status: 404, text: async () => 'not found' }],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.2', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true, '第一个源半残不该让整次检查失败')
  assert.equal(result.latest, '1.1.0')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.channel, 'jsdelivr-index')
  assert.ok(result.attempts.some((attempt) => attempt.ok === false && /404/.test(attempt.reason)), '半残的源要留下失败记录')
})

await checkAsync('多个源都给出条目时取最高的那一个（缓存新鲜度不一致，取高才不会漏更新）', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['@v1.1.0/releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
    ['@main/releases/index.json', jsonResponse(REPO_INDEX('1.2.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.1.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.latest, '1.2.0', '没有「明确更高」时要把其余源也问完，取最高的')
  assert.equal(result.updateAvailable, true)
})

await checkAsync('GitHub 限流时结论不受影响（它只是一个源，不是前提）', async () => {
  const fetchImpl = fakeFetch([
    ['api.github.com', { ok: false, status: 403, text: async () => '{"message":"API rate limit exceeded"}' }],
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['@v1.1.0/releases/index.json', jsonResponse(REPO_INDEX('1.1.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.latest, '1.1.0')
  assert.equal(result.channel, 'jsdelivr-tags')
})

// ── 5. apply()：拒绝路径绝不安装 ─────────────────────────────────────
console.log('\n[5] apply()：拒绝路径绝不调用 pluginManager')

const TARBALL = makeTarball('deepseek-harness-market', '1.1.0')
const TARBALL_SHA = sha256(TARBALL)

function applyFetch(tarball = TARBALL, indexVersion = '1.1.0', sha = TARBALL_SHA) {
  return fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: indexVersion }] })],
    ['releases/index.json', jsonResponse({
      latest: {
        version: indexVersion, tag: `v${indexVersion}`, versionCode: 10100,
        tarball: `releases/deepseek-harness-market-${indexVersion}.tgz`, sha256: sha, bytes: tarball.length,
      },
      versions: [],
    })],
    ['.tgz', { ok: true, status: 200, arrayBuffer: async () => tarball }],
  ])
}

function fakeManager() {
  const calls = []
  return { calls, installBundle: async (spec, options) => { calls.push({ spec, options }); return { application: 'restart-required', changed: true } } }
}

// 宿主返回指定 ChangeResult 的假 manager（用来验 ok 的推导规则，而不是只看正常路径）。
function managerReturning(changeResult) {
  const calls = []
  return { calls, installBundle: async (spec, options) => { calls.push({ spec, options }); return changeResult } }
}

await checkAsync('已是最新时不做任何下载、不调用安装', async () => {
  const fetchImpl = applyFetch()
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.1.0', manager, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, true)
  assert.equal(result.application, 'up-to-date')
  assert.equal(manager.calls.length, 0)
  assert.equal(fetchImpl.calls.filter((url) => url.endsWith('.tgz')).length, 0, '不该下载 tarball')
})

await checkAsync('sha256 不符：拒绝安装（这是防篡改的那一道）', async () => {
  const fetchImpl = applyFetch(TARBALL, '1.1.0', 'e'.repeat(64))
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-integrity')
  assert.equal(manager.calls.length, 0, '校验不过绝不能调用 pluginManager')
})

await checkAsync('哈希自洽但产物根本不是本插件：按自证拒绝', async () => {
  const evil = makeTarball('some-other-plugin', '1.1.0')
  const fetchImpl = applyFetch(evil, '1.1.0', sha256(evil))
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-integrity')
  assert.match(result.message, /some-other-plugin/)
  assert.equal(manager.calls.length, 0)
})

await checkAsync('字节数与清单不符：拒绝', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse({
      latest: { version: '1.1.0', tag: 'v1.1.0', tarball: 'releases/deepseek-harness-market-1.1.0.tgz', sha256: TARBALL_SHA, bytes: TARBALL.length + 1 },
      versions: [],
    })],
    ['.tgz', { ok: true, status: 200, arrayBuffer: async () => TARBALL }],
  ])
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-integrity')
  assert.equal(manager.calls.length, 0)
})

await checkAsync('index.json 里的 tarball 路径不合法：拒绝，且不下载', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
    ['releases/index.json', jsonResponse({
      latest: { version: '1.1.0', tag: 'v1.1.0', tarball: 'https://evil.example/x.tgz', sha256: TARBALL_SHA },
      versions: [],
    })],
  ])
  const manager = fakeManager()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'self-update-unavailable')
  assert.equal(manager.calls.length, 0)
})

await checkAsync('没有 pluginManager：不更新，但不谎报成功', async () => {
  const fetchImpl = applyFetch()
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager: null, cacheMs: 0, logger: { warn() {} } })
  const result = await updater.apply()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'manager-unavailable')
})

await checkAsync('正常路径：下载 → 落盘 → 用本地绝对路径安装，并要求重启', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-'))
  try {
    const fetchImpl = applyFetch()
    const manager = fakeManager()
    const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, downloadDir: dir, cacheMs: 0, logger: { warn() {} } })
    const result = await updater.apply()
    assert.equal(result.ok, true)
    // application 由宿主决定：这里如实透传（fake 返回 restart-required，真实宿主通常也是它）。
    assert.equal(result.application, 'restart-required')
    assert.equal(result.from, '1.0.0')
    assert.equal(result.to, '1.1.0')
    assert.equal(result.requiresRestart, true, '宿主半在进程里被缓存，必须要求重启')
    assert.equal(manager.calls.length, 1)
    const spec = manager.calls[0].spec
    assert.ok(spec.endsWith('deepseek-harness-market-1.1.0.tgz'), `安装 spec 应是落盘后的 tarball：${spec}`)
    // 安装用的是绝对路径：pnpm 不认相对路径（install-spec.ts 会直接拒绝）。
    assert.ok(/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/'), `必须是绝对路径：${spec}`)
    assert.deepEqual(readFileSync(spec), TARBALL, '落盘的字节必须与下载到的一致')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('宿主报 application:"failed" 时 ok 必须是 false（失败不许渲染成绿色「更新成功」）', async () => {
  // 契约（docs/API-CONTRACT.md）要求 `application:'failed'` ⇒ `ok:false`。旧实现是
  // `ok = (value.error == null)`——但宿主的 ChangeResult 里 error 是**可选**的，
  // `{application:'failed'}` 不带 error 时它算出 ok:true，HTTP 200 回给客户端，
  // 客户端 markSelfDone() + 绿色「更新到 vX」：**一次失败的自更新被渲染成成功**。
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-failed-'))
  try {
    const updater = createSelfUpdater({
      fetchImpl: applyFetch(),
      current: '1.0.0',
      manager: managerReturning({ application: 'failed' }),
      downloadDir: dir,
      cacheMs: 0,
      logger: { warn() {} }
    })
    const result = await updater.apply()
    assert.equal(result.application, 'failed')
    assert.equal(result.ok, false, 'application:failed ⇒ ok:false（即使没带 error）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('宿主报 application:"cancelled" 时 ok 仍为 true（用户自己取消要走「已取消」文案）', async () => {
  // `cancelled` 单独放行：客户端要靠 application 渲染「已取消」文案，ok:false 会让
  // requestJSON 直接抛错，那条文案就永远不可达。这条与 index.js 的 sendChangeResult 一致。
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-cancelled-'))
  try {
    const updater = createSelfUpdater({
      fetchImpl: applyFetch(),
      current: '1.0.0',
      manager: managerReturning({ application: 'cancelled' }),
      downloadDir: dir,
      cacheMs: 0,
      logger: { warn() {} }
    })
    const result = await updater.apply()
    assert.equal(result.application, 'cancelled')
    assert.equal(result.ok, true, 'cancelled 必须放行，否则「已取消」文案不可达')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('宿主报 error 但 application 缺失时 ok 为 false（且 application 回落 failed）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-err-'))
  try {
    const updater = createSelfUpdater({
      fetchImpl: applyFetch(),
      current: '1.0.0',
      manager: managerReturning({ error: { code: 'eperm', message: '拒绝访问' } }),
      downloadDir: dir,
      cacheMs: 0,
      logger: { warn() {} }
    })
    const result = await updater.apply()
    assert.equal(result.application, 'failed', '带了 error 而没说 application → 按 failed 处理')
    assert.equal(result.ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('标签地址 404 时改用 @main 的同一路径下载（内容由 sha256 负责）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-fallback-'))
  try {
    const fetchImpl = fakeFetch([
      ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
      ['releases/index.json', jsonResponse({
        latest: { version: '1.1.0', tag: 'v1.1.0', tarball: 'releases/deepseek-harness-market-1.1.0.tgz', sha256: TARBALL_SHA, bytes: TARBALL.length },
        versions: [],
      })],
      // 标签还没被 CDN 索引（实测会 404 一阵），main 分支上有同一份文件
      ['@v1.1.0/releases/deepseek-harness-market-1.1.0.tgz', { ok: false, status: 404, text: async () => 'not found' }],
      ['@main/releases/deepseek-harness-market-1.1.0.tgz', { ok: true, status: 200, arrayBuffer: async () => TARBALL }],
    ])
    const manager = fakeManager()
    const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, downloadDir: dir, cacheMs: 0, logger: { warn() {} } })
    const result = await updater.apply()
    assert.equal(result.ok, true, '标签 404 不该让更新失败')
    assert.equal(result.to, '1.1.0')
    assert.equal(manager.calls.length, 1)
    assert.ok(fetchImpl.calls.some((url) => url.includes('@main/releases/deepseek-harness-market-1.1.0.tgz')), '应当真的去试了 main 分支')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('拿到了字节但哈希不符 = 硬失败，绝不换另一个来源重试', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-hardfail-'))
  try {
    const tampered = Buffer.from(TARBALL)
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff
    const fetchImpl = fakeFetch([
      ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.1.0' }] })],
      ['releases/index.json', jsonResponse({
        latest: { version: '1.1.0', tag: 'v1.1.0', tarball: 'releases/deepseek-harness-market-1.1.0.tgz', sha256: TARBALL_SHA, bytes: TARBALL.length },
        versions: [],
      })],
      ['@v1.1.0/releases/deepseek-harness-market-1.1.0.tgz', { ok: true, status: 200, arrayBuffer: async () => tampered }],
      ['@main/releases/deepseek-harness-market-1.1.0.tgz', { ok: true, status: 200, arrayBuffer: async () => TARBALL }],
    ])
    const manager = fakeManager()
    const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, downloadDir: dir, cacheMs: 0, logger: { warn() {} } })
    const result = await updater.apply()
    assert.equal(result.ok, false)
    assert.equal(result.code, 'self-update-integrity')
    assert.equal(manager.calls.length, 0, '字节都拿到了还哈希不符，是篡改信号，不能换个来源就放过')
    assert.equal(fetchImpl.calls.some((url) => url.includes('@main/releases/deepseek-harness-market-1.1.0.tgz')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('列表源全都滞后时按常规递进探测标签（这才能追上刚发布的版本）', async () => {
  // 实测：Data API 的版本列表一小时后仍只有旧版本，@main 的清单被 CDN 缓存 12 小时，
  // 而任意标签是按需取的 —— 所以「列表都说没有更新」时还要探一次下一个补丁标签。
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.0.0' }] })],
    ['@v1.0.0/releases/index.json', jsonResponse(REPO_INDEX('1.0.0'))],
    ['@main/releases/index.json', jsonResponse(REPO_INDEX('1.0.0'))],
    ['@v1.0.1/releases/index.json', jsonResponse(REPO_INDEX('1.0.1'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.latest, '1.0.1', '列表滞后时也要能发现刚发布的补丁版本')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.channel, 'tag-probe')
  assert.ok(fetchImpl.calls.some((url) => url.includes('@v1.0.1/releases/index.json')))
})

await checkAsync('标签探测是有界的：三个候选都没命中就如实说没有更新', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.0.0' }] })],
    ['@v1.0.0/releases/index.json', jsonResponse(REPO_INDEX('1.0.0'))],
    ['@main/releases/index.json', jsonResponse(REPO_INDEX('1.0.0'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.ok, true)
  assert.equal(result.updateAvailable, false)
  const probes = fetchImpl.calls.filter((url) => /@v1\.0\.1|@v1\.1\.0|@v2\.0\.0/.test(url))
  assert.equal(probes.length, 3, `应当恰好探三个候选，实际 ${probes.length}：${probes.join(' ')}`)
})

await checkAsync('已经有一个明确更高的答案时不探测（早退出优先）', async () => {
  const fetchImpl = fakeFetch([
    ['data.jsdelivr.com', jsonResponse({ versions: [{ version: '1.5.0' }] })],
    ['releases/index.json', jsonResponse(REPO_INDEX('1.5.0'))],
    ['@v1.0.1/releases/index.json', jsonResponse(REPO_INDEX('1.0.1'))],
  ])
  const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', logger: { warn() {} } })
  const result = await updater.check({ force: true })
  assert.equal(result.latest, '1.5.0')
  assert.equal(fetchImpl.calls.some((url) => url.includes('@v1.0.1/')), false, '已知更高版本时不该再去探标签')
})

await checkAsync('两条 CDN 路都不通时用 GitHub Release 附件（第三条路）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshpm-selfupdate-asset-'))
  try {
    const fetchImpl = fakeFetch([
      ['api.github.com', jsonResponse({ tag_name: 'v1.1.0' })],
      ['releases/index.json', jsonResponse({
        latest: { version: '1.1.0', tag: 'v1.1.0', tarball: 'releases/deepseek-harness-market-1.1.0.tgz', sha256: TARBALL_SHA, bytes: TARBALL.length },
        versions: [],
      })],
      ['cdn.jsdelivr.net', { ok: false, status: 404, text: async () => 'not found' }],
      ['github.com/Winnie-0721/dsh-plugin-market/releases/download', { ok: true, status: 200, arrayBuffer: async () => TARBALL }],
    ])
    const manager = fakeManager()
    const updater = createSelfUpdater({ fetchImpl, current: '1.0.0', manager, downloadDir: dir, cacheMs: 0, logger: { warn() {} } })
    const result = await updater.apply()
    assert.equal(result.ok, true, 'Release 附件这条路要能顶上')
    assert.equal(result.to, '1.1.0')
    assert.equal(manager.calls.length, 1)
    assert.ok(fetchImpl.calls.some((url) => url.includes('releases/download/v1.1.0/deepseek-harness-market-1.1.0.tgz')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await checkAsync('没有 fetch 的运行环境：如实报不可用', async () => {
  // 必须真的把全局 fetch 摘掉再测：createSelfUpdater 在没注入 fetchImpl 时会退回 globalThis.fetch，
  // 而 Node 自带 fetch —— 不摘的话这条断言会真的去打网络（旧版就是这样，网络一通它就"通过"了）。
  const saved = globalThis.fetch
  try {
    delete globalThis.fetch
    const updater = createSelfUpdater({ current: '1.0.0', logger: { warn() {} } })
    const result = await updater.check({ force: true })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'self-update-unavailable')
  } finally {
    globalThis.fetch = saved
  }
})

// ── 汇总 ────────────────────────────────────────────────────────────
console.log('')
if (failures.length > 0) {
  console.log(`自更新通道回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  失败：${failure.name}`)
  process.exit(1)
}
console.log(`自更新通道回归：${passed}/${passed} 全通过`)
