-- Treasury & Wealth Engine — LIFE & FINANCE consolidation
-- 1) assets → asset_positions (AssetPosition): + strategy family, avg cost, dividend yield, catalyst, realized gain
-- 2) personal_balance_sheets: เงินสด/หนี้สิน/ค่าใช้จ่ายรายเดือน (ผูก 1:1 ต่อผู้ใช้)
-- 3) survival_runways: สแนปชอตจำนวนเดือนที่อยู่รอด (คำนวณทุกครั้งแบบไดนามิก)
-- 4) treasury_events: ฟีดรายได้ (ปันผล/กำไรรับรู้) — ทุก event อัปเดตยอดเงินสดอัตโนมัติ

ALTER TABLE "assets" RENAME TO "asset_positions";

ALTER TABLE "asset_positions"
  ADD COLUMN IF NOT EXISTS "strategy_family" TEXT NOT NULL DEFAULT 'FUNDAMENTAL',
  ADD COLUMN IF NOT EXISTS "avg_cost_usd" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "expected_dividend_yield_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "catalyst_note" TEXT,
  ADD COLUMN IF NOT EXISTS "last_dividend_usd" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "last_dividend_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "realized_gain_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sold_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_asset_positions_strategy_family
  ON "asset_positions" ("strategy_family");

CREATE TABLE IF NOT EXISTS "personal_balance_sheets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "liquid_cash_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "liabilities_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "monthly_burn_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "monthly_income_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personal_balance_sheets_user_id_key" UNIQUE ("user_id")
);

CREATE TABLE IF NOT EXISTS "survival_runways" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "months" DOUBLE PRECISION NOT NULL,
  "liquid_cash_usd" DOUBLE PRECISION NOT NULL,
  "annualized_dividend_usd" DOUBLE PRECISION NOT NULL,
  "monthly_burn_usd" DOUBLE PRECISION NOT NULL,
  "snapshot_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_survival_runways_user_snapshot
  ON "survival_runways" ("user_id", "snapshot_at" DESC);

CREATE TABLE IF NOT EXISTS "treasury_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "symbol" TEXT,
  "asset_position_id" UUID REFERENCES "asset_positions"("id") ON DELETE SET NULL,
  "amount_usd" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_treasury_events_user_created
  ON "treasury_events" ("user_id", "created_at" DESC);