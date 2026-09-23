# โมดูล portfolio

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`wealth_history`

### Routes
- `portfolio/portfolio.routes.ts` (368 บรรทัด)

### Endpoints (จาก router)
```
GET /assets
POST /assets
DELETE /assets/:id
PUT /assets/:id
GET /inventory
POST /inventory
PUT /inventory/:id
DELETE /inventory/:id
GET /summary
GET /history
POST /refresh
GET /risk
```

### Services ที่ทำงานให้โมดูลนี้
`wealth.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- portfolio → inventory(inventory_items)
- portfolio → treasury(asset_positions)

<!-- auto:end -->
