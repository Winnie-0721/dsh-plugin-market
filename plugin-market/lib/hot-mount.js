/**
 * 热挂载：把刚装好的插件**装进正在运行的组合**，不必重启 DSH。
 *
 * 逻辑移植自 dsh-market（`dshmarket`）的 `src/hot.ts`（MIT），按本仓库的约定重写。
 * 保留的是它的**形状**，不是它的代码：
 *
 *   1. 在 `<profile>/.dsh-market/` 下写一个**运行时专用**的 `hot-N.yml`，内容只有纯
 *      `- id: 'mkt-<id>' / name: '<绝对 file:// URL>'` 两种行；
 *   2. 用 cordis 的 `Include` 插件把这个文件挂成**市场自己的子树**——持久化仍归
 *      `dsh.profile.bundles`（由 dsh CLI 在安装时对账），这棵子树只活在当前进程，
 *      每次启动被 `cleanHotDir` 擦掉。这一点是刻意的：运行期插进一个 bundle 层也插的
 *      id 是**硬启动失败**，所以热挂载的痕迹绝不能留到下一次启动；
 *   3. `Include` 子类**屏蔽 `write()`**：基类会把树的变更写回它读的那个文件，对我们
 *      这个一次性输入来说纯属副作用（`dsh` 自己的 agent-presets `PresetTree` 是同一个
 *      做法的先例）。
 *
 * 为什么需要它（宿主的边界，都是实测出来的）：
 *   - `pluginManager.installBundle` 对**已经装过**的包在 `reload()` **之前**就返回
 *     `restart-required`（`dsh-plugin-manager/lib/index.js:1801`），宿主根本不会尝试热应用；
 *   - 全新安装走 `reload()`，但它只对账 `dsh.profile.bundles` 里的行；**client-only**
 *     的包（只有 `dsh.client`、没有 `dsh.bundle`）连行都没有，client-modules 却只为
 *     「有活着的 loader 条目」的包提供 bundle —— 参考实现用一个 no-op shim 行补上这一格。
 *
 * 诚实边界（不许把「挂上了」说成「能用」）：
 *   - 只在 `<profile>/node_modules/<name>` 真的存在、且 patch 是**纯 insert** 时挂。
 *     含 `config:` / `!!js` 表达式的 patch 不解析、不猜测，如实回「重启后生效」；
 *   - **替换已经活着的包的热挂载不是热重载**：文件换了，Node 的 ESM 缓存里还是旧模块
 *     （参考实现的 `tests/web/update.e2e.ts` 用模块级标记实测过 2.0.0 在盘、进程仍答 1.0.0）。
 *     这条路径只用于「装上一个此前不存在的包」，不用于升级；
 *   - 挂载与卸载都有硬超时：一个卡在等服务的插件不能把整个请求永远挂住；
 *   - 挂载失败时**回滚**已建立的子树并删掉输入文件：留着它会在下一次组装时再炸一次，
 *     日志会无限增长。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 运行期热挂载输入目录（`state.json` 不在其中——那属于别的模块）。 */
export const HOT_DIR = '.dsh-market'

/** include 插件从宿主闭包里取；解析不到时市场如实回「宿主不支持热挂载」。 */
const INCLUDE_SPEC = '@deepseek-ai/cordis-plugin-include'

/**
 * 单次挂载/卸载的上限，按参考实现同口径可用环境变量覆盖。
 * 超时被当作「卡住了」（典型是一个插件在等永远不会出现的服务），退回重启路径，
 * 而不是把这次 HTTP 请求挂到天荒地老。
 */
export const HOT_MOUNT_TIMEOUT_MS = Number(process.env.DSHM_HOT_MOUNT_TIMEOUT_MS) > 0
  ? Number(process.env.DSHM_HOT_MOUNT_TIMEOUT_MS)
  : 10000

/** 已热挂载的包 → 子树句柄（只存在于当前进程）。 */
const hotHandles = new Map()
/** 需要 no-op shim 的包名（client-only）。 */
const shimNames = new Set()
let hotSequence = 0
let hotTreeClass

class ActivationTimeout extends Error {}
class DisposalTimeout extends Error {}

/** 把 `awaitable` 与上限赛跑；原 promise 的处理函数一直挂着，晚到的 rejection 不会变成未处理拒绝。 */
function raceTimeout(awaitable, ms, makeError) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(makeError()), ms)
    Promise.resolve(awaitable).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** 当前进程热挂载着的包名（`/status` 会带上它）。 */
export function listHotMounts() {
  return [...hotHandles.keys()]
}

