-- ใบกำกับภาษี: ข้อมูลผู้เสียภาษีของร้าน (เลขประจำตัว 13 หลัก + ที่อยู่) — พิมพ์บนเอกสารแทนช่องกรอก
-- ตาม house convention: additive เท่านั้น + IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "taxId" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "address" TEXT;
