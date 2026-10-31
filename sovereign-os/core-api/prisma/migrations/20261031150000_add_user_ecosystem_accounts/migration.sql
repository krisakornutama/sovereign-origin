-- Ecosystem ของผู้ใช้ — บัญชี/platform ที่เจ้าของผูกไว้ในที่เดียว
-- เก็บ login_id + password_enc แบบเข้ารหัส AES-256-GCM (enc:v1:...) ผ่าน field-crypto.service
-- เป้าหมาย: "ไม่เห็นคอมเมนต์/ไม่เห็นข้อความลูกค้า" เพราะไม่รู้ว่าจะเข้า platform ไหนด้วยบัญชีใด

CREATE TABLE "user_ecosystem_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'custom',
    "label" TEXT NOT NULL,
    "url" TEXT,
    "login_id" TEXT,
    "password_enc" TEXT,
    "notes" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMPTZ(6),
    "password_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_ecosystem_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_ecosystem_accounts_user_id_platform_idx" ON "user_ecosystem_accounts"("user_id", "platform");
CREATE INDEX "user_ecosystem_accounts_user_id_status_idx" ON "user_ecosystem_accounts"("user_id", "status");

ALTER TABLE "user_ecosystem_accounts"
    ADD CONSTRAINT "user_ecosystem_accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
