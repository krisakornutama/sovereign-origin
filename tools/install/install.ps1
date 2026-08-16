# ============================================================================
# Sovereign OS — One-Click Installer (Windows PowerShell 5.1+)
#
#   powershell -ExecutionPolicy Bypass -File tools\install\install.ps1
#   powershell -ExecutionPolicy Bypass -File tools\install\install.ps1 -Auto
#   powershell -ExecutionPolicy Bypass -File tools\install\install.ps1 -Prod
#   powershell -ExecutionPolicy Bypass -File tools\install\install.ps1 -NoFrontend
#   powershell -ExecutionPolicy Bypass -File tools\install\install.ps1 -DryRun
#
# สิ่งที่ทำ: ตรวจ Docker → สร้าง infra\.env (สุ่ม secret) → compose up → รอ healthy
#           → พิมพ์ URL + รหัสเข้าใช้ (บันทึกใน infra\.credentials)
# ============================================================================
[CmdletBinding()]
param(
  [switch]$Auto,        # เงียบสนิท ใช้ค่า default
  [switch]$Prod,        # ใช้ docker-compose.prod.yml (build images)
  [switch]$NoFrontend,  # ข้าม dashboard (กันชน port 3000)
  [switch]$DryRun,      # ดูแผน + .env ที่จะสร้าง (ไม่ลงมือ)
  [switch]$Force,       # สร้าง .env ใหม่ (สำรอง .bak)
  [string]$TelegramToken = '',
  [string]$TelegramChat = '',
  [string]$DashboardUrl = ''
)

$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # ..\
$INFRA = Join-Path $ROOT 'sovereign-os\infra'
$ENV_FILE = Join-Path $INFRA '.env'
$TEMPLATE = Join-Path $PSScriptRoot 'sovereign.env.template'
$CREDS = Join-Path $INFRA '.credentials'
$COMPOSE = Join-Path $INFRA 'docker-compose.yml'
$COMPOSE_PROD = Join-Path $INFRA 'docker-compose.prod.yml'

function Log  { Write-Host "  ✔ $($args[0])" -ForegroundColor Green }
function Warn { Write-Host "  ⚠ $($args[0])" -ForegroundColor Yellow }
function Die  { Write-Host "  ✘ $($args[0])" -ForegroundColor Red; exit 1 }

function New-RandomHex([int]$bytes) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $buf = New-Object byte[] $bytes
  $rng.GetBytes($buf)
  ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
}

Write-Host ""
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Sovereign OS — One-Click Install (Windows)" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan

