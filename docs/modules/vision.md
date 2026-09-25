# โมดูล vision

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`known_faces` · `vision_alerts` · `vision_rules`

### Routes
- `vision/vision-rule.routes.ts` (112 บรรทัด)
- `vision/vision.routes.ts` (93 บรรทัด)

### Endpoints (จาก router)
```
GET /known-faces
POST /known-faces
DELETE /known-faces/:id
GET /rule
PUT /rule
POST /check
GET /alerts
GET /honeypot
POST /alerts/:id/clear
POST /analyze
POST /analyze-url
GET /history
```

### Services ที่ทำงานให้โมดูลนี้
`vision-rule.service` · `vision.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- vision → infrastructure(cameras)
- vision → infrastructure(detection_events)

<!-- auto:end -->
