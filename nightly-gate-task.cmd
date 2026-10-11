@echo off & chcp 65001 >nul & cd /d "%~dp0" & if not exist .freebuff mkdir .freebuff & node tools\verify\nightly-gate.mjs >> .freebuff\nightly-task.log 2>&1
