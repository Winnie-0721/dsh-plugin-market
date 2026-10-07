/**
 * client bundle 的**加载期**回归（`verify/` 下所有 *.test.mjs 都由 release.ps1 门禁执行）。
 *
 * 为什么需要它（真实教训）：门禁里对 client 半只做了 `node --check`，而它**只查语法**。
 * 语法合法但一加载就崩的代码（引用了不存在的函数、模块级代码抛错、`apply` 在降级路径上抛错）
 * 在门禁里是**完全静默**的——直到真实浏览器里侧边栏入口根本不出现才被发现，而那条 e2e
 * 不在门禁里、还要本机有浏览器。
 *
 * 做法：用 `window.__ModuleLoader__` 桩把一个**真 bundle** 装起来，然后
 *   1. 注册成功且 id 等于包名；
 *   2. `factory(require)` 真的能跑完（模块级代码）；
 *   3. `apply(ctx)` 用**空 ctx**（什么都拿不到）也必须不抛——这是宿主缺服务时的降级路径，
 *      真实环境里装了个没有 `slots`/`layout` 的宿主就是这个形状。
 *
 * 注意它**不能替代**真实浏览器断言（渲染、动效、几何都不在这里），只负责回答
 * 「这个 bundle 到底能不能被加载起来」。
 *
 * 用法：node verify/client-load.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../plugin-market/lib/client.js', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../plugin-market/package.json', import.meta.url), 'utf8'))

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

/**
 * 把 bundle 装进桩里并跑起来，返回 { entry, mod }。
 * 每次调用都用全新的桩，避免用例间互相污染。
 */
function loadBundle() {
  // 极简 React 桩：bundle 只依赖这几个 hook 和 createElement/Fragment。
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (...args) => ({ __el: true, args }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
  }
  const moduleRequire = (id) => {
    if (id === 'react') return React
    // 平台只给种子模块；require 别的东西应该当场暴露，而不是静默变成 undefined。
    throw new Error(`bundle 只允许 require 平台种子模块，却 require("${id}")`)
  }
  let entry = null
  const fakeWindow = { __ModuleLoader__: { load: (value) => { entry = value } } }
  const factory = new Function('window', 'require', `${source}\n//# sourceURL=client-bundle.js`)
  factory(fakeWindow, moduleRequire)
  assert.ok(entry, 'bundle 必须调用 window.__ModuleLoader__.load')
  const mod = entry.factory(moduleRequire)
  return { entry, mod }
}

console.log('\n[1] bundle 能被加载起来（node --check 查不出这一层）')
check('注册成功且 id 等于包名（否则宿主按 id 找不到这个模块）', () => {
  const { entry } = loadBundle()
  assert.equal(entry.id, pkg.name, `entry.id 应为 ${pkg.name}`)
})
check('**factory 能跑完**：模块级代码不抛（引用了不存在的函数/变量会在这里炸）', () => {
  const { mod } = loadBundle()
  assert.ok(mod && typeof mod === 'object', 'factory 必须返回模块对象')
  assert.equal(typeof mod.apply, 'function', '要导出 apply')
  assert.ok(Array.isArray(mod.inject), '要导出 inject 数组')
})
check('**apply 用空 ctx 也不抛**：宿主缺 slots/layout/locale 时的降级路径', () => {
  const { mod } = loadBundle()
  // 空 ctx：get 什么都拿不到、没有 on/effect —— 这是「宿主只起了 host 半」的形状。
  const callCounts = { register: 0 }
  const ctx = {
    get: () => undefined,
    on: () => {},
    effect: () => {},
    slots: undefined,
    // 故意给一个会记账的注册器：apply 不该在拿不到服务时注册任何东西。
    register: () => { callCounts.register += 1; return () => {} },
  }
  assert.doesNotThrow(() => mod.apply(ctx), 'apply 在降级路径上抛错会让插件的 fiber 变 FAILED')
})
check('apply 在缺服务时**不注册席位**（不能凭空往 slots 里塞东西）', () => {
  const { mod } = loadBundle()
  let injected = 0
  const ctx = {
    // slots 存在但没有 inject/register 时也必须安全跳过（老宿主形状）。
    get: (name) => (name === 'slots' ? {} : undefined),
    on: () => {},
    effect: () => {},
    slots: {},
  }
  mod.apply(ctx)
  injected += 1 // 走到这里说明没抛
  assert.equal(injected, 1)
})
check('`inject` 声明的服务名是宿主真有的（拼错会静默永不注入）', () => {
  const { mod } = loadBundle()
  const allowed = new Set(['slots', 'layout', 'locale', 'timer'])
  for (const name of mod.inject) {
    assert.ok(allowed.has(name), `inject 里出现了未知服务名「${name}」`)
  }
  // 这是本包真正依赖的三个：缺任一个都应走降级而不是崩。
  for (const required of ['slots', 'layout']) {
    assert.ok(mod.inject.includes(required), `inject 应当包含 ${required}`)
  }
})
check('bundle 里没有 eval / new Function（宿主会拒绝，也是安全约束）', () => {
  assert.equal(/\beval\s*\(/.test(source), false, '出现了 eval(')
  assert.equal(/new\s+Function\s*\(/.test(source), false, '出现了 new Function(')
})

console.log('')
if (failures.length > 0) {
  console.log(`client bundle 加载回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`client bundle 加载回归：${passed}/${passed} 全通过`)
}
