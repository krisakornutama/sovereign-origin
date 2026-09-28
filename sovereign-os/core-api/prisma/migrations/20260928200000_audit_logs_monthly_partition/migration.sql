-- I3b (28/9/69): audit_logs → declarative monthly partitioning RANGE ("timestamp")
-- เหตุผล: โตไม่จำกัดทั้งที่เป็น append-only (เกณฑ์ H1 วัดจริง ~26k แถว/2เดือน ~600/วัน — monthly พอ)
-- การย้าย: rename ของเดิม → สร้างตารางแบ่ง → INSERT..SELECT ครั้งเดียว (26k แถว = ล็อกสั้น) → ทิ้งของเดิม
-- กฎ Postgres: PK ของตารางแบ่งต้องมี partition key → PK กลายเป็น (id, "timestamp") — โค้ดไม่มี findUnique ตาม id เดี่ยว (ตรวจแล้ว)
BEGIN;
ALTER TABLE "audit_logs" RENAME TO "audit_logs_old";
-- RENAME TABLE ไม่เปลี่ยนชื่อ constraint/index — ต้องย้ายชื่อออกก่อน ไม่งั้นตารางใหม่ชนชื่อ
ALTER TABLE "audit_logs_old" RENAME CONSTRAINT "audit_logs_pkey" TO "audit_logs_pkey_old";
ALTER TABLE "audit_logs_old" RENAME CONSTRAINT "audit_logs_user_id_fkey" TO "audit_logs_user_id_fkey_old";

CREATE TABLE "audit_logs" (
    "id" uuid NOT NULL,
    "timestamp" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" uuid,
    "action_type" text NOT NULL,
    "payload" jsonb NOT NULL,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "timestamp"),
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL
) PARTITION BY RANGE ("timestamp");

-- ดัชนีค้นตามเวลา (หน้า audit เรียง desc — เดิมไม่มีดัชนีนี้เลย)
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp" DESC);

-- partition เดือนที่มีข้อมูลเดิม + ล่วงหน้าถึง 2027-01 + default (กันล้น)
CREATE TABLE "audit_logs_2026_08" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "audit_logs_2026_09" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "audit_logs_2026_10" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "audit_logs_2026_11" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "audit_logs_2026_12" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "audit_logs_2027_01" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "audit_logs_default" PARTITION OF "audit_logs" DEFAULT;

INSERT INTO "audit_logs" ("id", "timestamp", "user_id", "action_type", "payload")
SELECT "id", "timestamp", "user_id", "action_type", "payload" FROM "audit_logs_old";

DROP TABLE "audit_logs_old";
COMMIT;
