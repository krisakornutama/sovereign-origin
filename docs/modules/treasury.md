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
