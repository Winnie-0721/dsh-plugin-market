/**
 * GitHub 多线路容错。
 *
 * 为什么需要：GitHub 的几条通道**各自独立地**会挂，而且挂法不同——
 * api.github.com 匿名限流 60 次/小时/IP 回 403；raw.githubusercontent.com 与
 * cdn.jsdelivr.net 时通时断；公共加速前缀则经常整体下线。
 * 本机一轮实测（`_verify/routes-live2.mjs`，同一分钟内）：
 *
 *   raw.githubusercontent.com   4 个文件连续 UND_ERR_CONNECT_TIMEOUT，第 5 个 256ms 200
 *   cdn.jsdelivr.net            ECONNRESET（同一刻 fastly./testingcf. 两个镜像 200）
 *   ghproxy.net → api.github.com 403       gh-proxy.com → api.github.com 200（带 digest）
 *
 * 也就是说「哪条线路活着」是**时变**的，任何写死单条地址的实现迟早会整条通道失效。
 * 而我们原有的自更新四个源里，有两个走 cdn.jsdelivr.net（本机死）、一个是
 * api.github.com（会被限流）、剩下两个标签探测也走 jsDelivr——实测**一次都成功不了**：
 *   check() 12.4s → self-update-unavailable（`_verify/baseline-selfupdate.mjs`）
 *
 * 本模块做三件事，每一件都对应上面一种挂法：
 *   1. **每个服务一组候选线路**，按本机实测的可用性排序，逐个试到成功为止；
 *   2. **记住这轮验证通过的线路**，下次把它提到最前（少付几次超时的代价）；
 *   3. **校验载荷**，拒绝「加速服务用 200 回一个自己的错误页」——不然会把一条
 *      永远返回不了数据的线路记成"可用"，之后每次请求都先撞它。
 *
 * 线路是「前缀」而不是改写主机名：`{prefix}/{完整URL}`。这也是参考实现
 * （dsh-market `src/regions.ts` 的 `throughProxy`）的约定，实测 gh-proxy.com 与
 * gh-proxy.org 都接受这种形状。
 *
 * 安全边界（不许放宽）：
 *   - 只允许 **https** 前缀，不带上游凭据、不带 query/fragment（`normalizeGithubProxy`）；
 *   - **带认证的请求永远不走公共前缀**。本模块只服务匿名读（版本清单、附件、原始文件）；
 *     市场没有任何一处把 token 交给它，这条写在这里是为了将来加认证接口时先看见它。
 *   - 直连永远在候选表里：加速前缀是第三方，能用不代表该用。
 */

// Buffer 的 import 原先只被 readBody 用；有界读取搬进 http-body.js 后这里是死代码，删掉。
import { readBoundedBody } from './http-body.js'

/**
 * 会各自独立失败的几类传输。
 *
 * `api` / `raw` / `download` 是 GitHub 自己的三条通道；`cdn` 是 jsDelivr 一家
 * （它镜像 GitHub 内容，但三个边缘域名同样各自独立地挂——本机实测
 * cdn.jsdelivr.net ECONNRESET 的同一刻，fastly./testingcf. 两个域名 200）。
 */
export const GITHUB_SERVICES = ['api', 'raw', 'download', 'cdn']

/** 操作员覆盖：一个持久的 HTTPS 前缀，管住所有服务（与 DSHM_REGISTRY_URL 同风格）。 */
export const GITHUB_PROXY_ENV = 'DSHM_GITHUB_PROXY'

/** 单条线路的超时。整条链另有总预算，见 DEFAULT_TOTAL_BUDGET_MS。 */
export const ROUTE_TIMEOUT_MS = 8_000

/**
 * 线路响应的字节上限（审查任务 1）。依据是真实测量（`_verify/payload-sizes.mjs`，
 * 2026-10-16 本机）：GitHub Release API JSON 53 KB、jsDelivr Data API 2.8 KB、
 * Release 附件 tarball 0.18 MiB。JSON/文本取 4 MiB（约 80 倍余量）、
 * 二进制取 32 MiB（约 180 倍余量），都远大于合法载荷、远小于能伤到常驻进程的量。
 * 超限 = 该线路失败并**继续下一条**（不能把坏前缀记成赢家）。
 */
