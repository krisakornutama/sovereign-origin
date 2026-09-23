-- Drop dose_logs — ตารางที่ไม่มีใครใช้ (verified 2026-09-23)
-- หลักฐาน: 0 แถว · ไม่มี code reference ใน src ทั้งหมด (prisma delegate + raw SQL)
--          · ไม่มีใครใช้ย้อนหลังใน git history (git log -S doseLog ว่าง)
--          · ไม่มี FK ชี้เข้าตารางนี้
-- Guard: ถ้า environment อื่นมีข้อมูลค้าง (ไม่ใช่ prod) — ไม่ลบ ให้ตัดสินใจเองก่อน
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM dose_logs) = 0 THEN
    DROP TABLE IF EXISTS "dose_logs";
  ELSE
    RAISE NOTICE 'dose_logs ไม่ว่าง (% แถว) — ไม่ drop อัตโนมัติ', (SELECT COUNT(*) FROM dose_logs);
  END IF;
END $$;
