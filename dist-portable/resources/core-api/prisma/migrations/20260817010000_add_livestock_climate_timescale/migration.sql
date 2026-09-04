-- livestock_climate_logs: hypertable + compression (TimescaleDB)
-- ตามแพทเทิร์นเดียวกับ sensor_telemetry (20260811000003)
-- หมายเหตุ: Timescale ห้าม PK/unique index ที่ไม่มี partition column "at"
-- → ตารางนี้ไม่มี PK (id ใช้ uuid แค่กันซ้ำการอ่าน ไม่ได้ใช้ join)
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS "livestock_climate_logs" (
  "id" TEXT NOT NULL,
  "houseCode" TEXT,
  "tempC" DOUBLE PRECISION NOT NULL,
  "rhPct" DOUBLE PRECISION NOT NULL,
  "thi" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL,
  "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ลบ PK เก่า (กรณีรันก่อนหน้าที่มี CONSTRAINT เดิม) — idempotent
ALTER TABLE "livestock_climate_logs" DROP CONSTRAINT IF EXISTS "livestock_climate_logs_pkey";

-- แปลงเป็น hypertable (partition ตามเวลา)
SELECT create_hypertable('livestock_climate_logs', 'at', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_livestock_climate_house_at
    ON livestock_climate_logs ("houseCode", "at" DESC);
CREATE INDEX IF NOT EXISTS idx_livestock_climate_at
    ON livestock_climate_logs ("at" DESC);

-- เปิด compression + บีบอัดข้อมูลเก่าเกิน 30 วัน
ALTER TABLE livestock_climate_logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = '"houseCode"'
);
SELECT add_compression_policy('livestock_climate_logs', INTERVAL '30 days', if_not_exists => TRUE);