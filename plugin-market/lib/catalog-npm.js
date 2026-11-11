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
import { Readable } from 'node:stream'
import { createGunzip, gunzipSync } from 'node:zlib'

import { readBoundedBody } from './http-body.js'

/** 目录包名与包内路径固定，是发布流程的约定。 */
export const CATALOG_PACKAGE = 'dsh-plugin-catalog'
export const CATALOG_FILE = 'package/plugins.json'

/** 候选镜像：国内镜像优先（97ms 实测），npm 官方兜底（1.76s 实测）。 */
export const DEFAULT_NPM_REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org']

/**
 * 响应体上限（审查任务 1）：packument 是纯元数据，实测 deepseek-harness-market
 * 的完整 packument 约 23 KB（0.02 MiB），2 MiB 是约 90 倍余量；
 * 目录 tarball 压缩后 **4.13 MiB**（2026-11-10 实测 4,329,837 B），按 ~0.09 MiB/天
 * 增长，16 MiB 约 4 个月、32 MiB 约 8 个月。这里仍取 16 MiB 并**不**跟着解压侧一起抬：
 * 它是**传输**上限（下载多少压缩字节），解压侧已经改成「边解边扫、读到就停」，
 * 两者不再需要同档（同档只是 2026-10-18 那次抬数的附带说法）。
 * 超限 = **该源失败**、进 attempts、继续下一个源——绝不拿被截断的字节去做 integrity 校验。
 *
 * 真正的「目录能不能用」判据是 `MAX_CATALOG_PAYLOAD_BYTES`（目标条目 / 目录 JSON 自身），
 * 不是任何一条 tarball 侧的预算——见下方「为什么要改成增量」。
 */
export const MAX_NPM_METADATA_BYTES = 2 * 1024 * 1024
export const MAX_NPM_TARBALL_BYTES = 16 * 1024 * 1024

/**
 * **目录载荷自己的上限**（2026-11-10）：一份 plugins.json 能有多大。
 *
 * URL 源（`catalog.js` 的 `MAX_CATALOG_JSON_BYTES`）与 npm 源（包内 `package/plugins.json`）
 * 读的是**同一份数据**，所以只能有**同一个数**——两套上限正是这次事故的结构性根因：
 * npm 那条路量的是「整包解压总量」（用户根本不读的 `package/index.json` 也算进去），
 * URL 那条路量的才是载荷本身，于是同一份 12.9 MiB 的目录在一条路上撞墙、另一条路上没事。
 *
 * 实测增长（同一份 plugins.json）：
 *   2026-10-18  7,198,658 B（6.87 MiB，5,786 条）
 *   2026-11-09 12,897,519 B（12.30 MiB，9,714 条）  ⇒ ~0.25 MiB/天、~250 条/天
 * 取 64 MiB ≈ 当前 5.2×、约 7 个月的增长余量；再往上堆不是解法（`plugins.json` 本身
 * 迟早要分页/拆片，那属于数据发布侧的事，见 `docs/API-CONTRACT.md`）。
 * 内存口径：这是**单个载荷**，不是整包；解压/读取都按它卡住，分配之下不会先吃一份再判。
 */
export const MAX_CATALOG_PAYLOAD_BYTES = 64 * 1024 * 1024


/** 元数据只是几 KB 的 JSON；tarball 有 1MB+，给它更宽的下载窗口。 */
export const NPM_METADATA_TIMEOUT_MS = 15_000
export const NPM_TARBALL_TIMEOUT_MS = 30_000

/** 手动跟随重定向的最大跳数（审查任务 2）。npm 的 tarball 正常不需要重定向。 */
export const MAX_NPM_REDIRECTS = 4

