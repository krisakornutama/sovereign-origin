# โมดูล farm — แปลง/ดิน/เก็บเกี่ยว/ที่ปรึกษา

## เจตนา
จัดการแปลงปลูก: ข้อมูลแปลง+geometry ผลวิเคราะห์ดิน การใส่ปุ๋ย การเก็บเกี่ยว (ผัก/สมุนไพร) พร้อมคำแนะนำจาก advisor

## ตารางที่เป็นเจ้าของ
- `farm_plots` — แปลง (ชื่อ, พืช, geometry, สถานะ)
- `farm_soil_readings` — ผลตรวจดิน (pH, N-P-K ฯลฯ)
- `fertilizer_applications` — การใส่ปุ๋ยต่อแปลง
- `herb_beds` — แปลงสมุนไพร

## Endpoints หลัก (mounted ที่ `/api/farm`)
- แปลง: `GET /` · `POST /` · `PUT /:id` · `DELETE /:id` · `PUT /:id/geometry`
- ดิน: `POST|GET /:id/soil-readings` · `POST /:id/apply-fertilizer`
- เก็บเกี่ยว: `POST /:id/harvest` · `POST /:id/herb-harvest`
- วิเคราะห์: `GET /overview` · `GET /:id/advisor` · `GET /:id/analysis` · `GET /map.svg`

## กลไกสำคัญ
- `POST /:id/harvest` สร้าง product_lot ผ่าน trace.service → ล็อตเกิดจากแปลงจริง (เชื่อม farm↔trace ตามกติกาข้ามโมดูลที่ประกาศไว้)
- Services: farm-advisor / farm-map / farm-soil · advisor.service (alias ใน module-owners = farm)

## ห้ามแตะ / ระวัง
- `harvest` สร้างข้อมูลในโมดูล trace — แก้ schema ตาราง `product_lots` ต้องรีวิว farm ด้วย
- `map.svg` เรนเดอร์ geometry จริง — เปลี่ยน format geometry กระทบ frontend map

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`farm_plots` · `farm_soil_readings` · `fertilizer_applications` · `herb_beds`

### Routes
- `farm/farm.routes.ts` (461 บรรทัด)

### Endpoints (จาก router)
```
GET /
GET /overview
GET /map.svg
POST /
PUT /:id
DELETE /:id
PUT /:id/geometry
POST /:id/soil-readings
GET /:id/soil-readings
POST /:id/harvest
POST /:id/herb-harvest
GET /:id/advisor
GET /:id/analysis
POST /:id/apply-fertilizer
```

### Services ที่ทำงานให้โมดูลนี้
`advisor.service` · `farm-advisor.service` · `farm-map.service` · `farm-soil.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- farm → inventory(inventory_items)
- farm → portfolio(wealth_history)
- farm → trace(product_lots)
- farm → treasury(asset_positions)

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`farm_plots` · `farm_soil_readings` · `fertilizer_applications` · `herb_beds`

### Routes
- `farm/crop-recommend.routes.ts` (50 บรรทัด)
- `farm/farm.routes.ts` (461 บรรทัด)

### Endpoints (จาก router)
```
GET /recommend
GET /
GET /overview
GET /map.svg
POST /
PUT /:id
DELETE /:id
PUT /:id/geometry
POST /:id/soil-readings
GET /:id/soil-readings
POST /:id/harvest
POST /:id/herb-harvest
GET /:id/advisor
GET /:id/analysis
POST /:id/apply-fertilizer
```

### Services ที่ทำงานให้โมดูลนี้
`advisor.service` · `farm-advisor.service` · `farm-map.service` · `farm-soil.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- farm → dime(asset_prices)
- farm → inventory(inventory_items)
- farm → portfolio(wealth_history)
- farm → sensors(sensor_telemetry)
- farm → trace(product_lots)
- farm → treasury(asset_positions)

<!-- auto:end -->
