# โมดูล actuation

## เจตนา

สั่งงานอุปกรณ์กายภาพ (relay/วาล์วน้ำ/ลิงก์เน็ต) ผ่าน Safety Envelope — AI/ระบบอัตโนมัติสั่งได้เฉพาะเมื่อผ่านกฎเหล็ก และมนุษย์ยังคุมได้เสมอ

## ข้อห้าม / ระวัง

- **`PhysicalSnapshot.occupied` ต้องแยก "ไม่รู้" (`null`) ออกจาก "ไม่มีคน" (`false`)** — presence ที่อ่านไม่ได้/ไม่มี sensor ต้องเป็น `null` เสมอ ห้ามยุบเป็น `false` เพราะกฎ `OCCUPANCY` จะยอมให้ AI/system ปิด `wan-link`/`water-valve` ทั้งที่อาจมีคนอยู่ (fail-open) · ใช้ `snapshotFromTelemetry()` แปลงแถว telemetry ที่เดียว อย่าเขียน mapping ซ้ำใน worker
- **ห้ามเปลี่ยน `snap.occupied !== false` กลับเป็น truthy check** — `null` ต้องถูกกันไว้ที่กฎ OCCUPANCY (non-human + desiredState `off` + กลุ่ม shutdown) · human สั่งปิดได้เสมอ และห้ามขยายผลไปบล็อก action ที่ไม่ใช่กลุ่ม shutdown
- `snapshotFromTelemetry` แปลงค่าที่อ่านไม่ได้ (null/`NaN`) เป็น `null` ไม่ใช่ `0` — ตัวเลข 0 ของแบต/กำลังไฟ/is-occupied มีความหมายจริงและต้องแยกออกจาก "ไม่มีข้อมูล"
- **`PUT /api/actuation/occupancy` ต้องมีผลกับการตัดสินจริง** (`occupiedOverride` ถูกทับ `snap.occupied` ก่อน `evaluateEnvelope` ใน `executeCommand`) — ห้ามกลับไปบันทึกค่าเฉย ๆ เพราะ UI/ผู้ใช้จะอ่านว่า "ตั้งสถานะแล้ว" ทั้งที่ AI ยังใช้ค่าจาก telemetry
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `actuation/actuation.routes.ts` (61 บรรทัด)

### Endpoints (จาก router)
```
GET /status
GET /rules
POST /execute
POST /sync-levers
PUT /mode
PUT /occupancy
POST /simulate-failure
```

<!-- auto:end -->

