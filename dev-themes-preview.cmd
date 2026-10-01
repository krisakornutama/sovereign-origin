@echo off
rem Dev server โหมดชมธีม — ชี้ API ไปที่ mock (tools/mock-api-preview.mjs บน :3101)
rem env ตั้งในไฟล์นี้เอง เพื่อให้แน่ในว่า propagate ถึงลูกทุกตัวไม่ว่าจะ launch ยังไง
cd /d "E:\My work\Project Sovereign Origin\.freebuff\worktrees\26201e6b-f023-4119-9715-4a8b45522306\sovereign-frontend"
set NEXT_PUBLIC_API_URL=http://localhost:3101
set NEXT_PUBLIC_WS_URL=http://localhost:3101
node node_modules\next\dist\bin\next dev -p 3100 > "..\dev-3100.log" 2>&1
