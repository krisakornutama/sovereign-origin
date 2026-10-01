-- P19 — ปุ่ม "ยืนยันรับเงิน" ใน Telegram: token ใช้ครั้งเดียวต่อรายการแจ้งชำระ
-- (nullable — ออกตอนลูกค้าแจ้งชำระ · กดปุ่มแล้ว consume เป็น null กันกดซ้ำ)
ALTER TABLE "business_payments" ADD COLUMN IF NOT EXISTS "confirmToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "business_payments_confirmToken_key" ON "business_payments"("confirmToken");
