# tools/node-installer.ps1 — ตัวติดตั้งเครื่องใหม่แบบไฟล์เดียว (ฝั่งเครื่องปลายทาง)
#
# ── ทำไมต้องเป็น PowerShell ──────────────────────────────────────────────
#   PowerShell 5.1 มากับ Windows ทุกเครื่อง → ไม่ต้องติดตั้งอะไรก่อน
#   Node/Docker ยังไม่มีก็รันได้ (ตอนนี้ไฟล์ .ps1 ยังรันได้แม้เครื่องไม่มี Node)
#   ⇒ เป็นทางเดียวที่ "กดครั้งเดียว" ได้จริงบนเครื่องที่ว่างเปล่า
#
# ── หน้าที่ (ตามลำดับ หยุดทันทีที่ขั้นแรกที่ล้ม) ───────────────────────────
#   1. ตรวจพื้นที่ว่าง (เจ้าของ: เครื่องใหม่มี 40 GB)
#   2. ติดตั้ง Node.js ถ้ายังไม่มี (winget)
#   3. ถาม HUB + ดาวน์โหลดชุดติดตั้ง (~36 MB) + ตรวจ sha256 (fail-closed)
#   4. แตกชุด
#   5. ส่งต่อให้ setup-node.mjs ทำที่เหลือ (Docker · npm ci · build · เริ่มระบบ · ลงทะเบียน)
#
# ── หลักการ ─────────────────────────────────────────────────────────────
#   · ไม่มี checksum ที่ถูกต้อง = ไม่ติดตั้งต่อ (ไม่ใช่ "ติดตั้งแล้วค่อยดู")
#   · รหัสเชิญไม่ถูกของ HUB = หยุดก่อนแตะระบบ ไม่ใช่ลงทะเบียนแล้วค่อยบอก
#   · ทุกขั้นเขียน log ต่อเนื่อง หน้าต่างปิดไปก็ย้อนอ่านได้
#   · --dry-run ต้องไม่แตะอะไรเลย (คนจะเชื่อว่าปลอดภัยแล้วกดต่อ)
[CmdletBinding()]
param(
  [string] $HubUrl = '',
  [string] $Code = '',
  [string] $Name = '',
  [string] $Dest = '',
  [switch] $DryRun
)

# ตัว .cmd ส่ง -DryRun มาทาง environment ไม่ใช่พารามิเตอร์
#   เพราะ powershell.exe -File แปลงทุกค่าเป็น string แล้ว SwitchParameter รับไม่ได้
#   (เจอตอนรันครั้งแรก — "Cannot process argument transformation on parameter 'DryRun'")
if (-not $DryRun -and $env:SOV_DRYRUN -eq '1') { $DryRun = $true }

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ตอนนี้ยังไม่รู้ว่าจะแตกชุดไว้ที่ไหน (สคริปต์นี้ถูกรันจาก %TEMP%)
#   ⇒ เขียน log ลง temp ก่อน แล้วค่อยย้ายไป logs/ ของชุดที่แตกในขั้นถัดไป
$Log = Join-Path $env:TEMP 'sovereign-install.log'
function Relocate-Log([string] $dir) {
  $new = Join-Path $dir 'install-node.log'
  try {
    if (Test-Path $Log) { Move-Item -Path $Log -Destination $new -Force }
  } catch {
    $new = $Log
  }
  return $new
}

function Say([string] $m = '') {
  Write-Host $m
  try { Add-Content -Path $Log -Value $m -Encoding utf8 } catch { }
}

function Die([string] $m, [int] $code = 1) {
  Say ''
  Say "  X  $m"
  Say "  (บันทึกไว้ที่ $Log)"
  exit $code
}

Say ''
Say '==========================================================='
Say '  Sovereign OS - ติดตั้งเครื่องนี้เป็นเครื่องลูก'
Say '==========================================================='
Say "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] เริ่ม"

