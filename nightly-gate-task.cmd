@echo off
rem Sovereign Nightly Quality Gate — wrapper สำหรับ Task Scheduler (03:20 ทุกวัน)
rem รัน gate (verify + db-doctor) — ผ่าน = เงียบ, พัง = ส่ง Telegram + เขียน log
cd /d "%~dp0"
if not exist .freebuff mkdir .freebuff
node tools\verify\nightly-gate.mjs >> .freebuff\nightly-task.log 2>&1
