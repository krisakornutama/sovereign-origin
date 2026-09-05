-- AI สอนลูก: งานบ้านรายวัน (repeat) + เป้าหมายถังระยะยาว + หุ้นจำลองของบ้าน + audit log

ALTER TABLE "kid_chores" ADD COLUMN "repeat" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "kid_profiles" ADD COLUMN "piggy_target_title" TEXT;
ALTER TABLE "kid_profiles" ADD COLUMN "piggy_target_amount" INTEGER;

CREATE TABLE "kid_investments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "avg_cost" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_investments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_investments_kid_id_symbol_key" UNIQUE ("kid_id", "symbol"),
    CONSTRAINT "kid_investments_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "kid_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'parent',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_audit_logs_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "kid_audit_logs_kid_id_created_at_idx" ON "kid_audit_logs"("kid_id", "created_at");
