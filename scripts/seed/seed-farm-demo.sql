-- scripts/seed/seed-farm-demo.sql
--
-- ข้อมูลตัวอย่างสำหรับหน้า /farm-executive (dev/staging เท่านั้น)
-- idempotent: ลบชุด DEMO เดิมแล้วใส่ใหม่ทั้งชุดใน transaction เดียว
-- ห้ามรันกับฐานข้อมูลลูกค้าจริง — รันผ่าน scripts/seed/seed-farm-demo.mjs (มี --dry-run)

BEGIN;

-- ── ล้างชุดเดิม (เฉพาะ id ที่กำหนดไว้เท่านั้น) ──────────────────────────────
DELETE FROM livestock_daily_logs WHERE "livestockGroupId" IN (
  '11111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111103','11111111-1111-4111-8111-111111111104');
DELETE FROM livestock_vaccine_schedules WHERE "livestockGroupId" IN (
  '11111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111103','11111111-1111-4111-8111-111111111104');
DELETE FROM livestock_medical_records WHERE "livestockGroupId" IN (
  '11111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111103','11111111-1111-4111-8111-111111111104');
DELETE FROM livestock_groups WHERE id IN (
  '11111111-1111-4111-8111-111111111101','11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111103','11111111-1111-4111-8111-111111111104');
DELETE FROM farm_plots WHERE id IN (
  '22222222-2222-4222-8222-222222222201','22222222-2222-4222-8222-222222222202',
  '22222222-2222-4222-8222-222222222203','22222222-2222-4222-8222-222222222204',
  '22222222-2222-4222-8222-222222222205','22222222-2222-4222-8222-222222222206',
  '22222222-2222-4222-8222-222222222207','22222222-2222-4222-8222-222222222208');
DELETE FROM livestock_feed_silos WHERE id IN ('33333333-3333-4333-8333-333333333301','33333333-3333-4333-8333-333333333302');
DELETE FROM livestock_climate_logs WHERE id = '44444444-4444-4444-8444-444444444401';

-- ── แปลงพืช 8 แปลง (1 เลยกำหนด, 1 ใกล้เก็บเกี่ยว, 1 เก็บแล้ว) ───────────────
INSERT INTO farm_plots (id,name,location,crop,area_sqm,planted_at,expected_harvest_at,status,category,soil_notes,updated_at)
SELECT v.id::uuid, v.name, v.location, v.crop, v.area_sqm::float8, v.planted_at::timestamptz,
       v.expected_harvest_at::timestamptz, v.status, v.category, v.soil_notes, now()
FROM (VALUES
  ('22222222-2222-4222-8222-222222222201','DEMO แปลงทุเรียน','โซน A','ทุเรียน',1600, now()-interval '90 days', now()-interval '3 days','growing','GENERAL','ดินร่วน pH 6.2'),
  ('22222222-2222-4222-8222-222222222202','DEMO แปลงผักสลัด','โซน B','ผักสลัด',120, now()-interval '25 days', now()+interval '3 days','growing','GENERAL','รดน้ำวันละ 2 ครั้ง'),
  ('22222222-2222-4222-8222-222222222203','DEMO แปลงข้าว','โซน C','ข้าว',4800, now()-interval '60 days', now()+interval '30 days','growing','GENERAL',NULL),
  ('22222222-2222-4222-8222-222222222204','DEMO แปลงพักดิน','โซน C','-',800, NULL, NULL,'fallow','GENERAL','ใส่ปุ๋ยคอกแล้ว'),
  ('22222222-2222-4222-8222-222222222205','DEMO แปลงสมุนไพร','โซน D','ฟ้าทะลายโจร',300, now()-interval '40 days', now()+interval '10 days','growing','HERB',NULL),
  ('22222222-2222-4222-8222-222222222206','DEMO แปลงมะเขือเทศ','โซน B','มะเขือเทศ',200, now()-interval '100 days', now()-interval '10 days','harvested','GENERAL',NULL),
  ('22222222-2222-4222-8222-222222222207','DEMO แปลงกล้วย','โซน E','กล้วย',900, now()-interval '120 days', now()+interval '25 days','growing','GENERAL',NULL),
  ('22222222-2222-4222-8222-222222222208','DEMO แปลงอ้อย','โซน E','อ้อย',2400, now()-interval '30 days', now()+interval '40 days','active','GENERAL',NULL)
) AS v(id,name,location,crop,area_sqm,planted_at,expected_harvest_at,status,category,soil_notes);

