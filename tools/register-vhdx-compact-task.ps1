# register-vhdx-compact-task.ps1 - register the weekly VHDX compact as a scheduled task
# Run ONCE as administrator (the task needs "Run with highest privileges" because diskpart requires admin):
#   Start PowerShell as Administrator, then run:
#     powershell -File "E:\My work\Project Sovereign Origin\tools\register-vhdx-compact-task.ps1"
# Rule PROJECT DRIVE ONLY: all paths live on E:
# The task runs through tools/run-hidden.vbs so no console window flashes at 04:00.
$repo = Split-Path -Parent $PSScriptRoot   # tools/ -> repo root
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
$vbs = Join-Path $repo 'tools\run-hidden.vbs'
$cmdFile = Join-Path $repo 'tools\hidden-tasks\sovereign-vhdx-compact.cmd'

$action = New-ScheduledTaskAction -Execute $wscript -Argument ('//B "' + $vbs + '" "' + $cmdFile + '"') -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '04:00'
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName 'Sovereign VHDX Compact' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Force

Write-Host "Registered 'Sovereign VHDX Compact' - every Sunday 04:00 (after offsite 03:30) - log: .freebuff/vhdx-compact.log"
Write-Host "Test now: Start-ScheduledTask -TaskName 'Sovereign VHDX Compact'"
