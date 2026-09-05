-- Dime! Statement — ขยาย: เก็บรายละเอียดจากสเตตเมนต์ครบทุกคอลัมน์
-- 1) asset_positions: ชื่อบริษัท + allocation/P&L ต่อหุ้น (จากตารางหน้า 3)
-- 2) dime_statements: สรุปหน้าแรก (ยอดรวม/เงินสด/FX/เลขบัญชี/Tax ID + sector allocation)

ALTER TABLE "asset_positions" ADD COLUMN IF NOT EXISTS "company_name" TEXT;
ALTER TABLE "asset_positions" ADD COLUMN IF NOT EXISTS "allocation_pct" DOUBLE PRECISION;
ALTER TABLE "asset_positions" ADD COLUMN IF NOT EXISTS "total_return_pct" DOUBLE PRECISION;
ALTER TABLE "asset_positions" ADD COLUMN IF NOT EXISTS "total_return_usd" DOUBLE PRECISION;

ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "account_no" TEXT;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "investment_account_no" TEXT;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "tax_id" TEXT;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "tax_invoice_no" TEXT;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "branch_no" TEXT;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "fx_rate" DOUBLE PRECISION;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "total_balance_usd" DOUBLE PRECISION;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "total_balance_thb" DOUBLE PRECISION;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "cash_balance_usd" DOUBLE PRECISION;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "cash_balance_thb" DOUBLE PRECISION;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "total_return_pct" DOUBLE PRECISION;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "total_return_usd" DOUBLE PRECISION;
ALTER TABLE "dime_statements" ADD COLUMN IF NOT EXISTS "sectors" JSONB;