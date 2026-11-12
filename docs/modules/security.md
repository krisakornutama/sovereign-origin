# โมดูล security

## เจตนา
ศูนย์กลางความปลอดภัยเครือข่าย — ไฟร์วอลล์ (block/unblock, rules), ข่าวกรองภัยคุกคาม (threat intel + ตรวจ DNS), และเหตุการณ์ความปลอดภัยทั้งระบบ

## ข้อห้าม / ระวัง
- **การ block/unblock ไฟร์วอลล์มีผลต่อเครือข่ายจริงทันที** — ห้ามเรียกจาก automation โดยไม่มีคนยืนยัน และห้าม block IP/subnet ที่ระบบใช้เอง (gateway, DB, ตัว API เอง)
- `security_events` เป็นตาราง **shared cross-cutting** (ทุกโมดูลเขียนได้) — ห้ามย้ายไปเป็นของเฉพาะโมดูล
- กติกาไฟร์วอลล์ (`firewall_rules`) ต้องเก็บลำดับ (order/priority) ให้ถูกต้อง — ลำดับผิด = กฎตีความผิดทั้งชุด
- แหล่ง intel ภายนอกอัปเดตได้เอง (`update-feeds`) — ห้ามเชื่อเนื้อหา feed โดยไม่ validate
- **ห้ามคืนข้อมูลจำลองใน endpoint ที่ใช้ตัดสินใจด้านความปลอดภัย** — `GET /connections` เดิมส่ง 2 แถวปลอมเมื่อเรียก netstat ไม่ได้ (หน้าความปลอดภัยจึงโชว์ "การเชื่อมต่อ" ที่ไม่มีจริง) ตอนนี้อ่านไม่ได้ = `connections: []` + `degraded: true` + `reason` และ UI ต้องแสดงสถานะนั้น (ตัวเลข "ไม่ทราบ" ไม่ใช่ 0)
  - `host-connections.service.ts` เป็นเจ้าของการอ่าน netstat — ต้อง `throw` เมื่อคำสั่งใช้ไม่ได้ ให้ route เป็นคนตัดสินใจ ห้ามกลืน error แล้วแต่งข้อมูล
  - UI ต้องรองรับทั้ง `{connections, degraded}` (ใหม่) และ array ล้วน (mock/preview เก่า)
- **`security_events` เป็นหลักฐาน ไม่ใช่กล่องข้อความ** — `POST /events` จำกัดที่ `EVENT_WRITE_ROLES` (`SUPERADMIN`/`NODE_ADMIN`/`SITE_ADMIN`/`OPERATOR`) เพราะ log ที่ใครก็เขียนได้ (รวม KID/SYSTEM_AI) = หลักฐานที่ปลอมได้ และถล่ม 50 แถวล่าสุดจนของจริงหลุดจากสายตา
  - ตรวจก่อนเก็บ: `event_type` = `[A-Za-z0-9_]{2,40}` (normalize เป็นตัวใหญ่) · `severity` ∈ {info, warning, critical} (ตัวเล็ก) · `description` ไม่ว่างและ ≤ 500 · IP ≤ 45 ตัวอักษรและเป็น hex/`.`/`:` เท่านั้น · `raw_data` ต้องเป็น object
  - `GET /events` คืน `{ events, degraded, reason }`: อ่าน DB ไม่ได้ = `degraded: true` (การ์ดขึ้น "ไม่ทราบ" ไม่ใช่ 0) — ห้ามกลับไปตอบ `[]` เปล่า ๆ
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`firewall_config` · `firewall_rules` · `threat_intel_items`

### Routes
- `security/nextgen.routes.ts` (384 บรรทัด)
- `security/security.routes.ts` (315 บรรทัด)

### Endpoints (จาก router)
```
GET /status
GET /intel
GET /intel/stats
POST /intel
PUT /intel/:id/toggle
DELETE /intel/:id
POST /intel/update-feeds
POST /intel/check
GET /dns/stats
GET /dns/top-blocked
GET /dns/clients
GET /dns/queries
POST /dns/block
POST /dns/allow
GET /ids/alerts
GET /av/status
POST /av/scan
GET /apps
PUT /apps/:id
PUT /apps/category/:category
POST /apps/custom
DELETE /apps/custom
GET /apps/blocklist
POST /apps/sync-pihole
GET /network/devices
GET /ai/last
POST /ai/analyze
GET /kill-switch
PUT /kill-switch
GET /first-responder
PUT /first-responder
GET /reality
POST /reality/correct
GET /drill
POST /drill
GET /time-consensus
POST /time-consensus/check
GET /connections
GET /firewall
GET /firewall/blocks
… อีก 15 เส้น
```

### Services ที่ทำงานให้โมดูลนี้
`firewall-engine.service` · `hash-engine.service` · `ids-reader.service` · `threat-detection.service` · `threat-intel.service`

<!-- auto:end -->

