# Migration Runbook — baseline → prod

> ใช้เมื่อต้อง deploy โค้ดที่มี `prisma/migrations/20261107190000_baseline` ขึ้น environment ที่ **มีข้อมูลอยู่แล้ว**
> ขอบเขต: `sovereign-os/core-api` (Postgres/TimescaleDB) · CI และ DB ใหม่ใช้ `migrate deploy` ตรง ๆ ได้เลย

## 1) สถานะปัจจุบัน (สำคัญ)

| อย่าง | ค่า |
|---|---|
| migration ที่ถูก apply | `prisma/migrations/20261107190000_baseline` (ตัวเดียว) |
| migration เก่า 74 ตัว | `prisma/migrations_archive/` — **ประวัติเท่านั้น ไม่ถูก apply** |
| สาเหตุที่ squash | chain เดิมตาม `schema.prisma` ไม่ทัน (`users.token_version`, UUID หลายตารางถูกเพิ่มด้วย `db push`) → `migrate deploy` บน DB ว่างได้ schema ที่ PrismaClient ใช้ไม่ได้ |
| ห้ามใช้ | `prisma db push` ในสคริปต์/CI (มี gate `tools/test/no-db-push-gate.test.mjs`) |

**baseline ถูกสร้างจาก `schema.prisma` โดยตรง** (`prisma migrate diff --from-empty --to-schema-datamodel ... --script`)
จึงไม่มี `sensor_telemetry` เพราะ model ถูก `@@ignore` — ตารางนี้สร้างแยกด้วย `scripts/ci-timescale-ignored.sql`

## 2) เลือกเส้นทางให้ถูก

| สภาพ DB | สิ่งที่ต้องทำ |
|---|---|
| DB ใหม่/ว่าง (CI, community install, staging ใหม่) | `npx prisma migrate deploy` แล้วตามด้วย DDL ของตาราง `@@ignore` |
| DB ที่มีข้อมูลและ schema ตรงกับ `schema.prisma` อยู่แล้ว (dev เครื่องนี้, prod) | **ห้ามรัน baseline** → `migrate resolve --applied` แล้ว `migrate deploy` (จะไม่มีอะไรค้าง) |

เหตุผล: baseline มีคำสั่งแบบ `DROP COLUMN`/`ADD COLUMN ... NOT NULL` จากการ diff จาก DB ว่าง
ถ้าไปรันบน DB ที่มีข้อมูลจะล้มกลางทาง (หรือแย่กว่า: ทำให้ข้อมูลหาย)

## 3) ขั้นตอน deploy prod (DB ที่มีข้อมูล)

```bash
cd sovereign-os/core-api
export DATABASE_URL='postgresql://…'   # ห้าม echo ค่านี้ออก log

# 0) backup ก่อนเสมอ — ถ้า dump ไม่ผ่าน ให้หยุด
pg_dump --format=custom --file=/backup/sovereign-$(date +%F-%H%M).dump "$DATABASE_URL"

# 1) ดูว่า schema ปัจจุบันต่างจาก schema.prisma ตรงไหน
#    diff จะ "ไม่ว่าง" เสมอ (index/constraint/default ที่ migration เดิมสร้างแต่ schema ไม่ประกาศ)
#    → สนใจเฉพาะ ADD COLUMN / CREATE TABLE ที่ขาดจริง ถ้าไม่มี = schema พร้อมแล้ว
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script | grep -E "ADD COLUMN|CREATE TABLE" | head -20

# 2) migrate status จะ exit 1 พร้อมเตือน "migrations from the database are not found locally"
#    เพราะ prod ยังมีประวัติ migration เก่าที่ถูก squash ไปแล้ว — ล้างเฉพาะแถวประวัตินั้น
#    (แก้เฉพาะ _prisma_migrations ไม่แตะข้อมูลธุรกิจ)
psql "$DATABASE_URL" -c "delete from _prisma_migrations where migration_name <> '20261107190000_baseline'"

# 3) ทำเครื่องหมายว่า baseline ถูก apply แล้ว (ไม่รัน SQL)
npx prisma migrate resolve --applied 20261107190000_baseline

# 4) ยืนยันว่าไม่มี migration ค้าง
npx prisma migrate status          # ต้องขึ้น "Database schema is up to date!"

# 5) deploy ตามปกติ (จะ apply 20261107190001_non_prisma_objects ถ้ารอบนี้ยังไม่เคยรัน)
npx prisma migrate deploy

# 6) ตรวจหลัง deploy
npx prisma migrate status
psql "$DATABASE_URL" -Atc "select column_name from information_schema.columns
  where table_name='users' and column_name='token_version'"   # ต้องได้ token_version
```

