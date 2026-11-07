# register-nightly-task.ps1 — ลงทะเบียน nightly verify + dead-man alert เป็น scheduled task
# รันครั้งเดียวด้วยสิทธิ์ผู้ใช้ปกติ (ไม่ต้อง admin): powershell -ExecutionPolicy Bypass -File tools/register-nightly-task.ps1
# กติกา PROJECT DRIVE ONLY: ทุก path อยู่บน E: เท่านั้น (log/status รวมอยู่ใน repo/logs/nightly)
#
# 02:00 — Sovereign Nightly Verify  (รัน quality gate + เขียน logs/nightly/status.json)
# 03:30 — Sovereign Nightly Deadman (อ่าน nightly-history.json; ล้ม/หาย 2 คืนติด = Telegram)
#
# ทั้งสอง task วิ่งผ่าน tools\run-hidden.vbs ⇒ ไม่มีหน้าต่าง console เด้งตอนกลางคืน
# (.cmd เก็บ "command line จริง" เป็น ASCII — หลีกเลี่ยงกับดัก codepage ของ cmd.exe)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot   # tools/ → repo root
$node = (Get-Command node.exe).Source
$vbs = Join-Path $repo 'tools\run-hidden.vbs'
$winDir = if ($env:SystemRoot) { $env:SystemRoot } else { 'C:\Windows' }
$wscript = Join-Path $winDir 'System32\wscript.exe'
$hiddenDir = Join-Path $repo 'tools\hidden-tasks'
$logDir = Join-Path $repo 'logs\nightly'

if (-not (Test-Path $hiddenDir)) { New-Item -ItemType Directory -Path $hiddenDir | Out-Null }
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Write-CommandFile([string]$file, [string]$scriptRel) {
  $line = '"' + $node + '" "' + (Join-Path $repo $scriptRel) + '"'
  Set-Content -Path $file -Value $line -Encoding ASCII
}

$verifyCmd = Join-Path $hiddenDir 'sovereign-nightly-verify.cmd'
$deadmanCmd = Join-Path $hiddenDir 'sovereign-nightly-deadman.cmd'
Write-CommandFile $verifyCmd 'tools\nightly-verify.mjs'
Write-CommandFile $deadmanCmd 'tools\nightly-deadman.mjs'

function Register-HiddenTask([string]$name, [string]$cmdFile, [string]$at, [int]$limitMin) {
  $action = New-ScheduledTaskAction -Execute $wscript `
    -Argument ('//B "' + $vbs + '" "' + $cmdFile + '"') -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -Daily -At $at
  # -StartWhenAvailable: เครื่องปิดตอนเวลา task → รันชดเชยเมื่อเปิดเครื่อง
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $limitMin)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
  Register-ScheduledTask -TaskName $name `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host ("OK  " + $name + " @ " + $at)
}

Register-HiddenTask 'Sovereign Nightly Verify' $verifyCmd '02:00' 60
Register-HiddenTask 'Sovereign Nightly Deadman' $deadmanCmd '03:30' 30

Write-Host "ลงทะเบียนแล้ว — nightly 02:00 · deadman 03:30 · log: $logDir"
Write-Host "ทดสอบทันที (ไม่ต้องรอกลางคืน):"
Write-Host "  Start-ScheduledTask -TaskName 'Sovereign Nightly Verify'"
Write-Host "  Start-ScheduledTask -TaskName 'Sovereign Nightly Deadman'"
