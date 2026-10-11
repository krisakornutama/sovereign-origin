@echo off
rem run-runner.cmd - wrapper that keeps the machine runner alive and honours self-update handoff
rem
rem   exit 86 = the runner handed over to a freshly spawned process (do NOT start a second copy)
rem   exit  0 = clean stop (do NOT restart)
rem   anything else = crash -> start again after 10s (machine stays reachable)
rem
rem Use it as the scheduled task target:
rem   schtasks /Create /TN "Sovereign Agent Runner" /TR "cmd /c ""%~f0""" /SC ONLOGON /F
setlocal
cd /d "%~dp0"
title Sovereign Agent Runner
:loop
node src\main.mjs
set "RC=%ERRORLEVEL%"
if "%RC%"=="86" goto :done
if "%RC%"=="0" goto :done
echo.
echo [run-runner] runner exited abnormally (exit %RC%) - restarting in 10s
timeout /t 10 /nobreak >nul
goto :loop
:done
endlocal & exit /b %RC%
