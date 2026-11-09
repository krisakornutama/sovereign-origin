# Uninstall — verified run (Windows, 2026-11-10)

บันทึกผลรัน `tools/install/uninstall.mjs --yes` บนเครื่องจริงตาม acceptance ของคิว
`install-uninstall-clean` ("ผลรันบนเครื่องจริง 1 รอบ (ก่อน/หลัง) + exit code")

## สภาพเครื่องก่อนถอน

| รายการ | ค่า |
| --- | --- |
| Docker project `sovereign` (โฟลเดอร์ `deploy/community`) | running 4 (`web-1`, `api-1`, `db-1`, `mqtt-1`) + `migrate-1` exited(1) มาก่อนแล้ว |
| Docker project `infra` (`sovereign-os/infra`) | running 4 (`db`, `core-api`, `emqx`, `cloudflared`) — คนละสแตก ไม่ถูกแตะ |
| Volume | `sovereign_pgdata`, `sovereign_api_data`, `sovereign_api_backups`, `sovereign_emqx_data`, `sovereign_emqx_log` |
| HTTP | web `:3101` = 200 · api `:3100/api/health` = 200 |
| Scheduled task | ไม่มี `Sovereign Agent Runner` (query exit 1) |
| DB backup | `pg_dumpall` → `backups/uninstall-test-20261110-005534.sql` (3.6 MB, 330 COPY/CREATE TABLE) |
| Data fingerprint (6 ตารางใหญ่) | md5 `2a35b2a142576633f9e8c0010c08efae` |

## ผลรัน

```
node tools/install/uninstall.mjs --yes     # exit 0
  ~ หยุด + ลบ scheduled task "Sovereign Agent Runner" (ไม่มีอยู่/ข้ามได้)
  ✓ หยุด container (เก็บ volume ข้อมูลไว้)
```

- container ของ project `sovereign` ถูกหยุด/ลบทั้ง 4 ตัว — project `infra` ยังรันครบ
- volume ทั้ง 5 ยังอยู่ (ไม่มี `-v`)

## คืนระบบ (restore)

```
docker compose --env-file deploy/community/.env.test -f deploy/community/docker-compose.yml up -d db mqtt
docker compose --env-file deploy/community/.env.test -f deploy/community/docker-compose.yml up -d --no-deps api web
```

- หลังคืนระบบ: `api :3100` = 200 · `web :3101` = 200 · container กลับมาเท่าสภาพก่อนถอน

### P3005 — แก้แล้ว (2026-11-10)

`migrate` เคยมั่ลด้วย P3005 เพราะฐานข้อมูลมี schema อยู่แล้วแต่ไม่มี `_prisma_migrations`
(สร้างจากรุ่นก่อน squash baseline) ทำให้ `docker compose up -d` ล้มทั้งสแตก

ขั้นตอนที่ทำ:
1. ตรวจ drift: `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma --script`
   → ของขาดเป็นแบบ additive อย่างเดียว: ตาราง `sync_conflict_logs` + 3 index
2. apply SQL ส่วนที่ขาด (ไม่มีคำสั่งลบ/แก้ของเดิม)
3. รัน `node dist/scripts/migrate-deploy.js` → ตรวจ drift ว่าง → baseline 2 migration แล้ว deploy ซ้ำ → exit 0
4. `docker compose up -d` แบบไม่ใส่ `--no-deps` → **`migrate` Exited (0)** · api/web healthy · mqtt up

=> ถอน/คืนระบบซ้ำได้โดยไม่มี service ล้ม (`UNINSTALL3_EXIT=0`, `RESTORE3_EXIT=0`)

ผลิตภัณฑ์: `deploy/community/docker-compose.yml` เปลี่ยน `command` เป็น `node dist/scripts/migrate-deploy.js`
ซึ่ง baseline อัตโนมัติ **เฉพาะเมื่อ drift ว่าง** — ถ้า schema ไม่ตรงจะ exit 1 พร้อมบอกให้คนตรวจ
(ไม่เดาแทนลูกค้า) · unit tests: `core-api/tests/migrate-baseline.test.ts` 6/6

## purge-data — พิสูจน์บนสแตกแยก (`tools/install/verify-purge.mjs`)

การลบ volume ถาวรทำบนข้อมูลจริงไม่ได้ สคริปต์นี้จึงสร้าง Docker project ชั่วคราว (ชื่อสุ่ม +
volume ของตัวเอง, image timescale ที่มีในเครื่อง) แล้วตรวจ:

