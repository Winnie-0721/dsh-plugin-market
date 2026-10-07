/**
 * deepseek-harness-market — HOST 半（Cordis function plugin）。
 *
 * 职责只有一个：把 https://awesome-dsh-plugin.com/plugins.json 这类目录源
 * 变成宿主 HTTP 上的一组只读/操作端点，并把宿主可选的 pluginManager 服务桥接出去。
 * 其中 `/self-update` 的 GET/POST 是市场**自身**的升级通道（见 self-update.js），
 * `/restart` 是重启助手（见 restart.js：分离等待再拉起，把「重启 DSH」变成真动作）。
 *
 * 为什么只注册一条 prefix 路由：宿主对 (kind, path) 的重复注册会 throw，
 * 而所有端点又在同一个前缀下——一条 prefix 路由 + 内部分发是唯一不会互相撞的写法。
 */

import { createRequire } from 'node:module'
import {
  createRouteTable,
  pickQueryEnum,
  pickQueryFlag,
  pickQueryInt,
  pickQueryText,
  readJsonObject,
  requireSameOrigin,
  sendError,
  sendJson
} from './http.js'
import {
  createCatalogCache,
  filterPlugins,
  joinBundles,
  joinInstalled,
  paginate,
  sortPlugins
} from './catalog.js'
import { createSelfUpdater } from './self-update.js'
import { RESTART_EXIT_DELAY_MS, spawnRestartHelper } from './restart.js'

const PLUGIN_NAME = 'deepseek-harness-market'
/**
 * 版本从包清单读，**不写死**：写死会在每次发布后与 package.json 漂移，页面与 /status 会跟着
 * 显示上一个版本（本仓库真的发生过一次，发布门禁为此加了一条检查）。读不到时退回 '0.0.0'，
 * 让漂移在界面上明显可见，而不是显示一个看起来合理的旧版本号。
 */
const PLUGIN_VERSION = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
const ROUTE_PREFIX = '/plugin-market'
const SORT_VALUES = ['top', 'new', 'downloads', 'name']

/** 宿主把「这条由基础设施管理」表达成 ReadOnlyReason，映射到契约的 not-allowed。 */
const READ_ONLY_CODES = new Set(['management-required', 'unaddressable', 'not-removable'])

/** ManagementError 只有 code，没有面向用户的 message；这里补上「发生了什么」。
 *  用 Map 而不是对象字面量：错误码来自宿主/第三方，`__proto__`/`constructor` 这类键
 *  在对象上会走进 Object.prototype 拿到函数或对象，而契约要求 message 是字符串。 */
const MANAGEMENT_MESSAGE = new Map(Object.entries({
  'management-required': '当前进程没有插件管理权限。',
  unaddressable: '当前进程定位不到这个插件。',
  'unknown-plugin': '宿主不认识这个插件。',
  'invalid-spec': '安装地址的格式不对。',
  'ambiguous-install': '这个地址能匹配到多个包。',
  'not-bundle': '这不是一个可管理的 bundle。',
  'not-removable': '这个包不允许卸载。',
  'stop-profile': '需要先停掉当前 profile 才能改。',
  'bundle-in-use': '这个包正在被使用。',
  'stale-approval': '构建脚本的批准已经过期。',
  'incompatible-version': '这个版本与当前 DSH 不兼容。',
  'operation-error': '宿主执行这个操作时报错。'
}))

/** 每个宿主错误码对应「现在怎么办」。 */
const MANAGEMENT_HINT = new Map(Object.entries({
  'management-required': '用 dsh plugin 命令行操作，或换一个允许管理的 profile。',
  unaddressable: '在启动了这个 profile 的终端里操作。',
  'unknown-plugin': '先点「刷新目录」，或确认包名拼写。',
  'invalid-spec': '改成目录页给出的 npm 包名或仓库地址。',
  'ambiguous-install': '换成更精确的包名重试。',
  'not-bundle': '只能管理 bundle 包；单插件请用 id 开关。',
  'not-removable': '它是宿主的一部分，只能停用，不能卸载。',
  'stop-profile': '关掉当前 DSH 进程后用 dsh plugin 操作。',
  'bundle-in-use': '关掉占用它的会话或进程，再重试。',
  'stale-approval': '重新点一次安装，按提示批准构建脚本。',
  'incompatible-version': '换一个与当前 DSH 兼容的版本。',
  'operation-error': '看宿主日志里的 pnpm 输出，修好原因后重试。'
}))

function optionalText(value) {
  if (value === null || value === undefined) return null
  const result = String(value).trim()
  return result === '' ? null : result
}

