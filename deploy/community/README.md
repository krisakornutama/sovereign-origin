# Sovereign OS — Community Edition

ระบบ home/server monitoring + automation แบบ self-hosted: TimescaleDB, MQTT, API และ Dashboard
รันทั้งชุดด้วย Docker Compose — **ไม่ต้องมี Node.js บนเครื่อง host**

## สิ่งที่ต้องมี

- Docker Engine + Compose v2 (Windows/macOS: Docker Desktop)
- RAM ≥ 2 GB, พื้นที่ว่าง ≥ 10 GB
- x86_64 หรือ arm64 (Raspberry Pi 4/5 ใช้ได้)

## ติดตั้ง (2 คำสั่ง)

```bash
cp .env.example .env
# เปิด .env แล้วใส่ POSTGRES_PASSWORD, EMQX_PASSWORD, JWT_SECRET (และ SEED_ADMIN_PASSWORD)
docker compose up -d --build
```

รอประมาณ 1–3 นาที (ครั้งแรกจะ build image) แล้วเปิด

- Dashboard — http://localhost:3000
- API health — http://localhost:3001/healthz
- EMQX dashboard — http://localhost:18083

ล็อกอินด้วยผู้ใช้ `admin` และรหัสผ่านที่ตั้งใน `SEED_ADMIN_PASSWORD`
ถ้าเว้นว่าง ระบบจะสุ่มรหัสให้ — ดูได้จาก `docker compose logs migrate`

> เปลี่ยนรหัส admin ครั้งแรกหลังล็อกอิน (หน้า Settings → Security)


## เพิ่มสมาชิกด้วยรหัสเชิญ

CE ไม่มี SMTP และไม่เปิดรับสมัครเสรี — สมาชิกใหม่ต้องมีรหัสเชิญที่ admin สร้าง

**วิธีที่ 1 — CLI (เร็วที่สุด)**

```bash
docker compose exec api node dist/scripts/make-invite.js --role OPERATOR --uses 1 --days 7
```

ได้รหัสรูปแบบ `SG-XXXX-XXXX-XXXX` พร้อมลิงก์ `/register?code=...` ส่งให้ผู้ใช้

**วิธีที่ 2 — API (ต้องเป็น SUPERADMIN)**

```bash
curl -X POST http://localhost:3001/api/users/invites \n  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \n  -d '{"role":"OPERATOR","label":"ทีมขาย","maxUses":5,"expiresInHours":72}'
# ดูรายการ:   GET /api/users/invites
# เพิกถอน:    DELETE /api/users/invites/<id>
```

**วิธีที่ 3 — หน้าเว็บ /users (ไม่ต้องใช้ terminal)**

เข้าสู่ระบบด้วย SUPERADMIN → เมนู Users → การ์ด "รหัสเชิญสมัครสมาชิก"
กำหนดบทบาท / ชื่อเรียก / จำนวนครั้ง / วันหมดอายุ แล้วกด "สร้างรหัสเชิญ"
ระบบจะแสดงรหัส + ลิงก์ พร้อมปุ่มคัดลอก (เห็นครั้งเดียว) และเพิกถอนได้จากตารางด้านล่าง

จากนั้นผู้ใช้เปิด `/register?code=SG-...` กรอกรหัส + ชื่อผู้ใช้ + รหัสผ่าน

> รหัสถูกเก็บเป็น sha256 (ดูใน DB ไม่ได้) · ใช้ได้ตาม `maxUses` · มีวันหมดอายุ · เพิกถอนได้
> การสมัครจะบันทึกความยินยอม "จำเป็นต่อบริการ" อัตโนมัติ และให้เลือก telemetry/analytics

## ตรวจว่าทุกอย่างขึ้นครบ

```bash
docker compose ps          # ทุก service ต้อง healthy/running (migrate = exited 0)
curl http://localhost:3001/healthz
```

## เปิดใช้จากเครื่องอื่นใน LAN (เช่น Raspberry Pi)

1. ใน `.env` ตั้ง
   ```env
   API_BIND=0.0.0.0
   NEXT_PUBLIC_API_URL=http://192.168.1.50:3001   # ip ของเครื่องที่รัน
   ```
2. `docker compose up -d --build web`
3. เปิด `http://192.168.1.50:3000` จากเครื่องอื่น

`NEXT_PUBLIC_API_URL` ถูกฝังตอน build — แก้ค่านี้ต้อง rebuild service `web` ทุกครั้ง

