-- Sovereign Livestock Engine — 9 models (มุมมอง Prisma/schema.prisma)

CREATE TABLE IF NOT EXISTS "livestock_groups" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT,
  "species" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "birthDate" TIMESTAMP(3) NOT NULL,
  "houseCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "livestock_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_medical_records" (
  "id" TEXT NOT NULL,
  "livestockGroupId" TEXT NOT NULL,
  "drugName" TEXT NOT NULL,
  "dosageMgKg" DOUBLE PRECISION NOT NULL,
  "administeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawalDays" INTEGER NOT NULL,
  "safeHarvestDate" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "livestock_medical_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_vaccine_schedules" (
  "id" TEXT NOT NULL,
  "livestockGroupId" TEXT NOT NULL,
  "vaccineName" TEXT NOT NULL,
  "targetAgeDays" INTEGER NOT NULL,
  "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMPTZ,
  CONSTRAINT "livestock_vaccine_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_daily_logs" (
  "id" TEXT NOT NULL,
  "livestockGroupId" TEXT NOT NULL,
  "logDate" TIMESTAMPTZ NOT NULL,
  "mortalityCount" INTEGER NOT NULL DEFAULT 0,
  "culledCount" INTEGER NOT NULL DEFAULT 0,
  "feedConsumedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "waterConsumedL" DOUBLE PRECISION,
  "eggCount" INTEGER,
  "avgWeightGram" DOUBLE PRECISION,
  CONSTRAINT "livestock_daily_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_feed_silos" (
  "id" TEXT NOT NULL,
  "siloCode" TEXT NOT NULL,
  "capacityKg" DOUBLE PRECISION NOT NULL,
  "currentKg" DOUBLE PRECISION NOT NULL,
  "lastRefillAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "livestock_feed_silos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_biosecurity_logs" (
  "id" TEXT NOT NULL,
  "visitorName" TEXT NOT NULL,
  "vehiclePlate" TEXT,
  "sanitizedSec" INTEGER NOT NULL,
  "passedGate" BOOLEAN NOT NULL DEFAULT false,
  "entryTime" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "livestock_biosecurity_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_breeding_records" (
  "id" TEXT NOT NULL,
  "livestockGroupId" TEXT NOT NULL,
  "inseminatedAt" TIMESTAMPTZ NOT NULL,
  "expectedBirthAt" TIMESTAMPTZ NOT NULL,
  "actualBirthAt" TIMESTAMPTZ,
  "litterSize" INTEGER,
  "eggSetCount" INTEGER,
  "hatchedCount" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PREGNANT',
  CONSTRAINT "livestock_breeding_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_batch_financials" (
  "id" TEXT NOT NULL,
  "livestockGroupId" TEXT,
  "batchCode" TEXT NOT NULL,
  "initialAnimalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalFeedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalMedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalUtilityCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "netProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "closedAt" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "livestock_batch_financials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "livestock_utility_alerts" (
  "id" TEXT NOT NULL,
  "houseCode" TEXT NOT NULL,
  "gridPowerState" TEXT NOT NULL,
  "generatorState" TEXT NOT NULL,
  "atsTrippedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "livestock_utility_alerts_pkey" PRIMARY KEY ("id")
);

-- constraints เดียวกัน (unique / FK / index)
CREATE UNIQUE INDEX IF NOT EXISTS "livestock_groups_code_key" ON "livestock_groups"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "livestock_feed_silos_siloCode_key" ON "livestock_feed_silos"("siloCode");
CREATE UNIQUE INDEX IF NOT EXISTS "livestock_batch_financials_batchCode_key" ON "livestock_batch_financials"("batchCode");
CREATE UNIQUE INDEX IF NOT EXISTS "livestock_daily_logs_livestockGroupId_logDate_key" ON "livestock_daily_logs"("livestockGroupId", "logDate");

CREATE INDEX IF NOT EXISTS "livestock_groups_species_idx" ON "livestock_groups"("species");
CREATE INDEX IF NOT EXISTS "livestock_groups_status_idx" ON "livestock_groups"("status");
CREATE INDEX IF NOT EXISTS "livestock_medical_records_livestockGroupId_safeHarvestDate_idx" ON "livestock_medical_records"("livestockGroupId", "safeHarvestDate");
CREATE INDEX IF NOT EXISTS "livestock_medical_records_safeHarvestDate_idx" ON "livestock_medical_records"("safeHarvestDate");
CREATE INDEX IF NOT EXISTS "livestock_vaccine_schedules_livestockGroupId_isCompleted_idx" ON "livestock_vaccine_schedules"("livestockGroupId", "isCompleted");
CREATE INDEX IF NOT EXISTS "livestock_daily_logs_livestockGroupId_logDate_idx" ON "livestock_daily_logs"("livestockGroupId", "logDate");
CREATE INDEX IF NOT EXISTS "livestock_biosecurity_logs_passedGate_entryTime_idx" ON "livestock_biosecurity_logs"("passedGate", "entryTime");
CREATE INDEX IF NOT EXISTS "livestock_breeding_records_livestockGroupId_status_idx" ON "livestock_breeding_records"("livestockGroupId", "status");
CREATE INDEX IF NOT EXISTS "livestock_batch_financials_livestockGroupId_idx" ON "livestock_batch_financials"("livestockGroupId");
CREATE INDEX IF NOT EXISTS "livestock_utility_alerts_houseCode_idx" ON "livestock_utility_alerts"("houseCode");

ALTER TABLE "livestock_medical_records" ADD CONSTRAINT "livestock_medical_records_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_vaccine_schedules" ADD CONSTRAINT "livestock_vaccine_schedules_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_daily_logs" ADD CONSTRAINT "livestock_daily_logs_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_breeding_records" ADD CONSTRAINT "livestock_breeding_records_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_batch_financials" ADD CONSTRAINT "livestock_batch_financials_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;