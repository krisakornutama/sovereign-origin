# Ops Runbook — Project Sovereign (หน้าเดียวจบ)

> ระบบหลังบ้านทั้งหมดบนเครื่องนี้: 3 containers + เว็บ bare-metal + shell เดสก์ท็อป
> ทุกพาธอ้างจาก `E:\My work\Project Sovereign Origin`

## ๑. อะไรรันที่ไหน

| ชิ้น | ที่รัน | พอร์ต | วิธีเริ่มเอง |
|---|---|---|---|
| PostgreSQL (`sovereign-db`, TimescaleDB) | Docker (compose ที่ `sovereign-os/infra/`) | 5432 | `docker compose up -d timescaledb` |
| MQTT (`sovereign-emqx`) | Docker | 1883 / 18083 | `docker compose up -d emqx` |
| API (`sovereign-core-api`) | Docker | 3001 | `docker compose up -d core-api` |
| เว็บ Dashboard | **bare-metal** `next start` บน E: | 3000 | `node frontend-watchdog.mjs` (ตัวมันสตาร์ทเว็บให้) |
| เดสก์ท็อป shell | `dist-portable\Sovereign OS.exe` | — | ดับเบิลคลิก |

**ห้ามสตาร์ท compose service `frontend`** — ถูกถอดออกจาก stack แล้ว (commit `575e873`) เว็บ :3000 รันบนเครื่องเป็นตัวเดียวเท่านั้น

## ๒. บูตหลังเปิดเครื่อง (อัตโนมัติ — ไม่ต้องทำอะไร)

```
Windows Startup → sovereign-autostart.vbs → autostart.mjs
  1) รอ Docker Desktop พร้อม
  2) docker compose up -d timescaledb emqx core-api
  3) node frontend-watchdog.mjs  (เฝ้าเว็บ :3000 ตลอดชีวิตเครื่อง)
```

ถ้า Docker ยังไม่พร้อมตอนบูต ตัวสคริปต์ข้ามขั้น compose ไปเอง → รัน `start-sovereign.bat` ภายหลัง (ทำหน้าที่เดิม + รอ API พร้อม 240 วิ)

## ๓. รีสตาร์ตทีละชิ้น

```bash
cd "E:\My work\Project Sovereign Origin\sovereign-os\infra"

docker restart sovereign-core-api    # API :3001
docker restart sovereign-db          # ฐานข้อมูล (API reconnect เอง)
docker restart sovereign-emqx        # MQTT

```

ทั้งระบบพร้อมกันคำสั่งเดียว: **`start-sovereign.bat`** (ดับเบิลคลิกก็ได้)

### เว็บ :3000 ค้าง

```bash
cd "E:\My work\Project Sovereign Origin"
netstat -ano | grep ":3000" | grep -i LISTENING   # อ่าน PID จากคอลัมน์สุดท้าย
taskkill //F //PID <PID> //T
node frontend-watchdog.mjs                        # idempotent — เช็คและชุบเอง
```

## ๔. เช็คสุขภาพ 1 นาที (Git Bash / PowerShell)

```bash
cd "/e/My work/Project Sovereign Origin"
curl -s -o /dev/null -w "web     : %{http_code}\n"  http://localhost:3000
curl -s http://localhost:3001/healthz | grep -o '"ok":true' && echo "API     : OK"
docker ps --filter name=sovereign --format "{{.Names}}: {{.Status}}"
ls -t backups/postgres/sovereign_v2_*.dump | head -1
tasklist | grep -i node | grep -c .   # >0 = watchdog/node มีชีวิต
```

เกณฑ์ผ่าน: เว็บ 200 · API `"ok":true` · 3 containers ขึ้นพร้อม `(healthy)` · dump ล่าสุดวันนี้ตอน ~03:00

## ๕. สำรอง / กู้คืนฐานข้อมูล

- **สำรองอัตโนมัติ:** Scheduled Task `Sovereign DB Backup` ทุกวัน 03:00 → `backups\postgres\sovereign_v2_YYYYMMDD_*.dump` (เก็บหลายวันย้อนหลัง)
- **กู้คืน** (ทดสอบก่อนใช้จริงเสมอ):
  ```bash
  docker exec -i sovereign-db pg_restore -U sovereign -d sovereign_v2 --clean \
    < backups/postgres/sovereign_v2_YYYYMMDD_HHMMSS.dump
  ```

## ๖. เส้นตายก่อนเปิดสู่อินเทอร์เน็ต

1. ปิดบัญชี `e2e-bot` (SUPERADMIN, รหัสผ่านอยู่ใน repo)
2. ตั้ง CORS เป็นโดเมนจริง + เปิด HTTPS
3. จำกัดพอร์ต 1883/18083 (MQTT) ไม่ให้โลกภายนอกเห็น
