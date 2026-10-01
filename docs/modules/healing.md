# โมดูล healing

## เจตนา
โหมดสุขภาพใจ — companion ที่คุยกับผู้ใช้ (ปรับโทนตามผล MBTI จากหน้า /mbti), ติดตามอารมณ์/พฤติกรรมการดูแลตัวเอง และเชื่อมกับ crisis หากสัญญาณเสี่ยง

## ข้อห้าม / ระวัง
- เนื้อหาการสนทนา = **ข้อมูลส่วนบุคคลอ่อนไหว** — ห้ามส่งต่อ/บันทึกเกินความจำเป็น และห้ามให้โมดูลอื่นอ่านข้ามสิทธิ์
- `/api/healing/companion` รับผล MBTI เป็น input เพื่อ UX — **ห้ามใช้ผล MBTI ตัดสินสิทธิ์/ระบบ** (เป็นข้อมูลเพื่อการสนทนา ไม่ใช่ authorization)
- สัญญาณเสี่ยงที่พบต้องไปที่โมดูล crisis ตามธรรมเนียม — ห้ามจัดการเงียบ ๆ ในโมดูลนี้
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`buddhist_teachings` · `healing_logs` · `meditation_sessions`

### Routes
- `healing/healing.routes.ts` (150 บรรทัด)

### Endpoints (จาก router)
```
GET /teachings
POST /companion
GET /herbs
GET /herbs-unified
POST /herbs/check
POST /meditation
POST /log
GET /progress
```

### Services ที่ทำงานให้โมดูลนี้
`buddhist-healing.service`

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`buddhist_teachings` · `healing_logs` · `meditation_sessions`

### Routes
- `healing/healing.routes.ts` (150 บรรทัด)

### Endpoints (จาก router)
```
GET /teachings
POST /companion
GET /herbs
GET /herbs-unified
POST /herbs/check
POST /meditation
POST /log
GET /progress
```

### Services ที่ทำงานให้โมดูลนี้
`buddhist-healing.service`

<!-- auto:end -->
