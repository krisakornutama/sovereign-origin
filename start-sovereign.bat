@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Sovereign OS Launcher
set "LOG=%~dp0start-sovereign.log"

set "NOW=%time: =0%"
for /f "tokens=1-3 delims=:.," %%a in ("%NOW%") do set /a "START_T=(1%%a*3600+1%%b*60+1%%c)-366100"

> "%LOG%" echo ==== Sovereign OS start %date% %time% ====

echo ========================================
echo    Sovereign OS - Starting all services
echo ========================================
echo.

:: ============ ตรวจสอบ Docker ============
docker info >nul 2>&1
if %errorlevel% neq 0 (
    call :note "[ERROR] Docker Desktop ยังไม่เปิด — ให้เปิด Docker Desktop ก่อน แล้วรันใหม่"
    pause
    exit /b 1
)

:: [guard] ถ้าเครื่องมี MAIN installation ให้รัน compose/frontend จาก MAIN เสมอ
:: เหตุผล: compose จาก worktree จะ mount PGDATA ไปที่ data/pg ของ worktree (ว่าง)
:: ทำให้ตาราง users หายทั้งหมด — incident 2026-09-09
set "ROOT=%~dp0"
if exist "E:\My work\Project Sovereign Origin\sovereign-os\infra\docker-compose.yml" set "ROOT=E:\My work\Project Sovereign Origin"
call :note "  - ROOT = %ROOT%"

:: ============ ตรวจสอบว่า setup ครั้งแรกแล้วหรือยัง ============
if not exist "%ROOT%\sovereign-os\infra\.env" (
    call :note "[ERROR] ยังไม่พบ infra\.env — ให้รัน setup-first-time.bat ก่อนครั้งแรก"
    pause
    exit /b 1
)

:: เลือกคำสั่ง compose
set "COMPOSE_CMD=docker compose"
docker compose version >nul 2>&1
if %errorlevel% neq 0 set "COMPOSE_CMD=docker-compose"

:: ============ [1/3] เริ่ม Docker containers ============
call :note "== [1/3] เริ่ม Docker containers (TimescaleDB + EMQX + Core API) =="
cd /d "%ROOT%\sovereign-os\infra"
set /a compose_tries=0
:compose_retry
set /a compose_tries+=1
%COMPOSE_CMD% up -d timescaledb emqx core-api
if %errorlevel% neq 0 (
    if %compose_tries% lss 3 (
        call :note "  - compose ยังไม่สำเร็จ ครั้งที่ !compose_tries! — รอ 10 วิ แล้วลองใหม่ (engine เพิ่งบูตอาจยัง init อยู่)"
        timeout /t 10 /nobreak >nul 2>&1
        goto :compose_retry
    )
    call :note "[ERROR] เริ่ม container ไม่สำเร็จหลัง 3 ครั้ง — ดู: docker compose logs"
    pause
    exit /b 1
)
call :note "  - containers พร้อมแล้ว"

:: ============ [2/3] เริ่ม Frontend (เช็คด้วย HTTP จริง ไม่ใช่แค่พอร์ต) ============
:: เช็คด้วย HTTP จริง ไม่ใช่แค่พอร์ต — พอร์ตมีคนฟังแต่ไม่ตอบ = frontend ค้าง ต้องล้างแล้วเริ่มใหม่
:: pin พอร์ต 3000 เสมอ กัน env PORT หลุดไป bind พอร์ตอื่น | หน้าต่าง /min ย่อไว้ดู error ได้ถ้าพัง
call :note "== [2/3] เริ่ม Frontend =="
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://127.0.0.1:3000 -TimeoutSec 3 -UseBasicParsing; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    call :note "  - Frontend ตอบปกติที่ :3000 — ข้าม"
) else (
    call :note "  - ล้าง frontend ค้างบนพอร์ต 3000 ถ้ามี แล้วเริ่มใหม่"
    powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { taskkill /PID $_ /T /F 2>$null | Out-Null }" >nul 2>&1
    timeout /t 2 >nul 2>&1
    cd /d "%ROOT%\sovereign-frontend"
    start "Sovereign-Frontend" /min cmd /k "npm run dev -- -p 3000"
    call :note "  - เปิด Frontend แล้ว โหลดครั้งแรกอาจใช้เวลาราว 1 นาที"
)

:: ============ [3/3] รอ Backend พร้อมแล้วเปิด Dashboard ============
call :note "== [3/3] รอ Backend พร้อม =="
set /a count=0
:health_loop
timeout /t 3 >nul 2>&1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3001/api/health -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :frontend_wait
set /a count+=3
title Sovereign OS - กำลังเริ่ม... ผ่านไป !count! วินาที
if %count% geq 240 (
    call :note "[ERROR] Backend ไม่พร้อมใน 240 วินาที — ดู: docker logs sovereign-core-api"
    pause
    exit /b 1
)
echo   ยังรออยู่... ผ่านไป !count! วินาที
goto :health_loop

:: ============ รอ Frontend พร้อม (สูงสุด 90 วิ) ก่อนเปิด browser ============
:frontend_wait
call :note "== รอ Frontend พร้อม =="
set /a fcount=0
:frontend_loop
timeout /t 3 /nobreak >nul 2>&1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3000 -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :ready
set /a fcount+=3
if %fcount% geq 150 (
    call :note "[WARN] Frontend ยังไม่พร้อมใน 150 วิ — เปิด browser ไปก่อน (รีเฟรชใหม่ถ้ายังไม่ขึ้น)"
    goto :ready
)
echo   ยังรอ Frontend... ผ่านไป !fcount! วินาที
goto :frontend_loop

:ready
call :elapsed
call :note "== ระบบพร้อมแล้ว ใช้เวลา %ELAPSED_TEXT% =="
echo.
echo ========================================
echo    System Ready! Opening Dashboard...
echo ========================================
start http://localhost:3000

echo.
echo Dashboard        : http://localhost:3000
echo Backend API      : http://localhost:3001
echo EMQX Dashboard   : http://localhost:18083
echo.
echo ปิดหน้าต่างนี้ได้เลย - Hot Reload ทำงานทั้ง frontend และ backend
echo.
>> "%LOG%" echo ==== Sovereign OS ready %date% %time% ====
pause
exit /b 0

:: ============ subroutine ============
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