export const ROUTE_MAX_JSON_BYTES = 4 * 1024 * 1024
export const ROUTE_MAX_BYTES_BYTES = 32 * 1024 * 1024

/**
 * 平摊后分给单条线路的**下限**。
 *
 * 只是「别短到连 TCP 握手都不够」的护栏，不是预算的下界——调用方给的总预算仍然是
 * 硬上界（见 fetchViaGithubRoutes 里最后那次 `Math.min(…, remaining)`）。
 */
export const MIN_ROUTE_MS = 1_000

/**
 * 整条链的总预算，缺省等于**单条线路的超时**。
 *
 * 这个缺省值是刻意的：多线路不能让一次失败**变慢**。改装前每条地址各自 12s
 * （元数据）/ 30s（产物），整条链的预算取同一个数，最坏耗时就不变——
 * 只是这 12s 现在花在「多试几条线路」上，而不是全砸在第一条坏线路上。
 * 调用方要更长（例如一次 check() 想统管多跳）可以显式给 totalBudgetMs。
 */
export const DEFAULT_TOTAL_BUDGET_MS = null

/**
 * 每条服务的候选线路，`null` = 走规范地址（api 是 api.github.com，cdn 是 cdn.jsdelivr.net）。
 *
 * 排序依据是**本机实测**（见文件头那组数字），不是偏好：
 *   - `null` 放最前：直连是规范路径，能用就不该把流量交给第三方；
 *   - 加速前缀按实测可用性排，`gh-proxy.com` / `gh-proxy.org` 见过 200 且载荷正确；
 *   - `ghproxy.net`、`ghfast.top` 对 **api** 回 403（实测），所以不进 api 列表——
 *     但它们对 raw/附件是好的（附件实测 sha256 与 digest 逐字节一致），于是只出现在那两档。
 *   - `ghproxy.cc`（证书过期）、`gh.llkk.cc`（超时）、`ghp.ci`（DNS 不存在）实测全死，不收。
 *   - jsDelivr 三个域名是**互替主机**而不是前缀，所以走 cdn 档的 `{host:…}` 形状（见 routeUrl）。
 *
 * 每条列表**都含直连**：任何前缀整体下线时，最多是一次慢请求，而不是一次故障。
 */
const ROUTES = {
  api: [null, 'https://gh-proxy.com', 'https://gh-proxy.org'],
  raw: [null, 'https://gh-proxy.com', 'https://gh-proxy.org', 'https://ghfast.top', 'https://ghproxy.net'],
  download: [null, 'https://gh-proxy.com', 'https://gh-proxy.org', 'https://ghfast.top', 'https://ghproxy.net'],
  // 本机实测：cdn.jsdelivr.net 是 ECONNRESET，另两个边缘域名 200。直连放最前，
  // 它在本机是坏的——但线路表描述的是「候选」，不是「本机此刻的可用性」，
  // 换台机器/换个时刻主域名就又通了；失败会被记进 attempts 并自动换下一条。
  cdn: [null, { host: 'fastly.jsdelivr.net' }, { host: 'testingcf.jsdelivr.net' }, { host: 'gcore.jsdelivr.net' }]
}

/** 这轮验证通过的线路，下次提到最前。参考实现同样按「服务」记（`regions.ts`）。 */
const preferred = new Map()

/**
 * 刚失败过的线路（负缓存），短时间内不再优先重试。
 *
 * 为什么必须有：赢家会被提到最前，但**输家不会**——没有负缓存时，一次
 * `check()` 里的每个请求都要把同一条死线路再撞一遍。实测形状：一次检查会
 * 依次问 3 个列表源、再探 3 个候选标签，共 6 次请求；每次若都从直连开始撞
 * cdn.jsdelivr.net（本机 ECONNRESET），就是 6 次白等；而单条超时 8s、
 * 整条链预算 20s，最坏情况会把一次点击拖到几十秒。
 *
 * 只对「这条线路本身不可达/在敷衍」的失败记负分，**不对 404 记**：
 *   404 说明线路是通的，只是这个路径上没有内容——同一个线路上的**别的地址**
 *      完全可能存在。把 404 当线路故障会把一条好线路封掉，那是比慢更坏的错误。
 * 反过来，连接超时 / 连不上 / 403 限流 / 回 HTML 错误页，都是「这条线路现在
 * 给不了我东西」，与具体路径无关，于是值得记。
 */
