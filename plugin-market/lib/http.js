/**
 * host 半共用的 HTTP 小工具。
 *
 * 七个端点共享同一套响应约定（状态码、Content-Type、Cache-Control、错误码 → 中文文案）。
 * 集中在这里，是为了避免每个 handler 各写一份、然后慢慢漂移。
 * 这里只做传输层判断，不吞业务错误：任何失败都由调用方决定用哪个错误码。
 */

import { Buffer } from 'node:buffer'

/** 契约 §1：请求体上限 64 KiB。 */
export const MAX_BODY_BYTES = 64 * 1024

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

/** 允许写操作的 Sec-Fetch-Site 取值；其余（cross-site / same-site / none）一律拒绝。 */
export const SAME_ORIGIN_FETCH_SITES = new Set(['same-origin'])

/**
 * 官方桌面壳（Electron）的页面 origin。桌面端把 GUI 跑在自定义协议 `dsh-app://app` 下，
 * 所有 API 请求由主进程转发给本地宿主；那一步会**主动剥掉 Origin / Sec-Fetch-Site / Cookie / Host**
 * 再补上宿主的 cookie（见 `dsh-desktop-host` 的 `forwardWebRequest`）。
 * 因此在桌面端，"两个头都不存在"是**正常**请求的形状，不能当成跨站。
 */
export const DESKTOP_SHELL_ORIGINS = new Set(['dsh-app://app', 'dsh-app://shell'])

/** 请求是否来自本机回环地址（桌面壳的转发、本地脚本、curl 都满足）。 */
export function isLoopbackRequest(req) {
  const address = req?.socket?.remoteAddress
  if (typeof address !== 'string' || address === '') return false
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return normalized === '::1' || normalized === '::ffff:1' || normalized.startsWith('127.')
}

/**
 * 错误码 → 默认中文文案。每条都回答「发生了什么 / 为什么 / 现在怎么办」。
 * 端点需要更精确的说法时用 sendError 的 overrides 覆盖，而不是另起一套措辞。
 */
export const ERROR_TEXT = {
  'bad-request': {
    message: '请求参数不对。',
    hint: '按响应里的说明改好参数再试一次。'
  },
  'cross-origin': {
    message: '这个请求不是从本机页面发出的。',
    hint: '在市场界面里操作；用脚本时带上 Origin，或 Sec-Fetch-Site: same-origin。'
  },
  'method-not-allowed': {
    message: '这个地址不支持这种请求方式。',
    hint: '按响应 Allow 头里允许的方法重试。'
  },
  'not-found': {
    message: '没有这个接口。',
    hint: '可用接口见响应里的说明。'
  },
  'catalog-unavailable': {
    message: '插件目录取不到数据。',
    hint: '检查网络或 DSHM_REGISTRY_URL，然后点「刷新目录」重试。'
  },
  'catalog-timeout': {
    message: '插件目录源没有按时响应。',
    hint: '网络可能不通；稍后点「刷新目录」重试，上次的目录结果仍会展示。'
  },
  'manager-unavailable': {
    message: '宿主没有提供插件管理服务。',
    hint: '现在只能浏览和搜索；安装、卸载、开关请在终端用 dsh plugin 完成。'
  },
  'not-in-catalog': {
    message: '这个插件不在目录里，已拒绝安装。',
    hint: '市场只允许安装目录内的插件；先刷新目录再试。'
  },
  'install-failed': {
    message: '安装调用失败。',
    hint: '看宿主日志里的 deepseek-harness-market 记录，确认网络与 pnpm 可用后重试。'
  },
  'remove-failed': {
    message: '卸载调用失败。',
    hint: '看宿主日志里的 deepseek-harness-market 记录，然后重试。'
  },
  'toggle-failed': {
    message: '开关调用失败。',
    hint: '看宿主日志里的 deepseek-harness-market 记录，然后重试。'
  },
  'not-allowed': {
    message: '这个操作被宿主拒绝。',
    hint: '这类条目由宿主基础设施管理，请在终端里操作。'
  },
  'restart-failed': {
    message: '没能启动重启助手。',
    hint: '看宿主日志里 deepseek-harness-market 的记录，然后手动重启 DSH。'
  },
  internal: {
    message: '插件市场内部出错了。',
    hint: '看宿主日志里的 deepseek-harness-market 记录，然后重试。'
  }
}