# ── สิทธิ์ผู้ดูแลระบบ ──────────────────────────────────────────────────────
# winget ติดตั้ง Docker Desktop ไม่ได้ถ้าไม่มีสิทธิ์
#   (เคสจริง 12/10/69: "The installer will request to run as administrator"
#    → winget ล้ม exit 1 แล้วตัวติดตั้งบอก "ติดตั้งเองแล้วรันซ้ำ" ทั้งที่คนไม่รู้ว่าต้องทำอะไร)
#   ไฟล์ .cmd จะขอสิทธิ์ให้ก่อนอยู่แล้ว แต่ถ้าเข้ามาทางอื่น = บอกตรงๆ ไม่ใช่ล้มกลางคัน
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Say '  X ตัวติดตั้งนี้ต้องใช้สิทธิ์ผู้ดูแลระบบ (Docker Desktop + งานตั้งเวลา)'
  Say '    วิธีแก้: คลิกขวาที่ไฟล์ INSTALL-SOVEREIGN-NODE.cmd แล้วเลือก'
  Say '    "Run as administrator" (ทำงานเป็นผู้ดูแลระบบ)'
  Die 'ไม่มีสิทธิ์ผู้ดูแลระบบ — ติดตั้งต่อไม่ได้' 3
}
Say '  OK สิทธิ์ผู้ดูแลระบบ'
if ($DryRun) { Say '  DRY RUN - จะตรวจอย่างเดียว ไม่แก้อะไร' }

# ── 0) จะติดตั้งไว้ที่ไหน ───────────────────────────────────────────────────
# ⚠ ต้องหาปลายทาง "ก่อน" ตรวจพื้นที่เสมอ
#   เคสจริง 12/10/69: เจ้าของวางไฟล์ไว้บน E: แต่โค้ดวัดพื้นที่ที่ $PSScriptRoot
#   ซึ่งคือ %TEMP% (C:) ⇒ รายงานว่า C: ว่าง 3.5 GB แล้วหยุด ทั้งที่ E: ว่างเพียงพอ
#   ⇒ เครื่องที่วางไว้ดิสก์ไหน ต้องไปติดตั้งและวัดพื้นที่บนดิสก์นั้นเสมอ
$installerDir = if ($env:SOV_DIR) { $env:SOV_DIR } else { $PSScriptRoot }
if (-not $Dest) { $Dest = Join-Path $installerDir 'SovereignOS' }
$Dest = [System.IO.Path]::GetFullPath($Dest)

