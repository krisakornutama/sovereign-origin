# โมดูล coding

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`coding_jobs`

### Routes
- `coding/coding.routes.ts` (74 บรรทัด)
- `coding/skills.routes.ts` (65 บรรทัด)
- `coding/workspace.routes.ts` (64 บรรทัด)

### Endpoints (จาก router)
```
POST /jobs
GET /jobs
DELETE /jobs/:id
POST /jobs/:id/apply
POST /suggest
GET /skills
POST /skills
POST /skills/:id/run
POST /skills/run-queue
DELETE /skills/:id
GET /workspace
PUT /workspace
GET /files
GET /file
POST /terminal
```

### Services ที่ทำงานให้โมดูลนี้
`coding-agent.service`

<!-- auto:end -->
