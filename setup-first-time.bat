@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Sovereign OS - First Time Setup
set "LOG=%~dp0setup-first-time.log"

:: ── จับเวลาเริ่ม ──
set "NOW=%time: =0%"
for /f "tokens=1-3 delims=:.," %%a in ("%NOW%") do set /a "START_T=(1%%a*3600+1%%b*60+1%%c)-366100"

> "%LOG%" echo ==== Sovereign OS setup started %date% %time% ====

echo ========================================
echo   Sovereign OS - First Time Setup
echo ========================================
echo.
call :note "โปรดอย่าปิดหน้าต่างนี้จนกว่าจะเห็น [Setup complete]"
call :note "เวลาที่ใช้โดยประมาณ: ครั้งแรก 5-15 นาที - ครั้งถัดไป 1-3 นาที"
call :note "ทุกขั้นตอนบันทึกลงไฟล์ setup-first-time.log ดูได้แม้หน้าต่างปิด"
echo.

:: ============ ตรวจสอบตำแหน่งไฟล์ ============
if not exist "%~dp0sovereign-os\infra\docker-compose.yml" (
    call :note "[ERROR] ไม่พบโฟลเดอร์ sovereign-os - ให้ดับเบิลคลิกไฟล์ .bat จากโฟลเดอร์โปรเจกต์โดยตรง"
    pause
    exit /b 1
)

:: ============ ตรวจสอบ Docker ============
docker info >nul 2>&1
if %errorlevel% neq 0 (
    call :note "[ERROR] Docker Desktop ยังไม่เปิด - ให้เปิด Docker Desktop ก่อน แล้วรันใหม่"
    pause
    exit /b 1
)
call :note "[OK] Docker พร้อมใช้งาน"

:: เลือกคำสั่ง compose
set "COMPOSE_CMD=docker compose"
docker compose version >nul 2>&1
if %errorlevel% neq 0 set "COMPOSE_CMD=docker-compose"
call :note "[OK] ใช้คำสั่ง: %COMPOSE_CMD%"
echo.

:: ============ [1/5] สร้างไฟล์ตั้งค่า ============
call :note "== [1/5] สร้างไฟล์ตั้งค่า =="
cd /d "%~dp0"

:: อ่านค่าเดิมจาก infra/.env ถ้ามี
set "PG_PASS="
set "EMQX_PASS="
set "JWT_SECRET="
set "OTA_TOKEN="
if exist "sovereign-os\infra\.env" (
    for /f "tokens=1,* delims==" %%a in ('findstr /b "POSTGRES_PASSWORD=" "sovereign-os\infra\.env"') do set "PG_PASS=%%b"
    for /f "tokens=1,* delims==" %%a in ('findstr /b "EMQX_PASSWORD=" "sovereign-os\infra\.env"') do set "EMQX_PASS=%%b"
    for /f "tokens=1,* delims==" %%a in ('findstr /b "JWT_SECRET=" "sovereign-os\infra\.env"') do set "JWT_SECRET=%%b"
    for /f "tokens=1,* delims==" %%a in ('findstr /b "OTA_TOKEN=" "sovereign-os\infra\.env"') do set "OTA_TOKEN=%%b"
)

:: สร้าง secret ที่ยังขาด (รวมกรณีของเก่าเป็นค่าว่าง - ซ่อมอัตโนมัติ)
set "GEN_ANY=0"
if not defined PG_PASS  (
    call :genpass PG_PASS
    set "GEN_ANY=1"
    call :note "  - สร้าง POSTGRES_PASSWORD ใหม่"
)
if not defined EMQX_PASS (
    call :genpass EMQX_PASS
    set "GEN_ANY=1"
    call :note "  - สร้าง EMQX_PASSWORD ใหม่"
)
if not defined JWT_SECRET (
    call :genpass JWT_SECRET
    set "GEN_ANY=1"
    call :note "  - สร้าง JWT_SECRET ใหม่"
)
if not defined OTA_TOKEN (
    call :genpass OTA_TOKEN
    set "GEN_ANY=1"
    call :note "  - สร้าง OTA_TOKEN ใหม่"
)