# ปฏิเสธปลายทางที่อยู่ใน %TEMP% — Windows ล้างทิ้งเป็นระยะ ข้อมูลจะหายเงียบๆ
$tempFull = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
if ($Dest.StartsWith($tempFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  Die ("ปลายทางอยู่ในโฟลเดอร์ชั่วคราวของ Windows ซึ่งจะถูกล้างทิ้ง:`n    $Dest`n  ย้ายไฟล์ INSTALL-SOVEREIGN-NODE.cmd ไปวางในโฟลเดอร์ที่ถาวรแล้วรันใหม่")
}

# ── 1) พื้นที่ว่าง — วัดดิสก์ที่ $Dest อยู่จริง ─────────────────────────────────
$root = [System.IO.Path]::GetPathRoot($Dest)
$need = 12.0
function Get-FreeGb([string] $driveName) {
  try {
    $d = Get-PSDrive -Name $driveName -ErrorAction Stop
    return [math]::Round($d.Free / 1GB, 1)
  } catch { return $null }
}
$freeGb = Get-FreeGb ($root.TrimEnd(':\'))

if ($null -eq $freeGb) {
  Say "  ! อ่านพื้นที่ว่างของ $root ไม่ได้ - ข้ามการตรวจ (ต้องมีอย่างน้อย $need GB)"
} elseif ($freeGb -lt $need) {
  Say "  X พื้นที่ว่างบน ${root} เหลือ $freeGb GB - ต้องมีอย่างน้อย $need GB"
  # บอกให้เลือกดิสก์ได้ทันที แทนที่จะปล่อยให้เดา
  $others = Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.Free -gt 0 -and $_.Root.TrimEnd(':') -ne $root.TrimEnd(':') } |
    ForEach-Object { "     $($_.Root) ว่าง $([math]::Round($_.Free/1GB,1)) GB" }
  if ($others) {
    Say '  ดิสก์อื่นบนเครื่องนี้:'
    $others | ForEach-Object { Say $_ }
    Say '  วิธีแก้: ย้ายไฟล์ INSTALL-SOVEREIGN-NODE.cmd ไปวางบนดิสก์ที่ว่างพอ แล้วดับเบิลคลิกใหม่'
  } else {
    Say '  วิธีแก้: ลบของเก่าออกจนได้อย่างน้อย ' + $need + ' GB แล้วรันใหม่'
  }
  Die "พื้นที่บน $root ไม่พอสำหรับระบบ (ต้อง $need GB เหลือให้ของเดิมด้วย)"
} else {
  Say "  OK พื้นที่ว่างบน ${root} $freeGb GB (ต้อง $need GB)"
}

# ── 2) ติดตั้ง Node.js ถ้ายังไม่มี ────────────────────────────────────────
$node = $null
if (Get-Command node -ErrorAction SilentlyContinue) {
  $node = (node --version).Trim()
  Say "  OK มี Node.js อยู่แล้ว ($node)"
} elseif ($DryRun) {
  Say '  - [dry-run] จะติดตั้ง Node.js LTS ผ่าน winget'
} else {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Die "เครื่องนี้ไม่มี Node.js และไม่มี winget - ติดตั้ง Node.js 20+ จาก https://nodejs.org แล้วรันซ้ำ"
  }
  Say '  ... กำลังติดตั้ง Node.js LTS (อาจใช้เวลาสักครู่) ...'
  & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Say ''
    Say '  Node.js ติดตั้งแล้ว แต่ process นี้ยังมองไม่เห็น'
    Say '  ปิดหน้าต่างนี้ เปิดใหม่ แล้วดับเบิลคลิกไฟล์ติดตั้งอีกครั้ง'
    Die 'ต้องรันซ้ำหนึ่งครั้งหลังติดตั้ง Node.js' 2
  }
  $node = (node --version).Trim()
  Say "  OK ติดตั้ง Node.js แล้ว ($node)"
}

# ── 3) ถาม HUB + ดาวน์โหลด ────────────────────────────────────────────────
if (-not $HubUrl) {
  $preset = Join-Path $installerDir 'install-node.txt'
  if (Test-Path $preset) {
    $txt = Get-Content $preset -Raw -Encoding utf8
    if ($txt -match '(?m)^\s*HUB_URL\s*=\s*(.+)$') { $HubUrl = $Matches[1].Trim() }
    if (-not $Code -and $txt -match '(?m)^\s*MACHINE_ENROLL_CODE\s*=\s*(.+)$') { $Code = $Matches[1].Trim() }
  }
}
if (-not $HubUrl) {
  $HubUrl = Read-Host 'ที่อยู่เครื่อง HUB (เช่น http://192.168.1.102:3000)'
}
$HubUrl = $HubUrl.TrimEnd('/')
if ($HubUrl -notmatch '^https?://') { Die "ที่อยู่ HUB ไม่ถูกต้อง: $HubUrl" }

Say "  HUB : $HubUrl"
Say "  จะติดตั้งไว้ที่: $Dest"
$api = "$HubUrl/api/agent-machines/node-kits"

