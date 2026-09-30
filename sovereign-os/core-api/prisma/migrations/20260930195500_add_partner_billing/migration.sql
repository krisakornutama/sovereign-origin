-- P17 — บิลค่าบริการ/ติดตั้ง IoT สำหรับคู่ค้า: ผูกออเดอร์กับ partner
ALTER TABLE "business_orders" ADD COLUMN IF NOT EXISTS "partnerId" TEXT NULL REFERENCES "partners"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "business_orders_partnerId_idx" ON "business_orders" ("partnerId");
