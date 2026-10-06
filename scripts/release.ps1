# release.ps1 —— 版本与门禁在本地，打包与发布在 GitHub Actions。
#
# 版本号规则见 docs/RELEASING.md：
#   versionName = MAJOR.MINOR.PATCH（严格 SemVer，包/Git 标签/Release 都用它）
#   versionCode = MAJOR*10000 + MINOR*100 + PATCH（单调递增整数）
#   构建标识   = +提交数.短哈希（只写进发布说明与 dist/version.json）
#
# 本地路径（不产生任何打包产物，不消耗 gh / npm token）：
#   pwsh -File scripts\release.ps1 -Bump patch|minor|major   # 门禁 → 递增 → 提交 → 打标签 → 推送
#   pwsh -File scripts\release.ps1 -Bump auto                # 自动识别升档：CHANGELOG 新节定目标号 + 提交证据验档位（双向都拦）
#   pwsh -File scripts\release.ps1 -Version 1.2.0            # 直接指定目标版本（与 -Bump auto|patch|minor|major 二选一）
#   pwsh -File scripts\release.ps1 -LocalOnly                # 只跑门禁（不改版本、不留产物、不发布）
#   pwsh -File scripts\release.ps1 -SkipPush                 # 递增 + 提交 + 打标签，但不推送
#
# CI 路径（.github/workflows/pack-release.yml，标签推送触发）：
#   pwsh -File scripts\release.ps1 -CiPack                   # 门禁 → 打包 → 创建 GitHub Release 并传附件
#   npm 发布由同一 workflow 的 publish-npm job 接手。
# 回退 / 旧版安装一律从 GitHub Release 附件下载（releases/ 目录已从仓库移除）。

