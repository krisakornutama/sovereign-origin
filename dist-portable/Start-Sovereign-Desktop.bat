@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Sovereign OS Desktop
set "LOG=%~dp0sovereign-os-desktop.log"
set "APP_DIR=%~dp0"
set "EXE=%APP_DIR%Sovereign OS.exe"
set "BACKEND_URL=http://localhost:3001/api/health"
set "MAX_WAIT=120"

> "%LOG%" echo ==== Sovereign OS Desktop start %date% %time% ====

:header
cls
echo ============================================================
echo    Sovereign OS Desktop
echo ============================================================
echo.

:wait_docker
echo [1/4] Waiting for Docker Desktop...
set /a docker_wait=0
:docker_check
docker info >nul 2>&1
if %errorlevel% equ 0 goto :docker_ready
set /a docker_wait+=2
if %docker_wait% gtr 60 (
    echo.
    echo [ERROR] Docker Desktop not responding after 60 seconds.
    echo Please ensure Docker Desktop is running (whale icon in tray).
    echo.
    timeout /t 5 >nul
    goto :wait_docker
)
timeout /t 2 >nul
echo   Waiting for Docker... %docker_wait%/60 sec
goto :docker_check

:docker_ready
echo [OK] Docker is ready.

:start_backend
echo.
echo [2/4] Starting backend...
docker start sovereign-core-api >nul 2>&1
if %errorlevel% neq 0 (
    cd /d "%APP_DIR%..\sovereign-os\infra"
    docker compose up -d core-api
)
echo [OK] Backend container started.

:wait_backend
echo.
echo [3/4] Waiting for API (%BACKEND_URL%)...
set /a count=0
:health_loop
timeout /t 2 >nul 2>&1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri %BACKEND_URL% -TimeoutSec 3 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :backend_ready
set /a count+=2
if %count% geq %MAX_WAIT% (
    echo [WARN] Backend timeout. Retrying container...
    docker restart sovereign-core-api >nul 2>&1
    set /a count=0
)
title Sovereign OS - Starting... %count%/%MAX_WAIT% sec
echo   Waiting... %count%/%MAX_WAIT% sec
goto :health_loop

:backend_ready
title Sovereign OS - Ready!
echo [OK] Backend healthy.

:check_files
echo.
echo [4/4] Verifying app...
if not exist "%APP_DIR%resources\out\index.html" (
    echo [ERROR] Frontend not built. Run: cd sovereign-frontend && npm run electron:build
    pause
    exit /b 1
)
if not exist "%EXE%" (
    echo [ERROR] Executable missing.
    pause
    exit /b 1
)
echo [OK] All files present.

:launch
start "" "%EXE%"
cls
echo ============================================================
echo    Sovereign OS Started!
echo ============================================================
echo.
echo Backend : %BACKEND_URL%
echo App     : %EXE%
echo Log     : %LOG%
echo.
>> "%LOG%" echo ==== Ready %date% %time% ====
timeout /t 3 >nul