/** 取请求头；Node 会把名字转小写，数组值取第一个。 */
export function headerOf(req, name) {
  const value = req?.headers?.[name]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

export function normalizePath(pathname) {
  const value = typeof pathname === 'string' && pathname !== '' ? pathname : '/'
  if (value === '/') return '/'
  const trimmed = value.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** 按契约 §1 写 JSON：固定 Content-Type 与 no-store，并自己算 Content-Length。 */
export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
    ...extraHeaders
  })
  res.end(body)
}

/**
 * 统一的失败响应：`{ ok:false, error:{ code, message, hint, diagnostic? } }`。
 * code 必须在契约 §1 的清单里；message/hint 允许端点覆盖。
 *
 * `diagnostic` 是契约 §2.8 的字段（按顺序列出每个源各自的失败原因），客户端会用它对
 * EPERM/EACCES/EBUSY 做「文件被占用」的可操作提示——早先这里只透传 message/hint，
 * 传进来的 diagnostic 被静默丢掉，那段文案永远拿不到证据。
 */
export function sendError(res, status, code, overrides = {}) {
  const fallback = ERROR_TEXT[code] ?? { message: code, hint: undefined }
  const message = typeof overrides.message === 'string' && overrides.message !== '' ? overrides.message : fallback.message
  const hint = typeof overrides.hint === 'string' && overrides.hint !== '' ? overrides.hint : fallback.hint
  const error = { code, message }
  if (typeof hint === 'string' && hint !== '') error.hint = hint
  if (typeof overrides.diagnostic === 'string' && overrides.diagnostic !== '') error.diagnostic = overrides.diagnostic
  sendJson(res, status, { ok: false, error }, overrides.headers ?? {})
}

export function sendMethodNotAllowed(res, methods) {
  const allow = methods.map((method) => method.toUpperCase()).join(', ')
  sendError(res, 405, 'method-not-allowed', {
    message: `这个地址只接受 ${allow}。`,
    hint: `用 ${allow} 重新请求；GET 与 POST 的端点不通用。`,
    headers: { allow }
  })
}

/** 请求体是否真的存在；只有非空体才要求 JSON Content-Type。 */
export function hasBody(req) {
  const transferEncoding = headerOf(req, 'transfer-encoding')
  if (typeof transferEncoding === 'string' && transferEncoding !== '') return true
  const length = Number(headerOf(req, 'content-length'))
  return Number.isFinite(length) && length > 0
}

export function isJsonContentType(req) {
  const value = headerOf(req, 'content-type')
  if (typeof value !== 'string') return false
  return value.split(';')[0].trim().toLowerCase() === 'application/json'
}

/**
 * 写操作的来源判定（契约 §1）。
 *
 * 只拒绝**有明确外站证据**的请求，其余放行——这条规则是被真实桌面端纠正过的：
 * 起初写成「既没有 Origin 也没有 Sec-Fetch-Site 就拒绝」，结果官方桌面壳的
 * `forwardWebRequest` 恰好会剥掉这两个头，导致 Electron 里的安装/卸载/刷新全部 403。
 *
 * 判定顺序：
 *  1. `Origin: dsh-app://app|shell` → 官方桌面壳，放行（Origin 由浏览器写死，页面脚本伪造不了）；
 *  2. `Sec-Fetch-Site: cross-site` → 明确的跨站请求，拒绝；
 *  3. 有 `Origin` → 与 `Host` 比 host，一致才放行（不一致即第三方页面）；
 *  4. 两个头都没有 → 只有来自回环地址才放行（桌面壳转发、本地脚本）；
 *  5. 只有 `Sec-Fetch-Site` → 仅 `same-origin` 放行。
 */
