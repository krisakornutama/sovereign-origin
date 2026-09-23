-- เฟส 4 ร้านชุมชน multi-tenant — สถานะจัดส่งแบบเบา + opt-in catalog กลางชุมชน
-- ตาม house convention: IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม

ALTER TABLE "business_orders" ADD COLUMN IF NOT EXISTS "shippingStatus" TEXT;
ALTER TABLE "business_orders" ADD COLUMN IF NOT EXISTS "shippingCarrier" TEXT;
ALTER TABLE "business_orders" ADD COLUMN IF NOT EXISTS "shippingTracking" TEXT;
ALTER TABLE "business_orders" ADD COLUMN IF NOT EXISTS "shippedAt" TIMESTAMPTZ(6);

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "shopInCommunity" BOOLEAN NOT NULL DEFAULT false;
