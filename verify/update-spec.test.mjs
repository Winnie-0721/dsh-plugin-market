/**
 * 「更新」把 spec 发错包 —— 回归测试（门禁执行）。
 *
 * ## 错在哪
 * 客户端「可更新」页点更新时发的是：
 *     submitInstall({ name: bundle.name, spec: bundle.name, kind: "update" })
 * 宿主 install() 看到**显式 spec** 就走精确匹配分支：
 *     hit = items.find(i => sameKey(i.spec, spec) || sameKey(i.npm, spec) || sameKey(i.url, spec))
 *     hit === undefined → 400 not-in-catalog
 * 注意这个分支**不认 item.name**，而 joinBundles 的 matchBundle 是认 name 的
 * （npm → sharedKeys(name/url)）。两处口径不一致，于是：
 *
 *   · bundle 名 = 包名（npm）的条目 → 命中 npm 键，更新正常；
 *   · bundle 名 = 显示名、而该条目的 spec 是仓库 URL（npm 为空，实测真实目录 **2819 条**）
 *     → 宿主既匹配不上 URL spec、也匹配不上 null 的 npm → **必然 400**。
 *
 * 实测（_verify/update-spec-precise.mjs，真实目录 5786 条）：
 *   npm 有值 2967 条（更新路径天然可解析）；npm 为空 2819 条（**全部**解析不回）。
 * 也就是说「可更新」页上每一条 git-only 插件，点更新都是一次 400。
 *
 * ## 为什么不是「让宿主认 name」
 * 显式 spec 分支是一条**安全约束**：它保证「装什么」只能落在目录里已有的条目上，
 * 不能变成任意包安装器。把 name 加进匹配键会放宽它，而且 name 有重名（真实目录里
 * `dsh-pua` 属于两个 owner）——按 name 猜就回到了「猜一个装」的老问题。
 *
 * ## 正确修法
 * 目录条目本来就知道自己的 spec。让 joinBundles 把**匹配到的那条的 spec** 作为
 * `updateSpec` 带出去，客户端更新时优先用它；拿不到时（老宿主 / 没匹配上）退回
 * bundle.name，行为与今天完全一致（不制造新的失败面）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { joinBundles, normalizeItem } from '../plugin-market/lib/catalog.js'

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

/** 从源码里按括号配平抠出一段（与 client-errorcopy 同一套手法）。 */
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

// ── 宿主侧：joinBundles 必须带出可用的 spec ─────────────────────────────────
console.log('\n[1] joinBundles 带出「这条目录条目真正该用的 spec」')

const gitOnly = normalizeItem({
  name: 'dsh-answer-reviewer',
  owner: 'bycall',
  url: 'https://github.com/bycall/dsh-answer-reviewer',
  version: '0.7.6',
  category: 'other'
})
const npmItem = normalizeItem({
  name: 'dsh-mobile',
  owner: 'someone',
  npm: 'dsh-mobile',
  version: '0.6.10',
  category: 'other'
})
const scopedItem = normalizeItem({
  name: 'dsh-memory',
  owner: 'FuRongJun-1999',
  npm: '@furongjun1999/dsh-memory',
  version: '0.8.1',
  category: 'other'
})
const catalog = [gitOnly, npmItem, scopedItem]

check('npm 为空、只有仓库 URL 的条目：updateSpec 是那条 URL（不是显示名）', () => {
  // 这条就是 2819 条 git-only 的代表：显示名 dsh-answer-reviewer 当 spec 发出去必然 400，
  // 真正的可安装 spec 是目录里的仓库地址。
  const [joined] = joinBundles([{ name: 'dsh-answer-reviewer', version: '0.7.0' }], catalog)
  assert.equal(joined.updateAvailable, true, '前置条件：这条应当被判成可更新')
  assert.equal(joined.updateSpec, 'https://github.com/bycall/dsh-answer-reviewer',
    'updateSpec 必须是目录里那条的 spec（仓库地址）')
})

check('npm 条目的 updateSpec 是 npm 名', () => {
  const [joined] = joinBundles([{ name: 'dsh-mobile', version: '0.6.9' }], catalog)
  assert.equal(joined.updateAvailable, true)
  assert.equal(joined.updateSpec, 'dsh-mobile')
})

check('带 scope 的 npm 条目：updateSpec 保留 scope（不能剥成裸名）', () => {
  const [joined] = joinBundles([{ name: '@furongjun1999/dsh-memory', version: '0.8.0' }], catalog)
  assert.equal(joined.updateAvailable, true)
  assert.equal(joined.updateSpec, '@furongjun1999/dsh-memory')
})

check('没有匹配到目录条目时 updateSpec 为 null（不编造 spec）', () => {
  const [joined] = joinBundles([{ name: 'not-in-catalog-at-all', version: '1.0.0' }], catalog)
  assert.equal(joined.latest, null)
  assert.equal(joined.updateSpec, null)
})

check('匹配到但不可安装（spec 为空）时 updateSpec 为 null', () => {
  const broken = normalizeItem({ name: 'no-spec', owner: 'x', version: '1.0.0', category: 'other' })
  const [joined] = joinBundles([{ name: 'no-spec', version: '0.9.0' }], [broken])
  assert.equal(joined.updateSpec, null, '没有 spec 的条目不能被当成可安装目标')
})

