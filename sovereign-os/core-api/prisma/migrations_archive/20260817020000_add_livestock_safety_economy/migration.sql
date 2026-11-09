-- Livestock Safety & Economy linkage — Phase 2
-- 0) Correction: livestock engine id columns ถูกสร้างเป็น TEXT แต่ schema ประกาศ UUID
--    (ตารางว่างเปล่าทั้งหมด — แปลงปลอดภัย, ต้องทำก่อนสร้าง FK ของ vision)
--    ต้อง DROP FK เก่าก่อนแปลงชนิด แล้ว re-create ใหม่ (PG re-check FK ตอน ALTER TYPE)
-- 1) LivestockGroup.quarantine_end_at: ปลดล็อกกักกันอัตโนมัติ (cron สแกนทุกวัน)
-- 2) inventory_item_id FK บน MedicalRecord / VaccineSchedule / FeedSilo: หักลบยอดคงเหลืออัตโนมัติ
-- 3) BiosecurityLog.exit_time: บันทึกเวลาออกฟาร์ม (เข้า-ออกครบรอบ)
-- 4) ตาราง livestock_vision_reports: ผลวิเคราะห์ภาพอาการป่วย (Qwen2-VL) — เก็บ JSON สรุปเท่านั้น

-- 0) ถอด FK ชั่วคราว (เค้าโครงเดิม: medical/vaccine/daily/breeding = CASCADE, batch = SET NULL)
ALTER TABLE "livestock_medical_records"
  DROP CONSTRAINT IF EXISTS "livestock_medical_records_livestockGroupId_fkey";
ALTER TABLE "livestock_vaccine_schedules"
  DROP CONSTRAINT IF EXISTS "livestock_vaccine_schedules_livestockGroupId_fkey";
ALTER TABLE "livestock_daily_logs"
  DROP CONSTRAINT IF EXISTS "livestock_daily_logs_livestockGroupId_fkey";
ALTER TABLE "livestock_breeding_records"
  DROP CONSTRAINT IF EXISTS "livestock_breeding_records_livestockGroupId_fkey";
ALTER TABLE "livestock_batch_financials"
  DROP CONSTRAINT IF EXISTS "livestock_batch_financials_livestockGroupId_fkey";

-- 0) แปลง FK เป็น UUID ก่อน parent
ALTER TABLE "livestock_medical_records"
  ALTER COLUMN "livestockGroupId" TYPE UUID USING "livestockGroupId"::uuid;
ALTER TABLE "livestock_vaccine_schedules"
  ALTER COLUMN "livestockGroupId" TYPE UUID USING "livestockGroupId"::uuid;
ALTER TABLE "livestock_daily_logs"
  ALTER COLUMN "livestockGroupId" TYPE UUID USING "livestockGroupId"::uuid;
ALTER TABLE "livestock_breeding_records"
  ALTER COLUMN "livestockGroupId" TYPE UUID USING "livestockGroupId"::uuid;
ALTER TABLE "livestock_batch_financials"
  ALTER COLUMN "livestockGroupId" TYPE UUID USING "livestockGroupId"::uuid;
ALTER TABLE "livestock_groups"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

-- 0) ใส่ FK กลับ (ชนิดตรงกันแล้ว)
ALTER TABLE "livestock_medical_records" ADD CONSTRAINT "livestock_medical_records_livestockGroupId_fkey"
  FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_vaccine_schedules" ADD CONSTRAINT "livestock_vaccine_schedules_livestockGroupId_fkey"
  FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_daily_logs" ADD CONSTRAINT "livestock_daily_logs_livestockGroupId_fkey"
  FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_breeding_records" ADD CONSTRAINT "livestock_breeding_records_livestockGroupId_fkey"
  FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "livestock_batch_financials" ADD CONSTRAINT "livestock_batch_financials_livestockGroupId_fkey"
  FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "livestock_groups"
  ADD COLUMN IF NOT EXISTS "quarantineEndAt" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_livestock_groups_quarantine_end
  ON "livestock_groups" ("quarantineEndAt") WHERE "quarantineEndAt" IS NOT NULL;

ALTER TABLE "livestock_medical_records"
  ADD COLUMN IF NOT EXISTS "inventoryItemId" UUID REFERENCES "inventory_items"("id") ON DELETE SET NULL;
ALTER TABLE "livestock_vaccine_schedules"
  ADD COLUMN IF NOT EXISTS "inventoryItemId" UUID REFERENCES "inventory_items"("id") ON DELETE SET NULL;
ALTER TABLE "livestock_feed_silos"
  ADD COLUMN IF NOT EXISTS "inventoryItemId" UUID REFERENCES "inventory_items"("id") ON DELETE SET NULL;

ALTER TABLE "livestock_biosecurity_logs"
  ADD COLUMN IF NOT EXISTS "exitTime" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "livestock_vision_reports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "livestockGroupId" UUID NOT NULL REFERENCES "livestock_groups"("id") ON DELETE CASCADE,
  "model" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "symptomsJson" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_livestock_vision_group_created
  ON "livestock_vision_reports" ("livestockGroupId", "created_at" DESC);