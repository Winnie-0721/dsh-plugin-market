/**
 * 断言：scripts/ 下所有 .ps1 里的 Get-Content 调用都必须显式写 `-Encoding UTF8`。
 *
 * 为什么值得一条测试：Windows PowerShell 5.1 的 Get-Content 默认按系统 ANSI（本机 GBK）
 * 解码无 BOM 的 UTF-8 文件，中文会被读成乱码，再写进哪里就是哪里坏——发版脚本就这么把
 * GitHub Release 正文（v1.0.0–v1.1.5，v1.0.2 除外）整页写成了乱码，因为 notes 用完直接
 * 传给了 `gh release create --notes-file`。显式 `-Encoding UTF8` 让 PS 5.1 与 PowerShell 7
 * （CI）行为一致，这类问题从「跑起来才发现」变成「提交时就拦住」。
 *
 * 约定：含 Get-Content 的语句写在一行里（跨行参数会被当漏写而报错）；纯注释行（# 开头）
 * 不算调用；编码必须是 UTF8（`-Encoding Default` 就是 ANSI，等于没写）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['scripts']
const problems = []
let calls = 0

// 单行判定：真实调用行 + 负向对照共用同一份逻辑，保证对照测的就是被测的那把尺子。
function isViolation(line) {
  const code = line.trim()
  if (!code.includes('Get-Content')) return false
  if (code.startsWith('#')) return false
  return !/-Encoding\s+UTF8/i.test(line)
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) { walk(path); continue }
    if (!name.endsWith('.ps1')) continue
    const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!line.includes('Get-Content') || line.trim().startsWith('#')) return
      calls += 1
      if (isViolation(line)) problems.push(`${path}:${index + 1}`)
    })
  }
}
for (const root of roots) walk(root)

// 负向对照：漏写 -Encoding 的行必须被抓、注释行必须放过、合规行必须通过——
// 尺子本身先量一遍，否则它可能只是一句「全部通过」。
const controls = [
  [true, '$x = Get-Content CHANGELOG.md -Raw'],
  [true, "$notes = Get-Content (Join-Path $root $f) -Raw"],
  [false, '$x = Get-Content CHANGELOG.md -Raw -Encoding UTF8'],
  [false, "$x = Get-Content -LiteralPath $p -Raw -Encoding utf8"],
  [false, '# Get-Content 读文件不带 -Encoding 是历史事故'],
]
for (const [expected, line] of controls) {
  if (isViolation(line) !== expected) problems.push(`负向对照失败（${expected ? '该抓' : '该放'}）：${line}`)
}

if (calls === 0) problems.push('scripts/ 下没有找到任何 Get-Content 调用——检查本身可能失效了')
if (problems.length > 0) {
  for (const item of problems) console.log(`FAIL ${item}`)
  process.exit(1)
}
console.log(`PowerShell 读取编码检查：scripts/ 下 ${calls} 处 Get-Content 全部显式 -Encoding UTF8（含负向对照）`)
