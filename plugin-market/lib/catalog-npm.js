/**
 * 从 npm 目录包 `dsh-plugin-catalog` 里读 plugins.json。
 *
 * 为什么要有这条路：目录的原始地址挂在 GitHub Pages 上，而宿主进程走直连
 *（DSH 只认 HTTP(S)_PROXY 环境变量，不读 Windows 系统代理），实测直连常常 25s 超时甚至不通；
 * 同一个 plugins.json 发布成 npm 包后，国内镜像 100ms 级就能返回。
 *
 * 本模块只负责「把字节取回来、校验完整性、从 tar 里抽出一个文件」，
 * 不 import catalog.js（JSON 结构校验留在那边），这样两边都不需要处理循环依赖。
 */

import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

/** 目录包名与包内路径固定，是发布流程的约定。 */
export const CATALOG_PACKAGE = 'dsh-plugin-catalog'
export const CATALOG_FILE = 'package/plugins.json'

/** 候选镜像：国内镜像优先（97ms 实测），npm 官方兜底（1.76s 实测）。 */
export const DEFAULT_NPM_REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']

/** 元数据只是几 KB 的 JSON；tarball 有 1MB+，给它更宽的下载窗口。 */
export const NPM_METADATA_TIMEOUT_MS = 15_000
export const NPM_TARBALL_TIMEOUT_MS = 30_000

/** AbortSignal.timeout 的兼容包装；老 Node 没有它时手动 abort，定时器不能拖住进程退出。 */
export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  if (typeof timer.unref === 'function') timer.unref()
  return controller.signal
}

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

// ── 最小 USTAR 读取 ────────────────────────────────────────────────────────
// 只为「从一个已知的 npm tarball 里读出 package/plugins.json」而写。
// USTAR 头是 512 字节定长，name 在 0..100、size 八进制在 124..136、typeflag 在 156。
// 引一个 tar 库来读一个文件名，比这段代码本身更贵（还要多一个运行时依赖）。

const BLOCK = 512
const NAME_OFFSET = 0
const NAME_LENGTH = 100
const SIZE_OFFSET = 124
const SIZE_LENGTH = 12
const TYPE_OFFSET = 156
const PREFIX_OFFSET = 345
const PREFIX_LENGTH = 155

function readField(buffer, offset, length) {
  return buffer.toString('utf8', offset, offset + length).replace(/\0.*$/s, '').trim()
}

/**
 * 取 tar 里某个条目的字节；找不到返回 null。
 *
 * size 不一定按 512 对齐，所以返回的是 `subarray(offset, offset + size)`——
 * 只给真实内容，不把填充字节一起交出去。
 */
export function fileFromTarBuffer(buffer, wanted) {
  if (!Buffer.isBuffer(buffer)) return null
  let offset = 0
  while (offset + BLOCK <= buffer.length) {
    const name = readField(buffer, offset + NAME_OFFSET, NAME_LENGTH)
    // 全空头块是 tar 的结尾；再往后只可能是零填充，停在这里。
    if (name === '') return null
    const prefix = readField(buffer, offset + PREFIX_OFFSET, PREFIX_LENGTH)
    const fullName = prefix === '' ? name : `${prefix}/${name}`
    const size = Number.parseInt(readField(buffer, offset + SIZE_OFFSET, SIZE_LENGTH), 8)
    if (!Number.isFinite(size) || size < 0) return null
    const type = String.fromCharCode(buffer[offset + TYPE_OFFSET] ?? 0)
    offset += BLOCK
    // '0' 与 NUL 都表示普通文件；目录、链接、PAX/GNU 扩展头一律跳过正文。
    if ((type === '0' || type === '\0') && fullName === wanted) {
      return buffer.subarray(offset, Math.min(offset + size, buffer.length))
    }
    offset += Math.ceil(size / BLOCK) * BLOCK
  }
  return null
}

