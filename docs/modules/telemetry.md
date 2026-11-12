# โมดูล telemetry

## เจตนา

ให้หน้าเว็บ/โมดูลอื่นอ่านค่าล่าสุดของ metric หลัก (battery_soc, water_level_cm, power_kw, voltage) ต่อ node — ประวัติย้อนหลังเป็นของ `timescale` ไม่ใช่ที่นี่

## ข้อห้าม / ระวัง

- **ห้ามตอบ `[]` (หรือ `200` ว่าง) จาก endpoint ที่ยังไม่ได้ทำ** — `GET /history` เคยทำแบบนั้นและผู้เรียกอ่านว่า "ไม่มีข้อมูล" ทั้งที่ไม่เคยมีข้อมูล ⇒ ตอนนี้ตอบ **501** พร้อมชี้ไป `GET /api/timescale/history` (ตัวจริง มีเพดานจำนวนจุดแล้ว)
- `GET /latest` ต้องมี `try/catch` ในตัว handler — Express 4 ไม่ดัก async throw: DB ล่มแล้วปล่อยให้โยน = คำขอค้างจน client timeout ไม่ใช่ 500
- ค่าที่ไม่มีข้อมูลต้องเป็น `null` ไม่ใช่ `0` — 0 คือค่าที่วัดได้จริงและผู้ใช้อ่านผิดความหมายทันที
- `NODE_ADMIN` ต้องถูกบังคับให้เห็นเฉพาะ node ที่ผูกไว้ (ตรวจ `?node_id=` ก่อนแตะ DB)
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `telemetry/telemetry.routes.ts` (52 บรรทัด)

### Endpoints (จาก router)
```
GET /latest
GET /history
```

<!-- auto:end -->

