# โมดูล timescale

## เจตนา

อ่านข้อมูลย้อนหลังจาก `sensor_telemetry` (TimescaleDB) แบบกลุ่มเวลา (bucket) ให้หน้า `/history`, `/energy` และ trend ใน dashboard

## ข้อห้าม / ระวัง

- **อ่าน DB ไม่ได้ = 500 + เหตุผล ห้ามตอบ `200 []` หรือ `500 []`** — `GET /metrics` เดิม `catch { res.json([]) }` (200) ทำให้หน้า `/history` ขึ้น "ยังไม่มีข้อมูลเซ็นเซอร์ในฐานข้อมูล" ทั้งที่ความจริงคืออ่านไม่ได้ · `GET /history` เดิม `500 []` ก็ทำให้ผู้เรียกที่อ่าน body ก่อน status เข้าใจว่า "ไม่มีข้อมูลในช่วงนี้"
  - `/metrics` success = `{ metrics, degraded: false }` (รูปแบบเดียวกับ `GET /api/sensors/metrics`), failure = **500** `{ error, metrics: [], degraded: true, detail }`
  - `/history` success = **array ตรง ๆ ตามเดิม** (dashboard/energy/history อ่านเป็น array — เปลี่ยนรูปเมื่อไรต้องแก้ทั้งสามที่พร้อมกัน), failure = **500** `{ error, buckets: [], detail }`
  - ชื่อ metric ที่ null/ว่างถูกกรองออกจาก `/metrics` — เอาไป query ต่อไม่ได้ และทำให้หน้าเว็บได้กราฟเปล่าที่ไม่มีสาเหตุ
- **`GET /history` ต้องมีเพดานจำนวนจุด (`MAX_HISTORY_BUCKETS` = 20,000)** — query เป็น `GROUP BY time_bucket(...)` ไม่มี `LIMIT` ⇒ จำนวนแถว = ช่วงวันที่ ÷ interval (1 ปีที่ 5 นาที ≈ 105,000 จุด) การส่ง `from`/`to` กว้าง ๆ จึงทำให้ API/DB ล้มได้ด้วยคำขอเดียว
  - เกินเพดาน = **400 พร้อมบอกทางแก้** (interval ใหญ่ขึ้น หรือแคบช่วง) ห้ามตัดเงียบแล้วคืนกราฟที่ดูเหมือนครบ
  - `from`/`to` ที่อ่านเป็นวันที่ไม่ได้, `to < from`, หรือส่ง `to` โดยไม่มี `from` = 400 ก่อนแตะ DB (เดิมปล่อยให้ Postgres โยนแล้ว `catch` ตอบ `[]` — อ่านว่า "ไม่มีข้อมูล")
  - UI `/history` ต้องแสดงข้อความ error จาก server ไม่ใช่ `HTTP 400`
- UI `/history` แสดงแบนเนอร์ amber เมื่อ `metrics` อ่านไม่สำเร็จ และต้องไม่ขึ้น "ยังไม่มีข้อมูล" พร้อมกัน (สถานะ "ไม่ทราบ" ≠ "ไม่มีข้อมูล")
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `timescale/timescale.routes.ts` (79 บรรทัด)

### Endpoints (จาก router)
```
GET /history
GET /metrics
```

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- timescale → sensors(sensor_telemetry)

<!-- auto:end -->

