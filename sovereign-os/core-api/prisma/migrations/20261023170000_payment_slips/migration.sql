-- Payment slips (free-first): เก็บภาพสลิป + สถานะตรวจด้วยมือ
-- ไม่เรียกผู้ให้บริการอ่านสลิปใด ๆ ในรอบนี้ — provider เป็นเพียง adapter key

CREATE TABLE "payment_slips" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "orderId" UUID,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "transRef" TEXT,
    "amountSatang" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "imageMime" TEXT NOT NULL,
    "imageSha256" TEXT NOT NULL,
    "imageSize" INTEGER NOT NULL,
    "imageData" BYTEA NOT NULL,
    "note" TEXT,
    "uploadedBy" UUID,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_slips_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_slips_imageSha256_key" ON "payment_slips"("imageSha256");
CREATE UNIQUE INDEX "payment_slips_provider_transRef_key" ON "payment_slips"("provider", "transRef");
CREATE INDEX "payment_slips_businessId_status_createdAt_idx" ON "payment_slips"("businessId", "status", "createdAt");
CREATE INDEX "payment_slips_orderId_idx" ON "payment_slips"("orderId");

ALTER TABLE "payment_slips"
  ADD CONSTRAINT "payment_slips_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_slips"
  ADD CONSTRAINT "payment_slips_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_slips"
  ADD CONSTRAINT "payment_slips_uploadedBy_fkey"
  FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_slips"
  ADD CONSTRAINT "payment_slips_reviewedBy_fkey"
  FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
