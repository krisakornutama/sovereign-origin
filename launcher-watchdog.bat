@echo off
setlocal
chcp 65001 >nul
title Sovereign-Launcher (watchdog)
cd /d "%~dp0"

:: ────────────────────────────────────────────────────────────
::  Sovereign OS — Launcher Watchdog
::  รัน node launcher-server.mjs และเริ่มใหม่ให้อัตโนมัติถ้ามันตาย
::  (หน้าต่างนี้คือ "Sovereign-Launcher" — อย่าปิด แต่ปิดได้ ไม่มีปัญหา
::   เพราะถ้าเปิด autostart ไว้ ระบบจะเริ่มเองตอนเข้า Windows)
::  สถานะทั้งหมดบันทึกที่ launcher-server.log ด้วย
:: ────────────────────────────────────────────────────────────

set "FAILS=0"

:loop
:: ถ้า 4100 มี server ตัวอื่นรันอยู่แล้ว (เช่นเริ่มผ่าน autostart) - ปิดตัวเอง ไม่แย่ง
netstat -ano | findstr ":4100 .*LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [%date% %time%] พบ Launcher Server รันอยู่แล้วที่พอร์ต 4100 - watchdog ปิดตัวเอง
    echo [%date% %time%] พบ Launcher Server รันอยู่แล้วที่พอร์ต 4100 - watchdog ปิดตัวเอง>>launcher-server.log
    exit /b 0
)

echo [%date% %time%] กำลังเริ่ม Launcher Server...
echo [%date% %time%] กำลังเริ่ม Launcher Server...>>launcher-server.log
node launcher-server.mjs >> launcher-server.log 2>&1
echo [%date% %time%] Launcher Server ปิดลง - จะเริ่มใหม่ในไม่กี่วินาที...
echo [%date% %time%] Launcher Server ปิดลง - จะเริ่มใหม่ในไม่กี่วินาที...>>launcher-server.log

:: พังติดกันเกิน 5 ครั้ง = มีอะไรผิดปกติเรื้อรัง (เช่น port โดนแย่ง) -> พักนานขึ้น
if %FAILS% geq 5 (
    echo [%date% %time%] พังติดกัน 5 ครั้ง - พัก 30 วินาที แล้วลองใหม่
    echo [%date% %time%] พังติดกัน 5 ครั้ง - พัก 30 วินาที แล้วลองใหม่>>launcher-server.log
    timeout /t 30 /nobreak >nul 2>&1
    set "FAILS=0"
) else (
    set /a FAILS+=1
    timeout /t 3 /nobreak >nul 2>&1
)
goto loop