/** gunzip 后再取条目；gzip 损坏会抛错，交给调用方判为该源失败。
 *
 *  **必须给解压设输出上限**：`gunzipSync` 默认无上限，而 tarball 的 `dist.integrity`
 *  是**同一份元数据**给的——一个恶意/被劫持的镜像可以自洽地声明一个「压缩 255 KiB、
 *  解压 256 MB」的炸弹，integrity 校验照样通过（它校验的是压缩字节），
 *  然后在**宿主事件循环**上同步吃掉 256 MB；再大就直接 OOM 掉整个 DSH 进程。
 *  这里按「目录 tarball 绝不可能超过 8 MB」设上限：正常目录的 tarball 只有几十 KB，
 *  8 MB 留了 100 倍余量，同时把炸弹挡在分配之前。
 *  独立审计实测：255 KiB → 256 MB（`p49_gzipbomb.mjs`）。 */
export const MAX_TARBALL_BYTES = 8 * 1024 * 1024

export function fileFromTarball(gzipBytes, wanted) {
  return fileFromTarBuffer(gunzipSync(gzipBytes, { maxOutputLength: MAX_TARBALL_BYTES }), wanted)
}

// ── 完整性校验 ─────────────────────────────────────────────────────────────

/**
 * 解析 SRI 串，挑最强的一个算法（sha512 > sha384 > sha256）。
 * 返回能识别的第一项，识别不了返回 null——识别不了就等于「无法校验」，不能放行。
 */
export function parseIntegrity(integrity) {
  if (typeof integrity !== 'string' || integrity.trim() === '') return null
  const entries = integrity.trim().split(/\s+/)
  for (const algorithm of ['sha512', 'sha384', 'sha256']) {
    for (const entry of entries) {
      const dash = entry.indexOf('-')
      if (dash <= 0) continue
      if (entry.slice(0, dash).toLowerCase() !== algorithm) continue
      const value = entry.slice(dash + 1)
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) continue
      const expected = Buffer.from(value, 'base64')
      if (expected.length === 0) continue
      return { algorithm, expected }
    }
  }
  return null
}

/**
 * 校验 tarball 字节与 dist.integrity。
 * 目录是安装目标的信任锚：校验不过就整源失败，绝不「先装上再说」。
 */
export function verifyIntegrity(bytes, integrity) {
  const parsed = parseIntegrity(integrity)
  if (parsed === null) {
    return { ok: false, reason: 'dist.integrity 的格式无法识别，拒绝使用未校验的 tarball' }
  }
  const actual = createHash(parsed.algorithm).update(bytes).digest()
  if (actual.length !== parsed.expected.length) {
    return { ok: false, reason: `tarball 字节与 dist.integrity 不符（${parsed.algorithm} 长度不同）` }
  }
  return timingSafeEqual(actual, parsed.expected)
    ? { ok: true }
    : { ok: false, reason: `tarball 字节与 dist.integrity 不符（${parsed.algorithm} 哈希不同）` }
}

/** 注册表主机名，用于 source 展示与诊断文案。 */
export function registryHost(registry) {
  try {
    return new URL(String(registry)).host
  } catch {
    return String(registry)
  }
}

async function fetchResponse(fetchImpl, url, timeoutMs) {
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: timeoutSignal(timeoutMs)
    })
  } catch (error) {
    return classifyFetchError(error, timeoutMs)
  }
  if (response === null || response === undefined || typeof response.ok !== 'boolean') {
    return { ok: false, kind: 'network', reason: '响应无法识别' }
  }
  if (response.ok !== true) {
    return { ok: false, kind: 'http', reason: `HTTP ${response.status}` }
  }
  return { ok: true, response }
}

/**
 * 一次 npm 源尝试：元数据 → tarball → 完整性 → 抽文件。
 *
 * 每个失败都带短 `reason`（供 502/504 文案列出「已试过哪些源」）与 `kind`
 *（'timeout' 会被上层用来判断该不该回 504）。成功时 `label` 带版本号，
 * 形如 `npm:dsh-plugin-catalog@1.2.3 (registry.npmmirror.com)`。
 */
