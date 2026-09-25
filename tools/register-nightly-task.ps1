# register-nightly-task.ps1 — ลงทะเบียน nightly verify เป็น scheduled task ของ Windows
# รันครั้งเดียวด้วยสิทธิ์ผู้ใช้ปกติ (ไม่ต้อง admin): powershell -File tools/register-nightly-task.ps1
# กติกา PROJECT DRIVE ONLY: ทุก path อยู่บน E: เท่านั้น (log/status รวมอยู่ใน repo/logs/nightly)

$repo = Split-Path -Parent $PSScriptRoot   # tools/ → repo root
$node = (Get-Command node.exe).Source
$runner = Join-Path $repo 'tools\nightly-verify.mjs'
$logDir = Join-Path $repo 'logs\nightly'

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$runner`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At '02:00'
# -StartWhenAvailable: เครื่องปิดตอน 02:00 → รันชดเชยเมื่อเปิดเครื่อง
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName 'Sovereign Nightly Verify' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

Write-Host "ลงทะเบียนแล้ว — รันทุกคืน 02:00 · log: $logDir"
Write-Host "ทดสอบทันที (ไม่ต้องรอกลางคืน): Start-ScheduledTask -TaskName 'Sovereign Nightly Verify'"