[CmdletBinding()]
param(
  [ValidateSet('none', 'patch', 'minor', 'major', 'auto')]
  [string]$Bump = 'none',
  # 直接指定目标版本（如 1.2.0）：与显式 -Bump 二选一；-Bump auto 时它就是「声明」本身
  [string]$Version,
  [string]$NotesFile,
  [string]$Tag,
  [switch]$LocalOnly,
  [switch]$SkipPush,
  [switch]$CiPack
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pkgDir = Join-Path $root 'plugin-market'
$manifestPath = Join-Path $pkgDir 'package.json'
$distDir = Join-Path $root 'dist'
# node：本机优先 DSH 自带运行时；CI 上没有 DSH_HOME，退回 PATH（workflow 负责装 node）。
# 注意 $env:DSH_HOME 未设置时是 $null，Join-Path 会直接抛错——先判环境变量再拼路径。
$node = $null
if ($env:DSH_HOME) { $node = Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' }
if (-not $node -or -not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { throw '找不到 node.exe' }

# pnpm 只有打包那一步才用（门禁不需要），所以到打包时再解析——门禁跑在没有 pnpm 的机器上
# 也不该被它拦住。本机用 DSH 自带的 pnpm.mjs（喂给 node 跑）；CI 上退回 PATH 上的 pnpm，
# 返回 CommandInfo 让 PowerShell 自己挑 .cmd/.ps1（npm -g 装出来的命令带多个扩展名，
# 存字符串路径可能挑中无法直接执行的那一个）。
function Resolve-Pnpm {
  $mjs = $null
  if ($env:DSH_HOME) { $mjs = Join-Path $env:DSH_HOME 'dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs' }
  if ($mjs -and (Test-Path $mjs)) { return @{ Mjs = $mjs } }
  $cmd = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $cmd) { throw '找不到 pnpm：既没有 DSH 运行时，PATH 上也没有（CI 里 workflow 会先装 pnpm）' }
  return @{ Cmd = $cmd }
}

function Step([string]$text) { Write-Host ''; Write-Host "==== $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "  ✓ $text" -ForegroundColor Green }

# 原生工具的进度/警告写 stderr，而 $ErrorActionPreference='Stop' 会在这些字节进入管道之前
# 就把它们当成终止错误（即使 exit code 是 0），把脚本掐断。所有「会说话」的原生调用都走这里：
# 临时降级为 Continue，收集输出，返回 exit code 交给调用方判定。
function Invoke-Native([string]$exe, [string[]]$argv) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $text = @(& $exe @argv 2>&1) } finally { $ErrorActionPreference = $previous }
  $code = $LASTEXITCODE
  foreach ($line in $text) { Write-Host "  $line" }
  return $code
}

# ── 版本算术（单独成函数，才能被下面的自检真正测到）───────────────────
# 规则：**高位递增时低位必须归零**。这条会静默错——哪天有人把它改成"只加不清零"，
# 1.0.2 + minor 会得到 1.1.2，而版本号一旦发布就再也改不回来，所以每次发布都要跑自检。
function Get-BumpedParts([int[]]$Parts, [string]$Kind) {
  $major = $Parts[0]; $minor = $Parts[1]; $patch = $Parts[2]
  switch ($Kind) {
    'major' { $major += 1; $minor = 0; $patch = 0 }
    'minor' { $minor += 1; $patch = 0 }
    'patch' { $patch += 1 }
    'none' { }
    default { throw "未知的递增类型：$Kind" }
  }
  return , @($major, $minor, $patch)
}

# versionCode = MAJOR*10000 + MINOR*100 + PATCH。这个公式要求 MINOR 与 PATCH 都 < 100，
# 否则会撞号：1.0.100 与 1.1.0 都会算成 10100。所以满了直接拒绝，而不是给出一个重复编号。
function Get-VersionCode([int[]]$Parts) {
  if ($Parts[1] -ge 100 -or $Parts[2] -ge 100) {
    throw ("versionCode 公式要求 MINOR 与 PATCH 都小于 100（当前 " + $Parts[1] + "." + $Parts[2] + "）；" +
      "PATCH 满了应改为递增 MINOR；若确实需要三位以上的分段，得换 versionCode 公式（那属于 MAJOR 变更）")
  }
  return $Parts[0] * 10000 + $Parts[1] * 100 + $Parts[2]
}

# ── 档位自动识别（-Bump auto / -Version 用）────────────────────────────
# 判定口径就是 docs/RELEASING.md §1 的三条：破坏兼容→MAJOR、向后兼容的新功能→MINOR、
# 修复（含安全/性能）→至少 PATCH。证据来自**提交类型前缀**，声明来自 CHANGELOG 新节或 -Version；
# 两边任何方向的偏差都拒绝（双向硬拦），显式 -Bump patch|minor|major 是人工覆盖路径。
function Get-LevelOrdinal([string]$Level) {
  switch ($Level) {
    'none' { return 0 }
    'patch' { return 1 }
    'minor' { return 2 }
    'major' { return 3 }
    default { throw "未知档位：$Level" }
  }
}

# 类型前缀 → 档位。键不区分大小写（PS 哈希表默认行为），中文类型名与仓库历史提交对齐。
$typeLevels = @{
  feat = 'minor'; feature = 'minor'; enhancement = 'minor'; '新功能' = 'minor'
  fix = 'patch'; '修复' = 'patch'; bugfix = 'patch'; perf = 'patch'; performance = 'patch'
  security = 'patch'; '性能' = 'patch'; '安全' = 'patch'
  chore = 'none'; docs = 'none'; ci = 'none'; test = 'none'; style = 'none'
  build = 'none'; refactor = 'none'; release = 'none'; revert = 'none'; '文案' = 'none'
}

# 从一条提交主题判档位：none=不升档 / patch / minor / major。
# 形态：`type：标题`、`type(scope): 标题`、`type+type：标题`（全半角冒号都认）、`type!：` 破坏标记。
# 认不出的类型（如 `Update publish-npm.yml`、`UI：两颗黑按钮…`）不虚报，落回关键词兜底；
# 关键词也认不出就返回 none——宁可让「包体有改动至少 PATCH」那条兜底，也不制造假的档位证据。
function Get-SubjectLevel([string]$Subject) {
  $s = "$Subject".Trim()
  if (-not $s) { return 'none' }
  # 破坏兼容标记最优先：feat! / BREAKING CHANGE，中文口径「破坏兼容 / 不兼容」
  if ($s -match '(?i)breaking|破坏兼容|不兼容') { return 'major' }
  $m = [regex]::Match($s, '^([A-Za-z\u4e00-\u9fff]+(?:\+[A-Za-z\u4e00-\u9fff]+)*)(?:\([^)]*\))?(!?)\s*[:：]')
  if ($m.Success) {
    if ($m.Groups[2].Value -eq '!') { return 'major' }
    $anyKnown = $false; $allKnown = $true; $best = 'none'
    foreach ($type in ($m.Groups[1].Value -split '\+')) {
      if ($typeLevels.ContainsKey($type)) {
        $anyKnown = $true
        if ((Get-LevelOrdinal $typeLevels[$type]) -gt (Get-LevelOrdinal $best)) { $best = $typeLevels[$type] }
      } else { $allKnown = $false }
    }
    if ($anyKnown -and $allKnown) { return $best }
    # 混着认不出的成分（如 feat+X）→ 不拿半截证据下结论，走关键词兜底
  }
  if ($s -match '(?i)(?<![\w-])feat(?![\w-])|新功能|新增|支持') { return 'minor' }
  if ($s -match '(?i)(?<![\w-])fix(?![\w-])|修复|修正|修「|修了|报错|崩溃|闪退') { return 'patch' }
  return 'none'
}

# 与 Invoke-Native 同理（原生命令的 stderr 在 EAP=Stop 下会掐断脚本），但安静地取输出不打印。
function Invoke-Quiet([string]$exe, [string[]]$argv) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $text = @(& $exe @argv 2>&1 | ForEach-Object { $_.ToString() }) } finally { $ErrorActionPreference = $previous }
  return @{ Code = $LASTEXITCODE; Out = $text }
}

