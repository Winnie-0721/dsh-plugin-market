/**
 * 目录数据层：抓取 → 校验 → 内存缓存 → 纯函数查询。
 *
 * 这里刻意把「网络」和「计算」分开：createCatalogCache 承载唯一的副作用，
 * 其余导出都是纯函数。verifier 可以拿本地 fixture 直接断言，不用起宿主、不用联网。
 * fetch 可注入（默认全局 fetch），注入后整个抓取策略也能离线测。
 *
 * 源顺序的理由见 resolveSources：目录官方地址挂在 GitHub Pages 上，宿主进程走直连
 *（DSH 只认 HTTP(S)_PROXY，不读系统代理）常常 25s 超时，而 npm 镜像 100ms 级就能返回同一份数据。
 */

import {
  CATALOG_PACKAGE,
  DEFAULT_NPM_REGISTRIES,
  NPM_METADATA_TIMEOUT_MS,
  NPM_TARBALL_TIMEOUT_MS,
  readCatalogFromNpm,
  registryHost,
  timeoutSignal
} from './catalog-npm.js'

/** 官方快照地址：npm 路线全部失败时的最后兜底。 */
export const DEFAULT_SOURCE = 'https://awesome-dsh-plugin.com/plugins.json'
export const SOURCE_ENV = 'DSHM_REGISTRY_URL'
export const NPM_MIRROR_ENV = 'DSHM_NPM_MIRROR'

/** 契约 §3.4：内存缓存 TTL 10 分钟。 */
export const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * 超时预算：npm 元数据短、tarball 要下 1MB+；官方地址已知慢，给它 30s。
 * 用户自己指定的 URL 按原来的 15s 契约走——那是他对自己的网络下的判断。
 */
export const CUSTOM_URL_TIMEOUT_MS = 15_000
export const OFFICIAL_URL_TIMEOUT_MS = 30_000

/**
 * 抓取失败后的冷却窗口：所有源都挂掉时，界面上的每次点击都不该重新走一遍完整源列表。
 * 这只影响自动抓取的速度，不会把失败说成成功——错误码原样返回。
 * 显式刷新（/refresh）绕过它，仍然会真的去请求一次。
 */
export const FAILURE_COOLDOWN_MS = 30_000

function text(value) {
  return value === null || value === undefined ? '' : String(value)
}

function optionalText(value) {
  if (value === null || value === undefined) return null
  const result = String(value).trim()
  return result === '' ? null : result
}

function numberOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function stripTrailingSlashes(value) {
  return String(value).replace(/\/+$/, '')
}

function hostOf(url) {
  try {
    return new URL(String(url)).host
  } catch {
    return String(url)
  }
}

/**
 * 按顺序给出要尝试的目录源（每个源只试一次，源列表本身就是重试）。
 *
 * - `DSHM_REGISTRY_URL` 非空 → 只用它：用户指名了自己的目录，就不该在他那边不通时
 *   悄悄换回我们的源（那样会让基于 fixture 的测试打到真实网络）。写错了也照样报错，
 *   错误里带上他填的值。
 * - `DSHM_NPM_MIRROR` 非空 → 只用它；否则国内镜像优先、npm 官方兜底。
 * - 最后永远留一个官方 URL 源，保证镜像全挂时市场还有救。
 */
export function resolveSources(env = process.env) {
  const custom = optionalText(env?.[SOURCE_ENV])
  if (custom !== null) {
    return [{ kind: 'url', url: custom, timeoutMs: CUSTOM_URL_TIMEOUT_MS, label: custom, short: hostOf(custom) }]
  }

  const mirror = optionalText(env?.[NPM_MIRROR_ENV])
  const registries = (mirror !== null ? [mirror] : DEFAULT_NPM_REGISTRIES).map(stripTrailingSlashes)
  const sources = registries.map((registry) => ({
    kind: 'npm',
    registry,
    pkg: CATALOG_PACKAGE,
    metadataTimeoutMs: NPM_METADATA_TIMEOUT_MS,
    tarballTimeoutMs: NPM_TARBALL_TIMEOUT_MS,
    label: `npm:${CATALOG_PACKAGE} (${registryHost(registry)})`,
    short: `npm ${registryHost(registry)}`
  }))
  sources.push({
    kind: 'url',
    url: DEFAULT_SOURCE,
    timeoutMs: OFFICIAL_URL_TIMEOUT_MS,
    label: DEFAULT_SOURCE,
    short: hostOf(DEFAULT_SOURCE)
  })
  return sources
}

/** 契约 §3.3：正文以 `<` 开头（HTML/DOCTYPE）就不是 JSON 契约里的数据。 */
export function looksLikeHtml(body) {
  if (typeof body !== 'string') return false
  const head = body.trimStart().slice(0, 64).toLowerCase()
  if (head === '') return false
  return head.startsWith('<')
}

