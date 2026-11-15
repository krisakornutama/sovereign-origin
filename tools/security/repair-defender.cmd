@echo off
chcp 65001 >nul
REM คลิกขวาไฟล์นี้ > Run as administrator
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair-defender.ps1"
echo.
pause
