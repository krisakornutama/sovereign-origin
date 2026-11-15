@echo off
REM right-click this file > Run as administrator   (add -WhatIf to preview)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0harden-host.ps1" %*
echo.
pause