const failures = new Map()

/** 负缓存的时长：够覆盖一次 check()，又不至于把一条线路钉死太久。 */
export const ROUTE_FAILURE_TTL_MS = 60_000

/**
 * 这个失败算不算「线路级」故障（值得负缓存）。
 *
 * `HTTP 404` 明确不算（见 failures 的注释）；`HTTP 5xx` 算——那是线路自己在报错，
 * 不是「没有这个内容」。`HTTP 403` 算（限流是针对线路的，换个路径也一样）。
 */
export function isRouteLevelFailure(reason) {
  if (typeof reason !== 'string') return false
  if (/HTTP 404/.test(reason)) return false
  if (/HTTP 4\d\d/.test(reason)) return true
  if (/HTTP 5\d\d/.test(reason)) return true
  if (/超时|ECONNRESET|ENOTFOUND|ECONNREFUSED|CERT_|UND_ERR|请求失败/.test(reason)) return true
  // 正文是 HTML / 不是合法 JSON：加速服务在敷衍，与路径无关。
  if (/HTML|JSON/.test(reason)) return true
  return false
}

/** 记一条失败（只记线路级故障；404 等路径级失败不算，见 failures 的注释）。 */
function noteRouteFailure(service, route, reason) {
  if (!isRouteLevelFailure(reason)) return
  failures.set(`${service}\u0000${keyOf(route)}`, Date.now())
}

/** 这条线路是不是刚失败过。 */
function recentlyFailed(service, route) {
  const key = `${service}\u0000${keyOf(route)}`
  const at = failures.get(key)
  if (at === undefined) return false
  if (Date.now() - at > ROUTE_FAILURE_TTL_MS) {
    failures.delete(key)
    return false
  }
  return true
}

/** 线路的稳定键（对象形状的 `{host}` 与字符串形状不能撞）。 */
function keyOf(route) {
  if (route === null) return 'direct'
  if (typeof route === 'object' && typeof route.host === 'string') return `host:${route.host}`
  return String(route)
}

/** 清掉负缓存与赢家（配置变化、测试之间）。 */
export function resetGithubRouteState() {
  preferred.clear()
  failures.clear()
}

/**
 * 只给诊断/测试看：当前负缓存里的线路。
 *
 * `route` 还原成**线路本身的形状**（直连是 `null`、互替主机是 `{host}`），
 * 而不是内部那个稳定键字符串——诊断输出的价值就在于让人一眼看出是哪条线路，
 * 把 `null` 显示成 `'direct'`、把 `{host:'x'}` 显示成 `'host:x'` 会让人以为
 * 线路表里真有一个叫 direct 的条目。
 */
export function failedGithubRoutes() {
  return [...failures.keys()].map((key) => {
    const [service, raw] = key.split('\u0000')
    if (raw === 'direct') return { service, route: null, label: '直连' }
    if (raw.startsWith('host:')) {
      const host = raw.slice('host:'.length)
      return { service, route: { host }, label: host }
    }
    return { service, route: raw, label: routeLabel(raw) }
  })
}

/** 操作员覆盖的前缀（进程级）。`null` 表示没有。 */
let customProxy = null

/**
 * 校验并规范化一个用户给的前缀；不合法返回 null。
 *
 * 只收 https、不带用户名/密码、不带 query/hash。公共加速前缀会把**完整目标 URL
 * 拼在路径上**，所以任何 query/fragment 都会把目标 URL 的边界弄坏；而带上游凭据的
 * 前缀等于把一个会转发到任意地址的服务当成认证代理——两者都必须拒绝而不是"尽力而为"。
 * 尾部斜杠归一化掉，避免拼出 `//https://`。
 */
