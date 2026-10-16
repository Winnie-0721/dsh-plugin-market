/**
 * 行为回归：热挂载（免重启装插件）。
 *
 * 逻辑移植自 dsh-market（`dshmarket`）的 `src/hot.ts`。这个套件钉的是**移植后我们自己的
 * 形状**，不是参考实现的代码：哪些 patch 能挂、挂不成时说什么、超时会不会漏、
 * 卸载失败会不会谎报成功。这些分支在源码形状断言下全都测不出来。
 *
 * 分三层：
 *   [1] 纯函数：parseSimplePatch / resolveProfileEntry / entryArtifactExists / cleanHotDir
 *   [2] 真挂载：用一个**假 Include 基类**喂给 hotMount，检查它写出的 YAML、调用 ctx.plugin
 *       的形状、成功与失败两条路径、以及失败时必须回滚（销毁子树 + 删掉输入文件）
 *   [3] 超时与卸载：卡住的 activation / 卡住的 dispose 必须有界，且不许把没确认的卸载报成成功
 *
 * 所有文件操作都在系统 tmpdir 里造 profile，不碰仓库与真实 DSH_HOME。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mod = await import('../plugin-market/lib/hot-mount.js')
const {
  HOT_DIR,
  cleanHotDir,
  entryArtifactExists,
  hotMount,
  hotUnmount,
  isHotMounted,
  listHotMounts,
  parseSimplePatch,
  readPackageDsh,
  readPackagePatch,
  resetHotStateForTests,
  resolveProfileEntry
} = mod

let passed = 0
const failures = []
async function check(name, fn) {
  resetHotStateForTests()
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, message: error.message })
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}

/** 造一个临时 profile 目录，返回它的路径。 */
function makeProfile() {
  return mkdtempSync(join(tmpdir(), 'dshm-hot-'))
}

/** 往 profile 里装一个包（写 package.json + 任意文件）。 */
function installPackage(profileDir, name, manifest, extra = {}) {
  const dir = join(profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  for (const [file, text] of Object.entries(extra)) {
    const target = join(dir, file)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, text)
  }
  return dir
}

/**
 * 一个**假的 include 基类**，形状对齐真正的 `Include`：
 *   - 构造要读那个 YAML 文件（不存在就该失败——这正是 mount 的失败路径）；
 *   - `write()` 会被子类屏蔽；
 *   - `import()` 供 shim 分支覆盖。
 * 用它就不必在测试里 import 宿主闭包里的真插件（那需要 --expose-internals）。
 */
function makeFakeCtx({ failAwait = false, hangAwaitMs = 0 } = {}) {
  const calls = { plugins: [], disposed: 0 }
  class FakeInclude {
    constructor(ctx, config) {
      // 真 Include 会 fileURLToPath 再读文件；文件不在 = 构造后 init 里抛错。
      this.config = config
      this.path = config?.path ?? null
    }
    static fromFileURL(url) {
      // 真的 Include 走的是 `fileURLToPath(new URL(path, baseUrl))`；手工剥 `file://`
      // 在 Windows 上会留下 `/C:/…`（不存在的路径）。测试必须用同一个函数，
      // 否则测的是我这条剥离逻辑而不是产品行为。
      return fileURLToPath(url)
    }
    async init() {
      const file = FakeInclude.fromFileURL(this.path)
      if (!existsSync(file)) throw new Error(`config file not found: ${file}`)
      this.loaded = readFileSync(file, 'utf8')
      if (failAwait) throw new Error('boom: activation failed')
      if (hangAwaitMs > 0) {
        // unref：这个「卡住的」定时器只用来模拟挂起。不 unref 的话它会一直把事件循环
        // 撑住，整个套件要多等满那段时长才退出（实测 5238ms，是门禁里最慢的一条）。
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, hangAwaitMs)
          timer.unref?.()
        })
      }
      return this
    }
    await() {
      return this.init()
    }
    dispose() {
      calls.disposed += 1
      return Promise.resolve()
    }
  }
  const ctx = {
    plugin(PluginClass, config) {
      const instance = new PluginClass(ctx, config)
      calls.plugins.push({ PluginClass, config, instance })
      return instance
    },
    loader: { internal: null }
  }
  return { ctx, FakeInclude, calls }
}

/** 打桩的 loadTree：直接给出我们自己的假类，绕开宿主闭包。 */
function loadTreeOf(FakeInclude) {
  return async () => ({ class: FakeInclude, via: 'test' })
}