:: เขียนไฟล์ตั้งค่าใหม่ถ้า: ยังไม่มีไฟล์, หรือเพิ่งสร้าง secret ใหม่, หรือของเดิมเป็นค่าว่าง
set "NEED_REWRITE=0"
if not exist "sovereign-os\infra\.env" set "NEED_REWRITE=1"
if "!GEN_ANY!"=="1" set "NEED_REWRITE=1"

if "!NEED_REWRITE!"=="1" (
    call :note "  - เขียนไฟล์ตั้งค่าด้วย secret ชุดใหม่"

    (
        echo # Sovereign OS - runtime config, created by setup-first-time.bat
        echo # Edit later: TELEGRAM_BOT_TOKEN - TELEGRAM_CHAT_ID - OTA_BASE_URL - EMBED_MODEL
        echo POSTGRES_USER=sovereign
        echo POSTGRES_PASSWORD=!PG_PASS!
        echo POSTGRES_DB=sovereign
        echo EMQX_USERNAME=admin
        echo EMQX_PASSWORD=!EMQX_PASS!
        echo JWT_SECRET=!JWT_SECRET!
        echo OTA_BASE_URL=http://localhost:3001
        echo OTA_TOKEN=!OTA_TOKEN!
        echo TELEGRAM_BOT_TOKEN=
        echo TELEGRAM_CHAT_ID=
        echo CORS_ORIGIN=*
        echo EMBED_MODEL=nomic-embed-text
        echo ENERGY_CAPACITY_KWH=5
        echo SEED_ADMIN_PASSWORD=
        echo THREAT_DETECTION_ENABLED=true
        echo THREAT_CONNECTION_THRESHOLD=100
        echo THREAT_ALLOWLIST_IPS=
        echo FIREWALL_BLOCK_CMD=
    ) > "sovereign-os\infra\.env"
    call :note "  - เขียน sovereign-os\infra\.env แล้ว"

    (
        echo # Sovereign OS core-api env, created by setup-first-time.bat
        echo DATABASE_URL=postgresql://sovereign:!PG_PASS!@localhost:5432/sovereign
        echo JWT_SECRET=!JWT_SECRET!
        echo PORT=3001
        echo MQTT_HOST=localhost
        echo MQTT_PORT=1883
        echo MQTT_USER=
        echo MQTT_PASS=
        echo TIMESCALE_HOST=localhost
        echo TIMESCALE_PORT=5432
        echo TIMESCALE_DB=sovereign
        echo TIMESCALE_USER=sovereign
        echo TIMESCALE_PASSWORD=!PG_PASS!
        echo TELEGRAM_BOT_TOKEN=
        echo TELEGRAM_CHAT_ID=
        echo OLLAMA_URL=http://127.0.0.1:11434
        echo AI_MODEL=gemma3:4b
        echo EMBED_MODEL=nomic-embed-text
        echo BACKUP_DIR=./backups
        echo DB_CONTAINER=sovereign-db
        echo OTA_BASE_URL=http://localhost:3001
        echo OTA_DIR=./ota_firmwares
        echo OTA_TOKEN=!OTA_TOKEN!
        echo ENERGY_CAPACITY_KWH=5
        echo SEED_ADMIN_PASSWORD=
        echo THREAT_DETECTION_ENABLED=true
        echo THREAT_CHECK_INTERVAL_MS=60000
        echo THREAT_CONNECTION_THRESHOLD=100
        echo THREAT_IP_COOLDOWN_MS=600000
        echo THREAT_BASELINE_WINDOW_MS=3600000
        echo THREAT_ALLOWLIST_IPS=
        echo FIREWALL_BLOCK_CMD=
    ) > "sovereign-os\core-api\.env"
    call :note "  - เขียน sovereign-os\core-api\.env แล้ว"

    (
        echo NEXT_PUBLIC_API_URL=http://localhost:3001
    ) > "sovereign-frontend\.env.local"
    call :note "  - เขียน sovereign-frontend\.env.local แล้ว"
) else (
    call :note "  - พบค่า secret เดิมถูกต้อง - คงไฟล์ตั้งค่าเดิมไว้ ไม่ทับ"
    if not exist "sovereign-os\core-api\.env" (
        (
            echo # Sovereign OS core-api env, created by setup-first-time.bat
            echo DATABASE_URL=postgresql://sovereign:!PG_PASS!@localhost:5432/sovereign
            echo JWT_SECRET=!JWT_SECRET!
            echo PORT=3001
            echo MQTT_HOST=localhost
            echo MQTT_PORT=1883
            echo MQTT_USER=
            echo MQTT_PASS=
            echo TIMESCALE_HOST=localhost
            echo TIMESCALE_PORT=5432
            echo TIMESCALE_DB=sovereign
            echo TIMESCALE_USER=sovereign
            echo TIMESCALE_PASSWORD=!PG_PASS!
            echo TELEGRAM_BOT_TOKEN=
            echo TELEGRAM_CHAT_ID=
            echo OLLAMA_URL=http://127.0.0.1:11434
            echo AI_MODEL=gemma3:4b
            echo EMBED_MODEL=nomic-embed-text
            echo BACKUP_DIR=./backups
            echo DB_CONTAINER=sovereign-db
            echo OTA_BASE_URL=http://localhost:3001
            echo OTA_DIR=./ota_firmwares
            echo OTA_TOKEN=!OTA_TOKEN!
            echo ENERGY_CAPACITY_KWH=5
            echo SEED_ADMIN_PASSWORD=
            echo THREAT_DETECTION_ENABLED=true
            echo THREAT_CHECK_INTERVAL_MS=60000
            echo THREAT_CONNECTION_THRESHOLD=100
            echo THREAT_IP_COOLDOWN_MS=600000
            echo THREAT_BASELINE_WINDOW_MS=3600000
            echo THREAT_ALLOWLIST_IPS=
            echo FIREWALL_BLOCK_CMD=
        ) > "sovereign-os\core-api\.env"
        call :note "  - สร้าง sovereign-os\core-api\.env แล้ว"
    )
    if not exist "sovereign-frontend\.env.local" (
        (
            echo NEXT_PUBLIC_API_URL=http://localhost:3001
        ) > "sovereign-frontend\.env.local"
        call :note "  - สร้าง sovereign-frontend\.env.local แล้ว"
    )
)
call :note "== [1/5] เสร็จ =="
echo.

