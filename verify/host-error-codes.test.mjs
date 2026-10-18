/**
 * 宿主错误码的文案覆盖（门禁执行）。
 *
 * ## 错在哪（用户报「还是安装失败」）
 * 用户点安装，界面上只看到「宿主拒绝了这个操作。」——一句什么也没说的话。
 * 实测真宿主返回（POST /plugin-market/install，装一个已装过的 dsh-context）：
 *
 *   {"ok":false,"application":"failed",
 *    "error":{"code":"already-installed","message":"宿主拒绝了这个操作。"}}
 *
 * 也就是：**这个包已经装过了**，根本不是什么失败。但 `ERROR_PREFIXES` 里没有
 * `already-installed`，于是 errorCopy 走兜底分支，把宿主那句泛泛的 message 原样显示。
 *
 * ## 系统性缺口（从 app.asar 里枚举宿主管家真实会抛的 code）
 * 宿主 `dsh-plugin-manager` 会抛出 12 个 code：
 *
 *   already-installed      已经装过（**不是失败**）
 *   ambiguous-install      一个依赖装了多个 bundle，分不清是哪个
 *   bundle-in-use          这个 bundle 正被运行中的插件用着，不能动
 *   incompatible-version   与当前 DSH 版本不兼容
 *   invalid-spec           安装地址形状不合法
 *   management-required    由宿主基础设施管理
 *   not-bundle             包里没有 bundle 入口（不是 DSH 插件）
 *   not-removable          宿主说不可移除
 *   operation-error        宿主执行时的一般错误（pnpm 非 0 退出等）
 *   stale-approval         批准已过期（pnpm 这轮没写占位）
 *   stop-profile           需要先停止 profile
 *   unknown-plugin         宿主不认识这个插件
 *
 * 市场文案表（ERROR_PREFIXES）只有 4 个与之对应（install-failed / remove-failed /
 * toggle-failed / not-allowed + not-in-catalog），**其余全是通用句**。
 * 其中「已经装过」「版本不兼容」「地址不合法」「不是插件」「批准过期」这五个，
 * 用户完全能照做 —— 说清它们比说「操作失败」有用得多。
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

/** 抠出 errorCopy 及其依赖，真调用（t 桩返回带前缀的文案，便于判断选中了哪一段）。 */
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

const bundle = [
  grab('var ERROR_PREFIXES = {') + ';',
  grab('function fileLockedDetail('),
  grab('function supplyChainDetail('),
  grab('function registryUnreachableDetail('),
  grab('function shortFailureText('),
  grab('function errorCopy(')
].join('\n')
const built = new Function('t', `${bundle}\nreturn { errorCopy, ERROR_PREFIXES };`)
// t 桩：有专属文案就返回 "COPY:<key>"，没有就原样返回 key（这样能看出是否走了兜底）
const published = new Set()
for (const m of source.matchAll(/"err\.([a-z0-9-]+)\.title"/g)) published.add(m[1])
const api = built((key) => {
  // 三段（title/why/next）都判定一次：只判 title 的话，`next` 走兜底也测不出来
  // （第一版就是这么漏掉的——桩只识别 .title，于是 next 永远返回裸 key）。
  const m = /^err\.([a-z0-9-]+)\.(title|why|next)$/.exec(key)
  if (m && published.has(m[1])) return `COPY:${key}`
  return key
})

const HOST_CODES = [
  'already-installed', 'ambiguous-install', 'bundle-in-use', 'incompatible-version',
  'invalid-spec', 'management-required', 'not-bundle', 'not-removable',
  'operation-error', 'stale-approval', 'stop-profile', 'unknown-plugin'
]

console.log('\n[1] 宿主真实会抛的每个 code，都要有自己的三段式文案')

check('这 12 个 code 全部进 ERROR_PREFIXES（不走通用兜底）', () => {
  const missing = HOST_CODES.filter((code) => api.ERROR_PREFIXES[code] !== true)
  assert.deepEqual(missing, [], `这些宿主 code 没有专属文案：${missing.join(', ')}`)
})

check('每个 code 的 title / why / next 三段文案都在（中英各一套）', () => {
  for (const code of HOST_CODES) {
    for (const suffix of ['title', 'why', 'next']) {
      const zh = new RegExp(`"err\\.${code.replace(/-/g, '\\-')}\\.${suffix}":\\s*"[^"]+"`, 'g')
      const hits = [...source.matchAll(zh)].length
      assert.equal(hits, 2, `err.${code}.${suffix} 应当有**中英各一条**，实测 ${hits} 条`)
    }
  }
})

console.log('\n[2] errorCopy 真的会选中这些文案（不是只把键塞进表里）')

check('already-installed ⇒ 说的是「已经装过」，不是「操作失败」', () => {
  const copy = api.errorCopy({ code: 'already-installed', message: '宿主拒绝了这个操作。' })
  assert.match(String(copy.title), /COPY:err\.already-installed\.title/,
    '已经装过必须命中专属文案，不能把宿主那句泛泛的 message 顶上来')
  assert.match(String(copy.next), /COPY:err\.already-installed\.next/)
})

