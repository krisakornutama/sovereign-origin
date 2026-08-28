-- S5+S6 missing tables
CREATE TABLE IF NOT EXISTS herb_catalogs (
  id UUID PRIMARY KEY,
  "herbId" TEXT UNIQUE NOT NULL,
  "thaiName" TEXT NOT NULL,
  "latinName" TEXT,
  uses JSONB,
  warnings JSONB,
  contraindications JSONB,
  "growthDays" INTEGER,
  "idealSoil" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dose_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  "herbId" TEXT NOT NULL,
  "herbName" TEXT,
  quantity DOUBLE PRECISION,
  unit TEXT,
  dose TEXT,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dose_logs_user_id_idx ON dose_logs(user_id);
CREATE TABLE IF NOT EXISTS herb_beds (
  id UUID PRIMARY KEY,
  plot_id UUID NOT NULL REFERENCES farm_plots(id) ON DELETE CASCADE,
  name TEXT,
  crop TEXT NOT NULL,
  x_m DOUBLE PRECISION DEFAULT 0,
  y_m DOUBLE PRECISION DEFAULT 0,
  width_m DOUBLE PRECISION DEFAULT 0.5,
  length_m DOUBLE PRECISION DEFAULT 0.5,
  status TEXT DEFAULT 'active',
  planted_at TIMESTAMPTZ,
  expected_harvest_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS herb_beds_plot_id_idx ON herb_beds(plot_id);
CREATE TABLE IF NOT EXISTS skill_matrix (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  level INTEGER DEFAULT 1,
  note TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, skill)
);
CREATE INDEX IF NOT EXISTS skill_matrix_skill_idx ON skill_matrix(skill);
CREATE TABLE IF NOT EXISTS crisis_modes (
  id UUID PRIMARY KEY,
  mode TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT false,
  actions JSONB,
  "activatedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Seed herb catalog 12 items
INSERT INTO herb_catalogs ("id","herbId","thaiName","uses","warnings","contraindications","growthDays") VALUES
 (gen_random_uuid(),'andrographis','ฟ้าทะลายโจร','["ลดไข้","ต้านอักเสบ"]','["ห้ามเกิน 7 วัน"]','["pregnancy","hypotension"]',90),
 (gen_random_uuid(),'turmeric','ขมิ้นชัน','["ลดอักเสบ","ช่วยย่อย"]','["ระวังนิ่ว"]','["kidney_disease","gallbladder"]',240),
 (gen_random_uuid(),'hibiscus','กระเจี๊ยบแดง','["ขับปัสสาวะ"]','[]','["hypotension","pregnancy"]',120),
 (gen_random_uuid(),'ginger','ขิง','["เจริญอาหาร"]','[]','["anticoagulant"]',120),
 (gen_random_uuid(),'gotu-kola','บัวบก','["ฟื้นฟู"]','[]','["pregnancy"]',60),
 (gen_random_uuid(),'amla','มะขามป้อม','["วิตามินซี"]','[]','[]',365),
 (gen_random_uuid(),'safflower','ดอกคำฝอย','["ผ่อนคลาย"]','[]','["anticoagulant"]',120),
 (gen_random_uuid(),'basil','กระเพรา','["ขับลม"]','[]','[]',45),
 (gen_random_uuid(),'lemongrass','ตะไคร้','["ขับลม"]','[]','[]',90),
 (gen_random_uuid(),'aloe','ว่านหางจระเข้','["แผล"]','[]','[]',180),
 (gen_random_uuid(),'reishi','เห็ดหลินจือ','["กระตุ้นภูมิ"]','["หยุดก่อนผ่าตัด"]','["anticoagulant"]',90),
 (gen_random_uuid(),'rang_jeud','รางจืด','["ถอนพิษ"]','[]','[]',60)
ON CONFLICT ("herbId") DO NOTHING;
-- Seed crisis modes
INSERT INTO crisis_modes (id, mode, active, actions) VALUES
 (gen_random_uuid(),'flood',false,'["ปิดรีเลย์ non-critical","สำรองข้อมูล","DEFCON 2"]'),
 (gen_random_uuid(),'blackout',false,'["ปิดรีเลย์ non-critical","ประหยัดไฟ","สำรองข้อมูล"]'),
 (gen_random_uuid(),'security',false,'["DEFCON 1","ล็อกประตู","เปิดกล้อง"]')
ON CONFLICT (mode) DO NOTHING;
