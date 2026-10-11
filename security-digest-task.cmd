@echo off & chcp 65001 >nul & cd /d "%~dp0" & if not exist .freebuff mkdir .freebuff & node tools\verify\security-anomaly.mjs >> .freebuff\security-digest.log 2>&1
