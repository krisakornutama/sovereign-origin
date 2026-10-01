-- F2b (1/10/69): เข้ารหัส field PII — เพิ่มคอลัมน์ hash คู่สำหรับค้นหาแบบเท่ากัน
-- encryptField ใช้ random-IV → WHERE ตรง ๆ ไม่ได้ · hash = HMAC-SHA256(normalize(phone), fieldKey)
-- house convention: additive เท่านั้น + IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม
-- หมายเหตุ: เข้ารหัสข้อมูลจริง (เขียนค่า enc:v1: แทน plaintext) ทำในขั้น deploy โดยสคริปต์ migrate แยก
-- เพราะต้องใช้ fieldKey จาก data/ mount ของ container ที่ deploy จริง (ไม่ใช่ไฟล์ migration)

ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "phone_hash" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "contact_phone_hash" TEXT;
CREATE INDEX IF NOT EXISTS "partners_phone_hash_idx" ON "partners"("phone_hash");
CREATE INDEX IF NOT EXISTS "partners_contact_phone_hash_idx" ON "partners"("contact_phone_hash");

ALTER TABLE "business_customers" ADD COLUMN IF NOT EXISTS "phone_hash" TEXT;
CREATE INDEX IF NOT EXISTS "business_customers_biz_phone_hash_idx" ON "business_customers"("businessId", "phone_hash");

ALTER TABLE "restaurant_customers" ADD COLUMN IF NOT EXISTS "phone_hash" TEXT;
CREATE INDEX IF NOT EXISTS "restaurant_customers_phone_hash_idx" ON "restaurant_customers"("phone_hash");

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "taxid_hash" TEXT;

-- business_suppliers.phone: ไม่มี lookup ในโค้ด → ใส่ hash ให้ครบธรรมเนียม F2b (ใช้ในอนาคต)
ALTER TABLE "business_suppliers" ADD COLUMN IF NOT EXISTS "phone_hash" TEXT;
