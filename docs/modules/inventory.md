# โมดูล inventory — สต็อกสินค้า

## เจตนา
เก็บสถานะสินค้าในสต็อก: มีอะไร กี่ชิ้น อยู่ตรงไหน เหลือพอไหว

## ตารางที่เป็นเจ้าของ
- `inventory_items` — รายการสินค้าในสต็อก (ชื่อ, จำนวน, ตำแหน่ง, threshold)

## Endpoints (mounted ที่ `/api/inventory`)
- `GET /` · `GET /status` · `POST /` · `PUT /:id` · `DELETE /:id`

## กลไกสำคัญ
- โมดูลเล็กและตรงไปตรงมา — routes เรียก prisma ผ่าน service เดียว
- ใช้เป็นตัวอย่างขนาดที่เหมาะสมของโมดูล (ไม่ควรโตเกินนี้โดยไม่แตกย่อย)

## ห้ามแตะ / ระวัง
- หน้า dashboard อ้าง `GET /status` — เปลี่ยนรูป response ต้องเช็ค dashboard ด้วย

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`inventory_items`

### Routes
- `inventory/inventory.routes.ts` (257 บรรทัด)

### Endpoints (จาก router)
```
GET /
GET /status
POST /
PUT /:id
DELETE /:id
```

### Services ที่ทำงานให้โมดูลนี้
`inventory.service`

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`inventory_items`

### Routes
- `inventory/inventory.routes.ts` (257 บรรทัด)

### Endpoints (จาก router)
```
GET /
GET /status
POST /
PUT /:id
DELETE /:id
```

### Services ที่ทำงานให้โมดูลนี้
`inventory.service`

<!-- auto:end -->
