-- Migration 13: Sovereign Buddhist Healing Module + Coding Agent jobs

CREATE TABLE IF NOT EXISTS "buddhist_teachings" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'ทุกข์ & โรค',
  "category_tags" JSONB,
  "content" TEXT NOT NULL,
  "application" TEXT,
  "source" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "buddhist_teachings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "meditation_sessions" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'หายใจ',
  "duration_min" INTEGER NOT NULL DEFAULT 5,
  "note" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meditation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "healing_logs" (
  "id" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "logged_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "healing_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "coding_jobs" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "task" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "plan_json" JSONB,
  "files_json" JSONB,
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "coding_jobs_pkey" PRIMARY KEY ("id")
);

-- Seed หลักธรรมพื้นฐานสำหรับ AI Dhamma Companion
INSERT INTO "buddhist_teachings" ("id", "title", "category", "category_tags", "content", "application", "source") VALUES
  ('t-anathapindika', 'อนาถปิณฑิกสูตร', 'ทุกข์ & โรค', '["กลัว","ความเจ็บปวด","ทุกข์","ทรมาน"]', 'พระพุทธเจ้าทรงแสดงธรรมแก่อนาถปิณฑิกเศรษฐีผู้ป่วยหนักว่า รูป เวทนา สัญญา สังขาร วิญญาณ ล้วนเป็นอนิจจัง ทุกขัง อนัตตา — เมื่อเห็นเช่นนี้ ความทุกข์ก็คลายลง', 'เผชิญความเจ็บปวดด้วยการเห็นความจริงของสังขาร ไม่ปรุงแต่งทุกข์ซ้ำ', 'สังยุตตนิกาย มหาวารวรรค'),
  ('t-maranasati', 'มรณัสสติ', 'ความตาย', '["ตาย","ความตาย","มรณะ","จากไป","สิ้นอายุ"]', 'ความตายเป็นของธรรมดา ผู้เกิดมาแล้วย่อมตาย ผู้ใดระลึกถึงความตายอยู่เสมอ ย่อมไม่ประมาทในชีวิต', 'เตรียมใจรับความจริงของชีวิต ใช้ทุกวันให้มีค่า', 'มรณัสสติกถา — อังคุตตรนิกาย'),
  ('t-kammavibhanga', 'กัมมวิภังคสูตร', 'กรรม', '["กรรม","เหตุ","ผล","กรรมเก่า"]', 'กรรมทั้งหลายย่อมให้ผลตามชนิดของมัน — กรรมดีให้ผลดี กรรมชั่วให้ผลชั่ว เราเป็นเจ้าของกรรม รับผลของกรรม', 'เข้าใจเหตุของโรค/เหตุการณ์ ปล่อยวางการโทษตนเอง', 'มัชฌิมนิกาย อุปริปัณณาสก์'),
  ('t-mahasatipatthana', 'มหาสติปัฏฐานสูตร', 'สมาธิ', '["สมาธิ","สติ","หายใจ","เวทนา","จิต","ธรรม"]', 'ภิกษุพิจารณากายในกายอยู่ มีความเพียร มีสัมปชัญญะ มีสติ กำจัดอภิชฌาและโทมนัสในโลกได้ — หายใจเข้ายาวก็รู้ชัด หายใจออกยาวก็รู้ชัด', 'ฝึกจิตให้ไม่หวั่นไหว รู้เท่าทันเวทนา', 'ทีฆนิกาย มหาวรรค'),
  ('t-bhesajja', 'เภสัชชักขันธกะ', 'การรักษา', '["รักษา","ยา","สมุนไพร","ป่วย","หมอ"]', 'ภิกษุไข้ใช้ยาและสมุนไพรตามที่แพทย์แนะนำได้ — พระพุทธองค์ทรงอนุญาตเภสัช 5 คือ เนยใส เนยข้น น้ำมัน น้ำผึ้ง น้ำอ้อย', 'ใช้สมุนไพรควบคู่ยาแผนปัจจุบัน ตามคำแนะนำของแพทย์', 'วินัยปิฎก มหาวรรค เภสัชชักขันธกะ'),
  ('t-anatta', 'อนัตตลักขณสูตร', 'อนัตตา', '["อนัตตา","ไม่ใช่เรา","ไม่ใช่ของเรา","ปล่อยวาง","ร่างกาย"]', 'รูป เวทนา สัญญา สังขาร วิญญาณ ล้วนเป็นอนัตตา — ผู้ใดเห็นอนัตตา ย่อมเบื่อหน่าย คลายกำหนัด หลุดพ้น', 'เห็นว่าร่างกายไม่ใช่ของเรา ปล่อยวางความกลัวตาย', 'สังยุตตนิกาย ขันธวารวรรค')
ON CONFLICT ("id") DO NOTHING;
