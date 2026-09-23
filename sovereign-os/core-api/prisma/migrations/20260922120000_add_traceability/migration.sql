-- TRACEABILITY — รหัสล็อตผลผลิต (ProductLot) + เหตุการณ์ตามรอย (TraceEvent)
-- ตาม house convention: IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม

CREATE TABLE IF NOT EXISTS "product_lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lotCode" TEXT NOT NULL,
    "inventoryItemId" UUID,
    "plotId" UUID,
    "crop" TEXT,
    "quantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "harvestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldCustomerId" UUID,
    "soldAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "trace_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lotId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trace_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_lots_lotCode_key" ON "product_lots"("lotCode");
CREATE INDEX IF NOT EXISTS "product_lots_inventoryItemId_idx" ON "product_lots"("inventoryItemId");
CREATE INDEX IF NOT EXISTS "product_lots_plotId_idx" ON "product_lots"("plotId");
CREATE INDEX IF NOT EXISTS "trace_events_lotId_idx" ON "trace_events"("lotId");

-- Add foreign keys
DO $$ BEGIN
    ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "farm_plots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_soldCustomerId_fkey" FOREIGN KEY ("soldCustomerId") REFERENCES "business_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "product_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