/**
 * 契约 §3.3：JSON 对象 + plugins 数组 + count 数字，缺一不可。
 *
 * 还要**交叉核对** `plugins.length` 与 `count`：只查类型的话，一个结构合法但内容空/截断的
 * 正文（`{count:4412, plugins:[]}`）会被当成新鲜目录覆盖掉好缓存——市场整个变空、
 * 分类 chips 消失，而且因为 `stale:false` 连「缓存可能过期」的横幅都不显示，
 * 看起来就像「真的一共有 0 个插件」。抓取失败宁可报错，也不能静默清空。
 * 容差：小目录给足余量（用户自己写一个 `DSHM_REGISTRY_URL` 时，`count` 常常只是随手写的），
 * 大目录按 2% 判——真正要挡的是「差一个数量级」的截断/坏数据，而不是手工目录里 count 没跟上。
 */
export function validateCatalogPayload(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: '返回的不是 JSON 对象。' }
  }
  if (!Array.isArray(raw.plugins)) {
    return { ok: false, message: '缺少 plugins 数组。' }
  }
  if (!Number.isFinite(raw.count)) {
    return { ok: false, message: '缺少数字类型的 count。' }
  }
  const declared = raw.count
  const actual = raw.plugins.length
  // count 声明有内容却给不出条目：这不是「目录很小」，是坏数据（截断/清空）。
  if (declared > 0 && actual === 0) {
    return { ok: false, message: `count 声明 ${declared} 个插件，但 plugins 是空的。` }
  }
  // 小目录（≤100）至少给 5 条余量：手工维护的源里 count 写错几条很常见，
  // 而那些目录本身就只有几十条——按 1% 算容差 1 会把它们整源拒掉。
  const tolerance = declared <= 100 ? 5 : Math.max(5, Math.ceil(declared * 0.02))
  if (Math.abs(actual - declared) > tolerance) {
    return { ok: false, message: `count（${declared}）与 plugins 条数（${actual}）相差过大，疑似截断或坏数据。` }
  }
  return { ok: true }
}

/** 分类标签表：源里是 { id: { zh, en } }，也容忍纯字符串。 */
export function normalizeLabels(raw) {
  const labels = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return labels
  for (const [id, value] of Object.entries(raw)) {
    if (id === '') continue
    if (typeof value === 'string') {
      labels[id] = { zh: value, en: value }
      continue
    }
    if (value !== null && typeof value === 'object') {
      labels[id] = { zh: text(value.zh), en: text(value.en) }
    }
  }
  return labels
}

/** 单条目录项 → 契约 §2.2 的 item 形状；不做过滤，源里有多少条就产出多少条。 */
export function normalizeItem(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const name = optionalText(source.name) ?? ''
  const owner = optionalText(source.owner) ?? ''
  const npm = optionalText(source.npm)
  const url = optionalText(source.url)
  // 契约 §2.2：spec 优先级 npm → 仓库地址 → null；spec 为空即不可安装。
  const spec = npm ?? url ?? null

  const rawDescription = source.description
  const description =
    typeof rawDescription === 'string'
      ? { zh: rawDescription, en: rawDescription }
      : {
          zh: text(rawDescription?.zh),
          en: text(rawDescription?.en)
        }

  const capabilities = Array.isArray(source.capabilities)
    ? source.capabilities.filter((entry) => typeof entry === 'string' && entry !== '')
    : []

  return {
    id: owner === '' ? name : `${owner}/${name}`,
    name,
    owner,
    npm,
    spec,
    installable: spec !== null,
    version: optionalText(source.version),
    category: optionalText(source.category) ?? 'other',
    description,
    url,
    page: optionalText(source.page),
    stars: numberOrNull(source.stars) ?? 0,
    downloads: numberOrNull(source.downloads),
    added: optionalText(source.added),
    capabilities,
    install: optionalText(source.install),
    // 以下四项是 join 结果的位置；先给默认值，保证 item 形状恒定。
    installed: false,
    installedVersion: null,
    enabled: null,
    updateAvailable: false
  }
}

/**
 * 分类计数（契约 §2.2）：只保留目录里真实存在且 count>0 的分类，按 count 降序。
 * 用全量目录算，不受当前筛选影响，否则 chips 会随搜索跳动。
 */
export function categoryCounts(plugins, labels = {}) {
  const counts = new Map()
  for (const item of Array.isArray(plugins) ? plugins : []) {
    const id = typeof item?.category === 'string' && item.category !== '' ? item.category : 'other'
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([id, count]) => {
      const label = labels[id] ?? {}
      return {
        id,
        zh: typeof label.zh === 'string' && label.zh !== '' ? label.zh : id,
        en: typeof label.en === 'string' && label.en !== '' ? label.en : id,
        count
      }
    })
    .sort((a, b) => b.count - a.count || compareText(a.id, b.id))
}

/**
 * 原始目录 → 缓存快照（不含 fetchedAt/stale，那两项由缓存层填）。
 * source 用抓取时实际请求的地址，而不是源文件里自称的仓库地址。
 */
export function normalizeCatalog(raw, options = {}) {
  const plugins = (Array.isArray(raw?.plugins) ? raw.plugins : []).map(normalizeItem)
  const categoryLabels = normalizeLabels(raw?.categories)
  const source =
    optionalText(options.source) ?? optionalText(raw?.url) ?? optionalText(raw?.source) ?? DEFAULT_SOURCE
  return {
    source,
    updated: optionalText(raw?.updated),
    // count 用实际规范化出来的条数：契约示例里两者相等，以实际数据为准更不容易骗客户端。
    count: plugins.length,
    categoryLabels,
    categories: categoryCounts(plugins, categoryLabels),
    plugins
  }
}