export function isSameOrigin(req) {
  const originRaw = headerOf(req, 'origin')
  const origin = typeof originRaw === 'string' ? originRaw.trim() : ''
  const siteRaw = headerOf(req, 'sec-fetch-site')
  const site = typeof siteRaw === 'string' ? siteRaw.trim().toLowerCase() : ''

  if (origin !== '' && DESKTOP_SHELL_ORIGINS.has(origin)) return true
  if (site === 'cross-site') return false
  if (origin !== '') {
    const host = headerOf(req, 'host')
    if (typeof host !== 'string' || host.trim() === '') return false
    let originHost
    try {
      originHost = new URL(origin).host
    } catch {
      return false
    }
    return originHost.toLowerCase() === host.trim().toLowerCase()
  }
  if (site === '') return isLoopbackRequest(req)
  return SAME_ORIGIN_FETCH_SITES.has(site)
}

/** 同源不过就自己写 403；返回 false 表示调用方应立刻收工。 */
export function requireSameOrigin(req, res) {
  if (isSameOrigin(req)) return true
  // 把收到的判定信号如实写进 hint：跨站被拒时，用户/脚本需要知道是哪一个头导致的，
  // 否则只能在「403 cross-origin」和猜之间来回（桌面端曾因壳剥掉这些头而全部被拒）。
  const origin = headerOf(req, 'origin') ?? '（无）'
  const site = headerOf(req, 'sec-fetch-site') ?? '（无）'
  const address = req?.socket?.remoteAddress ?? '（未知）'
  sendError(res, 403, 'cross-origin', {
    hint: `市场只接受来自本页面的写请求。本次收到：Origin=${origin}、Sec-Fetch-Site=${site}、来源地址=${address}。`
      + '在本页内重试；脚本请带上 Origin 或 Sec-Fetch-Site: same-origin，桌面端请从应用内操作。'
  })
  return false
}

/**
 * 读请求体：上限 64 KiB，超过就停下不再累积（把响应交给调用方写）。
 * 返回 `{ ok:true, value }` 或 `{ ok:false, status, code, message, hint }`。
 */
export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        finish({
          ok: false,
          status: 400,
          code: 'bad-request',
          message: `请求体超过 ${Math.round(limit / 1024)} KiB 上限。`,
          hint: '这个接口只收很小的 JSON；去掉多余内容后重试。'
        })
        // 继续把剩下的字节读掉，否则客户端可能收到 ECONNRESET 而不是上面的说明。
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) return
      if (size === 0) {
        finish({ ok: true, value: null })
        return
      }
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        finish({ ok: true, value: JSON.parse(text) })
      } catch {
        finish({
          ok: false,
          status: 400,
          code: 'bad-request',
          message: '请求体不是合法的 JSON。',
          hint: '检查 JSON 语法（引号、逗号）后重试。'
        })
      }
    })

    req.on('error', () => {
      finish({
        ok: false,
        status: 400,
        code: 'bad-request',
        message: '请求体读到一半就断了。',
        hint: '重新提交一次。'
      })
    })
  })
}

/** 把「Content-Type 校验 + 读体 + 必须是对象」三步合成一步，失败时顺手写响应。 */
export async function readJsonObject(req, res) {
  if (hasBody(req) && !isJsonContentType(req)) {
    sendError(res, 400, 'bad-request', {
      message: '请求体必须是 application/json。',
      hint: '把 Content-Type 设为 application/json 后重试。'
    })
    return { ok: false }
  }
  const read = await readJsonBody(req)
  if (read.ok !== true) {
    sendError(res, read.status, read.code, { message: read.message, hint: read.hint })
    return { ok: false }
  }
  // 空体交给字段校验报「缺哪个字段」，比在这里硬说一句「没有 body」更有用。
  if (read.value === null) return { ok: true, value: {} }
  if (typeof read.value !== 'object' || Array.isArray(read.value)) {
    sendError(res, 400, 'bad-request', {
      message: '请求体必须是一个 JSON 对象。',
      hint: '用 { "字段": 值 } 的形式提交。'
    })
    return { ok: false }
  }
  return { ok: true, value: read.value }
}