// ── tarball URL 与重定向的 SSRF 闸门（审查任务 2 / P1）─────────────────────
//
// 威胁形状：`dist.tarball` 是**元数据里的字符串**——一个被污染或恶意的镜像可以让
// 宿主进程去请求非预期目标：`file:`/`data:` 协议、带 userinfo 的 URL、
// 或者重定向到 127.0.0.1:[端口] / 169.254.169.254（云元数据）/ 10.x / 192.168.x。
// 宿主进程跑在用户机器上，这张"能连到什么"的图就是内网探测能力。
//
// 规则要同时满足两端，这是本段最容易被做坏的地方（审查原话：不能用过窄白名单破坏正常源）：
//   - **与操作员配置的 registry 同源 ⇒ 放行**，即使是 http/回环。那是用户明确指名的
//     本地镜像（verdaccio），离线测试夹具也靠这条活着；把它按"内网地址"拒掉会
//     同时弄坏线上私有镜像和整条回归。
//   - **异源目标**（元数据给的新主机、以及每一跳重定向）⇒ 必须 https、无 userinfo、
//     主机不是回环/私网/链路本地/多播/保留段、不是 *.localhost 或云元数据主机名。
//     公共 CDN 主机照常放行——**不设域名白名单**（白名单会随镜像增减而误伤）。
//   - 重定向**手动逐跳**：每一跳先验后请求，"危险目标没有被实际请求"是可证的。

function parseIPv4(text) {
  const parts = String(text).split('.')
  if (parts.length !== 4) return null
  const octets = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

/** 整数/八进制/十六进制形式的 IPv4（`2130706433`、`0177.0.0.1`）归一到点分十进制。 */
function normalizeNumericHost(hostname) {
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname)
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return hostname
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
  }
  if (/^0[xX][0-9a-fA-F]+$/.test(hostname)) {
    const n = Number(hostname)
    if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
    }
  }
  return hostname
}

function isForbiddenIPv4(text) {
  const octets = parseIPv4(text)
  if (octets === null) return false
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8「本机网络」，含 0.0.0.0
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true // 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 198 && (b === 18 || b === 19)) return true // 基准测试 198.18/15
  if (a === 192 && b === 0) return true // IETF 指派 192.0.0/24 与 192.0.2/24（文档）
  if (a === 198 && b === 51) return true
  if (a === 203 && b === 0 && octets[2] === 113) return true
  if (a >= 224) return true // 多播 224/4 与保留 240/4（含 255.255.255.255）
  return false
}

function isForbiddenIPv6(text) {
  const value = String(text).toLowerCase()
  if (value === '::1' || value === '::') return true
  if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true // fe80::/10
  if (value.startsWith('fc') || value.startsWith('fd')) return true // fc00::/7 ULA
  if (value.startsWith('ff')) return true // ff00::/8 多播
  // ::ffff:127.0.0.1 这类 IPv4 映射，剥出来再按 IPv4 判一次。
  const mapped = value.match(/^::ffff:(.+)$/)
  if (mapped !== null && isForbiddenIPv4(mapped[1])) return true
  if (mapped !== null && /^\d+\.\d+\.\d+\.\d+$/.test(mapped[1]) === false) {
    // 十六进制段形式的映射（::ffff:7f00:1 = 127.0.0.1），按段拼回 IPv4 再判。
    const hex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex !== null) {
      const hi = Number.parseInt(hex[1], 16)
      const lo = Number.parseInt(hex[2], 16)
      const rebuilt = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.')
      if (isForbiddenIPv4(rebuilt)) return true
    }
  }
  return false
}

const FORBIDDEN_HOSTNAMES = new Set(['metadata.google.internal', 'metadata.goog', 'metadata'])

/**
 * 这个异源目标能不能请求？
 * @param url - 待请求的地址（重定向时传入已解析的绝对地址）。
 * @param configuredRegistry - 操作员配置的 registry；与它同源直接放行。
 */