export async function readCatalogFromNpm(source, options = {}) {
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch
  const registry = String(source?.registry ?? '').replace(/\/+$/, '')
  const pkg = typeof source?.pkg === 'string' && source.pkg !== '' ? source.pkg : CATALOG_PACKAGE
  const host = registryHost(registry)
  const label = `npm:${pkg} (${host})`
  const metadataTimeoutMs = Number.isFinite(source?.metadataTimeoutMs) ? source.metadataTimeoutMs : NPM_METADATA_TIMEOUT_MS
  const tarballTimeoutMs = Number.isFinite(source?.tarballTimeoutMs) ? source.tarballTimeoutMs : NPM_TARBALL_TIMEOUT_MS

  if (typeof fetchImpl !== 'function') {
    return { ok: false, kind: 'network', reason: '当前运行环境没有 fetch', label }
  }

  const metadataRes = await fetchResponse(fetchImpl, `${registry}/${encodeURIComponent(pkg)}/latest`, metadataTimeoutMs)
  if (metadataRes.ok !== true) return { ...metadataRes, reason: `元数据：${metadataRes.reason}`, label }

  let metadataText
  try {
    metadataText = await metadataRes.response.text()
  } catch (error) {
    return { ...classifyFetchError(error, metadataTimeoutMs), reason: `元数据：${shortError(error)}`, label }
  }
  let metadata
  try {
    metadata = JSON.parse(metadataText)
  } catch {
    return { ok: false, kind: 'not-json', reason: '元数据不是合法 JSON', label }
  }

  const version = typeof metadata?.version === 'string' ? metadata.version : null
  const tarball = typeof metadata?.dist?.tarball === 'string' ? metadata.dist.tarball : null
  if (version === null || tarball === null) {
    return { ok: false, kind: 'bad-metadata', reason: '元数据缺少 version 或 dist.tarball', label }
  }
  const versionedLabel = `npm:${pkg}@${version} (${host})`

  const tarballRes = await fetchResponse(fetchImpl, tarball, tarballTimeoutMs)
  if (tarballRes.ok !== true) return { ...tarballRes, reason: `tarball：${tarballRes.reason}`, label }

  let bytes
  try {
    if (typeof tarballRes.response.arrayBuffer !== 'function') {
      return { ok: false, kind: 'bad-tarball', reason: 'tarball 响应不支持二进制读取', label }
    }
    const raw = await tarballRes.response.arrayBuffer()
    bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
  } catch (error) {
    return { ...classifyFetchError(error, tarballTimeoutMs), reason: `tarball：${shortError(error)}`, label }
  }

  // dist.integrity 是**必填**校验：元数据本身也来自网络，只信「元数据说没问题」等于没校验。
  // 缺字段就整源失败并退到下一个源——不匹配即拒绝，绝不「装上一次算一次」。
  const integrity = typeof metadata?.dist?.integrity === 'string' && metadata.dist.integrity !== '' ? metadata.dist.integrity : null
  if (integrity === null) {
    return { ok: false, kind: 'integrity', reason: '元数据没有 dist.integrity，拒绝使用未校验的 tarball', label: versionedLabel }
  }
  const verdict = verifyIntegrity(bytes, integrity)
  if (verdict.ok !== true) {
    return { ok: false, kind: 'integrity', reason: verdict.reason, label: versionedLabel }
  }

  let raw
  try {
    const file = fileFromTarball(bytes, CATALOG_FILE)
    if (file === null) {
      return { ok: false, kind: 'bad-tarball', reason: `tarball 里没有 ${CATALOG_FILE}`, label: versionedLabel }
    }
    // 包里的 plugins.json 可能带 UTF-8 BOM（PowerShell / 记事本编辑过的文件常见；本仓库
    // 自己就有 verify/ps-bom.test.mjs）。JSON.parse 不认 BOM，而 URL 那条路走 response.text()
    // 会被 fetch 规范自动剥掉——所以只有 npm 这条路需要显式 trimStart，否则主源每次都失败。
    raw = JSON.parse(file.toString('utf8').trimStart())
  } catch (error) {
    return { ok: false, kind: 'bad-tarball', reason: `读取 tarball 失败：${shortError(error)}`, label: versionedLabel }
  }

  return { ok: true, raw, version, label: versionedLabel }
}
