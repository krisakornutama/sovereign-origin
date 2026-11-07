-- scripts/ci-timescale-ignored.sql
--
-- ทำไมต้องมีไฟล์นี้:
--   `sensor_telemetry` ถูกประกาศเป็น `@@ignore` ใน prisma/schema.prisma (ตาราง TimescaleDB
--   ที่มี hypertable/compression ซึ่ง Prisma จัดการไม่ได้) → `prisma db push` จะไม่สร้างให้
--   แต่ integration test ของ conflict resolver ต้องเขียน telemetry ลงตารางจริงผ่าน FK `node_id`
--
--   DDL นี้คัดลอกมาจาก migration 20260731100758_add_wealth_models (CREATE TABLE + FK)
--   และ 20260811000003_sensor_telemetry_timescale (hypertable + index) ทุกคำสั่ง idempotent
--   ใช้เฉพาะ CI/DB เปล่าเท่านั้น — DB ที่รัน migration ครบแล้วมีตารางนี้อยู่ก่อนแล้ว
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS "sensor_telemetry" (
    "time" TIMESTAMPTZ NOT NULL,
    "node_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sensor_telemetry_node_id_fkey'
    ) THEN
        ALTER TABLE "sensor_telemetry"
            ADD CONSTRAINT "sensor_telemetry_node_id_fkey"
            FOREIGN KEY ("node_id") REFERENCES "nodes"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

SELECT create_hypertable('sensor_telemetry', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS "sensor_telemetry_node_id_time_idx"
    ON "sensor_telemetry" ("node_id", "time" DESC);
CREATE INDEX IF NOT EXISTS "sensor_telemetry_device_id_metric_time_idx"
    ON "sensor_telemetry" ("device_id", "metric", "time" DESC);
