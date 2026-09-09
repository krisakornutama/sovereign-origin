# STATUS — ระบบกำลังทำอะไร

> อัปเดตอัตโนมัติทุกครั้งที่เริ่ม/จบงาน — ผู้ใช้ดูไฟล์นี้แทนการเดา

- **สถานะ:** ✅ เสร็จแล้ว
- **งาน:** Desktop app แบบ one-click — เปิดโปรแกรมเดียว กดครั้งเดียว ใช้งานได้เลย
- **สาขา:** freebuff/task-26201e6b (merge master 3c25866e แล้ว)
- **ล่าสุด:** 2026-09-09 — desktop shell v1.2.0 (auto-start) + แก้ shortcut/ปัญหา "เทอร์มินัลแป๊บเดียวแล้วหาย"
  - **สาเหตุที่กดแล้วไม่เข้า:** shortcut เดสก์ท็อปชี้ไป `E:\New folder\Sovereign OS\` ที่ถูกย้าย/ลบไปแล้ว + exe ใน MAIN เป็น portable build เก่า (asar ฝังในตัว) ที่เข้าเปล่า และ `start-sovereign.bat` ใน MAIN เป็น LF line endings ทำให้ cmd รันแล้วพังทันที (อาการหน้าต่างแวบเดียว)
  - **วิธีแก้:** (1) shell v1.2.0 — เปิดแอปตอนระบบดับ → เริ่มระบบให้เองอัตโนมัติ (เปิด Docker Desktop ให้ถ้ายังไม่เปิด รอ engine ได้ถึง 3 นาที แล้ว spawn bat แบบ `cmd /d /c call <full-path>` ผ่าน args array + windowsHide — กันบั๊ก cmd start + quote กับ path มีเว้นวรรค และไม่มีเทอร์มินัลแวบ) (2) ติดตั้ง app ที่ stable home: `C:\Users\com\Sovereign OS` (junction → MAIN dist-portable, runtime 44.1.0 แบบ patchable + overlay) (3) shortcut บนเดสก์ท็อปชี้มาที่นี่แล้ว (4) แก้ MAIN bat เป็น CRLF + ROOT guard
  - **ทดสอบแล้ว (E2E จริง):** ปิด frontend+launcher ทิ้ง → เปิดแอปผ่าน shortcut path → log แสดง autostart → 15 วิต่อมา frontend ขึ้น → shell เด้งเข้า `http://localhost:3000/` เองโดยไม่ต้องกดอะไรเลย
  - **ต่อยอดรอบสาม — พิสูจน์ cold start จริง (Docker ปิดสนิท):** เปิดแอปตอน engine ดับ → เปิด Docker Desktop เอง → engine settled (เช็คซ้ำหลังพัก 6 วิ กัน pipe ขึ้นแต่ engine ยัง init) → compose มี retry 3 ครั้งใน bat → dashboard 200 ที่ ~86 วิ ไม่กดสักครั้ง + ขยาย backend timeout 90→240 วิ
  - **ต่อยอดรอบสอง (เย็นวันเดียวกัน) — แก้อาการ "ยังรอ Frontend... ไม่จบ":** สาเหตุคือ bat เช็คแค่ "พอร์ต 3000 มีคนฟัง" แต่ frontend ค้าง (listen แต่ไม่ตอบ) ก็เลยข้ามไปแล้วรอไม่จบ + เกิดหน้าต่าง Sovereign-Frontend ค้างหลายบาน  ตอนนี้ stage-2 เช็คด้วย HTTP จริง ถ้าไม่ตอบจะ taskkill /T ล้างทรีค้างแล้ว start ใหม่เอง  แก้บั๊ก cmd เพิ่ม: :: comment ที่มีวงเล็บใน else block ทำให้ bat ทั้งไฟล์ parse พัง ("— was unexpected")  และ shell เริ่มระบบให้เองได้จากทุก tier แล้ว (launcher tier รอแค่ 30 วิ, watcher รอ recovery ได้ถึง 10 นาที)  พิสูจน์แล้ว: frontend ค้าง → bat ล้าง+restart → "System ready 20 วินาที" → เข้า dashboard
  - **วิธีใช้ตอนนี้:** ดับเบิลคลิก **Sovereign OS** บนเดสก์ท็อป — ถ้าระบบรันอยู่เข้า Dashboard เลย ถ้าดับจะเริ่มระบบให้เองแล้วพาเข้าเอง (รอ 1–2 นาที ถ้า Docker ปิดอยู่จะเปิดให้)
- **ก่อนหน้า:** 2026-09-09 — แก้ DB หาย (incident): start-sovereign.bat ที่รันจาก worktree ระหว่างทดสอบ desktop ไป recreate stack ทำให้ PGDATA bind ชี้ไปที่ data/pg ของ worktree (ว่าง) → ตาราง users หาย
  - **วิธีแก้:** down stack จาก worktree → up ใหม่จาก MAIN (`E:/My work/Project Sovereign Origin/sovereign-os/infra`) ซึ่ง bind ไปที่ data/pg ตัวจริง (105MB, มี 8 users) — login กลับมาปกติ, ข้อมูลไม่หายเพราะเป็นแค่จุด mount ผิด ไม่ใช่ data loss
  - **ข้อควรระวัง:** start-sovereign.bat ถูกแก้ให้ชี้ ROOT ไปที่ MAIN เสมอ (เครื่องนี้) — รันจากไหนก็ปลอดภัยแล้ว
- **ก่อนหน้าอีกที:** 2026-09-09 — desktop shell v1.1.0
  - **สาเหตุที่พังเดิม:** exe เดิมเป็น portable build ที่ฝัง app.asar (224MB เวอร์ชันเก่า) ไว้ในตัว exe — ไฟล์ `resources/app.asar` (377MB) ข้าง exe ไม่เคยถูกอ่าน และ `resources/core-api/` มีแค่ package.json+prisma ไม่มี dist/node_modules → sidecar สตาร์ทไม่ได้ → จอดำ
  - **วิธีแก้:** สร้าง `dist-portable/` ใหม่ = Electron runtime + `resources/app/` (โฟลเดอร์ app แทน asar → แก้โค้ดได้ทันทีไม่ต้อง repack) — shell v1.1.0 โหลดแบบ tiered: Dashboard :3000 → Launcher :4100 → หน้า Offline ในตัว (มีปุ่ม 🚀 เริ่มระบบทั้งหมด + สถานะ live ทุก 3 วิ + เด้งเข้า Dashboard เองเมื่อระบบขึ้น)
  - **ทดสอบแล้ว:** เปิด exe → log `boot: {frontend:true, launcher:true, api:true}` → เข้า Dashboard ทันที (window "Sovereign OS" ขึ้นจริง)
  - exe + asar เดิม backup ไว้ที่ `dist-portable/_backup/`
- **วิธีใช้:** ดับเบิลคลิก **Sovereign OS** บนเดสก์ท็อป (หรือ `dist-portable\Sovereign OS.exe`) — ระบบดับจะเริ่มให้เองแล้วพาเข้า Dashboard
