-- นโยบายการเก็บข้อมูล (retention) — กัน sensor_telemetry โตจนไม่มีที่สิ้นสุด
--
--   • raw data เก็บ 90 วัน (ลบอัตโนมัติโดย TimescaleDB retention policy)
--   • สร้าง continuous aggregate รายชั่วโมง (sensor_telemetry_hourly) เก็บ 2 ปี
--     สำหรับกราฟย้อนหลัง/รายงานระยะยาว — query เร็วกว่า raw มาก
--
-- ต้องการเปลี่ยนระยะเวลา? แก้ INTERVAL ข้างล่างแล้ว rerun (policy มี if_not_exists
-- และ add_retention_policy ซ้ำจะอัปเดตช่วงให้เอง)

-- 1) Continuous aggregate: ค่าเฉลี่ย/ต่ำสุด/สูงสุด/จำนวน ต่อ 1 ชั่วโมง
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS bucket,
       node_id,
       device_id,
       metric,
       AVG(value) AS avg_value,
       MIN(value) AS min_value,
       MAX(value) AS max_value,
       COUNT(*)   AS sample_count
FROM sensor_telemetry
GROUP BY bucket, node_id, device_id, metric
WITH NO DATA;

-- 2) รีเฟรชอัตโนมัติ: ประมวลผลข้อมูลย้อนหลัง 3 ชม. → ล่าสุด 1 ชม. ทุก 1 ชม.
SELECT add_continuous_aggregate_policy(
  'sensor_telemetry_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => true
);

-- 3) Retention: raw data เก็บ 90 วัน, aggregate เก็บ 2 ปี
SELECT add_retention_policy('sensor_telemetry', INTERVAL '90 days', if_not_exists => true);
SELECT add_retention_policy('sensor_telemetry_hourly', INTERVAL '2 years', if_not_exists => true);
