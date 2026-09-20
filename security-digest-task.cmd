@echo off
rem Sovereign Security Digest — wrapper สำหรับ Task Scheduler (08:00 ทุกวัน)
rem สรุป anomaly จาก audit_logs 24 ชม. — ไม่พบ = เงียบ · พบ = ส่ง Telegram · log สะสมที่ .freebuff\security-digest.log
cd /d "%~dp0"
if not exist .freebuff mkdir .freebuff
node tools\verify\security-anomaly.mjs >> .freebuff\security-digest.log 2>&1