/**
 * 把裸包名解析成 `<profile>/node_modules` 下的绝对 `file://` 入口 URL。
 *
 * 为什么必须在这里解析：热挂载行以**裸名**到达 loader 时，基类会拿它对着 **loader 自己
 * 的位置**（宿主闭包里的 `cordis-plugin-loader`）去解析，而那条父目录链永远走不到
 * `<profile>/node_modules`。在一个 loader 位于不可变依赖闭包里的宿主上，每一个热挂载
 * 都会以 `Cannot find module '<pkg>' from '…/cordis-plugin-loader/…'` 失败，然后被归成
 * 「重启后生效」——把解析锚点的问题栽给插件。对着**包实际装进去的那个 profile** 解析是
 * 锚点无关的：`require.resolve` 原生会走 `profileDir/node_modules`。
 *
 * 非裸名（相对路径、`file://`、`cordis:` 内建）原样放行，保住基类语义。
 */
export function resolveProfileEntry(profileDir, name) {
  if (typeof name !== 'string' || name === '') return name
  if (name.startsWith('.') || name.startsWith('/') || name.startsWith('file://') || name.startsWith('cordis:')) return name
  const packageDir = join(profileDir, 'node_modules', ...name.split('/'))
  try {
    return pathToFileURL(createRequire(join(profileDir, 'package.json')).resolve(name)).href
  } catch {
    // require.resolve 需要一个能解析的入口；市场的安装校验接受更宽的产物集合
    // （exports 对象、index.js）。退回 index.js，别因为解析器严格而拒绝一次合法的挂载。
    if (entryArtifactExists(packageDir)) return pathToFileURL(join(packageDir, 'index.js')).href
    // 什么都没有就把裸名交回去，让 loader 自己给出（准确的）报错。
    return name
  }
}

/** 包的入口产物是否存在：exports 的某个目标、main、或 index.js。 */
export function entryArtifactExists(packageDir) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return existsSync(join(packageDir, 'index.js'))
  }
  const targets = []
  const exportsField = manifest?.exports
  if (typeof exportsField === 'string') targets.push(exportsField)
  else if (exportsField !== null && typeof exportsField === 'object') {
    for (const value of Object.values(exportsField)) {
      if (typeof value === 'string') targets.push(value)
      else if (value !== null && typeof value === 'object') {
        for (const nested of Object.values(value)) if (typeof nested === 'string') targets.push(nested)
      }
    }
  }
  if (typeof manifest?.main === 'string') targets.push(manifest.main)
  targets.push('index.js')
  return targets.some((target) => {
    if (typeof target !== 'string' || target === '') return false
    const cleaned = target.replace(/^\.\//, '')
    return cleaned.startsWith('.') || cleaned.includes('*') ? false : existsSync(join(packageDir, cleaned))
  })
}

/**
 * 解析一个插件 bundle patch 里的**纯 insert** 行。
 *
 * patch 里只要出现任何超出 `- id: X` + `name: Y` 的东西（`config:`、`disabled:`、
 * `!!js` 表达式、别的键），就整体作废并返回 `null`：那种组合得由宿主按原样组装，
 * 猜着挂一半比不挂更坏。
 *
 * 按 `\r?\n` 切分是必须的：`#.*$` 剥不掉以 `\r` 结尾的注释（JS 把 `\r` 也当行终止符，
 * `.` 不跨它、`$` 只在最末匹配），于是注释文本会留下来、谁都匹配不上，整份 patch 被
 * 判成「含配置行」——在 Windows 上写的插件从此永远挂不上。
 *
 * @returns `[{id, name}]`，或 `null`（不适用热挂载）。
 */
export function parseSimplePatch(text) {
  if (typeof text !== 'string') return null
  const rows = []
  let pending = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (line.trim() === '') continue
    if (/^-\s+insert:\s*$/.test(line)) continue
    const id = /^\s+-\s+id:\s*(\S+)\s*$/.exec(line)
    if (id !== null) {
      if (pending !== null) return null
      pending = id[1]
      continue
    }
    const name = /^\s+name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (name !== null && pending !== null) {
      rows.push({ id: pending, name: name[1] })
      pending = null
      continue
    }
    return null
  }
  if (pending !== null || rows.length === 0) return null
  return rows
}