## คำสั่งที่ใช้บ่อย

```bash
docker compose logs -f api        # ดู log backend
docker compose restart api        # รีสตาร์ทเฉพาะ API
docker compose down               # หยุด (ข้อมูลยังอยู่)
docker compose down -v            # หยุด + ลบข้อมูลทั้งหมด (ระวัง!)
docker compose up -d --build      # อัปเดตหลัง git pull
```

## การแจ้งเตือน 3 ช่องทาง

ตั้งใน `.env` แล้ว `docker compose up -d api` — ตั้งช่องไหนก็ได้ ไม่ตั้ง = ข้ามช่องนั้น

| ช่อง | ต้องตั้ง |
|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (หรือตั้งผ่านหน้า Settings) |
| Discord | `DISCORD_WEBHOOK_URL` — Server Settings → Integrations → Webhooks |
| LINE | `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_TO` (Messaging API, ผู้รับขึ้นต้น U/C/R) |

ตรวจว่าส่งได้จริงทุกช่องก่อนพึ่งระบบ:

```bash
# ล็อกอินในหน้าเว็บ → F12 → Application → localStorage → sovereign-token
curl -X POST http://localhost:3001/api/telegram/channels/test \
  -H "Authorization: Bearer <token>"
# → {"success":true,"channels":[{"channel":"discord","ok":true,...},{"channel":"line","ok":true,...}]}
```

## ข้อมูลอยู่ที่ไหน

| Volume | เก็บอะไร |
|---|---|
| `sovereign_pgdata` | ฐานข้อมูลทั้งหมด |
| `sovereign_api_data` | ไฟล์สถานะของแอป |
| `sovereign_api_backups` | ไฟล์สำรองที่แอปสร้าง |
| `sovereign_emqx_data` | ข้อมูล MQTT broker |

สำรองฐานข้อมูลด้วยคำสั่งเดียว:

```bash
docker compose exec db pg_dump -U sovereign sovereign | gzip > sovereign-$(date +%F).sql.gz
```

## ความปลอดภัย

- ค่าเริ่มต้นผูก API ไว้ที่ `127.0.0.1` — อย่าเปิด `API_BIND=0.0.0.0` ออกอินเทอร์เน็ตโดยตรง
- ถ้าต้องเปิดสู่ภายนอก ให้ใช้ reverse proxy ที่มี TLS (Caddy/Nginx/Cloudflare Tunnel)
  และจำกัด path ที่อนุญาต
- ไฟล์ `.env` มีความลับ — ห้าม commit ขึ้น git

## แก้ปัญหา

| อาการ | ตรวจ |
|---|---|
| `web` ไม่ขึ้น | `docker compose logs web` — มักเป็น build ล้มเพราะ Node เวอร์ชันใน image |
| `api` restart loop | `docker compose logs api` — มักเป็น `DATABASE_URL`/`JWT_SECRET` ไม่ถูก |
| `migrate` exited ≠ 0 | `docker compose logs migrate` — ฐานข้อมูลยังไม่พร้อม หรือรหัสผ่านผิด |
| หน้าเว็บโหลดได้แต่ API 401/network error | ตรวจ `NEXT_PUBLIC_API_URL` ว่าตรงกับ URL ที่เปิดจริง |

## ✅ พิสูจน์แล้ว (04/11/69)

ติดตั้งบนฐานข้อมูลว่างจริงด้วย `docker compose up -d --build` สำเร็จในรอบเดียว:

| ขั้น | ผล |
|---|---|
| db (TimescaleDB) | healthy |
| migrate (schema + seed) | exited 0 · สร้างผู้ใช้ `admin` ตาม `SEED_ADMIN_PASSWORD` |
| api :3001 (ในเครื่องนี้ทดสอบ :3100) | `/healthz` = 200 |
| web :3000 (ทดสอบ :3101) | 200 · เปิด Dashboard ได้ |
| login | `POST /api/auth/login` = 200 |

> หมายเหตุ: service `migrate` ใช้ `prisma db push` (sync จาก schema) ไม่ใช่ `migrate deploy`
> เพราะ migration history มี drift — ฐานข้อมูลใหม่จะสร้างไม่ครบและ seed ล้ม (`P2022`)
> production เดิมยังใช้ `migrate deploy` ตามปกติ ไม่กระทบ
