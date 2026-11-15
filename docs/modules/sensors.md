# โมดูล sensors

## เจตนา
ทะเบียนอุปกรณ์วัด (devices) และท่อรวมข้อมูลเทเลเมทรี — รับค่าจาก MQTT/อุปกรณ์ เก็บลง hypertable แล้วเปิดให้ทุกโมดูลอ่าน (dashboard, farm, energy ฯลฯ)

## ข้อห้าม / ระวัง
- **`sensor_telemetry` เป็น hypertable (TimescaleDB) หัวใจของระบบ** — เขียนผ่าน raw SQL จากหลายจุด (mqttIngest, sensor-data, restaurant, wan-monitor, ups-monitor) ห้ามเปลี่ยนโครง/ชื่อคอลัมน์โดยไม่ดูทุกจุดเขียน
- ห้ามลบ/ตัดข้อมูลย้อนหลังยกเว้น endpoint `DELETE /:metric` ที่ตั้งใจไว้ชัด (retention เป็นเรื่องของ hypertable policy ไม่ใช่คำสั่งเฉพาะกิจ)
- ข้อมูลต้องมาจากอุปกรณ์จริงเท่านั้น — ห้าม generate ค่าจำลองเข้าท่อจริง (มี endpoint generate-code ไว้แค่ลงทะเบียนอุปกรณ์)
- **`GET /all` มีเพดาน `limit` 1–5000** (`MAX_LIST_ROWS`) — เกิน/ไม่ใช่จำนวนเต็มบวก = 400 ห้าม clamp เงียบ (ผู้เรียกต้องรู้ว่าไม่ได้ของครบ ไม่ใช่เห็น 50 แถวแล้วคิดว่าเป็นทั้งหมด)
- **ลบข้อมูล (`DELETE /:metric`, `DELETE /:metric/all`) ต้องมีสิทธิ์ `DELETE_ROLES`** (`SUPERADMIN`/`NODE_ADMIN`/`SITE_ADMIN`/`OPERATOR`) — ลบแล้วกู้ไม่ได้ และ KID/SYSTEM_AI ต้องไม่ถึงมือ
  - UI ต้องอ่านผลจาก server ก่อนขึ้นข้อความ "ลบแล้ว" (เดิม `SensorsHub.deleteAll` ขึ้นข้อความสำเร็จโดยไม่ดู `res.ok` ⇒ 403 ถูกอ่านว่า "ลบทั้งหมดแล้ว")
- **`POST /generate-code`: ทุกค่าที่ผู้ใช้พิมพ์และจะถูกฝังลงสตริง C ต้องผ่าน `cString()`** (escape `\` `"` และ control char + cap ความยาว) — ไม่ escape = `"` เดียวก็หลุดออกจากสตริงกลายเป็นโค้ดที่ถูกแฟลชลงอุปกรณ์ หรืออย่างน้อยสเก็ตช์คอมไพล์ไม่ผ่าน (รหัส WiFi ที่มี `\` เป็นของจริง)
  - `sensors` ต้องเป็น **array** และ ≤ `MAX_GENERATED_SENSORS` (32) — ค่าที่ไม่ใช่ array เคยทำให้ `sensors.map` โยนใน async handler ⇒ Express 4 ไม่ดัก = คำขอค้าง ไม่ใช่ 400
  - handler เป็นฟังก์ชัน sync ที่ถูกเรียกใน `try/catch` — อย่าเปลี่ยนกลับเป็น `async` ตรง ๆ โดยไม่มี catch
- **`GET /devices` คืน `{ devices, degraded, reason, source }`** — อ่าน DB ไม่ได้ = `degraded: true` + `reason` (ไม่ใช่ `500 []` ที่ UI อ่านว่า "0 อุปกรณ์") ⇒ UI ต้องขึ้นแบนเนอร์ "ไม่ทราบ" และต้องไม่ขึ้น EmptyState "ยังไม่มีอุปกรณ์" พร้อมกัน
- **`POST /devices` + `DELETE /devices/:id` ต้องมี `DEVICE_WRITE_ROLES`** (`SUPERADMIN`/`NODE_ADMIN`/`SITE_ADMIN`/`OPERATOR`) — ตาราง `devices` เป็น config จริงของบ้าน (ลบอุปกรณ์ = ประวัติ/ค่าที่ผูกกับอุปกรณ์นั้นหาย) ⇒ KID/SYSTEM_AI ต้องได้ 403 ก่อนแตะ DB
- **`name` ไม่มีคอลัมน์เก็บในตาราง `devices`** — ใช้สร้าง `mqtt_topic` เท่านั้น ผ่าน `topicSegment()` (`/`, `+`, `#`, ช่องว่าง, control char → `-`; cap 64 ตัว; ว่าง = `device`) ⇒ ห้ามคืนชื่อให้ผู้ใช้อ่านว่า "บันทึกชื่อแล้ว" · `type` ต้อง match `DEVICE_TYPE_PATTERN` (1–32 ตัว `A-Za-z0-9 _.-`) และ `node_id` ต้องเป็น UUID — ผิดรูปแบบ = 400 ก่อนถึง Prisma
- **`DELETE /devices/:id`**: id ที่ไม่ใช่ UUID = 400 (กัน P2023 จาก `@db.Uuid`), id ที่ไม่มีจริง (P2025) = 404 — ห้ามปล่อยเป็น 500 "ลบไม่สำเร็จ" ที่แยกไม่ออกว่าพิมพ์ผิดหรือถูกลบไปแล้ว
- **`GET /metrics` และ `GET /all` อ่านไม่สำเร็จ = 500 พร้อม `{ error, metrics: [] }` / `{ error, records: [] }`** — ห้ามกลับไป `200 []`: หน้าเว็บจะขึ้น "ไม่มีข้อมูล" ทั้งที่ความจริงคือ "อ่านไม่ได้"
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`sensor_telemetry`

### Routes
- `sensors/sensor-data.routes.ts` (108 บรรทัด)
- `sensors/sensor.routes.ts` (128 บรรทัด)

### Endpoints (จาก router)
```
POST /data
GET /metrics
GET /all
DELETE /:metric
DELETE /:metric/all
GET /devices
POST /devices
DELETE /devices/:id
POST /generate-code
```

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- sensors → devices(devices)

<!-- auto:end -->

