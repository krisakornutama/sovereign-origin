-- sensor_telemetry: hypertable + index + compression
-- ย้ายมาจาก scripts/init-timescaledb.sql เพื่อให้ `prisma migrate dev`
-- ลง DB ใหม่ได้โดยไม่ชนกับ init script ของ Docker (ดู 20260731100758 ซึ่งสร้างตารางนี้เป็นตารางธรรมดา)
--
-- ทุกคำสั่งเป็น idempotent (IF NOT EXISTS / if_not_exists) → ปลอดภัยกับ DB ที่รันอยู่แล้ว

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- แปลงเป็น hypertable (ถ้ายังไม่ใช่)
SELECT create_hypertable('sensor_telemetry', 'time', if_not_exists => TRUE);

-- Index สำหรับ query ทั่วไป
CREATE INDEX IF NOT EXISTS idx_telemetry_node_time
    ON sensor_telemetry (node_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_metric
    ON sensor_telemetry (device_id, metric, time DESC);

-- เปิด compression
ALTER TABLE sensor_telemetry SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'node_id, device_id'
);

-- นโยบายบีบอัดข้อมูลเก่าเกิน 7 วัน (if_not_exists กัน policy ซ้ำ)
SELECT add_compression_policy('sensor_telemetry', INTERVAL '7 days', if_not_exists => TRUE);
