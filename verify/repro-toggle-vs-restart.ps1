# 开关 ↔ 重启 交界实验（scratch profile，绝不碰用户 desktop profile）
#
# 问的问题：热开关是「宿主当场写 patch 文件 + HMR 重载」实现的。那么
#   ① 它写下的状态，**重启之后还在不在**？（会不会重启就丢）
#   ② 重启前后，/installed 报的状态与 patch 文件是否一致？
#
# 做法：读初始 → toggle off（宿主写 patch 文件 + HMR）→ 同一宿主读回确认热生效
#       → 杀掉宿主（重启的「死」）→ 重新起同一 profile（重启的「起」）
#       → 再读一次，比较三处状态：/installed 前后、patch 文件。
#
# 纪律：同一 profile **任何时刻只起一个宿主**（两个宿主会争同一份 patch 文件，
# 那样测出来的差异分不清是「重启」还是「两个宿主打架」）。
[CmdletBinding()]
param(
  [string]$ProfileName = 'marketcheck'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\Common.ps1')

$node = Get-NodeExe
if (-not $node) { throw '找不到 node.exe' }
Ensure-Dirs
$probe = Join-Path $script:VerifyRoot 'probe-toggle-state.mjs'
$profileDir = Get-ProfileDir $ProfileName
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

function Invoke-Probe {
  param([int]$Port, [string]$HostLog, [string]$Action, [string]$OutFile, [string]$Name)
  $argv = @($probe, "$Port", $HostLog, $OutFile, $Action)
  if ($Name) { $argv += $Name }
  & $node @argv | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "probe($Action) 失败 exit=$LASTEXITCODE" }
  return (Get-Content $OutFile -Raw | ConvertFrom-Json)
}

function Get-PatchLine {
  param([string]$BundleName)
  if (-not (Test-Path $patchFile)) { return '<无 patch 文件>' }
  $lines = Get-Content $patchFile
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match ('^\s*-?\s*id:\s*' + [regex]::Escape($BundleName) + '\s*$')) {
      $end = [Math]::Min($i + 1, $lines.Count - 1)
      return (($lines[$i..$end] | ForEach-Object { $_.Trim() }) -join ' | ')
    }
  }
  return '<该 bundle 在 patch 文件里没有条目>'
}

$h1 = $null
$h2 = $null
try {
  Write-Host "=== [1] 起宿主 #1（profile=$ProfileName），读初始状态 ==="
  $port1 = Get-FreePort
  $h1 = Start-DshHost -Profile $ProfileName -Port $port1 -Tag "tog1-$port1"
  if (-not $h1.Ready) { throw "宿主 #1 端口没通：$port1" }
  if (-not (Get-AuthUrlFromLog -Host_ $h1 -TimeoutSec 60)) { throw '没取到鉴权 URL' }

  $before = Invoke-Probe -Port $port1 -HostLog $h1.OutFile -Action 'read' -OutFile (Join-Path $script:LogDir 'tog-1-before.json')
  $target = $before.target
  Write-Host "  目标 bundle: $target   初始 enabled=$($before.enabledAfter)"
  Write-Host "  patch 文件: $(Get-PatchLine $target)"

  Write-Host "`n=== [2] 同一个宿主上热开关：关掉它 ==="
  $off = Invoke-Probe -Port $port1 -HostLog $h1.OutFile -Action 'off' -OutFile (Join-Path $script:LogDir 'tog-2-off.json') -Name $target
  Write-Host "  application=$($off.application)   enabledBefore=$($off.enabledBefore) → enabledAfter=$($off.enabledAfter)"
  Write-Host "  patch 文件: $(Get-PatchLine $target)"

  Write-Host "`n=== [3] 杀掉宿主（重启的「死」）==="
  $released = Stop-DshHost $h1
  $h1 = $null
  Write-Host "  端口已释放: $released"

  Write-Host "`n=== [4] 重新起同一 profile（重启的「起」）==="
  $port2 = Get-FreePort
  $h2 = Start-DshHost -Profile $ProfileName -Port $port2 -Tag "tog2-$port2"
  if (-not $h2.Ready) { throw "宿主 #2 端口没通：$port2" }
  if (-not (Get-AuthUrlFromLog -Host_ $h2 -TimeoutSec 60)) { throw '没取到鉴权 URL' }
  $after = Invoke-Probe -Port $port2 -HostLog $h2.OutFile -Action 'read' -OutFile (Join-Path $script:LogDir 'tog-3-after.json') -Name $target
  Write-Host "  重启后 enabled=$($after.enabledAfter)"
  Write-Host "  patch 文件: $(Get-PatchLine $target)"

  Write-Host "`n================= 结论 ================="
  $hot = ($off.application -eq 'applied')
  $immediate = ($off.enabledAfter -eq $false)
  $survived = ($after.enabledAfter -eq $off.enabledAfter)
  Write-Host (" ① 热开关当场生效（application=applied 且 /installed 立刻变 false）？ " +
    $(if ($hot -and $immediate) { '是——宿主 HMR，没重启' } else { "否（application=$($off.application), enabledAfter=$($off.enabledAfter)）" }))
  Write-Host (" ② 重启后状态还在？ 重启前=$($off.enabledAfter)  重启后=$($after.enabledAfter)  -> " +
    $(if ($survived) { '一致：重启不丢（落在 patch 文件里）' } else { '不一致：重启会丢或被改' }))
  Write-Host "======================================="

  # 复位：把开关还原，别在 scratch profile 里留状态
  if (-not $survived -or $off.enabledAfter -eq $false) {
    $null = Invoke-Probe -Port $port2 -HostLog $h2.OutFile -Action 'on' -OutFile (Join-Path $script:LogDir 'tog-4-restore.json') -Name $target
    Write-Host "已复位（enabled=true）"
  }
} finally {
  if ($null -ne $h1) { Stop-DshHost $h1 | Out-Null }
  if ($null -ne $h2) { Stop-DshHost $h2 | Out-Null }
}