export function validateRemoteTarget(url, configuredRegistry) {
  let target
  try {
    target = new URL(String(url))
  } catch {
    return { ok: false, reason: '不是合法的 URL' }
  }
  // 同源例外：用户指名的镜像（含 http 私有镜像/本地 verdaccio）不受下面这些限制。
  if (sameOriginAs(target, configuredRegistry)) return { ok: true }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return { ok: false, reason: `不允许的协议 ${target.protocol}` }
  }
  // 异源只许 https：明文降级会把"镜像被中间人改掉"变成静默接受。
  if (target.protocol !== 'https:') {
    return { ok: false, reason: '异源目标必须是 https' }
  }
  if (target.username !== '' || target.password !== '' || String(target.host).includes('@')) {
    return { ok: false, reason: 'URL 不允许带 userinfo' }
  }

  let hostname = String(target.hostname ?? '').toLowerCase()
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const inner = hostname.slice(1, -1)
    if (isForbiddenIPv6(inner)) return { ok: false, reason: '目标是 IPv6 回环/内网/保留地址' }
    return { ok: true }
  }
  hostname = normalizeNumericHost(hostname)
  if (isForbiddenIPv4(hostname)) return { ok: false, reason: '目标是回环/私网/链路本地/保留地址' }
  if (/^\d+$/.test(hostname)) return { ok: false, reason: '无法归一的裸整数主机名' } // 非 IPv4 可归一形式的兜底
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { ok: false, reason: '目标是本机主机名' }
  }
  if (FORBIDDEN_HOSTNAMES.has(hostname) || hostname.endsWith('.google.internal') || hostname.endsWith('.metadata.goog')) {
    return { ok: false, reason: '目标是云元数据主机名' }
  }
  return { ok: true }
}

/** 与配置的 registry 同源？（协议+主机+端口三者一致才算，端口按默认值归一） */
function sameOriginAs(target, configuredRegistry) {
  if (typeof configuredRegistry !== 'string' || configuredRegistry === '') return false
  let base
  try {
    base = new URL(String(configuredRegistry))
  } catch {
    return false
  }
  const portOf = (u) => (u.port !== '' ? u.port : u.protocol === 'https:' ? '443' : '80')
  return target.protocol === base.protocol &&
    String(target.hostname ?? '').toLowerCase() === String(base.hostname ?? '').toLowerCase() &&
    portOf(target) === portOf(base)
}

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

// ── 最小 USTAR 读取（增量扫描 + 流式解压）──────────────────────────────────
// 只为「从一个已知的 npm tarball 里读出 package/plugins.json」而写。
// USTAR 头是 512 字节定长，name 在 0..100、size 八进制在 124..136、typeflag 在 156。
// 引一个 tar 库来读一个文件名，比这段代码本身更贵（还要多一个运行时依赖）。
//
// **为什么改成增量**（2026-11-10 事故）：整包 `gunzipSync` 再在 Buffer 里找条目，等于把
// 「我们要的那一个文件」和「包里其它我们从不读的文件」绑在**同一个上限**上。上游
// 2026-10-18 在同一 tar 里加了 `package/index.json`（4.0 MiB，我们从不读），
// `plugins.json` 又按 ~0.33 MiB/天 长，解压总量从 7.21 MiB 一路涨到 **16.14 MiB**，
// 顶穿当时的 16 MiB 整包上限——三个源全灭、市场空白；而真正要的 `plugins.json` 只有
// 12.9 MiB，单独看还有余量。同款事故 10-18 已经发生过一次（当时靠 8→16 MiB 抬数解决），
// 三周后再次被顶穿：**抬数只是把下一次推迟几周**。
//   ⇒ 现在边解压边扫，**读到目标条目就停**：后面的字节根本不解压、不分配、不校验。
//     整包解压预算（`MAX_TARBALL_BYTES`）退回它本来的角色——**炸弹防护**，不再是
//     「能不能用」的判据；「能不能用」由**目标条目自己的上限**（`MAX_CATALOG_PAYLOAD_BYTES`，
//     与 URL 源共用同一个数）决定。两条路读的是同一份载荷，就不该有两套上限——
//     那正是这次事故的结构性根因。

const BLOCK = 512
const NAME_OFFSET = 0
const NAME_LENGTH = 100
const SIZE_OFFSET = 124
const SIZE_LENGTH = 12
const TYPE_OFFSET = 156
const PREFIX_OFFSET = 345
const PREFIX_LENGTH = 155

const EMPTY = Buffer.alloc(0)

