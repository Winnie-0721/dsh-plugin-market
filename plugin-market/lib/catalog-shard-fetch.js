/**
 * 从**分片目录**（format 2）组装出和单片 `plugins.json` 完全等价的 raw 对象。
 *
 * 为什么要单独一个模块：分片把「一次 GET」变成「1 + N 次 GET + 校验 + 拼装」，
 * 里面全是**失败模式**（清单不通、某一拍挂掉、分片哈希不对、清单与分片打架）。
 * 这些失败必须能一条条测（不起服务、不联网），所以只依赖注入的 fetch。
 *
 * 设计上的三条硬决定：
 *
 *  1. **全有或全无**。任何一片失败 = 整个分片源失败，**不返回「部分目录」**。
 *     少两个分类的目录看起来只是「插件变少了」，而它会以 `stale:false` 覆盖掉好缓存
 *     ——这与 v1.2.0 那条「超限不能冒充空目录」是同一条原则，只是规模变大。
 *
 *  2. **并发有界**。24 片并发打同一个镜像会被限流/拖慢，1 片串行又慢。
 *     取 `SHARD_CONCURRENCY = 6`：实测 24 片、每片 2 MiB 的服务，6 并发的实际墙钟
 *     与「全并发」几乎一样（瓶颈是带宽），但峰值连接数与内存都低一个量级。
 *
 *  3. **失败要能定位到片**。`attempts` 里每条都带分片名与原因，
 *     文案才能说「差的是 ui.1」，而不是「目录源挂了」。
 */

import { Buffer } from 'node:buffer'

import {
  SHARD_DIR,
  SHARD_FORMAT,
  SHARD_MANIFEST_NAME,
  shardPath,
  validateManifest,
  validateShard
} from './catalog-shard.js'
import { readBoundedBody } from './http-body.js'

/** 清单不可能大：真实 24 片是 5.7 KB。32 KiB 足够，且小到不会成为攻击面。 */
export const MAX_MANIFEST_BYTES = 32 * 1024

/** 并发拉片的数量上限（见模块注释第 2 条）。 */
export const SHARD_CONCURRENCY = 6

/** 单片超时：比整目录的 30s 短——一片拉不动就该尽快判失败，而不是拖住整个刷新。 */
export const SHARD_TIMEOUT_MS = 20_000

function shortError(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 120 ? `${message.slice(0, 120)}…` : message
}

function classifyFetchError(error, timeoutMs) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const timedOut =
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  return timedOut
    ? { ok: false, kind: 'timeout', reason: `超时（${Math.round(timeoutMs / 1000)}s）` }
    : { ok: false, kind: 'network', reason: `请求失败：${shortError(error)}` }
}

/** 把清单 URL 解析成 `{ baseUrl, manifestUrl }`；清单必须是显式文件名。 */
export function resolveShardBase(manifestUrl) {
  const url = new URL(String(manifestUrl))
  // base 是清单所在**目录**：清单固定叫 catalog.json，分片在它下面的 shards/。
  url.pathname = url.pathname.replace(/\/[^/]*$/, '/')
  const base = url.toString()
  return { baseUrl: base, manifestUrl: new URL(SHARD_MANIFEST_NAME, base).toString() }
}

/**
 * 拉一份分片目录并组装。
 *
 * @param options.fetch - fetch 实现（必填，缺省 globalThis.fetch）
 * @param options.manifestUrl - 清单地址
 * @param options.maxShardBytes - 单片字节上限（缺省 8 MiB，与发布端硬上限一致）
 * @param options.concurrency - 并发数
 * @param options.timeoutMs - 单片超时
 * @param options.label - 诊断用源名
 * @returns `{ ok:true, raw, label, shards }` 或 `{ ok:false, kind, reason, label }`
 *   `raw` 与单片 `plugins.json` 同形（`{ name, url, updated, count, categories, plugins }`），
 *   所以**下游一行都不用改**——这是「分片是传输层优化，不是格式变更」的具体体现。
 */