# 采集「自上个 v<版本> 标签以来、触及 plugin-market/ 的提交」作为升档证据：
#   LastTag/LastVersion = 比较基线；Subjects = 每条主题 + 判定档位；Level = 最高档位。
# 两条兜底：有提交但全认不出类型 → 至少 PATCH（包体变了就必须有新版本号）；
# 没提交但有未提交改动 → 同样按「内容有变更」计一条（LocalOnly 干跑时也别谎称无改动）。
function Get-ReleaseEvidence {
  Push-Location $root
  try {
    $tags = Invoke-Quiet 'git' @('tag', '--merged', 'HEAD', '--sort=-version:refname')
    if ($tags.Code -ne 0) { throw "git tag 失败：$($tags.Out -join ' ')" }
    $lastTag = @($tags.Out | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' }) | Select-Object -First 1
    if (-not $lastTag) {
      throw 'HEAD 历史里没有可用的 v<版本> 标签作为基线，自动识别无从比较——请用 -Bump patch|minor|major 显式指定。'
    }
    # git 的提交主题是 UTF-8，Windows 控制台默认 OEM 码页会把它解成乱码（关键词判定就废了），
    # 所以取 git 输出期间临时切成 UTF-8，用完还原。
    $prevEnc = [Console]::OutputEncoding
    try {
      [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
      $log = Invoke-Quiet 'git' @('log', '--no-merges', '--pretty=%s', "$lastTag..HEAD", '--', 'plugin-market/')
      if ($log.Code -ne 0) { throw "git log 失败：$($log.Out -join ' ')" }
      $dirty = Invoke-Quiet 'git' @('status', '--porcelain', '--', 'plugin-market/')
      if ($dirty.Code -ne 0) { throw "git status 失败：$($dirty.Out -join ' ')" }
    } finally { [Console]::OutputEncoding = $prevEnc }
    $subjects = [System.Collections.Generic.List[object]]::new()
    foreach ($line in @($log.Out)) {
      if ($line) { $subjects.Add(@{ S = [string]$line; Level = (Get-SubjectLevel $line) }) }
    }
    if ($subjects.Count -eq 0 -and @($dirty.Out | Where-Object { $_ }).Count -gt 0) {
      $subjects.Add(@{ S = '（plugin-market/ 有未提交改动，档位按「内容有变更」计）'; Level = 'none' })
    }
    $level = 'none'
    foreach ($s in $subjects) {
      if ((Get-LevelOrdinal $s.Level) -gt (Get-LevelOrdinal $level)) { $level = $s.Level }
    }
    if ($subjects.Count -gt 0 -and $level -eq 'none') { $level = 'patch' }
    return @{ LastTag = [string]$lastTag; LastVersion = ([string]$lastTag).Substring(1); Subjects = @($subjects); Level = $level }
  } finally { Pop-Location }
}

# CHANGELOG 顶部第一个还没打标签的 `## x.y.z` 节 = 本次发布的「声明」（Release notes 也从它取）。
# 全部节都已有标签 → 没有未发布的新节，返回 $null。
function Get-ChangelogDecl {
  $path = Join-Path $pkgDir 'CHANGELOG.md'
  if (-not (Test-Path $path)) { return $null }
  $text = Get-Content $path -Raw -Encoding UTF8
  $heads = @([regex]::Matches($text, '(?m)^##\s+(\d+\.\d+\.\d+)\s*$') | ForEach-Object { $_.Groups[1].Value })
  if ($heads.Count -eq 0) { return $null }
  Push-Location $root
  try {
    $tags = Invoke-Quiet 'git' @('tag', '--list', 'v*')
    if ($tags.Code -ne 0) { throw "git tag --list 失败：$($tags.Out -join ' ')" }
  } finally { Pop-Location }
  $existing = @($tags.Out)
  foreach ($h in $heads) {
    if ("v$h" -notin $existing) { return $h }
  }
  return $null
}

# ── CI（-CiPack）：先解析标签并检出标签内容，门禁与打包都以标签为准 ──
if ($CiPack) {
  if ($env:GITHUB_ACTIONS -ne 'true') {
    throw '-CiPack 只在 GitHub Actions 里跑——本地打包会留产物、还消耗 gh token；本地验证请用 -LocalOnly（只跑门禁）。'
  }
  $refName = $env:GITHUB_REF_NAME
  if ($refName -match '^v\d+\.\d+\.\d+$') {
    $Tag = $refName            # 标签推送：打的就是这个标签
  } elseif (-not $Tag) {
    # 手动补跑（分支上触发）：从包版本推导标签（例如 package.json=1.1.5 → v1.1.5）
    $Tag = "v$((Get-Content $manifestPath -Raw | ConvertFrom-Json).version)"
  }
  Push-Location $root
  try {
    & git rev-parse --verify --quiet "refs/tags/$Tag" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "标签 $Tag 不存在——打包的对象必须是已推送的标签" }
    # 打包内容必须是标签那一份，不是分支工作区的猜测（手动补跑时两者可能不同）。
    if ((Invoke-Native 'git' @('checkout', '--detach', $Tag)) -ne 0) { throw "检出标签 $Tag 失败" }
    Ok "已检出标签 $Tag（门禁与打包都跑它）"
  } finally { Pop-Location }
}

# ── 1. 读并校验当前版本 ─────────────────────────────────────────────
Step '1/5 读取并校验版本'
# —— 参数一致性：先于一切读取与判定 ——
if ($Version) {
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "-Version 必须是 MAJOR.MINOR.PATCH：$Version" }
  if ($PSBoundParameters.ContainsKey('Bump') -and $Bump -ne 'none') {
    throw '-Version 与 -Bump 二选一：-Version 直接指定目标号，-Bump 相对当前版本升档（auto = 交给脚本判）。'
  }
}
if ($CiPack -and ($Bump -eq 'auto' -or $Version)) {
  throw '-CiPack 不做版本决策——版本号在本地用 -Bump/-Version 定好并打成标签，CI 只按标签打包。'
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$current = [string]$manifest.version
if ($current -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
  throw "package.json 的 version 不是 MAJOR.MINOR.PATCH：$current"
}
$major = [int]$Matches[1]; $minor = [int]$Matches[2]; $patch = [int]$Matches[3]
Ok "当前 versionName=$current versionCode=$(Get-VersionCode @($major, $minor, $patch))"
# 升档前的原始三段：显式 -Bump 的证据建议要用它算目标号（bump 之后就没有「当前」了）。
$currentParts = @($major, $minor, $patch)

if ($Bump -eq 'auto' -or $Version) {
  # —— 自动识别：声明（CHANGELOG 新节 / -Version）× 证据（触及包体的提交类型），双向都硬拦 ——
  $evi = Get-ReleaseEvidence
  foreach ($s in ($evi.Subjects | Select-Object -First 50)) {
    Write-Host ("    {0,-6} {1}" -f $s.Level, $s.S) -ForegroundColor DarkGray
  }
  if ($evi.Subjects.Count -gt 50) { Write-Host "    ……另有 $($evi.Subjects.Count - 50) 条未列出" -ForegroundColor DarkGray }

  if ($evi.Subjects.Count -eq 0) {
    # 没有触及包体的提交 = 没有要发的东西。顺手把「上一轮 -SkipPush / 推送失败」的补推场景点出来，
    # 否则人会把「无需发版」误读成「已经发出去了」。
    Ok "plugin-market/ 自 $($evi.LastTag) 起无改动，无需发新版本"
    $onRemote = Invoke-Quiet 'git' @('branch', '-r', '--contains', 'HEAD')
    if ($onRemote.Code -eq 0 -and -not (@($onRemote.Out | Where-Object { $_ -match 'origin/' }) | Select-Object -First 1)) {
      Write-Warning '但 HEAD 还不在任何远端分支上——上一轮多半是 -SkipPush 或推送失败；补推：git push --follow-tags'
    }
    if (-not $LocalOnly) { exit 0 }
    Ok 'LocalOnly：照常跑门禁（不升档）'
  }
  else {
    # 目标号：-Version 直接指定；否则取 CHANGELOG 顶部还没打标签的 ## x.y.z 节（Release notes 从它取）。
    if ($Version) {
      $target = [string]$Version
      $declSource = "-Version $Version"
      $changelogText = Get-Content (Join-Path $pkgDir 'CHANGELOG.md') -Raw -Encoding UTF8
      if (-not $NotesFile -and $changelogText -notmatch ("(?m)^##\s+" + [regex]::Escape($target) + "\s*$")) {
        throw ("CHANGELOG.md 里没有 `n## $target`n 一节（Release notes 默认从它取）。补上该节，或用 -NotesFile <说明文件> 指定。")
      }
    }
    else {
      $declared = Get-ChangelogDecl
      if (-not $declared) {
        $sp = Get-BumpedParts $currentParts $evi.Level
        $suggest = "$($sp[0]).$($sp[1]).$($sp[2])"
        throw ("CHANGELOG.md 没有未发布的新节，定不了目标号。按提交证据应发 $suggest（$($evi.Level) 档）。" + "`n" +
          "在 plugin-market/CHANGELOG.md 顶部写一节：`n## $suggest …`n，或用 -Version $suggest -NotesFile <说明文件> 显式指定。")
      }
      $target = [string]$declared
      $declSource = "CHANGELOG ## $target"
    }

    # 档位 = 目标相对基线升了几档。基线正常是当前版本；package.json 已手工改成目标号时，
    # 「升了几档」就得对着上一个标签算（否则 1.2.0 vs 1.2.0 会被误判成没升）。
    $refVersion = $current
    if ($target -eq $current) { $refVersion = $evi.LastVersion }
    $refMatch = [regex]::Match($refVersion, '^(\d+)\.(\d+)\.(\d+)$')
    $refParts = @([int]$refMatch.Groups[1].Value, [int]$refMatch.Groups[2].Value, [int]$refMatch.Groups[3].Value)
    $step = $null
    foreach ($kind in 'patch', 'minor', 'major') {
      $p = Get-BumpedParts $refParts $kind
      if ("$($p[0]).$($p[1]).$($p[2])" -eq $target) { $step = $kind; break }
    }
    if (-not $step) {
      if ($target -eq $refVersion) {
        throw "$declSource 的 $target 等于基线 $refVersion——该版本已发过，标签与版本号永不重用。"
      }
      throw "$declSource 的 $target 与基线 $refVersion 不是一档之差（patch/minor/major 都对不上）——自动识别不放行多档跳版；检查 CHANGELOG 节名与 package.json 是否漏改。"
    }

    # 双向都硬拦：声明档位必须与提交证据完全一致（低于、高于都拒绝）。
    if ($evi.Level -ne $step) {
      $eviOrdinal = Get-LevelOrdinal $evi.Level
      $stepOrdinal = Get-LevelOrdinal $step
      $drivers = @($evi.Subjects | Where-Object { (Get-LevelOrdinal $_.Level) -eq $eviOrdinal } | ForEach-Object { $_.S })
      $sp2 = Get-BumpedParts $refParts $evi.Level
      $suggest = "$($sp2[0]).$($sp2[1]).$($sp2[2])"
      $evidenceText = if ($drivers.Count -gt 0) { "$($evi.Level) 档 —— " + ($drivers -join '、') }
      else { "$($evi.Level) 档（有提交但类型都认不出，按「包体有改动至少 PATCH」定档）" }
      $direction = if ($stepOrdinal -gt $eviOrdinal) { '高于' } else { '低于' }
      throw (@(
        "自动识别拒绝：$declSource 的档位（升 $step）$direction 提交证据（升 $($evi.Level)）——双向都拦，两边任何偏差都不发。",
        "  声明：$declSource（基线 $refVersion 升 $step 档 → $target）",
        "  证据：$evidenceText",
        "  按 docs/RELEASING.md §1 的判定口径应发 $suggest。",
        "  出路①：把声明改成 ## $suggest 后重跑；",
        "  出路②：确认声明正确就显式发——-Bump $step 或 -Version $target（显式路径信任人工判断，不做证据校验）。"
      ) -join "`n")
    }

    $targetMatch = [regex]::Match($target, '^(\d+)\.(\d+)\.(\d+)$')
    $major = [int]$targetMatch.Groups[1].Value; $minor = [int]$targetMatch.Groups[2].Value; $patch = [int]$targetMatch.Groups[3].Value
    $version = $target
    $versionCode = Get-VersionCode @($major, $minor, $patch)
    Ok "auto：$declSource 升 $step 档，与提交证据一致（基线 $($evi.LastTag)，证据 $($evi.Subjects.Count) 条提交）→ versionName=$version versionCode=$versionCode"
  }
}
else {
  $bumped = Get-BumpedParts $currentParts $Bump
  $major = $bumped[0]; $minor = $bumped[1]; $patch = $bumped[2]
  $version = "$major.$minor.$patch"
  $versionCode = Get-VersionCode @($major, $minor, $patch)
  if ($version -ne $current) { Ok "递增后 versionName=$version versionCode=$versionCode" }
  else { Ok '不递增（首个版本或 -Bump none）' }

  # 显式升档时把提交证据当**建议**给出来：只提醒「证据高于所选档位」这一个有真实风险的方向，
  # 不拦——显式 -Bump 的定位就是信任人工判断。证据取不到（无标签等）也绝不反过来拦发布。
  if ($Bump -in @('patch', 'minor', 'major') -and -not $CiPack) {
    try {
      $adv = Get-ReleaseEvidence
      if ((Get-LevelOrdinal $adv.Level) -gt (Get-LevelOrdinal $Bump)) {
        $advDrivers = @($adv.Subjects | Where-Object { (Get-LevelOrdinal $_.Level) -eq (Get-LevelOrdinal $adv.Level) } | ForEach-Object { $_.S })
        $advTarget = Get-BumpedParts $currentParts $adv.Level
        Write-Warning ("提交证据判为 $($adv.Level) 档（" + ($advDrivers -join '、') + "），高于 -Bump $Bump——" +
          "按 RELEASING §1 该发 $($advTarget -join '.')。显式路径信任人工判断，继续。")
      }
    } catch { }
  }
}

if ($CiPack) {
  if ($Bump -ne 'none') { throw '-CiPack 不做递增——版本号在本地 -Bump 时写好、打成标签，CI 只负责打包发布' }
  if ($Tag -ne "v$version") { throw "标签 $Tag 与 package.json 的版本 $version 不一致" }
  Ok "CI 模式：标签 $Tag 与包版本一致"
}

# ── 2. 门禁 ─────────────────────────────────────────────────────────
Step '2/5 门禁（任一失败即中止）'

# 版本算术自检：把「高位递增时低位归零」这条规则变成每次发布都跑一遍的断言。
# 判例取真实历史：1.0.2 +minor 必须得到 1.1.0 —— v1.1.0 那次发布正是这一步（versionCode 10002 → 10100）。
$bumpCases = @(
  @{ from = @(1, 0, 2);  kind = 'patch'; expect = '1.0.3' },
  @{ from = @(1, 0, 2);  kind = 'minor'; expect = '1.1.0' },
  @{ from = @(1, 0, 99); kind = 'minor'; expect = '1.1.0' },
  @{ from = @(1, 9, 9);  kind = 'minor'; expect = '1.10.0' },
  @{ from = @(1, 4, 7);  kind = 'major'; expect = '2.0.0' },
  @{ from = @(1, 1, 3);  kind = 'none';  expect = '1.1.3' }
)
foreach ($case in $bumpCases) {
  $parts = Get-BumpedParts $case.from $case.kind
  $got = "" + $parts[0] + "." + $parts[1] + "." + $parts[2]
  if ($got -ne $case.expect) {
    throw ("版本算术自检失败：" + ($case.from -join '.') + " + " + $case.kind + " 得到 $got，应为 " + $case.expect)
  }
}
# 负向对照：撞号必须被拒绝（1.0.100 与 1.1.0 的 versionCode 都是 10100）
$boundRejected = $false
try { $null = Get-VersionCode @(1, 0, 100) } catch { $boundRejected = $true }
if (-not $boundRejected) {
  throw '版本算术自检失败：Get-VersionCode 没有拒绝 PATCH=100（会与 1.1.0 撞成同一个 versionCode）'
}
Ok '版本算术自检通过（1.0.2 +minor → 1.1.0，低位归零；MINOR/PATCH ≥ 100 的撞号被拒绝）'

# 档位判定自检：把「什么提交升什么位」也变成每次发布都跑一遍的断言。判错会静默地发错号——
# 版本号一旦发布就再也改不回来，所以与版本算术自检同等待遇。负向对照：认不出的类型必须落回
# none，不许虚报档位（虚报会让 auto 在发布时拿假证据拦人/放行）。
$subjectCases = @(
  @{ s = 'fix：搜索框只留一颗清除键'; e = 'patch' },
  @{ s = 'feat：重启助手——一键真动作'; e = 'minor' },
  @{ s = 'feat(ui): 可更新页改成第三个页签'; e = 'minor' },
  @{ s = 'feat!：包名重命名'; e = 'major' },
  @{ s = 'fix(ci): spec 步骤括号笔误'; e = 'patch' },
  @{ s = '修复：自更新检查改读附件元数据'; e = 'patch' },
  @{ s = '性能：拆开共享 tick'; e = 'patch' },
  @{ s = 'test+fix(market): 断言修正'; e = 'patch' },
  @{ s = 'chore(release): v1.1.5'; e = 'none' },
  @{ s = 'docs(readme)：默认英文，中文走切换'; e = 'none' },
  @{ s = 'ci: npm 发布凭据对齐 OIDC'; e = 'none' },
  @{ s = 'Update publish-npm.yml'; e = 'none' },
  @{ s = 'BREAKING CHANGE：端点字段删除'; e = 'major' },
  @{ s = '不兼容旧版宿主的旧字段已移除'; e = 'major' },
  @{ s = '修「点更新不会更新」根因'; e = 'patch' },
  @{ s = '右键补成四态状态机：更新/正在更新/成功'; e = 'none' }
)
foreach ($case in $subjectCases) {
  $got = Get-SubjectLevel $case.s
  if ($got -ne $case.e) {
    throw "档位判定自检失败：'$($case.s)' 判成 $got，应为 $($case.e)"
  }
}
Ok '档位判定自检通过（feat→minor、fix/修复/性能→patch、!/BREAKING→major、chore/docs/ci→不升档、认不出的类型不虚报）'

# .js 与 .cjs 都查：restart-helper.cjs 是重启助手的分离脚本，语法错误要在这里就拦下。
$libFiles = Get-ChildItem (Join-Path $pkgDir 'lib') | Where-Object { $_.Extension -in '.js', '.cjs' } | Sort-Object Name
foreach ($file in $libFiles) {
  & $node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "node --check 失败：$($file.Name)" }
}
Ok ("node --check 通过：" + (($libFiles | ForEach-Object { $_.Name }) -join '、'))

