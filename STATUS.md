# STATUS — ระบบกำลังทำอะไร

> อัปเดตอัตโนมัติทุกครั้งที่เริ่ม/จบงาน — ผู้ใช้ดูไฟล์นี้แทนการเดา

- **สถานะ:** ✅ เสร็จแล้ว
- **งาน:** Desktop app (Sovereign OS.exe) แก้ให้ใช้งานได้ + รวมกับเว็บ dashboard
- **สาขา:** freebuff/task-26201e6b (merge master 3c25866e แล้ว)
- **ล่าสุด:** 2026-09-09 — desktop shell v1.1.0
  - **สาเหตุที่พังเดิม:** exe เดิมเป็น portable build ที่ฝัง app.asar (224MB เวอร์ชันเก่า) ไว้ในตัว exe — ไฟล์ `resources/app.asar` (377MB) ข้าง exe ไม่เคยถูกอ่าน และ `resources/core-api/` มีแค่ package.json+prisma ไม่มี dist/node_modules → sidecar สตาร์ทไม่ได้ → จอดำ
  - **วิธีแก้:** สร้าง `dist-portable/` ใหม่ = Electron runtime + `resources/app/` (โฟลเดอร์ app แทน asar → แก้โค้ดได้ทันทีไม่ต้อง repack) — shell v1.1.0 โหลดแบบ tiered: Dashboard :3000 → Launcher :4100 → หน้า Offline ในตัว (มีปุ่ม 🚀 เริ่มระบบทั้งหมด + สถานะ live ทุก 3 วิ + เด้งเข้า Dashboard เองเมื่อระบบขึ้น)
  - **ทดสอบแล้ว:** เปิด exe → log `boot: {frontend:true, launcher:true, api:true}` → เข้า Dashboard ทันที (window "Sovereign OS" ขึ้นจริง)
  - exe + asar เดิม backup ไว้ที่ `dist-portable/_backup/`
- **วิธีใช้:** ดับเบิลคลิก `dist-portable\Sovereign OS.exe` — ถ้าระบบรันอยู่จะเข้า Dashboard เลย ถ้าไม่รันจะขึ้นหน้า offline พร้อมปุ่มเริ่มระบบ
