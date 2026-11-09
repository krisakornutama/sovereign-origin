-- 20260923210000_drop_unused_dose_logs
-- เดิมไฟล์นี้สั่ง DROP TABLE "dose_logs"; ตรง ๆ
-- ปัญหา: ตารางนี้ไม่เคยถูกสร้างใน migration ใดเลย (มีเฉพาะใน DB production ที่สร้างด้วยมือ)
-- ⇒ การติดตั้งใหม่ (Community Edition) พังทันทีด้วย "relation dose_logs does not exist"
-- แก้: ทำ idempotent — ไม่มีตารางก็ไม่เป็นไร
DROP TABLE IF EXISTS "dose_logs";
