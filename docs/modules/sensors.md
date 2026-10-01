# โมดูล sensors

## เจตนา
ทะเบียนอุปกรณ์วัด (devices) และท่อรวมข้อมูลเทเลเมทรี — รับค่าจาก MQTT/อุปกรณ์ เก็บลง hypertable แล้วเปิดให้ทุกโมดูลอ่าน (dashboard, farm, energy ฯลฯ)

## ข้อห้าม / ระวัง
- **`sensor_telemetry` เป็น hypertable (TimescaleDB) หัวใจของระบบ** — เขียนผ่าน raw SQL จากหลายจุด (mqttIngest, sensor-data, restaurant, wan-monitor, ups-monitor) ห้ามเปลี่ยนโครง/ชื่อคอลัมน์โดยไม่ดูทุกจุดเขียน
- ห้ามลบ/ตัดข้อมูลย้อนหลังยกเว้น endpoint `DELETE /:metric` ที่ตั้งใจไว้ชัด (retention เป็นเรื่องของ hypertable policy ไม่ใช่คำสั่งเฉพาะกิจ)
- ข้อมูลต้องมาจากอุปกรณ์จริงเท่านั้น — ห้าม generate ค่าจำลองเข้าท่อจริง (มี endpoint generate-code ไว้แค่ลงทะเบียนอุปกรณ์)
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `sensors/sensor-data.routes.ts` (101 บรรทัด)
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

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`sensor_telemetry`

### Routes
- `sensors/sensor-data.routes.ts` (101 บรรทัด)
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
