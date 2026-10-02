# vhdx-compact.ps1 - weekly compact of Docker Desktop's WSL disk (docker_data.vhdx)
# Task: 'Sovereign VHDX Compact' - Sunday 04:00, highest privileges (diskpart needs admin)
# Flow: guard -> watchdog kill-switch -> stop Docker Desktop -> wsl --shutdown -> diskpart compact
#       -> update window marker -> clear kill-switch -> trigger 'Sovereign Docker Watch' (wakes Docker)
# Rule PROJECT DRIVE ONLY: every path below lives on E: (no C:\ temp files)
# NOTE: keep this file ASCII-only - PowerShell 5.1 reads UTF-8 without BOM as ANSI
$ErrorActionPreference = 'Continue'
$Root = 'E:\My work\Project Sovereign Origin'
$Vhdx = Join-Path $Root 'Docker\wsl\disk\docker_data.vhdx'
$Freebuff = Join-Path $Root '.freebuff'
$Log = Join-Path $Freebuff 'vhdx-compact.log'
$KillSwitch = Join-Path $Root 'sovereign-os\core-api\data\docker-watchdog.disabled'
$WindowMarker = Join-Path $Freebuff 'vhdx-compact.window'
$DiskpartFile = Join-Path $Freebuff 'vhdx-compact.diskpart'
$DockerCli = 'C:\Program Files\Docker\Docker\DockerCli.exe'
$MinBytes = 3GB

if (-not (Test-Path -LiteralPath $Freebuff)) { New-Item -ItemType Directory -Path $Freebuff -Force | Out-Null }

function Log-Line([string]$m) {
  ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $Log -Append -Encoding ascii
}
function Get-DockerExe {
  $c = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
}
function Test-DaemonUp {
  try { & (Get-DockerExe) info --format '{{.ServerVersion}}' *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}
function Test-VhdxFree {
  try { $fs = [System.IO.File]::Open($Vhdx, 'Open', 'Read', 'None'); $fs.Close(); return $true } catch { return $false }
}
function Clear-WatchdogKillSwitch {
  Remove-Item -LiteralPath $KillSwitch -Force -ErrorAction SilentlyContinue
}

Log-Line '=== vhdx-compact start ==='

# Guard 1: never fight the nightly chain (backup 03:00 / offsite 03:30 / gate 03:20)
$busy = @()
try {
  $busy = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $c = $_.CommandLine
    $c -and (($c -like '*backup-db*') -or ($c -like '*offsite-push*') -or ($c -like '*nightly-verify*') -or ($c -like '*nightly-gate*') -or ($c -like '*pitr-drill*'))
  })
} catch { }
if ($busy.Count -gt 0) {
  Log-Line ('SKIP: nightly job still running: ' + (($busy | ForEach-Object { $_.Name }) -join ','))
  exit 0
}

# Guard 2: nothing worth compacting
$before = -1
try { $before = (Get-Item -LiteralPath $Vhdx).Length } catch { }
if ($before -lt 0) { Log-Line 'FAIL: vhdx not found'; exit 1 }
if ($before -lt $MinBytes) { Log-Line ('SKIP: vhdx only ' + [math]::Round($before / 1GB, 2) + 'GB'); exit 0 }

$freeBefore = (Get-PSDrive E).Free
Log-Line ('before vhdx=' + [math]::Round($before / 1GB, 2) + 'GB E-free=' + [math]::Round($freeBefore / 1GB, 2) + 'GB')

# Window marker first: watchdog reads it (age < 2h) to word the Telegram notice
'in progress' | Out-File -FilePath $WindowMarker -Encoding ascii -Force
'' | Out-File -FilePath $KillSwitch -Encoding ascii -Force
Log-Line 'kill-switch set (Docker Watch paused while the disk is offline)'

# Stop Docker Desktop gracefully; fall back to the classic shutdown CLI, then force
try { & (Get-DockerExe) desktop stop *> $null } catch { }
for ($i = 0; $i -lt 12 -and (Test-DaemonUp); $i++) { Start-Sleep -Seconds 5 }
if (Test-DaemonUp -and (Test-Path -LiteralPath $DockerCli)) { & $DockerCli -Shutdown *> $null }
for ($i = 0; $i -lt 12 -and (Test-DaemonUp); $i++) { Start-Sleep -Seconds 5 }
if (Test-DaemonUp) {
  # ไม่ force-kill backend: DB ที่กําลังเขียนอยู่ต้องไม่ถูกตัดกลางทาง - ยกเลิกรอบนี้แทน
  Log-Line 'FAIL: Docker daemon still up (docker desktop stop + DockerCli -Shutdown did not work) - aborting'
  Clear-WatchdogKillSwitch
  Remove-Item -LiteralPath $WindowMarker -Force -ErrorAction SilentlyContinue
  exit 1
}
& wsl.exe --shutdown *> $null
Log-Line 'wsl --shutdown issued'

# Wait for the vhdx to be released by the VM (normally seconds)
$unlocked = $false
for ($i = 0; $i -lt 60; $i++) {
  if (Test-VhdxFree) { $unlocked = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $unlocked) {
  Log-Line 'FAIL: vhdx still locked after 5 min - aborting (Docker left untouched)'
  Clear-WatchdogKillSwitch
  Remove-Item -LiteralPath $WindowMarker -Force -ErrorAction SilentlyContinue
  exit 1
}

# diskpart: attach read-only, compact, detach (script file lives on E:, never %TEMP% on C:)
$dp = @(
  ('select vdisk file="' + $Vhdx + '"'),
  'attach vdisk readonly',
  'compact vdisk',
  'detach vdisk',
  'exit'
)
Set-Content -LiteralPath $DiskpartFile -Value $dp -Encoding ascii
$dpOut = (& "$env:WINDIR\System32\diskpart.exe" /s $DiskpartFile 2>&1 | Out-String)
$dpCode = $LASTEXITCODE
Log-Line ('diskpart exit=' + $dpCode)
$dpOut.Trim() | Out-File -FilePath $Log -Append -Encoding ascii
$compacted = ($dpCode -eq 0) -and ($dpOut -match 'successfully compacted')

$after = (Get-Item -LiteralPath $Vhdx).Length
$freeAfter = (Get-PSDrive E).Free
$summary = 'vhdx ' + [math]::Round($before / 1GB, 2) + 'GB -> ' + [math]::Round($after / 1GB, 2) + 'GB (freed ' + [math]::Round(($before - $after) / 1GB, 2) + 'GB) | E: free ' + [math]::Round($freeBefore / 1GB, 2) + 'GB -> ' + [math]::Round($freeAfter / 1GB, 2) + 'GB'
Log-Line ('after ' + $summary)

# Hand the numbers to the watchdog before it can wake Docker
$summary | Out-File -FilePath $WindowMarker -Encoding ascii -Force
Clear-WatchdogKillSwitch
Log-Line 'kill-switch cleared'

# Wake Docker through the existing watchdog task (runs in the user session, starts containers, checks healthz)
$woke = $false
try { & schtasks.exe /Run /TN 'Sovereign Docker Watch' *> $null } catch { }
for ($i = 0; $i -lt 48; $i++) {
  if (Test-DaemonUp) { $woke = $true; break }
  Start-Sleep -Seconds 10
}
Log-Line ('wake daemon-up=' + $woke + ' after ~' + ($i * 10) + 's')

if ($compacted -and $woke) {
  Log-Line '=== vhdx-compact done ==='
  exit 0
}
Log-Line '=== vhdx-compact finished with problems ==='
exit 1
