/**
 * 有界响应体读取回归（`plugin-market/lib/http-body.js`，审查任务 1 / P1）。
 *
 * 每条对应任务书「必须新增的测试」之一。核心不变式：
 *   1. 超限**在读取过程中被停住**——不是把巨量字节先吸进内存再判长度；
 *   2. Content-Length 只用于提前拒绝，**绝不被信任**（缺失/撒谎/chunked 都要靠计数兜底）；
 *   3. 超限 = 该源失败、进 attempts、继续下一个源；**绝不把超限正文当成空目录**；
 *   4. 所有源失败时旧缓存保留（stale），无缓存时是错误而不是 `plugins: []`。
 *
 * 用法：node verify/http-body.test.mjs
 */
import assert from 'node:assert/strict'
import { createCatalogCache, MAX_CATALOG_JSON_BYTES } from '../plugin-market/lib/catalog.js'
import { MAX_NPM_METADATA_BYTES } from '../plugin-market/lib/catalog-npm.js'
import { readBoundedBody, DEFAULT_MAX_BODY_BYTES } from '../plugin-market/lib/http-body.js'

let passed = 0
const failures = []
async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  ✗ ${name}\n      ${error.message}`)
  }
}
function check(name, fn) {
  return checkAsync(name, async () => fn())
}

const MiB = 1024 * 1024

/** 流式响应替身：记录被读取的次数与是否被取消，供「停在哪」的证据断言用。 */
function streamResponse(chunks, contentLength = null) {
  const state = { reads: 0, cancel: 0, bytesOut: 0 }
  const body = {
    getReader() {
      let index = 0
      return {
        async read() {
          if (state.cancel > 0 || index >= chunks.length) return { done: true }
          const raw = chunks[index++]
          const value = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))
          state.reads += 1
          state.bytesOut += value.length
          return { done: false, value }
        },
        async cancel() { state.cancel += 1 }
      }
    }
  }
  return {
    ok: true,
    status: 200,
    // 真实 undici Response 的 body 永远存在且可 cancel；实现先试 reader.cancel()
    // 再退回 body.cancel()，两个都要能被替身观测到。
    body: {
      getReader: body.getReader,
      async cancel() { state.cancel += 1 }
    },
    headers: {
      get(name) {
        if (String(name).toLowerCase() !== 'content-length') return null
        return contentLength === null ? null : String(contentLength)
      }
    },
    state
  }
}

/** 只实现 text()/arrayBuffer() 的替身（真实 Node fetch 不会这样，但既有测试替身是——走降级分支）。 */
function simpleResponse(text) {
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    text: async () => text,
    arrayBuffer: async () => new Uint8Array(Buffer.from(text))
  }
}

console.log('\n[1] Content-Length 预检：能拒在读取之前')

await check('Content-Length 超限 ⇒ 未读一个字节就拒绝，并取消正文', async () => {
  const response = streamResponse(['x'.repeat(10)], 5 * MiB)
  const out = await readBoundedBody(response, { maxBytes: MiB })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'too-large')
  assert.equal(response.state.reads, 0, '一个分片都不该被读取')
  assert.equal(response.state.cancel, 1, 'body 要被取消，不能晾着')
})

await check('Content-Length 缺失（chunked）不影响：正常小正文照读', async () => {
  const out = await readBoundedBody(streamResponse(['ab', 'cd'], null), { maxBytes: MiB })
  assert.equal(out.ok, true)
  assert.equal(out.value, 'abcd')
})

await check('非数字的 Content-Length（如 "5, 7"）被忽略，不抛错', async () => {
  const out = await readBoundedBody(streamResponse(['ok'], '5, 7'), { maxBytes: MiB })
  assert.equal(out.ok, true)
  assert.equal(out.value, 'ok')
})

console.log('\n[2] 流式计数：不信 Content-Length，只看实际读到的字节')

await check('无 Content-Length 的流超限 ⇒ **在读到上限附近就停**（不是吸完再判）', async () => {
  // 20 × 1 MiB，上限 16 MiB：若实现是「先吸完再判」，bytesOut 会是 20 MiB；
  // 真正的流式停住必须 ≤ 17 MiB（越限的那个分片读进来后立刻停）。
  const chunks = Array.from({ length: 20 }, () => Buffer.alloc(MiB, 0x61))
  const response = streamResponse(chunks, null)
  const out = await readBoundedBody(response, { maxBytes: 16 * MiB })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'too-large')
  assert.ok(response.state.bytesOut <= 17 * MiB, `实际消费了 ${Math.round(response.state.bytesOut / MiB)} MiB，超过「上限+1 分片」`)
  assert.equal(response.state.cancel, 1, '停止后必须取消剩余的流')
})

await check('Content-Length **撒谎**（声称 10 字节、实际 20 MiB）⇒ 仍然拒绝', async () => {
  // 这是任务书点名的场景：头声称很小，快速通过预检，全靠计数兜底。
  const chunks = Array.from({ length: 20 }, () => Buffer.alloc(MiB, 0x62))
  const response = streamResponse(chunks, 10)
  const out = await readBoundedBody(response, { maxBytes: 16 * MiB })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'too-large')
  assert.ok(response.state.reads < 20, `不该把 20 个分片都读完，实际读了 ${response.state.reads} 次`)
  assert.equal(response.state.cancel, 1)
})

console.log('\n[3] 正常载荷与模式')

await check('text 模式剥掉开头 UTF-8 BOM（与 response.text() 的规范行为一致）', async () => {
  // 这不是可有可无的糖：`response.text()` 按 fetch 规范会剥 BOM，而 `catalog.js` 的
  // URL 源直接 `JSON.parse(body)`。我把那条 text() 换成有界读取后若不剥 BOM，
  // 一个带 BOM 的 plugins.json 就会从"能用"变成"该源失败"——**我自己引入的回归**。
  // （REPORT.md:808 记的正是这个差异：npm 路要显式 trimStart，URL 路靠 fetch 剥掉。）
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  const body = Buffer.concat([bom, Buffer.from('{"count":0,"plugins":[]}', 'utf8')])
  const out = await readBoundedBody(streamResponse([body], body.length), { maxBytes: MiB, mode: 'text' })
  assert.equal(out.ok, true)
  assert.equal(out.value.charCodeAt(0), 0x7b, 'BOM 必须被剥掉，首个字符应是 {')
  assert.deepEqual(JSON.parse(out.value).plugins, [])
})

await check('bytes 模式**不动**字节（integrity 校验的是原始字节）', async () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  const body = Buffer.concat([bom, Buffer.from('x')])
  const out = await readBoundedBody(streamResponse([body], body.length), { maxBytes: MiB, mode: 'bytes' })
  assert.equal(out.ok, true)
  assert.deepEqual([...out.value], [...body], 'bytes 模式保留 BOM 原样')
})

await check('上限内的文本正文完整返回', async () => {
  const out = await readBoundedBody(streamResponse(['{"a"', ':1}'], null), { maxBytes: MiB, mode: 'text' })
  assert.equal(out.ok, true)
  assert.equal(out.value, '{"a":1}')
})

await check('bytes 模式返回 Buffer（不经过 UTF-8 解码）', async () => {
  const binary = Buffer.from([0x1f, 0x8b, 0xff, 0xfe]) // 故意放非 UTF-8 字节
  const out = await readBoundedBody(streamResponse([binary], 4), { maxBytes: MiB, mode: 'bytes' })
  assert.equal(out.ok, true)
  assert.ok(Buffer.isBuffer(out.value))
  assert.deepEqual([...out.value], [...binary])
})

console.log('\n[4] 降级分支（没有 .body 流的响应：既有的测试替身形状）')

await check('无流、text() 超限 ⇒ 仍拒绝（如实：分配防不住，只防接受）', async () => {
  const out = await readBoundedBody(simpleResponse('x'.repeat(32)), { maxBytes: 16, mode: 'text' })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'too-large')
})

await check('无流、小正文 ⇒ 正常通过（既有离线测试的替身形状不能被我改坏）', async () => {
  const out = await readBoundedBody(simpleResponse('{"ok":true}'), { maxBytes: 16, mode: 'text' })
  assert.equal(out.ok, true)
  assert.equal(out.value, '{"ok":true}')
})

await check('默认上限存在且可解释', () => {
  assert.ok(Number.isFinite(DEFAULT_MAX_BODY_BYTES) && DEFAULT_MAX_BODY_BYTES > 0)
  assert.equal(MAX_CATALOG_JSON_BYTES, 16 * MiB, '目录 16 MiB（真实 5.05 MiB，约 3 倍余量）')
  assert.equal(MAX_NPM_METADATA_BYTES, 2 * MiB, 'npm 元数据 2 MiB（真实约 23 KB）')
})

console.log('\n[5] 接进目录缓存：超限 = 该源失败并继续，绝不冒充空目录')

const VALID_CATALOG = JSON.stringify({ count: 2, plugins: [
  { name: 'a', owner: 'o', description: 'd', stars: 1, url: 'https://github.com/o/a' },
  { name: 'b', owner: 'o', description: 'd', stars: 1, url: 'https://github.com/o/b' }
]})

function urlSource(url) {
  return { kind: 'url', url, timeoutMs: 5000, label: url, short: url }
}

await check('首选源超限、备用源正常 ⇒ 整次读取成功（用了备用源）', async () => {
  let clock = 1000
  const huge = Array.from({ length: 18 }, () => Buffer.alloc(MiB, 0x63))
  const cache = createCatalogCache({
    now: () => clock,
    sources: [urlSource('https://s1.example/plugins.json'), urlSource('https://s2.example/plugins.json')],
    fetch: async (url) => (String(url).includes('s1') ? streamResponse(huge, null) : streamResponse([VALID_CATALOG], null))
  })
  const out = await cache.ensure()
  assert.equal(out.ok, true)
  assert.equal(out.cache.count, 2)
  assert.match(out.cache.source, /s2/, '应当记为备用源')
})

await check('所有源都超限且有缓存 ⇒ **保留旧缓存并标 stale**（不是空目录）', async () => {
  let clock = 1000
  const huge = Array.from({ length: 18 }, () => Buffer.alloc(MiB, 0x64))
  const cache = createCatalogCache({
    now: () => clock,
    sources: [urlSource('https://s1.example/plugins.json'), urlSource('https://s2.example/plugins.json')],
    fetch: async (url) => (cache.mode === 'fail' ? streamResponse(huge, null) : streamResponse([VALID_CATALOG], null))
  })
  const first = await cache.ensure()
  assert.equal(first.ok, true)
  // 换到「全部超限」并越过 TTL，强制重读。
  cache.mode = 'fail'
  clock += 11 * 60 * 1000
  const again = await cache.ensure()
  assert.equal(again.ok, true, '有旧缓存时失败不该让整页不可用')
  assert.equal(again.staleFallback, true)
  assert.equal(again.cache.count, 2, '旧缓存内容必须原样保留')
  assert.equal(again.cache.stale, true, '要如实标 stale')
})

await check('所有源都超限且**无**缓存 ⇒ 返回错误而不是 plugins: []', async () => {
  const huge = Array.from({ length: 18 }, () => Buffer.alloc(MiB, 0x65))
  const cache = createCatalogCache({
    sources: [urlSource('https://s1.example/plugins.json')],
    fetch: async () => streamResponse(huge, null)
  })
  const out = await cache.ensure()
  assert.equal(out.ok, false)
  assert.equal(out.code, 'catalog-unavailable')
  assert.match(out.hint, /上限/, `hint 里要能看出是超限，实际：${out.hint}`)
  assert.ok(Array.isArray(out.attempts) && out.attempts.length === 1, 'attempts 要逐源保留')
})

await check('带 BOM 的目录经 URL 源整条路可用（回归点：这条以前靠 response.text() 代劳）', async () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(VALID_CATALOG, 'utf8')])
  const cache = createCatalogCache({
    sources: [urlSource('https://bom.example/plugins.json')],
    fetch: async () => streamResponse([bom], bom.length)
  })
  const out = await cache.ensure()
  assert.equal(out.ok, true, `带 BOM 的目录必须仍可用：${JSON.stringify(out.hint ?? out)}`)
  assert.equal(out.cache.count, 2)
})

const total = passed + failures.length
console.log(`\n有界读取回归：${failures.length ? `${passed}/${total} 通过，失败：${failures.join('；')}` : `${total}/${total} 全通过`}`)
if (failures.length > 0) process.exit(1)
