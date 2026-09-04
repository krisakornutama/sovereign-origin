-- CreateTable: threat_intel_items (Next-Gen Security — Threat Intelligence DB)
CREATE TABLE "threat_intel_items" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'unknown',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "first_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "threat_intel_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "threat_intel_items_type_value_key" ON "threat_intel_items"("type", "value");
CREATE INDEX "threat_intel_items_active_idx" ON "threat_intel_items"("active");