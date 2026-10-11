@echo off & chcp 65001 >nul
REM ── ติดตั้ง Agent Runner ให้รันอัตโนมัติบน Windows ──────────────────
REM ใช้: คลิกขวา install-runner.cmd → Run as administrator
REM ต้องมี .env พร้อมแล้ว (copy จาก .env.example แล้วใส่ MACHINE_TOKEN)
REM
REM WARNING — path ที่มีเว้นวรรคจะสร้าง scheduled task ล้มเงียบ
REM   schtasks /Create ล้มเงียบเมื่อ %RUNNER_DIR% มีเว้นวรรค (เช่น "E:\My work\...")
REM   → จะไม่สร้าง task จริง แต่ตัวสคริปต์จะพิมพ์ "[สำเร็จ]" ต่อ
REM   วิธีหลีกเลี่ยง: ย้าย whole agent-runner ไปวางบน path ที่ไม่มีเว้นวรรคก่อนรัน
REM   ตรวจสอบหลังรัน: schtasks /Query /TN "Sovereign Agent Runner"
REM     - มีขึ้น = ติดตั้งสำเร็จ
REM     - ไม่ขึ้น/หาไม่พบ = ล้มเงียบ ไม่ใช่ติดตั้งสำเร็จ
REM
REM NOTE — ตัวติดตั้งนี้ไม่บล็อกการรัน แม้ path จะมีเว้นวรรค
REM   (เพราะยังสามารถใช้ node src\main.mjs ด้วยมือได้ โดยไม่ต้องพึ่ง scheduled task)

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

REM --- ตรวจ path ที่มีเว้นวรรค (เตือนเท่านั้น ไม่ block) ---
set "HAS_SPACE="
if not "%RUNNER_DIR: =%"=="%RUNNER_DIR%" set "HAS_SPACE=1"

if defined HAS_SPACE (
  echo.
  echo [คำเตือน] path ของโฟลเดอร์นี้มีเว้นวรรค
  echo   RUNNER_DIR=%RUNNER_DIR%
  echo   schtasks /Create อาจล้มเงียบโดยไม่สร้าง task จริง
  echo   - วิธีปลอดภัย: ย้าย whole agent-runner ไปวางบน path ที่ไม่มีเว้นวรรค แล้วรันใหม่
  echo   - ตรวจสอบหลังรัน: schtasks /Query /TN "Sovereign Agent Runner"
  echo     * หากมี task ขึ้น = ติดตั้งสำเร็จ
  echo     * หากไม่ขึ้น/หาไม่พบ = ล้มเงียบ ไม่ใช่ติดตั้งสำเร็จ
  echo.
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
