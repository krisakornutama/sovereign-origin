# โมดูล dashboard

## เจตนา
หน้าแรกหลังล็อกอิน — รวม metric ล่าสุดของโหนดผู้ใช้ (อ่าน `sensor_telemetry` ตัวล่าสุดต่อ metric ด้วย `DISTINCT ON`) และรายชื่อโมดูลที่เปิดใช้ (`/api/modules`) ให้ฝั่ง UI ใช้ซ่อน/แสดงเมนู

## ข้อห้าม / ระวัง
- **ห้ามสร้างข้อมูลปลอมเด็ดขาด** — เมื่อดึง metric ไม่ได้ต้องตอบ error แล้วให้ UI โชว์ "ไม่มีข้อมูล" (โค้ดเดิม comment ไว้ชัด: Never return fabricated data)
- โมดูลนี้เป็น **read-only** — ห้ามเพิ่ม endpoint เขียนข้อมูลมาที่นี่ (การเขียนเป็นของ sensors/โมดูลเจ้าของข้อมูล)
- การ query `sensor_telemetry` ต้องกรองด้วย `node_id` ของผู้ใช้เสมอ — ห้ามเปิดข้อมูลข้ามโหนด
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `dashboard/dashboard.routes.ts` (46 บรรทัด)

### Endpoints (จาก router)
```
GET /modules
GET /dashboard/stats
```

<!-- auto:end -->
