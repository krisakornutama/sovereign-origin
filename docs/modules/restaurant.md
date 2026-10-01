# โมดูล restaurant — ร้านอาหาร/เมนู/ออเดอร์/หน้าร้าน

## เจตนา
บริหารร้านอาหารในระบบ: หน้าร้าน เมนู+สูตร+วัตถุดิบ ลูกค้า (รวม face-enroll) ออเดอร์ พนักงาน และของเสีย

## ตารางที่เป็นเจ้าของ
- `restaurants` · `restaurant_menus` · `restaurant_recipes` · `restaurant_ingredients`
- `restaurant_orders` · `restaurant_order_lines` · `restaurant_customers` · `restaurant_employees` · `restaurant_waste_logs`

## Endpoints หลัก (mounted ที่ `/api/restaurant`)
- ร้าน: `POST /` · `GET /` · `PUT /:id/camera`
- เมนู: `POST|GET /menus` · `PUT /menus/:id/recipe` · `GET /menus/available`
- ออเดอร์: `POST|GET /orders` · `POST /orders/:id/status` · `POST /orders/:id/cancel`
- ลูกค้า: `POST|GET /customers` · `POST /customers/face-enroll`

## กลไกสำคัญ
- เมนูผูกสูตร (recipes) + วัตถุดิบ → หักสต็อกตามออเดอร์จริง
- 9 ตารางในโดเมนเดียว = โมดูลที่ "ก้อนปิด" ชัดที่สุดกลุ่มหนึ่งของระบบ

## ห้ามแตะ / ระวัง
- face-enroll จัดเป็นข้อมูลชีวมรรยาย — ห้าม log รูป/feature ลง audit ปกติ

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`menu_items` · `recipe_lines` · `restaurant_customers` · `restaurant_employees` · `restaurant_ingredients` · `restaurant_menus` · `restaurant_order_lines` · `restaurant_orders` · `restaurant_recipes` · `restaurant_waste_logs` · `restaurants`

### Routes
- `restaurant/restaurant.routes.ts` (386 บรรทัด)

### Endpoints (จาก router)
```
POST /
GET /
PUT /:id/camera
POST /customers
POST /customers/face-enroll
GET /customers
POST /menus
GET /menus
PUT /menus/:id/recipe
GET /menus/available
POST /orders
GET /orders
POST /orders/:id/cancel
POST /orders/:id/status
POST /orders/:id/pay
POST /iot/weight
GET /kitchen-sensors
POST /purchases
GET /reports/summary
```

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- restaurant → inventory(inventory_items)
- restaurant → vision(known_faces)

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`menu_items` · `recipe_lines` · `restaurant_customers` · `restaurant_employees` · `restaurant_ingredients` · `restaurant_menus` · `restaurant_order_lines` · `restaurant_orders` · `restaurant_recipes` · `restaurant_waste_logs` · `restaurants`

### Routes
- `restaurant/restaurant.routes.ts` (386 บรรทัด)

### Endpoints (จาก router)
```
POST /
GET /
PUT /:id/camera
POST /customers
POST /customers/face-enroll
GET /customers
POST /menus
GET /menus
PUT /menus/:id/recipe
GET /menus/available
POST /orders
GET /orders
POST /orders/:id/cancel
POST /orders/:id/status
POST /orders/:id/pay
POST /iot/weight
GET /kitchen-sensors
POST /purchases
GET /reports/summary
```

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- restaurant → inventory(inventory_items)
- restaurant → sensors(sensor_telemetry)
- restaurant → vision(known_faces)

<!-- auto:end -->
