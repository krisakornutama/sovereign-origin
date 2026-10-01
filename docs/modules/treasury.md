# โมดูล treasury — การเงิน/พอร์ต/runway/โอน

## เจตนา
ศูนย์การเงินของระบบ: บัญชี งบดุล พอร์ตลงทุน (positions) runway และการโอนระหว่างบัญชี

## ตารางที่เป็นเจ้าของ
- `treasury_accounts` · `treasury_transactions` · `treasury_transfers` · `treasury_events`

## Endpoints หลัก (mounted ที่ `/api/treasury`)
- ภาพรวม: `GET /overview` · `PATCH /balance-sheet` · `GET /events`
- Runway: `POST /runway/snapshot` · `GET /runway/history`
- พอร์ต: `POST /positions` · `PATCH|DELETE /positions/:id` · `POST /positions/:id/sell` · `POST /positions/:id/dividend`
- โอน: `GET|POST /transfers` · `POST /transfers/:id/confirm` · `POST /transfers/:id/cancel`

## กลไกสำคัญ
- Route ใหญ่ (656 บรรทัด) + `treasury.helpers.ts` — กติกาเงินอยู่ใน helper ร่วม ไม่กระจายใน route
- Service: `treasury.service.ts` + `transfer.service.ts`

## ห้ามแตะ / ระวัง
- ทุกกระทบยอดต้องเกิดผ่าน transactions ของ Prisma — ห้ามอัปเดตยอดแบบ read-then-write นอก transaction
- เหตุการณ์การเงิน (treasury_events) = append-only บันทึกเพื่อตรวจสอบย้อนหลัง

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`asset_positions` · `personal_balance_sheets` · `survival_runways` · `transfer_orders` · `treasury_accounts` · `treasury_events` · `treasury_transactions` · `treasury_transfers`

### Routes
- `treasury/treasury.routes.ts` (657 บรรทัด)

### Endpoints (จาก router)
```
GET /overview
PATCH /balance-sheet
POST /runway/snapshot
GET /runway/history
POST /positions
PATCH /positions/:id
DELETE /positions/:id
POST /positions/:id/sell
POST /positions/:id/dividend
GET /events
GET /transfers
POST /transfers
POST /transfers/:id/confirm
POST /transfers/:id/cancel
GET /signals
POST /signals/reset
PUT /signals/:symbol
POST /signals/check
POST /signals/preview/:symbol
```

### Services ที่ทำงานให้โมดูลนี้
`transfer.service` · `treasury.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- treasury → inventory(inventory_items)

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`asset_positions` · `personal_balance_sheets` · `survival_runways` · `transfer_orders` · `treasury_accounts` · `treasury_events` · `treasury_transactions` · `treasury_transfers`

### Routes
- `treasury/treasury.routes.ts` (657 บรรทัด)

### Endpoints (จาก router)
```
GET /overview
PATCH /balance-sheet
POST /runway/snapshot
GET /runway/history
POST /positions
PATCH /positions/:id
DELETE /positions/:id
POST /positions/:id/sell
POST /positions/:id/dividend
GET /events
GET /transfers
POST /transfers
POST /transfers/:id/confirm
POST /transfers/:id/cancel
GET /signals
POST /signals/reset
PUT /signals/:symbol
POST /signals/check
POST /signals/preview/:symbol
```

### Services ที่ทำงานให้โมดูลนี้
`transfer.service` · `treasury.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- treasury → dime(asset_prices)
- treasury → inventory(inventory_items)
- treasury → sensors(sensor_telemetry)

<!-- auto:end -->
