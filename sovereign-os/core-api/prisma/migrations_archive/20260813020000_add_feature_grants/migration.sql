-- สิทธิ์ฟังก์ชั่นต่อคน (Family member feature grants)
-- feature = key ของหน้า เช่น "/portfolio" | "/health" | "/farm"
-- SUPERADMIN เห็นทุกอย่างเสมอ — สมาชิกเห็นเฉพาะหน้าที่ถูกกำหนด (ตารางนี้)
CREATE TABLE "user_feature_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "feature" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "user_feature_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_feature_grants_user_id_feature_key" UNIQUE ("user_id", "feature")
);

ALTER TABLE "user_feature_grants" ADD CONSTRAINT "user_feature_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "idx_user_feature_grants_user" ON "user_feature_grants"("user_id");
