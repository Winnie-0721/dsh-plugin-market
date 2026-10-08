/**
 * 市场自身的更新通道。
 *
 * 四个源都试，顺序按「新鲜度」排（2026-10-04 在本机实测，不用代理）：
 *
 *   1. GitHub Releases API：`releases/latest` 立刻返回最新标签（1.6s / 450ms），是权威且最新的。
 *      **v1.1.6 起 releases/ 目录已从仓库移除**（打包产物只挂 GitHub Release 附件，回退也从那里下载），
 *      所以这一源不再依赖仓库里的 index.json：附件元数据自带 sha256（`digest`）与字节数（`size`），
 *      条目当场组装；附件缺 digest 时才退回老路（该标签的 releases/index.json，v1.1.5 及更早的标签仍带）。
 *      代价是**匿名限流 60 次/小时/IP**，且会与机器上其它 GitHub 客户端共享这个额度；
 *      被限流时返回 403，我们把它当成该源失败，继续往下走。10 分钟缓存把点击量封在 ~6 次/小时。
 *   2. jsDelivr 标签列表：不限流、CDN 缓存、85–2100ms，但**列表会滞后**——
 *      实测发布一小时后它仍然只有旧版本。
 *   3. jsDelivr `@main` 的 releases/index.json：同样是缓存，实测滞后（分支内容可缓存 12 小时）。
 *      仓库不再存这份清单后此源只对 ≤v1.1.5 有意义，新版本上会 404 并如实记进 attempts。
 *   4. 兜底：按 MAJOR.MINOR.PATCH 的常规递进探三个候选标签。**任意标签是按需取的**，
 *      刚推完 `@v<tag>/…` 立刻 200——但清单本身随 releases/ 一并下线，新版本同样会 404 记档。
 *   换句话说：新版本的检查与安装靠第 1 源 + 附件下载；2/3/4 是 ≤v1.1.5 的兼容与限流时的补位。
 *
 * 更正一条曾经的错误结论：早先我写「本机直连 api.github.com 一律 403、github.com 被重置」，
 * 并把原因归给 GFW。实际是当时仓库还是 **private**（未鉴权取 releases/latest 就是 404），
 * 加上匿名限流返回的 403 被误读成封锁。今天实测：API 200（X-RateLimit-Remaining 47/60）、
 * github.com 200、Release 附件 200（2.7s 直连 / 737ms 走代理），sha256 与本地构建一致。
 *
 * 信任链（三道，缺一不可）：
 *   1. 路径形状：tarball 必须落在 `releases/*.tgz`（相对约定形状）——index/条目里写别的 URL 不会被采信；
 *   2. sha256：与清单记的哈希逐字节比对（防截断/损坏/中间人换包）；
 *      清单 = 老路的 index.json，或 GitHub 附件的 `digest`（同一个字段名 `sha256`，来源不同）；
 *   3. 产物自证：解开 tarball 读 package/package.json，名字与版本必须与预期一致。
 * 说明：第 2 道不防「清单与产物一起被换」，那需要独立签名密钥；
 * 现在的定位是「防损坏与防单点替换」，写进 docs/API-CONTRACT.md §2.9 如实标注。
 */

import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { fileFromTarball, timeoutSignal } from './catalog-npm.js'

/** 固定仓库与通道地址：换仓库要改的是这里与 docs/RELEASING.md。 */
export const MARKET_REPO = 'Winnie-0721/dsh-plugin-market'
export const MARKET_PACKAGE = 'deepseek-harness-market'
export const CDN_BASE = `https://cdn.jsdelivr.net/gh/${MARKET_REPO}`
export const DATA_API = `https://data.jsdelivr.com/v1/packages/gh/${MARKET_REPO}`
export const GITHUB_RELEASE_API = `https://api.github.com/repos/${MARKET_REPO}/releases/latest`

/** 检查结果缓存 10 分钟：Data API 冷启动要 2s 级，点一次按钮不该每次都等它。 */
export const CHECK_CACHE_MS = 10 * 60 * 1000
export const METADATA_TIMEOUT_MS = 12_000
export const TARBALL_TIMEOUT_MS = 30_000

/** 下载目录：用户主目录下，重启后仍在——安装后 profile 记的是这个路径的 file: 依赖。 */
export function defaultDownloadDir() {
  return join(homedir(), '.dsh', 'plugin-market', 'downloads')
}

// ── 版本比较（严格 MAJOR.MINOR.PATCH，与发布规则一致） ──────────────────────

