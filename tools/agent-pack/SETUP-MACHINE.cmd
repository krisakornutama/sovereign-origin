@echo off\r
REM ── ติดตั้งเครื่องนี้เป็น "เครื่องลูก" ของ Sovereign OS — ดับเบิลคลิกไฟล์นี้ ──\r
REM ทำทุกอย่างให้เอง: ตรวจ Node → ตรวจสายไป HUB → เขียน .env → พิสูจน์ว่าออนไลน์ → ตั้ง autostart\r
REM ต้องมี: Node.js 20+ (ถ้าไม่มี จะพาไปติดตั้ง) · ไฟล์ join.json (ฝัง token มาให้แล้ว)\r
chcp 65001 >nul\r
setlocal\r
cd /d "%~dp0"\r
\r
where node >nul 2>&1\r
if errorlevel 1 (\r
  echo.\r
  echo [ต้องมี Node.js 20+] ไม่พบ node ในเครื่องนี้\r
  where winget >nul 2>&1\r
  if errorlevel 1 (\r
    echo   เปิดหน้าเว็บให้แล้ว — ติดตั้งเวอร์ชัน LTS แล้วรันไฟล์นี้อีกครั้ง\r
    start "" "https://nodejs.org/en/download"\r
    pause\r
    exit /b 1\r
  )\r
  echo   กำลังติดตั้ง Node.js LTS ด้วย winget ^(อาจมีหน้าต่างขออนุญาต ^)...\r
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements\r
  echo   เสร็จแล้ว — ปิดหน้าต่างนี้ เปิดใหม่ แล้วรันไฟล์นี้อีกครั้ง\r
  pause\r
  exit /b 1\r
)\r
\r
node setup-machine.mjs %*\r
set "RC=%errorlevel%"\r
echo.\r
if not "%RC%"=="0" (\r
  echo [ยังไม่สำเร็จ] อ่านข้อความด้านบนว่าติดตรงไหน แล้วรันใหม่ได้เลย\r
  pause\r
) else (\r
  echo ปิดหน้าต่างนี้ได้ — เครื่องจะรายงานตัวกับ HUB เองทุก 15 วินาที\r
  pause\r
)\r
endlocal\r
exit /b %RC%\r
