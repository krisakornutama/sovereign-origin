#requires -Version 5.1
<#
  repair-host-network.ps1 - put the machine's proxy/network settings BACK to default.

  Why this exists
    2026-11-15: after a reboot the host lost internet because
      HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
        ProxyEnable   = 1
        ProxyServer   = 127.0.0.1:<dead local port>
    Those values are machine-wide (WinINET: browser, Electron, node, curl...).
    This project must NEVER write them. It only cleans them up.

  What it does (idempotent, no admin needed)
    1. prints the current values
    2. ProxyEnable = 0
    3. removes ProxyServer / ProxyOverride / AutoConfigURL leftovers
    4. netsh winhttp reset proxy
    5. tells WinINET the settings changed (no logout needed)

  Optional switches
    -DryRun                 show what would change, touch nothing
    -RemoveProjectAutostart delete the Startup folder entry this project created
                            (sovereign-autostart.vbs) so nothing starts behind
                            your back at login. The launcher toggle re-creates it.
    -RemoveSovereignTasks   unregister the project's own "Sovereign *" scheduled
                            tasks (backups/nightly checks). They are NOT boot
                            autoruns; only pass this if you want them gone.

  Usage
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/security/repair-host-network.ps1 -DryRun
    tools\security\repair-host-network.cmd          (double-click)
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$RemoveProjectAutostart,
  [switch]$RemoveSovereignTasks,
  [string]$StartupVbs = 'sovereign-autostart.vbs'
)

$ErrorActionPreference = 'Continue'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$issues = 0

function Say([string]$m) { Write-Host $m }
function Ok([string]$m) { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Bad([string]$m) { Write-Host "[WARN] $m" -ForegroundColor Yellow; $script:issues++ }

function Show-ProxyState([string]$title) {
  Say ""
  Say "--- $title ---"
  $p = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
  if (-not $p) { Bad "cannot read $key"; return }
  foreach ($n in 'ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL', 'AutoDetect') {
    $v = $p.$n
    if ($null -eq $v) { Say ("  {0,-13} = <not set>" -f $n) } else { Say ("  {0,-13} = {1}" -f $n, $v) }
  }
}

Say "=== repair-host-network (dryRun=$DryRun) ==="
Show-ProxyState 'before'

if ($DryRun) {
  Say ""
  Say '[DRYRUN] would set ProxyEnable=0 and clear ProxyServer/ProxyOverride/AutoConfigURL'
  Say '[DRYRUN] would run: netsh winhttp reset proxy'
} else {
  try {
    Set-ItemProperty -Path $key -Name ProxyEnable -Value 0 -Type DWord -Force -ErrorAction Stop
    Ok 'ProxyEnable = 0'
  } catch { Bad ("ProxyEnable: " + $_.Exception.Message) }

  foreach ($n in 'ProxyServer', 'ProxyOverride', 'AutoConfigURL') {
    $cur = (Get-ItemProperty -Path $key -Name $n -ErrorAction SilentlyContinue).$n
    if ($null -eq $cur) { Say "  (already clean) $n"; continue }
    try {
      Remove-ItemProperty -Path $key -Name $n -Force -ErrorAction Stop
      Ok "removed $n (was '$cur')"
    } catch { Bad ("remove $n : " + $_.Exception.Message) }
  }

  $winhttp = (& netsh winhttp show proxy) 2>&1 | Out-String
  if ($winhttp -match 'Direct access') {
    Say '  (already clean) winhttp: direct access (no proxy)'
  } else {
    try {
      & netsh winhttp reset proxy | Out-Null
      if ($LASTEXITCODE -eq 0) { Ok 'winhttp: direct access (no proxy)' }
      else { Bad "netsh winhttp reset proxy exit $LASTEXITCODE (needs an elevated prompt) - current: $($winhttp.Trim())" }
    } catch { Bad ('netsh winhttp: ' + $_.Exception.Message) }
  }

  # tell WinINET (and everything using it) to re-read the settings now
  try {
    $sig = @'
using System;
using System.Runtime.InteropServices;
public static class WinInet {
  [DllImport("wininet.dll", SetLastError = true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
  public static void Refresh() {
    InternetSetOption(IntPtr.Zero, 39, IntPtr.Zero, 0); // INTERNET_OPTION_SETTINGS_CHANGED
    InternetSetOption(IntPtr.Zero, 37, IntPtr.Zero, 0); // INTERNET_OPTION_REFRESH
  }
}
'@
    Add-Type -TypeDefinition $sig -ErrorAction Stop
    [WinInet]::Refresh()
    Ok 'WinINET notified (apps pick up the new settings without a logout)'
  } catch { Say ('  (skip WinINET refresh: ' + $_.Exception.Message + ')') }
}

Show-ProxyState 'after'

if ($RemoveProjectAutostart) {
  Say ""
  Say '--- project autostart (Startup folder) ---'
  $startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
  $vbs = Join-Path $startup $StartupVbs
  if (-not (Test-Path $vbs)) {
    Say "  (not installed) $vbs"
  } elseif ($DryRun) {
    Say "[DRYRUN] would delete $vbs"
  } else {
    try {
      Remove-Item -LiteralPath $vbs -Force -ErrorAction Stop
      Ok "deleted $vbs (the launcher toggle can put it back)"
    } catch { Bad ('delete autostart: ' + $_.Exception.Message) }
  }
} else {
  Say ""
  Say '--- project autostart skipped (pass -RemoveProjectAutostart to delete the Startup .vbs) ---'
}

if ($RemoveSovereignTasks) {
  Say ""
  Say '--- project scheduled tasks ---'
  $tasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like 'Sovereign *' }
  foreach ($t in $tasks) {
    if ($DryRun) { Say "[DRYRUN] would unregister $($t.TaskName)"; continue }
    try {
      Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false -ErrorAction Stop
      Ok "unregistered $($t.TaskName)"
    } catch { Bad ("unregister $($t.TaskName): " + $_.Exception.Message) }
  }
  if (-not $tasks) { Say '  (no Sovereign * tasks)' }
} else {
  Say ""
  Say '--- project scheduled tasks untouched (pass -RemoveSovereignTasks to unregister them) ---'
}

Say ""
Say "=== done: warnings = $issues ==="
exit ([int]([bool]($issues -gt 0)))