/**
 * 解析版本号；`v1.2.3` 也接受（Git 标签形如 v1.2.3）。
 * 不是严格三段数字就返回 null——预发布号不参与本通道的比较，宁可拒绝也不猜。
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (match === null) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (parts.some((part) => !Number.isSafeInteger(part))) return null
  return { major: parts[0], minor: parts[1], patch: parts[2] }
}

/** 比较两个版本串：a>b 返回 1，相等 0，a<b 返回 -1；任一不可解析返回 null。 */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  return 0
}

/** 只在候选严格高于当前时才算「有更新」：相同或更低都不提示。
 *  任一版本不可解析时 `compareVersions` 返回 null——这里如实返回 null，**不折叠成 false**：
 *  折叠会让「无法比较」看起来像「已是最新」，调用方必须区分这两件事。 */
export function isNewer(candidate, current) {
  const compared = compareVersions(candidate, current)
  if (compared === null) return null
  return compared === 1
}

/** 从版本串列表里取最高的一个；全部不可解析时返回 null。 */
export function pickLatestVersion(candidates) {
  let best = null
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (parseVersion(candidate) === null) continue
    if (best === null || compareVersions(candidate, best) === 1) best = String(candidate).trim().replace(/^v/, '')
  }
  return best
}

// ── index.json 的读取与校验（持久/网络边界，按结构校验） ────────────────────

/** `releases/<name>.tgz`，别的形状一律不采信。 */
export function isReleaseTarballPath(value) {
  return typeof value === 'string' && /^releases\/[A-Za-z0-9._-]+\.tgz$/.test(value)
}

/** sha256 十六进制串。 */
export function isSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * 标签名是否可用：`v?` + 非空白字符，且**必须是合法 UTF-16**（不含孤立代理项）。
 * 孤立代理项（`\ud800`）能通过 `\S+`，却是 JSON 能携带的（外部 CDN 内容），
 * 之后 `encodeURIComponent` 会抛 URIError——那会从 check() 冒出去变成 500 internal，
 * 单源坏数据不该拖垮整次检查（其它失败路径都规规矩矩返回 { ok:false, reason }）。
 */
function isUsableTag(value) {
  if (typeof value !== 'string' || !/^v?\S+$/.test(value)) return false
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
}

/** 把一个 index.json 条目收敛成安装需要的字段；缺关键字段返回 null。 */
export function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const version = parseVersion(raw.version)
  if (version === null) return null
  const tarball = isReleaseTarballPath(raw.tarball) ? raw.tarball : null
  return {
    version: String(raw.version).trim().replace(/^v/, ''),
    tag: isUsableTag(raw.tag) ? raw.tag : `v${String(raw.version).trim().replace(/^v/, '')}`,
    versionCode: Number.isSafeInteger(raw.versionCode) ? raw.versionCode : null,
    build: typeof raw.build === 'string' ? raw.build : null,
    tarball,
    sha256: isSha256Hex(raw.sha256) ? raw.sha256 : null,
    bytes: Number.isSafeInteger(raw.bytes) && raw.bytes > 0 ? raw.bytes : null,
    releasedAt: typeof raw.releasedAt === 'string' ? raw.releasedAt : null
  }
}

/** 从当前版本推三个「常规递进方向」的候选版本：下一个补丁 / 下一个次版本 / 下一个主版本。 */
export function nextCandidates(current) {
  const parsed = parseVersion(current)
  if (parsed === null) return []
  return [
    `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`,
    `${parsed.major}.${parsed.minor + 1}.0`,
    `${parsed.major + 1}.0.0`
  ]
}

/**
 * 读一份 index.json：返回 `{ latest, versions }`，用不上的一律丢弃而不是猜。
 * 结构不认识时返回 null，让调用方把该源记为失败。
 */
export function readIndex(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const versions = []
  for (const item of Array.isArray(raw.versions) ? raw.versions : []) {
    const entry = normalizeEntry(item)
    if (entry !== null) versions.push(entry)
  }
  let latest = normalizeEntry(raw.latest)
  if (latest === null) {
    const best = pickLatestVersion(versions.map((entry) => entry.version))
    latest = best === null ? null : versions.find((entry) => entry.version === best) ?? null
  }
  if (latest === null && versions.length === 0) return null
  return { latest, versions }
}

