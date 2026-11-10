# โมดูล backup

## เจตนา

สำรอง/กู้คืนฐานข้อมูล TimescaleDB และ state (`data/*.json`) เพื่อให้เป้าหมาย "ข้อมูลไม่หาย" ตรวจสอบได้จริง ไม่ใช่แค่มีโฟลเดอร์ backups อยู่

## ข้อห้าม / ระวัง

- **ห้ามเอา `.env` หรือไฟล์ที่มี secret เข้า state bundle** — `collectStateFiles` + `findSecretLeakFiles` เป็นเกราะ F1 (เคยรั่วไป offsite/Telegram ทุกคืน 27/9/69)
- **ห้ามลบ marker `last_backup_<วันที่>.marker`** — เป็นตัวกันการยิง backup ซ้ำในวันเดียว ไม่ใช่ไฟล์ขยะ
- **ความสดของ backup ต้องวัดจากไฟล์จริงเสมอ** (`GET /api/backup/status` → `computeBackupStatus`) — เกณฑ์เตือน 26 ชม. อยู่ที่ `BACKUP_STALE_AFTER_HOURS` ที่เดียว ห้ามคำนวณซ้ำใน UI
- backup ที่หยุดแล้วไม่มีใครรู้ = แย่กว่าไม่มี backup (เคสจริง 22–26/9 marker หยุดโดยไม่มีสัญญาณ) ⇒ การเปลี่ยน scheduler ต้องคง catch-up window และ marker ไว้
- `restore` มีผลกับทั้งฐานข้อมูล — SUPERADMIN เท่านั้น และ validate ชื่อไฟล์ผ่าน `isSafeBackupName` ก่อนแตะดิสก์/psql เสมอ
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

