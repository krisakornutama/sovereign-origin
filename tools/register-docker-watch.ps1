# register-docker-watch.ps1 — register Docker watchdog as a scheduled task (every 10 min)
# Run once as normal user (no admin): powershell -File tools/register-docker-watch.ps1
# Rule PROJECT DRIVE ONLY: all paths live on E:
# BOM note: PowerShell 5.1 reads UTF-8 without BOM as ANSI - keep this file with BOM

$repo = Split-Path -Parent $PSScriptRoot   # tools/ -> repo root
$node = (Get-Command node.exe).Source
$runner = Join-Path $repo 'tools\docker-watchdog.mjs'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$runner`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName 'Sovereign Docker Watch' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Force

Write-Host "Registered 'Sovereign Docker Watch' - every 10 min - log: logs/docker-watchdog.jsonl"
Write-Host "Test now: Start-ScheduledTask -TaskName 'Sovereign Docker Watch'"
