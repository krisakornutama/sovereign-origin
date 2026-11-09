-- Ecosystem: ให้ Gmail เป็นบัญชีหลัก (เจ้าของมี platform ที่สมัครด้วยอีเมลเดียวกัน)
-- เพิ่มคอลัมน์เดียวแบบ nullable — แถวเดิมไม่ถูกแก้ (null = ยังไม่ผูก) และไม่ต้อง backfill
ALTER TABLE "user_ecosystem_accounts" ADD COLUMN "primary_account_id" UUID;

CREATE INDEX "user_ecosystem_accounts_primary_account_id_idx"
    ON "user_ecosystem_accounts"("primary_account_id");

-- ON DELETE SET NULL: ลบ Gmail หลัก = บัญชีลูกหลุดการผูก แต่ไม่ถูกลบตาม
ALTER TABLE "user_ecosystem_accounts"
    ADD CONSTRAINT "user_ecosystem_accounts_primary_account_id_fkey"
    FOREIGN KEY ("primary_account_id") REFERENCES "user_ecosystem_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
