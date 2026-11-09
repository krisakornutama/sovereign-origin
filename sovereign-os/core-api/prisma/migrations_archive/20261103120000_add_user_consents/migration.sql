-- PDPA — ความยินยอมของผู้ใช้ + ประวัติการเปลี่ยนแปลง
-- ทำไมอยู่ใน DB: ต้องตอบ "ใครยินยอมอะไร เมื่อไร ด้วยนโยบายเวอร์ชันไหน" ได้ย้อนหลัง
-- ⚠ ห้ามเก็บเนื้อหาข้อมูลส่วนบุคคลในตารางนี้ — เก็บเฉพาะสถานะความยินยอม

CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "ip" TEXT,
    "granted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- สิทธิ์ถูกลืม: บัญชีที่ถูกทำให้ไม่ระบุตัวตนแล้วยังต้องมีแถวไว้ให้ audit อ้างอิง
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "user_consents_user_id_purpose_key" ON "user_consents"("user_id", "purpose");
CREATE INDEX "user_consents_user_id_idx" ON "user_consents"("user_id");
CREATE INDEX "consent_events_user_id_created_at_idx" ON "consent_events"("user_id", "created_at");

ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
