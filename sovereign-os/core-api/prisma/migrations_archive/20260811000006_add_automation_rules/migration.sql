-- CreateTable: กฎอัตโนมัติ (built-in + custom จาก Custom Rule Builder)
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);
