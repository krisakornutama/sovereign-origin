@echo off & chcp 65001 >nul
REM ── ติดตั้งเครื่องนี้เป็น "เครื่องลูก" ของ Sovereign OS — ดับเบิลคลิกไฟล์นี้ ──
REM ทุกอย่างถูกบันทึกไว้ที่ setup-log.txt ข้างไฟล์นี้ (หน้าต่างปิดไปแล้วก็ย้อนอ่านได้)
REM ทางออกของสคริปต์มีทางเดียว: :end → pause → exit (ไม่มีทางปิดหน้าต่างหนี)
setlocal EnableExtensions
set "HERE=%~dp0"
cd /d "%HERE%" 2>nul
set "LOG=%HERE%setup-log.txt"
set "FINAL=1"

> "%LOG%" echo === Sovereign OS: ชุดติดตั้งเครื่องลูก ===
>> "%LOG%" echo โฟลเดอร์: %HERE%
>> "%LOG%" echo เวลา:    %DATE% %TIME%
>> "%LOG%" where node
>> "%LOG%" where winget
>> "%LOG%" echo.

if not exist "%HERE%setup-machine.mjs" goto no_script
if not exist "%HERE%join.json" goto no_join
where node >nul 2>&1
if errorlevel 1 goto no_node

echo กำลังติดตั้งเครื่องนี้เป็นเครื่องลูกของ Sovereign OS ...
echo.
node "%HERE%setup-machine.mjs" %* >> "%LOG%" 2>&1
set "RC=%errorlevel%"
>> "%LOG%" echo [จบด้วยรหัส %RC%]
type "%LOG%"
echo.
if not "%RC%"=="0" goto failed
set "FINAL=0"
goto ok

:no_script
REM ยังไม่ตั้ง FINAL=0 จนกว่าจะติดตั้งสำเร็จ
echo [ผิดพลาด] ไม่พบ setup-machine.mjs ในโฟลเดอร์นี้
echo   = ก็อปไม่ครบทั้งโฟลเดอร์ — ก็อปใหม่ทั้งโฟลเดอร์จากเครื่อง HUB
goto fail_msg

:no_join
echo [ผิดพลาด] ไม่พบ join.json (ไฟล์นี้มี token ที่ฝังมาให้ ไม่ต้องพิมพ์เอง)
echo   = ก็อปใหม่ทั้งโฟลเดอร์จากเครื่อง HUB (ตัวแพ็กสร้างไฟล์นี้ให้)
goto fail_msg

:no_node
echo [ต้องมี Node.js 20+] ไม่พบ node ในเครื่องนี้
>> "%LOG%" echo ไม่พบ node
where winget >nul 2>&1
if errorlevel 1 goto open_node_site
echo   กำลังติดตั้ง Node.js LTS ผ่าน winget (อาจมีหน้าต่างขออนุญาตขึ้นมา) ...
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo   เสร็จแล้ว — ปิดหน้าต่างนี้ เปิดใหม่ แล้วรัน SETUP-MACHINE.cmd อีกครั้ง
goto end

:open_node_site
echo   เปิดหน้าเว็บให้แล้ว — ติดตั้งเวอร์ชัน LTS แล้วรัน SETUP-MACHINE.cmd อีกครั้ง
start "" "https://nodejs.org/en/download"
goto end

:failed
echo [ยังไม่สำเร็จ] อ่านข้อความด้านบนได้เลย (ข้อความทั้งหมดถูกเก็บไว้ด้วย)
echo   ไฟล์บันทึก: %LOG%
goto end

:ok
echo เรียบร้อย — เครื่องนี้จะรายงานตัวกับ HUB เองทุก 15 วินาที
echo   ดูสถานะที่หน้าเว็บ HUB -> คิวเอเจนต์
goto end

:fail_msg
echo   ไฟล์บันทึก: %LOG%

:end
echo.
pause
REM ต้องเป็นบรรทัดเดียว: endlocal ล้างตัวแปรก่อน ถ้าแยกบรรทัด exit จะได้รหัส 0 เงียบ ๆ
endlocal & exit /b %FINAL%