function compareText(a, b) {
  const left = text(a).toLowerCase()
  const right = text(b).toLowerCase()
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * 搜索归一化的**记忆化**包装。
 *
 * 为什么需要：客户端搜索框有 300ms 防抖，所以**不是**每个按键都发请求；但每敲完
 * 一个词（防抖落定）就要发一次 /catalog，翻页、改排序、切分类、刷新目录各发一次，
 * 每次请求都要把整份目录的参与匹配字段重新折叠一遍。用真实快照（4412 条）量过，
 * 一次请求折叠 30884 个字符串 = **约 33ms 同步 CPU**，其中 normalization + 去组合符
 * 占 24ms（`\p{M}+` 正则扫 1.5M 字符最贵）。这段时间花在**宿主的事件循环**上，
 * 它同时还在跑流式输出。同一个词搜第二次、翻页、改排序时字段都没变，折叠结果可以
 * 复用：光这一处记忆化就把整个请求从约 53ms 降到约 18ms（再叠上下面 matchIndexFor
 * 的索引记忆化，共约 8ms）。
 *
 * 缓存键是**字符串本身**（不是条目对象、也不是 id）：joinInstalled 每次请求都用
 * `{...item}` 造新对象，挂在对象上的 WeakMap 永远命中不了；而且目录刷新后条目对象
 * 会整批换掉。按内容缓存与这两种情况都无关，且同样的字符串天然共享结果
 * （`dsh-drag-and-drop` 这类重名在目录里大量重复）。
 *
 * 上界：到了 FOLD_CACHE_CAP 就整个清空。不清空会让一个长时间运行、目录频繁刷新的
 * 宿主缓慢涨内存；全清只损失一次冷启动（约 30ms），换取上界确定且实现足够短。
 * 真实目录的参与匹配字段合计约 1.5M 字符、25606 个去重字符串，所以 65536 是 2.6 倍余量，
 * 实际几乎碰不到清空路径。**真到达上界时堆增长实测约 18MB**（不是「几 MB」——这是我
 * 最初写注释时的乐观估计，被独立审计量出来纠正了）；相对整份目录快照仍算小。
 */
const FOLD_CACHE_CAP = 65536
const foldCache = new Map()

function foldText(value) {
  if (typeof value !== 'string' || value === '') return ''
  const hit = foldCache.get(value)
  if (hit !== undefined) return hit
  // NFKD 把 `é` 拆成 `e` + 组合符，再把组合符去掉：`José` 要能被 `jose` 搜到
  //（真实目录里有 25 条描述带 Latin-1 重音）。
  const folded = value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
  if (foldCache.size >= FOLD_CACHE_CAP) foldCache.clear()
  foldCache.set(value, folded)
  return folded
}

/**
 * 搜索：**逐字段**匹配，空白分隔的多个词是「与」（市场类应用的常规语义）。
 *
 * 之前把各字段拼成一个大 haystack 再 `includes`，有个真实缺陷：字段之间用 `\n` 连接，
 * 跨字段的子串也能命中（`beta\nalpha` 匹配「名字叫 beta、作者是 alpha」）。
 * 现在字段各自归一化，词必须落在**同一个字段**里，且所有词都要命中。
 *
 * `url` **保留**在字段里：用户从 GitHub/目录页复制一个仓库地址粘进搜索框是常见操作，
 * 去掉它会让 `https://github.com/owner/repo` 搜出 0 条（回归）。
 * 「搜 `github` 出全量」的噪音主要来自描述里写了 github，不是 url——两者都不能靠删字段解决，
 * 靠的是**分词 + 逐字段**：搜完整地址能精确命中，搜单个通用词仍会有较多结果（这是搜索的本来语义）。
 */
function matchesQuery(item, query) {
  const tokens = String(query).split(/\s+/).filter((token) => token !== '')
  if (tokens.length === 0) return true
  const fields = [
    item.id,
    item.name,
    item.owner,
    item.npm,
    item.description?.zh,
    item.description?.en,
    Array.isArray(item.capabilities) ? item.capabilities.join(' ') : ''
  ]
    .map(foldText)
    .filter((value) => value !== '')
  const url = foldText(item.url)
  if (fields.length === 0 && url === '') return false
  // 每个词都要落在某个字段里（同一字段内即可，不跨字段拼）。
  return tokens.every((token) => {
    if (fields.some((field) => field.includes(token))) return true
    // 仓库地址只在「这个词看起来是个地址/路径」时才参与匹配：用户粘贴
    // `https://github.com/owner/repo` 或 `github.com/owner/repo` 能精确命中；
    // 而搜 `github` 这种通用词不会因为每条都有 github 地址就返回全量。
    return url !== '' && /[/.]/.test(token) && url.includes(token)
  })
}

/** 契约 §2.2 的 query/category/installed/updates 过滤。 */
export function filterPlugins(plugins, options = {}) {
  const list = Array.isArray(plugins) ? plugins : []
  // 与 matchesQuery 用同一套归一化（小写 + 去变音符号），否则 `José` 搜 `jose` 会先在这里落空。
  const query = foldText(typeof options.query === 'string' ? options.query.trim() : '')
  const category =
    typeof options.category === 'string' && options.category !== '' && options.category !== 'all'
      ? options.category
      : null

  return list.filter((item) => {
    if (category !== null && item.category !== category) return false
    if (options.installedOnly === true && item.installed !== true) return false
    if (options.updatesOnly === true && item.updateAvailable !== true) return false
    if (query !== '' && !matchesQuery(item, query)) return false
    return true
  })
}

function numberDesc(a, b) {
  const left = typeof a === 'number' && Number.isFinite(a) ? a : null
  const right = typeof b === 'number' && Number.isFinite(b) ? b : null
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

/** added 是 ISO 日期串，字典序降序等价于时间降序；缺失排最后。 */
function dateDesc(a, b) {
  const left = typeof a === 'string' && a !== '' ? a : null
  const right = typeof b === 'string' && b !== '' ? b : null
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (left === right) return 0
  return left < right ? 1 : -1
}

/** 契约 §2.2 的四种排序；未知值直接抛错，因为调用方应该先校验过（避免悄悄回默认）。 */
export function sortPlugins(plugins, sort = 'top') {
  const list = Array.isArray(plugins) ? plugins.slice() : []
  const byName = (a, b) => compareText(a.name, b.name)
  const comparators = {
    top: (a, b) => numberDesc(a.stars, b.stars) || numberDesc(a.downloads, b.downloads) || byName(a, b),
    new: (a, b) => dateDesc(a.added, b.added) || numberDesc(a.stars, b.stars) || byName(a, b),
    downloads: (a, b) => numberDesc(a.downloads, b.downloads) || numberDesc(a.stars, b.stars) || byName(a, b),
    name: (a, b) => byName(a, b) || compareText(a.owner, b.owner)
  }
  const comparator = comparators[sort]
  if (comparator === undefined) {
    throw new Error(`未知排序：${sort}（只能是 top / new / downloads / name）`)
  }
  // 兜底键：`id` 在目录内唯一，用它保证**全序**。
  // 只靠 stars/downloads/name 比较时，同名免 scope 包（真实数据里有 171 组完全并列）会返回 0，
  // 于是并列组的先后由输入顺序决定——刷新一次源顺序变了，同一个插件就可能换页位。
  // 全序让「同样的数据 → 同样的分页」，不会在两页边界上重复或漏掉条目。
  list.sort((a, b) => comparator(a, b) || compareText(a.id, b.id))
  return list
}

/**
 * 契约 §2.2 的 page/pageSize。
 *
 * `page` 超出末页时**收敛到末页**（而不是回一个空页）：市场类应用的常规做法。
 * 之前返回空 items 而 page 仍是原值，界面会显示「共 N 个结果 · 第 5/2 页」+ 空网格——
 * 用户在第 5 页时刷新目录/改筛选让结果变少，就会卡在这个自相矛盾的状态里
 * （客户端只在改搜索条件时重置页码，目录刷新不会）。
 * `pages` 仍按 total 算，`total` 仍是筛选后的真实条数。
 */
export function paginate(items, page = 1, pageSize = 24) {
  const list = Array.isArray(items) ? items : []
  const total = list.length
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 24
  const requested = Number.isSafeInteger(page) && page > 0 ? page : 1
  const pages = Math.max(1, Math.ceil(total / size))
  const current = Math.min(requested, pages)
  const start = (current - 1) * size
  return {
    page: current,
    requestedPage: requested,
    pageSize: size,
    total,
    pages,
    items: list.slice(start, start + size)
  }
}

function parseVersion(value) {
  const raw = optionalText(value)
  if (raw === null) return null
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw)
  if (match === null) return null
  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    pre: match[4] ?? null
  }
}

