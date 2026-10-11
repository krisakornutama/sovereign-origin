# prune-wal.ps1 — ตัวห่อสำหรับ Scheduled Task (PowerShell)
#
# ทำไมต้องมี .ps1 คั่น: task เรียกผ่าน wscript/run-hidden.vbs เพื่อไม่ให้มีหน้าต่าง
#   console โผล่ตอนรันทุกคืน — ตัวงานจริงคือ node tools/prune-wal.mjs
#
# ข้อควรรู้ (ค้นพบ 11/10/69): wal-archive โต 3.04 GB/วันเพราะ docker-compose.yml มีแต่
#   archive_command ที่คัดลอก ไม่มีการลบ → สะสม 44.9 GB และดิสก์จะเต็มใน ~6 วัน
#   ตัวนี้ตัดทิ้งเก่ากว่า 7 วันทุกคืน (ปรับ -Days ได้)
$ErrorActionPreference = 'Continue'

# node เขียน stdout เป็น UTF-8 แต่ PowerShell ถอดเป็น encoding ของคอนโซล (มักเป็น 874/1252)
#   → ข้อความไทยใน log กลายเป็นมะกรุก (เจอจริง 11/10/69 ตอนทดสอบ task จริง)
#   ต้องบอก PowerShell ให้ถอด UTF-8 ก่อนเรียก node
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $Node)) { $Node = 'node' }

$Script = Join-Path $Root 'tools\prune-wal.mjs'
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
$Log = Join-Path $LogDir 'prune-wal.log'

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] เริ่มตัด WAL" | Out-File -FilePath $Log -Append -Encoding utf8

& $Node $Script --days=7 *>&1 | Out-File -FilePath $Log -Append -Encoding utf8
$code = $LASTEXITCODE

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] จบ (exit $code)" | Out-File -FilePath $Log -Append -Encoding utf8
exit $code