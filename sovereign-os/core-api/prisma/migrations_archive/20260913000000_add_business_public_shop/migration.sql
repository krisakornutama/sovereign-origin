-- PUBLIC SHOP — หน้าร้านสาธารณะ + ชำระเงิน PromptPay
-- ตาม house convention: additive เท่านั้น + IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "shopName" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "shopOpen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "shopPromptPay" TEXT;

ALTER TABLE "business_orders" ADD COLUMN IF NOT EXISTS "publicToken" UUID;

-- ลิงก์ลับต่อออเดอร์ (lookup ด้วย token ต้องเร็ว + ไม่ซ้ำ)
CREATE UNIQUE INDEX IF NOT EXISTS "business_orders_publicToken_key" ON "business_orders"("publicToken");
