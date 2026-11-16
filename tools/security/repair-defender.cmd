@echo off
REM Repair Windows Defender when it fails to start with error 577 > Run as administrator
REM (ASCII only on purpose: cmd.exe reads this file with the console codepage)
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair-defender.ps1"
echo.
pause