function comparePrerelease(a, b) {
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const l = left[index]
    const r = right[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const lNumber = /^\d+$/.test(l) ? Number(l) : null
    const rNumber = /^\d+$/.test(r) ? Number(r) : null
    if (lNumber !== null && rNumber !== null) {
      if (lNumber !== rNumber) return lNumber < rNumber ? -1 : 1
      continue
    }
    // 数字标识符小于字母标识符（semver §11）。
    if (lNumber !== null) return -1
    if (rNumber !== null) return 1
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/**
 * 版本比较（semver 子集）：返回 -1/0/1，无法比较时返回 null。
 * 支持可选 v 前缀、缺省 minor/patch、预发布号；忽略 build metadata。
 */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] < right.parts[index] ? -1 : 1
  }
  if (left.pre !== null && right.pre === null) return -1
  if (left.pre === null && right.pre !== null) return 1
  if (left.pre !== null && right.pre !== null) return comparePrerelease(left.pre, right.pre)
  return 0
}

/**
 * 是否有更新：只认目录版本严格高于已安装版本（契约 §2.2）。
 * 版本相同、目录更低、任一侧缺失或不可比较 → false。
 * `latest` 仍然展示目录里的当前版本（可能低于已装版本），但那种情况不该渲染成「更新」。
 */
