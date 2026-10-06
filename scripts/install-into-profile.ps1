# install-into-profile.ps1 — 把 dsh-market 装进指定 DSH profile，并保留可回滚备份。
#
# 用法：
#   pwsh -File scripts\install-into-profile.ps1 -Profile desktop
#   pwsh -File scripts\install-into-profile.ps1 -Rollback -BackupDir _verify\backup-desktop-20261003-120000
#
# 做三件事：备份 profile 的三个关键文件 → 调用官方 CLI 安装 → 打印结果。
# 安装走的是 `dsh plugin --profile <name> add <绝对路径>`，即官方 pnpm 路径，
# 它会写入 profile 的 package.json / pnpm-lock.yaml，并把本包作为 bundle 激活。

[CmdletBinding(DefaultParameterSetName = 'Install')]
param(
  # 目标 profile 名（DSH_HOME/profiles/<name>）
  [Parameter(ParameterSetName = 'Install')]
  [string]$Profile = 'desktop',

  # 本包目录（默认取仓库内的 plugin-market）
  [Parameter(ParameterSetName = 'Install')]
  [string]$PluginPath,

  # 回滚到某个备份目录
  [Parameter(ParameterSetName = 'Rollback', Mandatory = $true)]
  [switch]$Rollback,

  [Parameter(ParameterSetName = 'Rollback', Mandatory = $true)]
  [string]$BackupDir
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dshCmd = 'D:\Software\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $dshCmd)) {
  $onPath = Get-Command dsh -ErrorAction SilentlyContinue
  if (-not $onPath) { throw "找不到 dsh CLI，请把 $dshCmd 或 dsh 放进 PATH。" }
  $dshCmd = $onPath.Source
}

# 备份与恢复都只碰这三个文件：profile 的可回滚状态就这三份。
$trackedFiles = @('package.json', 'cordis.patch.yml', 'pnpm-lock.yaml')

function Get-ProfileDir([string]$name) {
  $dir = Join-Path (Join-Path $dshHome 'profiles') $name
  if (-not (Test-Path -LiteralPath $dir)) { throw "profile 不存在：$dir" }
  return (Resolve-Path -LiteralPath $dir).Path
}

if ($Rollback) {
  $profileDir = Get-ProfileDir $Profile
  $resolvedBackup = (Resolve-Path -LiteralPath (Join-Path $workspace $BackupDir)).Path
  Write-Host "回滚 $profileDir ← $resolvedBackup"
  foreach ($file in $trackedFiles) {
    $source = Join-Path $resolvedBackup $file
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $profileDir $file) -Force
      Write-Host "  已恢复 $file"
    }
  }
  Write-Host '回滚完成。请重启 dsh web 使组合生效。'
  return
}

if (-not $PluginPath) { $PluginPath = Join-Path $workspace 'plugin-market' }
$resolvedPlugin = (Resolve-Path -LiteralPath $PluginPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedPlugin 'cordis.patch.yml'))) {
  throw "目标目录缺少 cordis.patch.yml，不是可安装的 bundle：$resolvedPlugin"
}
$manifest = Get-Content -LiteralPath (Join-Path $resolvedPlugin 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.dsh.bundle.patch -ne './cordis.patch.yml') {
  throw "package.json 未声明 dsh.bundle.patch：$resolvedPlugin"
}

$profileDir = Get-ProfileDir $Profile
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $workspace (Join-Path '_verify' "backup-$Profile-$stamp")
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
foreach ($file in $trackedFiles) {
  $source = Join-Path $profileDir $file
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $file) -Force }
}
Write-Host "已备份 profile 配置 → $backupDir"
Write-Host "安装 $($manifest.name)@$($manifest.version) 到 profile '$Profile'"
Write-Host "  $dshCmd plugin --profile $Profile add $resolvedPlugin"

& $dshCmd plugin --profile $Profile add $resolvedPlugin 2>&1 | ForEach-Object { Write-Host "  $_" }
$exit = $LASTEXITCODE

if ($exit -ne 0) {
  Write-Warning "安装失败（exit $exit）。回滚：pwsh -File scripts\install-into-profile.ps1 -Rollback -BackupDir $backupDir"
  exit $exit
}

Write-Host ''
Write-Host '安装完成。下一步：'
Write-Host '  1) 让 dsh web 重新组合（重启宿主进程，或等 HMR 生效）；'
Write-Host '  2) 刷新 GUI 页面，侧边栏底部（账号行上方）会出现「插件市场」入口。'
Write-Host "  回滚命令：pwsh -File scripts\install-into-profile.ps1 -Profile $Profile -Rollback -BackupDir $backupDir"
