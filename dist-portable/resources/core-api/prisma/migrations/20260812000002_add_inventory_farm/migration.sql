-- Inventory & Farm Plot Manager (feature modules: ENABLED_MODULES=inventory,farm)

-- InventoryItem: เพิ่มคอลัมน์ location (ที่เก็บ)
ALTER TABLE "inventory_items"
  ADD COLUMN "location" TEXT;

-- FarmPlot
CREATE TABLE "farm_plots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "location" TEXT,
    "crop" TEXT,
    "area_sqm" DOUBLE PRECISION,
    "soil_notes" TEXT,
    "planted_at" TIMESTAMPTZ,
    "expected_harvest_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "farm_plots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "farm_plots_status_idx" ON "farm_plots"("status");
CREATE INDEX "farm_plots_expected_harvest_at_idx" ON "farm_plots"("expected_harvest_at");
