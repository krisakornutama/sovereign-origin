# host-audit.ps1 - ตรวจ posture ความปลอดภัยของเครื่อง (อ่านอย่างเดียว ไม่แก้ค่าใด ๆ)
# ใช้: powershell -NoProfile -ExecutionPolicy Bypass -File tools/security/host-audit.ps1
# บางหัวข้อ (Defender exclusions, WinRM) ต้องรันด้วยสิทธิ์ Administrator

$ErrorActionPreference = 'Continue'
function Section([string]$name) { Write-Output ''; Write-Output ("== " + $name + " ==") }

Section 'UAC'
$uac = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
if (Test-Path $uac) {
  foreach ($n in 'EnableLUA', 'ConsentPromptBehaviorAdmin', 'ConsentPromptBehaviorUser') {
    Write-Output ("  {0}={1}" -f $n, (Get-ItemProperty $uac -Name $n -ErrorAction SilentlyContinue).$n)
  }
}

Section 'Winlogon'
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
if (Test-Path $wl) {
  $v = Get-ItemProperty $wl
  Write-Output ("  AutoAdminLogon={0}" -f $v.AutoAdminLogon)
  Write-Output ("  Shell={0}" -f $v.Shell)
  Write-Output ("  Userinit={0}" -f $v.Userinit)
}

Section 'Scheduled tasks running powershell/script/URL'
$hits = 0
Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
  $t = $_
  foreach ($a in $t.Actions) {
    $line = "$($a.Execute) $($a.Arguments)"
    if ($line -match 'http://|https://|Invoke-|\.ps1|\.vbs|mshta|Add-MpPreference') {
      Write-Output ("  {0}{1} state={2} :: {3}" -f $t.TaskPath, $t.TaskName, $t.State, ($line -replace '\s+', ' '))
      $hits++
    }
  }
}
if ($hits -eq 0) { Write-Output '  none' }

Section 'PowerShell logging'
$sb = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging'
if (Test-Path $sb) { Write-Output ("  ScriptBlockLogging=" + (Get-ItemProperty $sb -Name EnableScriptBlockLogging -ErrorAction SilentlyContinue).EnableScriptBlockLogging) } else { Write-Output '  ScriptBlockLogging: not configured' }

Section 'LSA / VBS'
Write-Output ("  RunAsPPL=" + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL)
Write-Output ("  EnableVirtualizationBasedSecurity=" + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard' -Name EnableVirtualizationBasedSecurity -ErrorAction SilentlyContinue).EnableVirtualizationBasedSecurity)

Section 'Defender'
Write-Output ("  WinDefend=" + (Get-Service WinDefend -ErrorAction SilentlyContinue).Status)
try {
  $st = Get-MpComputerStatus -ErrorAction Stop
  Write-Output ("  AntivirusEnabled={0} RealTimeProtectionEnabled={1} AMRunningMode={2}" -f $st.AntivirusEnabled, $st.RealTimeProtectionEnabled, $st.AMRunningMode)
  $ex = Get-MpPreference
  Write-Output ("  Exclusions(paths)=" + ($ex.ExclusionPath -join ';'))
  Write-Output ("  Exclusions(processes)=" + ($ex.ExclusionProcess -join ';'))
} catch { Write-Output ('  unavailable: ' + $_.Exception.Message) }

Section 'Firewall'
try { Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { Write-Output ("  {0}: Enabled={1} Inbound={2} Outbound={3}" -f $_.Name, $_.Enabled, $_.DefaultInboundAction, $_.DefaultOutboundAction) } } catch { Write-Output ('  ' + $_.Exception.Message) }

Section 'SMB1 / RDP'
try { Write-Output ("  SMB1=" + (Get-SmbServerConfiguration -ErrorAction Stop).EnableSMB1Protocol) } catch { Write-Output '  SMB1: unavailable' }
Write-Output ("  RDP_disabled=" + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -ErrorAction SilentlyContinue).fDenyTSConnections)

Section 'Listening ports (non-loopback)'
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -notmatch '^(127\.|::1)' } | ForEach-Object {
  $p = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Write-Output ("  {0}:{1} {2}" -f $_.LocalAddress, $_.LocalPort, $p)
}