/** 校验下载到的字节与 index.json 记的哈希、长度是否一致。 */
export function verifySha256Hex(bytes, expectedHex) {
  if (!isSha256Hex(expectedHex)) return { ok: false, reason: 'index.json 没有可用的 sha256，拒绝安装未校验的产物' }
  const actual = createHash('sha256').update(bytes).digest()
  const expected = Buffer.from(expectedHex, 'hex')
  if (actual.length !== expected.length) return { ok: false, reason: 'sha256 长度不符' }
  return timingSafeEqual(actual, expected) ? { ok: true } : { ok: false, reason: 'sha256 与 index.json 不符' }
}

/**
 * 产物自证：tarball 里的 package/package.json 必须声明预期的包名与版本。
 * 这一道挡住「哈希可信但内容根本不是本插件」的情况。
 */
export function readArtifactManifest(bytes) {
  let raw
  try {
    const file = fileFromTarball(bytes, 'package/package.json')
    if (file === null) return { ok: false, reason: 'tarball 里没有 package/package.json' }
    raw = JSON.parse(file.toString('utf8'))
  } catch (error) {
    return { ok: false, reason: `读取产物清单失败：${error?.message ?? error}` }
  }
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: '产物清单不是 JSON 对象' }
  return { ok: true, name: typeof raw.name === 'string' ? raw.name : null, version: typeof raw.version === 'string' ? raw.version : null }
}

// ── IO ─────────────────────────────────────────────────────────────────────

function shortError(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 120 ? `${message.slice(0, 120)}…` : message
}

function classify(error, timeoutMs) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const timedOut =
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  return timedOut ? `超时（${Math.round(timeoutMs / 1000)}s）` : `请求失败：${shortError(error)}`
}

async function getJson(fetchImpl, url, timeoutMs) {
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
    return { ok: false, reason: classify(error, timeoutMs) }
  }
  if (response === null || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    return { ok: false, reason: '响应无法识别' }
  }
  if (response.ok !== true) return { ok: false, reason: `HTTP ${response.status}` }
  try {
    return { ok: true, raw: JSON.parse(await response.text()) }
  } catch (error) {
    return { ok: false, reason: `不是合法 JSON：${shortError(error)}` }
  }
}

async function getBytes(fetchImpl, url, timeoutMs) {
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      headers: { accept: 'application/octet-stream' },
      signal: timeoutSignal(timeoutMs)
    })
  } catch (error) {
    return { ok: false, reason: classify(error, timeoutMs) }
  }
  if (response === null || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    return { ok: false, reason: '响应无法识别' }
  }
  if (response.ok !== true) return { ok: false, reason: `HTTP ${response.status}` }
  try {
    if (typeof response.arrayBuffer !== 'function') return { ok: false, reason: '响应不支持二进制读取' }
    const raw = await response.arrayBuffer()
    return { ok: true, bytes: Buffer.isBuffer(raw) ? raw : Buffer.from(raw) }
  } catch (error) {
    return { ok: false, reason: classify(error, timeoutMs) }
  }
}