:: ============ [2/5] เริ่ม Docker containers ============
call :note "== [2/5] เริ่ม Docker containers - ครั้งแรกจะโหลด image หลายนาที รอได้เลย =="
cd /d "%~dp0sovereign-os\infra"
%COMPOSE_CMD% down --remove-orphans >nul 2>&1
%COMPOSE_CMD% up -d timescaledb emqx core-api
if %errorlevel% neq 0 (
    call :note "[ERROR] เริ่ม container ไม่สำเร็จ - ดู: docker compose logs"
    pause
    exit /b 1
)
call :note "  - containers เริ่มแล้ว - ดูสถานะได้ใน Docker Desktop"

:: รอให้ฐานข้อมูลพร้อม
call :note "  - รอฐานข้อมูลพร้อม..."
set "PG_USER=sovereign"
for /f "tokens=1,* delims==" %%a in ('findstr /b "POSTGRES_USER=" ".env"') do set "PG_USER=%%b"
set /a db_wait=0
:db_loop
docker exec sovereign-db pg_isready -U !PG_USER! >nul 2>&1
if %errorlevel% equ 0 goto :db_ready
timeout /t 2 >nul 2>&1
set /a db_wait+=2
title Sovereign OS - Setup - รอ DB ... !db_wait!s
if !db_wait! geq 60 (
    call :note "[ERROR] ฐานข้อมูลไม่พร้อมใน 60 วินาที - ดู: docker logs sovereign-db"
    pause
    exit /b 1
)
goto :db_loop
:db_ready
call :note "  - ฐานข้อมูลพร้อมแล้ว"
echo.

