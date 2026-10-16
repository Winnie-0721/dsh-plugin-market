/**
 * 行为回归：**该不该热挂载**的判定（host 半最该被测的一段胶水）。
 *
 * 为什么单独测：`attemptHotMount` 判错的两个方向都很坏——
 *   - 判成「该挂」而其实不该 → 给一个已经在跑的插件再插一行，**同一条前缀路由注册两遍**
 *     （宿主对重复注册直接 throw）；
 *   - 判成「不该挂」而其实该 → 用户在能免重启的场景下被要求重启。
 *
 * 这里只测判定，不测挂载本身（那在 hot-mount.test.mjs 与真机实验里）。
 * `mount` / `profileDir` / `isMounted` 都是注入的缝，所以能**观测到底调没调**，
 * 而不是只能对着返回值猜。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { attemptHotMount, mergeHotIntoActivation, resolveInstalledName } = await import('../plugin-market/lib/index.js')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

/** 造 profile 并在其中建出 `node_modules/<name>` 目录。 */
function makeProfile(names = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-attempt-'))
  for (const name of names) {
    const target = join(dir, 'node_modules', ...name.split('/'))
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name }))
  }
  return dir
}

/** bundle 快照的形状与 index.js 的 bundleSnapshot 一致：小写键 → {name,...}。 */
function snap(names) {
  const map = new Map()
  for (const name of names) map.set(name.toLowerCase(), { name, version: '1.0.0', enabled: true, failed: false })
  return map
}

/** 一个假 ctx：只要能给出 profileDir 就够了（用 deps.profileDir 直接注入，不依赖它）。 */
const CTX = {}

/** 记录 mount 被调了几次、都传了什么。 */
function spyMount(result = { ok: true, reason: null, via: 'spy' }) {
  const calls = []
  const mount = async (...args) => {
    calls.push(args)
    return result
  }
  return { mount, calls }
}

console.log('\n[1] 不该挂的四种情形：一次都不许调 mount')

