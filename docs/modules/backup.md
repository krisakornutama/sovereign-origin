# โมดูล backup

## เจตนา

สำรอง/กู้คืนฐานข้อมูล TimescaleDB และ state (`data/*.json`) เพื่อให้เป้าหมาย "ข้อมูลไม่หาย" ตรวจสอบได้จริง ไม่ใช่แค่มีโฟลเดอร์ backups อยู่

## ข้อห้าม / ระวัง

- **ห้ามเอา `.env` หรือไฟล์ที่มี secret เข้า state bundle** — `collectStateFiles` + `findSecretLeakFiles` เป็นเกราะ F1 (เคยรั่วไป offsite/Telegram ทุกคืน 27/9/69)
- **ห้ามลบ marker `last_backup_<วันที่>.marker`** — เป็นตัวกันการยิง backup ซ้ำในวันเดียว ไม่ใช่ไฟล์ขยะ
- **ความสดของ backup ต้องวัดจากไฟล์จริงเสมอ** (`GET /api/backup/status` → `computeBackupStatus`) — เกณฑ์เตือน 26 ชม. อยู่ที่ `BACKUP_STALE_AFTER_HOURS` ที่เดียว ห้ามคำนวณซ้ำใน UI
- backup ที่หยุดแล้วไม่มีใครรู้ = แย่กว่าไม่มี backup (เคสจริง 22–26/9 marker หยุดโดยไม่มีสัญญาณ) ⇒ การเปลี่ยน scheduler ต้องคง catch-up window และ marker ไว้
- `restore` มีผลกับทั้งฐานข้อมูล — SUPERADMIN เท่านั้น และ validate ชื่อไฟล์ผ่าน `isSafeBackupName` ก่อนแตะดิสก์/psql เสมอ
- **`POST /api/backup/restore` ต้องมี `confirm` ที่ตรงกับชื่อไฟล์ทุกตัวอักษร** — การกู้คืนผิดไฟล์คือข้อมูลหายถาวรและย้อนไม่ได้ · `window.confirm` ฝั่ง UI เป็นแค่ความสะดวก (ยิง API ตรงได้เสมอ) ด่านจริงต้องอยู่ที่ server
  - สถานะต้องแยกให้ถูก: ชื่อไฟล์ผิดรูป/ไม่มี `confirm` = **400** · ไฟล์ไม่มีอยู่ = **404** · psql ล้ม = **500** (เดิม 500 ทั้งหมด ทำให้อ่านว่าเซิร์ฟเวอร์พังและเครื่องมือ retry ซ้ำ) — ใช้ `BackupRequestError(status)` จาก service
- **ทุกความพยายามกู้คืนต้องมีร่องรอยที่รอดจากการกู้คืน** — เขียน `restore-history.jsonl` ข้างไฟล์ backup (ผ่าน `appendRestoreJournal`) ไม่ใช่แค่ audit ใน DB เพราะการกู้คืนแทนที่ฐานข้อมูลทั้งก้อน: audit row ที่เพิ่งเขียนมีสิทธิ์ถูก dump รุ่นเก่าทับหาย · อ่านผ่าน `GET /api/backup/restore-history` (SUPERADMIN, ใหม่สุดก่อน, ≤ 50 รายการ, ข้ามบรรทัดที่เสียหาย)
  - `appendRestoreJournal` ต้อง **ไม่ throw** เด็ดขาด — เขียน log ไม่ได้ห้ามทำให้ผลลัพธ์ของ restore เปลี่ยน
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `backup/backup.routes.ts` (64 บรรทัด)

### Endpoints (จาก router)
```
GET /
POST /
POST /restore
POST /schedule
DELETE /:file
```

<!-- auto:end -->

