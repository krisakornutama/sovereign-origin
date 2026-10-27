@echo off & chcp 65001 >nul
REM INSTALL-CHECK.cmd - read-only check of this PC (before or after install).
REM Writes SUPPORT.txt next to this file so it can be sent for help.
REM Exit code: 0 = ready, 1 = something must be fixed first.
setlocal EnableExtensions
cd /d "%~dp0"
title Sovereign OS - check this PC
set "LOG=%~dp0check-log.txt"
> "%LOG%" echo === Sovereign OS check ===
>> "%LOG%" echo Folder: %~dp0
>> "%LOG%" echo Time:   %DATE% %TIME%
where node >nul 2>&1
if errorlevel 1 goto no_node
if exist "%~dp0tools\agent-pack\doctor.mjs" goto nested
if exist "%~dp0doctor.mjs" goto flat
goto no_script

:nested
node "%~dp0tools\agent-pack\doctor.mjs" %* >> "%LOG%" 2>&1
goto check

:flat
node "%~dp0doctor.mjs" %* >> "%LOG%" 2>&1

:check
set "RC=%errorlevel%"
>> "%LOG%" echo [exit %RC%]
type "%LOG%"
echo.
if not "%RC%"=="0" goto failed
echo [OK] no blocking problem found - next: double-click INSTALL.cmd
echo      After installing, run: INSTALL-CHECK.cmd --post  (proves the runner stays alive)
goto end

:failed
echo [ATTENTION] something is not ready - read the [FAIL] lines above.
echo The same text is in SUPPORT.txt - send that file if you need help.
goto end

:no_script
echo [ERROR] doctor.mjs was not found in this folder.
echo         Copy the WHOLE folder again from the HUB machine.
set "RC=1"
goto end

:no_node
echo [ERROR] Node.js 20+ was not found on this PC.
echo         Install the LTS build from https://nodejs.org/en/download
echo         then double-click INSTALL-CHECK.cmd again.
set "RC=1"

:end
echo.
pause
endlocal & exit /b %RC%
