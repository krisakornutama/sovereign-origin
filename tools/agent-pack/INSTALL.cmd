@echo off & chcp 65001 >nul
REM INSTALL.cmd - the ONE file to double-click on the target machine.
REM All logic lives in setup-machine.mjs: it finds join.json + install-plan.json
REM by itself (also from tools\agent-pack in the full kit), writes the .env,
REM proves the token with a heartbeat, shows which parent machine owns this PC,
REM and registers the autostart task.
setlocal EnableExtensions
cd /d "%~dp0"
title Sovereign OS - install this machine
set "LOG=%~dp0install-log.txt"
> "%LOG%" echo === Sovereign OS install ===
>> "%LOG%" echo Folder: %~dp0
>> "%LOG%" echo Time:   %DATE% %TIME%
where node >nul 2>&1
if errorlevel 1 goto no_node
if exist "%~dp0tools\agent-pack\setup-machine.mjs" goto nested
if exist "%~dp0setup-machine.mjs" goto flat
goto no_script

:nested
echo Installing this machine as a child of your HUB ...
echo.
node "%~dp0tools\agent-pack\setup-machine.mjs" %* >> "%LOG%" 2>&1
goto check

:flat
echo Installing this machine as a child of your HUB ...
echo.
node "%~dp0setup-machine.mjs" %* >> "%LOG%" 2>&1

:check
set "RC=%errorlevel%"
>> "%LOG%" echo [exit %RC%]
type "%LOG%"
echo.
if not "%RC%"=="0" goto failed
echo Done - this machine reports to the HUB every 15 seconds.
echo Open the HUB web UI - Agent queue - to see this machine online.
goto end

:failed
echo [NOT FINISHED] read the messages above (also saved to install-log.txt)
echo.
echo   If it says the token was rejected (401), pack a fresh bundle on the HUB.
echo   Then double-click INSTALL-CHECK.cmd here - it writes SUPPORT.txt you can send.
goto end

:no_script
echo [ERROR] setup-machine.mjs was not found in this folder.
echo         Copy the WHOLE folder again from the HUB machine.
set "RC=1"
goto end

:no_node
echo [ERROR] Node.js 20+ was not found on this PC.
echo         Install the LTS build from https://nodejs.org/en/download
echo         then double-click INSTALL.cmd again.
set "RC=1"

:end
echo.
pause
endlocal & exit /b %RC%
