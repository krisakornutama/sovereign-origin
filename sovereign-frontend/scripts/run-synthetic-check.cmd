@echo off
REM ── Synthetic Browser Check launcher (เครื่องนี้เท่านั้น — path บน E: ตามกฎ AGENTS.md ข้อ 7) ──
REM schtasks เรียกไฟล์นี้ทุก 5 นาที: task name "Sovereign Synthetic Browser Check"
REM สคริปต์เป้าหมาย default: http://localhost:3000/shop → รายงานเข้า http://localhost:3001
REM PLAYWRIGHT_BROWSERS_PATH บน E: — กันเครื่องมือ download browser ลง C: (กฎ ข้อ 7)
REM SYNTHETIC_ROUND_TOKEN — token เฉพาะเครื่อง (infra/.env, gitignored) ใช้ยืนยันกับ endpoint รายงานผลรอบ
set "PLAYWRIGHT_BROWSERS_PATH=E:\My work\Project Sovereign Origin\.playwright-browsers"
for /f "usebackq tokens=1,* delims==" %%A in ("E:\My work\Project Sovereign Origin\sovereign-os\infra\.env") do (
  if "%%A"=="SYNTHETIC_ROUND_TOKEN" set "SYNTHETIC_ROUND_TOKEN=%%B"
)
cd /d "E:\My work\Project Sovereign Origin\sovereign-frontend"
if not exist "..\sovereign-os\infra\logs" mkdir "..\sovereign-os\infra\logs"
"C:\Program Files\nodejs\node.exe" scripts\synthetic-browser-check.mjs >> "..\sovereign-os\infra\logs\synthetic-check.log" 2>&1