export function normalizeGithubProxy(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '' || raw.includes('\\')) return null
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.search !== '' || parsed.hash !== '') return null
  const path = parsed.pathname.replace(/\/+$/u, '')
  return `${parsed.origin}${path}`
}

/** 读环境里的覆盖前缀；空白视作未设置。 */
export function githubProxyFrom(env = process.env) {
  return normalizeGithubProxy(env?.[GITHUB_PROXY_ENV])
}

/** 环境变量是否由操作员接管（UI 不该覆盖它）。 */
export function githubProxyManaged(env = process.env) {
  return optionalText(env?.[GITHUB_PROXY_ENV]) !== null
}

/** 设置（或清除）进程级覆盖前缀。值不合法时**清除**而不是猜一个能用的。 */
export function setCustomGithubProxy(value) {
  const next = value === null ? null : normalizeGithubProxy(value)
  if (next === customProxy) return
  customProxy = next
  resetGithubRoutePreferences()
}

/** 记一条已验证通过的线路。 */
export function rememberGithubRoute(service, route) {
  if (!GITHUB_SERVICES.includes(service)) return
  preferred.set(service, route ?? null)
}

/** 忘掉学到的赢家（配置变了、或测试之间）。 */
export function resetGithubRoutePreferences() {
  preferred.clear()
}

/** 只给诊断/测试看：当前记着的赢家。 */
export function preferredGithubRoutes() {
  return Object.fromEntries(preferred)
}


/**
 * 用户自己的前缀**插到最前**，而不是替换整张表（参考实现 #850 的结论）。
 *
 * 替换会「每遇到一次镜像故障就只买一次尝试」：用户填的那个前缀一旦挂了，
 * 剩下本来实测可用的链也一起没了。插到最前则是「先试他的，再试已经在工作的那张表」，
 * 而且如果表里本来就有同一个前缀，去重后他就正好拿回原表。
 * 直连（`null`）永远不删：删了就把一次镜像故障变成一次彻底不可用。
 */
function withCustomProxy(proxy, base) {
  return [proxy, ...base.filter((route) => route !== proxy)]
}

/**
 * 某个服务的候选线路，按「本轮验证过的赢家优先」排序。
 *
 * 三层排序：
 *   1. **赢家**（`preferred`）提到最前——上次证明能用的，这次先试它；
 *   2. **刚失败过的线路**排到最后——同一次检查里的后续请求不必再撞一遍
 *      （尤其是一条 8s 超时的死线路：一次检查有 6 个请求，不排后就是 6 次白等）；
 *   3. 其余保持表里的顺序。
 *
 * 「排到最后」而不是「删掉」：负缓存只是**这次别先试**，不是永久弃用。全删的话
 * 一条被误判的线路就再也没机会自证，而它可能只是在一次抖动里失败过。
 *
 * @param service - GITHUB_SERVICES 之一；不认识时按 raw 处理（读取类请求最宽的一档）。
 * @param options.env - 读 DSHM_GITHUB_PROXY 的环境。
 * @returns 有序候选，`null` 表示直连。
 */
export function githubRoutesFor(service, options = {}) {
  const key = GITHUB_SERVICES.includes(service) ? service : 'raw'
  const env = options.env ?? process.env
  const base = ROUTES[key]
  const proxy = githubProxyFrom(env) ?? customProxy
  const routes = proxy === null ? [...base] : withCustomProxy(proxy, base)

  // 赢家优先
  const winner = preferred.get(key)
  let ordered = routes
  if (winner !== undefined) {
    const index = routes.findIndex((route) => route === winner)
    if (index > 0) ordered = [routes[index], ...routes.slice(0, index), ...routes.slice(index + 1)]
  }
  // 刚失败过的往后放（稳定分区，保持其余相对顺序）
  const fresh = []
  const stale = []
  for (const route of ordered) (recentlyFailed(key, route) ? stale : fresh).push(route)
  return [...fresh, ...stale]
}

