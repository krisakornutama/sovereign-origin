-- P17 — กันสแปมใบสมัครคู่ค้า: เก็บชื่อ normalized เพื่อเช็คซ้ำ
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "name_normalized" TEXT NOT NULL DEFAULT '';

-- เติมค่าย้อนหลังให้แถวเดิม (ตัดวรรณยุกต์/ช่องว่างซ้ำ → lower)
UPDATE "partners"
SET "name_normalized" = LOWER(REGEXP_REPLACE(TRIM("name"), '[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\s]+', '', 'g'))
WHERE "name_normalized" = '';

CREATE INDEX IF NOT EXISTS "partners_name_normalized_idx" ON "partners" ("name_normalized");
