-- Dime! Statement — สเตตเมนต์รายเดือนจากโบรกเกอร์ Dime ส่งทางอีเมล
-- วงจร: IMAP ดึงอีเมล unread → ดาวน์โหลด PDF → parse ยอดถือครองหุ้น US →
--       upsert AssetPosition (STOCK) + AssetPrice → เก็บ raw ไว้เป็น history

CREATE TABLE IF NOT EXISTS "dime_statements" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "statement_period" TEXT NOT NULL,
  "message_id" TEXT UNIQUE,
  "raw_text_hash" TEXT UNIQUE,
  "source" TEXT NOT NULL DEFAULT 'EMAIL',
  "subject" TEXT,
  "assets" JSONB NOT NULL DEFAULT '[]',
  "skipped" JSONB,
  "parsed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dime_statements_user_parsed
  ON "dime_statements" ("user_id", "parsed_at" DESC);
