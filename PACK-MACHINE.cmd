@echo off & chcp 65001 >nul
REM PACK-MACHINE.cmd - double-click me on the HUB to build the install bundle for a new machine.
REM All logic lives in tools\agent-pack\pack-machine.mjs (Thai text is printed from there).
setlocal EnableExtensions
cd /d "%~dp0"
title Sovereign OS - Pack machine bundle
where node >nul 2>&1
if errorlevel 1 goto no_node
node "tools\agent-pack\pack-machine.mjs" %*
set "RC=%errorlevel%"
goto end
:no_node
echo.
echo [ERROR] Node.js 20+ was not found on this PC.
echo         Install the LTS build from https://nodejs.org/en/download
echo         then double-click PACK-MACHINE.cmd again.
set "RC=1"
:end
echo.
pause
endlocal & exit /b %RC%