/**
 * **解压预算**：一次解 tarball 最多放出多少字节，用于炸弹防护。
 *
 * 它不是「目录能不能用」的判据（那是 `MAX_CATALOG_PAYLOAD_BYTES`），而是
 * 「一个自洽的坏包能不能把宿主吃住」的上限：`dist.integrity` 校验的是**压缩**字节，
 * 一个恶意/被劫持的镜像可以自洽地声明「压缩 255 KiB、解压 256 MB」，integrity 照样通过。
 *
 * 必须 ≥ 载荷上限：目标条目最大可到 `MAX_CATALOG_PAYLOAD_BYTES`（64 MiB），
 * 加上包里其它我们不读的条目（当前 4.1 MiB 的 `index.json` + 杂项），留 32 MiB 余量。
 * 因为读取改成流式（见 `readTarballEntry`），这里放出多少字节**都不再累积在内存里**——
 * 只有目标条目本身会被保留，所以这个数不再需要用「会不会 OOM」来倒推。
 */
export const MAX_TARBALL_BYTES = 96 * 1024 * 1024

function readField(buffer, offset, length) {
  return buffer.toString('utf8', offset, offset + length).replace(/\0.*$/s, '').trim()
}

/**
 * 取 tar 里某个条目的字节；找不到返回 null。**同步版，只用于已知的小产物**
 * （市场自身的自更新 tarball，实测 0.18 MiB）；目录那条 13 MiB+ 的路走下面的
 * `readTarballEntry`，边解压边扫、读到就停，不整包解压。
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

/**
 * gunzip 整包后再取条目（**同步**）。`maxOutputLength = MAX_TARBALL_BYTES` 是不可省的
 * 炸弹防护：`gunzipSync` 默认无上限，超了会在宿主事件循环上同步吃掉任意多内存。
 * 目录那条路不要用这个（整包解压 = 把「我们读的文件」和「不读的文件」绑死在同一上限上，
 * 2026-10-10 与 11-10 两次事故都是这个形状），用 `readTarballEntry`。
 */
export function fileFromTarball(gzipBytes, wanted) {
  return fileFromTarBuffer(gunzipSync(gzipBytes, { maxOutputLength: MAX_TARBALL_BYTES }), wanted)
}

/**
 * 增量 USTAR 扫描器：把解压出来的分片一片片喂进来，读到 `wanted` 就给出结论。
 *
 * 语义（每条都有对应的回归）：
 *  - **读到目标就停**：正文一读完立刻返回，后续分片不再解析——
 *    tarball 尾部损坏/被截断也不会影响已经拿到手的目标条目（`verify/robustness.test.mjs`）。
 *  - **只认普通文件**：`'0'` 与 NUL 才算正文件；目录、链接、PAX/GNU 扩展头按「跳过正文 +
 *    对齐填充」处理，绝不全靠 size 猜。
 *  - **目标条目有自己的上限**（`maxEntryBytes`）：超限是 `too-large`，
 *    不是「慢慢读进来再说」——上限必须在分配之前生效。
 *  - 头块里 size 不是八进制数、或读到头块全空还没找到 ⇒ 结构性失败，不抛异常。
 *
 * @param wanted - 完整条目名，例如 `package/plugins.json`。
 * @param options.maxEntryBytes - 目标条目的字节上限（缺省 `MAX_CATALOG_PAYLOAD_BYTES`）。
 */