if ($manifest.dsh.bundle.patch -ne './cordis.patch.yml') { throw 'package.json 缺 dsh.bundle.patch' }
if ($manifest.dsh.client.platform -ne 'web') { throw 'package.json 的 dsh.client.platform 必须是 web' }
if ($manifest.exports.'./client' -ne './lib/client.js') { throw 'package.json 缺 exports["./client"]' }
Ok 'dsh.bundle.patch / dsh.client.platform / exports["./client"] 齐全'

$patchFile = Join-Path $pkgDir 'cordis.patch.yml'
if (-not (Test-Path $patchFile)) { throw '缺 cordis.patch.yml' }
$patchText = Get-Content $patchFile -Raw
if ($patchText -notmatch [regex]::Escape("name: $($manifest.name)")) {
  throw "cordis.patch.yml 里的 name 与包名不一致（应为 $($manifest.name)）"
}
Ok "cordis.patch.yml 行 name 与包名一致（$($manifest.name)）"

$clientText = Get-Content (Join-Path $pkgDir 'lib\client.js') -Raw
if ($clientText -notmatch '__ModuleLoader__\s*\.\s*load') { throw 'client bundle 缺 __ModuleLoader__.load' }
if ($clientText -notmatch ('id\s*:\s*"' + [regex]::Escape($manifest.name) + '"')) { throw 'client bundle 的 id 与包名不一致' }
if ($clientText -match 'eval\s*\(' -or $clientText -match 'new\s+Function\s*\(') { throw 'client bundle 含 eval/new Function' }
Ok 'client bundle：有 loader 注册、id 与包名一致、无 eval/new Function'

