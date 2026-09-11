statements kept: 9
-- CreateTable
CREATE TABLE "restaurant_waste_logs" (
    "id" UUID NOT NULL,
    "restaurantId" UUID,
    "inventoryItemId" UUID,
    "qtyKg" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "reason" TEXT NOT NULL DEFAULT 'spoiled',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_waste_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compost_batches" (
    "id" UUID NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'hot',
    "status" TEXT NOT NULL DEFAULT 'active',
    "inputKg" DOUBLE PRECISION NOT NULL,
    "outputKg" DOUBLE PRECISION,
    "npkEstimate" JSONB,
    "startAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estReadyAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compost_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fertilizer_applications" (
    "id" UUID NOT NULL,
    "plotId" UUID NOT NULL,
    "compostBatchId" UUID,
    "inventoryItemId" UUID,
    "qtyKg" DOUBLE PRECISION NOT NULL,
    "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "fertilizer_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_waste_logs_restaurantId_createdAt_idx" ON "restaurant_waste_logs"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "restaurant_waste_logs_reason_idx" ON "restaurant_waste_logs"("reason");

-- CreateIndex
CREATE INDEX "compost_batches_status_estReadyAt_idx" ON "compost_batches"("status", "estReadyAt");

-- CreateIndex
CREATE INDEX "fertilizer_applications_plotId_appliedAt_idx" ON "fertilizer_applications"("plotId", "appliedAt");

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "farm_plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_compostBatchId_fkey" FOREIGN KEY ("compostBatchId") REFERENCES "compost_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
