/**
 * 「点了必然失败的开关」——回归测试（门禁执行）。
 *
 * ## 错在哪
 * `installedCapabilities` 里两条判据不同源：
 *
 *     toggle: !locked                              // 只看 readOnlyReason / 全局只读
 *     remove: !locked && !marketSelf && !notRemovable   // 还看 removable
 *
 * 于是 `removable === false` 且 `readOnlyReason` 为空（或查不到文案）的包：
 *   · 卸载按钮**不渲染**（对）；
 *   · 开关**照常渲染且可点**（错）——点下去宿主回 `400 not-allowed`，
 *     界面上弹出「这个操作被宿主拒绝」。
 *
 * ## 实测规模（真宿主 /plugin-market/installed，desktop profile，30 个 bundle）
 *   removable=false 共 **22** 条，其中 readOnlyReason 非空的只有 **3** 条
 *   （@deepseek-ai/dsh-base / dsh-web-app / dsh-sdk-minimal 都是 management-required）。
 *   剩下 **19** 条（@deepseek-ai/dsh-headless、dsh-sdk-app、dsh-subagent-codex、
 *   dsh-acp-app、dsh-experimental-* …）就是「开关点得动但必然被拒」的那一类。
 *
 * ## 为什么 notRemovable 就该锁住 toggle
 * 宿主侧 `selectBundle(name, enabled)` 的判据是：
 *     if (!enabled && previous.includes(name)) { if (this.protectsManager(name)) throw ManagementFailure("management-required") }
 *     // 启用方向：bundleManifest 取不到就 throw ManagementFailure("not-bundle")
 * 也就是说，宿主对「不在 profile 的 dsh.profile.bundles 里」的包（官方 bundle 由 base 间接
 * 引入，名字根本不在列表里）**两个方向都没有可写目标**：禁用方向 previous.includes 为 false
 * 会静默跳过、启用方向取不到 manifest 抛 not-bundle。宿主自己用 `removable:false` 表达了
 * 「这个包不归 profile 管」，市场不该把它渲染成一个可点的控件再让它失败。
 *
 * ## 与既有约定的关系（不能破坏的那条）
 * v1.2.0 定的约定是「**readOnlyReason 查不到文案时不要凭空锁住**」——因为文案缺失只是
 * i18n 缺键，不代表宿主没给理由。这条仍然成立：`locked` 的判据**不动**。
 * 这里补的是另一条**独立事实**：`removable === false` 是宿主直接给出的布尔值，
 * 不依赖任何文案。两者互补，不是替代。
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

/** 按括号配平抠出一段（与 client-errorcopy / update-spec 同一套手法）。 */
function grab(signature) {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`抠不到：${signature}`)
  let depth = 0
  for (let j = source.indexOf('{', start); j < source.length; j += 1) {
    if (source[j] === '{') depth += 1
    else if (source[j] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, j + 1)
    }
  }
  throw new Error(`括号不配平：${signature}`)
}

// 真函数抠出来执行：t 用桩，把 key 原样返回（这样「查不到文案」的分支可复现）。
const installedCapabilities = new Function(
  't',
  `${grab('function installedCapabilities(')}\nreturn installedCapabilities;`,
)((key) => key)

// 桩 t 返回 key 本身 ⇒ hostReason === reasonKey ⇒ 被判定成「查不到文案」⇒ 不 locked。
// 这正是真实目录里那 19 条包的处境（readOnlyReason 为空）。
const noTranslation = (bundle, readOnly) => installedCapabilities(bundle, readOnly)

console.log('\n[1] 不可移除的包不得渲染「点了必然被拒」的开关')

check('removable:false + 无 readOnlyReason：toggle 与 remove 都必须关掉', () => {
  // 这就是 @deepseek-ai/dsh-headless 那一类（实测 19 条）。
  const caps = noTranslation({ name: '@deepseek-ai/dsh-headless', removable: false, readOnlyReason: null })
  assert.equal(caps.remove, false, '卸载本来就不渲染（既有行为，不能回退）')
  assert.equal(caps.toggle, false, '**开关也必须关掉**：宿主对这类包两个方向都写不进去，点它只会弹 not-allowed')
})

check('removable:true 的普通包仍然可以开关（修复不能误伤）', () => {
  const caps = noTranslation({ name: 'dsh-context', removable: true, enabled: true, readOnlyReason: null })
  assert.equal(caps.toggle, true, '普通包的开关必须保留')
  assert.equal(caps.remove, true, '普通包的卸载必须保留')
})

