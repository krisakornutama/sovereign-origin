# โมดูล sensors

## เจตนา
ทะเบียนอุปกรณ์วัด (devices) และท่อรวมข้อมูลเทเลเมทรี — รับค่าจาก MQTT/อุปกรณ์ เก็บลง hypertable แล้วเปิดให้ทุกโมดูลอ่าน (dashboard, farm, energy ฯลฯ)

## ข้อห้าม / ระวัง
- **`sensor_telemetry` เป็น hypertable (TimescaleDB) หัวใจของระบบ** — เขียนผ่าน raw SQL จากหลายจุด (mqttIngest, sensor-data, restaurant, wan-monitor, ups-monitor) ห้ามเปลี่ยนโครง/ชื่อคอลัมน์โดยไม่ดูทุกจุดเขียน
- ห้ามลบ/ตัดข้อมูลย้อนหลังยกเว้น endpoint `DELETE /:metric` ที่ตั้งใจไว้ชัด (retention เป็นเรื่องของ hypertable policy ไม่ใช่คำสั่งเฉพาะกิจ)
- ข้อมูลต้องมาจากอุปกรณ์จริงเท่านั้น — ห้าม generate ค่าจำลองเข้าท่อจริง (มี endpoint generate-code ไว้แค่ลงทะเบียนอุปกรณ์)
- **`POST /generate-code`: ทุกค่าที่ผู้ใช้พิมพ์และจะถูกฝังลงสตริง C ต้องผ่าน `cString()`** (escape `\` `"` และ control char + cap ความยาว) — ไม่ escape = `"` เดียวก็หลุดออกจากสตริงกลายเป็นโค้ดที่ถูกแฟลชลงอุปกรณ์ หรืออย่างน้อยสเก็ตช์คอมไพล์ไม่ผ่าน (รหัส WiFi ที่มี `\` เป็นของจริง)
  - `sensors` ต้องเป็น **array** และ ≤ `MAX_GENERATED_SENSORS` (32) — ค่าที่ไม่ใช่ array เคยทำให้ `sensors.map` โยนใน async handler ⇒ Express 4 ไม่ดัก = คำขอค้าง ไม่ใช่ 400
  - handler เป็นฟังก์ชัน sync ที่ถูกเรียกใน `try/catch` — อย่าเปลี่ยนกลับเป็น `async` ตรง ๆ โดยไม่มี catch
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

