-- Social Studio — ประวัติการโพสต์ + สถานะต่อแพลตฟอร์ม
-- ทำไมอยู่ใน DB: ประวัติต้องข้ามเครื่อง/ไม่หายเมื่อล้างเบราว์เซอร์
-- ⚠ ห้ามเก็บรหัสผ่าน/secret ในตารางนี้ (อ้างบัญชีด้วย account_id เท่านั้น)

CREATE TABLE "social_posts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "video_name" TEXT,
    "video_size" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_post_targets" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "account_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "external_url" TEXT,
    "external_id" TEXT,
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "social_post_targets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "social_posts_user_id_created_at_idx" ON "social_posts"("user_id", "created_at");
CREATE UNIQUE INDEX "social_post_targets_post_id_platform_key" ON "social_post_targets"("post_id", "platform");
CREATE INDEX "social_post_targets_account_id_idx" ON "social_post_targets"("account_id");

ALTER TABLE "social_posts"
    ADD CONSTRAINT "social_posts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_post_targets"
    ADD CONSTRAINT "social_post_targets_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_post_targets"
    ADD CONSTRAINT "social_post_targets_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "user_ecosystem_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
