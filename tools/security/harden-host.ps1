# harden-host.ps1 - close the gaps found after the 2026-11-15 malware incident.
# Idempotent: safe to run repeatedly. Supports -WhatIf.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/security/harden-host.ps1 -WhatIf
#   right-click harden-host.cmd > Run as administrator   (applies for real)
#
# Defender settings are skipped while the WinDefend service is not running, so the
# script never leaves a half-applied state.

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$BlockOutbound,
  [switch]$EnableVbs
)

$ErrorActionPreference = 'Continue'
$report = @()

function Step([string]$name, [string]$current, [string]$target, [scriptblock]$apply) {
  if ($current -eq $target -and $current -ne '') {
    $script:report += [pscustomobject]@{ Setting = $name; Current = $current; Target = $target; Action = 'already-ok' }
    return
  }
  if ($PSCmdlet.ShouldProcess($name, "set $current -> $target")) {
    try { & $apply; $script:report += [pscustomobject]@{ Setting = $name; Current = $current; Target = $target; Action = 'applied' } }
    catch { $script:report += [pscustomobject]@{ Setting = $name; Current = $current; Target = $target; Action = 'failed: ' + $_.Exception.Message } }
  } else {
    $script:report += [pscustomobject]@{ Setting = $name; Current = $current; Target = $target; Action = 'whatif' }
  }
}

function RegGet([string]$path, [string]$name) {
  try { return (Get-ItemProperty -Path $path -Name $name -ErrorAction Stop).$name } catch { return $null }
}

Write-Output '== 1) LSA protection (RunAsPPL) =='
$lsa = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'
Step 'RunAsPPL' ([string](RegGet $lsa 'RunAsPPL')) '1' {
  New-ItemProperty -Path $lsa -Name RunAsPPL -Value 1 -PropertyType DWord -Force | Out-Null
}

Write-Output '== 2) Virtualization Based Security / Credential Guard (needs reboot) =='
$dg = 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard'
if ($EnableVbs) {
  Step 'EnableVirtualizationBasedSecurity' ([string](RegGet $dg 'EnableVirtualizationBasedSecurity')) '1' {
    New-ItemProperty -Path $dg -Name EnableVirtualizationBasedSecurity -Value 1 -PropertyType DWord -Force | Out-Null
  }
} else {
  Write-Output '  skipped (pass -EnableVbs to turn on; VBS slows WSL/Docker and blocks old drivers)'
}

Write-Output '== 3) SMB hardening =='
try {
  $smb = Get-SmbServerConfiguration -ErrorAction Stop
  Step 'SMB1Protocol' ([string]$smb.EnableSMB1Protocol) 'False' { Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force | Out-Null }
  Step 'RequireSecuritySignature' ([string]$smb.RequireSecuritySignature) 'True' { Set-SmbServerConfiguration -RequireSecuritySignature $true -Force | Out-Null }
  Step 'EnableSecuritySignature' ([string]$smb.EnableSecuritySignature) 'True' { Set-SmbServerConfiguration -EnableSecuritySignature $true -Force | Out-Null }
} catch { Write-Output ('  SMB: ' + $_.Exception.Message) }

Write-Output '== 4) Firewall outbound =='
if ($BlockOutbound) {
  foreach ($profile in 'Domain', 'Private', 'Public') {
    $cur = (Get-NetFirewallProfile -Name $profile).DefaultOutboundAction
    Step ('Firewall outbound ' + $profile) ([string]$cur) 'Block' { Set-NetFirewallProfile -Name $profile -DefaultOutboundAction Block }
  }
} else {
  Write-Output '  skipped (pass -BlockOutbound only after allow rules exist, otherwise network and Docker break)'
}

Write-Output '== 5) Defender preferences (only when the service runs) =='
$svc = (Get-Service WinDefend -ErrorAction SilentlyContinue).Status
if ($svc -ne 'Running') {
  Write-Output ('  skipped: WinDefend = ' + $svc + ' (repair it with tools/security/repair-defender.cmd first)')
} else {
  $mp = Get-MpPreference
  Step 'PUAProtection' ([string]$mp.PUAProtection) '1' { Set-MpPreference -PUAProtection Enabled }
  Step 'MAPSReporting' ([string]$mp.MAPSReporting) '2' { Set-MpPreference -MAPSReporting Advanced }
  Step 'SubmitSamplesConsent' ([string]$mp.SubmitSamplesConsent) '1' { Set-MpPreference -SubmitSamplesConsent SendSafeSamples }
  Step 'EnableNetworkProtection' ([string]$mp.EnableNetworkProtection) '1' { Set-MpPreference -EnableNetworkProtection Enabled }
  Write-Output '  ASR rules: start in audit mode, e.g.'
  Write-Output '    Set-MpPreference -AttackSurfaceReductionRules_Ids <GUID> -AttackSurfaceReductionRules_Actions AuditMode'
}

Write-Output '== 6) Defender exclusions left behind by malware =='
if ($svc -eq 'Running') {
  $mp = Get-MpPreference
  if ((($mp.ExclusionPath -join '') + ($mp.ExclusionProcess -join '')) -ne '') {
    Write-Output ('  found: paths=' + ($mp.ExclusionPath -join ';') + ' processes=' + ($mp.ExclusionProcess -join ';'))
    Write-Output '  review each entry; remove with: Remove-MpPreference -ExclusionPath <path>'
  } else { Write-Output '  none' }
} else {
  Write-Output '  unavailable until the service runs'
}

Write-Output ''
Write-Output '== summary =='
$report | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
Write-Output ('whatif entries: ' + (($report | Where-Object { $_.Action -eq 'whatif' }).Count))