export async function readCatalogFromShards(options = {}) {
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch
  const label = typeof options.label === 'string' && options.label !== '' ? options.label : 'shards'
  if (typeof fetchImpl !== 'function') {
    return { ok: false, kind: 'network', reason: '当前运行环境没有 fetch', label }
  }
  if (typeof options.manifestUrl !== 'string' || options.manifestUrl === '') {
    return { ok: false, kind: 'bad-manifest', reason: '没有给出清单地址', label }
  }

  let baseUrl
  let manifestUrl
  try {
    ({ baseUrl, manifestUrl } = resolveShardBase(options.manifestUrl))
  } catch {
    return { ok: false, kind: 'bad-manifest', reason: '清单地址不是合法 URL', label }
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : SHARD_TIMEOUT_MS
  const maxShardBytes = Number.isFinite(options.maxShardBytes) && options.maxShardBytes > 0
    ? options.maxShardBytes
    : 8 * 1024 * 1024
  const concurrency = Number.isSafeInteger(options.concurrency) && options.concurrency > 0
    ? options.concurrency
    : SHARD_CONCURRENCY

  // ── ① 清单 ────────────────────────────────────────────────────────────
  let manifestText
  try {
    const response = await fetchImpl(manifestUrl, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (response === null || response === undefined || typeof response.ok !== 'boolean') {
      return { ok: false, kind: 'network', reason: '清单响应无法识别', label }
    }
    if (response.ok !== true) {
      // 404 = 这个源还没有分片（上游还没跑发布脚本），交给上层降级到单片源。
      const kind = response.status === 404 ? 'no-manifest' : (response.status >= 500 ? 'http' : 'http-4xx')
      return { ok: false, kind, reason: `清单 HTTP ${response.status}`, label }
    }
    const read = await readBoundedBody(response, { maxBytes: MAX_MANIFEST_BYTES })
    if (read.ok !== true) {
      return { ok: false, kind: read.kind, reason: `清单：${read.reason}`, label }
    }
    manifestText = read.value
  } catch (error) {
    return { ...classifyFetchError(error, timeoutMs), reason: `清单：${shortError(error)}`, label }
  }

  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    return { ok: false, kind: 'not-json', reason: '清单不是合法 JSON', label }
  }
  const manifestVerdict = validateManifest(manifest, { maxShards: options.maxShards })
  if (manifestVerdict.ok !== true) {
    return { ok: false, kind: 'bad-manifest', reason: manifestVerdict.message, label }
  }

  // ── ② 分片（有界并发，全有或全无）──────────────────────────────────────
  const outcomes = new Array(manifest.shards.length)
  let next = 0
  let aborted = null

  async function worker() {
    for (;;) {
      if (aborted !== null) return
      const index = next
      next += 1
      if (index >= manifest.shards.length) return
      const entry = manifest.shards[index]
      const name = `${entry.id}.${entry.part}`
      // shardPath 已经带 `shards/` 前缀，且**只有它**能拼路径（id/part 已过白名单校验）。
      const url = new URL(shardPath(entry.id, entry.part), baseUrl).toString()
      let bytes
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'follow',
          credentials: 'omit',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs)
        })
        if (response === null || response === undefined || typeof response.ok !== 'boolean') {
          outcomes[index] = { ok: false, kind: 'network', name, reason: '响应无法识别' }
          aborted = outcomes[index]
          return
        }
        if (response.ok !== true) {
          outcomes[index] = { ok: false, kind: 'http', name, reason: `HTTP ${response.status}` }
          aborted = outcomes[index]
          return
        }
        const read = await readBoundedBody(response, { mode: 'bytes', maxBytes: maxShardBytes })
        if (read.ok !== true) {
          const kind = read.kind === 'too-large' ? 'too-large' : 'network'
          outcomes[index] = { ok: false, kind, name, reason: read.reason }
          aborted = outcomes[index]
          return
        }
        bytes = read.value
      } catch (error) {
        outcomes[index] = { ...classifyFetchError(error, timeoutMs), name }
        aborted = outcomes[index]
        return
      }
      const verdict = validateShard(bytes, entry)
      if (verdict.ok !== true) {
        outcomes[index] = { ok: false, kind: verdict.code, name, reason: verdict.message }
        aborted = outcomes[index]
        return
      }
      outcomes[index] = { ok: true, name, plugins: verdict.plugins }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, manifest.shards.length) }, worker))

  // **唯一**的失败判定：任何一片没成功（含「因 aborted 提前退出而留空」的 undefined）
  // 就是整体失败。这一道同时覆盖「HTTP 失败」「校验失败」「被取消后压根没取到」三种，
  // 所以**不要**再加一条只看 `aborted` 的短路——两条并列判断看起来更明确，实测却是
  // 让其中一条成为永远不会被独立观测到的死代码（变异测试：拿掉 aborted 那段，测试全绿）。
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index]
    if (outcome !== undefined && outcome.ok === true) continue
    const entry = manifest.shards[index]
    const name = outcome?.name ?? `${entry.id}.${entry.part}`
    return {
      ok: false,
      kind: outcome?.kind ?? 'shard-missing',
      reason: `分片 ${name}：${outcome?.reason ?? '没有取到（同批已有一片失败，取消了剩余请求）'}`,
      label
    }
  }

  // ── ③ 拼装（顺序 = 清单顺序，保证同一份数据每次组出同一个数组）──────────
  const plugins = []
  for (const outcome of outcomes) {
    for (const item of outcome.plugins) plugins.push(item)
  }

  // 最后一道：条数必须与清单一致。前面每片都核过 count，这里核**总和**——
  // 两者都对得上才说明「清单说的目录」与「取到的目录」是同一份。
  if (plugins.length !== manifest.count) {
    return {
      ok: false,
      kind: 'shard-mismatch',
      reason: `组装出 ${plugins.length} 条，清单说 ${manifest.count} 条`,
      label
    }
  }

  return {
    ok: true,
    label,
    shards: manifest.shards.length,
    // 与单片 plugins.json 同形：下游 normalizeCatalog 一行都不用改。
    raw: {
      name: typeof manifest.name === 'string' ? manifest.name : undefined,
      url: typeof manifest.source === 'string' ? manifest.source : undefined,
      updated: typeof manifest.updated === 'string' ? manifest.updated : undefined,
      count: manifest.count,
      categories: manifest.categories,
      plugins
    }
  }
}

/** 这个源看起来是不是分片源（给 resolveSources 决定要不要走分片路径）。 */
export function looksLikeShardManifestUrl(url) {
  try {
    const parsed = new URL(String(url))
    return parsed.pathname.endsWith(`/${SHARD_MANIFEST_NAME}`) || parsed.pathname.endsWith('.shards.json')
  } catch {
    return false
  }
}

/** 导出给测试与诊断用。 */
export const SHARD_PROTOCOL = { SHARD_FORMAT, SHARD_MANIFEST_NAME, SHARD_DIR }