# 旧版本号不得**作为取值**留在发布物里：写死的版本号会在发布后与 package.json 漂移（1.0.1 发布时
# lib/index.js 里还写着旧版本，页面与 /status 都跟着显示旧版本）。
#
# 只看非注释行：这个门禁要抓的是"代码里把一个版本号当值用"，而不是"文档里不许提到版本号"。
# 上一版连注释一起查，于是把一句如实记录实测现象的注释判成了违规——那种门禁的下场是被
# 当成噪声、然后被放宽，所以修成现在这样（错过第一列是 // 或块注释续行 * 的行）。
if ($version -ne $current) {
  $staleHits = @(
    Get-ChildItem (Join-Path $pkgDir 'lib') -Filter '*.js' |
      Select-String -SimpleMatch $current |
      Where-Object { $_.Line -notmatch '^\s*(//|\*|/\*)' }
  )
  if ($staleHits.Count -gt 0) {
    $where = ($staleHits | ForEach-Object { "$($_.Filename):$($_.LineNumber)" }) -join '、'
    throw "lib/ 的非注释行里仍写着旧版本号 $current（$where）。版本必须从包清单读，不要写死在代码里。"
  }
  Ok "lib/ 的非注释行里没有写死的旧版本号 $current"
}

# 行为回归测试：verify/ 下所有 *.test.mjs 必须全绿（与门禁里的其它检查同等对待）。
$regressionTests = @(Get-ChildItem (Join-Path $root 'verify') -Filter '*.test.mjs' -ErrorAction SilentlyContinue)
foreach ($test in $regressionTests) {
  & $node $test.FullName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "回归测试未通过：verify/$($test.Name)" }
}
if ($regressionTests.Count -gt 0) { Ok ("回归测试通过：" + (($regressionTests | ForEach-Object { $_.Name }) -join '、')) }