// ── [1] 纯函数 ────────────────────────────────────────────────────────────
console.log('\n[1] patch 解析与入口解析（纯函数）')

await check('纯 insert patch → 行列表；注释与空行不影响', () => {
  const rows = parseSimplePatch([
    '# 注释',
    '- insert:',
    "    - id: my-plugin",
    "      name: '@scope/my-plugin'",
    '',
    '    - id: second',
    '      name: plain-name'
  ].join('\n'))
  assert.deepEqual(rows, [
    { id: 'my-plugin', name: '@scope/my-plugin' },
    { id: 'second', name: 'plain-name' }
  ])
})

await check('CRLF 行尾 + 行内注释照样解析（Windows 上写的插件必须能挂）', () => {
  const rows = parseSimplePatch(
    '- insert:\r\n    - id: win # 说明\r\n      name: win-pkg\r\n'
  )
  assert.deepEqual(rows, [{ id: 'win', name: 'win-pkg' }])
})

await check('config: 行 → 整体作废（返回 null，不猜着挂一半）', () => {
  assert.equal(parseSimplePatch('- insert:\n    - id: a\n      name: a-pkg\n      config:\n        x: 1\n'), null)
})
await check('**行内流式** config 也要作废（`config: {}` / `config: true`）', () => {
  // 变异测试 M1 实测的覆盖缺口：只挡 `^\s+config:` 的写法时，这两条会被**误判为纯 insert
  // 并挂上去**，而它们真的带配置。产品当前已经靠「认不出的键一律 return null」挡住，
  // 这里把那个行为钉死——否则哪天有人把兜底改成「跳过不认识的行」，这两条就漏了。
  assert.equal(parseSimplePatch('- insert:\n    - id: a\n      name: a-pkg\n      config: {x: 1}\n'), null, '行内流式对象')
  assert.equal(parseSimplePatch('- insert:\n    - id: a\n      name: a-pkg\n      config: true\n'), null, '行内标量')
})
await check('任何非 id/name 的键都作废（disabled / 未来才有的新键）', () => {
  assert.equal(parseSimplePatch('- insert:\n    - id: a\n      name: a-pkg\n      disabled: true\n'), null)
  assert.equal(parseSimplePatch('- insert:\n    - id: a\n      name: a-pkg\n      somethingBrandNew: 1\n'), null)
})
await check('半路冒出的裸 name（前一行不是 id）作废，不拼出一半', () => {
  assert.equal(parseSimplePatch('- insert:\n      name: a-pkg\n'), null)
})

await check('!!js 表达式 → 作废', () => {
  assert.equal(parseSimplePatch('- insert:\n    - id: a\n      name: !!js ctx.x\n'), null)
})

await check('只有 id 没有 name → 作废（不完整的一对）', () => {
  assert.equal(parseSimplePatch('- insert:\n    - id: orphan\n'), null)
})

await check('空 patch / 纯注释 / 非字符串 → 作废', () => {
  assert.equal(parseSimplePatch(''), null)
  assert.equal(parseSimplePatch('# 只有注释\n'), null)
  assert.equal(parseSimplePatch(null), null)
  assert.equal(parseSimplePatch(undefined), null)
})

await check('反向对照：合法的纯 insert 必须被接受（上面的作废不能过宽）', () => {
  assert.notEqual(parseSimplePatch('- insert:\n    - id: a\n      name: a-pkg\n'), null)
})

