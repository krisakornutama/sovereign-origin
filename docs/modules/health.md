# โมดูล health

## เจตนา

บันทึกอาการ/โรคประจำตัว/ยาที่ใช้ของผู้ใช้เอง แล้วสรุปเป็น flag ที่ควรติดตาม พร้อมคำแนะนำสมุนไพรที่มีการตรวจข้อห้าม — ข้อมูลสุขภาพเป็นข้อมูลอ่อนไหวที่สุดในระบบ จึงต้องมีความยินยอมชัดเจนก่อนบันทึกทุกครั้ง

## ข้อห้าม / ระวัง

- **การเขียนข้อมูลสุขภาพทุกเส้นต้องผ่านด่านความยินยอม** (`healthConsentGate` = `requireConsent('health')` + สวิตช์เดิม `health_consents.conversation`) — เพิ่ม route เขียนใหม่แล้วลืมใส่ด่าน = เก็บข้อมูลโดยไม่มีฐานกฎหมาย
- ด่านอ่าน `user_consents` (PDPA) เป็นแหล่งความจริงเดียว · `health_consents` เป็นเพียงสวิตช์ของโมดูลนี้ที่ต้อง **สะท้อน** ค่าเดียวกัน (GET/PUT ผูกกันแล้ว) ห้ามให้สองที่ขัดกัน
- `consent_version_stale` = ผู้ใช้ยังไม่ยอมรับนโยบายฉบับใหม่ → ต้องให้ยอมรับใหม่ ไม่ใช่ปล่อยผ่าน
- อ่าน/ลบข้อมูลของผู้ใช้เองไม่ถูกกั้นด้วยด่านนี้ (สิทธิ์ของเจ้าของข้อมูล) — อย่าใส่ด่านจนผู้ใช้ลบข้อมูลตัวเองไม่ได้
- ค่าเริ่มต้นคือ **ไม่ยินยอม** (ไม่มีแถว = ปฏิเสธ) ห้ามเปลี่ยนเป็นยินยอมโดยปริยาย
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`health_consents` · `health_flags` · `health_observations` · `health_profiles` · `health_readings`

### Routes
- `health/health-readings.routes.ts` (99 บรรทัด)
- `health/health.routes.ts` (505 บรรทัด)

### Endpoints (จาก router)
```
GET /
POST /
DELETE /:id
GET /overview
POST /observations
GET /observations
DELETE /observations/:id
GET /flags
POST /flags
POST /flags/:id/clear
POST /flags/:id/address
GET /consents
PUT /consents
GET /profile
PUT /profile
GET /herbal-recommendations
GET /export
```

### Services ที่ทำงานให้โมดูลนี้
`health-readings.service`

<!-- auto:end -->