check('readOnlyReason 有文案时仍然锁住（既有约定不能回退）', () => {
  // 用真翻译桩：t 返回带前缀的文案，模拟「文案存在」。
  const withCopy = new Function(
    't',
    `${grab('function installedCapabilities(')}\nreturn installedCapabilities;`,
  )((key) => (key === 'readonlyReason.management-required' ? '宿主基础设施托管' : key))
  const caps = withCopy({ name: '@deepseek-ai/dsh-base', removable: false, readOnlyReason: 'management-required' })
  assert.equal(caps.locked, true, '有文案时 locked 仍为 true')
  assert.equal(caps.toggle, false)
  assert.equal(caps.remove, false)
  assert.equal(caps.hostReason, '宿主基础设施托管', '行内仍要显示宿主给的原因')
})

check('**查不到文案时不凭空锁住**（v1.2.0 约定仍然成立，不能被这次修复推翻）', () => {
  // 关键区分：readOnlyReason 存在但**翻译缺失**时，不该仅凭它锁住控件。
  // 用 removable:true 隔离掉「不可移除」这条新判据，单看 locked 的行为。
  const caps = noTranslation({ name: 'some-plugin', removable: true, readOnlyReason: 'brand-new-reason' })
  assert.equal(caps.locked, false, '翻译缺失不等于宿主没给理由，locked 不得为 true')
  assert.equal(caps.toggle, true, '这类包仍然可以开关')
  assert.equal(caps.remove, true)
})

check('市场自己那一行：卸载仍不渲染（既有行为）', () => {
  const caps = noTranslation({ name: 'deepseek-harness-market', removable: true, market: true })
  assert.equal(caps.remove, false, '市场不能卸载自己')
  assert.equal(caps.toggle, true, '但市场可以被停用')
})

check('全局只读时一切都不渲染（readOnly 参数仍最高优先）', () => {
  const caps = noTranslation({ name: 'dsh-context', removable: true }, true)
  assert.equal(caps.toggle, false)
  assert.equal(caps.remove, false)
})

check('行内说明：不可移除但没被锁住时，要说明「不能卸载」的原因', () => {
  const caps = noTranslation({ name: '@deepseek-ai/dsh-headless', removable: false })
  // 修好之后这类包的开关也没了，所以它该像「市场自己」那样给一行原因，
  // 而不是留一张只有文字、没有任何控件、也没解释的卡片。
  assert.ok(
    caps.notes.includes('installed.notRemovable') || caps.notes.length > 0,
    '不可移除的包必须有一行原因说明，不能只是「按钮都没了」',
  )
})

console.log('\n[2] 整卡隐藏：不可操作的包从列表里消失（用户选定的口径）')

/** shouldHideInstalledCard 依赖 installedCapabilities，一起抠出来。 */
const shouldHide = new Function(
  't',
  `${grab('function installedCapabilities(')}\n${grab('function shouldHideInstalledCard(')}\nreturn shouldHideInstalledCard;`,
)((key) => key)

check('removable:false 且无 readOnlyReason 的包：整卡隐藏', () => {
  // 用户明确要求「做不到的动作就整卡藏掉，别留一个点不动的按钮」。
  // 修 toggle 之前这类包是「开关还在、点了报错」，修完变成整卡隐藏——这是**预期**的连带效果。
  assert.equal(
    shouldHide({ name: '@deepseek-ai/dsh-headless', removable: false, readOnlyReason: null }, false),
    true,
    '既不能开关也不能卸载 ⇒ 整卡隐藏',
  )
})

check('普通包不隐藏（反向对照：不能把可操作的也藏掉）', () => {
  assert.equal(shouldHide({ name: 'dsh-context', removable: true }, false), false)
})

check('市场自己那一行不隐藏（它能被停用，卡片必须留着）', () => {
  assert.equal(shouldHide({ name: 'deepseek-harness-market', removable: true, market: true }, false), false)
})

check('全局只读时**不隐藏**（豁免：那时页面唯一价值就是这份清单）', () => {
  // 这条是既有设计（见 shouldHideInstalledCard 的注释）：只读时藏空整页等于把仅剩的信息扔掉。
  assert.equal(
    shouldHide({ name: '@deepseek-ai/dsh-headless', removable: false }, true),
    false,
    '只读态下不可操作的卡片仍然渲染',
  )
})

console.log('')
if (failures.length > 0) {
  console.log(`不可操作控件回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`不可操作控件回归：${passed}/${passed + failures.length} 通过`)
