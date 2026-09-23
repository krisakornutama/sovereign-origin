# โมดูล automation

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`automation_alerts` · `automation_rules`

### Routes
- `automation/alerts.routes.ts` (38 บรรทัด)
- `automation/automation.routes.ts` (125 บรรทัด)

### Endpoints (จาก router)
```
GET /alerts
GET /rules
POST /rules
PUT /rules/:id
POST /rules/:id/toggle
DELETE /rules/:id
POST /check
GET /alerts/stream
```

### Services ที่ทำงานให้โมดูลนี้
`automation.service` · `mqttIngest`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- automation → devices(devices)

<!-- auto:end -->
