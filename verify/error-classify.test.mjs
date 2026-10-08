/**
 * 错误归类的**行为**回归：直接取出真 bundle 里的识别函数并跑真实文本。
 *
 * 为什么不能只写源码形状断言：这一轮（以及上一轮）反复证明「正则匹配到了」≠「行为对」。
 * 我上一轮就干过一次——用 `setNotice(updater)` 的形状断言测「退场只清自己那条」，
 * 断言全绿，而实际气泡永远关不掉，最后是真实浏览器 e2e 抓到的。
 * 所以这里把函数**取出来执行**，用真实 pnpm 日志里的原文喂进去。
 *
 * 来源：用户报「我在插件市场装了俩个插件都没成功」。日志在他的 profile 下
 * （`.plugin-manager/logs/operation-xxx/pnpm.log`），下面这些样本是从那份日志里逐字抄的。
 *
 * 用法：node verify/error-classify.test.mjs
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

/** 从 bundle 源码里按函数名抠出一个函数的源码（括号配平，避免截断）。 */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start > 0, `bundle 里找不到 function ${name}(`)
  let depth = 0
  let i = source.indexOf('{', start)
  const bodyStart = i
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) break }
  }
  return source.slice(start, i + 1)
}

// 只依赖彼此，不依赖 t()/STRINGS（t 用桩），可以独立求值。
// registryUnreachableDetail 内部会调 fileLockedDetail（占用优先）**和**
// supplyChainDetail（策略优先），shortFailureText 又会调前三者+errorCopy，
// 所以**必须在同一个作用域**里求值——分开求值会让依赖在前者的闭包里变成未定义
// （我第一次就是这么写错的；v1.2.0 加 supplyChainDetail 时又踩了一次同样的坑，
//  被门禁抓出来：16/18 失败，报错全是 "supplyChainDetail is not defined"）。
const STRINGS_STUB = {
  zh: { 'err.file-locked.row': '文件被 DSH 占用，退出后重试', 'err.registry-unreachable.row': 'npm 源连不上，配镜像后重试', 'err.supply-chain.row': '被 24 小时发布冷静期拦下，见说明' },
  en: { 'err.file-locked.row': 'In use by DSH — quit and retry', 'err.registry-unreachable.row': 'npm registry unreachable — configure a mirror', 'err.supply-chain.row': 'Blocked by the 24-hour release cool-off — see details' }
}
const classifiers = new Function(
  't',
  `${extractFunction('fileLockedDetail')}
${extractFunction('supplyChainDetail')}
${extractFunction('registryUnreachableDetail')}
${extractFunction('shortFailureText')}
return { fileLockedDetail, supplyChainDetail, registryUnreachableDetail, shortFailureText }`
)((key) => STRINGS_STUB.zh[key] ?? key)
const { fileLockedDetail, supplyChainDetail, registryUnreachableDetail, shortFailureText } = classifiers

// ── 真实样本 ──
const REAL_NETWORK_DIAGNOSTIC = [
  'Progress: resolved 31, reused 1, downloaded 0, added 0',
  '[WARN] GET https://registry.npmjs.org/pvutils error (ECONNRESET). Will retry in 10 seconds. 2 retries left.',
  '[WARN] GET https://registry.npmjs.org/@peculiar%2Fasn1-ecc error (UND_ERR_SOCKET). Will retry in 10 seconds. 2 retries left.',
  '[WARN] Request took 72331ms: https://registry.npmjs.org/set-blocking',
  '[WARN] GET https://registry.npmjs.org/color-name/-/color-name-1.1.4.tgz error (UND_ERR_SOCKET). Will retry in 1 minute. 1 retries left.'
].join('\n')

const REAL_EPERM_DIAGNOSTIC = '[ERR_PNPM_EPERM] [importPackage C:\\Users\\x\\.dsh\\profiles\\desktop\\node_modules\\dsh-our-free-model] EPERM: operation not permitted, scandir'

