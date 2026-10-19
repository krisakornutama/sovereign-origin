@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  if "%~1"=="" pause
  exit /b 1
)
node "%~dp0scripts\probe.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%~1"=="" exit /b %RC%
pause
exit /b %RC%
