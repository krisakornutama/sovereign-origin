@echo off
setlocal
chcp 65001 >nul
title Sovereign OS - Launcher
cd /d "%~dp0"

:: ถ้า Launcher Server รันอยู่แล้ว - เปิดหน้าใหม่เฉย ๆ
netstat -ano | findstr ":4100 .*LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo Launcher Server รันอยู่แล้ว - เปิดหน้าใหม่
    start "" http://localhost:4100
    exit /b 0
)

:: ตรวจว่า node มีไหม
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js - ติดตั้ง Node.js 18+ ก่อน
    pause
    exit /b 1
)

:: เริ่ม Launcher Server ผ่าน watchdog (หน้าต่างนี้คือตัวรับคำสั่ง - ห้ามปิด)
:: watchdog จะเริ่ม server ใหม่ให้อัตโนมัติถ้ามันตาย และ log ไปที่ launcher-server.log
start "Sovereign-Launcher" cmd /k "launcher-watchdog.bat"

:: รอให้ server ตอบ /api/status จริง (สูงสุด ~20 วินาที) ก่อนเปิด browser
set /a count=0
:wait_loop
timeout /t 1 /nobreak >nul 2>&1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://127.0.0.1:4100/api/status -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :ready
set /a count+=1
if %count% geq 20 goto :failed
goto :wait_loop

:ready
echo.
echo Sovereign OS Launcher พร้อมแล้ว
start "" http://localhost:4100
echo อย่าปิดหน้าต่าง "Sovereign-Launcher" ไม่งั้นปุ่มจะใช้ไม่ได้
exit /b 0

:failed
echo.
echo [ERROR] Launcher Server ไม่สามารถเริ่มได้ภายใน 20 วินาที
echo ดูข้อผิดพลาดด้านล่าง (บันทึกไว้ที่ launcher-server.log):
echo ----------------------------------------
type launcher-server.log 2>nul
echo ----------------------------------------
echo แก้ไข: ตรวจว่า Node.js 18+ ติดตั้งแล้ว และพอร์ต 4100 ไม่ถูกแย่ง
pause
exit /b 1
