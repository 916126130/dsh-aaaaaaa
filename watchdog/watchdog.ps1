# dsh-aaaaaaa watchdog — 每 5 分钟（以及每次登录）检查一次：
#   1) plugin 自己是否还被登记在 profile 里（重置会抹掉）；
#   2) 若检测到 profile 被重置，自动把最近一份健康快照写回去。
# 只做本地文件操作，不联网。
$ErrorActionPreference = 'SilentlyContinue'
$homeDir = $env:DSH_HOME
if (-not $homeDir) { $homeDir = Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $homeDir 'profiles\desktop'
$pkgPath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
$plugDir = Join-Path $homeDir 'plugins\dsh-aaaaaaa'
$snapDir = Join-Path $homeDir 'guardian\snapshots'
$logDir = Join-Path $homeDir 'guardian'
$logPath = Join-Path $logDir 'watchdog.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$msg) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
function Write-Utf8([string]$path, [string]$text) {
  $e = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $e)
}
function Read-Json([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $raw = [System.IO.File]::ReadAllText($path)
    $raw = $raw.TrimStart([char]0xFEFF)
    return $raw | ConvertFrom-Json
  } catch { return $null }
}

if (-not (Test-Path -LiteralPath $pkgPath)) { Write-Log 'profile package.json 不存在，跳过'; return }

$pkg = Read-Json $pkgPath
if (-not $pkg) { Write-Log 'profile package.json 解析失败，跳过'; return }

$action = ''

# ---- 1) 插件自身登记 ----
$changed = $false
if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue (@{}) -Force }
if (-not $pkg.dependencies.'dsh-aaaaaaa') {
  $pkg.dependencies | Add-Member -NotePropertyName 'dsh-aaaaaaa' -NotePropertyValue 'file:../../plugins/dsh-aaaaaaa' -Force
  $changed = $true
}
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue (@{}) -Force }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue (@{}) -Force }
$bundles = @($pkg.dsh.profile.bundles)
$bundles = @($bundles | Where-Object { $_ -ne 'yijianhuifu' -and $_ -ne 'dsh-yijianhuifu' })
if ($bundles -notcontains 'dsh-aaaaaaa') {
  $bundles = @($bundles + 'dsh-aaaaaaa')
  $pkg.dsh.profile.bundles = $bundles
  $changed = $true
} else {
  $pkg.dsh.profile.bundles = $bundles
}
if ($changed) {
  Write-Utf8 $pkgPath (($pkg | ConvertTo-Json -Depth 30) + "`n")
  $action = 're-registered'
  Write-Log '已在 profile 中重新登记 dsh-aaaaaaa'
}

# ---- 2) node_modules 链接 ----
$link = Join-Path $profileDir 'node_modules\dsh-aaaaaaa'
if (-not (Test-Path -LiteralPath $link) -and (Test-Path -LiteralPath $plugDir)) {
  $nm = Split-Path -Parent $link
  if (-not (Test-Path -LiteralPath $nm)) { New-Item -ItemType Directory -Force -Path $nm | Out-Null }
  cmd /c mklink /J "$link" "$plugDir" | Out-Null
  if (Test-Path -LiteralPath $link) { Write-Log '已重建 node_modules 链接' }
}

# ---- 3) 判断是否被重置：只剩官方启动项 ----
$cfgPath = Join-Path $logDir 'watchdog.json'
$autoRestore = $true
$cfg = Read-Json $cfgPath
if ($cfg -and ($cfg.PSObject.Properties.Name -contains 'autoRestore')) { $autoRestore = [bool]$cfg.autoRestore }
$thirdParty = @($pkg.dsh.profile.bundles | Where-Object { $_ -notmatch '^@deepseek-ai/' })
$reset = ($thirdParty.Count -le 1) -and $autoRestore
if (-not $autoRestore) { Write-Log 'autoRestore 已关闭，只做自身登记检查' }
if ($reset -and (Test-Path -LiteralPath $snapDir)) {
  $snaps = Get-ChildItem -LiteralPath $snapDir -Directory | Sort-Object Name -Descending
  $pick = $null
  foreach ($s in $snaps) {
    $meta = Read-Json (Join-Path $s.FullName 'meta.json')
    if ($meta -and $meta.kind -eq 'healthy' -and (Test-Path -LiteralPath (Join-Path $s.FullName 'package.json'))) { $pick = $s; break }
  }
  if ($pick) {
    $tp = Join-Path $pick.FullName 'package.json'
    $pp = Join-Path $pick.FullName 'cordis.patch.yml'
    if (Test-Path -LiteralPath $tp) {
      Copy-Item -LiteralPath $tp -Destination $pkgPath -Force
      if (Test-Path -LiteralPath $pp) { Copy-Item -LiteralPath $pp -Destination $patchPath -Force }
      Write-Log ("检测到 profile 被重置，已自动写回健康快照 {0}" -f $pick.Name)
      $action = 'auto-restored'
      # 写回后再确保自身登记
      $pkg2 = Read-Json $pkgPath
      if ($pkg2) {
        if (-not $pkg2.dependencies.'dsh-aaaaaaa') {
          $pkg2.dependencies | Add-Member -NotePropertyName 'dsh-aaaaaaa' -NotePropertyValue 'file:../../plugins/dsh-aaaaaaa' -Force
        }
        $b2 = @($pkg2.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-aaaaaaa' })
        $b2 = @($b2 + 'dsh-aaaaaaa')
        $pkg2.dsh.profile.bundles = $b2
        Write-Utf8 $pkgPath (($pkg2 | ConvertTo-Json -Depth 30) + "`n")
        Write-Log '已把守护插件自身重新并入恢复后的启动项'
      }
    }
  } else {
    Write-Log '检测到疑似重置，但没有可用的健康快照'
  }
}

if ($action -eq '') { Write-Log '检查完成：无需处理' }