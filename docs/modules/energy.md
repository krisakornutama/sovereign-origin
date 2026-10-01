# โมดูล energy — พลังงาน/มิเตอร์/เกณฑ์เตือน

## เจตนา
บันทึกการใช้ไฟ ตั้งเกณฑ์เตือน และรายงานสรุป — migration `add_energy_full` (23 ก.ย.) คือโครงชุดเต็ม

## ตารางที่เป็นเจ้าของ
- `energy_readings` — ค่ามิเตอร์ตามเวลา (Timescale hypertable)
- `energy_thresholds` — เกณฑ์เตือนต่อจุดวัด

## Endpoints (mounted ที่ `/api/energy`)
- `GET /summary` · `POST|GET /readings`
- เกณฑ์: `GET|POST /thresholds` · `PATCH|DELETE /thresholds/:id` · `POST /check`

## กลไกสำคัญ
- ⚠️ เคสจริง 23-09: migration `add_energy_full` ถูกเขียนไว้ใน repo แต่ไม่เคยลง prod — ตารางหายจนวันนั้น ปัจจุบัน `prisma migrate status` สะอาดแล้ว
- Service: `energy.service.ts`

## ห้ามแตะ / ระวัง
- การอ่านมิเตอร์เป็นข้อมูล append-only — ห้ามแก้ค่าย้อนหลัง ให้เพิ่ม reading ใหม่แทน

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`energy_readings` · `energy_thresholds`

### Routes
- `energy/energy.routes.ts` (169 บรรทัด)

### Endpoints (จาก router)
```
GET /summary
POST /readings
GET /readings
GET /thresholds
POST /thresholds
PATCH /thresholds/:id
DELETE /thresholds/:id
POST /check
```

### Services ที่ทำงานให้โมดูลนี้
`energy.service`

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`energy_readings` · `energy_thresholds`

### Routes
- `energy/energy.routes.ts` (169 บรรทัด)

### Endpoints (จาก router)
```
GET /summary
POST /readings
GET /readings
GET /thresholds
POST /thresholds
PATCH /thresholds/:id
DELETE /thresholds/:id
POST /check
```

### Services ที่ทำงานให้โมดูลนี้
`energy.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- energy → sensors(sensor_telemetry)

<!-- auto:end -->
