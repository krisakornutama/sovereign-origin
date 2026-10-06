@echo off
REM ── ติดตั้ง Agent Runner ให้รันอัตโนมัติบน Windows ──────────────────
REM ใช้: คลิกขวา install-runner.cmd → Run as administrator
REM ต้องมี .env พร้อมแล้ว (copy จาก .env.example แล้วใส่ MACHINE_TOKEN)
setlocal

set "RUNNER_DIR=%~dp0"
set "TASK_NAME=Sovereign Agent Runner"
set "NODE_EXE=node"

where node >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ node ใน PATH — ติดตั้ง Node.js ก่อน
  exit /b 1
)

if not exist "%RUNNER_DIR%.env" (
  echo [ผิดพลาด] ไม่พบ .env — copy .env.example เป็น .env แล้วใส่ MACHINE_TOKEN ก่อน
  exit /b 1
)

echo กำลังสร้าง Scheduled Task "%TASK_NAME%" ...
schtasks /Create /TN "%TASK_NAME%" /TR "cmd /c cd /d ""%RUNNER_DIR%"" ^&^& node src\main.mjs" /SC ONLOGON /F >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] สร้าง task ไม่สำเร็จ — ลองรันแบบ Run as administrator
  exit /b 1
)

echo.
echo [สำเร็จ] runner จะเริ่มอัตโนมัติทุกครั้งที่ล็อกอินเข้า Windows
echo.
echo ทดสอบเดี๋ยวนี้ได้ด้วย:
echo    cd /d "%RUNNER_DIR%"
echo    node src\main.mjs
echo.
echo ดูว่าติดต่อ HUB ได้ไหม: ต้องเห็นข้อความ "เครื่อง=... hub=..."
echo.
pause