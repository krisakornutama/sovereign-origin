@echo off
rem Sovereign Visitor Digest — wrapper สำหรับ Task Scheduler (08:00 ทุกวันจันทร์)
rem สรุปพฤติกรรมผู้เยี่ยมชม 7 วัน + ความต้องการใหม่ → Telegram · log สะสมที่ .freebuff\visitor-digest.log
cd /d "%~dp0"
if not exist .freebuff mkdir .freebuff
node tools\verify\visitor-digest.mjs >> .freebuff\visitor-digest.log 2>&1
