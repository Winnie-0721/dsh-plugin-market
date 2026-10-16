/**
 * 有界响应体读取（审查任务 1 / P1）。
 *
 * 为什么必须有：以前所有对外请求的 `response.text()` / `arrayBuffer()` 都没有字节上限——
 * 超时限制的是**时间**，不是**字节数**。远端源、第三方加速前缀、镜像或异常响应只要在
 * 超时前持续喂数据，就能把任意大小的正文一次性吸进宿主进程的内存（目录 JSON 与
 * 自更新 tarball 都走这条路）。gzip 解压上限只保护解压阶段，管不到压缩字节的下载。
 *
 * 三条不可妥协的语义：
 *  1. **Content-Length 只用于提前拒绝，绝不被信任**：正文可能没有这个头（chunked）、
 *     头值可能撒谎（声称 10 字节、实际 20 MiB）。所以**实际读取的字节数必须计数**，
 *     计数超限就停——这才是上限；预检只是让明显的坏源少读几个来回。
 *  2. **超限后取消剩余的流**：不 cancel 的话底层连接可能继续被推送数据、
 *     监听器继续挂到超时为止。
 *  3. **超限 = 该源失败**（kind:'too-large'），进 attempts、继续下一个源；
 *     绝不能把超限的（可能被截断的）正文当成空目录或有效数据。
 *
 * 降级分支（响应没有可读流，只有 text()/arrayBuffer()）：既有的离线测试替身就是这个
 * 形状。那条路**防不住分配**（读完才知道大小），这里如实接受"只防误用"并写进注释——
 * 真实宿主是 Node fetch，永远走流式主分支；不要为了过测试把主分支的语义稀释掉。
 */

/** 缺省上限：32 MiB——目前已知最宽的合法载荷（自更新 tarball，实测 0.18 MiB）的余量。 */
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024

function contentLengthOf(response) {
  try {
    const raw = response?.headers?.get?.('content-length')
    if (typeof raw !== 'string' || raw.trim() === '') return null
    const value = Number(raw.trim())
    // 非整数/负数/超安全整数/逗号多值 ⇒ 视作缺失（只用于预检，宁缺勿错）。
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

/**
 * 取消剩余的响应正文。
 *
 * 优先走 **reader.cancel()**：我们已经从流上取了 reader，取消要经过它才干净
 * （真实 ReadableStreamDefaultReader 与 body 上的 cancel 等价，但替身往往只实现
 * 其中一个——两个都试，取消失败绝不能改变「该源失败」的结论）。
 * 不取消的话底层连接可能继续被推送数据，监听器挂到超时为止。
 */
async function cancelQuietly(response, reader = null) {
  for (const target of [reader, response?.body]) {
    try {
      if (typeof target?.cancel === 'function') { await target.cancel(); return }
    } catch { /* 尽力而为 */ }
  }
}

/**
 * 读取响应正文，最多 maxBytes 字节。
 *
 * @param response - fetch Response（或测试替身）。
 * @param options.maxBytes - 字节上限（Number.isSafeInteger 之外一律取缺省值——
 *   一个 NaN/undefined 的上限绝不能变成"无上限"）。
 * @param options.mode - 'text'（缺省）返回字符串；'bytes' 返回 Buffer。
 * @returns `{ ok:true, value, bytes }` 或 `{ ok:false, kind:'too-large'|'read-failed', reason }`。
 *   `kind:'too-large'` 是给上层进 attempts 的语义标签：它是**该源的问题**，不是网络断。
 */
export async function readBoundedBody(response, options = {}) {
  const fallback = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES
  const maxBytes = Number.isSafeInteger(fallback) && fallback > 0 ? fallback : DEFAULT_MAX_BODY_BYTES
  const wantBytes = options.mode === 'bytes'

  // ① Content-Length 预检：只在它明确超限且可信时拒——撒谎的（声称小）逃得过这里，
  //    由下面的流式计数兜底。
  const declared = contentLengthOf(response)
  if (declared !== null && declared > maxBytes) {
    await cancelQuietly(response)
    return { ok: false, kind: 'too-large', reason: `响应声明 ${declared} 字节，超过上限 ${maxBytes} 字节` }
  }

  const reader = typeof response?.body?.getReader === 'function' ? response.body.getReader() : null
  if (reader !== null) {
    // ② 流式主分支：读一片计一片，超限**在读到上限附近就停**并 cancel 剩余部分。
    const chunks = []
    let total = 0
    for (;;) {
      let step
      try {
        step = await reader.read()
      } catch (error) {
        await cancelQuietly(response, reader)
        return { ok: false, kind: 'read-failed', reason: `读取响应体失败：${error?.message ?? error}` }
      }
      if (step.done === true) break
      const piece = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value)
      total += piece.length
      if (total > maxBytes) {
        await cancelQuietly(response, reader)
        return { ok: false, kind: 'too-large', reason: `响应体超过上限 ${maxBytes} 字节（读到第 ${total} 字节时停止）` }
      }
      chunks.push(piece)
    }
    const joined = Buffer.concat(chunks, total)
    return { ok: true, bytes: total, value: wantBytes ? joined : joined.toString('utf8') }
  }

  // ③ 降级分支（没有可读流的响应替身）：无法在分配前设限，只能拒收超限正文。
  try {
    if (wantBytes) {
      if (typeof response?.arrayBuffer !== 'function') return { ok: false, kind: 'read-failed', reason: '响应不支持二进制读取' }
      const raw = await response.arrayBuffer()
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
      if (bytes.length > maxBytes) {
        return { ok: false, kind: 'too-large', reason: `响应体 ${bytes.length} 字节，超过上限 ${maxBytes} 字节` }
      }
      return { ok: true, bytes: bytes.length, value: bytes }
    }
    if (typeof response?.text !== 'function') return { ok: false, kind: 'read-failed', reason: '响应不支持文本读取' }
    const text = await response.text()
    const size = Buffer.byteLength(text)
    if (size > maxBytes) {
      return { ok: false, kind: 'too-large', reason: `响应体 ${size} 字节，超过上限 ${maxBytes} 字节` }
    }
    return { ok: true, bytes: size, value: text }
  } catch (error) {
    return { ok: false, kind: 'read-failed', reason: `读取响应体失败：${error?.message ?? error}` }
  }
}
