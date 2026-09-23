# โมดูล trace — ตามรอยผลผลิต (traceability)

## เจตนา
ผู้บริโภคสแกน QR บนสินค้าแล้วเห็นที่มาของล็อตผลผลิตครบวงจร — จากแปลง → เก็บเกี่ยว → แปรรูป → ถึงมือ — โดยไม่ต้องล็อกอิน (public rate-limited)

## ตารางที่เป็นเจ้าของ
- `product_lots` — ล็อตผลผลิต (lotCode, สถานะ, ผูกลูกค้าเมื่อขาย)
- `trace_events` — เหตุการณ์ตามรอยของแต่ละล็อต (timeline)

## Endpoints (mounted ที่ `/api/trace`)
- Public (ไม่ต้อง login): `GET /:lotCode` · `GET /:lotCode/qr`
- Login (หน้า /trace): `GET /` · `GET /:lotCode/events` · `POST /:lotCode/events`

## กลไกสำคัญ
- lotCode ใช้ alphabet `[A-Z2-9]` (ตัด 0/1 กันอ่านผิด) — seed ต้องเลือกรหัสที่ผ่าน validation
- Rate limit public 60/min, write 20/min
- Service: `trace.service.ts` (getPublicTrace รวมข้อมูลแปลงต้นทางผ่าน farm)
- E2E: `sovereign-frontend/e2e/trace-community.spec.ts` ครอบ flow ค้นล็อต → ไทม์ไลน์

## ห้ามแตะ / ระวัง
- รูปแบบ response ของ `GET /:lotCode` (public) = สัญญากับ QR ที่พิมพ์บนสินค้าจริง — เปลี่ยนได้แต่ต้องคิด backward-compat
- เหตุการณ์ append-only: ห้ามแก้/ลบ trace_events ย้อนหลังโดยไม่มี audit เหตุผล