function describe(error) {
  if (error === null || error === undefined) return '未知错误'
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

function sameKey(a, b) {
  const left = optionalText(a)
  const right = optionalText(b)
  if (left === null || right === null) return false
  return left.toLowerCase() === right.toLowerCase()
}

function safeGet(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/** inject 保证 webServer 存在；真缺了就抛错让宿主把 fiber 标成 FAILED，而不是静默不工作。 */
function resolveWebServer(ctx) {
  const service = safeGet(ctx, 'webServer') ?? ctx?.webServer
  if (service === null || service === undefined || typeof service.register !== 'function') {
    throw new Error(`${PLUGIN_NAME}: 找不到 webServer 服务，路由无法注册。`)
  }
  return service
}

function argvProfile() {
  const argv = Array.isArray(process.argv) ? process.argv : []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile' && index + 1 < argv.length && !argv[index + 1].startsWith('-')) return argv[index + 1]
    if (typeof arg === 'string' && arg.startsWith('--profile=')) {
      const value = arg.slice('--profile='.length)
      if (value !== '') return value
    }
  }
  return null
}

/** 契约 §2.1：host.dsh 取值顺序 profileContext → DSH_VERSION → null。 */
function hostInfo(ctx) {
  const profileContext = safeGet(ctx, 'profileContext')
  return {
    dsh:
      optionalText(profileContext?.version) ??
      optionalText(profileContext?.dshVersion) ??
      optionalText(process.env.DSH_VERSION),
    node: process.version,
    platform: process.platform,
    profile: optionalText(profileContext?.name) ?? argvProfile() ?? optionalText(process.env.DSH_PROFILE)
  }
}

function profileName(ctx) {
  return hostInfo(ctx).profile ?? 'default'
}

function managerOf(ctx) {
  const service = safeGet(ctx, 'pluginManager')
  return service !== null && service !== undefined && typeof service === 'object' ? service : null
}

function hasMethod(service, method) {
  return service !== null && typeof service[method] === 'function'
}

function projectRegistries(raw) {
  if (raw === null || typeof raw !== 'object') return null
  return {
    registry: raw.registry ?? null,
    fallbackRegistries: Array.isArray(raw.fallbackRegistries)
      ? raw.fallbackRegistries.filter((entry) => typeof entry === 'string')
      : [],
    resolved: raw.resolved ?? null
  }
}

/** 契约 §2.3 的 bundle 投影；readOnlyReason 是附加信息，界面据此禁用开关。 */
function projectBundle(raw) {
  const bundle = raw !== null && typeof raw === 'object' ? raw : {}
  const name = optionalText(bundle.name) ?? ''
  return {
    name,
    version: optionalText(bundle.version),
    description: optionalText(bundle.description),
    enabled: bundle.enabled === true,
    installed: bundle.installed === true,
    removable: bundle.removable === true,
    official: name.startsWith('@deepseek-ai/'),
    market: name === PLUGIN_NAME,
    readOnlyReason: optionalText(bundle.readOnlyReason),
    error:
      bundle.error !== null && typeof bundle.error === 'object'
        ? {
            code: optionalText(bundle.error.code) ?? 'operation-error',
            ...(optionalText(bundle.error.diagnostic) === null
              ? {}
              : { diagnostic: optionalText(bundle.error.diagnostic) })
          }
        : null,
    rows: (Array.isArray(bundle.rows) ? bundle.rows : []).map((row) => ({
      rowId: optionalText(row?.rowId),
      moduleName: optionalText(row?.moduleName),
      entryId: optionalText(row?.entryId)
    }))
  }
}

function pluginTitle(meta) {
  if (meta === null || typeof meta !== 'object') return null
  const title = meta.title
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  if (title !== null && typeof title === 'object') {
    for (const key of ['zh', 'en']) {
      const value = title[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return null
}

/** 契约 §2.3：plugin 条目要能反查回它的 bundle，靠 rows 的 entryId/moduleName 对照。 */
function bundleNameFor(plugin, bundles) {
  const moduleName = optionalText(plugin?.moduleName)
  const entryId = optionalText(plugin?.entryId)
  for (const bundle of bundles) {
    const name = optionalText(bundle?.name)
    if (name !== null && moduleName !== null && name === moduleName) return name
    for (const row of Array.isArray(bundle?.rows) ? bundle.rows : []) {
      if (entryId !== null && optionalText(row?.entryId) === entryId) return name
      if (moduleName !== null && optionalText(row?.moduleName) === moduleName) return name
    }
  }
  return null
}

function projectPlugin(raw, bundles) {
  const plugin = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    entryId: optionalText(plugin.entryId),
    moduleName: optionalText(plugin.moduleName),
    enabled: plugin.enabled === true,
    fiberPhase: optionalText(plugin.fiberPhase),
    title: pluginTitle(plugin.meta),
    bundle: bundleNameFor(plugin, bundles)
  }
}

/** ManagementError → 契约的 error 对象；没有 message 就按 code 补一条中文说明。 */
function projectChangeError(error) {
  if (error === null || error === undefined || typeof error !== 'object') return null
  const code = optionalText(error.code) ?? 'operation-error'
  const projected = {
    code,
    message: optionalText(error.message) ?? MANAGEMENT_MESSAGE.get(code) ?? '宿主拒绝了这个操作。'
  }
  const hint = optionalText(error.hint) ?? MANAGEMENT_HINT.get(code) ?? null
  if (hint !== null) projected.hint = hint
  if (optionalText(error.diagnostic) !== null) projected.diagnostic = optionalText(error.diagnostic)
  if (error.incompatible !== undefined) projected.incompatible = error.incompatible
  return projected
}

function isReadOnlyResult(result) {
  const fromError = optionalText(result?.error?.code)
  const explicit = optionalText(result?.readOnlyReason)
  return (fromError !== null && READ_ONLY_CODES.has(fromError)) || (explicit !== null && READ_ONLY_CODES.has(explicit))
}

function tail(text, limit) {
  return text.length <= limit ? text : text.slice(text.length - limit)
}

function warningsOf(value) {
  return Array.isArray(value.warnings) ? value.warnings.filter((entry) => typeof entry === 'string') : []
}

/** 装/更新之后能直接回读的 bundle 快照：以小写名字为键，避免大小写差异被当成两个包。 */
function bundleSnapshot(bundles) {
  const map = new Map()
  for (const raw of Array.isArray(bundles) ? bundles : []) {
    const name = optionalText(raw?.name)
    if (name === null) continue
    map.set(name.toLowerCase(), {
      name,
      version: optionalText(raw?.version),
      enabled: raw?.enabled === true,
      failed: raw?.error !== null && raw?.error !== undefined
    })
  }
  return map
}

function normalizeVersion(value) {
  const text = optionalText(value)
  return text === null ? null : text.replace(/^v/i, '').toLowerCase()
}

/**
 * 装完之后**回读**宿主状态，回答一个 `application` 回答不了的问题：
 * 「东西真的落地了吗、落地的哪个版本、它在跑吗」。
 *
 * 为什么必须回读：`ChangeResult.application` 说的是宿主**执行**了什么，不是**结果**。
 * `applied` 完全可能对应「写进了 node_modules，但 profile 的 bundle 列表里从来没有它」——
 * 用户看到绿色「已安装」，插件却永远不出现。参考实现把这个拆成
 * live | restart | inert | broken，这里对齐，并额外做**版本回读**：目录说 0.63.0、
 * 磁盘上还是 0.62.3 时，界面不能再写「已更新」。
 *
 * 判定手段是**前后对比**而不是猜名字：装之前记一份 bundle 名字表，装之后记一份，
 * 新出现的那个就是这次装上的。这样不必假设「包名 == bundle 名」（两者并不总相等），
 * 也不会因为一个仓库里包名不同就误报 inert。`candidates` 只用于「没有新名字出现」时
 * 判断这次到底是**更新了已有条目**（候选名本来就在表里）还是**什么都没落地**。
 *
 * 状态语义（`null` 表示这次操作不该谈激活，例如 failed / cancelled / 还在等批准构建脚本）：
 *   - `live`      已落地、已启用、宿主没报错；
 *   - `restart`   已落地，但宿主说重启后才生效（**不**等于已生效）；
 *   - `inert`     宿主说成功，但列表里既没有新条目、候选名也不在——很可能是个普通 npm 包，
 *                 不是 bundle；这是以前完全看不见的一类；
 *   - `broken`    条目在列表里但自身带 error；
 *   - `disabled`  条目在列表里但处于停用状态；
 *   - `unknown`   读不回列表（没有 listBundles、调用抛错）或新条目不止一个分不清是哪个——
 *                 **宁可说不知道，也不猜一个状态出来**。
 *
 * 导出只为让回归测试能真调它（源码形状断言测不出这些分支）。
 */
export function verifyActivation(options = {}) {
  const application = optionalText(options.application) ?? 'failed'
  // 只有「宿主声称成功」的两种 application 才谈得上激活；失败/取消/覆盖都不该给状态。
  if (application !== 'applied' && application !== 'restart-required') return null
  // 还在等用户批准构建脚本时，宿主根本没装，回读必然「没落地」——那不是 inert。
  if (options.pending === true) return null

  const before = options.before instanceof Map ? options.before : null
  const after = options.after instanceof Map ? options.after : null
  const expected = optionalText(options.expectedVersion)
  const reasons = []
  const result = { state: 'unknown', expected, installed: null, enabled: null, versionMatches: null, reasons }

  if (after === null) {
    reasons.push('read-back-unavailable')
    return result
  }

  // 候选名**先去重**再用来判歧义：调用方传进来的这几个字段经常是同一个字符串。
  // install() 传的是 `[hit?.npm, hit?.name, hit?.id, requestedSpec, requestedName]`，而客户端
  // 「更新」发的是 `{ name: bundle.name, spec: bundle.name }` —— npm / name / requestedSpec /
  // requestedName 会撞成同一个值（真实目录里 2288 个有 npm 的条目 **全部** 如此）。
  // 以前这里数的是**出现次数**：更新一个已装插件时 before 里已有它（appeared 为空），
  // 于是走下面 present 分支，present.length > 1 被当成「多个候选都命中」→ 报
  // ambiguous-bundle、状态降级成 unknown，客户端把一次成功的更新渲染成
  // 「已安装，但这次没能回读装载状态」；更糟的是 versionMatches=false 那条「版本没落地」
  // 的告警也被这次误报盖掉（走不到 hit 分支就不会算版本）。
  // 去重后 present.length 才是**不同名字的个数**——两个不同名字各自命中一个 bundle 时
  // 依然算真歧义（下面的反向断言守着这一点）。
  const candidates = [...new Set(
    (Array.isArray(options.candidates) ? options.candidates : [])
      .map((entry) => optionalText(entry))
      .filter((entry) => entry !== null)
      .map((entry) => entry.toLowerCase())
  )]

  let hit = null
  let ambiguous = false
  if (before !== null) {
    const appeared = [...after.keys()].filter((key) => !before.has(key))
    if (appeared.length === 1) {
      hit = after.get(appeared[0])
    } else if (appeared.length > 1) {
      // 一次装出多个 bundle（或本来就有点别的变动）：只在候选名里能唯一确定时才认。
      const matched = appeared.filter((key) => candidates.includes(key))
      if (matched.length === 1) hit = after.get(matched[0])
      else ambiguous = true
    }
  } else {
    // 没有装前的快照：**认不出「谁是这个操作装上的」，但认得出「这个包在不在列表里」**。
    // 后者才是 live/inert 的判据，所以照常判定，只在 reasons 里记下「归因未经证明」——
    // 而不是因为归因不了就把已知的「它在跑」降级成 unknown。
    reasons.push('no-baseline')
  }
  if (hit === null && !ambiguous) {
    const present = candidates.filter((key) => after.has(key))
    if (present.length === 1) hit = after.get(present[0])
    else if (present.length > 1) ambiguous = true
  }

  if (hit === null) {
    if (ambiguous) {
      reasons.push('ambiguous-bundle')
      return result
    }
    if (before === null) {
      // 没有基线**且**列表里也找不到它：既可能是没落地，也可能是包名与 bundle 名毫无关系。
      // 分不清，如实说不知道。
      return result
    }
    result.state = 'inert'
    reasons.push('not-in-bundle-list')
    return result
  }

  result.installed = hit.version
  result.enabled = hit.enabled
  result.versionMatches =
    expected === null || hit.version === null ? null : normalizeVersion(expected) === normalizeVersion(hit.version)

  if (hit.failed === true) {
    result.state = 'broken'
    reasons.push('bundle-reported-error')
    return result
  }
  if (hit.enabled !== true) {
    result.state = 'disabled'
    reasons.push('bundle-disabled')
    return result
  }
  // restart-required 优先于 live：宿主的原话就是「还没生效」，不能因为条目在列表里就改口。
  result.state = application === 'restart-required' ? 'restart' : 'live'
  if (result.versionMatches === false) reasons.push('version-mismatch')
  return result
}

/** 读一份 bundle 快照；能力缺失或调用失败都返回 null（调用方据此报 unknown，不编状态）。 */
async function captureBundles(manager) {
  if (!hasMethod(manager, 'listBundles')) return null
  try {
    const bundles = await manager.listBundles()
    return bundleSnapshot(bundles)
  } catch (error) {
    console.warn(`[${PLUGIN_NAME}] 回读已安装列表失败，本次操作不报激活状态：${describe(error)}`)
    return null
  }
}

/** 契约 §2.4 / §2.5 的响应；宿主错误码原样透传（契约要求「透传 error.code」）。
 *  导出只为让回归测试能真调它读响应体（源码形状断言测不出 `ok` 的推导行为）。 */
export function sendChangeResult(res, result, stage, activation) {
  const value = result !== null && typeof result === 'object' ? result : {}
  const error = projectChangeError(value.error)
  const application = optionalText(value.application) ?? 'failed'
  const pending = Array.isArray(value.pendingBuilds)
    ? value.pendingBuilds.filter((entry) => typeof entry === 'string')
    : []
  const payload = {
    // ok 不能只看 error：宿主的 ChangeResult 里 error 是可选的，`application:'failed'`
    // 完全可能不带 error。只看 error 就会把一次失败的操作报成 ok:true，客户端据此渲染
    // 绿色「已安装」并把它计为成功。
    // `cancelled` 单独放行：它是用户自己取消的（宿主可能同时带一个 error 说明原因），
    // 客户端要靠 `application` 渲染「已取消」文案——ok:false 会让 requestJSON 直接抛错，
    // 那条文案就永远不可达。`failed` 一律算失败。
    //
    // **`pendingBuilds` 非空也要放行**（本次修的 bug）：这是「还差你批准一下构建脚本」，
    // 不是失败到底——pnpm 11 遇到未批准的构建脚本会忽略它并非零退出，宿主把这次
    // installBundle 折成 { application:'failed', error, pendingBuilds:['cloudflared'] }。
    // 回 ok:false 会让客户端 requestJSON **直接抛错**，于是客户端那段「读 payload.pendingBuilds
    // 弹批准框」成了**永远不可达的死代码**——用户只看到一条普通错误，**没有任何批准入口**，
    // 装了永远装不上（真实案例：@linxin666/dsh-remote-web-ui 依赖 cloudflared 的 postinstall）。
    ok: application === 'cancelled' || pending.length > 0 ? true : (error === null && application !== 'failed'),
    changed: value.changed === true,
    application,
    stage: optionalText(value.stage) ?? stage,
    target: value.target ?? null,
    enabled: value.enabled === undefined ? null : value.enabled === true,
    error,
    warnings: warningsOf(value),
    pendingBuilds: pending
  }
  // 激活状态是可选的：读不回列表时给 `unknown`（带 reasons），**不给 null 也不给 live**——
  // null 会让客户端以为「这条不用谈激活」，live 就成了无凭据的保证。
  if (activation !== undefined && activation !== null) payload.activation = activation
  const output = value.packageResult?.output
  if (typeof output === 'string' && output !== '') payload.output = tail(output, 2000)
  sendJson(res, 200, payload)
}

/**
 * 按名字在目录里找条目（契约 §2.4 允许 `{name}` 形式）。
 *
 * 按**身份强度**分级，而不是把所有字段混在一个 `find` 里：
 *   1. `id` / `npm` / `url` 是唯一身份 → 命中即确定；
 *   2. `name` 只是显示名，真实目录里有 195 个重名（如 `dsh-memory` 对应 10 个条目、5 个不同 spec）
 *      → 只有一个候选才算确定，多个候选必须报 `ambiguous-install`。
 *
 * 以前是「第一个匹配就装」，用户请求一个重名插件会随机装上别人的包——市场类应用
 * 绝不会这样处理歧义。
 * 导出只为让回归测试能真调它（源码形状断言测不出「重名时到底返回哪个」）。
 */
export function findCatalogItem(items, name) {
  if (name === null) return { item: null, ambiguous: false }
  const byIdentity = items.find(
    (item) => sameKey(item.id, name) || sameKey(item.npm, name) || sameKey(item.url, name)
  )
  if (byIdentity !== undefined) return { item: byIdentity, ambiguous: false }
  const byName = items.filter((item) => sameKey(item.name, name))
  if (byName.length === 1) return { item: byName[0], ambiguous: false }
  if (byName.length > 1) return { item: null, ambiguous: true }
  return { item: null, ambiguous: false }
}

const SEMVER_LIKE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * 把「裸 npm 名」钉成 name@version（目录给了明确版本时）。
 *
 * pnpm 11 对已存在的依赖执行 `pnpm add <裸名>` 是幂等的：打印 Already up to date，
 * package.json 一个字节都不动——目录显示「更新到 0.63.0」，安装却永远停在 0.62.3，
 * 宿主随后还按「本来就装着」回一个 restart-required，界面上就成了
 * 「点更新 → 已安装，重启后生效 → 可更新角标却一直是 2」的死循环。
 * 所以更新必须带版本。spec 不是裸 npm 名（URL 仓库地址、已带版本的写法）
 * 或版本字段不像 semver 时，原样放行给宿主。
 */
function pinnedNpmSpec(hit, spec) {
  const npm = optionalText(hit?.npm)
  const versionRaw = optionalText(hit?.version)
  if (npm === null || versionRaw === null || spec !== npm) return spec
  const version = versionRaw.replace(/^v/, '')
  return SEMVER_LIKE.test(version) ? `${npm}@${version}` : spec
}

function invalidQuery(res, picked) {
  sendError(res, 400, 'bad-request', { message: picked.message, hint: picked.hint })
}

function createHandlers(ctx, catalog, selfUpdate) {
  /** 目录不可用时如实报错，绝不用空列表冒充「没有结果」。 */
  async function requireCatalog(res) {
    const loaded = await catalog.ensure()
    if (loaded.ok !== true) {
      // 把尝试序列写进宿主日志：界面只看到一句 hint，排查时要知道每个源各自的失败原因。
      const tried = (loaded.attempts ?? []).map((attempt) => `${attempt.label}：${attempt.reason}`).join('；')
      console.warn(`[${PLUGIN_NAME}] 目录抓取失败（${loaded.code}）：${tried === '' ? '没有可用源' : tried}`)
      sendError(res, loaded.status ?? 502, loaded.code, { message: loaded.message, hint: loaded.hint })
      return null
    }
    return loaded.cache
  }

  /** 目录页顺带展示安装状态；pluginManager 出错不该让浏览整个失败，但要留下日志。 */
  async function listBundlesSafe() {
    const manager = managerOf(ctx)
    if (!hasMethod(manager, 'listBundles')) return { available: false, bundles: [] }
    try {
      const bundles = await manager.listBundles()
      return { available: true, bundles: Array.isArray(bundles) ? bundles : [] }
    } catch (error) {
      console.warn(`[${PLUGIN_NAME}] 读取已安装列表失败，本次目录结果不带安装标记：${describe(error)}`)
      return { available: true, bundles: [] }
    }
  }

  return {
    /** 契约 §2.1 */
    async status(req, res) {
      const manager = managerOf(ctx)
      const available = hasMethod(manager, 'listBundles')
      let registries = null
      if (available && hasMethod(manager, 'registries')) {
        try {
          registries = projectRegistries(await manager.registries())
        } catch (error) {
          console.warn(`[${PLUGIN_NAME}] 读取 registries 失败：${describe(error)}`)
          registries = null
        }
      }
      // 契约 §2.1：本端点绝不发起网络请求，只读内存快照。
      // /status 是 UI 首屏第一跳，回答「有没有 pluginManager」不该付出一次抓取的等待。
      const cache = catalog.peek()
      sendJson(res, 200, {
        ok: true,
        plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
        host: hostInfo(ctx),
        manager: { available, registries },
        catalog:
          cache === null
            ? null
            : {
                source: cache.source,
                count: cache.count,
                updated: cache.updated,
                fetchedAt: cache.fetchedAt,
                stale: cache.stale === true,
                error: cache.error ?? null
              }
      })
    },

    /** 契约 §2.2 */
    async catalog(req, res, url) {
      const params = url.searchParams
      const query = pickQueryText(params, 'query', { maxLength: 128 })
      if (query.ok !== true) return invalidQuery(res, query)
      const category = pickQueryText(params, 'category', { maxLength: 64 })
      if (category.ok !== true) return invalidQuery(res, category)
      const sort = pickQueryEnum(params, 'sort', SORT_VALUES, 'top')
      if (sort.ok !== true) return invalidQuery(res, sort)
      const page = pickQueryInt(params, 'page', { min: 1, fallback: 1 })
      if (page.ok !== true) return invalidQuery(res, page)
      const pageSize = pickQueryInt(params, 'pageSize', { min: 1, max: 100, fallback: 24 })
      if (pageSize.ok !== true) return invalidQuery(res, pageSize)
      const installed = pickQueryFlag(params, 'installed')
      if (installed.ok !== true) return invalidQuery(res, installed)
      const updates = pickQueryFlag(params, 'updates')
      if (updates.ok !== true) return invalidQuery(res, updates)

      // 参数全部校验完再抓取：参数写错时不该先等一次网络。
      const cache = await requireCatalog(res)
      if (cache === null) return

      const { bundles } = await listBundlesSafe()
      const joined = joinInstalled(cache.plugins, bundles)
      const filtered = filterPlugins(joined, {
        query: query.value,
        category: category.value,
        installedOnly: installed.value,
        updatesOnly: updates.value
      })
      const sorted = sortPlugins(filtered, sort.value)
      const pageInfo = paginate(sorted, page.value, pageSize.value)

      sendJson(res, 200, {
        ok: true,
        catalog: {
          count: cache.count,
          filtered: filtered.length,
          updated: cache.updated,
          fetchedAt: cache.fetchedAt,
          source: cache.source,
          stale: cache.stale === true,
          // 客户端就靠这个显示「目录过期」横幅的**原因**；不带它的话横幅永远写「原因未知」
          // （发现页加载后 staleSource 优先取这个对象，而不是 /status 那份）。
          error: cache.error ?? null
        },
        page: {
          page: pageInfo.page,
          requestedPage: pageInfo.requestedPage,
          pageSize: pageInfo.pageSize,
          total: pageInfo.total,
          pages: pageInfo.pages
        },
        categories: cache.categories,
        items: pageInfo.items
      })
    },

    /** 契约 §2.3 */
    async installed(req, res) {
      const manager = managerOf(ctx)
      if (!hasMethod(manager, 'listBundles')) {
        sendJson(res, 200, { ok: true, bundles: [], plugins: [], manager: { available: false } })
        return
      }
      let rawBundles
      let rawPlugins
      try {
        const [bundles, plugins] = await Promise.all([
          manager.listBundles(),
          hasMethod(manager, 'listPlugins') ? manager.listPlugins() : Promise.resolve([])
        ])
        rawBundles = Array.isArray(bundles) ? bundles : []
        rawPlugins = Array.isArray(plugins) ? plugins : []
      } catch (error) {
        sendError(res, 500, 'internal', {
          message: '读取已安装列表失败。',
          hint: `宿主 pluginManager 报错：${describe(error)}；稍后重试，或看宿主日志。`
        })
        return
      }

      const loaded = await catalog.ensure()
      const catalogItems = loaded.ok === true ? loaded.cache.plugins : []
      sendJson(res, 200, {
        ok: true,
        bundles: joinBundles(rawBundles.map(projectBundle), catalogItems),
        plugins: rawPlugins.map((plugin) => projectPlugin(plugin, rawBundles))
      })
    },

    /** 契约 §2.4 */
    async install(req, res) {
      if (!requireSameOrigin(req, res)) return
      const manager = managerOf(ctx)
      if (!hasMethod(manager, 'installBundle')) {
        sendError(res, 502, 'manager-unavailable')
        return
      }
      const body = await readJsonObject(req, res)
      if (body.ok !== true) return
      const payload = body.value
      const requestedName = optionalText(payload.name)
      const requestedSpec = optionalText(payload.spec)
      if (requestedName === null && requestedSpec === null) {
        sendError(res, 400, 'bad-request', {
          message: '缺少 name 或 spec。',
          hint: '至少给出目录 id，或直接给出安装 spec。'
        })
        return
      }

      const cache = await requireCatalog(res)
      if (cache === null) return
      const items = cache.plugins

      let spec = requestedSpec
      let hit
      if (spec !== null) {
        // 安全约束：显式 spec 也必须落在目录里，不能变成任意包安装器。
        hit = items.find(
          (item) => sameKey(item.spec, spec) || sameKey(item.npm, spec) || sameKey(item.url, spec)
        )
        if (hit === undefined) {
          sendError(res, 400, 'not-in-catalog')
          return
        }
        spec = hit.spec ?? spec
      } else {
        const found = findCatalogItem(items, requestedName)
        if (found.ambiguous) {
          // 重名：绝不在多个包里随便挑一个装。让调用方给出 id 或 spec（目录页给出）。
          sendError(res, 400, 'bad-request', {
            message: `目录里有多个插件叫「${requestedName}」，无法确定要装哪一个。`,
            hint: '用目录里的 id（owner/name）或 spec 重试；市场不猜。'
          })
          return
        }
        hit = found.item
        if (hit === null) {
          sendError(res, 400, 'not-in-catalog', {
            message: '目录里没有这个插件，已拒绝安装。',
            hint: '先点「刷新目录」；市场只安装目录里列出的插件。'
          })
          return
        }
        if (hit.spec === null) {
          sendError(res, 400, 'not-in-catalog', {
            message: '这个条目没有可安装的 npm 包或仓库地址。',
            hint: '打开它的目录页，按作者给出的方式安装。'
          })
          return
        }
        spec = hit.spec
      }
      spec = pinnedNpmSpec(hit, spec)

      const options = {}
      const requestId = optionalText(payload.requestId)
      if (requestId !== null) options.requestId = requestId
      if (Array.isArray(payload.approvedBuilds)) {
        const approved = payload.approvedBuilds.filter((entry) => typeof entry === 'string' && entry !== '')
        // 契约 §2.4：空数组不传，避免让宿主以为用户批准过什么。
        if (approved.length > 0) options.approvedBuilds = approved
      }

      // 装之前先记一份 bundle 名字表：装完之后靠**前后差集**认出这次装上的到底是哪个 bundle，
      // 而不是假设「包名 == bundle 名」（两者并不总相等）。读不到就退化成 unknown，不猜。
      const before = await captureBundles(manager)

      let result
      try {
        result = await manager.installBundle(spec, Object.keys(options).length > 0 ? options : undefined)
      } catch (error) {
        sendError(res, 502, 'install-failed', {
          message: '安装调用失败。',
          hint: `宿主 installBundle 抛错：${describe(error)}；看宿主日志，确认网络与 pnpm 可用后重试。`
        })
        return
      }
      if (isReadOnlyResult(result)) {
        sendError(res, 400, 'not-allowed', {
          message: '当前 profile 不允许安装插件。',
          hint: '用 dsh plugin 命令行安装，或换一个可管理的 profile。'
        })
        return
      }

      const shape = result !== null && typeof result === 'object' ? result : {}
      const after = await captureBundles(manager)
      const activation = verifyActivation({
        application: optionalText(shape.application) ?? 'failed',
        pending: Array.isArray(shape.pendingBuilds) && shape.pendingBuilds.length > 0,
        before,
        after,
        // 目录条目的真实身份可能和 bundle 名不同：三个都作为候选交给判定。
        candidates: [hit?.npm, hit?.name, hit?.id, requestedSpec, requestedName],
        // 版本回读的期望值取自**目录**（用户点的就是那个版本），不是宿主回显。
        expectedVersion: hit?.version
      })
      sendChangeResult(res, result, 'install', activation)
    },

    /** 契约 §2.5 */
    async remove(req, res) {
      if (!requireSameOrigin(req, res)) return
      const manager = managerOf(ctx)
      if (!hasMethod(manager, 'removeBundle')) {
        sendError(res, 502, 'manager-unavailable')
        return
      }
      const body = await readJsonObject(req, res)
      if (body.ok !== true) return
      const name = optionalText(body.value.name)
      if (name === null) {
        sendError(res, 400, 'bad-request', { message: '缺少 name。', hint: '给出要卸载的 bundle 名。' })
        return
      }
      if (name.toLowerCase() === PLUGIN_NAME) {
        sendError(res, 400, 'not-allowed', {
          message: `市场不能卸载自己，请在终端执行 dsh plugin --profile ${profileName(ctx)} remove ${PLUGIN_NAME}`,
          hint: '卸载后这个市场页面也会一起消失；在终端里做才能看到完整输出。'
        })
        return
      }

      let result
      try {
        result = await manager.removeBundle(name)
      } catch (error) {
        sendError(res, 502, 'remove-failed', {
          message: '卸载调用失败。',
          hint: `宿主 removeBundle 抛错：${describe(error)}；看宿主日志后重试。`
        })
        return
      }
      if (isReadOnlyResult(result)) {
        sendError(res, 400, 'not-allowed', {
          message: '这个包由宿主基础设施管理，不能在这里卸载。',
          hint: '它是当前 profile 的组成部分；用 dsh plugin 命令行处理。'
        })
        return
      }
      sendChangeResult(res, result, 'remove')
    },

    /** 契约 §2.6 */
    async toggle(req, res) {
      if (!requireSameOrigin(req, res)) return
      const manager = managerOf(ctx)
      const body = await readJsonObject(req, res)
      if (body.ok !== true) return
      const payload = body.value
      const name = optionalText(payload.name)
      const id = optionalText(payload.id)
      if (typeof payload.enabled !== 'boolean') {
        sendError(res, 400, 'bad-request', {
          message: 'enabled 必须是 true 或 false。',
          hint: '带上 enabled: true / false 再提交一次。'
        })
        return
      }
      if (name === null && id === null) {
        sendError(res, 400, 'bad-request', {
          message: '缺少 name 或 id。',
          hint: '按 bundle 开关用 name，按插件条目开关用 id。'
        })
        return
      }

      let result
      try {
        if (name !== null) {
          if (!hasMethod(manager, 'setBundleEnabled')) {
            sendError(res, 502, 'manager-unavailable')
            return
          }
          result = await manager.setBundleEnabled(name, payload.enabled)
        } else {
          if (!hasMethod(manager, 'setPluginEnabled')) {
            sendError(res, 502, 'manager-unavailable')
            return
          }
          result = await manager.setPluginEnabled(id, payload.enabled)
        }
      } catch (error) {
        sendError(res, 502, 'toggle-failed', {
          message: '开关调用失败。',
          hint: `宿主报错：${describe(error)}；看宿主日志后重试。`
        })
        return
      }

      if (isReadOnlyResult(result)) {
        sendError(res, 400, 'not-allowed', {
          message: '这个条目由宿主基础设施管理，不能在市场里开关。',
          hint: '用 dsh plugin 命令行，或改 profile 的 bundle 配置。'
        })
        return
      }

      const value = result !== null && typeof result === 'object' ? result : {}
      const error = projectChangeError(value.error)
      const application = optionalText(value.application) ?? 'failed'
      sendJson(res, 200, {
        // 与 sendChangeResult 用**同一条规则**：只看 error 会把 `application:'failed'`
        // 且不带 error 的一次失败开关报成 ok:true。
        ok: application === 'cancelled' ? true : (error === null && application !== 'failed'),
        changed: value.changed === true,
        application,
        enabled: value.enabled === undefined ? payload.enabled : value.enabled === true,
        error,
        warnings: warningsOf(value)
      })
    },

    /** 契约 §2.7 */
    async refresh(req, res) {
      if (!requireSameOrigin(req, res)) return
      const result = await catalog.refresh()
      if (result.ok !== true) {
        sendError(res, result.status ?? 502, result.code, { message: result.message, hint: result.hint })
        return
      }
      sendJson(res, 200, {
        ok: true,
        count: result.cache.count,
        fetchedAt: result.cache.fetchedAt,
        source: result.cache.source
      })
    },

    /**
     * 契约 §2.8/§2.9：市场自身的更新通道。
     *
     * GET 与 POST 必须合并成**一个** handler：路由表以 path 为键（见 http.js createRouteTable），
     * 同一路径注册两次会让后一次覆盖前一次，GET 就永远拿到 405——这条是实测撞出来的，别拆回去。
     */
    async selfUpdate(req, res, url) {
      if (String(req.method ?? 'GET').toUpperCase() === 'POST') return applySelfUpdate(req, res)
      return checkSelfUpdate(req, res, url)
    },

    /**
     * 契约 §2.10：重启助手。
     *
     * 先 spawn 一个 detached 的等待助手，**拿到 pid 才回 200**，然后延迟
     * RESTART_EXIT_DELAY_MS 让响应落地，最后自己退出。助手等进程真的死掉再用原来的
     * 命令行拉起（见 restart.js / restart-helper.cjs）。任何一步失败都只报错、不退出——
     * 「先退出再说」会把用户留在一个没人拉起来的死进程后面。
     */
    async restart(req, res) {
      if (!requireSameOrigin(req, res)) return
      const outcome = spawnRestartHelper()
      if (outcome.ok !== true) {
        sendError(res, 500, 'restart-failed', { message: outcome.message, hint: outcome.hint })
        return
      }
      // **先排退出、再写响应**：两条都无害，但顺序上更稳——`sendJson` 同步写，退出在
      // RESTART_EXIT_DELAY_MS（900ms）之后，响应一定先落地；而万一写响应这一步抛错
      // （对已 end 过的 res 写会同步抛 ERR_STREAM_WRITE_AFTER_END），退出也已经安排好了。
      // 反过来写的话，那种异常会被外层 handler 吞掉（headersSent 分支），退出就永远不会安排，
      // 而 restart.js 已把 `requested` 置位——之后每次点击都回 `already:true` 并跳过安排。
      // （对已 destroy 的 socket 实测不抛错，所以这是一条防御性顺序，不是已复现的故障。）
      if (outcome.already !== true) {
        setTimeout(() => {
          process.exit(0)
        }, RESTART_EXIT_DELAY_MS)
      }
      sendJson(res, 200, {
        ok: true,
        pid: outcome.pid,
        already: outcome.already === true,
        delayMs: RESTART_EXIT_DELAY_MS
      })
    }
  }

  /** 契约 §2.8：只读检查（会打一次网络，但有 10 分钟缓存）。 */
  async function checkSelfUpdate(req, res, url) {
    const force = pickQueryFlag(url.searchParams, 'force')
    if (force.ok !== true) return invalidQuery(res, force)
    const result = await selfUpdate.check({ force: force.value === true })
    if (result.ok !== true) {
      sendError(res, 502, result.code ?? 'self-update-unavailable', {
        message: result.message,
        hint: result.hint ?? '',
        diagnostic: summarizeAttempts(result.attempts)
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      selfUpdate: {
        current: result.current,
        latest: result.latest,
        latestTag: result.latestTag,
        versionCode: result.versionCode,
        build: result.build,
        releasedAt: result.releasedAt,
        updateAvailable: result.updateAvailable === true,
        installable: result.installable === true,
        channel: result.channel,
        url: result.url,
        sha256: result.sha256,
        bytes: result.bytes,
        checkedAt: result.checkedAt
      }
    })
  }

  /** 契约 §2.9：应用自更新（下载 → 三道校验 → 交给 pluginManager 安装，需重启 DSH 生效）。 */
  async function applySelfUpdate(req, res) {
    if (!requireSameOrigin(req, res)) return
    const result = await selfUpdate.apply()
    if (result.ok !== true) {
      // 完整性/自证不过与「宿主装不上」要分开说：前者是拒绝安装，后者可以重试。
      const code = result.code ?? 'internal'
      sendError(res, 502, code, {
        message: result.message,
        hint: code === 'self-update-integrity'
          ? '产物校验没通过，已拒绝安装。稍后重试；仍失败说明发布产物与清单不一致，请提 issue。'
          : code === 'manager-unavailable'
            ? '当前运行环境没有 pluginManager，更新只能走终端 dsh plugin。'
            : '稍后重试；也可在终端按 Release 页面的命令升级。'
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      application: result.application,
      from: result.from ?? null,
      to: result.to ?? null,
      requiresRestart: result.requiresRestart === true,
      tarball: result.tarball ?? null,
      bytes: result.bytes ?? null,
      warnings: result.warnings ?? []
    })
  }
}

/** 把每个源的失败原因压成一行诊断串，附在 502 的 diagnostic 里。 */
function summarizeAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return ''
  return attempts
    .map((attempt) => `${attempt.label ?? attempt.id ?? '源'}：${attempt.reason ?? '失败'}`)
    .join('；')
}

function buildRoutes(ctx, catalog, selfUpdate) {
  const handlers = createHandlers(ctx, catalog, selfUpdate)
  return createRouteTable()
    .on(`${ROUTE_PREFIX}/status`, ['GET'], handlers.status)
    .on(`${ROUTE_PREFIX}/catalog`, ['GET'], handlers.catalog)
    .on(`${ROUTE_PREFIX}/installed`, ['GET'], handlers.installed)
    .on(`${ROUTE_PREFIX}/install`, ['POST'], handlers.install)
    .on(`${ROUTE_PREFIX}/remove`, ['POST'], handlers.remove)
    .on(`${ROUTE_PREFIX}/toggle`, ['POST'], handlers.toggle)
    .on(`${ROUTE_PREFIX}/refresh`, ['POST'], handlers.refresh)
    .on(`${ROUTE_PREFIX}/self-update`, ['GET', 'POST'], handlers.selfUpdate)
    .on(`${ROUTE_PREFIX}/restart`, ['POST'], handlers.restart)
}

export const name = PLUGIN_NAME
export const inject = ['webServer']

export function apply(ctx) {
  const webServer = resolveWebServer(ctx)
  const catalog = createCatalogCache()
  // managerOf 每次调用时再读：宿主服务可能比本插件晚注册（apply 时可能还拿不到）。
  const selfUpdate = createSelfUpdater({ managerOf: () => managerOf(ctx), current: PLUGIN_VERSION })
  const routes = buildRoutes(ctx, catalog, selfUpdate)

  const disposeRoute = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        await routes.dispatch(req, res)
      } catch (error) {
        // 这里只负责让客户端拿到一个能读的 500；细节进日志与 hint，不假装成功。
        console.error(`[${PLUGIN_NAME}] 请求处理失败：`, error)
        if (res.headersSent === true) {
          if (res.writableEnded !== true) res.end()
          return
        }
        sendError(res, 500, 'internal', {
          hint: `这次请求在插件里抛错了：${describe(error)}；重试一次，仍失败就看宿主日志。`
        })
      }
    }
  })

  // 卸载时必须撤掉路由：同一条 prefix 在下一次 apply 时重复注册会直接 throw。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => disposeRoute(), `${PLUGIN_NAME}: prefix route`)
  } else if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => disposeRoute())
  }
}