console.log('\n[1] 连不上 npm 源：能认出来（用户报「装了俩个插件都没成功」的那条）')
check('真实 pnpm 网络日志（ECONNRESET / UND_ERR / Request took）命中', () => {
  assert.notEqual(registryUnreachableDetail({ code: 'operation-error', diagnostic: REAL_NETWORK_DIAGNOSTIC }), '')
})
check('只带 message 也要命中（诊断可能在 message 里）', () => {
  assert.notEqual(registryUnreachableDetail({ message: 'ECONNRESET' }), '')
})
check('命中时返回诊断原文（详情行要照原样显示）', () => {
  const hit = registryUnreachableDetail({ diagnostic: REAL_NETWORK_DIAGNOSTIC })
  assert.ok(hit.includes('ECONNRESET'), '应当原样带回诊断')
})
check('pnpm 的 fetch 错误码也命中（ERR_PNPM_FETCH*）', () => {
  assert.notEqual(registryUnreachableDetail({ diagnostic: 'ERR_PNPM_FETCH_404' }), '')
  assert.notEqual(registryUnreachableDetail({ diagnostic: 'ERR_PNPM_META_FETCH_FAIL' }), '')
})
check('ETIMEDOUT / ENOTFOUND / EAI_AGAIN / socket hang up 都命中', () => {
  for (const sig of ['ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'socket hang up']) {
    assert.notEqual(registryUnreachableDetail({ message: `x ${sig} y` }), '', `${sig} 应命中`)
  }
})

console.log('\n[2] 不能误伤：认错原因等于换一种撒谎')
check('文件占用（EPERM）**不**被网络判定抢走（它有自己的文案）', () => {
  assert.equal(registryUnreachableDetail({ code: 'operation-error', diagnostic: REAL_EPERM_DIAGNOSTIC }), '')
  assert.notEqual(fileLockedDetail({ diagnostic: REAL_EPERM_DIAGNOSTIC }), '', '占用判定要能认出它')
})
check('版本不兼容不命中（裸词 network/registry 会误伤，所以不许进匹配集）', () => {
  assert.equal(registryUnreachableDetail({ code: 'incompatible-version', message: 'This plugin requires DSH >= 0.2.0' }), '')
})
check('包名不存在不命中', () => {
  assert.equal(registryUnreachableDetail({ code: 'not-in-catalog', message: '目录里没有这个插件' }), '')
})
check('空/无参不炸（错误对象可能什么都没有）', () => {
  assert.equal(registryUnreachableDetail(undefined), '')
  assert.equal(registryUnreachableDetail(null), '')
  assert.equal(registryUnreachableDetail({}), '')
  assert.equal(fileLockedDetail(undefined), '')
})
check('文案里的中文「网络」二字**不**触发（只认具体错误签名）', () => {
  assert.equal(registryUnreachableDetail({ message: '网络不可达' }), '')
})
check('诊断里的 registry.npmjs.org 字样**本身不**足以命中（否则任何提到源的失败都会被改写）', () => {
  assert.equal(registryUnreachableDetail({ diagnostic: 'installing into registry.npmjs.org mirror config' }), '')
})

console.log('\n[3] 两个判定互斥（同一个错误不许同时是两种原因）')
check('占用诊断：占用命中、网络不命中', () => {
  const error = { diagnostic: REAL_EPERM_DIAGNOSTIC }
  assert.notEqual(fileLockedDetail(error), '')
  assert.equal(registryUnreachableDetail(error), '')
})
check('网络诊断：网络命中、占用不命中', () => {
  const error = { diagnostic: REAL_NETWORK_DIAGNOSTIC }
  assert.notEqual(registryUnreachableDetail(error), '')
  assert.equal(fileLockedDetail(error), '')
})

console.log('\n[4] 行内短句：两处调用点共用同一个函数，且每种原因给对应的一句话')
check('网络失败的行内短句指向「配镜像」，不是原样吐 pnpm 长文', () => {
  const text = shortFailureText({ code: 'operation-error', diagnostic: REAL_NETWORK_DIAGNOSTIC })
  assert.equal(text, 'npm 源连不上，配镜像后重试')
  assert.equal(text.includes('ECONNRESET'), false, '行内不该塞整段 pnpm 输出')
})
check('占用失败的行内短句仍指向「退出后重试」（不能被网络那条抢走）', () => {
  assert.equal(shortFailureText({ diagnostic: REAL_EPERM_DIAGNOSTIC }), '文件被 DSH 占用，退出后重试')
})
check('两种都认不出时回落宿主的 message（不吞掉信息）', () => {
  assert.equal(shortFailureText({ code: 'incompatible-version', message: '需要 DSH >= 0.2.0' }), '需要 DSH >= 0.2.0')
})
check('什么都没有时返回空串（调用方自己接兜底文案）', () => {
  assert.equal(shortFailureText(undefined), '')
  assert.equal(shortFailureText({}), '')
})

console.log('\n[5] 详情行要露出诊断原文（否则用户看到的是宿主的通用句）')
check('网络诊断进详情行：能直接看到 ECONNRESET / registry 主机', () => {
  // errorCopy 的 message 字段 = supply || locked || unreachable || message
  // （v1.2.0 起最前面多了供应链一档，它比网络更具体、必须优先）
  const src = source
  assert.match(src, /message: supply \|\| locked \|\| unreachable \|\| message/, 'errorCopy 的详情行必须带上网络诊断原文')
  const detail = registryUnreachableDetail({ diagnostic: REAL_NETWORK_DIAGNOSTIC })
  assert.ok(detail.includes('registry.npmjs.org'), '诊断原文里要有源站主机，用户才能判断是哪个源')
  assert.ok(detail.includes('Request took 72331ms'), '要保留 pnpm 的耗时信息')
})

console.log('')
if (failures.length > 0) {
  console.log(`错误归类行为回归：${passed}/${passed + failures.length} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  ✗ ${failure.name}: ${failure.message}`)
  process.exit(1)
}
console.log(`错误归类行为回归：${passed}/${passed} 全通过`)
