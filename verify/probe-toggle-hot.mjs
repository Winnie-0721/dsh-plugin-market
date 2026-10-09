/**
 * 决定性实验：真做一次 /plugin-market/toggle，看宿主回 applied（已热生效）
 * 还是 restart-required（要重启）。
 *
 * 用法：node probe-toggle-hot.mjs <port> <hostOutLog>
 * 只读日志取鉴权 URL，然后走正常的「token URL → Set-Cookie → 带 cookie 请求」流程。
 * 不碰用户的 desktop profile（调用方保证 profile 是 scratch）。
 */
import { readFileSync } from 'node:fs'

const port = process.argv[2]
const logFile = process.argv[3]
if (!port || !logFile) { console.error('用法: node probe-toggle-hot.mjs <port> <hostOutLog>'); process.exit(2) }

const log = readFileSync(logFile, 'utf8')
const m = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/[^\s"']*[?&](?:token|access_token|t)=[A-Za-z0-9._~+/\-=%]+/.exec(log)
if (!m) { console.error('日志里没找到鉴权 URL'); process.exit(2) }
const authUrl = m[0]
console.log('已取到鉴权 URL（不打印 token）')

// 1) 用鉴权 URL 建立会话（不要自动跟随，先拿 Set-Cookie）
const first = await fetch(authUrl, { redirect: 'manual' })
const cookie = (first.headers.getSetCookie ? first.headers.getSetCookie() : [first.headers.get('set-cookie')])
  .filter(Boolean).map((c) => c.split(';')[0]).join('; ')
console.log(`建立会话：status=${first.status} cookie=${cookie ? 'yes' : 'no'}`)

const base = `http://127.0.0.1:${port}`
const H = { cookie, origin: base, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }

// 2) 读已安装列表
const inst = await fetch(`${base}/plugin-market/installed`, { headers: H })
const ij = await inst.json()
const bundles = ij.bundles || []
console.log(`\nGET /installed -> ${inst.status}, bundles=${bundles.length}`)
for (const b of bundles) {
  const rows = b.rows || []
  console.log(`  - ${b.name} v${b.version} enabled=${b.enabled} rows=${rows.length} rowIds=${JSON.stringify(rows.map((r) => r.rowId).slice(0, 5))}`)
}

// 3) 选一个**非基础设施**的目标：优先第三方插件（有 rowId 的），否则用 market 自己
const infra = /^(?:@deepseek-ai\/|cordis:)/
const candidate =
  bundles.find((b) => !infra.test(String(b.name)) && String(b.name) !== 'deepseek-harness-market') ||
  bundles.find((b) => String(b.name) === 'deepseek-harness-market')
if (!candidate) { console.error('没有可用的 toggle 目标'); process.exit(2) }

const name = candidate.name
const cur = candidate.enabled === true
const next = !cur
console.log(`\n目标：${name}（当前 enabled=${cur}）→ 请求 enabled=${next}`)

// 4) 真实 toggle
const res = await fetch(`${base}/plugin-market/toggle`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ name, enabled: next }),
})
const text = await res.text()
console.log(`\nPOST /toggle -> ${res.status}`)
console.log('body: ' + text)

let app = ''
let changed = ''
try {
  const j = JSON.parse(text)
  app = j.application ?? ''
  changed = String(j.changed)
} catch { /* 非 JSON 就保持空 */ }

console.log('\n================= 结论 =================')
console.log(` application = '${app}'  changed = ${changed}`)
if (app === 'applied') {
  console.log(' => 宿主**已经热生效**（HMR 在场）：开箱即热开关，不需要我们写 patch 文件')
} else if (app === 'restart-required') {
  console.log(' => 这个 profile 里 HMR 不在：开关要重启才生效')
} else if (app === 'overridden') {
  console.log(' => 被更高优先级的覆盖层压住（写进去了，但没赢）')
} else {
  console.log(' => 其它结果，需要进一步判断')
}
console.log('========================================')

// 5) 复位
const back = await fetch(`${base}/plugin-market/toggle`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ name, enabled: cur }),
})
console.log(`\n复位 toggle -> ${back.status} ${await back.text()}`)
