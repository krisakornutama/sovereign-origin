# โมดูล timescale

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_

- **`GET /history` ต้องมีเพดานจำนวนจุด (`MAX_HISTORY_BUCKETS` = 20,000)** — query เป็น `GROUP BY time_bucket(...)` ไม่มี `LIMIT` ⇒ จำนวนแถว = ช่วงวันที่ ÷ interval (1 ปีที่ 5 นาที ≈ 105,000 จุด) การส่ง `from`/`to` กว้าง ๆ จึงทำให้ API/DB ล้มได้ด้วยคำขอเดียว
  - เกินเพดาน = **400 พร้อมบอกทางแก้** (interval ใหญ่ขึ้น หรือแคบช่วง) ห้ามตัดเงียบแล้วคืนกราฟที่ดูเหมือนครบ
  - `from`/`to` ที่อ่านเป็นวันที่ไม่ได้, `to < from`, หรือส่ง `to` โดยไม่มี `from` = 400 ก่อนแตะ DB (เดิมปล่อยให้ Postgres โยนแล้ว `catch` ตอบ `[]` — อ่านว่า "ไม่มีข้อมูล")
  - UI `/history` ต้องแสดงข้อความ error จาก server ไม่ใช่ `HTTP 400`
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