export function isUpdateAvailable(installedVersion, catalogVersion) {
  if (optionalText(installedVersion) === null || optionalText(catalogVersion) === null) return false
  const compared = compareVersions(catalogVersion, installedVersion)
  return compared !== null && compared > 0
}

/**
 * 仓库地址尾段：**仓库名**，不是 URL 的最后一个路径段。
 *
 * 后者不是身份——monorepo 子目录 URL（`…/owner/repo/tree/main/packages/dsh-plugin`）的最后一段
 * 会变成 `dsh-plugin`，甚至 `dsh` / `bundle` / `client` 这类通用词，与别的仓库撞车
 * （实测 4412 条里 471 条含 `/tree/`，435 条的最后一段不等于仓库名）。所以先砍掉
 * `/tree/`、`/blob/` 这类「仓库内位置」标记及其后面的部分，再取最后一段。
 */
export function repoTail(url) {
  const segments = repoSegments(url)
  return segments === null ? null : segments[segments.length - 1]
}

/**
 * 仓库地址的身份段：`[owner, repo]`。
 *
 * **不能取 URL 的最后一段**：monorepo 子目录地址（`…/owner/repo/tree/main/packages/dsh-plugin`）
 * 的最后一段会变成 `dsh-plugin`，甚至 `dsh` / `bundle` / `client` 这类通用词，与别的仓库撞车
 * ——实测 4412 条里 471 条的 URL 带 `/tree/…`，435 条的最后一段不等于仓库名，`dsh` 这一个键
 * 会被两个不同仓库争抢。
 *
 * 所有主流代码托管（GitHub / GitLab / Gitea…）的仓库都固定落在前两段：`/<owner>/<repo>/…`。
 * 所以直接取前两段，比「先找 /tree/ 再回溯」简单且没有边界坑（仓库恰好叫 `tree`、owner 恰好叫
 * `tree`、GitLab 的 `/-/tree/` 形态——启发式在那几种输入上都会算错）。
 */
function repoSegments(url) {
  const value = optionalText(url)
  if (value === null) return null
  let pathname = value
  try {
    pathname = new URL(value).pathname
  } catch {
    // 非绝对 URL（`git@host:owner/repo.git`）：剥掉协议与 user@host 前缀后按分隔符切。
    pathname = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/@]*@[^/:]*:/, '')
  }
  const cleaned = String(pathname).replace(/[?#].*$/, '').replace(/\.git$/i, '')
  const segments = cleaned.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) return null
  return segments.length >= 2 ? [segments[0], segments[1]] : [segments[0]]
}

function normalizedKey(value) {
  const text = optionalText(value)
  return text === null ? null : text.toLowerCase()
}

/**
 * 匹配索引（契约 §2.3）。按身份可信度分三层，**歧义不猜**：
 *
 *  - `npmKeys`：npm 名（含 scope）是唯一身份；
 *  - `sharedKeys`：`owner/repo` 与 `@owner/repo`——这两个键可能对应**同一仓库的多个子插件**
 *    （真实目录里 `DamonKoy/dsh-web-ui#dsh-aionui-panel`、`#dsh-liangshen`… 十行同属一个仓库），
 *    装了那个仓库就等于装了它们，所以这类键存**一组**条目，命中时全部标为已安装；
 *  - `nameKeys`：裸的 `repo` 名——不同 owner 可能重名（`AKIRACOD/dsh-drag-and-drop` vs
 *    `bill9109/dsh-drag-and-drop`），冲突时标记歧义、不匹配（宁可不显示，也不能指错人）。
 *
 * `@owner/仓库名` 也是「从 git 地址安装、package.json 的 name 带 scope」的合法场景所必需：
 * `dsh plugin add https://github.com/bycall/xxx` 装出来的包常叫 `@bycall/xxx`，而目录里那条的
 * `npm` 是无 scope 的 `xxx`（真实目录 1431 条是这种形态）。
 *
 * **但不能反过来「把 bundle 的 scope 剥掉去查」**：那会让目录里根本不存在的 `@随便/xxx`
 * 命中 `npm === xxx` 的**另一个包**（假「已安装/可更新」，点更新还会装错包）。
 * 差别就在 **owner 要不要对上**。
 */
