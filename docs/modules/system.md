# โมดูล system

## เจตนา
ห้องเครื่องของระบบ — สุขภาพบริการ (health), กระบวนการที่รันอยู่ (processes/kill), เครือข่ายออกภายนอก (wan: สถานะ, speedtest, รีบูต router, รหัสผ่านผู้ดูแล) และการเฝ้าดูฝั่ง client (client-monitor)

## ข้อห้าม / ระวัง
- **`processes/kill` และ `wan/reboot` เป็นการกระทำทำลายจริง** — ต้องยืนยันตัวตน/บทบาทสูงทุกครั้ง และห้ามเรียกจาก automation ที่ไม่มีคนกำกับ (เคสจริง: verify kill prod ทั้งที่ classify ผิด)
- `system_settings` เป็นตาราง **shared cross-cutting** — ห้ามย้ายเป็นของเฉพาะโมดูล
- หน้า `/system-health` และ truth-watchdog อ่านความจริงจากโมดูลนี้ — ห้ามแตะรูปแบบ `/api/health`/`/api/health/truth` โดยไม่อัปเดตผู้อ่านทั้งชุด
- การเปลี่ยนรหัสผ่าน router (`wan/admin-password`) ต้องมี audit และยืนยันซ้ำ
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `system/client-monitor.routes.ts` (56 บรรทัด)
- `system/system.routes.ts` (162 บรรทัด)

### Endpoints (จาก router)
```
POST /error
POST /synthetic-round
GET /healthz
GET /health
GET /processes
POST /processes/kill
GET /client-health
GET /wan
POST /wan/check
GET /wan/devices
POST /wan/speedtest
GET /wan/sim
PUT /wan/admin-password
POST /wan/reboot
```

<!-- auto:end -->