try {
  $manifest = Invoke-RestMethod -Uri "$api/manifest/" -TimeoutSec 20
} catch {
  Die "ติดต่อ HUB ไม่ได้ ($api/manifest/) - ตรวจว่าเครื่อง HUB เปิดอยู่และอยู่เครือข่ายเดียวกัน"
}
if (-not $manifest.asset.sha256) { Die 'HUB ส่งชุดติดตั้งมาไม่ครบ (ไม่มี sha256) - จะไม่ติดตั้งของที่ตรวจสอบไม่ได้' }
if ($manifest.enrollmentOpen -ne $true) { Die 'HUB ยังไม่ได้เปิดให้ลงทะเบียนเครื่องใหม่ (ยังไม่ได้ตั้งรหัสเชิญที่ HUB)' }

$sizeMb = [math]::Round($manifest.asset.size / 1MB, 1)
Say ("  ชุดติดตั้ง: {0} · {1} MB" -f $manifest.asset.name, $sizeMb)
if ($DryRun) {
  Say "  - [dry-run] จะดาวน์โหลด $HubUrl$($manifest.assetUrl)/ แล้วตรวจ sha256 ก่อนแตก"
  Say ''
  Say '  DRY RUN จบ - ยังไม่ได้แก้อะไร'
  exit 0
}

$zip = Join-Path $env:TEMP ("node-kit-{0}.zip" -f $manifest.asset.sha256.Substring(0, 12))
Say ("  ... กำลังดาวน์โหลด ({0} MB) ..." -f $sizeMb)
try {
  Invoke-WebRequest -Uri "$HubUrl$($manifest.assetUrl)/" -OutFile $zip -TimeoutSec 900 -UseBasicParsing
} catch {
  Die "ดาวน์โหลดไม่สำเร็จ: $($_.Exception.Message)"
}

# ── 4) ตรวจ sha256 ก่อนแตก ───────────────────────────────────────────────
$got = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
if ($got -ne $manifest.asset.sha256.ToLower()) {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Die "แฮชไฟล์ไม่ตรงกับที่ HUB บอก - ของเสีย จะไม่ติดตั้ง (ไฟล์ถูกลบแล้ว)"
}
Say '  OK แฮชตรงกับ HUB'

# ── 5) แตกชุด ────────────────────────────────────────────────────────────
Say "  ... กำลังแตกไปที่ $Dest ..."
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
try {
  Expand-Archive -Path $zip -DestinationPath $Dest -Force
} catch {
  Die "แตกไฟล์ไม่สำเร็จ: $($_.Exception.Message)"
} finally {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

$setup = Join-Path $Dest 'tools\setup-node.mjs'
if (-not (Test-Path $setup)) {
  Die "ในชุดไม่มี tools\setup-node.mjs - ชุดเสีย อย่าติดตั้งต่อ"
}
$LogDir = Join-Path $Dest 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Relocate-Log $LogDir
Say ("  OK แตกแล้ว ({0} ไฟล์)" -f (Get-ChildItem $Dest -Recurse -File | Measure-Object).Count)

# ── 6) ส่งต่อให้ setup-node.mjs (Docker · deps · build · เริ่ม · ลงทะเบียน) ──
$args = @($setup, '--hub-url=' + $HubUrl)
if ($Code) { $args += '--code=' + $Code }
if ($Name) { $args += '--name=' + $Name }
Say ''
Say '  ... ต่อไป: ติดตั้ง Docker · dependency · build · เริ่มระบบ · ลงทะเบียนกับ HUB'
Say '      (ครั้งแรกใช้เวลานาน เพราะดึง Docker หลาย GB)'
Say ''

Push-Location $Dest
try {
  & node @args
  $rc = $LASTEXITCODE
} finally {
  Pop-Location
}

Say ''
if ($rc -eq 0) {
  Say '  ============================================================'
  Say '   เสร็จแล้ว - เครื่องนี้พร้อมรับคำสั่งจาก HUB'
  Say '   เปิด http://localhost:3000 เพื่อดูหน้าเว็บเต็มระบบ'
  Say '  ============================================================'
} else {
  Say "  ยังไม่เสร็จ (exit $rc) - ดูข้อความด้านบน แล้วอ่าน log ได้ที่ $Log"
}
Say "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] จบ (exit $rc)"
exit $rc