function buildMatchIndex(plugins) {
  const npmKeys = new Map()
  const sharedKeys = new Map()
  // 裸仓库名：只有「同一个仓库的多条」才共享；**不同仓库**（不同 owner）争用同名时才判歧义。
  const nameKeys = new Map()
  const put = (index, key, item, { exclusive = true } = {}) => {
    const normalized = normalizedKey(key)
    if (normalized === null) return
    if (exclusive) {
      const existing = index.get(normalized)
      if (existing === undefined) index.set(normalized, item)
      else if (existing !== item) index.set(normalized, AMBIGUOUS)
      return
    }
    // 共享键（同一仓库的多个条目）：存一组，**不**因多条目而判歧义。
    const list = index.get(normalized)
    if (list === undefined) index.set(normalized, [item])
    else if (list !== AMBIGUOUS && !list.includes(item)) list.push(item)
  }
  /** 裸仓库名：同一个仓库的多条共享，不同仓库争用则歧义（`AKIRACOD/x` vs `bill9109/x`）。 */
  const putBareName = (repo, repoKey, item) => {
    // **必须用 normalizedKey 当键**：查表一律走 lookupKey，而它会把探针小写化
    // （`normalizedKey`）。这里若直接用原始 repo 名当键，含大写字母的仓库名
    // （真实目录里 88 个，如 `bill277048-hash/DSH-model-router`）永远查不到自己；
    // 更糟的是小写探针会命中**另一个** owner 的同名小写仓库，把别人的包标成
    // 「已安装 / 可更新」——正是本文件注释里明令禁止的「指错人」。
    // 实测（真实 4412 条）：这 88 个里 0 个命中自己、5 个标错到别的插件。
    const key = normalizedKey(repo)
    if (key === null) return
    const existing = nameKeys.get(key)
    if (existing === undefined) {
      nameKeys.set(key, { repoKey, items: [item] })
      return
    }
    if (existing === AMBIGUOUS) return
    if (existing.repoKey !== repoKey) {
      nameKeys.set(key, AMBIGUOUS)
      return
    }
    if (!existing.items.includes(item)) existing.items.push(item)
  }
  for (const item of plugins) {
    const owner = optionalText(item.owner)
    // monorepo 子插件的 `name` 形如 `dsh-gungnir#dsh-plugin`（`#` 后是子目录名），
    // 仓库名是 `#` 之前那段——带 owner 的别名要按仓库名注册，否则 @owner/repo 对不上。
    const rawName = optionalText(item.name)
    const base = rawName === null ? null : rawName.split('#')[0].trim()
    if (owner !== null && base !== null && base !== '') {
      // 带 owner 的别名对两类条目都注册：npm 条目与仓库条目都可能被「@owner/名字」装进来。
      put(sharedKeys, `@${owner}/${base}`, item, { exclusive: false })
    }
    if (optionalText(item.npm) !== null) {
      put(npmKeys, item.npm, item)
      continue
    }
    const segments = repoSegments(item.url)
    if (segments === null || segments.length < 2) continue
    const repo = segments[1]
    const repoKey = normalizedKey(`${segments[0]}/${repo}`)
    put(sharedKeys, `${segments[0]}/${repo}`, item, { exclusive: false })
    put(sharedKeys, `@${segments[0]}/${repo}`, item, { exclusive: false })
    putBareName(repo, repoKey, item)
  }
  return { npmKeys, sharedKeys, nameKeys }
}

/** 索引里被标记为歧义的键：存在但不是唯一候选。 */
const AMBIGUOUS = Symbol('ambiguous-repo-key')

function lookupKey(index, key) {
  const normalized = normalizedKey(key)
  if (normalized === null) return null
  const hit = index.get(normalized)
  if (hit === undefined || hit === AMBIGUOUS) return null
  // 裸仓库名存的是 { repoKey, items }：同一个仓库的多条一起返回。
  return hit !== null && typeof hit === 'object' && Array.isArray(hit.items) ? hit.items : hit
}

/**
 * bundle → 目录条目（契约 §2.3）。返回**数组**：共享键（同一仓库的多个子插件）会一次命中多条。
 *
 * 顺序即可信度：npm 名 → `owner/repo` / `@owner/repo`（共享）→ 裸仓库名。
 * **不再剥 scope 再查**：`@unknownorg/foo` 与目录里的 `foo` 是两个不同的包，
 * 拿它去命中「npm 恰好叫 foo」的条目会让用户看到假的「已安装 / 可更新」，
 * 点更新还会装成另一个包（实测 1431 条无 scope 条目会被任意 `@随便/同名` 撞上）。
 */
function matchBundle(index, bundle) {
  if (bundle === null || typeof bundle !== 'object') return []
  const name = optionalText(bundle.name)
  if (name === null) return []
  const npm = lookupKey(index.npmKeys, name)
  if (npm !== null) return [npm]
  const shared = lookupKey(index.sharedKeys, name) ?? lookupKey(index.nameKeys, name)
  if (shared === null) return []
  return Array.isArray(shared) ? shared : [shared]
}

/**
 * 匹配索引的按数组身份记忆化（只留最新一份，所以不叫缓存）。
 *
 * 为什么：buildMatchIndex 要遍历整份目录，真实规模（4412 条）量到 **约 12ms**。
 * 而它是**按同一个缓存快照数组反复重建**的：防抖落定后的每次 /catalog 都调一次
 * joinInstalled（翻页、改排序同理），/installed 里 joinBundles 还要再建一次。
 * 这些 12ms 都烧在宿主的事件循环上（它同时还在跑流式输出）。
 * 快照数组是不可变的（lib 内没有任何原地改写，createCatalogCache 换目录时整个替换
 * 数组），所以身份相同的数组 → 索引必然相同。
 *
 * 为什么按**数组身份**而不是把 WeakMap 键在条目对象上：joinInstalled 每次请求都用
 * `{...item}` 造新对象，键在条目上的缓存永远命中不了；而快照数组本身是稳定引用。
 * 「目录刷新后必须重建」由身份天然保证——新数组就是新键，不需要额外失效逻辑。
 *
 * 为什么不做成无界 Map：只留最新一份，被替换掉的旧索引交给 GC。
 */