$guardTest = Join-Path $root 'verify\origin-guard.test.mjs'
if (Test-Path $guardTest) {
  & $node $guardTest | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '来源判定矩阵测试未通过（verify/origin-guard.test.mjs）' }
  Ok '来源判定矩阵测试通过'
}

Push-Location $root
try {
  if (-not $LocalOnly -and -not $CiPack) {
    # 只要求「发布面」干净：plugin-market / docs / scripts / 根文件。
    # 并行进行的验收脚本改动（verify/**）既不进发布物、也不进本次提交，只警告不阻塞——
    # 否则一场正在跑的验收会把发布卡死。
    $dirty = @(& git status --porcelain | Where-Object { $_ } | ForEach-Object { $_.Substring(3).Trim() })
    $blocking = @($dirty | Where-Object { $_ -match '^(plugin-market|docs|scripts)/' -or $_ -notmatch '/' })
    if ($blocking.Count -gt 0) {
      throw ("发布面不干净，先提交或收起改动再发布：`n  " + ($blocking -join "`n  "))
    }
    if ($dirty.Count -gt 0) {
      Write-Warning ('以下改动不属于发布面，不阻塞发布、也不进入本次提交：' + ($dirty -join '、'))
    }
    Ok '发布面干净（plugin-market / docs / scripts / 根文件）'
  }
} finally { Pop-Location }