await check('resolveProfileEntry：裸名解析成 file:// 绝对 URL', () => {
  const profile = makeProfile()
  try {
    installPackage(profile, 'ok-pkg', { name: 'ok-pkg', main: 'index.js' }, { 'index.js': 'export const x=1' })
    const url = resolveProfileEntry(profile, 'ok-pkg')
    assert.match(url, /^file:\/\//, `应当是 file:// URL，实际 ${url}`)
    assert.ok(url.endsWith('index.js'), `应当指向 index.js，实际 ${url}`)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('resolveProfileEntry：scoped 包按 / 拆路径', () => {
  const profile = makeProfile()
  try {
    installPackage(profile, '@scope/pkg', { name: '@scope/pkg', main: 'lib/main.js' }, { 'lib/main.js': 'export const x=1' })
    const url = resolveProfileEntry(profile, '@scope/pkg')
    assert.ok(url.includes('/@scope/pkg/'), `路径要含 @scope/pkg，实际 ${url}`)
    assert.ok(url.endsWith('lib/main.js'), `应当指向 main，实际 ${url}`)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('resolveProfileEntry：非裸名原样放行（相对路径 / file:// / cordis: 内建）', () => {
  assert.equal(resolveProfileEntry('/p', './local.js'), './local.js')
  assert.equal(resolveProfileEntry('/p', 'file:///x/y.js'), 'file:///x/y.js')
  assert.equal(resolveProfileEntry('/p', 'cordis:group'), 'cordis:group')
})

await check('resolveProfileEntry：包不存在时退回裸名（交给 loader 报准确的错），不编路径', () => {
  const profile = makeProfile()
  try {
    assert.equal(resolveProfileEntry(profile, 'nope-pkg'), 'nope-pkg')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('entryArtifactExists：exports 条件对象 / main / index.js 三种产物都认', () => {
  const profile = makeProfile()
  try {
    const a = installPackage(profile, 'ex-cond', { name: 'ex-cond', exports: { '.': { default: './lib/a.js' } } }, { 'lib/a.js': '' })
    assert.equal(entryArtifactExists(a), true, 'exports 条件对象的 default 应被认到')
    const b = installPackage(profile, 'by-main', { name: 'by-main', main: './dist/m.js' }, { 'dist/m.js': '' })
    assert.equal(entryArtifactExists(b), true, 'main 应被认到')
    const c = installPackage(profile, 'by-index', { name: 'by-index' })
    assert.equal(entryArtifactExists(c), false, '没有任何产物时不许虚报存在')
    installPackage(profile, 'by-index2', { name: 'by-index2' }, { 'index.js': '' })
    assert.equal(entryArtifactExists(join(profile, 'node_modules', 'by-index2')), true, 'index.js 应被认到')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('cleanHotDir：只删 hot-N.yml，别的东西一个都不动', () => {
  const profile = makeProfile()
  try {
    const dir = join(profile, HOT_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'hot-1.yml'), 'x')
    writeFileSync(join(dir, 'hot-99.yml'), 'x')
    writeFileSync(join(dir, 'state.json'), '{"disabled":[]}')
    writeFileSync(join(dir, 'notes.txt'), 'keep me')
    const removed = cleanHotDir(profile)
    assert.equal(removed, 2)
    assert.deepEqual(readdirSync(dir).sort(), ['notes.txt', 'state.json'])
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('readPackagePatch：读 dsh.bundle.patch；声明的文件读不到时作废（不能挂一半）', () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'has-patch',
      { name: 'has-patch', dsh: { bundle: { patch: './sub/p.yml' } } },
      { 'sub/p.yml': '- insert:\n    - id: hi\n      name: has-patch\n' }
    )
    const patch = readPackagePatch(profile, 'has-patch')
    assert.notEqual(patch, null)
    assert.match(patch.texts.join('\n'), /id: hi/)

    installPackage(profile, 'missing-patch', { name: 'missing-patch', dsh: { bundle: { patch: './gone.yml' } } })
    assert.equal(readPackagePatch(profile, 'missing-patch'), null, '声明的文件缺失必须作废整个 bundle')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

// ── [2] 真挂载 ────────────────────────────────────────────────────────────
console.log('\n[2] hotMount：写出的 YAML、成功路径、失败回滚')

await check('挂载成功：YAML 是纯 id/name 对、name 是 file:// URL、ctx.plugin 被调用一次', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'good-pkg',
      { name: 'good-pkg', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'index.js': 'export const x=1', 'cordis.patch.yml': '- insert:\n    - id: good\n      name: good-pkg\n' }
    )
    const { ctx, FakeInclude, calls } = makeFakeCtx()
    const result = await hotMount(ctx, profile, 'good-pkg', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(result.ok, true, `应当挂上，实际 ${JSON.stringify(result)}`)
    assert.equal(calls.plugins.length, 1, 'ctx.plugin 应被调用正好一次（多一次就是重复挂载）')

    const file = fileURLToPath(calls.plugins[0].config.path)
    assert.ok(existsSync(file), `输入文件应当存在：${file}`)
    const yml = readFileSync(file, 'utf8')
    assert.match(yml, /^- id: 'mkt-good'$/m, `行 id 要加 mkt- 前缀：\n${yml}`)
    assert.match(yml, /^ {2}name: 'file:\/\/.*index\.js'$/m, `name 要是 file:// 绝对 URL：\n${yml}`)
    assert.equal(yml.includes('config:'), false, 'YAML 里不许出现 config 块')
    assert.equal(isHotMounted('good-pkg'), true)
    assert.deepEqual(listHotMounts(), ['good-pkg'])
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('挂载成功：把输入文件放在 .dsh-market/ 下且文件名是 hot-N.yml', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'p1',
      { name: 'p1', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: p1\n      name: p1\n' }
    )
    const { ctx, FakeInclude, calls } = makeFakeCtx()
    await hotMount(ctx, profile, 'p1', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    const file = fileURLToPath(calls.plugins[0].config.path)
    assert.ok(file.includes(HOT_DIR), `输入必须在 ${HOT_DIR} 下：${file}`)
    assert.match(file, /hot-\d+\.yml$/, `文件名必须是 hot-N.yml：${file}`)
    // 提示：这也是那个「必须每次启动擦掉」的目录。
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('挂载失败：输入文件必须被删掉（否则下次组装再炸一次）', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'bad-pkg',
      { name: 'bad-pkg', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: bad\n      name: bad-pkg\n' }
    )
    const { ctx, FakeInclude, calls } = makeFakeCtx({ failAwait: true })
    const result = await hotMount(ctx, profile, 'bad-pkg', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(result.ok, false, '激活抛错时不许报成功')
    assert.match(result.reason, /hot-mount failed|热挂载失败/)
    // 文件已经不存在了——但 config 里记着路径，直接查那个路径。
    const file = fileURLToPath(calls.plugins[0].config.path)
    assert.equal(existsSync(file), false, `失败的挂载必须删掉输入文件：${file}`)
    assert.equal(calls.disposed, 1, '半挂的子树必须被销毁（不能留着继续重试）')
    assert.equal(isHotMounted('bad-pkg'), false, '失败的挂载绝不许进热挂载表')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('挂载失败：失败的包也不许留在 shim 名集里（下一次挂载不能被它污染）', async () => {
  const profile = makeProfile()
  try {
    // client-only 包 → 走 shim 分支 → 激活失败
    installPackage(profile, 'client-only', { name: 'client-only', dsh: { client: {} } })
    const { ctx, FakeInclude, calls } = makeFakeCtx({ failAwait: true })
    const result = await hotMount(ctx, profile, 'client-only', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(result.ok, false)
    assert.equal(calls.plugins.length, 1)
    // 再挂一次：shim 名集被清干净了，所以这次仍然走 shim 分支并再失败一次（而不是 e.g. 跳过）
    const again = await hotMount(ctx, profile, 'client-only', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(again.ok, false)
    assert.equal(calls.plugins.length, 2, '第二次尝试必须真的再挂一次（说明状态没被上次的失败留下残渣）')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('client-only 包（有 dsh.client、无 dsh.bundle）→ 用 no-op shim 行挂上', async () => {
  const profile = makeProfile()
  try {
    installPackage(profile, '@scope/skin', { name: '@scope/skin', dsh: { client: { platform: 'web' } } })
    const { ctx, FakeInclude, calls } = makeFakeCtx()
    const result = await hotMount(ctx, profile, '@scope/skin', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(result.ok, true, `client-only 应当能挂上，实际 ${JSON.stringify(result)}`)
    const file = fileURLToPath(calls.plugins[0].config.path)
    const yml = readFileSync(file, 'utf8')
    // 断言**规则**而不是手算的字符串：id 里凡是不属于 [A-Za-z0-9_.-] 的字符一律换成 -。
    // （`@scope/skin` 的两个字符都被换，于是得到 `mkt-client--scope-skin`；手算容易记错，
    //   而这条规则本身才是要被钉住的东西——row id 要进 YAML，字符集不能出错。）
    const expectedId = `mkt-client-${'@scope/skin'.replace(/[^A-Za-z0-9_.-]/g, '-')}`
    assert.ok(yml.includes(`- id: '${expectedId}'`), `shim 行 id 应为 ${expectedId}：\n${yml}`)
    // name 可以是 file:// URL，也可以是裸名：这个包没有可解析的入口产物（没有 main/exports、
    // 也没有 index.js），resolveProfileEntry 按约定保留裸名交给 loader。对 **client-only
    // shim** 这是安全的——shim 分支在 import() 里被换成 no-op 模块，那个名字永远不会被解析。
    assert.match(yml, /^ {2}name: '(file:\/\/|@scope\/skin)/m, `shim 行的 name 要么是 file:// URL、要么是裸名：\n${yml}`)
    assert.equal(isHotMounted('@scope/skin'), true)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('既无 bundle patch 又无 dsh.client → 如实说「没东西可挂」，不假装失败于别处', async () => {
  const profile = makeProfile()
  try {
    installPackage(profile, 'plain-npm', { name: 'plain-npm', main: 'i.js' }, { 'i.js': '' })
    const { ctx, FakeInclude, calls } = makeFakeCtx()
    const result = await hotMount(ctx, profile, 'plain-npm', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(result.ok, false)
    assert.match(result.reason, /no bundle patch and no dsh\.client/, `原因要说对，实际：${result.reason}`)
    assert.equal(calls.plugins.length, 0, '没有可挂的东西时不该调用 ctx.plugin')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('patch 含 config 行 → 不挂，明说「只支持纯 insert」', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'cfg-pkg',
      { name: 'cfg-pkg', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: c\n      name: cfg-pkg\n      config:\n        a: 1\n' }
    )
    const { ctx, FakeInclude, calls } = makeFakeCtx()
    const result = await hotMount(ctx, profile, 'cfg-pkg', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(result.ok, false)
    assert.match(result.reason, /plain inserts only|纯 insert/, `原因要说对，实际：${result.reason}`)
    assert.equal(calls.plugins.length, 0)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('宿主没有 ctx.plugin → 如实回「做不了」，不是崩', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'x',
      { name: 'x', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: x\n      name: x\n' }
    )
    const result = await hotMount({}, profile, 'x', { timeoutMs: 1000 })
    assert.equal(result.ok, false)
    assert.match(result.reason, /ctx\.plugin|composition API|热挂载做不了/)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('include 插件解析不到（老宿主）→ 如实回「宿主不支持」，不是崩', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'y',
      { name: 'y', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: y\n      name: y\n' }
    )
    const ctx = { plugin: () => ({ await: async () => {}, dispose: async () => {} }), loader: { internal: null } }
    const result = await hotMount(ctx, profile, 'y', { loadTree: async () => ({ class: null, via: null, attempts: [{ label: 'plain import()', ok: false, error: 'ERR_MODULE_NOT_FOUND' }] }), timeoutMs: 1000 })
    assert.equal(result.ok, false)
    assert.match(result.reason, /include plugin unavailable|宿主不支持热挂载/)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('解析失败时**每条路径的原始错误**都要带出去（否则「不支持」无法指向任何可修的东西）', async () => {
  // 变异测试 M10 实测的覆盖缺口：把 detail 折成空串后套件照样绿。
  // 这条结论上一轮真机实验里真被它误导过——只看到「宿主不支持热挂载」，无从下手。
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'y2',
      { name: 'y2', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: y2\n      name: y2\n' }
    )
    const ctx = { plugin: () => ({ await: async () => {}, dispose: async () => {} }), loader: { internal: null } }
    const attempts = [
      { label: 'plain import()', ok: false, error: 'ERR_MODULE_NOT_FOUND not found' },
      { label: 'loader.internal.import(baseUrl)', ok: false, error: 'ERR_INVALID_ARG no anchor' }
    ]
    const result = await hotMount(ctx, profile, 'y2', { loadTree: async () => ({ class: null, via: null, attempts }), timeoutMs: 1000 })
    assert.equal(result.ok, false)
    assert.match(result.reason, /plain import\(\): ERR_MODULE_NOT_FOUND not found/, `第一条路径的原始错误必须在 reason 里，实际：${result.reason}`)
    assert.match(result.reason, /loader\.internal\.import\(baseUrl\): ERR_INVALID_ARG no anchor/, '第二条也要在')
    assert.deepEqual(result.attempts, attempts, '结构化的 attempts 也要回传，便于日志与后续排查')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

// ── [3] 超时与卸载 ────────────────────────────────────────────────────────
console.log('\n[3] 超时必须有界；卸载不许谎报成功')

await check('卡住的 activation 被上限截断（不是永远挂着）', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'hang-pkg',
      { name: 'hang-pkg', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: h\n      name: hang-pkg\n' }
    )
    const { ctx, FakeInclude, calls } = makeFakeCtx({ hangAwaitMs: 5000 })
    const startedAt = Date.now()
    const result = await hotMount(ctx, profile, 'hang-pkg', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 300 })
    const elapsed = Date.now() - startedAt
    assert.equal(result.ok, false)
    assert.match(result.reason, /did not settle within|没有落地/)
    assert.ok(elapsed >= 250, `不该早于上限返回，实际 ${elapsed}ms`)
    assert.ok(elapsed < 3000, `必须在有界时间内返回，实际 ${elapsed}ms`)
    assert.equal(calls.disposed, 1, '超时的挂载也要销毁子树')
    assert.equal(isHotMounted('hang-pkg'), false)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('卸载成功：返回 true，且从热挂载表里消失', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'um',
      { name: 'um', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: um\n      name: um\n' }
    )
    const { ctx, FakeInclude } = makeFakeCtx()
    await hotMount(ctx, profile, 'um', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(isHotMounted('um'), true)
    const ok = await hotUnmount('um', { timeoutMs: 2000 })
    assert.equal(ok, true)
    assert.equal(isHotMounted('um'), false)
    assert.deepEqual(listHotMounts(), [])
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('卸载没有热挂载过的包 → false（不是报成功）', async () => {
  assert.equal(await hotUnmount('never-mounted', { timeoutMs: 500 }), false)
})

await check('卡住的 dispose：有界返回 **false**（没能确认停止就不许说已经卸掉）', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'stuck',
      { name: 'stuck', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: s\n      name: stuck\n' }
    )
    const calls = { disposed: 0 }
    class StuckInclude {
      constructor(context, config) { this.config = config }
      await() { return Promise.resolve() }
      dispose() {
        calls.disposed += 1
        return new Promise(() => {}) // 永远不 settle
      }
    }
    const ctx = { plugin: (P, c) => new P(ctx, c), loader: { internal: null } }
    const mounted = await hotMount(ctx, profile, 'stuck', { loadTree: async () => ({ class: StuckInclude, via: 'test' }), timeoutMs: 2000 })
    assert.equal(mounted.ok, true)
    const startedAt = Date.now()
    const ok = await hotUnmount('stuck', { timeoutMs: 300 })
    const elapsed = Date.now() - startedAt
    assert.equal(ok, false, '没能确认停止时必须是 false——报 true 就是谎报')
    assert.ok(elapsed >= 250 && elapsed < 3000, `有界返回，实际 ${elapsed}ms`)
    assert.equal(calls.disposed, 1)
    assert.equal(isHotMounted('stuck'), false, '即使 teardown 卡住，也要先把它从表里摘掉（否则永远卸不掉）')
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('卸载大小写不敏感（installed 记录的名字与热挂载键不保证一致）', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'CasePkg',
      { name: 'CasePkg', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: c\n      name: CasePkg\n' }
    )
    const { ctx, FakeInclude } = makeFakeCtx()
    await hotMount(ctx, profile, 'CasePkg', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    assert.equal(isHotMounted('casepkg'), true, '大小写不同也要认出来（否则卸载会漏掉它）')
    assert.equal(await hotUnmount('CASEPKG', { timeoutMs: 2000 }), true)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('连续挂两次同一个包：两次都插行（调用方负责不重复挂——这里钉住这个事实）', async () => {
  const profile = makeProfile()
  try {
    installPackage(
      profile,
      'twice',
      { name: 'twice', main: 'i.js', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'i.js': '', 'cordis.patch.yml': '- insert:\n    - id: t\n      name: twice\n' }
    )
    const { ctx, FakeInclude, calls } = makeFakeCtx()
    await hotMount(ctx, profile, 'twice', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    await hotMount(ctx, profile, 'twice', { loadTree: loadTreeOf(FakeInclude), timeoutMs: 2000 })
    // 两次是**不同的文件名**（hot-1 / hot-2），这正是「调用方必须先查 isHotMounted」的理由。
    const files = calls.plugins.map((entry) => entry.config.path)
    assert.equal(new Set(files).size, 2, '两次挂载写的是不同文件——所以调用方必须先查 isHotMounted')
    assert.equal(isHotMounted('twice'), true)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

await check('readPackageDsh：读不到包时返回 null（不编一个空 dsh）', () => {
  const profile = makeProfile()
  try {
    assert.equal(readPackageDsh(profile, 'ghost'), null)
    installPackage(profile, 'real', { name: 'real', dsh: { client: {} } })
    assert.deepEqual(readPackageDsh(profile, 'real'), { client: {} })
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
})

console.log(`\nhot-mount: ${passed}/${passed + failures.length} 通过`)
if (failures.length > 0) {
  console.log(`失败 ${failures.length} 条：`)
  for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`)
  process.exit(1)
}