/** 查询参数：字符串，缺省空串；超长直接报错而不是截断（截断会让人搜到错的结果）。 */
export function pickQueryText(params, name, options = {}) {
  const raw = params.get(name)
  if (raw === null) return { ok: true, value: '' }
  const value = raw.trim()
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : undefined
  if (maxLength !== undefined && value.length > maxLength) {
    return {
      ok: false,
      message: `参数 ${name} 超过 ${maxLength} 个字符。`,
      hint: `缩短 ${name} 后重试。`
    }
  }
  return { ok: true, value }
}

/** 查询参数：整数，带范围与缺省值。 */
export function pickQueryInt(params, name, options = {}) {
  const min = Number.isFinite(options.min) ? options.min : 1
  const max = Number.isFinite(options.max) ? options.max : Number.MAX_SAFE_INTEGER
  const raw = params.get(name)
  if (raw === null || raw.trim() === '') return { ok: true, value: options.fallback }
  const text = raw.trim()
  if (!/^\d+$/.test(text)) {
    return { ok: false, message: `参数 ${name} 必须是整数。`, hint: `${name} 用 ${min} 到 ${max} 之间的整数。` }
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { ok: false, message: `参数 ${name} 超出取值范围。`, hint: `${name} 用 ${min} 到 ${max} 之间的整数。` }
  }
  return { ok: true, value }
}

/** 查询参数：枚举值，缺省 fallback；不认识的值报错而不是悄悄回默认。 */
export function pickQueryEnum(params, name, allowed, fallback) {
  const raw = params.get(name)
  if (raw === null || raw.trim() === '') return { ok: true, value: fallback }
  const value = raw.trim()
  if (!allowed.includes(value)) {
    return { ok: false, message: `参数 ${name} 的取值不认识。`, hint: `${name} 只能是 ${allowed.join(' / ')}。` }
  }
  return { ok: true, value }
}

/** 查询参数：0/1 开关。 */
export function pickQueryFlag(params, name) {
  const raw = params.get(name)
  if (raw === null || raw === '') return { ok: true, value: false }
  if (raw === '0') return { ok: true, value: false }
  if (raw === '1') return { ok: true, value: true }
  return { ok: false, message: `参数 ${name} 只能是 0 或 1。`, hint: `去掉 ${name}，或填 0 / 1。` }
}

/**
 * 方法分发：契约要求一条 prefix 路由内部分发（重复注册 (kind,path) 会 throw）。
 * 这里把「路径不存在 → 404」「方法不匹配 → 405」挡在业务代码之外，
 * 业务 handler 只需假设自己拿到了正确的路径与方法。
 */
export function createRouteTable() {
  const routes = new Map()

  const table = {
    on(path, methods, handler) {
      const key = normalizePath(path)
      routes.set(key, { methods: methods.map((method) => method.toUpperCase()), handler })
      return table
    },
    paths() {
      return [...routes.keys()]
    },
    async dispatch(req, res) {
      let url
      try {
        url = new URL(typeof req.url === 'string' && req.url !== '' ? req.url : '/', 'http://localhost')
      } catch {
        sendError(res, 400, 'bad-request', { message: '请求地址无法解析。', hint: '检查请求的 URL。' })
        return
      }
      const pathname = normalizePath(url.pathname)
      const route = routes.get(pathname)
      if (route === undefined) {
        sendError(res, 404, 'not-found', {
          message: `没有 ${pathname} 这个接口。`,
          hint: `可用接口：${[...routes.keys()].join('、')}。`
        })
        return
      }
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
      if (!route.methods.includes(method)) {
        sendMethodNotAllowed(res, route.methods)
        return
      }
      await route.handler(req, res, url)
    }
  }

  return table
}