# ── 1. Prerequisites ──
$dockerExe = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerExe) { Die 'ไม่พบ Docker — ติดตั้ง Docker Desktop: https://www.docker.com/products/docker-desktop/' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Die 'Docker ต้องมี compose v2 plugin' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { Die 'Docker daemon ไม่รัน — เปิด Docker Desktop ก่อน' }
Log "Docker พร้อม: $($dockerExe.Source)"

# ── 2. พอร์ตตรวจสอบ (แค่เตือน) ──
foreach ($p in 3001, 3000) {
  $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($conn) { Warn "พอร์ต $p ถูกใช้โดย: $($conn[0].OwningProcess) — ถ้าเป็น 3000 ใช้ -NoFrontend ได้" }
}

# ── 3. สร้าง infra\.env ──
$createEnv = $false
if (Test-Path $ENV_FILE) {
  if ($Force) { Warn 'Force: สำรอง .env เก่าเป็น .env.bak แล้วสร้างใหม่'; Copy-Item $ENV_FILE "$ENV_FILE.bak" -Force; $createEnv = $true }
  else { Log ".env มีอยู่แล้ว — ใช้ค่าที่ตั้งไว้ ($ENV_FILE)" }
} else { $createEnv = $true }

if ($createEnv -or $DryRun) {
  if (-not (Test-Path $TEMPLATE)) { Die "ไม่พบ template: $TEMPLATE" }
  $body = Get-Content $TEMPLATE -Raw
  $body = $body -replace '__GEN_SECRET_24__', (New-RandomHex 12)
  $body = $body -replace '__GEN_SECRET_32__', (New-RandomHex 16)
  $body = $body -replace '__GEN_SECRET_48__', (New-RandomHex 24)
  $body = $body -replace '__GEN_PASSWORD_16__', (New-RandomHex 8)

  # ── 4. คำถามที่จำเป็น (ข้ามเมื่อ -Auto) ──
  if (-not $Auto -and -not $TelegramToken) {
    $TelegramToken = Read-Host 'Telegram Bot Token (ว่าง = ข้าม)'
  }
  if ($TelegramToken -and -not $TelegramChat) { $TelegramChat = Read-Host 'Telegram Chat ID' }
  if ($TelegramToken -and -not $DashboardUrl) { $DashboardUrl = Read-Host 'Dashboard URL (เช่น http://192.168.1.10:3000, ว่าง = ข้าม)' }
  if (-not $Auto -and -not $TelegramToken) {
    $hasUps = Read-Host 'มี UPS + NUT server ไหม? (y/N)'
    if ($hasUps -match '^[yY]') { $body = $body.Replace('UPS_ENABLED=false', 'UPS_ENABLED=true') }
  }

  if ($TelegramToken) {
    $body = $body.Replace('TELEGRAM_BOT_TOKEN=', "TELEGRAM_BOT_TOKEN=$TelegramToken")
    if ($TelegramChat) { $body = $body.Replace('TELEGRAM_CHAT_ID=', "TELEGRAM_CHAT_ID=$TelegramChat") }
    if ($DashboardUrl) { $body = $body.Replace('TELEGRAM_DASHBOARD_URL=', "TELEGRAM_DASHBOARD_URL=$DashboardUrl") }
  }

  if ($DryRun) {
    Write-Host "── .env ที่จะสร้าง (dry-run) ──────────────────────" -ForegroundColor DarkGray
    ($body -split "`r?`n") | Where-Object { $_ -match '^[A-Z]' } | ForEach-Object {
      if ($_ -match '(PASSWORD|SECRET|TOKEN)=') { $_.Substring(0, $_.IndexOf('=') + 1) + '<hidden>' } else { $_ }
    }
    Write-Host "──────────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "dry-run จบ — ไม่ได้เขียนไฟล์ ไม่ได้รัน container"
    exit 0
  }

  Set-Content -Path $ENV_FILE -Value $body -Encoding UTF8
  Log "สร้าง infra\.env แล้ว (secret สุ่มทั้งหมด)"
}

# ── 5. บันทึก credentials ──
$envLines = Get-Content $ENV_FILE
$jwt = ($envLines | Where-Object { $_ -match '^JWT_SECRET=' }) -replace '^JWT_SECRET=', ''
$admin = ($envLines | Where-Object { $_ -match '^SEED_ADMIN_PASSWORD=' }) -replace '^SEED_ADMIN_PASSWORD=', ''
Set-Content -Path $CREDS -Value "SEED_ADMIN_PASSWORD=$admin`nJWT_SECRET=$jwt" -Encoding UTF8
Log "credentials บันทึกที่ infra\.credentials"

# ── 6. Compose up ──
$composeFile = if ($Prod) { $COMPOSE_PROD } else { $COMPOSE }
if ($NoFrontend) {
  Write-Host "  → docker compose up -d core-api (NoFrontend)"
  docker compose -f $composeFile up -d core-api
  if ($LASTEXITCODE -ne 0) { Die 'compose up ล้มเหลว — ดู log: docker compose logs core-api' }
} else {
  Write-Host "  → docker compose up -d (full stack)"
  $upOut = docker compose -f $composeFile up -d 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    if ($upOut -match 'ports are not available') {
      Warn 'พอร์ตชน (น่าจะ 3000) — ติดตั้งเฉพาะ core services (ข้าม dashboard)'
      docker compose -f $composeFile up -d core-api
      if ($LASTEXITCODE -ne 0) { Die 'compose up ล้มเหลว — ดู log: docker compose logs core-api' }
    } else {
      Write-Host $upOut
      Die 'compose up ล้มเหลว — ดู log: docker compose logs core-api'
    }
  }
}

# ── 7. รอ healthy ──
Write-Host "  → รอระบบพร้อม (build ครั้งแรก ~2-10 นาที)…"
$ok = $false
for ($i = 0; $i -lt 180; $i++) {
  try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/healthz' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
  if (($i + 1) % 10 -eq 0) { Write-Host "  …ยังไม่พร้อม $((($i + 1) / 2))s" }
  Start-Sleep -Seconds 5
}
if (-not $ok) { Die "รอ 15 นาทีแล้วยังไม่พร้อม — ดู log: docker compose -f $composeFile logs core-api" }

# ── 8. สรุป ──
$tgOn = [bool]($envLines | Where-Object { $_ -match '^TELEGRAM_BOT_TOKEN=.' })
$upsOn = [bool]($envLines | Where-Object { $_ -match '^UPS_ENABLED=true' })
Write-Host ""
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Log "ติดตั้งเสร็จสมบูรณ์ — Sovereign OS รันแล้ว!"
Write-Host "  Dashboard : $(if ($DashboardUrl) { $DashboardUrl } else { 'http://localhost:3000' })"
Write-Host "  API       : http://localhost:3001"
Write-Host "  ล็อกอิน   : admin / $admin   (ดู infra\.credentials)"
Write-Host "  Telegram  : $(if ($tgOn) { 'เปิดแล้ว' } else { 'ยังปิด — ใส่ token แล้ว docker compose up -d' })"
Write-Host "  UPS       : $(if ($upsOn) { 'เปิด (dry-run)' } else { 'ปิด (ต้องมี NUT server)' })"
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "ขั้นถัดไป: ดู docs\SERIES_RED_DMS_BLUEPRINT.md (ชุด 🔴)"