/**
 * 一个 URL 该走哪条服务的线路表。
 *
 * 下载循环里会**混着**两类地址：jsDelivr 的 CDN 地址与 GitHub 的附件地址。
 * 把 jsDelivr 的地址拼在 `gh-proxy.com/` 后面是纯错（那是 GitHub 前缀代理，
 * 只会回它自己的 404/错误页），所以「用哪张表」必须按主机判，不能由调用点写死一个。
 * 认不出来时按 `raw`（最宽的一档，且含直连）。
 */
export function serviceForUrl(url) {
  let host = ''
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return 'raw'
  }
  if (host === 'api.github.com') return 'api'
  if (host === 'raw.githubusercontent.com' || host === 'objects.githubusercontent.com') return 'raw'
  if (host === 'github.com' || host === 'codeload.github.com') return 'download'
  if (host === 'cdn.jsdelivr.net' || host.endsWith('.jsdelivr.net')) return 'cdn'
  return 'raw'
}

/**
 * 把 URL 落到某条线路上。
 *
 * 线路有两种形状，不能混为一谈：
 *   - **前缀**（字符串，含 `null`=直连）：`{prefix}/{完整URL}`。这是公共加速服务的约定，
 *     目标 URL 原样进路径（参考实现 `regions.ts` 的 `throughProxy` 同形）。
 *   - **互替主机**（`{host}`）：把 URL 的 host 换掉、路径保留。jsDelivr 的
 *     `fastly.` / `testingcf.` 就是这样——它们不是前缀代理，拼成
 *     `https://fastly.jsdelivr.net/https://cdn.jsdelivr.net/...` 只会 404。
 *
 * 两种形状都接受，是因为「换一条线路」在物理上确实有两种做法，用一条规则硬套
 * 会在其中一半上静默失效（而且失效方式是 404，看起来像"内容不存在"而不是"线路不对"）。
 */
export function routeUrl(route, url) {
  if (route === null) return url
  if (typeof route === 'object' && typeof route.host === 'string') {
    const parsed = new URL(url)
    parsed.host = route.host
    return parsed.href
  }
  return `${route}/${url}`
}

/** 兼容旧名（参考实现的叫法）。 */
export const throughProxy = routeUrl

/** 正文看起来是不是 HTML/XML（含加速服务自己的错误页）。 */
export function looksLikeHtml(body) {
  if (typeof body !== 'string') return false
  const head = body.replace(/^\uFEFF/, '').trimStart().slice(0, 64).toLowerCase()
  if (head === '') return false
  return head.startsWith('<')
}

/** 短错误描述。 */
function shortError(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 120 ? `${message.slice(0, 120)}…` : message
}

function optionalText(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
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

/** 线路的可读名字，进 attempts 与日志。 */
function routeLabel(route) {
  if (route === null) return '直连'
  if (typeof route === 'object' && typeof route.host === 'string') return route.host
  try {
    return new URL(route).host
  } catch {
    return String(route)
  }
}

/**
 * 一个请求体读三态：`json` / `text` / `bytes`。
 *
 * 分成三态而不是统一 `text()`，是因为**载荷校验的证据不一样**：JSON 源要
 * 解析出目标字段，二进制产物要数字节并算哈希，只有原始文件才看正文。
 * 把二进制当 text 读会悄悄损坏字节（UTF-8 解码不是无损的），所以这里不图省事。
 *
 * **两种模式都有字节上限**（审查任务 1）：走这条路的有公共加速前缀与第三方镜像，
 * 超时管得住时间、管不住"在超时前一直喂数据"的响应。默认值：
 *   - json/text：4 MiB——实测 GitHub Release API 53 KB、jsDelivr Data API 2.8 KB，
 *     4 MiB 是约 80 倍余量；
 *   - bytes：32 MiB——实测自更新 tarball 0.18 MiB；留宽是为了未来包体增长，
 *     同时远小于能伤到常驻进程的量级。
 * 超限返回 kind:'too-large' ⇒ 该线路失败、继续下一条、**不记成可用线路**。
 */
async function readBody(response, accept, maxBytes) {
  if (accept === 'bytes') {
    const read = await readBoundedBody(response, { mode: 'bytes', maxBytes })
    return read.ok === true ? read : { ok: false, kind: read.kind, reason: read.reason }
  }
  const read = await readBoundedBody(response, { mode: 'text', maxBytes })
  if (read.ok !== true) return { ok: false, kind: read.kind, reason: read.reason }
  const text = read.value
  if (accept === 'text') return { ok: true, value: text }
  if (looksLikeHtml(text)) return { ok: false, kind: 'payload', reason: '正文是 HTML（不是 JSON）' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, kind: 'payload', reason: `不是合法 JSON：${shortError(error)}` }
  }
}

