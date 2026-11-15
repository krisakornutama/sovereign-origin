# repair-defender.ps1 - repair Windows Defender that fails to start with error 577.
# Usage: right-click repair-defender.cmd > Run as administrator
#        or: powershell -NoProfile -ExecutionPolicy Bypass -File tools/security/repair-defender.ps1
# Result is written to %TEMP%\defender-repair.log

$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'defender-repair.log'
function W([string]$m) { Write-Output $m; Add-Content -LiteralPath $log -Value ("[{0}] {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Output 'This script must run as Administrator (right-click repair-defender.cmd > Run as administrator).'
  exit 1
}

"--- repair start ---" | Out-File -LiteralPath $log -Encoding utf8
W ("whoami: " + (whoami))

W '=== 1) initial state ==='
W ((& sc.exe query WinDefend 2>&1) -join ' / ')
try {
  $st = Get-MpComputerStatus -ErrorAction Stop
  W ("before: AntivirusEnabled={0} RealTimeProtectionEnabled={1}" -f $st.AntivirusEnabled, $st.RealTimeProtectionEnabled)
} catch { W ('Get-MpComputerStatus: ' + $_.Exception.Message) }

W '=== 2) sfc /scannow (10-20 min) ==='
& sfc.exe /scannow 2>&1 | ForEach-Object { if ($_ -match '\S') { W ('sfc: ' + $_) } }

W '=== 3) DISM /Online /Cleanup-Image /RestoreHealth ==='
& dism.exe /Online /Cleanup-Image /RestoreHealth 2>&1 | ForEach-Object { if ($_ -match '\S') { W ('dism: ' + $_) } }

W '=== 4) start WinDefend ==='
& sc.exe config WinDefend start= auto | Out-Null
W ((& sc.exe start WinDefend 2>&1) -join ' / ')
Start-Sleep -Seconds 10
W ((& sc.exe query WinDefend 2>&1) -join ' / ')

W '=== 5) result ==='
try {
  $st = Get-MpComputerStatus -ErrorAction Stop
  W ("AMRunningMode={0} AntivirusEnabled={1} RealTimeProtectionEnabled={2} AMServiceEnabled={3} AMEngineVersion={4} Sig={5}" -f $st.AMRunningMode, $st.AntivirusEnabled, $st.RealTimeProtectionEnabled, $st.AMServiceEnabled, $st.AMEngineVersion, $st.AntivirusSignatureVersion)
} catch { W ('Get-MpComputerStatus: ' + $_.Exception.Message) }

W '=== 6) recent 7000/7024 ==='
try {
  (Get-WinEvent -FilterHashtable @{LogName='System'; Id=7000,7024; StartTime=(Get-Date).AddHours(-1)} -MaxEvents 3 -ErrorAction Stop |
    ForEach-Object { "[$($_.TimeCreated)] $($_.Message -replace "`r`n",' ')" }) | ForEach-Object { W $_ }
} catch { W ('no events: ' + $_.Exception.Message) }
W '--- repair end ---'
Write-Output ('log: ' + $log)
