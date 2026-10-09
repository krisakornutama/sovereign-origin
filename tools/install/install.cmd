@echo off
REM ── ตัวติดตั้งครั้งเดียวของ "ทั้งโปรเจ็ก" (Windows) ─────────────────────
REM ดับเบิลคลิกไฟล์นี้ หรือรัน:  toolsinstallinstall.cmd [--flag]
REM ตัวอย่าง: install.cmd --dry-run  ·  install.cmd --with-runner
REM ต้องการ: Node.js 20+ และ Docker Desktop (เปิดไว้ก่อน)
chcp 65001 >nul
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Node.js — ติดตั้ง Node.js 20+ ก่อน: https://nodejs.org
  pause
  exit /b 1
)
node "%~dp0install.mjs" %*
set "RC=%errorlevel%"
if not "%RC%"=="0" (
  echo.
  echo [ยังไม่ครบ] ดู "ขั้นถัดไป" ด้านบน — หน้าต่างนี้ค้างไว้ให้อ่าน
  pause
)
exit /b %RC%