/**
 * 这个服务的候选线路是不是**同一个源的不同镜像**。
 *
 * 决定 404 的含义：
 *   - `cdn` 的候选（cdn/fastly./testingcf./gcore.jsdelivr.net）是 jsDelivr **同一份内容**
 *     的不同边缘域名。对**不可变的标签内容**（`@v1.0.1/releases/index.json`）来说，
 *     一个镜像说 404，别的镜像不可能有——再问三个只是白花三次请求。
 *   - `api`/`raw`/`download` 的候选是**不同公司的前缀代理**，各自的上游可达性不同；
 *     一个代理回 404 也可能只是它自己取不到，换一家问是合理的。
 *
 * 这条区分是实测逼出来的：多线路接上后，「标签探测有界」那条既有回归从 3 次请求
 * 变成 12 次（3 个候选 × 4 个 CDN 镜像），而它们本来全都会是同一个 404。
 * 参考实现在解析 git HEAD 时写的是同一句话——「advertisement 对这个仓库是权威的，
 * 问另一个镜像不能让一个不存在的分支出现」。
 */
const SAME_ORIGIN_MIRRORS = { cdn: true }

/**
 * 按候选线路依次请求，直到「传输成功 **且** 载荷校验通过」。
 *
 * 两个成功条件缺一不可，这是本模块最容易做错的地方：公共加速前缀在上游失败时
 * 常回一个**自己的 HTML 错误页 + 200**。只看 `response.ok` 就会把这条线路认定为
 * 可用并记下来，之后每次请求都先撞它一次——故障被固化成默认路径。
 *
 * @param service - 决定候选线路表的服务类别。
 * @param url - 规范地址（直连就是它）。
 * @param options.fetchImpl - 注入的 fetch（测试用）。
 * @param options.accept - 'json' | 'text' | 'bytes'。
 * @param options.validate - `(value, response) => true | {ok:false, reason}`；缺省时只要有值就通过。
 * @param options.timeoutMs - 单条线路超时。
 * @param options.totalBudgetMs - 整条链总预算。
 * @param options.env - 读覆盖前缀的环境。
 * @returns `{ ok:true, value, via, attempts }` 或 `{ ok:false, attempts }`。
 *   `attempts` 逐条记录原始失败原因——**不折叠**，折叠会让「为什么全挂了」永远查不出来。
 */
