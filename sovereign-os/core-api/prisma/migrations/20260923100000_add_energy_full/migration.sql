-- ENERGY เต็มรูป — ตาราง energy_readings (ค่าวัดต่อเนื่อง) + energy_thresholds (เพดานการใช้)
-- ตาม house convention: IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม

CREATE TABLE IF NOT EXISTS "energy_readings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "node_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "energy_readings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "energy_thresholds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "scopeName" TEXT NOT NULL,
    "metric" TEXT NOT NULL DEFAULT 'power_kw',
    "maxKw" DOUBLE PRECISION NOT NULL,
    "windowMin" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "energy_thresholds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "energy_readings_node_id_device_id_metric_read_at_idx"
    ON "energy_readings"("node_id", "device_id", "metric", "read_at");
CREATE UNIQUE INDEX IF NOT EXISTS "energy_thresholds_scope_scopeName_metric_key"
    ON "energy_thresholds"("scope", "scopeName", "metric");
