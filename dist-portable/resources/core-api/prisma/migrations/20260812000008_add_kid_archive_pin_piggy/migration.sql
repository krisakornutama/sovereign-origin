-- AI สอนลูก: เก็บถาวรงาน/บิลที่จบแล้วเกิน 30 วัน + PIN ของลูก + ถังสะสมแต้ม/เป้าหมายออม

ALTER TABLE "kid_chores" ADD COLUMN "archived_at" TIMESTAMPTZ;
ALTER TABLE "kid_bills" ADD COLUMN "archived_at" TIMESTAMPTZ;
ALTER TABLE "kid_profiles" ADD COLUMN "pin_hash" TEXT;
ALTER TABLE "kid_profiles" ADD COLUMN "savings_goal" INTEGER;

CREATE TABLE "kid_piggy_txs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_piggy_txs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_piggy_txs_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "kid_piggy_txs_kid_id_created_at_idx" ON "kid_piggy_txs"("kid_id", "created_at");