check('incompatible-version ⇒ 指明是版本不兼容', () => {
  const copy = api.errorCopy({ code: 'incompatible-version', message: '宿主拒绝了这个操作。' })
  assert.match(String(copy.title), /COPY:err\.incompatible-version\.title/)
})

check('invalid-spec ⇒ 指明安装地址形状不对', () => {
  const copy = api.errorCopy({ code: 'invalid-spec', message: '宿主拒绝了这个操作。' })
  assert.match(String(copy.title), /COPY:err\.invalid-spec\.title/)
})

check('not-bundle ⇒ 说明「这不是一个 DSH 插件包」', () => {
  const copy = api.errorCopy({ code: 'not-bundle', message: '宿主拒绝了这个操作。' })
  assert.match(String(copy.title), /COPY:err\.not-bundle\.title/)
})

check('stale-approval ⇒ 提示「再点一次」而不是「稍后重试」', () => {
  const copy = api.errorCopy({ code: 'stale-approval', message: '宿主拒绝了这个操作。' })
  assert.match(String(copy.title), /COPY:err\.stale-approval\.title/)
})

console.log('\n[2b] 「服务端说明」只在真的带来线索时才出现')

/** 复刻 ErrorLines 的判据（改成「有无技术线索」后才对）。正则必须与源码一致。 */
const SIGNAL = /[A-Z]{2,}_[A-Z_]{2,}|ERR_[A-Z_]+|:\s*\S|[\\/][\w.-]+|exit code|\d{2,}/i
function showsServerDetail(message) {
  const detail = String(message || '').trim()
  return Boolean(detail && SIGNAL.test(detail))
}

check('宿主的通用句不再被当成「服务端说明」重复一遍', () => {
  // 用户报「还是安装失败」时，三段式之外还挂着这句——刚说完「这不是失败，什么都没坏」，
  // 下一行又写「宿主拒绝了这个操作。」，自相矛盾且零信息。
  assert.equal(showsServerDetail('宿主拒绝了这个操作。'), false, '通用句没有线索，不该占一行')
  assert.equal(showsServerDetail('宿主执行这个操作时报错。'), false)
  assert.equal(showsServerDetail(''), false)
})

check('真的带有诊断线索时仍然要显示（不能一刀切砍掉）', () => {
  // 这些是用户唯一能拿去搜的东西，必须留着。
  assert.equal(showsServerDetail('EPERM: operation not permitted, scandir D:\\x'), true, '占用路径')
  assert.equal(showsServerDetail('GET https://registry.npmjs.org/x: ECONNRESET'), true, '网络错误码')
  assert.equal(showsServerDetail('ERR_PNPM_FETCH_404'), true, 'pnpm 错误码')
  assert.equal(showsServerDetail('Command failed with exit code 1'), true, '退出码（数字 2+ 位或 exit code）')
})

check('源码里的判据与测试复刻的是同一条正则', () => {
  // 防止测试自说自话：源码里的正则字面量必须与这里一致。
  const m = source.match(/var hasTechnicalSignal = (\/[^\n]+\/[a-z]*)/)
  assert.ok(m, '源码里要有 hasTechnicalSignal 正则')
  // 两边都编译一次，对同一组输入给出同样结论才算「同一条」。
  const srcRe = eval(m[1])
  for (const sample of ['宿主拒绝了这个操作。', '宿主执行这个操作时报错。', 'ERR_PNPM_FETCH_404', 'EPERM: x', 'exit code 1']) {
    assert.equal(srcRe.test(sample), SIGNAL.test(sample), `两边对「${sample}」的判断不一致`)
  }
})
check('不能退回「字符串不相等」那版判据', () => {
  const at = source.indexOf('function ErrorLines(')
  assert.ok(at > 0)
  // 只看**代码行**，不看注释（注释里刻意保留了两轮失败判据的记录）。
  const code = source.slice(at, at + 1800)
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
  assert.doesNotMatch(code, /copy\.message !== copy\.title/,
    '代码里不能再用「字符串不相等」判据（宿主通用句与 title 不相等，会漏进来）')
})

console.log('\n[3] 不能倒退：既有行为保持不变')

check('未知 code 仍然走兜底（不能因为加了表就把不认识的也说成成功）', () => {
  const copy = api.errorCopy({ code: 'some-future-code', message: '宿主说了一句新话。' })
  assert.ok(copy && typeof copy.title === 'string' && copy.title !== '', '未知码仍要有可用文案')
  assert.doesNotMatch(String(copy.title), /COPY:err\.some-future-code/,
    '未知码不该命中不存在的文案（否则运行时 t() 会返回空）')
})

check('operation-error 仍然优先用宿主诊断（既有行为，v1.2.0 修过）', () => {
  // 这条是既有断言，放这里是为了防止「给 operation-error 加文案」时把它覆盖掉。
  const copy = api.errorCopy({ code: 'operation-error', message: '宿主执行这个操作时报错。' })
  assert.ok(copy && copy.why, 'operation-error 的 why 必须仍有内容')
})

console.log('')
if (failures.length > 0) {
  console.log(`宿主错误码文案覆盖：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  process.exit(1)
}
console.log(`宿主错误码文案覆盖：${passed}/${passed + failures.length} 通过`)
