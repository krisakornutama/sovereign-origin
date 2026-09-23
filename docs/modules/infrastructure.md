# โมดูล infrastructure

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`cameras` · `detection_events` · `equipment` · `radio_messages` · `run_hours_logs` · `water_quality_readings`

### Routes
- `infrastructure/infrastructure.routes.ts` (351 บรรทัด)

### Endpoints (จาก router)
```
GET /cameras
POST /cameras
PUT /cameras/:id
DELETE /cameras/:id
GET /detections
POST /detections
GET /water
POST /water
GET /radio
POST /radio
GET /equipment
POST /equipment
POST /equipment/:id/run-hours
POST /equipment/:id/service
DELETE /equipment/:id
GET /overview
```

<!-- auto:end -->