export function createTarScanner(wanted, options = {}) {
  const maxEntryBytes = Number.isSafeInteger(options.maxEntryBytes) && options.maxEntryBytes > 0
    ? options.maxEntryBytes
    : MAX_CATALOG_PAYLOAD_BYTES
  let buffer = EMPTY
  /** 'header' | 'body' | 'skip' —— 每次 push 内部循环推进，直到结论或需要更多分片。 */
  let mode = 'header'
  let remaining = 0
  let collected = []
  let collectedBytes = 0
  let verdict = null

  const finish = (value) => { verdict = value }

  return {
    /** 喂一片解压后的字节。返回 `{ done:true }` 表示已有结论、不必再喂。 */
    push(chunk) {
      if (verdict !== null) return { done: true }
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) return { done: false }
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
      while (verdict === null) {
        if (mode === 'header') {
          if (buffer.length < BLOCK) break
          const name = readField(buffer, NAME_OFFSET, NAME_LENGTH)
          const prefix = readField(buffer, PREFIX_OFFSET, PREFIX_LENGTH)
          const rawSize = readField(buffer, SIZE_OFFSET, SIZE_LENGTH)
          const type = String.fromCharCode(buffer[TYPE_OFFSET] ?? 0)
          buffer = buffer.subarray(BLOCK)
          // 全空头块是 tar 的结尾（后面只可能是零填充）；走到这里说明包里没有目标。
          if (name === '') {
            finish({ ok: false, kind: 'bad-tarball', reason: `tarball 里没有 ${wanted}` })
            break
          }
          const size = Number.parseInt(rawSize, 8)
          if (!Number.isSafeInteger(size) || size < 0) {
            finish({ ok: false, kind: 'bad-tarball', reason: 'tar 头里的 size 无法解析' })
            break
          }
          const pad = (BLOCK - (size % BLOCK)) % BLOCK
          const fullName = prefix === '' ? name : `${prefix}/${name}`
          const isRegularFile = type === '0' || type === '\0'
          if (isRegularFile && fullName === wanted) {
            if (size > maxEntryBytes) {
              finish({
                ok: false,
                kind: 'too-large',
                reason: `条目 ${wanted} 有 ${size} 字节，超过上限 ${maxEntryBytes} 字节`
              })
              break
            }
            mode = 'body'
            remaining = size
            collected = []
            collectedBytes = 0
          } else {
            // 被跳过的条目要把「正文 + 对齐填充」一起吃掉，否则下一次读头会错位。
            mode = 'skip'
            remaining = size + pad
          }
          continue
        }
        if (mode === 'body') {
          const take = Math.min(remaining, buffer.length)
          if (take > 0) {
            collected.push(buffer.subarray(0, take))
            collectedBytes += take
            buffer = buffer.subarray(take)
            remaining -= take
          }
          if (remaining === 0) {
            finish({ ok: true, value: Buffer.concat(collected, collectedBytes) })
            continue
          }
          break // 分片用完了，等下一片
        }
        // mode === 'skip'：只移动游标，不保留任何字节。
        const take = Math.min(remaining, buffer.length)
        if (take > 0) {
          buffer = buffer.subarray(take)
          remaining -= take
        }
        if (remaining === 0) {
          mode = 'header'
          continue
        }
        break
      }
      return { done: verdict !== null }
    },
    /** 当前结论；还没读到任何结论时按「包里没有目标」处理。 */
    result() {
      return verdict ?? { ok: false, kind: 'bad-tarball', reason: `tarball 里没有 ${wanted}` }
    }
  }
}

/** 喂给 gunzip 的压缩分片大小：4 MiB 的包在这里被切成 16 片，内存占用与包体同阶。 */
const GUNZIP_INPUT_SLICE = 256 * 1024

function* gzipSlices(bytes) {
  for (let offset = 0; offset < bytes.length; offset += GUNZIP_INPUT_SLICE) {
    yield bytes.subarray(offset, Math.min(offset + GUNZIP_INPUT_SLICE, bytes.length))
  }
}

/**
 * 从 gzip 压缩的 tarball 里取一个条目，**边解压边扫、读到就停**。
 *
 * 与老实现（`gunzipSync` 整包 + `fileFromTarBuffer`）的差别不是性能，是**判据**：
 *  - 老：解压总长必须 ≤ 上限，否则整源失败——上游随便加个我们不读的文件就能打挂市场；
 *  - 新：只有「预算内没读到目标」才算失败。`MAX_TARBALL_BYTES` 是**已解压字节**的预算
 *    （炸弹防护：一个自洽的 255 KiB→256 MiB 炸弹在这里被停住），而能不能用由目标条目
 *    自己的大小决定。
 *
 * `Readable.from(...).pipe(createGunzip())` + `for await`（不是为了好看）：
 * 压缩字节按 256 KiB 喂、解压字节按片消费，两边都不会把整包堆在内存里；
 * `break` 让 async iterator 销毁流——**提前收工是结构性的，不靠上层自觉**。
 *
 * @returns `{ ok:true, value:Buffer }` 或 `{ ok:false, kind, reason }`
 *   （kind: 'too-large' | 'bad-tarball'）。永不抛异常：调用方拿它做该源失败的判据。
 */
