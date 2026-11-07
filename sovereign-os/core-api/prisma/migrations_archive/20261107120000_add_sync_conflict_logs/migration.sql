-- SYNC CONFLICT LOG — offline replay ที่ business guard ไม่ให้ผ่าน (PENDING_REVIEW)
-- additive only: ไม่แตะตารางเดิม · resolver upsert by mutation_id จึง retry ได้ปลอดภัย
CREATE TABLE "sync_conflict_logs" (
    "id" UUID NOT NULL,
    "mutation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "conflict_reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "note" TEXT,

    CONSTRAINT "sync_conflict_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_conflict_logs_mutation_id_key" ON "sync_conflict_logs"("mutation_id");
CREATE INDEX "sync_conflict_logs_status_created_at_idx" ON "sync_conflict_logs"("status", "created_at");
CREATE INDEX "sync_conflict_logs_user_id_status_idx" ON "sync_conflict_logs"("user_id", "status");