:: ============ [3/5] รัน migrations + generate + seed ============
call :note "== [3/5] รัน migrations + seed - ครั้งแรกอาจ 1-2 นาที =="
docker exec sovereign-core-api npx prisma migrate deploy
if %errorlevel% neq 0 (
    call :note "[ERROR] migration ล้มเหลว - ดู: docker logs sovereign-core-api"
    pause
    exit /b 1
)
docker exec sovereign-core-api npx prisma generate
docker exec sovereign-core-api npx tsx src/scripts/seed.ts
call :note "  - ตั้งค่าฐานข้อมูลเสร็จ - admin password ดูจากข้อความ seed ด้านบน"
echo.

:: ============ [4/5] เริ่ม Frontend ============
call :note "== [4/5] เริ่ม Frontend =="
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($c) { exit 0 } else { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    call :note "  - Frontend รันอยู่แล้วที่พอร์ต 3000 - ข้าม"
) else (
    cd /d "%~dp0sovereign-frontend"
    start "Sovereign-Frontend" cmd /c "npm run dev"
    call :note "  - เปิดหน้าต่าง Frontend แล้ว"
)
echo.

:: ============ [5/5] รอ Backend แล้วเปิด Dashboard ============
call :note "== [5/5] รอ Backend พร้อม - ครั้งแรก 30-60 วินาที =="
set /a count=0
:health_loop
timeout /t 3 >nul 2>&1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3001/api/health -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :ready
set /a count+=3
title Sovereign OS - Setup - รอ Backend ... !count!s
if %count% geq 90 (
    call :note "[ERROR] Backend ไม่พร้อมใน 90 วินาที - ดู: docker logs sovereign-core-api"
    pause
    exit /b 1
)
echo   ยังรออยู่... ผ่านไป !count! วินาที
goto :health_loop

:ready
call :elapsed
call :note "== เสร็จสิ้น - ใช้เวลาทั้งหมด: %ELAPSED_TEXT% =="
echo.
echo ========================================
echo   Setup complete!
echo   Dashboard : http://localhost:3000
echo   Backend   : http://localhost:3001
echo   EMQX UI   : http://localhost:18083
echo.
echo   admin password: ดูจากข้อความ seed ด้านบน
echo.
echo   ค่าที่แก้เพิ่มได้ใน sovereign-os\infra\.env:
echo      - TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  สำหรับแจ้งเตือน Telegram
echo      - OTA_BASE_URL = IP เครื่องนี้บน LAN เช่น http://192.168.1.10:3001
echo      - EMBED_MODEL  ต้องมี model ใน Ollama: ollama pull nomic-embed-text
echo      - SEED_ADMIN_PASSWORD  ถ้าอยากกำหนดรหัสผ่าน admin เอง
echo ========================================
>> "%LOG%" echo ==== Sovereign OS setup finished %date% %time% ====
start http://localhost:3000
pause
exit /b 0

:: ============ subroutine ============

:genpass
powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')" > "%TEMP%\sovereign_secret.tmp"
set /p "%~1=" < "%TEMP%\sovereign_secret.tmp"
del "%TEMP%\sovereign_secret.tmp" >nul 2>&1
goto :eof

:note
echo %~1
echo %~1>>"%LOG%"
goto :eof

:elapsed
set "E_END=%time: =0%"
for /f "tokens=1-3 delims=:.," %%a in ("%E_END%") do set /a "E_T=(1%%a*3600+1%%b*60+1%%c)-366100"
set /a "E_ELAPSED=E_T - START_T"
if %E_ELAPSED% lss 0 set /a "E_ELAPSED+=86400"
set /a "E_MIN=E_ELAPSED/60"
set /a "E_SEC=E_ELAPSED%%60"
set "ELAPSED_TEXT=%E_MIN% นาที %E_SEC% วินาที"
goto :eof
