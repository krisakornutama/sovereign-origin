-- 20261107190001_non_prisma_objects
--
-- baseline (20261107190000) ถูก generate จาก schema.prisma จึงไม่มี object ที่ Prisma มองไม่เห็น
-- แต่มีอยู่จริงใน DB ที่รัน migration เดิม และถูกใช้โดยเทสต์/routes:
--   • fleet_audit_view                     → fleet phase 2 audit (กรอง action_type FLEET_*)
--   • sensor_telemetry_hourly              → view สรุปต่อชั่วโมง (ใน prod เป็น continuous aggregate)
--
-- ทุกคำสั่ง idempotent และไม่พึ่ง TimescaleDB → รันได้ทั้ง CI postgres:15 และ DB ที่มีข้อมูลอยู่แล้ว
-- (sensor_telemetry เองยังสร้างแยกด้วย scripts/ci-timescale-ignored.sql เพราะ model ถูก @@ignore)

CREATE OR REPLACE VIEW "fleet_audit_view" AS
SELECT id, "timestamp", user_id, action_type, payload
FROM audit_logs
WHERE action_type LIKE 'FLEET\_%';

-- ใน DB ที่มี TimescaleDB อยู่แล้ว view นี้เป็น continuous aggregate (relkind อื่น) → ห้าม replace
-- สร้างเฉพาะเมื่อยังไม่มีตาราง sensor_telemetry จริง (CI ที่ไม่มี TimescaleDB จะข้ามไปเงียบ ๆ)
DO $$
BEGIN
    IF to_regclass('public.sensor_telemetry') IS NOT NULL
       AND to_regclass('public.sensor_telemetry_hourly') IS NULL THEN
        EXECUTE $view$
            CREATE VIEW "sensor_telemetry_hourly" AS
            SELECT time_bucket('1 hour', "time") AS bucket,
                   node_id,
                   device_id,
                   metric,
                   avg(value) AS avg_value,
                   min(value) AS min_value,
                   max(value) AS max_value,
                   count(*)::int AS sample_count
            FROM sensor_telemetry
            GROUP BY 1, 2, 3, 4
        $view$;
    END IF;
END $$;
