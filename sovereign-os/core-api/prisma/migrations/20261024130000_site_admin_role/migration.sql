-- Phase 3B — site-scoped admin (SITE_ADMIN).
--
-- NOTE: intentionally minimal and hand-written. Do NOT regenerate with
-- `migrate diff --from-schema-datasource`: production carries unrelated drift.
--
-- Why ADD VALUE comes first and the new value is never used in this file:
-- Prisma runs each migration inside a transaction, and PostgreSQL refuses to use
-- an enum value in the same transaction that added it. Nothing here needs it.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SITE_ADMIN';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "assigned_site_id" UUID;

-- CreateIndex
CREATE INDEX "users_assigned_site_id_idx" ON "users"("assigned_site_id");

-- AddForeignKey
-- ลบสาขา → ผู้ใช้ยังอยู่แต่หลุดขอบเขต (SetNull). resolveFleetScope จะปฏิเสธแบบ fail closed
-- แทนที่จะตีความว่า "ไม่มีสาขา = เห็นทุกสาขา"
ALTER TABLE "users" ADD CONSTRAINT "users_assigned_site_id_fkey" FOREIGN KEY ("assigned_site_id") REFERENCES "fleet_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
