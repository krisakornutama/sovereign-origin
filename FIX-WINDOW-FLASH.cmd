@echo off
REM ============================================================================
REM  Fix: stop the console windows that pop up by themselves.
REM  Every Sovereign task that runs node.exe directly opens a window.
REM  This file raises itself to administrator and repairs them.
REM  ASCII only on purpose - Thai text inside a .cmd breaks cmd.exe.
REM ============================================================================
chcp 65001 >nul 2>&1
setlocal EnableExtensions DisableDelayedExpansion

net session >nul 2>&1
if not errorlevel 1 goto :isadmin
echo.
echo   Requesting administrator permission ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 0
:isadmin

node "E:\My work\Project Sovereign Origin\tools\fix-window-flash.mjs" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo   FAILED - exit %RC%
pause
exit /b %RC%