/** 读一个已装包的 patch 文本（按 `dsh.bundle.patch` 声明，或根目录的惯例位置）。 */
export function readPackagePatch(profileDir, packageName) {
  const packageDir = join(profileDir, 'node_modules', ...packageName.split('/'))
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const declared = manifest?.dsh?.bundle?.patch
  const files = []
  if (typeof declared === 'string' && declared !== '') files.push(join(packageDir, declared))
  else if (Array.isArray(declared)) {
    for (const entry of declared) if (typeof entry === 'string' && entry !== '') files.push(join(packageDir, entry))
  }
  if (files.length === 0) files.push(join(packageDir, 'cordis.patch.yml'))
  const texts = []
  for (const file of files) {
    try {
      texts.push(readFileSync(file, 'utf8'))
    } catch {
      // 声明的文件读不到 = 宿主会跳过**整个** bundle（读 overlay 失败是抛错），
      // 所以挂可读的那半会展示出「下一次启动永远不会加载」的东西。如实作废。
      return null
    }
  }
  return { texts, declaredCount: files.length, packageDir, manifest }
}

/** 读一个包的 `dsh` 声明块，读不到返回 null。 */
export function readPackageDsh(profileDir, packageName) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8')
    )
    return manifest?.dsh ?? {}
  } catch {
    return null
  }
}

/**
 * 取 `Include` 类并派生出市场自己的子树类。**每个进程只做一次**；
 * 拿不到就返回 `{ class: null, attempts }`，调用方退回重启路径。
 *
 * **不把失败折成一句话**：`import()` 失败的原因至少有三种（包不在解析链上、
 * 解析锚点不对、导出的形状不是我们要的），把它们各自记下来再报，
 * 否则「宿主不支持热挂载」这句结论无法指向任何可修的东西——上一轮就是这么被它误导的。
 *
 * 三条路径都试（都在真宿主里验证过哪一种会成）：
 *   1. 普通 `import()`：**实测可行**（内核注册了解析钩子）；
 *   2. `loader.internal.import(spec, baseUrl, {})`：宿主闭包里的 loader 用它解析裸名，
 *      `baseUrl` 用 `ctx.baseUrl`（= profile 目录）——实测可行；
 *      **`baseUrl` 传 undefined 或仓库路径会失败**，所以锚点必须取 ctx.baseUrl；
 *   3. `createRequire(profile/package.json).resolve`：profile 自己的解析，兜底。
 */
export async function loadHotTreeClass(ctx) {
  if (hotTreeClass !== undefined) return hotTreeClass
  const attempts = []
  const fromModule = (mod, label) => {
    const Include = mod?.Include ?? mod?.default?.Include
    if (typeof Include !== 'function') {
      attempts.push({ label, ok: false, error: `导出的形状不对（Include=${typeof mod?.Include}, default=${typeof mod?.default}）` })
      return null
    }
    attempts.push({ label, ok: true })
    return Include
  }

  let Include = null
  let via = null
  try {
    via = 'import'
    Include = fromModule(await import(INCLUDE_SPEC), 'plain import()')
  } catch (error) {
    attempts.push({ label: 'plain import()', ok: false, error: `${error?.code ?? ''} ${error?.message ?? String(error)}`.trim() })
  }

  if (Include === null) {
    const internal = ctx?.loader?.internal
    if (typeof internal?.import === 'function') {
      // 锚点必须是 ctx.baseUrl（profile 目录）。传 undefined 会让宿主从**仓库根**解析，
      // 于是得到一个 ERR_MODULE_NOT_FOUND——那是锚点的问题，不是「不支持热挂载」。
      const anchor = typeof ctx?.baseUrl === 'string' && ctx.baseUrl !== '' ? ctx.baseUrl : undefined
      if (anchor === undefined) {
        attempts.push({ label: 'loader.internal.import(baseUrl)', ok: false, error: 'ctx.baseUrl 为空，没有可用锚点' })
      } else {
        try {
          via = 'loader.internal'
          Include = fromModule(await internal.import(INCLUDE_SPEC, anchor, {}), 'loader.internal.import(baseUrl)')
        } catch (error) {
          attempts.push({ label: 'loader.internal.import(baseUrl)', ok: false, error: `${error?.code ?? ''} ${error?.message ?? String(error)}`.trim() })
        }
      }
    } else {
      attempts.push({ label: 'loader.internal.import(baseUrl)', ok: false, error: 'ctx.loader.internal.import 不可用' })
    }
  }

  if (Include === null) {
    const anchor = typeof ctx?.baseUrl === 'string' && ctx.baseUrl !== '' ? ctx.baseUrl : null
    if (anchor === null) {
      attempts.push({ label: 'createRequire(profile)', ok: false, error: 'ctx.baseUrl 为空，没有可用的 profile 锚点' })
    } else {
      try {
        via = 'createRequire'
        const require = createRequire(new URL('package.json', anchor).href)
        Include = fromModule(await import(pathToFileURL(require.resolve(INCLUDE_SPEC)).href), 'createRequire(profile)')
      } catch (error) {
        attempts.push({ label: 'createRequire(profile)', ok: false, error: `${error?.code ?? ''} ${error?.message ?? String(error)}`.trim() })
      }
    }
  }

  hotTreeClass = Include === null ? { class: null, via: null, attempts } : { class: deriveHotTreeClass(Include), via, attempts }
  return hotTreeClass
}