-- ── ปศุสัตว์ 4 กลุ่ม (ไก่ติดหยุดยา+อัตราตาย, สุกรวัคซีนเกิน, เป็ดกักกัน, โคใกล้วัคซีน) ─
INSERT INTO livestock_groups (id,code,name,species,quantity,"birthDate","houseCode",status,notes,"quarantineEndAt",updated_at)
SELECT v.id::uuid, v.code, v.name, v.species, v.quantity::int, v."birthDate"::timestamptz,
       v."houseCode", v.status, v.notes, v."quarantineEndAt"::timestamptz, now()
FROM (VALUES
  ('11111111-1111-4111-8111-111111111101','DEMO-BROILER-01','เล้าไก่หลังโรงนา','POULTRY_BROILER',500, now()-interval '28 days','HOUSE-01','ACTIVE','ตัวอย่าง: ติดระยะหยุดยา + อัตราตาย 2.4%',NULL),
  ('11111111-1111-4111-8111-111111111102','DEMO-SWINE-02','คอกสุกร 2','SWINE',40, now()-interval '30 days','HOUSE-02','ACTIVE','ตัวอย่าง: วัคซีนเกินกำหนด',NULL),
  ('11111111-1111-4111-8111-111111111103','DEMO-DUCK-01','บ่อเป็ด','DUCK',300, now()-interval '45 days','HOUSE-03','QUARANTINE','ตัวอย่าง: กักกันโรค', now()+interval '7 days'),
  ('11111111-1111-4111-8111-111111111104','DEMO-CATTLE-01','คอกโค','CATTLE',20, now()-interval '88 days','HOUSE-04','ACTIVE','ตัวอย่าง: วัคซีนใกล้ถึงกำหนด',NULL)
) AS v(id,code,name,species,quantity,"birthDate","houseCode",status,notes,"quarantineEndAt");

-- ── ยา: 1 รายการยังติดระยะหยุดยา (critical) + 1 รายการพ้นแล้ว ────────────────
INSERT INTO livestock_medical_records (id,"livestockGroupId","drugName","dosageMgKg","administeredAt","withdrawalDays","safeHarvestDate")
VALUES
  (gen_random_uuid(),'11111111-1111-4111-8111-111111111101','Enrofloxacin',10, now()-interval '5 days',10, now()+interval '5 days'),
  (gen_random_uuid(),'11111111-1111-4111-8111-111111111101','Amoxicillin',15, now()-interval '20 days',7, now()-interval '13 days');

-- ── วัคซีน: เกินกำหนด 1 + ใกล้ถึงกำหนด 1 + เสร็จแล้ว 1 ─────────────────────
INSERT INTO livestock_vaccine_schedules (id,"livestockGroupId","vaccineName","targetAgeDays","isCompleted","completedAt")
VALUES
  (gen_random_uuid(),'11111111-1111-4111-8111-111111111102','FMD',21,false,NULL),
  (gen_random_uuid(),'11111111-1111-4111-8111-111111111104','FMD',90,false,NULL),
  (gen_random_uuid(),'11111111-1111-4111-8111-111111111101','Newcastle',7,true, now()-interval '20 days');

-- ── ผลผลิตรายวัน 6 วัน: ไก่ตายรวม 12 ตัว (2.4% ของ 500) ─────────────────────
INSERT INTO livestock_daily_logs (id,"livestockGroupId","logDate","mortalityCount","culledCount","feedConsumedKg","waterConsumedL")
SELECT gen_random_uuid(),'11111111-1111-4111-8111-111111111101', now()-(g||' days')::interval,
       CASE WHEN g IN (1,2) THEN 3 ELSE 2 END, 0, 55, 120
FROM generate_series(1,6) AS g;

INSERT INTO livestock_daily_logs (id,"livestockGroupId","logDate","mortalityCount","culledCount","feedConsumedKg")
VALUES (gen_random_uuid(),'11111111-1111-4111-8111-111111111103', now()-interval '1 day',1,0,40);

-- ── ไซโล: ใกล้หมด (critical) + เหลือน้อยกว่า 30% (warning) ─────────────────
INSERT INTO livestock_feed_silos (id,"siloCode","capacityKg","currentKg","lastRefillAt")
VALUES
  ('33333333-3333-4333-8333-333333333301','DEMO-SILO-A',1000,100, now()-interval '10 days'),
  ('33333333-3333-4333-8333-333333333302','DEMO-SILO-B',2000,500, now()-interval '5 days');

-- ── ภูมิอากาศ: THI 80.5 (ความเครียดร้อนรุนแรง) ──────────────────────────────
INSERT INTO livestock_climate_logs (id,"houseCode","tempC","rhPct",thi,status,at)
VALUES ('44444444-4444-4444-8444-444444444401','HOUSE-01',35.5,70,80.5,'SEVERE', now());

COMMIT;