ถ้าเจอ `P3005`/`P3009` (migration history ไม่ตรง) **ห้าม** `migrate reset` — กลับไปดู backup และตรวจ `_prisma_migrations` ก่อน

## 4) ขั้นตอน DB ใหม่ (CI / community / staging ใหม่)

```bash
cd sovereign-os/core-api
npx prisma migrate deploy
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ci-timescale-ignored.sql
```

`ci-timescale-ignored.sql` เป็น idempotent (IF NOT EXISTS / if_not_exists) จึงรันซ้ำได้
DDL นี้ต้องตรงกับ `model SensorTelemetry` — มี arch-gate ตรวจให้ (`tools/test/ci-ddl-sync.test.mjs`)

## 5) Rollback

- **ยังไม่รัน resolve**: ไม่มีอะไรเปลี่ยน — แค่ยกเลิก deploy
- **resolve แล้วแต่ `migrate deploy` ยังไม่รัน**: ลบแถว `_prisma_migrations` ของ baseline (ไม่แตะข้อมูล) แล้วเริ่มใหม่
- **deploy ไปแล้วและมีปัญหา**: restore จาก dump ข้อ 0 — baseline ไม่มี down migration โดยเจตนา

## 6) Checklist ก่อนปิดงาน

- [ ] backup dump สำเร็จและเปิดอ่านได้
- [ ] `migrate status` = up to date ทั้งก่อนและหลัง
- [ ] `users.token_version` / ตารางใหม่มีจริง
- [ ] API เริ่มทำงานได้ (health endpoint 200)
- [ ] ไม่มีใครรัน `db push` (gate ต้องเขียว)

## 7) กติกาสำหรับอนาคต

- แก้ `schema.prisma` → สร้าง migration **ใหม่ต่อจาก baseline** (`npx prisma migrate dev --name ...`) ห้ามแก้ baseline ที่ commit แล้ว
- ห้ามลบ `migrations_archive/` (ใช้ตรวจย้อนหลังและเป็นหลักฐานว่า DDL เดิมหน้าตาอย่างไร)
- เปลี่ยน `SensorTelemetry` → อัปเดต `scripts/ci-timescale-ignored.sql` ด้วย ไม่งั้น arch-gate แดง
- เพิ่ม view/trigger/function → ใส่ใน `prisma/migrations/20261107190001_non_prisma_objects/` (Prisma ไม่เห็น object เหล่านี้ใน schema)
  ตัวอย่างที่เคยพลาด: `fleet_audit_view`, `sensor_telemetry_hourly` — ซ้อม deploy แล้วเทสต์ real-DB ล้มทั้งชุดเพราะ view หาย

## 8) ผลซ้อม (dry-run บนสำเนา DB dev)

ซ้อมตามขั้นตอนด้านบนบนสำเนา (`prod_dryrun`) โดยจำลองว่า prod ยังมีประวัติ migration เก่าและยังไม่รู้จัก baseline:

| ขั้น | ผลจริง |
|---|---|
| `migrate status` ก่อนเริ่ม | exit 1 + "migrations from the database are not found locally" → ต้องล้างแถวประวัติเก่าก่อน (ขั้นตอนข้อ 2) |
| diff | ไม่ว่าง (~700 บรรทัด DROP CONSTRAINT/index) แต่ไม่มี `ADD COLUMN` ที่ขาด → ปลอดภัย |
| `resolve --applied` → `migrate status` | ผ่าน ขึ้น up to date |
| `migrate deploy` | "No pending migrations" (หรือ apply `non_prisma_objects` ถ้ายังไม่เคยรัน) |
| ตรวจ `users.token_version` + จำนวน users | ครบ (7 users เท่าเดิม) |

สิ่งที่ซ้อมแล้วเจอจนต้องแก้โค้ด: baseline จาก schema ไม่มี view/`sensor_telemetry` → เพิ่ม `20261107190001_non_prisma_objects` และยืนยันว่า `npm run test:db` เขียว
