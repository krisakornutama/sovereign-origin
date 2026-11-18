@echo off
REM Repair Windows Defender when it fails to start (error 577). Right-click > Run as administrator.
REM ASCII only on purpose: cmd.exe reads this file with the console codepage, so Thai bytes
REM before any chcp line break the whole script. Thai explanations live in repair-defender.ps1 / docs.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair-defender.ps1"
echo.
pause
