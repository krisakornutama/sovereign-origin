# set-tasks-hidden.ps1 — repoint every Sovereign Scheduled Task through run-hidden.vbs
# Each task gets tools/hidden-tasks/<slug>.cmd containing its ORIGINAL command line.
# Task action becomes: wscript.exe //B run-hidden.vbs "<cmdfile>"  (no quoting hazards)
$ErrorActionPreference = 'Stop'
$repo = 'E:\My work\Project Sovereign Origin'
$vbs = Join-Path $repo 'tools\run-hidden.vbs'
$wscript = 'C:\Windows\System32\wscript.exe'
$dir = Join-Path $repo 'tools\hidden-tasks'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# original command line of each task (as Task Scheduler currently invokes them)
$tasks = [ordered]@{
  'ShipShop3000' = '"E:\My work\Project Sovereign Origin\start-sovereign.bat"'
  'Sovereign DB Backup' = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\My work\Project Sovereign Origin\tools\backup-db.ps1"'
  'Sovereign Machine Watch' = '"C:\Program Files\nodejs\node.exe" "E:\My work\Project Sovereign Origin\tools\machine-alert.mjs"'
  'Sovereign Nightly Verify' = '"C:\Program Files\nodejs\node.exe" "E:\My work\Project Sovereign Origin\tools\nightly-verify.mjs"'
  'Sovereign Nightly Quality Gate' = 'cmd.exe /c "E:\My work\Project Sovereign Origin\nightly-gate-task.cmd"'
  'Sovereign Offsite Backup' = 'cmd.exe /c "E:\My work\Project Sovereign Origin\sovereign-offsite-task.cmd"'
  'Sovereign Security Digest' = 'cmd.exe /c "E:\My work\Project Sovereign Origin\security-digest-task.cmd"'
  'Sovereign Synthetic Browser Check' = '"E:\My work\Project Sovereign Origin\sovereign-frontend\scripts\run-synthetic-check.cmd"'
}

function Get-Slug([string]$s) {
  ($s -replace '[^a-zA-Z0-9]+', '-').Trim('-').ToLower()
}

foreach ($name in $tasks.Keys) {
  $slug = Get-Slug $name
  $cmdFile = Join-Path $dir ($slug + '.cmd')
  Set-Content -Path $cmdFile -Value $tasks[$name] -Encoding ASCII
  $argString = '//B "' + $vbs + '" "' + $cmdFile + '"'
  try {
    $action = New-ScheduledTaskAction -Execute $wscript -Argument $argString -WorkingDirectory $repo
    Set-ScheduledTask -TaskName $name -Action $action | Out-Null
    Write-Host ('OK  ' + $name + '  ->  ' + $cmdFile)
  } catch {
    Write-Host ('ERR ' + $name + ' -> ' + $_.Exception.Message)
  }
}