# ── 3. 本地只写版本；打包只在 CI（-CiPack）发生 ─────────────────────
if ($CiPack) {
  Step 'CI 打包（产物只留在 CI 工作区，本地仓库永远不留 tarball）'
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Get-ChildItem $distDir -Filter '*.tgz' -ErrorAction SilentlyContinue | Remove-Item -Force
  Push-Location $pkgDir
  try {
    $pnpm = Resolve-Pnpm
    if ($pnpm.Mjs) { & $node $pnpm.Mjs pack --pack-destination $distDir | Out-Null }
    else { & $pnpm.Cmd pack --pack-destination $distDir | Out-Null }
    if ($LASTEXITCODE -ne 0) { throw 'pnpm pack 失败' }
  } finally { Pop-Location }
  $tgz = Join-Path $distDir "$($manifest.name)-$version.tgz"
  if (-not (Test-Path $tgz)) { throw "没有生成预期的 tarball：$tgz" }
  Ok ("tarball: " + (Split-Path $tgz -Leaf) + "（" + [math]::Round((Get-Item $tgz).Length / 1KB) + " KB）")

  Push-Location $root
  try {
    $commits = (& git rev-list --count HEAD).Trim()
    $sha = (& git rev-parse --short HEAD).Trim()
  } finally { Pop-Location }
  $versionJson = [ordered]@{
    name         = $manifest.name
    version      = $version
    versionCode  = $versionCode
    build        = "+$commits.$sha"
    commits      = [int]$commits
    sha          = $sha
    builtAt      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  }
  $versionJson | ConvertTo-Json | Set-Content (Join-Path $distDir 'version.json') -Encoding UTF8
  Ok ("dist/version.json: version=$version versionCode=$versionCode build=+$commits.$sha")

  Step 'CI 创建 GitHub Release（附件是回退与旧版安装的唯一下载源）'
  # 本机路径只在有 LOCALAPPDATA 的机器上存在；CI 上没有就直接找 PATH 里的 gh。
  $gh = $null
  if ($env:LOCALAPPDATA) { $gh = Join-Path $env:LOCALAPPDATA 'dsh-tools\gh\bin\gh.exe' }
  if (-not $gh -or -not (Test-Path $gh)) { $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source }
  if (-not $gh) { throw '找不到 gh CLI，无法创建 Release' }

  $notes = ''
  if ($NotesFile) { $notes = Get-Content (Join-Path $root $NotesFile) -Raw }
  if (-not $notes) {
    $changelog = Get-Content (Join-Path $pkgDir 'CHANGELOG.md') -Raw
    $m = [regex]::Match($changelog, "(?ms)^##\s+$([regex]::Escape($version))\s*$\s*(.*?)(?=^##\s|\z)")
    if ($m.Success) { $notes = $m.Groups[1].Value.Trim() }
  }
  if (-not $notes) { $notes = "首个正式版本 $version。" }
  $notes = $notes + "`n`n---`n`n- versionName ``$version`` / versionCode ``$versionCode`` / build ``+$commits.$sha```n- 安装：``dsh plugin --profile web add <本页附件 $($manifest.name)-$version.tgz>``（发布到 npm 后可直接 ``add $($manifest.name)``）`n- 回退 / 旧版：从本页附件下载对应版本的 tgz`n- 变更与验收细节见仓库 docs/ 与 verify/REPORT.md"
  # Release notes 用文件传递：Windows 下把多行字符串直接当命令行参数会被截断/转义。
  $notesPath = Join-Path $distDir "release-notes-v$version.md"
  [System.IO.File]::WriteAllText($notesPath, $notes, [System.Text.UTF8Encoding]::new($false))

  $versionJsonPath = Join-Path $distDir 'version.json'
  $releaseCode = Invoke-Native $gh @(
    'release', 'create', "v$version", $tgz, $versionJsonPath,
    '--title', "v$version", '--notes-file', $notesPath
  )
  if ($releaseCode -ne 0) {
    # 重跑 / 补跑的常见情况：Release 已在——补传附件（--clobber 幂等），而不是失败。
    & $gh release view "v$version" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'gh release create 失败' }
    Ok "Release v$version 已存在，补传附件（--clobber）"
    if ((Invoke-Native $gh @('release', 'upload', "v$version", $tgz, $versionJsonPath, '--clobber')) -ne 0) {
      throw 'gh release upload 失败'
    }
  } else {
    Ok "GitHub Release v$version 已创建"
  }
  Write-Host ''
  Write-Host "CI 打包完成：v$version（versionCode=$versionCode, build=+$commits.$sha）"
  exit 0
}