let indexMemoKey = null
let indexMemoValue = null

function matchIndexFor(plugins) {
  if (indexMemoKey === plugins && indexMemoValue !== null) return indexMemoValue
  const index = buildMatchIndex(plugins)
  indexMemoKey = plugins
  indexMemoValue = index
  return index
}

/**
 * 契约 §2.2：已安装信息 join。返回新数组，不改动缓存里的原对象
 * （缓存被复用，任何原地写入都会污染后续请求）。
 */
export function joinInstalled(plugins, bundles) {
  const list = Array.isArray(plugins) ? plugins : []
  const index = matchIndexFor(list)
  const matched = new Map()
  for (const bundle of Array.isArray(bundles) ? bundles : []) {
    // 一个 bundle 可能对应同一仓库的多个条目（多子插件仓库）：全部标为已安装。
    for (const item of matchBundle(index, bundle)) {
      if (!matched.has(item)) matched.set(item, bundle)
    }
  }
  return list.map((item) => {
    const bundle = matched.get(item)
    if (bundle === undefined) {
      return { ...item, installed: false, installedVersion: null, enabled: null, updateAvailable: false }
    }
    const installedVersion = optionalText(bundle.version)
    return {
      ...item,
      installed: true,
      installedVersion,
      enabled: bundle.enabled === true,
      updateAvailable: isUpdateAvailable(installedVersion, item.version)
    }
  })
}

/** 契约 §2.3：bundle 视角的 join，补 latest / updateAvailable。
 *  一个 bundle 命中同一仓库的多个条目时取**最高**目录版本（那个仓库里最新的那个）。 */
export function joinBundles(bundles, plugins) {
  const list = Array.isArray(bundles) ? bundles : []
  const index = matchIndexFor(Array.isArray(plugins) ? plugins : [])
  return list.map((bundle) => {
    const hits = matchBundle(index, bundle)
    let latest = null
    for (const item of hits) {
      if (item.version === null || item.version === undefined) continue
      if (latest === null || compareVersions(item.version, latest) === 1) latest = item.version
    }
    return {
      ...bundle,
      latest,
      updateAvailable: isUpdateAvailable(bundle?.version, latest)
    }
  })
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
    : { ok: false, kind: 'network', reason: `请求失败：${describeError(error)}` }
}

