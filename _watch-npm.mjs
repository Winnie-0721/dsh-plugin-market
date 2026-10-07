/** 轮询 npm 是否出现 1.1.6 + 这次 publish workflow 的结论（只读）。 */
const REPO = 'Winnie-0721/dsh-plugin-market'
const read = (await import('node:child_process')).execFileSync
const token = read('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
  .split('\n').find((l) => l.startsWith('password='))?.slice('password='.length)?.trim()
const H = { Authorization: `Bearer ${token}`, 'User-Agent': 'dsh', Accept: 'application/vnd.github+json' }

for (let i = 1; i <= 40; i++) {
  const stamp = new Date().toISOString().slice(11, 19)
  // workflow 结论
  let run = '(还没出现)'
  try {
    const j = await (await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/publish-npm.yml/runs?per_page=1`, { headers: H })).json()
    const r = j.workflow_runs?.[0]
    if (r) run = `${r.status}/${r.conclusion ?? '…'} @${r.created_at}`
  } catch { run = '(查询失败)' }
  // npm 版本
  let versions = '(查询失败)'
  try {
    const j = await (await fetch('https://registry.npmjs.org/deepseek-harness-market', { signal: AbortSignal.timeout(15000) })).json()
    versions = Object.keys(j.versions ?? {}).join(', ')
  } catch { /* 忽略 */ }
  console.log(`[${stamp}] workflow: ${run}`)
  console.log(`            npm: ${versions}`)
  if (versions.includes('1.1.6')) { console.log('\n✓ npm 上已出现 1.1.6 —— 发布完成'); break }
  await new Promise((r) => setTimeout(r, 20000))
}
