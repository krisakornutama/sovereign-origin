-- AI สอนลูก: หน้าที่ของลูก — งานบ้าน (ทำงานแลกเงิน) + บิล (ค่าไฟ/น้ำ/ห้อง) + กระเป๋าเงิน

CREATE TABLE "kid_chores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "reward" INTEGER NOT NULL,
    "emoji" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_chores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_chores_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "kid_chores_kid_id_idx" ON "kid_chores"("kid_id");

CREATE TABLE "kid_bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "emoji" TEXT,
    "period" TEXT NOT NULL DEFAULT 'one-time',
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "paid_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_bills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_bills_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "kid_bills_kid_id_idx" ON "kid_bills"("kid_id");

CREATE TABLE "kid_wallet_txs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_wallet_txs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_wallet_txs_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "kid_wallet_txs_kid_id_created_at_idx" ON "kid_wallet_txs"("kid_id", "created_at");