function describeError(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

/**
 * 目录缓存：TTL 10 分钟；并发抓取共用同一个 in-flight Promise；
 * 失败时保留旧缓存并置 stale；完全无缓存时返回错误码而不是空目录。
 * 每个源只试一次——源列表（镜像 → npm 官方 → 官方 URL）本身就是重试。
 */
export function createCatalogCache(options = {}) {
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : globalThis.fetch
  const env = options.env ?? process.env
  const now = typeof options.now === 'function' ? options.now : Date.now
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : CACHE_TTL_MS
  const cooldownMs = Number.isFinite(options.failureCooldownMs) ? options.failureCooldownMs : FAILURE_COOLDOWN_MS
  const explicitSources = Array.isArray(options.sources) ? options.sources : null
  const explicitSource = optionalText(options.source)
  const singleTimeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : CUSTOM_URL_TIMEOUT_MS

  let current = null
  let inflight = null
  let lastFailure = null

  const sourcesOf = () => {
    if (explicitSources !== null) return explicitSources
    if (explicitSource !== null) {
      return [
        {
          kind: 'url',
          url: explicitSource,
          timeoutMs: singleTimeoutMs,
          label: explicitSource,
          short: hostOf(explicitSource)
        }
      ]
    }
    return resolveSources(env)
  }

  /** 首个源的展示名，仅供诊断日志使用（/status 已不再报「当前源」）。 */
  const sourceLabel = () => {
    const list = sourcesOf()
    return list.length > 0 ? list[0].label : DEFAULT_SOURCE
  }

  async function readUrlSource(source) {
    if (typeof fetchImpl !== 'function') {
      return { ok: false, kind: 'network', reason: '当前运行环境没有 fetch' }
    }
    let response
    try {
      // 只发 GET、不带凭据、不落盘。
      response = await fetchImpl(source.url, {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        headers: { accept: 'application/json' },
        signal: timeoutSignal(source.timeoutMs)
      })
    } catch (error) {
      return classifyFetchError(error, source.timeoutMs)
    }
    if (response === null || response === undefined || typeof response.ok !== 'boolean') {
      return { ok: false, kind: 'network', reason: '响应无法识别' }
    }
    if (response.ok !== true) {
      return { ok: false, kind: response.status >= 500 ? 'http' : 'http-4xx', reason: `HTTP ${response.status}` }
    }
    let body
    try {
      body = await response.text()
    } catch (error) {
      return classifyFetchError(error, source.timeoutMs)
    }
    if (looksLikeHtml(body)) {
      return { ok: false, kind: 'not-json', reason: '返回的是网页（HTML）而不是 JSON' }
    }
    let raw
    try {
      raw = JSON.parse(body)
    } catch {
      return { ok: false, kind: 'not-json', reason: '正文不是合法 JSON' }
    }
    return { ok: true, raw, label: source.url }
  }

  /** 所有源都失败时，把「试过哪些源、各自为什么失败」写进文案，并给出两条出路。 */
  function toFailure(attempts) {
    const tried = attempts.map((attempt) => `${attempt.short ?? attempt.label}：${attempt.reason}`).join('；')
    const fix = '可以设 DSHM_REGISTRY_URL 指向你自己的 plugins.json，或设 DSHM_NPM_MIRROR 换一个 npm 镜像。'
    if (attempts.length === 0) {
      return { ok: false, code: 'catalog-unavailable', status: 502, message: '没有可用的目录源。', hint: fix, attempts }
    }
    const allTimeout = attempts.every((attempt) => attempt.kind === 'timeout')
    if (allTimeout) {
      return {
        ok: false,
        code: 'catalog-timeout',
        status: 504,
        message: '所有目录源都超时了。',
        hint: `依次试过 ${tried}。网络可能不通或源站很慢；稍后点「刷新目录」重试，上次的目录结果仍会展示。${fix}`,
        attempts
      }
    }
    return {
      ok: false,
      code: 'catalog-unavailable',
      status: 502,
      message: '所有目录源都取不到数据。',
      hint: `依次试过 ${tried}。检查网络后点「刷新目录」重试。${fix}`,
      attempts
    }
  }

  async function fetchCatalog() {
    const attempts = []
    for (const source of sourcesOf()) {
      const result =
        source.kind === 'npm' ? await readCatalogFromNpm(source, { fetch: fetchImpl }) : await readUrlSource(source)
      if (result.ok === true) {
        const validation = validateCatalogPayload(result.raw)
        if (validation.ok === true) return { ok: true, raw: result.raw, source: result.label ?? source.label }
        attempts.push({ label: source.label, short: source.short, kind: 'invalid', reason: `结构不符：${validation.message}` })
        continue
      }
      attempts.push({ label: result.label ?? source.label, short: source.short, kind: result.kind, reason: result.reason })
    }
    return toFailure(attempts)
  }

  async function load(force) {
    if (force !== true) {
      const fresh = current !== null && current.stale !== true && now() - current.fetchedAtMs < ttlMs
      if (fresh) return { ok: true, cache: current, cached: true }
      if (lastFailure !== null && now() - lastFailure.at < cooldownMs) {
        if (current !== null) {
          return { ok: true, cache: current, staleFallback: true, error: lastFailure.code, attempts: lastFailure.attempts }
        }
        return {
          ok: false,
          code: lastFailure.code,
          status: lastFailure.status,
          message: lastFailure.message,
          hint: lastFailure.hint,
          attempts: lastFailure.attempts
        }
      }
    }

    if (inflight === null) {
      // 并发抓取共用同一个 Promise：契约 §3.4 明确要求，也避免同一瞬间把整份源列表打一遍。
      inflight = fetchCatalog().finally(() => {
        inflight = null
      })
    }
    const result = await inflight

    if (result.ok === true) {
      // 并发等待者拿到的是**同一个** result 对象：只让第一个归一化，其余复用同一份快照。
      // 不这么做的话，N 个并发调用会对同一份 raw 各跑一次 normalizeCatalog（每次约 2.5ms
      // 同步 CPU），而且各造一份新的 plugins 数组——按数组身份记忆化的 matchIndexFor
      // 会被每一份新数组逐个击破，等于没缓存。冷启动瞬间客户端会并发打好几个接口。
      if (result.normalized === undefined) {
        const fetchedAtMs = now()
        result.normalized = {
          ...normalizeCatalog(result.raw, { source: result.source }),
          fetchedAt: new Date(fetchedAtMs).toISOString(),
          fetchedAtMs,
          stale: false,
          error: null
        }
      }
      current = result.normalized
      lastFailure = null
      return { ok: true, cache: current }
    }

    lastFailure = {
      at: now(),
      code: result.code,
      status: result.status,
      message: result.message,
      hint: result.hint,
      attempts: result.attempts
    }
    if (current !== null) {
      // 契约 §2.2 / §2.7：失败保留旧缓存并置 stale，但显式刷新要如实报错。
      current = { ...current, stale: true, error: result.code }
      if (force === true) {
        return {
          ok: false,
          code: result.code,
          status: result.status,
          message: result.message,
          hint: result.hint,
          attempts: result.attempts
        }
      }
      return { ok: true, cache: current, staleFallback: true, error: result.code, attempts: result.attempts }
    }
    return {
      ok: false,
      code: result.code,
      status: result.status,
      message: result.message,
      hint: result.hint,
      attempts: result.attempts
    }
  }

  return {
    /** 首个源的展示名，仅供日志诊断。 */
    source: sourceLabel,
    /** 当前生效的完整源列表，按尝试顺序。 */
    sources: sourcesOf,
    /** 同步读取缓存；没有缓存时返回 null。 */
    peek: () => current,
    ensure: () => load(false),
    refresh: () => load(true),
    invalidate: () => {
      current = null
      lastFailure = null
    },
    config: { ttlMs, cooldownMs }
  }
}
