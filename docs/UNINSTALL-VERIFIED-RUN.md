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

- เหตุที่ต้อง `--no-deps`: service `migrate` ล้มด้วย **P3005** ("database schema is not empty")
  ตั้งแต่ก่อนถอนแล้ว (compose ls แสดง `exited(1)`) — สแตกนี้ถูกสร้างด้วย `db push`/restore
  จึงไม่มี `_prisma_migrations` · ไม่ใช่ผลจากการถอน และไม่ได้แตะข้อมูล
- หลังคืนระบบ: `api :3100` = 200 · `web :3101` = 200 · container กลับมาเท่าสภาพก่อนถอน

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
- `migrate` ยังล้ม P3005 ตามสภาพเดิมของสแตก — ควร baseline ให้เรียบร้อยแยกเป็นงานถัดไป