/** 派生出市场自己的 Include 子树类（屏蔽 write、加 client-only shim）。 */
function deriveHotTreeClass(Include) {
  class MarketHotTree extends Include {
    /** 运行期挂载列表归 bundle 层持久化，这棵树不回写文件。 */
    write() {}
    import(name, getOuterStack) {
      if (shimNames.has(name)) return { name, apply: () => {} }
      return super.import(name, getOuterStack)
    }
  }
  return MarketHotTree
}

/** 只给测试用：重置类缓存，让每次都重新解析。 */
export function resetHotTreeClassCache() {
  hotTreeClass = undefined
}

/**
 * 擦掉上次进程留下的热挂载输入。
 *
 * 只在市场启动时调一次。`state.json` 之类的持久状态**不在**这里，也绝不能被擦。
 */
export function cleanHotDir(profileDir) {
  const dir = join(profileDir, HOT_DIR)
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of entries) {
    if (!/^hot-\d+\.yml$/.test(name)) continue
    try {
      rmSync(join(dir, name), { force: true })
      removed += 1
    } catch {
      // 删不掉只是留了个文件；下一次启动会再擦一次，不构成故障。
    }
  }
  return removed
}

/**
 * 把一个刚装好的包挂进运行中的组合。
 *
 * @returns `{ ok, reason }`：`ok:false` 时 `reason` 是**给用户看的下一步**，
 *   而不是一句「失败了」——调用方要能区分「重启就能修好」和「这个包永远挂不上」。
 */
export async function hotMount(ctx, profileDir, packageName, deps = {}) {
  const mountTimeoutMs = deps.timeoutMs ?? HOT_MOUNT_TIMEOUT_MS
  try {
    if (typeof ctx?.plugin !== 'function') {
      return { ok: false, reason: '当前宿主没有可用的组合接口（ctx.plugin），热挂载做不了——重启后生效 / this host exposes no composition API; restart required' }
    }
    const loadTree = deps.loadTree ?? (() => loadHotTreeClass(ctx))
    const tree = await loadTree()
    const HotTree = tree?.class ?? null
    if (typeof HotTree !== 'function') {
      // 把**每条解析路径各自的原始错误**带出去：只回一句「宿主不支持」的话，
      // 用户与排查者都无从下手（这是上一轮真机实验就被它挡住的地方）。
      const detail = Array.isArray(tree?.attempts)
        ? tree.attempts.filter((a) => a.ok !== true).map((a) => `${a.label}: ${a.error}`).join(' | ')
        : ''
      return {
        ok: false,
        reason: `宿主不支持热挂载（include 插件不可导入）——重启后生效${detail === '' ? '' : ` / ${detail}`}`,
        attempts: tree?.attempts ?? null
      }
    }
    const patch = readPackagePatch(profileDir, packageName)
    let rows
    if (patch !== null) {
      rows = parseSimplePatch(patch.texts.join('\n'))
      if (rows === null) {
        return { ok: false, reason: 'bundle patch 含配置行或表达式，热挂载只支持纯 insert——重启后生效 / the bundle patch has config or expression rows; hot-mount handles plain inserts only — it applies on restart' }
      }
    } else {
      // 没有可用的 host patch。client-only 的包（有 dsh.client、无 dsh.bundle）永远拿不到
      // loader 条目——重启也不会，所以 client-modules 永远不会提供它的 bundle。
      // 用该包名下的一个 no-op shim 行补上这一格，这就是它的全部激活。
      const dsh = deps.dsh !== undefined ? deps.dsh : readPackageDsh(profileDir, packageName)
      if (dsh === null || dsh.client === undefined || dsh.bundle !== undefined) {
        const hasBundle = dsh?.bundle !== undefined
        return {
          ok: false,
          reason: hasBundle
            ? '这个包的 bundle patch 读不到（声明的文件缺失），宿主会跳过整个 bundle——先修好或重装它 / a declared patch file is unreadable, so the host skips the whole bundle — fix or reinstall the package'
            : '这个包没有 bundle patch，也没声明 dsh.client，没有可热挂载的内容 / no bundle patch and no dsh.client surface — nothing to hot-mount'
        }
      }
      shimNames.add(packageName)
      rows = [{ id: `client-${packageName.replace(/[^A-Za-z0-9_.-]/g, '-')}`, name: packageName }]
    }

    const dir = join(profileDir, HOT_DIR)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    hotSequence += 1
    const file = join(dir, `hot-${hotSequence}.yml`)
    // 行里的 name 是**绝对 file:// URL**（对着这个 profile 解析）。文件本身仍是一份
    // 忠实记录：cleanHotDir 每次启动擦掉它，持久化归 bundle 层，没有任何东西回读它。
    const yml = rows
      .map((row) => `- id: 'mkt-${row.id}'\n  name: '${resolveProfileEntry(profileDir, row.name)}'\n`)
      .join('')
    writeFileSync(file, yml)

    const handle = ctx.plugin(HotTree, { path: pathToFileURL(file).href })
    try {
      const awaitable = typeof handle?.await === 'function' ? handle.await() : handle
      await raceTimeout(awaitable, mountTimeoutMs, () => new ActivationTimeout(
        `热挂载在 ${mountTimeoutMs / 1000}s 内没有落地——这个插件可能卡在等待一个永远不会出现的服务`
      ))
    } catch (error) {
      // 失败/卡住的挂载必须**什么都不留下**：销毁半挂的子树，停掉对它的重试；
      // 再删掉输入文件，否则下一次组装replay 会再抛同一个解析错误，日志无限增长。
      try {
        Promise.resolve(handle?.dispose?.()).catch(() => {})
      } catch {
        // 尽力而为
      }
      try {
        rmSync(file, { force: true })
      } catch {
        // 尽力而为
      }
      shimNames.delete(packageName)
      throw error
    }

    hotHandles.set(packageName, handle)
    return { ok: true, reason: null, via: tree.via ?? null, file }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `热挂载失败，重启后生效——${message} / hot-mount failed; restart required: ${message}` }
  }
}

