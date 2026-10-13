/**
 * 崩溃恢复卡的**行为**回归（不是「源码里有这个字符串」）。
 *
 * 为什么需要它（实测出来的背景，不是推测）：
 * DSH 宿主确实给每个 slot entry 套了 `SlotErrorBoundary`，但它的兜底面是
 * `div[data-slot-error]`——无文案、无样式、无子节点（`[data-slot-error]` 在
 * app.css / vendor.css 里零命中）。而且渲染层用 `abdicate: spec.kind !== "chain"`
 * 上报，`main` 是 keyed、`sidebar.footer.action` 是 list，**都不是 chain**，于是
 * entry 被塞进 `SlotCore.abdicated`，cell 干涸后落到 `deadCell()`——同一块空 div，
 * 且「for the rest of their registration's life」= 永久。用户能看到的只有一块
 * 无提示的空白，只能刷新页面。
 *
 * 我们的插件在 profile 里是 bundle，不走动态沙箱面，所以
 * `dsh-cordis-client-runner` 的 owners 索引够不着我们（`owners.set` 全档只有 1 处，
 * 在 guardedSurface 的 claim() 里）——Cordis 面板那行「Rendering failed in {slot}」
 * 是动态插件的待遇。我们没有第二条可见通道。
 *
 * 本测试用一个**会抛错的子组件**把边界真正跑起来，断言：
 *   1. 子组件抛错时，渲染结果是恢复卡（role=alert + 崩溃标记），而不是空白；
 *   2. 恢复卡带自己的样式表（否则崩在 ensureStyles 之前会裸奔）；
 *   3. 恢复卡带 translate="no"（防浏览器整页翻译改写 React 文本节点，即上游 #293）；
 *   4. getDerivedStateFromError 之后 error 进 state（这是 React 真正调用的钩子）；
 *   5. 点「重试」后子组件重新挂载且这次不抛 → 恢复成真内容，error 清空；
 *   6. 两个 slot 的注册都用包装后的组件（否则宿主仍然会 abdicate）；
 *   7. 恢复卡文案走 t() 且 zh/en 都有，不是硬编码。
 *
 * 用法：node verify/crash-boundary.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../plugin-market/lib/client.js', import.meta.url), 'utf8')

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

/** 极简 DOM 桩：只够 ensureStyles / 样式表计数用。 */
function createDom() {
  const make = (tag, id) => {
    const node = {
      tagName: tag, id: id || '', type: '', textContent: '', dataset: {},
      children: [], attrs: {}, _listeners: {},
      style: {}, className: '',
      appendChild(child) { this.children.push(child); return child },
      removeChild(child) { this.children = this.children.filter((c) => c !== child); return child },
      setAttribute(k, v) { this.attrs[k] = v },
      getAttribute(k) { return this.attrs[k] },
      addEventListener(k, fn) { (this._listeners[k] ||= []).push(fn) },
      removeEventListener() {},
      fire(k) { (this._listeners[k] || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {} })) },
    }
    return node
  }
  const head = make('head')
  const document = {
    head,
    getElementById(id) {
      const walk = (n) => {
        for (const c of n.children) { if (c.id === id) return c; const hit = walk(c); if (hit) return hit }
        return null
      }
      return walk(head)
    },
    createElement: (tag) => make(tag),
  }
  const MutationObserver = class { observe() {} disconnect() { this.disconnected = true } }
  return { document, head, MutationObserver }
}

/**
 * 带「类组件」能力的 React 桩：足够让 CrashBoundary 真的被实例化并被调用
 * render / getDerivedStateFromError / setState——否则这个测试就退化成
 * 「源码里有 CrashBoundary 这个词」，那正是它要避免的假绿。
 */
function createReact() {
  // 真 React 18 的 Component 是**普通函数**（`function Component(props, context, updater)`），
  // 可以被 `.call(this, props)` 调用——边界正是这么继承它的。这里必须照真身来桩：
  // 写成 ES class 的话 `Component.call` 会抛 "cannot be invoked without 'new'"，
  // 那是桩的形状问题，不是产品问题（第一版就是这么误报的）。
  function Component(props) {
    this.props = props || {}
    this.state = {}
  }
  Component.prototype.setState = function setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state, this.props) : patch
    this.state = Object.assign({}, this.state, next)
    if (this.__onUpdate) this.__onUpdate()
  }
  return {
    Component,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (fn) => { const c = fn(); if (typeof c === 'function') c() },
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
}

