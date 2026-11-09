-- Machine role / owner / LAN-pairing (เจ้าของสั่ง 11/10/69)
--
-- เป้าหมาย (ตรงตามที่เจ้าของยืนยันด้วยคำพูด):
--   1) เครื่อง USER สั่งงาน AI ได้ แต่คุมเครื่องอื่นไม่ได้
--   2) เครื่องหนึ่งอยู่ใต้ SUPERADMIN ได้หลายคน (มีได้ 1–2 คน) ⇒ many-to-many
--   3) ยืนยัน LAN ต้องกดยืนยันบนเครื่องเป้าหมาย
--
-- หลักการ: เพิ่มล้วน ไม่ลบ ไม่แก้ค่าของเดิมที่ผู้ใช้สั่ง
--   - เครื่องที่มีอยู่แล้ว → role = 'USER' (ปลอดภัยเป็นค่าเริ่มต้น ไม่ให้ใครคุมใครเงียบ ๆ)
--   - ไม่ผูก owner ให้ใครล่วงหน้า (เจ้าของเป็นคนกดผูกเองในหน้า User)
--   - ไม่ยืนยัน LAN ให้ใคร (ต้องกดยืนยันบนเครื่องจริงตามข้อ 3)

-- AlterTable: สิทธิ์ + ยืนยัน
ALTER TABLE "agent_machines"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN "owner_user_id" UUID,
  ADD COLUMN "lan_confirmed_at" TIMESTAMPTZ,
  ADD COLUMN "pair_code_hash" TEXT,
  ADD COLUMN "pair_code_at" TIMESTAMPTZ;

-- CreateTable: ผูกเครื่อง ↔ ผู้ใช้ที่คุมได้ (หลายต่อหนึ่ง — ข้อ 2)
CREATE TABLE "agent_machine_hubs" (
    "machine_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_machine_hubs_pkey" PRIMARY KEY ("machine_id","user_id")
);

-- CreateIndex
CREATE INDEX "agent_machines_role_idx" ON "agent_machines"("role");
CREATE INDEX "agent_machines_owner_user_id_idx" ON "agent_machines"("owner_user_id");
CREATE INDEX "agent_machine_hubs_user_id_idx" ON "agent_machine_hubs"("user_id");

-- ForeignKey (SetNull ตามที่ประกาศใน schema — เครื่องไม่ผูก owner ก็ยังอยู่ได้)
ALTER TABLE "agent_machines"
  ADD CONSTRAINT "agent_machines_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_machine_hubs"
  ADD CONSTRAINT "agent_machine_hubs_machine_id_fkey"
  FOREIGN KEY ("machine_id") REFERENCES "agent_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_machine_hubs"
  ADD CONSTRAINT "agent_machine_hubs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;