/** 三个候选源，按「新鲜度」排序；每个都如实记录自己为什么失败。 */
function buildSources() {
  return [
    {
      id: 'github-release',
      label: 'GitHub Releases API',
      async read(fetchImpl) {
        const res = await getJson(fetchImpl, GITHUB_RELEASE_API, METADATA_TIMEOUT_MS)
        if (res.ok !== true) return res
        const tag = typeof res.raw?.tag_name === 'string' ? res.raw.tag_name : ''
        const version = parseVersion(tag)
        if (version === null) return { ok: false, reason: 'Release 的 tag_name 不是可解析的版本号' }
        const versionText = tag.trim().replace(/^v/, '')
        // releases/ 目录已从仓库移除：新版本没有 index.json 可查，条目直接由附件元数据组装——
        // digest 是 GitHub 对上传字节算的 sha256、size 是字节数，信任链第 2 道照样有据可依。
        const assets = Array.isArray(res.raw?.assets) ? res.raw.assets : []
        const asset = assets.find((item) => typeof item?.name === 'string' && item.name === `${MARKET_PACKAGE}-${versionText}.tgz`)
        const digest = typeof asset?.digest === 'string' && asset.digest.startsWith('sha256:')
          ? asset.digest.slice('sha256:'.length).toLowerCase()
          : ''
        if (asset !== undefined && isSha256Hex(digest)) {
          const entry = normalizeEntry({
            version: versionText,
            tag,
            versionCode: version.major * 10000 + version.minor * 100 + version.patch,
            build: null, // 提交数.短哈希只有打包机知道；客户端不消费 build，缺了就不显示
            tarball: `releases/${MARKET_PACKAGE}-${versionText}.tgz`,
            sha256: digest,
            bytes: Number.isSafeInteger(asset.size) && asset.size > 0 ? asset.size : null,
            releasedAt: typeof res.raw.published_at === 'string' ? res.raw.published_at : null
          })
          if (entry !== null) return { ok: true, version: versionText, tag, entry, entryFromTag: false }
        }
        // 附件缺 digest：退回老路（该标签的 releases/index.json）——v1.1.5 及更早的标签仍带这份清单。
        return { ok: true, version: versionText, tag, entryFromTag: true }
      }
    },
    {
      id: 'jsdelivr-tags',
      label: `jsDelivr Data API（${MARKET_REPO} 标签列表）`,
      async read(fetchImpl) {
        const res = await getJson(fetchImpl, DATA_API, METADATA_TIMEOUT_MS)
        if (res.ok !== true) return res
        const versions = (Array.isArray(res.raw?.versions) ? res.raw.versions : [])
          .map((item) => item?.version)
          .filter((value) => typeof value === 'string')
        const latest = pickLatestVersion(versions)
        if (latest === null) return { ok: false, reason: '标签列表里没有可解析的 MAJOR.MINOR.PATCH 版本' }
        return { ok: true, version: latest, tag: `v${latest}`, entryFromTag: true }
      }
    },
    {
      id: 'jsdelivr-index',
      label: `jsDelivr CDN（main 分支 releases/index.json）`,
      async read(fetchImpl) {
        const res = await getJson(fetchImpl, `${CDN_BASE}@main/releases/index.json`, METADATA_TIMEOUT_MS)
        if (res.ok !== true) return res
        const index = readIndex(res.raw)
        if (index === null || index.latest === null) return { ok: false, reason: 'index.json 里没有可用版本' }
        // 分支引用在 CDN 上是缓存 12 小时的：这条路的版本号会滞后，所以排在标签列表之后。
        return { ok: true, version: index.latest.version, tag: index.latest.tag, entry: index.latest, entryFromTag: false }
      }
    }
  ]
}

/**
 * 建一个市场自更新器。
 *
 * @param options.fetchImpl - 注入用的 fetch（测试传假实现）。
 * @param options.installBundle - 宿主 pluginManager.installBundle，缺失时更新不可用。
 * @param options.downloadDir - tarball 落盘目录，默认 ~/.dsh/plugin-market/downloads。
 * @param options.logger - 诊断输出，默认 console。
 */
