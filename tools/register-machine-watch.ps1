# register-machine-watch.ps1 — ลงทะเบียน machine-alert เป็น scheduled task รอบสั้น (ทุก 10 นาที)
# รันครั้งเดียวด้วยสิทธิ์ผู้ใช้ปกติ (ไม่ต้อง admin): powershell -File tools/register-machine-watch.ps1
# กติกา PROJECT DRIVE ONLY: ทุก path อยู่บน E: เท่านั้น
# หมายเหตุ BOM: PowerShell 5.1 อ่าน UTF-8 ไม่มี BOM เป็น ANSI — ข้อความไทยในไฟล์ต้องมี BOM นำหน้า

$repo = Split-Path -Parent $PSScriptRoot   # tools/ → repo root
$node = (Get-Command node.exe).Source
$runner = Join-Path $repo 'tools\machine-alert.mjs'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$runner`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName 'Sovereign Machine Watch' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Force

Write-Host "ลงทะเบียนแล้ว — เช็คทุก 10 นาที · log: logs/machine-alert/"
Write-Host "ทดสอบทันที (ไม่ต้องรอรอบถัดไป): Start-ScheduledTask -TaskName 'Sovereign Machine Watch'"
