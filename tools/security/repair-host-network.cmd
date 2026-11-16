@echo off
REM repair-host-network.cmd - restore Windows proxy/network settings to default.
REM Double-click this file (no admin needed). ASCII only on purpose: cmd.exe reads
REM this file with the console codepage, so Thai text here breaks the script.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair-host-network.ps1" %*
echo.
pause