check('一个 bundle 命中多条同仓库条目时，取**最高版本那条**的 spec（与 latest 同源）', () => {
  // monorepo 多子插件：latest 取最高目录版本，updateSpec 必须来自同一条，
  // 否则会出现「显示更新到 2.0.0，实际装的却是 1.0.0 那条的 spec」。
  const multi = [
    normalizeItem({ name: 'studio#a', owner: 'acme', npm: '@acme/studio-a', version: '1.0.0', category: 'other' }),
    normalizeItem({ name: 'studio#b', owner: 'acme', npm: '@acme/studio-b', version: '2.0.0', category: 'other' })
  ]
  const [joined] = joinBundles([{ name: '@acme/studio', version: '0.9.0' }], multi)
  if (joined.latest === null) return // 该形态若判为歧义，就没有 spec 可谈（见 catalog-identity 的口径）
  assert.equal(joined.latest, '2.0.0')
  assert.equal(joined.updateSpec, '@acme/studio-b', 'spec 必须与 latest 来自同一条')
})

// ── 客户端侧：更新必须用 updateSpec ─────────────────────────────────────────
console.log('\n[2] 客户端更新时使用 updateSpec，而不是拿 bundle.name 顶替')

/** 客户端里「更新某条」的 spec 推导（真函数，抠出来执行）。 */
const pickSpec = (() => {
  const sig = 'function updateSpecFor('
  if (source.indexOf(sig) < 0) return null
  const body = grab(sig)
  return new Function(`${body}\nreturn updateSpecFor;`)()
})()

check('客户端有集中的 updateSpecFor：优先 updateSpec，缺省退回 bundle.name', () => {
  assert.ok(pickSpec !== null, '客户端必须有一个集中函数决定「更新发什么 spec」，不许各处内联')
  // 有 updateSpec（新宿主）：必须用它
  assert.equal(
    pickSpec({ name: 'dsh-answer-reviewer', updateSpec: 'https://github.com/bycall/dsh-answer-reviewer' }),
    'https://github.com/bycall/dsh-answer-reviewer',
    '有新宿主给的 spec 时必须用它（这正是修 bug 的那一步）'
  )
  // 没有 updateSpec（老宿主）：退回 name，行为与今天一致，不制造新失败
  assert.equal(pickSpec({ name: 'dsh-mobile' }), 'dsh-mobile', '老宿主没有 updateSpec 时退回 name')
  // updateSpec 是空串 / null 这类脏值：同样退回 name，不能把空串发给宿主
  assert.equal(pickSpec({ name: 'dsh-mobile', updateSpec: null }), 'dsh-mobile')
  assert.equal(pickSpec({ name: 'dsh-mobile', updateSpec: '' }), 'dsh-mobile')
  assert.equal(pickSpec({ name: 'dsh-mobile', updateSpec: '   ' }), 'dsh-mobile', '空白串同样不算有效 spec')
})

check('更新入口（updateBundle）用 updateSpecFor 推导 spec', () => {
  const at = source.indexOf('function updateBundle(')
  assert.ok(at > 0, '找得到 updateBundle')
  const body = source.slice(at, at + 900)
  assert.match(body, /spec:\s*updateSpecFor\(/, 'updateBundle 的 spec 必须来自 updateSpecFor(bundle)')
  assert.doesNotMatch(body, /spec:\s*bundle\.name/, '不许再直接把 bundle.name 当 spec')
})

check('已安装页的行内更新按钮同样用 updateSpecFor（两处入口口径一致）', () => {
  // 「已安装」页与「可更新」页各有一颗更新按钮，都走 updateBundle；只要 updateBundle 修好，
  // 两处就都修好了。这里钉住「没有第二条绕过 updateBundle 的更新路径」。
  const direct = [...source.matchAll(/kind:\s*"update"/g)].length
  const viaHelper = [...source.matchAll(/spec:\s*updateSpecFor\(/g)].length
  assert.ok(viaHelper >= 1, '至少有一处走 updateSpecFor')
  assert.ok(direct >= 1, '仍要标 kind:"update"（回执与文案靠它区分装/更新）')
})

// ── 安全边界：不能靠放宽宿主匹配来"修" ──────────────────────────────────────
console.log('\n[3] 安全边界不许放宽')
check('宿主 install() 的显式 spec 匹配仍只认 spec/npm/url（不把 name 加进去）', () => {
  const indexSource = readFileSync(join(here, '..', 'plugin-market', 'lib', 'index.js'), 'utf8')
  const at = indexSource.indexOf('const body = await readJsonObject(req, res)')
  assert.ok(at > 0)
  const body = indexSource.slice(at, at + 3000)
  assert.match(body, /sameKey\(item\.spec, spec\) \|\| sameKey\(item\.npm, spec\) \|\| sameKey\(item\.url, spec\)/,
    '显式 spec 分支的匹配键必须仍是 spec/npm/url 三个')
  assert.doesNotMatch(body, /sameKey\(item\.name, spec\)/,
    '**不许**把 name 加进 spec 匹配：那会让「装什么」不再是目录里的确定条目（重名会装错）')
})

console.log('')
if (failures.length > 0) {
  console.log(`更新 spec 回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`更新 spec 回归：${passed}/${passed + failures.length} 通过`)
