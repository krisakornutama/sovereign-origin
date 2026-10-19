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
node "%~dp0scripts\stop.mjs" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo Edge AI stop failed with exit code %RC%.
)
if "%~1"=="" pause
exit /b %RC%