/** 把 bundle 装进桩里并真正执行 factory。 */
function materialize() {
  const react = createReact()
  const dom = createDom()
  let handoff = null
  const win = {
    __ModuleLoader__: { load: (v) => { handoff = v } },
    location: { reload() { win.__reloaded = true } },
  }
  new Function('window', 'document', 'MutationObserver', 'React', 'navigator', source)(
    win, dom.document, dom.MutationObserver, react, { clipboard: null },
  )
  assert.ok(handoff, 'bundle 必须调用 window.__ModuleLoader__.load')
  assert.equal(handoff.id, 'deepseek-harness-market', 'bundle id 必须是包名')
  const exports = handoff.factory((id) => {
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Tooltip: ({ children }) => children }
    throw new Error('unexpected require: ' + id)
  })
  return { exports, dom, react, win }
}

/**
 * 从源码里抠出崩溃边界的实现区域。
 *
 * 这几段（LAST_CRASH / ReactComponent / CrashBoundary / lastCrash / withCrashBoundary）
 * 在文件里是**连续**的，所以按起止标记整片切，比逐个 grab 函数体安全——
 * `grab()` 按「第一个 { 起的括号配平」工作，把它用在 `var X = ...` 这类语句上会一路
 * 吞进下一个函数体，切出来的代码括号不配平（第一版就是这么 SyntaxError 的）。
 */
const REGION_START = 'var LAST_CRASH = null;'
const REGION_END = 'function MarketEntry(props) {'
function crashRegion() {
  const from = source.indexOf(REGION_START)
  const to = source.indexOf(REGION_END)
  assert.ok(from >= 0, `找不到 ${REGION_START}`)
  assert.ok(to > from, `找不到 ${REGION_END}`)
  return source.slice(from, to)
}