export async function fetchViaGithubRoutes(service, url, options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const accept = options.accept ?? 'json'
  const routeTimeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : ROUTE_TIMEOUT_MS
  const totalBudgetMs = Number.isFinite(options.totalBudgetMs)
    ? options.totalBudgetMs
    : (DEFAULT_TOTAL_BUDGET_MS ?? routeTimeoutMs)
  const attempts = []
  const key = GITHUB_SERVICES.includes(service) ? service : 'raw'
  const routes = githubRoutesFor(service, options)

  if (typeof fetchImpl !== 'function') {
    return { ok: false, attempts: [{ route: null, label: '（无 fetch）', ok: false, reason: '当前运行环境没有 fetch' }] }
  }

  const deadline = Date.now() + totalBudgetMs
  const total = routes.length
  for (let index = 0; index < total; index++) {
    const route = routes[index]
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      attempts.push({ route, label: routeLabel(route), ok: false, reason: `整条链超时（总预算 ${Math.round(totalBudgetMs / 1000)}s）` })
      continue
    }
    // **平摊**剩余预算，而不是让每条都用满 routeTimeoutMs。
    // 不平摊的话第一条坏线路会把整条预算吃光（12s 全给直连），后两条候选连试的机会
    // 都没有——那就等于没做多线路。平摊后总耗时与改装前**完全一致**，
    // 只是同一段时间被分给了几条线路，而不是全砸在第一条上。
    //
    // `MIN_ROUTE_MS` 只是「别给短到连 TCP 握手都不够的预算」，**不能**让它突破剩余时间：
    // 早先这里写 `Math.max(1_000, …)`，于是 1200ms 的总预算实际跑了 2032ms
    // （每条被抬到 1000ms，两条就超了）——总预算就不再是上界，只是句建议。
    // 所以下面再 `Math.min(..., remaining)` 夹一次，让总预算真的是硬上界。
    const leftCount = total - index
    const fairShare = Math.floor(remaining / leftCount)
    const budget = Math.min(Math.max(MIN_ROUTE_MS, Math.min(routeTimeoutMs, fairShare)), remaining)
    const target = routeUrl(route, url)
    const started = Date.now()
    let response
    try {
      response = await fetchImpl(target, {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        signal: timeoutSignal(budget),
        ...(options.headers === undefined ? {} : { headers: options.headers })
      })
    } catch (error) {
      const reason = classify(error, budget)
      noteRouteFailure(key, route, reason)
      attempts.push({ route, label: routeLabel(route), ok: false, ms: Date.now() - started, reason })
      continue
    }
    if (response === null || typeof response !== 'object' || typeof response.ok !== 'boolean') {
      attempts.push({ route, label: routeLabel(route), ok: false, ms: Date.now() - started, reason: '响应无法识别' })
      continue
    }
    if (response.ok !== true) {
      const reason = `HTTP ${response.status}`
      noteRouteFailure(key, route, reason)
      attempts.push({ route, label: routeLabel(route), ok: false, ms: Date.now() - started, reason })
      // 同一源的镜像：404 是权威的「内容不存在」，换镜像问不出别的答案。
      if (response.status === 404 && SAME_ORIGIN_MIRRORS[key] === true) break
      continue
    }
    let body
    try {
      body = await readBody(response, accept,
        accept === 'bytes'
          ? (Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : ROUTE_MAX_BYTES_BYTES)
          : (Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : ROUTE_MAX_JSON_BYTES))
    } catch (error) {
      const reason = classify(error, budget)
      noteRouteFailure(key, route, reason)
      attempts.push({ route, label: routeLabel(route), ok: false, ms: Date.now() - started, reason })
      continue
    }
    if (body.ok !== true) {
      noteRouteFailure(key, route, body.reason)
      attempts.push({ route, label: routeLabel(route), ok: false, ms: Date.now() - started, reason: body.reason })
      continue
    }
    const verdict = typeof options.validate === 'function' ? options.validate(body.value, response) : true
    const accepted = verdict === true || (verdict !== null && typeof verdict === 'object' && verdict.ok === true)
    if (!accepted) {
      const why = verdict !== null && typeof verdict === 'object' && typeof verdict.reason === 'string' ? verdict.reason : '载荷不符合预期'
      // 载荷不合规也算这条线路在敷衍（加速服务回自己的 200 错误页正是这种）。
      noteRouteFailure(key, route, why)
      attempts.push({ route, label: routeLabel(route), ok: false, ms: Date.now() - started, reason: why })
      continue
    }
    // 记住赢家：下一次先试它。按服务记，不让 raw 的经验影响 download。
    rememberGithubRoute(service, route)
    attempts.push({ route, label: routeLabel(route), ok: true, ms: Date.now() - started, reason: '可用' })
    return { ok: true, value: body.value, via: route, viaLabel: routeLabel(route), attempts }
  }
  return { ok: false, attempts }
}

/**
 * AbortSignal.timeout 的兼容包装（与 catalog-npm.js 同一策略）。
 * 老 Node 没有它时手动 abort，且定时器 unref——否则一个待决的超时会拖住进程退出。
 */
export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  if (typeof timer.unref === 'function') timer.unref()
  return controller.signal
}

/** 把 attempts 压成一行诊断串（进 error.diagnostic 与日志）。 */
export function summarizeRouteAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return ''
  return attempts.map((attempt) => `${attempt.label ?? '线路'}：${attempt.reason ?? '失败'}`).join('；')
}