await check('宿主还在等构建脚本批准（pending）⇒ 不挂', async () => {
  const profile = makeProfile(['p1'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'failed',
      pending: true,
      before: snap([]),
      after: snap(['p1']),
      candidates: ['p1']
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, false)
    assert.equal(spy.calls.length, 0, 'pending 时不该挂')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('宿主回 applied 且 activation 已是 live ⇒ 已经在跑，不挂', async () => {
  const profile = makeProfile(['p2'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'applied',
      before: snap([]),
      after: snap(['p2']),
      candidates: ['p2'],
      expectedVersion: '1.0.0'
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, false, `已在跑就不该再挂，实际 ${JSON.stringify(hot)}`)
    assert.equal(spy.calls.length, 0)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('升级（包在 before 里就有）⇒ 不挂（ESM 缓存给旧模块，挂了也是假的）', async () => {
  const profile = makeProfile(['p3'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap(['p3']),
      after: snap(['p3']),
      candidates: ['p3']
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, false, `升级不该热挂，实际 ${JSON.stringify(hot)}`)
    assert.equal(spy.calls.length, 0)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('认不出这次装的是哪个包（差集里两个新名字且都不在候选里）⇒ 不挂', async () => {
  const profile = makeProfile(['x1', 'x2'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap([]),
      after: snap(['x1', 'x2']),
      candidates: ['something-else']
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, false, `认不出就别猜，实际 ${JSON.stringify(hot)}`)
    assert.equal(spy.calls.length, 0)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('回读不到列表（after=null）⇒ 不挂（不知道 ≠ 没有包）', async () => {
  const profile = makeProfile(['p4'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: null,
      after: null,
      candidates: ['p4']
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, false, `读不到就不该挂，实际 ${JSON.stringify(hot)}`)
    assert.equal(spy.calls.length, 0)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

console.log('\n[2] 该挂的情形：挂一次，且带上正确的名字')

await check('新装上、宿主说 restart-required、目录在盘上 ⇒ 挂上一次', async () => {
  const profile = makeProfile(['p5'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap([]),
      after: snap(['p5']),
      candidates: ['p5']
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, true)
    assert.equal(hot.ok, true, JSON.stringify(hot))
    assert.equal(hot.name, 'p5')
    assert.equal(spy.calls.length, 1, '正好挂一次')
    assert.equal(spy.calls[0][2], 'p5', '第三个参数是要挂的包名')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('bundle 名 ≠ 包名：按候选找到真实目录再挂（不是拿 bundle 名硬拼路径）', async () => {
  const profile = makeProfile(['@scope/real-pkg'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap([]),
      // 宿主回读到的 bundle 名与包名不同（rows 的 name 可以是子路径/别的包）。
      after: snap(['bundle-display-name']),
      candidates: ['bundle-display-name', '@scope/real-pkg']
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, true, JSON.stringify(hot))
    assert.equal(hot.name, '@scope/real-pkg', `应落到真实存在的包目录，实际 ${hot.name}`)
    assert.equal(spy.calls[0][2], '@scope/real-pkg')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('目录不在盘上 ⇒ 说清「找不到目录」，不挂（也不报一个假的「没有 patch」）', async () => {
  const profile = makeProfile([])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap([]),
      after: snap(['ghost']),
      candidates: ['ghost']
    }, { profileDir: profile, mount: spy.mount })
    assert.equal(hot.attempted, true)
    assert.equal(hot.ok, false)
    assert.match(hot.reason, /node_modules|找不到/, `要说清是目录不在，实际 ${hot.reason}`)
    assert.equal(spy.calls.length, 0, '目录都没有就不该调 mount')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('定位不到 profile 目录 ⇒ 如实说不做，不挂', async () => {
  const spy = spyMount()
  const hot = await attemptHotMount(CTX, {
    application: 'restart-required',
    before: snap([]),
    after: snap(['p6']),
    candidates: ['p6']
  }, { profileDir: null, mount: spy.mount })
  assert.equal(hot.attempted, true)
  assert.equal(hot.ok, false)
  assert.match(hot.reason, /profile directory|profile 的目录/)
  assert.equal(spy.calls.length, 0)
})

console.log('\n[3] 重复挂载的闸门（本次会话已经挂过的包）')

await check('isMounted 说已经挂了 ⇒ 复用，不再调 mount（否则路由注册两遍）', async () => {
  const profile = makeProfile(['p7'])
  const spy = spyMount()
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap([]),
      after: snap(['p7']),
      candidates: ['p7']
    }, { profileDir: profile, mount: spy.mount, isMounted: (name) => name === 'p7' })
    assert.equal(hot.attempted, true)
    assert.equal(hot.ok, true, '已经挂着就是「在这条路上是好的」')
    assert.equal(hot.reused, true, '要标出这是复用而不是新挂')
    assert.equal(spy.calls.length, 0, '**绝不能**再挂一次')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('isMounted 说没挂 ⇒ 照常挂', async () => {
  const profile = makeProfile(['p8'])
  const spy = spyMount()
  try {
    await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap([]),
      after: snap(['p8']),
      candidates: ['p8']
    }, { profileDir: profile, mount: spy.mount, isMounted: () => false })
    assert.equal(spy.calls.length, 1)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

console.log('\n[4] mount 失败时如实回传（不许吞掉）')

await check('mount 报失败 ⇒ attempted:true、ok:false、原因透传', async () => {
  const profile = makeProfile(['p9'])
  try {
    const hot = await attemptHotMount(CTX, {
      application: 'restart-required',
      before: snap([]),
      after: snap(['p9']),
      candidates: ['p9']
    }, { profileDir: profile, mount: async () => ({ ok: false, reason: 'patch 含配置行' }) })
    assert.equal(hot.attempted, true)
    assert.equal(hot.ok, false)
    assert.equal(hot.reason, 'patch 含配置行')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

console.log('\n[5] resolveInstalledName 的边界（大小写归一 / 差集唯一 / 认不出）')

await check('大小写不同也能认出（bundleSnapshot 用小写键）', () => {
  assert.equal(
    resolveInstalledName(snap([]), snap(['MyPkg']), ['mypkg']),
    'MyPkg',
    '应返回 after 里的真实名字（大小写原样），而不是小写键'
  )
})

await check('差集里唯一的新名字 ⇒ 直接认它（不要求它在候选里）', () => {
  assert.equal(resolveInstalledName(snap(['old']), snap(['old', 'brand-new']), []), 'brand-new')
})

await check('差集多个新名字 ⇒ 只在候选能唯一确定时认，否则 null', () => {
  assert.equal(resolveInstalledName(snap([]), snap(['a', 'b']), []), null)
  assert.equal(resolveInstalledName(snap([]), snap(['a', 'b']), ['a']), 'a')
  assert.equal(resolveInstalledName(snap([]), snap(['a', 'b']), ['a', 'b']), null, '两个候选都命中就分不清')
})

await check('没有基线时按候选找已存在的名字；多个候选命中 ⇒ null', () => {
  assert.equal(resolveInstalledName(null, snap(['only']), ['only']), 'only')
  assert.equal(resolveInstalledName(null, snap(['a', 'b']), ['a', 'b']), null)
})

await check('after 为 null ⇒ null（不知道，不是「没有」）', () => {
  assert.equal(resolveInstalledName(snap([]), null, ['x']), null)
})

console.log('\n[6] 热挂载结果并进激活回读（挂上了就是真的在跑）')

await check('挂上了 ⇒ 状态改成 live、标上 hot、加一条 hot-mounted 原因', () => {
  const activation = { state: 'restart', expected: '1.0.0', installed: '1.0.0', enabled: true, versionMatches: true, reasons: ['bundle-disabled'] }
  const merged = mergeHotIntoActivation(activation, { attempted: true, ok: true, name: 'p' })
  assert.equal(merged.state, 'live', '挂上了就不该还报 restart')
  assert.equal(merged.hot, true)
  assert.ok(merged.reasons.includes('hot-mounted'))
  assert.ok(merged.reasons.includes('bundle-disabled'), '原有的 reasons 不能被丢掉')
})

await check('重复调用不把 hot-mounted 写两遍（幂等）', () => {
  const activation = { state: 'restart', reasons: [] }
  const hot = { attempted: true, ok: true }
  mergeHotIntoActivation(activation, hot)
  mergeHotIntoActivation(activation, { attempted: true, ok: true, reused: true })
  assert.equal(activation.reasons.filter((r) => r === 'hot-mounted').length, 1)
})

await check('没挂上 / 没尝试 ⇒ 一个字都不改（回读说什么就是什么）', () => {
  const cases = [
    { attempted: false, ok: true },
    { attempted: true, ok: false, reason: 'x' },
    null,
    undefined
  ]
  for (const hot of cases) {
    const activation = { state: 'restart', reasons: [] }
    const merged = mergeHotIntoActivation(activation, hot)
    assert.equal(merged.state, 'restart', `hot=${JSON.stringify(hot)} 不该被改`)
    assert.equal(merged.hot, undefined, '不该凭空标 hot')
    assert.deepEqual(merged.reasons, [])
  }
})

await check('没有 activation 对象时不凭空造一个 live（无凭据的保证比不说更坏）', () => {
  assert.equal(mergeHotIntoActivation(null, { attempted: true, ok: true }), null)
  assert.equal(mergeHotIntoActivation(undefined, { attempted: true, ok: true }), undefined)
})

await check('reasons 缺失（老形状）时也能安全补上', () => {
  const activation = { state: 'restart' }
  const merged = mergeHotIntoActivation(activation, { attempted: true, ok: true })
  assert.equal(merged.state, 'live')
  assert.deepEqual(merged.reasons, ['hot-mounted'])
})

console.log(`\nhot-mount-attempt: ${passed}/${passed + failures.length} 通过`)
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 条：`)
  for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`)
  process.exit(1)
}