```
node tools/install/verify-purge.mjs      # ✅ ผ่านครบ 11/11
```

- โหมดปกติ: `uninstall --yes` → container หาย · **volume ยังอยู่** · เปิดกลับมาเห็นข้อมูลเดิมครบ 3 แถว
- `--purge-data`: container หาย · **volume หายจริง**
- `--compose` / `--project`: ใช้ชุดติดตั้งที่ไม่ใช่ค่าเริ่มต้นได้ (จำเป็นสำหรับการทดสอบแยกและ custom install)
- cleanup อัตโนมัติ (`down -v`) ทั้งสองกรณี ไม่มีอะไรค้างบนเครื่อง

### บั๊กที่เจอระหว่างทำ harness (แก้แล้ว)

`purge-backups` เคยใช้ `<repo>/backups` คงที่ ไม่สนใจ `--compose` — การรัน `--purge-data`
ของสแตกทดสอบจึงลบ `backups/` ของ repo จริง (เจอตอน verify แดงจาก `windows-hide-guard`)
แก้: purge อิง **install root ของ compose ที่ระบุ** (`<installRoot>/backups`) — ชุดมาตรฐานยังเป็น
`<repo>/backups` · regression: U12 + harness ตรวจว่า `backups/postgres/*.dump` ของ repo ยังอยู่
และสร้าง backup ใหม่ด้วย `tools/backup-db.ps1` แล้ว (ตรวจสอบได้: `backups/postgres/sovereign_*.dump`)

## ความสมบูรณ์ของข้อมูลหลังคืนระบบ

| ตาราง | ก่อน | หลัง |
| --- | --- | --- |
| sensor_telemetry | 26,826 | 26,853 (+27 จากการรับข้อมูลใหม่หลัง api กลับมา) |
| threat_intel_items | 5,097 | 5,097 |
| learning_snapshots | 26 | 26 |
| alert_events | 74 | 74 |
| system_settings | 2 | 2 |
| learning_predictions | 7 | 7 |

=> ข้อมูลเดิมอยู่ครบ (ตารางที่เหลือตรงกันทุกแถว; telemetry เพิ่มขึ้นเพราะระบบกลับมาเขียนต่อ)

## บั๊กที่เจอจากการรันจริง (แก้แล้ว)

1. **`compose down` ไม่ได้หยุดอะไร แต่รายงาน "✅ ถอนเสร็จ" (exit 0)**
   `deploy/community/docker-compose.yml` interpolate `${POSTGRES_PASSWORD}`, `${JWT_SECRET}`,
   `${EMQX_PASSWORD}` จาก env — ตัวถอนไม่ส่ง `--env-file` และโฟลเดอร์นั้นไม่มี `.env`
   (สแตกนี้รันด้วย `.env.test`) compose จึงล้มก่อนหยุด container แต่ `tolerateFailure`
   กลืน error เป็นความสำเร็จ
   แก้: เลือก env file ที่มีจริง (`deploy/community/.env` → `.env.test` → repo `.env` →
   `sovereign-os/infra/.env`) แล้วส่ง `--env-file` ให้ compose
2. **แยก "ไม่มีอะไรให้ถอน" ออกจาก "หยุดไม่ได้จริง"**
   ตอนนี้ขั้น compose ใช้ `classifyFailure` — tolerate เฉพาะข้อความแบบ
   `no such project` / `nothing to remove`; error อื่น (เช่น interpolate env ไม่ครบ)
   ทำให้ exit 1 พร้อมบอกบรรทัดแรกของ error และข้อความ `⚠ ถอนไม่เสร็จ`

## ข้อจำกัด

- รันบน Windows เครื่องเดียว — เส้นทาง Linux/macOS ยังพิสูจน์ด้วย pure test (U2)
- ยังไม่ได้ทดสอบ `--purge-data` กับข้อมูลจริง (จะลบ volume ถาวร) — ครอบด้วย U3/U8 แทน
- purge-data พิสูจน์บน postgres ตัวเดียว (ไม่รวม volume ของ mqtt/web) — กลไก `-v` เดียวกันจึงใช้ร่วมกัน
- `sync_conflict_logs` ถูกสร้างด้วย SQL จาก `migrate diff` (ไม่ใช่ migration ใหม่) เพราะ baseline ถูก squash ไปแล้ว;
  ฐานข้อมูลใหม่ยังได้ตารางนี้จาก baseline ตามปกติ