/** 表里与 `packageName` 对应的实际键（大小写不敏感）；没有就返回 null。 */
function hotKeyOf(packageName) {
  if (hotHandles.has(packageName)) return packageName
  const wanted = String(packageName).toLowerCase()
  for (const key of hotHandles.keys()) if (key.toLowerCase() === wanted) return key
  return null
}

/** 这个包在本进程里热挂载着吗（大小写不敏感）。 */
export function isHotMounted(packageName) {
  return hotKeyOf(packageName) !== null
}

/**
 * 卸掉本次会话里热挂载过的包，立刻从运行中的组合里移除。
 * @returns true 表示找到一个活着的热挂载并已销毁。
 */
export async function hotUnmount(packageName, deps = {}) {
  const key = hotKeyOf(packageName)
  const handle = key === null ? undefined : hotHandles.get(key)
  if (handle === undefined) return false
  // 先摘表再等待：一个永远不结束的 teardown 不能把这个包一直挂在表里，
  // 否则下一次挂载会复用已经处在销毁中的句柄。
  hotHandles.delete(key)
  shimNames.delete(key)
  const label = key
  const timeoutMs = deps.timeoutMs ?? HOT_MOUNT_TIMEOUT_MS
  const disposal = Promise.resolve().then(() => handle?.dispose?.())
  let answered = false
  void disposal.then(
    () => {
      if (answered) console.warn(`[deepseek-harness-market] 热卸载 ${label}：teardown 在等待之后才结束`)
    },
    (error) => {
      console.warn(
        `[deepseek-harness-market] 热卸载 ${label}：dispose 失败${answered ? '（在等待之后）' : ''}——${error instanceof Error ? error.message : String(error)}`
      )
    }
  )
  let timer
  try {
    await Promise.race([
      disposal,
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new DisposalTimeout(`${label}：teardown 在 ${timeoutMs / 1000}s 内没有结束`)),
          timeoutMs
        )
      })
    ])
    answered = true
    return true
  } catch (error) {
    answered = true
    // 报 false 是**有意的**：没能确认它已停止，就不能说「已经卸掉了」。
    console.warn(
      `[deepseek-harness-market] 热卸载 ${label}：${error instanceof Error ? error.message : String(error)}——它从下一次启动起不再加载`
    )
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 只给测试用：清空进程内的热挂载表与 shim 名集。 */
export function resetHotStateForTests() {
  hotHandles.clear()
  shimNames.clear()
  hotSequence = 0
}