Step '3/5 写入版本'
if (-not $LocalOnly -and $version -ne $current) {
  $raw = Get-Content $manifestPath -Raw
  $updated = $raw -replace '"version"\s*:\s*"[^"]+"', ('"version": "' + $version + '"')
  [System.IO.File]::WriteAllText($manifestPath, $updated, [System.Text.UTF8Encoding]::new($false))
  Ok "package.json version → $version"
}
if ($LocalOnly) {
  Write-Host ''
  Write-Host 'LocalOnly：门禁通过，到此为止（不改版本、不打包、不提交、不发布——打包与发布由 GitHub Actions 完成）。'
  exit 0
}

# （不再写 releases/：tarball 只挂 GitHub Release 附件——回退与旧版安装从那里下载，
#   仓库里从此不留任何打包产物，index.json/jsDelivr 那条 CDN 路随之下线。）

# ── 4. 提交 + 标签 ──────────────────────────────────────────────────
Step '4/5 提交并打标签'
Push-Location $root
try {
  & git add plugin-market/package.json
  $staged = @(& git diff --cached --name-only | Where-Object { $_ })
  if ($staged.Count -gt 0) {
    & git commit -q -m "chore(release): v$version"
    if ($LASTEXITCODE -ne 0) { throw 'git commit 失败' }
    Ok "已提交版本改动（$($staged -join '、')）"
  } else {
    # -Bump none 且 package.json 里已经是目标版本（例如首个版本 1.0.0）：没有可提交的改动，
    # 直接给当前提交打标签，而不是在这里失败。
    Ok '版本未变化，跳过提交（直接给当前提交打标签）'
  }
  $tag = "v$version"
  $existing = & git tag --list $tag
  if ($existing) {
    # 可重入：标签已在本提交的历史里，且**被打包的内容自标签以来逐字节未变**时，继续往下建 Release。
    # 这样「推送/建 Release 分两步、后者失败」的重跑不会被自己挡住，同时保住真正要防的事：
    # 版本号被重用（标签不在历史里）或打包内容被改（改了就得发新版本号）。
    & git merge-base --is-ancestor $tag HEAD
    if ($LASTEXITCODE -ne 0) { throw "标签 $tag 已存在且不在当前历史里，版本号不可重用" }
    & git diff --quiet $tag HEAD -- plugin-market
    if ($LASTEXITCODE -ne 0) {
      throw "自 $tag 以来 plugin-market/ 有改动——发布内容变了就必须递增版本号（-Bump patch|minor|major），不能复用 $version"
    }
    Ok "标签 $tag 已在历史中且 plugin-market/ 未变，继续（可重入）"
  } else {
    & git tag -a $tag -m "v$version"
    if ($LASTEXITCODE -ne 0) { throw 'git tag 失败' }
    Ok "已打标签 $tag（指向 $((& git rev-parse --short HEAD).Trim())）"
  }
} finally { Pop-Location }

# ── 5. 推送（打包与 Release 由 Actions 接手）─────────────────────────
Step '5/5 推送'
if ($SkipPush) {
  Write-Host 'SkipPush：未推送。'
  Write-Host '  手动推送：git push --follow-tags'
  exit 0
}
Push-Location $root
try {
  if ((Invoke-Native 'git' @('push', '--follow-tags')) -ne 0) {
    throw 'git push 失败（本机 github.com 需要 HTTPS_PROXY，见 docs/RELEASING.md）'
  }
  Ok '已推送提交与标签'
} finally { Pop-Location }
Write-Host ''
Write-Host "已推送 v$version。标签会触发 GitHub Actions「Pack and Release」：门禁 → 打包 → 创建 Release 附件 → 发布 npm。"
Write-Host '  https://github.com/Winnie-0721/dsh-plugin-market/actions/workflows/pack-release.yml'
