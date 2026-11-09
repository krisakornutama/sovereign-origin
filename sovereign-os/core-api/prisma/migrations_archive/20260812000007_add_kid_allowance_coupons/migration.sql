-- AI สอนลูก: ค่าขนมรายสัปดาห์อัตโนมัติ (วันจ่าย + จำนวนเงิน + กันจ่ายซ้ำ) + คูปองรางวัล

ALTER TABLE "kid_profiles" ADD COLUMN "allowance_day" INTEGER;
ALTER TABLE "kid_profiles" ADD COLUMN "allowance_amount" INTEGER;
ALTER TABLE "kid_profiles" ADD COLUMN "allowance_last_paid" TIMESTAMPTZ;

CREATE TABLE "kid_coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "emoji" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "redeemed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_coupons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_coupons_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "kid_coupons_kid_id_idx" ON "kid_coupons"("kid_id");
