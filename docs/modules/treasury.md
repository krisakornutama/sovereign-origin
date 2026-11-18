# โมดูล treasury — การเงิน/พอร์ต/runway/โอน

## เจตนา
ศูนย์การเงินของระบบ: บัญชี งบดุล พอร์ตลงทุน (positions) runway และการโอนระหว่างบัญชี

## ตารางที่เป็นเจ้าของ
- `treasury_accounts` · `treasury_transactions` · `treasury_transfers` · `treasury_events`

## Endpoints หลัก (mounted ที่ `/api/treasury`)

> ⚠️ **2026-11-05: routes ของโมดูลนี้ย้ายไป private repo แล้ว** (`sovereign-os/core-api/src/routes.ts:146`) — รายการด้านล่างเก็บไว้เป็นประวัติ ไม่มีไฟล์ route ในเรโพนี้ · คงเหลือเฉพาะ `treasury.service.ts`
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

### Services ที่ทำงานให้โมดูลนี้
`treasury.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- treasury → dime(asset_prices)
- treasury → inventory(inventory_items)
- treasury → sensors(sensor_telemetry)

<!-- auto:end -->

