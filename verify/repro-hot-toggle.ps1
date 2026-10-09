# 决定性实验：在 scratch profile（_verify\dshhome）上真做一次 toggle，
# 看宿主回的是 applied（= 已经热生效）还是 restart-required（= 要重启）。
#
# 为什么用 Node 而不是在 PowerShell 里解析 JSON：HttpWebRequest + ConvertFrom-Json 在
# 嵌套对象上会拿到 PSCustomObject，取值容易得到空串（我第一版就踩了：bundles 读成 0 条、
# name 读成空，于是 toggle 收到 400「缺少 name」）。断言工具读错会把「工具问题」误报成
# 「实现问题」——这正是 Common.ps1 文件头记过的老坑（Invoke-WebRequest 读 4xx 正文）。
# 所以这里只让 PowerShell 负责起/停宿主，HTTP 与 JSON 交给 Node。
#
# 只碰 scratch profile，不碰用户的 desktop profile。
[CmdletBinding()]
param(
  # marketcheck 是 ui-check.ps1 用的 scratch profile，里面已经有 market bundle。
  [string]$ProfileName = 'marketcheck'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$node = Get-NodeExe
if (-not $node) { throw '找不到 node.exe' }
Ensure-Dirs

$port = Get-FreePort
$h = $null
try {
  Write-Host "起 scratch 宿主：profile=$ProfileName port=$port（DSH_HOME=$script:DshHome）"
  $h = Start-DshHost -Profile $ProfileName -Port $port -Tag "hot-$port"
  if (-not $h.Ready) { throw "宿主端口没通：$port" }
  $authUrl = Get-AuthUrlFromLog -Host_ $h -TimeoutSec 60
  if (-not $authUrl) { throw '没能从启动日志里取到鉴权 URL' }
  Write-Host '已取到鉴权 URL（不打印 token）'

  & $node (Join-Path $script:VerifyRoot 'probe-toggle-hot.mjs') $port $h.OutFile
  $code = $LASTEXITCODE
  Write-Host ''
  Write-Host "probe exit=$code"
} finally {
  if ($null -ne $h) { Stop-DshHost $h | Out-Null }
}
