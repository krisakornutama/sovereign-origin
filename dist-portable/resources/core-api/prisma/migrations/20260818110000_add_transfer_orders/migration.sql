-- Transfer Orders — คำสั่งโอน/รับเงินจริง (แนบ ledger + ยืนยันด้วย txid)
-- วงจร: PENDING (สร้าง + QR PromptPay) → โอนจริง → VERIFIED (txid + อัปเดต ledger อัตโนมัติ)

CREATE TABLE IF NOT EXISTS "transfer_orders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('IN', 'OUT')),
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "amount_usd" DOUBLE PRECISION NOT NULL CHECK ("amount_usd" >= 0),
  "amount_thb" DOUBLE PRECISION CHECK ("amount_thb" IS NULL OR "amount_thb" >= 0),
  "payee" TEXT,
  "bank" TEXT,
  "account_number" TEXT,
  "note" TEXT,
  "ref_code" TEXT NOT NULL UNIQUE,
  "qr_payload" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'VERIFIED', 'CANCELLED')),
  "txid" TEXT,
  "evidence_url" TEXT,
  "requested_by" UUID NOT NULL REFERENCES "users"("id"),
  "verified_by" UUID REFERENCES "users"("id"),
  "verified_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transfer_orders_user_created
  ON "transfer_orders" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS idx_transfer_orders_status
  ON "transfer_orders" ("status");