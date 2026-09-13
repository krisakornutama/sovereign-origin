-- THAI TAX — ภาษีของธุรกิจ: ภาษีหัก ณ ที่จ่าย (WHT) + ยอด VAT ของรายรับ-รายจ่าย
-- ตาม house convention: additive เท่านั้น + IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม
-- (ยอดรวมในใบเสร็จ "รวม VAT 7%" = ราคาสินค้า + VAT อยู่แล้ว — VAT เก็บจากฐานราคาสินค้า
--  จึงไม่ต้องเก็บซ้ำใน payments; เก็บเฉพาะ WHT ที่รัฐหักตอนโอนเงิน และ VAT ย่อยของแต่ละรายการ ledger)

ALTER TABLE "business_payments" ADD COLUMN IF NOT EXISTS "whtAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "business_ledger_entries" ADD COLUMN IF NOT EXISTS "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "business_ledger_entries" ADD COLUMN IF NOT EXISTS "whtAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
