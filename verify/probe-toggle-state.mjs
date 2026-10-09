/**
 * 开关 ↔ 重启 交界实验的 HTTP 侧（Node 负责 HTTP/JSON，PowerShell 负责起停宿主）。
 *
 * 用法：node probe-toggle-state.mjs <port> <hostOutLog> <outJson> <action> [name]
 *   action = read | off | on
 * 把结果写成 JSON，交给 PowerShell 比较「重启前 / 重启后」。
 *
 * 为什么不在 PowerShell 里解析：HttpWebRequest + ConvertFrom-Json 在嵌套对象上会拿到
 * PSCustomObject，取值容易得到空串（第一版就踩过：bundles 读成 0 条、toggle 收到 400）。
 * 断言工具读错会把「工具问题」误报成「实现问题」。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [port, logFile, outFile, action, nameArg] = process.argv.slice(2)
if (!port || !logFile || !outFile || !action) {
  console.error('用法: node probe-toggle-state.mjs <port> <hostOutLog> <outJson> <read|off|on> [name]')
  process.exit(2)
}

const log = readFileSync(logFile, 'utf8')
const m = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/[^\s"']*[?&](?:token|access_token|t)=[A-Za-z0-9._~+/\-=%]+/.exec(log)
if (!m) { console.error('日志里没找到鉴权 URL'); process.exit(2) }

const first = await fetch(m[0], { redirect: 'manual' })
const cookie = (first.headers.getSetCookie ? first.headers.getSetCookie() : [first.headers.get('set-cookie')])
  .filter(Boolean).map((c) => c.split(';')[0]).join('; ')

const base = `http://127.0.0.1:${port}`
const H = { cookie, origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }

const inst = await fetch(`${base}/plugin-market/installed`, { headers: H })
if (inst.status !== 200) { console.error(`/installed -> ${inst.status}`); process.exit(2) }
const ij = await inst.json()
const bundles = ij.bundles || []

const infra = /^(?:@deepseek-ai\/|cordis:)/
// 优先挑第三方（非 @deepseek-ai）bundle：基础设施包宿主会拒绝或不该动。
const target = nameArg
  ? bundles.find((b) => b.name === nameArg)
  : bundles.find((b) => !infra.test(String(b.name)) && String(b.name) !== 'deepseek-harness-market')
if (!target) { console.error('找不到实验目标 bundle'); process.exit(2) }

let application = null
if (action === 'off' || action === 'on') {
  const want = action === 'on'
  const res = await fetch(`${base}/plugin-market/toggle`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ name: target.name, enabled: want }),
  })
  const text = await res.text()
  try { application = JSON.parse(text).application ?? null } catch { application = `non-json:${res.status}` }
  console.log(`  toggle ${target.name} -> enabled=${want}  HTTP ${res.status}  application=${application}`)
}

// toggle 之后再读一次，拿「真实落到的状态」——不是我们请求的值，是宿主报的值。
const after = await (await fetch(`${base}/plugin-market/installed`, { headers: H })).json()
const now = (after.bundles || []).find((b) => b.name === target.name)

const out = {
  target: target.name,
  action,
  application,
  enabledBefore: target.enabled === true,
  enabledAfter: now ? now.enabled === true : null,
}
writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out))