/** 取单个函数的完整函数体（仅用于函数签名）。 */
function grab(signature) {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`抠不到：${signature}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`括号不配平：${signature}`)
}

console.log('崩溃恢复卡行为回归')

// ── 1. 边界真的能把抛错的子组件换成恢复卡 ────────────────────────────────
const react = createReact()
const crashText = {
  zh: { 'crash.title': 'T', 'crash.hint': 'H', 'crash.retry': 'R', 'crash.reload': 'L', 'crash.copy': 'C', 'crash.copied': 'OK', 'crash.details': 'D' },
  en: { 'crash.title': 'T', 'crash.hint': 'H', 'crash.retry': 'R', 'crash.reload': 'L', 'crash.copy': 'C', 'crash.copied': 'OK', 'crash.details': 'D' },
}
const sandbox = new Function(
  'React', 'el', 't', 'ensureStyles', 'console', 'navigator',
  `${crashRegion()}
   return { CrashBoundary, withCrashBoundary, lastCrash };`,
)(react, react.createElement, (k) => (crashText.zh[k] ?? k), () => {}, { error() {}, warn() {} }, { clipboard: null })

check('CrashBoundary 从源码里被成功抠出并导出', () => {
  assert.equal(typeof sandbox.CrashBoundary, 'function')
  assert.equal(typeof sandbox.withCrashBoundary, 'function')
})

// 正常的子组件：渲染出可见内容
const Good = (props) => react.createElement('div', { className: 'good' }, 'real content')
// 会抛的子组件：模拟插件渲染期真抛
let boom = true
const Bad = (props) => {
  if (boom) throw new Error('boom from child')
  return react.createElement('div', { className: 'good' }, 'recovered content')
}

const Guarded = sandbox.withCrashBoundary(Bad, 'panel', 'main')

/**
 * 按 React 的**真实契约**模拟一次「子树渲染抛错」：
 *   1. React 先调用子组件 → 抛错；
 *   2. 调 `static getDerivedStateFromError(error)` 拿下一份 state；
 *   3. 调 `componentDidCatch(error, info)`；
 *   4. 用新 state 再 render 一次 → 应得到恢复卡。
 * 注意 CrashBoundary 是**构造器**，必须 `new`（第一版当普通函数调，`this` 是 undefined，
 * 于是 this.retry.bind 直接炸——那是桩的错，不是产品的错）。
 */
function simulateChildThrow(props, childElement) {
  const error = (() => {
    try {
      // React 在这一步真正调用子组件
      childElement.type(childElement.props)
      return null
    } catch (e) {
      return e
    }
  })()
  assert.ok(error, '前置条件：子组件必须抛错')
  // 真流程里子元素是 props.children（withCrashBoundary 用 el(Component, props) 传的），
  // 漏了它重试后 render 就拿不到子树——那是桩的错。
  const full = Object.assign({ children: childElement }, props)
  const instance = new sandbox.CrashBoundary(full)
  const nextState = sandbox.CrashBoundary.getDerivedStateFromError(error)
  instance.state = Object.assign({}, instance.state, nextState)
  sandbox.CrashBoundary.prototype.componentDidCatch.call(instance, error, { componentStack: 'at Bad\n  at Guarded' })
  return { instance, error }
}

check('子组件抛错时，外层渲染的是恢复卡而不是空白', () => {
  const child = { type: Bad, props: {} }
  const { instance, error } = simulateChildThrow({ variant: 'panel', slot: 'main' }, child)
  assert.equal(instance.state.error.message, 'boom from child', 'error 必须进 state')
  assert.equal(instance.state.error, error)
  // 用真实 render 产出恢复卡
  const card = sandbox.CrashBoundary.prototype.render.call(instance)
  assert.equal(card.type, 'div', '恢复卡根节点是 div')
  assert.equal(card.props.role, 'alert', '恢复卡必须是 role=alert（可被读屏与 e2e 找到）')
  assert.equal(card.props['data-plugin-market-crashed'], 'main', '必须带崩溃标记')
  assert.ok(card.children && card.children.length > 0, '恢复卡必须有内容，不能是裸 div')
})

check('未崩溃时正常子组件原样渲染（边界对正常路径是透明的）', () => {
  const ok = { type: Good, props: {} }
  const instance = new sandbox.CrashBoundary({ variant: 'panel', slot: 'main', children: ok })
  const tree = sandbox.CrashBoundary.prototype.render.call(instance)
  assert.equal(tree.props.className, 'dshpm-crashSlot')
  assert.equal(tree.children[0], ok, '子元素必须原样透传，不能被替换')
})

check('重试之后若不再抛错，就恢复成真实内容（这是「能自救」的核心）', () => {
  const child = { type: Bad, props: {} }
  const { instance } = simulateChildThrow({ variant: 'panel', slot: 'main' }, child)
  // 崩着：render 出恢复卡
  assert.equal(sandbox.CrashBoundary.prototype.render.call(instance).props.role, 'alert')
  // 点重试
  sandbox.CrashBoundary.prototype.retry.call(instance)
  assert.equal(instance.state.error, null)
  // 让子组件这次不抛
  boom = false
  try {
    const tree = sandbox.CrashBoundary.prototype.render.call(instance)
    assert.equal(tree.props.className, 'dshpm-crashSlot', '重试后应回到透传壳')
    assert.equal(tree.props.key, 'gen1', 'generation 必须换（不复用崩掉的树）')
    const rendered = tree.children[0].type(tree.children[0].props)
    assert.equal(rendered.children[0], 'recovered content', '应当渲染出真实内容')
  } finally {
    boom = true
  }
})

check('恢复卡带 translate="no"（防浏览器整页翻译改写 React 文本节点）', () => {
  const inst = { props: { variant: 'panel', slot: 'main' }, state: { error: new Error('x'), generation: 0, copied: false } }
  const card = sandbox.CrashBoundary.prototype.render.call(inst)
  assert.equal(card.props.translate, 'no')
  assert.equal(card.props.lang, 'en')
})

check('恢复卡文案非空且来自 t()（zh/en 都不吃 key 本身）', () => {
  const inst = { props: { variant: 'panel', slot: 'main' }, state: { error: new Error('x'), generation: 0, copied: false } }
  const card = sandbox.CrashBoundary.prototype.render.call(inst)
  const title = card.children.find((c) => c && c.props && c.props.className === 'dshpm-crashTitle')
  assert.ok(title, '必须有标题节点')
  // el() 的 children 是数组（createElement(type, props, ...children)），取首个文本
  assert.equal(title.children[0], 'T', '标题应当来自 t("crash.title")')
  assert.notEqual(title.children[0], 'crash.title', '绝不能回退成 key 原文')
})

check('技术详情必须是可折叠的 <details>，且真的含错误消息与 componentStack', () => {
  const inst = { props: { variant: 'panel', slot: 'main' }, state: { error: new Error('detail-msg'), generation: 0, copied: false } }
  const card = sandbox.CrashBoundary.prototype.render.call(inst)
  const details = card.children.find((c) => c && c.type === 'details')
  // 换成 div 会让「折叠」语义消失（突变 M6 曾因此存活），所以断言的是标签本身。
  assert.ok(details, '技术详情必须是 <details>（可折叠），不能是别的标签')
  assert.ok(details.props.className.includes('dshpm-crashDetails'), 'details 必须带样式类')
  const summary = details.children.find((c) => c && c.type === 'summary')
  assert.ok(summary, 'details 必须有 <summary> 才能折叠')
  assert.equal(summary.children[0], 'D', 'summary 文案来自 t("crash.details")')
  const pre = details.children.find((c) => c && c.type === 'pre')
  assert.ok(pre, 'details 里必须有 <pre> 承载原始错误')
  assert.ok(String(pre.children[0]).includes('detail-msg'), 'pre 里必须真的有错误消息')
  assert.ok(String(pre.children[0]).includes('componentStack') || String(pre.children[0]).includes('at '),
    'pre 里必须带上 componentStack（否则用户报告只有一行消息，定位不了）')
})

check('恢复卡渲染出的来源标记取自 props.slot（不是写死的）', () => {
  // 突变 M8（wrapper 丢掉 variant/slot）只靠「注册行文本」断言是抓不到的，
  // 必须断言**渲染结果**里的标记跟着 slot 走。
  for (const slot of ['main', 'sidebar.footer.action']) {
    const inst = { props: { variant: 'panel', slot: slot }, state: { error: new Error('x'), generation: 0, copied: false } }
    const card = sandbox.CrashBoundary.prototype.render.call(inst)
    assert.equal(card.props['data-plugin-market-crashed'], slot, `崩溃标记必须等于 slot=${slot}`)
  }
  // variant 同理：raw props 决定紧凑与否，不能靠注册行猜。
  const entryCard = sandbox.CrashBoundary.prototype.render.call(
    { props: { variant: 'entry', slot: 'x' }, state: { error: new Error('x'), generation: 0, copied: false } },
  )
  assert.ok(entryCard.props.className.includes('dshpm-crash--compact'), 'variant=entry 必须渲染出紧凑类')
  const panelCard = sandbox.CrashBoundary.prototype.render.call(
    { props: { variant: 'panel', slot: 'x' }, state: { error: new Error('x'), generation: 0, copied: false } },
  )
  assert.equal(panelCard.props.className.includes('dshpm-crash--compact'), false, 'variant=panel 不该是紧凑类')
})

check('wrapper 把 variant/slot 真的透传给边界（否则来源标记与紧凑变体都丢）', () => {
  const seen = []
  const Probe = (props) => ({ __probe: props })
  // 用真 wrapper 渲染一次，检查它交给 CrashBoundary 的 props
  const guarded = sandbox.withCrashBoundary(Probe, 'entry', 'sidebar.footer.action')
  const tree = guarded({ wide: true })
  assert.equal(tree.type, sandbox.CrashBoundary, 'wrapper 外层必须是 CrashBoundary')
  assert.equal(tree.props.variant, 'entry', 'variant 必须透传')
  assert.equal(tree.props.slot, 'sidebar.footer.action', 'slot 必须透传')
  assert.ok(tree.children[0], '必须包住真实组件')
  assert.equal(tree.children[0].type, Probe, '包住的必须是传入的那个组件')
  seen.push(tree)
  assert.equal(seen.length, 1)
})

check('恢复卡有三个自纾按钮（重试 / 刷新 / 复制），panel 变体齐全', () => {
  const inst = { props: { variant: 'panel', slot: 'main' }, state: { error: new Error('x'), generation: 0, copied: false } }
  const card = sandbox.CrashBoundary.prototype.render.call(inst)
  const actions = card.children.find((c) => c && c.props && c.props.className === 'dshpm-crashActions')
  assert.ok(actions, '必须有按钮区')
  const kinds = actions.children.map((b) => b && b.props && b.props['data-crash-action']).filter(Boolean)
  assert.deepEqual(kinds, ['retry', 'reload', 'copy'], '三个按钮一个都不能少')
})

check('entry 变体是紧凑版：只留重试，不塞 details（侧栏 56px 窄条塞不下）', () => {
  const inst = { props: { variant: 'entry', slot: 'sidebar.footer.action' }, state: { error: new Error('x'), generation: 0, copied: false } }
  const card = sandbox.CrashBoundary.prototype.render.call(inst)
  assert.ok(card.props.className.includes('dshpm-crash--compact'), '必须带 --compact')
  const kinds = card.children.find((c) => c.props && c.props.className === 'dshpm-crashActions')
    .children.map((b) => b && b.props && b.props['data-crash-action']).filter(Boolean)
  assert.deepEqual(kinds, ['retry'], '紧凑版只留重试')
  assert.equal(card.children.some((c) => c && c.type === 'details'), false, '紧凑版不要 details')
})

check('重试把 error 清空并把子树换成新一代（不复用崩掉的树）', () => {
  const inst = {
    props: { variant: 'panel', slot: 'main' },
    state: { error: new Error('boom'), generation: 0, copied: true },
    setState: function (patch) { this.state = { ...this.state, ...patch(this.state, this.props) } },
  }
  sandbox.CrashBoundary.prototype.retry.call(inst)
  assert.equal(inst.state.error, null, '重试必须清空 error')
  assert.equal(inst.state.generation, 1, 'generation 必须自增，换掉子树 identity')
  assert.equal(inst.state.copied, false, '重试要顺带复位「已复制」提示')
})

check('未崩溃时原样渲染子组件（边界不能改变正常路径）', () => {
  const inst = { props: { variant: 'panel', slot: 'main', children: 'CHILD' }, state: { error: null, generation: 0 } }
  const tree = sandbox.CrashBoundary.prototype.render.call(inst)
  assert.equal(tree.props.className, 'dshpm-crashSlot', '未崩溃时是 display:contents 的透传壳')
  assert.deepEqual(tree.children, ['CHILD'], '子节点必须原样透传')
})

check('componentDidCatch 记录崩溃（含 componentStack），供导出/取证', () => {
  const inst = { props: { variant: 'panel', slot: 'main' }, state: {} }
  sandbox.CrashBoundary.prototype.componentDidCatch.call(
    inst, new Error('recorded'), { componentStack: 'at X\n  at Y' },
  )
  const rec = sandbox.lastCrash()
  assert.ok(rec, '必须记录崩溃')
  assert.equal(rec.message, 'recorded')
  assert.equal(rec.slot, 'main')
  assert.ok(rec.stack.includes('at Y'), 'componentStack 必须留着（打包压缩后 JS 栈指不出位置）')
})

// ── 2. 两个 slot 的注册都必须用包装后的组件 ──────────────────────────────
check('两个 slot 注册都用 withCrashBoundary 包装（否则宿主仍会 abdicate 永久留白）', () => {
  const mainLine = source.split('\n').find((l) => l.includes('ctx.slots.inject("main"'))
  const sidebarLine = source.split('\n').find((l) => l.includes('ctx.slots.inject("sidebar.footer.action"'))
  assert.ok(mainLine, '必须有 main 注册行')
  assert.ok(sidebarLine, '必须有 sidebar 注册行')
  assert.ok(mainLine.includes('withCrashBoundary('), 'main 必须被包装')
  assert.ok(sidebarLine.includes('withCrashBoundary('), 'sidebar 必须被包装')
  assert.ok(mainLine.includes('withCrashBoundary(MarketPage'), 'main 包的是 MarketPage')
  assert.ok(sidebarLine.includes('withCrashBoundary(MarketEntry'), 'sidebar 包的是 MarketEntry')
})

check('wrapper 在最外层补样式（崩在 ensureStyles 之前时恢复卡不能裸奔）', () => {
  const body = grab('function withCrashBoundary(')
  // 必须剥掉注释再断言：这段代码的注释里就写着「ensureStyles()」这个词（解释为什么要在
  // 最外层补），直接 includes('ensureStyles()') 会**匹配到注释**从而假绿——
  // 突变测试里「删掉真正的调用」这条就是这么存活下来的。只认语句位置的调用。
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(/ensureStyles\(\)\s*;/.test(code), 'wrapper 必须真的调用 ensureStyles()（不是只写在注释里）')
  const callIdx = code.indexOf('ensureStyles();')
  const returnIdx = code.indexOf('return el(CrashBoundary')
  assert.ok(callIdx >= 0 && returnIdx > callIdx, 'ensureStyles() 必须在 return 之前调用')
})

// ── 3. 恢复卡样式真的在 STYLES 里 ────────────────────────────────────────
check('恢复卡样式在 STYLES 中定义（宿主不会替我们画）', () => {
  for (const cls of ['.dshpm-crash ', '.dshpm-crashTitle', '.dshpm-crashHint', '.dshpm-crashActions', '.dshpm-crashPre', '.dshpm-crash--compact']) {
    assert.ok(source.includes(cls), `缺少样式：${cls}`)
  }
})

check('恢复卡样式用官方圆角 token（与市场其余卡片一致）', () => {
  const block = source.slice(source.indexOf('.dshpm-crash '), source.indexOf('.dshpm-crashDetails'))
  assert.ok(block.includes('var(--dsw-radius-lg,16px)'), '恢复卡用 16px 大圆角')
})

// ── 4. 文案 zh/en 对称：两边都有全部 crash.* key ─────────────────────────
check('crash.* 文案 zh/en 两边齐全（缺一个就会退回 key 原文）', () => {
  for (const key of ['crash.title', 'crash.hint', 'crash.retry', 'crash.reload', 'crash.copy', 'crash.copied', 'crash.details']) {
    // 只数字典项（`"key":` 形式）；调用点 t("key") 不算，否则计数必然多一次。
    const hits = source.split(`"${key}":`).length - 1
    assert.equal(hits, 2, `${key} 应恰好出现 2 次（zh+en 字典项），实际 ${hits}`)
  }
})

// ── 5. 关键：防御式取 React.Component，不能破坏加载期 ──────────────────
check('React.Component 防御式取：桩缺 Component 时 factory 仍不抛（加载期不许崩）', () => {
  assert.ok(source.includes('var ReactComponentBase = (React && typeof React.Component === "function") ? React.Component : function () {};'),
    '必须防御式取 React.Component 构造器本身')
  assert.equal(source.includes('Object.create(React.Component.prototype)'), false,
    '不得直接引用 React.Component.prototype（模块级求值，桩缺它就会加载期崩）')
})

const { exports } = materialize()
check('apply 在不给 slots/layout/locale 的空 ctx 上仍然不抛（降级路径）', () => {
  assert.doesNotThrow(() => exports.apply({ get() { return undefined }, effect: () => {}, on: () => {}, slots: undefined }))
})

check('带 slots 的 ctx 上两个 slot 都注册，且注册的是函数组件', () => {
  const entries = []
  const slots = {
    inject(key, factory) { factory() },
    register(options, component) { entries.push({ options, component }); return () => {} },
  }
  const ctx = {
    get: (n) => (n === 'slots' ? slots : undefined),
    effect: () => {}, on: () => {}, slots,
  }
  assert.doesNotThrow(() => exports.apply(ctx))
  assert.equal(entries.length, 2, '应注册两个 slot')
  for (const e of entries) assert.equal(typeof e.component, 'function', '注册的必须是组件函数')
  const keys = entries.map((e) => e.options.key || e.options.id).sort()
  assert.deepEqual(keys, ['plugin-market', 'plugin-market'])
})

console.log('')
if (failures.length > 0) {
  console.error(`崩溃恢复卡行为回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  for (const f of failures) console.error(`  ✗ ${f.name}\n      ${f.message}`)
  process.exit(1)
}
console.log(`崩溃恢复卡行为回归：${passed}/${passed} 全通过`)
