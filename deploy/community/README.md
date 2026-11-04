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
