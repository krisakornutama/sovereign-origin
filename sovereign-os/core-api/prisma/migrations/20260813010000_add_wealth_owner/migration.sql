-- พอร์ตแยกต่อคน (Family members): ใส่ user_id ให้ assets / inventory_items / wealth_history
-- แถวที่มีอยู่เดิมทั้งหมดยกให้ SUPERADMIN (ผู้ดูแล) — ไม่ทิ้งข้อมูลเดิม

-- 1) เพิ่มคอลัมน์ (nullable ก่อน เพื่อให้ backfill ได้)
ALTER TABLE "assets" ADD COLUMN "user_id" UUID;
ALTER TABLE "inventory_items" ADD COLUMN "user_id" UUID;
ALTER TABLE "wealth_history" ADD COLUMN "user_id" UUID;

-- 2) Backfill แถวเดิม → ผู้ใช้ SUPERADMIN (เลือก 'admin' ก่อน ถ้าไม่มีก็ SUPERADMIN คนแรก)
-- (สำคัญ: อย่าใช้ ORDER BY id เพราะ user ทดสอบอย่าง mock-admin อาจมี UUID น้อยกว่าจริง ๆ)
UPDATE "assets" SET "user_id" = (
  SELECT id FROM "users" WHERE role = 'SUPERADMIN' AND username = 'admin' ORDER BY id LIMIT 1
) WHERE "user_id" IS NULL;
UPDATE "assets" SET "user_id" = (
  SELECT id FROM "users" WHERE role = 'SUPERADMIN' ORDER BY id LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "inventory_items" SET "user_id" = (
  SELECT id FROM "users" WHERE role = 'SUPERADMIN' AND username = 'admin' ORDER BY id LIMIT 1
) WHERE "user_id" IS NULL;
UPDATE "inventory_items" SET "user_id" = (
  SELECT id FROM "users" WHERE role = 'SUPERADMIN' ORDER BY id LIMIT 1
) WHERE "user_id" IS NULL;

UPDATE "wealth_history" SET "user_id" = (
  SELECT id FROM "users" WHERE role = 'SUPERADMIN' AND username = 'admin' ORDER BY id LIMIT 1
) WHERE "user_id" IS NULL;
UPDATE "wealth_history" SET "user_id" = (
  SELECT id FROM "users" WHERE role = 'SUPERADMIN' ORDER BY id LIMIT 1
) WHERE "user_id" IS NULL;

-- 3) บังคับ NOT NULL + FK + index
ALTER TABLE "assets" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "inventory_items" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "wealth_history" ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wealth_history" ADD CONSTRAINT "wealth_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_assets_user_id" ON "assets"("user_id");
CREATE INDEX IF NOT EXISTS "idx_inventory_items_user_id" ON "inventory_items"("user_id");
CREATE INDEX IF NOT EXISTS "idx_wealth_history_user_id_time" ON "wealth_history"("user_id", "timestamp" DESC);