export async function readTarballEntry(gzipBytes, wanted, options = {}) {
  if (!Buffer.isBuffer(gzipBytes) || gzipBytes.length === 0) {
    return { ok: false, kind: 'bad-tarball', reason: 'tarball 字节不可识别' }
  }
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : MAX_TARBALL_BYTES
  const scanner = createTarScanner(wanted, { maxEntryBytes: options.maxEntryBytes })
  const source = Readable.from(gzipSlices(gzipBytes), { objectMode: false })
  const gunzip = createGunzip()
  // 两边各自兜一个空 handler：真正的归类在下面的 catch 里做，
  // 但流在 finally 里被 destroy 时可能再抛一次——不能变成 unhandled 'error'。
  source.on('error', () => {})
  gunzip.on('error', () => {})
  source.pipe(gunzip)
  let outcome
  let decompressed = 0
  try {
    for await (const chunk of gunzip) {
      decompressed += chunk.length
      if (decompressed > maxBytes) {
        outcome = {
          ok: false,
          kind: 'too-large',
          reason: `解压量超过上限 MAX_TARBALL_BYTES（${maxBytes} 字节），已解压 ${decompressed} 字节仍未读到 ${wanted}`
        }
        break
      }
      if (scanner.push(chunk).done === true) {
        outcome = scanner.result()
        break
      }
    }
  } catch (error) {
    return { ok: false, kind: 'bad-tarball', reason: `读取 tarball 失败：${shortError(error)}` }
  } finally {
    source.destroy()
    gunzip.destroy()
  }
  return outcome ?? scanner.result()
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

/**
 * 取一个 GET 响应，**重定向手动逐跳**。
 *
 * `guardUrl`（审查任务 2）：每个**将要发起请求**的地址先过闸门，包括第一跳和
 * 每一跳重定向——所以"危险目标没有被实际请求"是这条路径的结构性质，不靠返回值推断。
 * 原先这里是 `redirect: 'follow'`，浏览器/undici 会盲目跟到任何目标，元数据里
 * 一个 `http://127.0.0.1:6379/x.tgz` 或一跳 302 到 169.254.169.254 就能让宿主去够内网。
 *
 * `type === 'opaqueredirect'` 或读不到 Location 时按失败处理（该源退到下一个源），
 * 不猜目标——猜就是又一个 SSRF 面。
 */
async function fetchResponse(fetchImpl, url, timeoutMs, options = {}) {
  const guardUrl = typeof options.guardUrl === 'function' ? options.guardUrl : null
  const maxRedirects = Number.isSafeInteger(options.maxRedirects) && options.maxRedirects >= 0
    ? options.maxRedirects
    : MAX_NPM_REDIRECTS
  let current = String(url)
  let hops = 0
  for (;;) {
    if (guardUrl !== null) {
      const verdict = guardUrl(current)
      if (verdict.ok !== true) return { ok: false, kind: 'unsafe-url', reason: verdict.reason, url: current }
    }
    let response
    try {
      response = await fetchImpl(current, {
        method: 'GET',
        // 手动：每一跳由上面的循环决定要不要继续、以及继续之前先验目标。
        redirect: 'manual',
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
    const status = Number(response.status)
    const isRedirect = status >= 300 && status < 400
    if (isRedirect || response.type === 'opaqueredirect') {
      // 被跳过的那一跳**必须把正文吸掉**：`redirect:'manual'` 下不消费 body，底层连接
      // 会一直挂着（这是我把手动重定向引进来才有的面——不补就等于顺手造一个连接泄漏）。
      // 吸失败不阻断流程：这一跳本来就不要内容。
      try { if (typeof response.body?.cancel === 'function') await response.body.cancel() } catch { /* 尽力而为 */ }
      if (response.type === 'opaqueredirect') {
        return { ok: false, kind: 'redirect', reason: '重定向被运行时屏蔽，读不到目标；按该源失败处理' }
      }
      let location = null
      try { location = response.headers?.get?.('location') } catch { location = null }
      if (typeof location !== 'string' || location.trim() === '') {
        return { ok: false, kind: 'http', reason: `HTTP ${status}（没有 Location）` }
      }
      if (hops >= maxRedirects) {
        return { ok: false, kind: 'redirect', reason: `重定向超过 ${maxRedirects} 跳上限` }
      }
      try {
        current = new URL(location, current).toString()
      } catch {
        return { ok: false, kind: 'http', reason: `HTTP ${status}（Location 无法解析）` }
      }
      hops += 1
      continue
    }
    if (response.ok !== true) {
      return { ok: false, kind: 'http', reason: `HTTP ${status}` }
    }
    return { ok: true, response, redirects: hops, finalUrl: current }
  }
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

  // 闸门（审查任务 2）：对**每一次将要发起的请求**生效——元数据本身与 tarball 都是，
  // 包括重定向的每一跳。同源例外让操作员配置的镜像（含 http 本地 verdaccio）照常工作；
  // 异源只许「https、无 userinfo、非内网/保留地址」，公共 CDN 不因缺白名单被误伤
  //（npmmirror 真实会把 tarball 302 到 cdn.npmmirror.com，异源但公网 ⇒ 必须放行）。
  const guard = (url) => validateRemoteTarget(url, registry)

  const metadataRes = await fetchResponse(fetchImpl, `${registry}/${encodeURIComponent(pkg)}/latest`, metadataTimeoutMs, { guardUrl: guard })
  if (metadataRes.ok !== true) return { ...metadataRes, reason: `元数据：${metadataRes.reason}`, label }

  let metadataText
  try {
    // 有界读取（审查任务 1）：超限 = 该源失败（进 attempts、继续下一个源），
    // 绝不拿"被截断的元数据"去做后面的 dist.integrity 校验。
    const read = await readBoundedBody(metadataRes.response, { maxBytes: MAX_NPM_METADATA_BYTES })
    if (read.ok !== true) {
      return { ok: false, kind: read.kind === 'too-large' ? 'too-large' : 'network', reason: `元数据：${read.reason}`, label }
    }
    metadataText = read.value
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

  const tarballRes = await fetchResponse(fetchImpl, tarball, tarballTimeoutMs, { guardUrl: guard })
  if (tarballRes.ok !== true) return { ...tarballRes, reason: `tarball：${tarballRes.reason}`, label }

  let bytes
  try {
    // 有界读取（审查任务 1）：压缩字节也要在**分配之前**受限——原先的 gzip 上限只管
    // 解压后，而 `arrayBuffer()` 阶段压缩字节已整包进内存；一个持续喂数据的镜像
    // 能在超时前把宿主吸爆。超限 = 该源失败；dist.integrity 校验原样保留在后面。
    const read = await readBoundedBody(tarballRes.response, { mode: 'bytes', maxBytes: MAX_NPM_TARBALL_BYTES })
    if (read.ok !== true) {
      return { ok: false, kind: read.kind === 'too-large' ? 'too-large' : 'bad-tarball', reason: `tarball：${read.reason}`, label }
    }
    bytes = read.value
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
  // 边缘解压边扫、读到 `plugins.json` 就停（见 `readTarballEntry` 的长注释）。
  // 这里**必须**是异步流式：整包同步解压会把「我们读的文件」和「包里其它我们不读的文件」
  // 绑死在同一上限上——2026-10-18 与 11-10 两次市场空白都是这个形状。
  const entry = await readTarballEntry(bytes, CATALOG_FILE, { maxEntryBytes: MAX_CATALOG_PAYLOAD_BYTES })
  if (entry.ok !== true) {
    return { ok: false, kind: entry.kind, reason: entry.reason, label: versionedLabel }
  }
  try {
    // 包里的 plugins.json 可能带 UTF-8 BOM（PowerShell / 记事本编辑过的文件常见；本仓库
    // 自己就有 verify/ps-bom.test.mjs）。JSON.parse 不认 BOM，而 URL 那条路走 response.text()
    // 会被 fetch 规范自动剥掉——所以只有 npm 这条路需要显式 trimStart，否则主源每次都失败。
    raw = JSON.parse(entry.value.toString('utf8').trimStart())
  } catch (error) {
    return { ok: false, kind: 'bad-tarball', reason: `解析 ${CATALOG_FILE} 失败：${shortError(error)}`, label: versionedLabel }
  }

  return { ok: true, raw, version, label: versionedLabel }
}