export function createSelfUpdater(options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  // 宿主服务可能比插件 apply 晚注册：优先用 getter，每次调用时再读一次。
  const managerOf = typeof options.managerOf === 'function' ? options.managerOf : () => options.manager ?? null
  const downloadDir = typeof options.downloadDir === 'string' && options.downloadDir !== '' ? options.downloadDir : defaultDownloadDir()
  const logger = options.logger ?? console
  const cacheMs = Number.isFinite(options.cacheMs) ? options.cacheMs : CHECK_CACHE_MS
  let cache = null

  /** 该标签下这一版的条目：标签内容不可变，所以取回后可以放心缓存。 */
  async function entryForTag(fetchImplTag, tag, expectedVersion, fallback) {
    const res = await getJson(fetchImplTag, `${CDN_BASE}@${encodeURIComponent(tag)}/releases/index.json`, METADATA_TIMEOUT_MS)
    if (res.ok === true) {
      const index = readIndex(res.raw)
      if (index !== null) {
        const hit = (index.versions ?? []).find((entry) => entry.version === expectedVersion) ?? null
        if (hit !== null) return { ok: true, entry: hit }
        if (index.latest !== null && index.latest.version === expectedVersion) return { ok: true, entry: index.latest }
      }
    }
    // 老标签（v1.0.x）还没有 releases/ 目录：退回 main 分支那份条目，至少能装。
    if (fallback !== undefined && fallback !== null) return { ok: true, entry: fallback }
    return { ok: false, reason: res.ok === true ? `标签 ${tag} 的 index.json 里没有 ${expectedVersion}` : `标签 ${tag}：${res.reason}` }
  }

  async function check(checkOptions = {}) {
    const force = checkOptions.force === true
    const now = Date.now()
    if (!force && cache !== null && now - cache.at < cacheMs) return cache.value

    // 当前版本：调用方没给就用创建时注入的（宿主侧是 package.json 里的版本）。
    const current = typeof checkOptions.current === 'string'
      ? checkOptions.current
      : typeof options.current === 'string' ? options.current : null
    if (typeof fetchImpl !== 'function') {
      return { ok: false, code: 'self-update-unavailable', message: '当前运行环境没有 fetch。', attempts: [] }
    }
    // 本机版本必须是严格三段数字（parseVersion 的约定）。预发布号（`1.1.5-rc.1`）或任何
    // 不可解析的值**不能**被当成「已是最新」——那等于把「无法比较」说成「没有更新」，
    // 而且 apply() 还会回一个 ok:true 的「up-to-date」。如实报通道不可用。
    if (current !== null && parseVersion(current) === null) {
      return {
        ok: false,
        code: 'self-update-unavailable',
        message: `本机版本「${current}」不是严格的三段版本号，无法与本通道比较。`,
        hint: '这条通道只比较 1.2.3 形式；请在终端用 dsh plugin add <Release 附件地址> 手动升级。',
        attempts: []
      }
    }

    // 逐个源「完整地」试：源给出候选版本 **并且** 拿得到那一版的清单，才算这个源成功。
    // 早退出条件是「已经有一个明确高于当前版本的答案」——那种情况下不用再问别的源；
    // 而「没有更新」必须问完全部源，因为某个源可能只是慢了一拍（实测：刚发完版，
    // jsDelivr 的标签列表要过一阵才索引到新标签，而 @main 那份清单已经是新的）。
    const attempts = []
    const candidates = []
    // 有的源**知道**存在某个更高的版本，却拿不到那一版的清单（附件缺 digest → 回落到
    // 该标签的 releases/index.json，而 v1.1.6 起仓库里已没有这份清单）。
    // 这种「知道有新版但验不了」必须让整次检查失败，绝不能让更旧的候选把它盖成「已是最新」。
    // 用 Set 去重：多个源可能报同一个版本（实测 message 里出现过「1.1.6、1.1.6」）。
    const unverified = new Set()
    for (const source of buildSources()) {
      const res = await source.read(fetchImpl)
      if (res.ok !== true) {
        attempts.push({ id: source.id, label: source.label, ok: false, reason: res.reason })
        continue
      }
      const resolved = res.entry !== undefined && res.entry !== null
        ? { ok: true, entry: res.entry }
        : await entryForTag(fetchImpl, res.tag, res.version, null)
      if (resolved.ok !== true) {
        attempts.push({ id: `${source.id}:index`, label: `${source.label} → ${res.tag} 的 releases/index.json`, ok: false, reason: resolved.reason })
        if (typeof res.version === 'string' && res.version !== '') unverified.add(res.version)
        continue
      }
      attempts.push({ id: source.id, label: source.label, ok: true, reason: `v${resolved.entry.version}` })
      candidates.push({ source, entry: resolved.entry })
      if (current !== null && isNewer(resolved.entry.version, current) === true) break
    }

    if (candidates.length === 0) {
      // 列表源全都不可用；下面仍会试标签探测（≤v1.1.5 的标签仍带清单，任意标签是按需取的），
      // 所以这里只记日志，是否算失败由 best 决定。
      logger.warn?.(`[${MARKET_PACKAGE}] 三个列表源都没给出可用清单：${attempts.map((attempt) => `${attempt.label}：${attempt.reason}`).join('；')}`)
    }

    // 取「能拿到清单的最高版本」：不同源的缓存新鲜度不一致，取最高的那个才不会漏掉更新。
    let best = null
    for (const candidate of candidates) {
      if (best === null || compareVersions(candidate.entry.version, best.entry.version) === 1) best = candidate
    }

    // 两个列表源都会滞后（实测：Data API 的版本列表一小时后仍只有旧版本；@main 的清单被 CDN
    // 缓存 12 小时），而**任意标签是按需取的**——刚推完标签 `@v<tag>/…` 立刻就是 200。
    // 所以列表都说「没有更高版本」时，按常规递进方向探三个候选标签：命中即确实有新版本，
    // 而且那一版的清单就在同一个标签里。有界（最多 3 次）、确定性，不是盲目猜版本。
    // 如实标注：releases/ 目录下线后（v1.1.6 起）新版本的标签里没有清单，探测只会 404 并记档；
    // 它继续为 ≤v1.1.5 的标签、以及「第 1 源被限流但标签带清单」的情况补位。
    if (best === null || current === null || isNewer(best.entry.version, current) !== true) {
      for (const candidateVersion of current === null ? [] : nextCandidates(current)) {
        if (best !== null && isNewer(candidateVersion, best.entry.version) !== true) continue
        const probe = await entryForTag(fetchImpl, `v${candidateVersion}`, candidateVersion, null)
        if (probe.ok !== true) {
          attempts.push({ id: 'tag-probe', label: `标签 v${candidateVersion} 的 releases/index.json`, ok: false, reason: probe.reason })
          continue
        }
        attempts.push({ id: 'tag-probe', label: `标签 v${candidateVersion} 的 releases/index.json`, ok: true, reason: `v${candidateVersion}` })
        candidates.push({ source: { id: 'tag-probe', label: `标签探测（v${candidateVersion}）` }, entry: probe.entry })
        best = { source: { id: 'tag-probe' }, entry: probe.entry }
        break
      }
    }

    // 有的源**知道**存在更高的版本却验不了（附件缺 digest → 回落到已下线的 releases/index.json）。
    // 这时哪怕手里有更旧的候选，也绝不能报「已是最新」——那是把「查不到」谎称成「没有」。
    // 如实报通道不可用，并说清是哪个版本验不了。
    const unverifiableNewer = [...unverified].filter((version) => current === null || isNewer(version, current) === true)
    if (unverifiableNewer.length > 0 && (best === null || isNewer(best.entry.version, current) !== true)) {
      const detail = attempts.map((attempt) => `${attempt.label}：${attempt.reason}`).join('；')
      const value = {
        ok: false,
        code: 'self-update-unavailable',
        message: `更新通道报告了更新的版本（${unverifiableNewer.join('、')}），但那一版的发布产物无法校验，不谎称已是最新。`,
        hint: `稍后重试；也可在终端用 dsh plugin add <Release 附件地址> 手动升级。已试过：${detail === '' ? '没有可用源' : detail}`,
        attempts
      }
      cache = { at: now, value }
      return value
    }

    if (best === null) {
      const detail = attempts.map((attempt) => `${attempt.label}：${attempt.reason}`).join('；')
      logger.warn?.(`[${MARKET_PACKAGE}] 自更新检查失败：${detail === '' ? '没有可用源' : detail}`)
      const value = {
        ok: false,
        code: 'self-update-unavailable',
        message: '更新源与标签探测都没能给出可用的版本清单。',
        hint: '这台机器可能访问不了 jsDelivr 与 GitHub；可在终端用 dsh plugin add 手动升级。',
        attempts
      }
      cache = { at: now, value }
      return value
    }

    const entry = best.entry
    const updateAvailable = current === null ? true : isNewer(entry.version, current) === true
    const url = entry.tarball === null ? null : `${CDN_BASE}@${encodeURIComponent(entry.tag)}/${entry.tarball}`
    const value = {
      ok: true,
      current,
      latest: entry.version,
      latestTag: entry.tag,
      versionCode: entry.versionCode,
      build: entry.build,
      releasedAt: entry.releasedAt,
      updateAvailable,
      installable: updateAvailable && url !== null && entry.sha256 !== null,
      channel: best.source.id,
      url,
      // 相对路径一并交出去：下载时要在标签地址之外再试 main 分支的同一路径。
      tarball: entry.tarball,
      sha256: entry.sha256,
      bytes: entry.bytes,
      attempts,
      checkedAt: new Date(now).toISOString()
    }
    cache = { at: now, value }
    return value
  }

  /**
   * 同一份 tarball 的候选地址，按顺序试：
   *   1. `@<tag>/releases/<file>.tgz` —— CDN 上的规范地址（内容不可变、缓存永久）；
   *   2. `@main/releases/<file>.tgz` —— 标签还没被 CDN 索引时顶上（实测会 404 一阵）；
   *   3. GitHub Release 附件 —— 两条 CDN 路都不通时用；附件名是发布流程的约定（`<name>-<version>.tgz`）。
   * 因为内容由 sha256 与产物自证负责，从哪条路取都不影响安全性。
   */
  function tarballUrls(entry) {
    if (typeof entry.tarball !== 'string' || entry.tarball === '') return []
    const relative = entry.tarball.split('/').map((segment) => encodeURIComponent(segment)).join('/')
    const tag = typeof entry.latestTag === 'string' && entry.latestTag !== '' ? entry.latestTag : `v${entry.latest}`
    const asset = `${MARKET_PACKAGE}-${entry.latest}.tgz`
    return [...new Set([
      `${CDN_BASE}@${encodeURIComponent(tag)}/${relative}`,
      `${CDN_BASE}@main/${relative}`,
      `https://github.com/${MARKET_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`
    ])]
  }

  /**
   * 下载 + 三道校验 + 落盘；任何一道不过都返回失败，绝不把未校验的字节交给 pnpm。
   * 参数就是 check() 的结果对象（它同时带 url / tarball / sha256 / bytes）。
   */
  async function download(status) {
    // 传输层失败（404/超时/断流）可以换下一条路；一旦拿到字节，哈希不符就是硬失败，不再试别的。
    const urls = [...new Set([status.url, ...tarballUrls(status)])]
    let res = null
    let lastReason = ''
    for (const url of urls) {
      const attempt = await getBytes(fetchImpl, url, TARBALL_TIMEOUT_MS)
      if (attempt.ok === true) {
        res = attempt
        break
      }
      lastReason = `${attempt.reason}（${url.includes('@main') ? 'main 分支' : '标签地址'}）`
    }
    if (res === null) return { ok: false, code: 'self-update-download', message: `下载失败：${lastReason}` }
    const bytes = res.bytes
    if (status.bytes !== null && bytes.length !== status.bytes) {
      return { ok: false, code: 'self-update-integrity', message: `字节数与清单不符（清单 ${status.bytes}，实际 ${bytes.length}）。` }
    }
    const hash = verifySha256Hex(bytes, status.sha256)
    if (hash.ok !== true) return { ok: false, code: 'self-update-integrity', message: `完整性校验失败：${hash.reason}。` }
    const manifest = readArtifactManifest(bytes)
    if (manifest.ok !== true) return { ok: false, code: 'self-update-integrity', message: `产物不可读：${manifest.reason}。` }
    if (manifest.name !== MARKET_PACKAGE || manifest.version !== status.latest) {
      return {
        ok: false,
        code: 'self-update-integrity',
        message: `产物自证不符：清单声明 ${manifest.name ?? '?'}@${manifest.version ?? '?'}，期望 ${MARKET_PACKAGE}@${status.latest}。`
      }
    }
    try {
      await mkdir(downloadDir, { recursive: true })
    } catch (error) {
      return { ok: false, code: 'self-update-download', message: `创建下载目录失败：${shortError(error)}` }
    }
    const target = join(downloadDir, `${MARKET_PACKAGE}-${status.latest}.tgz`)
    const partial = `${target}.part`
    // 先写 .part 再改名：pnpm 永远不会读到写了一半的 tarball。
    // 文件系统错误（目录被占、磁盘满、权限）在这里被归类成契约里的 self-update-download——
    // 早先它们是裸 await，会从 apply() 冒出去变成 500 internal（客户端那条专用文案永远用不上）；
    // 失败时顺手清掉 .part，不留半截文件。
    try {
      await writeFile(partial, bytes)
      await rename(partial, target)
    } catch (error) {
      try { await unlink(partial) } catch { /* .part 本来就不存在：无需上报 */ }
      return { ok: false, code: 'self-update-download', message: `写入下载产物失败：${shortError(error)}` }
    }
    return { ok: true, path: target, bytes: bytes.length }
  }

  async function apply() {
    const status = await check({ force: true })
    if (status.ok !== true) return status
    if (status.updateAvailable !== true) {
      return { ok: true, application: 'up-to-date', current: status.current, latest: status.latest }
    }
    if (status.url === null || status.sha256 === null) {
      return {
        ok: false,
        code: 'self-update-unavailable',
        message: `v${status.latest} 这一版没有可校验的发布产物。`,
        hint: '这一版可能只发了 Release 附件；在终端按 Release 页面的命令升级。'
      }
    }
    // managerOf 是宿主服务，读它本身也可能抛（注入式/自定义实现）。以前这里没有保护：
    // 异常直接冒出 apply() → index.js 的外层 handler 把它变成 500 `internal` + 一句
    // 「插件市场内部出错了」，而实际上这只是「拿不到 manager」——与下面 installBundle
    // 抛错被折成 install-failed 的处理方式也不一致（同一类失败两种形状）。
    // 折成 manager-unavailable，与「没有 pluginManager」走同一条文案与出口。
    let manager
    try {
      manager = managerOf()
    } catch (error) {
      return {
        ok: false,
        code: 'manager-unavailable',
        message: `读取插件管理服务失败：${shortError(error)}`,
        hint: '当前进程可能拿不到 pluginManager；用终端 dsh plugin 升级，或重启 DSH 后重试。'
      }
    }
    if (manager === null || typeof manager.installBundle !== 'function') {
      return { ok: false, code: 'manager-unavailable' }
    }
    const downloaded = await download(status)
    if (downloaded.ok !== true) return downloaded

    let result
    try {
      result = await manager.installBundle(downloaded.path, { enabled: true })
    } catch (error) {
      return { ok: false, code: 'install-failed', message: `宿主安装失败：${shortError(error)}` }
    }
    const value = result !== null && typeof result === 'object' ? result : {}
    const failure = value.error ?? null
    // application 先定，ok 再由它推——**不能只看 error**。宿主的 ChangeResult 里 error 是
    // 可选的：`application:'failed'` 完全可能不带 error。只看 error 就会把一次失败的安装
    // 报成 ok:true，HTTP 200 回给客户端，客户端据此亮绿色「更新到 vX」——一次**失败的
    // 自更新被渲染成成功**。这条规则与 index.js 的 sendChangeResult 必须一致
    //（那里 `cancelled` 单独放行：用户自己取消的，客户端要靠 application 渲染「已取消」，
    //  ok:false 会让 requestJSON 直接抛错，那条文案就永远不可达）。
    //
    // v1.2.0 补齐两处与 sendChangeResult 的漂移（独立审计实测）：
    //   ① `pendingBuilds` 非空也要放行——见 index.js:455 的长注释（批准构建脚本那条路径）。
    //   ② 宿主回一个**空/非对象**结果（`{}` / `undefined`）时不能算 applied：
    //      index.js 的 `optionalText(value.application) ?? 'failed'` 把它判成失败，
    //      这里以前会写 applied → ok:true → 客户端亮绿灯，而宿主从没确认过这次安装。
    const pending = Array.isArray(value.pendingBuilds)
      ? value.pendingBuilds.filter((item) => typeof item === 'string' && item !== '')
      : []
    // 空结果（宿主的 change() 没给出任何字段）：既没有 application 也没有 error，
    // 无法证明装上了。application 直接判 'failed'（**与 index.js 的
    // `optionalText(value.application) ?? 'failed'` 逐字一致**）——不能只在 ok 上收紧，
    // 否则会出现「application:'applied' 但 ok:false」这种自相矛盾的结果，
    // 客户端拿 application 渲染文案时又会回到「成功」。
    const confirmed = typeof value.application === 'string' || failure !== null
    const application = typeof value.application === 'string'
      ? value.application
      : 'failed'
    const ok = application === 'cancelled' || pending.length > 0
      ? true
      : (failure === null && application !== 'failed' && confirmed)
    return {
      ok,
      application,
      from: status.current,
      to: status.latest,
      // 宿主半在进程里被 Loader 缓存：新代码要重启 DSH 才生效（见 docs/RELEASING.md §5）。
      requiresRestart: true,
      tarball: downloaded.path,
      bytes: downloaded.bytes,
      // 宿主的 ManagementError 把**可读细节放在 `diagnostic`**、常常没有 `message`
      //（index.js 的 projectChangeError 就是照这个形状投影的）。以前只抄 code+message：
      // message 变空串、diagnostic 整个丢掉，用户只拿到一句「插件市场内部出错了」，
      // 而真实原因是文件被占用 / 连不上源 —— 客户端那套按 code+diagnostic 选文案的逻辑
      // （errorCopy）在自更新这条路上永远拿不到证据。两个字段都透传。
      error: failure === null ? null : {
        code: typeof failure.code === 'string' ? failure.code : 'install-failed',
        message: typeof failure.message === 'string' ? failure.message : '',
        ...(typeof failure.diagnostic === 'string' && failure.diagnostic !== ''
          ? { diagnostic: failure.diagnostic }
          : {})
      },
      pendingBuilds: pending,
      // 顶层 `code`：index.js 的 applySelfUpdate 用 `result.code ?? 'internal'` 决定
      // 回给客户端的错误码；不透传的话每次失败都变成「插件市场内部出错了」+「稍后重试」，
      // 而真正该说的是「文件被占用，关掉占用的进程」。
      ...(failure !== null && typeof failure.code === 'string' ? { code: failure.code } : {}),
      warnings: Array.isArray(value.warnings) ? value.warnings.filter((item) => typeof item === 'string') : []
    }
  }

  /** 只给测试与诊断用：丢掉 10 分钟缓存。 */
  function reset() {
    cache = null
  }

  return { check, apply, reset }
}
