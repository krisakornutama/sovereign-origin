# โมดูล livestock

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`livestock_batch_financials` · `livestock_biosecurity_logs` · `livestock_breeding_records` · `livestock_climate_logs` · `livestock_daily_logs` · `livestock_feed_silos` · `livestock_groups` · `livestock_medical_records` · `livestock_utility_alerts` · `livestock_vaccine_schedules` · `livestock_vision_reports`

### Routes
- `livestock/livestock-batches.routes.ts` (86 บรรทัด)
- `livestock/livestock-biosecurity.routes.ts` (73 บรรทัด)
- `livestock/livestock-breeding.routes.ts` (64 บรรทัด)
- `livestock/livestock-climate.routes.ts` (143 บรรทัด)
- `livestock/livestock-dashboard.routes.ts` (78 บรรทัด)
- `livestock/livestock-groups.routes.ts` (140 บรรทัด)
- `livestock/livestock-medical.routes.ts` (137 บรรทัด)
- `livestock/livestock-production.routes.ts` (315 บรรทัด)
- `livestock/livestock-vision.routes.ts` (70 บรรทัด)
- `livestock/livestock.routes.ts` (38 บรรทัด)

### Endpoints (จาก router)
```
POST /batches
PATCH /batches/:id
GET /batches
POST /biosecurity
GET /biosecurity
POST /biosecurity/:id/exit
POST /groups/:id/breeding
PATCH /breeding/:id
POST /climate
GET /climate
POST /utility
GET /dashboard
GET /groups
POST /groups
PATCH /groups/:id
DELETE /groups/:id
GET /groups/:id
POST /groups/:id/medical
POST /groups/:id/vaccines
PATCH /vaccines/:id
GET /silos
POST /silos
PATCH /silos/:id/refill
POST /groups/:id/daily-logs
GET /groups/:id/metrics
POST /groups/:id/vision
GET /groups/:id/vision
```

### Services ที่ทำงานให้โมดูลนี้
`livestock-cron.service` · `livestock-vet-ai.service`

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`livestock_batch_financials` · `livestock_biosecurity_logs` · `livestock_breeding_records` · `livestock_climate_logs` · `livestock_daily_logs` · `livestock_feed_silos` · `livestock_groups` · `livestock_medical_records` · `livestock_utility_alerts` · `livestock_vaccine_schedules` · `livestock_vision_reports`

### Routes
- `livestock/livestock-batches.routes.ts` (86 บรรทัด)
- `livestock/livestock-biosecurity.routes.ts` (73 บรรทัด)
- `livestock/livestock-breeding.routes.ts` (64 บรรทัด)
- `livestock/livestock-climate.routes.ts` (143 บรรทัด)
- `livestock/livestock-dashboard.routes.ts` (78 บรรทัด)
- `livestock/livestock-groups.routes.ts` (140 บรรทัด)
- `livestock/livestock-medical.routes.ts` (137 บรรทัด)
- `livestock/livestock-production.routes.ts` (315 บรรทัด)
- `livestock/livestock-vision.routes.ts` (70 บรรทัด)
- `livestock/livestock.routes.ts` (38 บรรทัด)

### Endpoints (จาก router)
```
POST /batches
PATCH /batches/:id
GET /batches
POST /biosecurity
GET /biosecurity
POST /biosecurity/:id/exit
POST /groups/:id/breeding
PATCH /breeding/:id
POST /climate
GET /climate
POST /utility
GET /dashboard
GET /groups
POST /groups
PATCH /groups/:id
DELETE /groups/:id
GET /groups/:id
POST /groups/:id/medical
POST /groups/:id/vaccines
PATCH /vaccines/:id
GET /silos
POST /silos
PATCH /silos/:id/refill
POST /groups/:id/daily-logs
GET /groups/:id/metrics
POST /groups/:id/vision
GET /groups/:id/vision
```

### Services ที่ทำงานให้โมดูลนี้
`livestock-cron.service` · `livestock-vet-ai.service`

<!-- auto:end -->
