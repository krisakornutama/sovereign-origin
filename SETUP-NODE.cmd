@echo off & chcp 65001 >nul & setlocal EnableExtensions
REM Sovereign OS - install this machine as a full child node
REM One double-click: checks disk, installs Node + Docker, starts the stack,
REM registers with HUB, and installs the disk guard.
REM All output goes to logs\setup-node.log - the window can be closed safely.
set "HERE=%~dp0"
cd /d "%HERE%" 2>nul
if not exist "%HERE%tools\setup-node.mjs" (
  echo [ERROR] setup-node.mjs not found - copy the WHOLE folder, not part of it
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found yet.
  echo   Installing Node.js LTS now - this takes a few minutes.
  where winget >nul 2>&1
  if errorlevel 1 (
    echo   winget not found. Install Node.js 20+ from https://nodejs.org then run this file again.
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  echo.
  echo   Node.js installed. Close this window, open it again, and run SETUP-NODE.cmd once more.
  pause
  exit /b 0
)
node "%HERE%tools\setup-node.mjs" %*
set "RC=%errorlevel%"
echo.
echo Exit code: %RC%
echo Log: %HERE%logs\setup-node.log
pause
endlocal & exit /b %RC%