@echo off
REM Sovereign OS - clean uninstaller (Windows)
REM Default is a dry-run. Add --yes to execute, --purge-data to delete volumes.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node 18+ or run: schtasks /Delete /TN "Sovereign Agent Runner" /F
  pause
  exit /b 1
)
node uninstall.mjs %*
pause
