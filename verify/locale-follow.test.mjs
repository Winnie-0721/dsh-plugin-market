/**
 * 语言跟随官方 harness 的回归（门禁执行）。
 *
 * 为什么需要它：`wireLocale` 一直是从 `locale.getLocale()` 读 active、并订阅 locale 变化——
 * 这一层是对的。但把官方语言 id 收敛成「市场有字典的语言」时，旧实现是：
 *
 *     String(value).toLowerCase().indexOf("en") === 0 ? "en" : "zh"
 *
 * 也就是**非英语一律当中文**，无视官方 fallback 链。官方今天只发 zh/en，所以这个错误长期
 * 不可见；但官方 `addLanguage()` 明确允许第三方语言包（`LocaleDefinition.fallback`，契约要求
 * 链必须终止于 en）。一旦 harness 的语言是 ja（fallback=en），官方自己会显示英文，
 * 而市场会硬显示中文——**同一屏两种语言**。
 *
 * 做法与 client-errorcopy.test.mjs 相同：把真实函数抠出来真调，而不是断言源码形状。
 * 用法：node verify/locale-follow.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'plugin-market', 'lib', 'client.js'), 'utf8')

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

/** 从源码里按括号配平抠出一段函数。 */
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

// normalizeLocale 依赖 localeBase / shippedLocale，以及模块级的 LOCALE_DEFINITIONS
// ——它必须一起抠进来，否则抠出来的函数引用未定义变量（第一版就是这么红的）。
const bundle = [
  'var LOCALE_DEFINITIONS = null;',
  grab('function localeBase('),
  grab('function shippedLocale('),
  grab('function normalizeLocale('),
].join('\n')
const api = new Function(`${bundle}\nreturn { normalizeLocale, localeBase, shippedLocale };`)()
assert.equal(typeof api.normalizeLocale, 'function', '前置条件：必须抠到真实的 normalizeLocale')
// 反向自检：抠出来的函数里若还引用别的模块级变量，这里必须当场暴露，而不是等某条用例假红。
assert.equal(
  /\bLOCALE_DEFINITIONS\b/.test(bundle) && !/var LOCALE_DEFINITIONS/.test(bundle),
  false,
  'LOCALE_DEFINITIONS 必须随函数一起抠进来',
)

/** 官方今天实际发出的语言定义。 */
const SHIPPED = [{ id: 'en' }, { id: 'zh', fallback: 'en' }]

console.log('\n[1] 直接命中：harness 的 active 就是市场有字典的语言')
check('active=en → en', () => {
  assert.equal(api.normalizeLocale('en', SHIPPED), 'en')
})
check('active=zh → zh', () => {
  assert.equal(api.normalizeLocale('zh', SHIPPED), 'zh')
})
check('带地区的变体 zh-Hans-CN 仍命中 zh（官方契约允许 BCP 47 标签）', () => {
  assert.equal(api.normalizeLocale('zh-Hans-CN', SHIPPED), 'zh')
  assert.equal(api.normalizeLocale('en-US', SHIPPED), 'en')
  assert.equal(api.localeBase('zh-Hans-CN'), 'zh', '主子标签要取对')
  assert.equal(api.localeBase('en_US'), 'en', '下划线形式也要认')
})

console.log('\n[2] 沿官方 fallback 链下探（旧实现：非英语一律当中文）')
check('第三方语言包 ja(fallback=en) → en，不是 zh', () => {
  // 这是本测试存在的理由：旧实现给 "zh"，与官方自己显示的英文不一致。
  assert.equal(
    api.normalizeLocale('ja', [{ id: 'en' }, { id: 'zh', fallback: 'en' }, { id: 'ja', fallback: 'en' }]),
    'en',
    'ja 声明的 fallback 是 en，必须跟到 en',
  )
})
check('多跳链 ja → zh → en 在第二跳命中 zh', () => {
  assert.equal(
    api.normalizeLocale('ja', [{ id: 'en' }, { id: 'zh', fallback: 'en' }, { id: 'ja', fallback: 'zh' }]),
    'zh',
    '链上第一个我们有字典的语言赢',
  )
})
check('语言定义缺席时不崩，且不凭空当中文', () => {
  assert.equal(api.normalizeLocale('ja', undefined), 'en', '拿不到定义就落到官方契约的链尾 en')
  assert.equal(api.normalizeLocale('ja', []), 'en')
  assert.equal(api.normalizeLocale('', SHIPPED), 'en')
  assert.equal(api.normalizeLocale(undefined, SHIPPED), 'en')
})
check('环状 fallback 定义不会把下探挂住（外部数据，需要上限）', () => {
  const cyclic = [{ id: 'en' }, { id: 'aa', fallback: 'bb' }, { id: 'bb', fallback: 'aa' }]
  assert.equal(api.normalizeLocale('aa', cyclic), 'en', '环链必须终止，落到 en')
})

console.log('\n[3] wireLocale 真的把官方快照的定义读进来（跟随 harness 的接线）')
check('wireLocale 从 snapshot.locales 取定义、并订阅变化', () => {
  // 断言源码形状在这里是合理的：要验证的是「有没有把 locales 传给收敛函数」这条接线，
  // 真正的取值行为由上面 [1][2] 覆盖。
  assert.match(source, /function wireLocale\(locale\)/, '要有 wireLocale')
  assert.match(source, /snapshot\.locales/, '要读官方快照里的语言定义')
  assert.match(source, /if \(snapshot && Array\.isArray\(snapshot\.locales\)\) LOCALE_DEFINITIONS = snapshot\.locales/,
    '要把官方定义存下来，fallback 链才有依据')
  assert.match(source, /locale\.subscribe\(/, '要订阅官方 locale 变化（切语言时市场跟着走）')
  assert.match(source, /setActiveLocale\(readSnapshot\(\)\)/, '订阅回调要重读官方 active 并带上定义')
  // 反向：不许再有「非英语一律中文」那种无视 fallback 的收敛。
  assert.equal(
    /indexOf\("en"\) === 0 \? "en" : "zh"/.test(source),
    false,
    '不得再出现旧的「非英语一律中文」收敛',
  )
})
check('detectLocale 只是 harness 服务缺席时的降级，不是主来源', () => {
  assert.match(source, /if \(!initial\) initial = detectLocale\(\)/, 'detectLocale 只能在读不到官方 locale 时兜底')
})

console.log('')
if (failures.length > 0) {
  console.log(`语言跟随回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`语言跟随回归：${passed}/${passed} 全通过`)
}
