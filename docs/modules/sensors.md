# โมดูล sensors

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `sensors/sensor-data.routes.ts` (101 บรรทัด)
- `sensors/sensor.routes.ts` (128 บรรทัด)

### Endpoints (จาก router)
```
POST /data
GET /metrics
GET /all
DELETE /:metric
DELETE /:metric/all
GET /devices
POST /devices
DELETE /devices/:id
POST /generate-code
```

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- sensors → devices(devices)

<!-- auto:end -->
