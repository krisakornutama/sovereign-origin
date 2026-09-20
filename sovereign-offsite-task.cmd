@echo off
rem Sovereign Offsite Backup — dump สด + เข้ารหัส + ส่ง Telegram (03:30 ทุกวัน หลัง DB Backup 03:00)
cd /d "E:\My work\Project Sovereign Origin"
node tools\verify\offsite-push.mjs >> "E:\My work\Project Sovereign Origin\.freebuff\offsite-task.log" 2>&1
