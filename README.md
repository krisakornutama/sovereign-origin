# Sovereign OS

ระบบบ้านอัจฉริยะ Sovereign ที่ดูแลตัวเองได้ (Self-Sovereign Home OS) — Security, Resilience, AI และ Telemetry ในชุดเดียว
ทดสอบ 994/994 tests ผ่าน 100% · core-api รันบน RAM ~220MiB, CPU <0.5%

## 🚀 ติดตั้งภายในคลิกเดียว (One-Click Install)

**ต้องมี Docker ก่อน** (Windows: Docker Desktop / Linux: docker engine + compose v2)

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File tools\install\install.ps1
```

**Linux / macOS:**
```bash
bash tools/install/install.sh
```

ตัวติดตั้งจะ: ตรวจ Docker → สร้าง `infra/.env` (สุ่ม secret + admin password ให้อัตโนมัติ) → `docker compose up -d` → รอระบบพร้อม → พิมพ์ URL + รหัสล็อกอิน (บันทึกที่ `infra/.credentials`)

### Flags

| Flag | ความหมาย |
|---|---|
| `--auto` / `-Auto` | เงียบสนิท ใช้ค่า default ทั้งหมด (เหมาะ Raspberry Pi / ติดตั้งห่างสายตา) |
| `--prod` / `-Prod` | ใช้ docker-compose.prod.yml (build production images) |
| `--no-frontend` / `-NoFrontend` | ข้าม Dashboard (กันชน port 3000) |
| `--dry-run` / `-DryRun` | ดูแผน + .env ที่จะสร้าง โดยไม่ลงมือ |
| `--force` / `-Force` | สร้าง .env ใหม่จาก template (สำรองไฟล์เก่า .bak) |
| `--telegram-token=…` / `-TelegramToken` | ใส่ Telegram token ล่วงหน้า |

## ⚙️ หลังติดตั้ง — เปิดฟีเจอร์เสริม (ทั้งหมดไม่บังคับ)

| ฟีเจอร์ | วิธีเปิด |
|---|---|
| **Telegram Alert** (แจ้งเตือน severity เกรด production) | ใส่ `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` ใน `infra/.env` → `docker compose up -d` |
| **UPS Shutdown** (แบตเตอรี่ถึงขีด → CHECKPOINT → ปิดเครื่อง) | `UPS_ENABLED=true` + มี NUT server (`upsd`) → ระวัง `UPS_DRY_RUN` |
| **AI / Ollama** (Dhamma, Agent, Analyst) | ติดตั้ง Ollama แล้วเปิด `AI_ANALYST_ENABLED=true` + ตั้ง `OLLAMA_MODEL` |
| **การลงทุน** (Portfolio) | `PORTFOLIO_ENABLED=true` + ตั้งพอร์ต/ราคา |
| **เซนเซอร์ IoT** (MQTT) | ต่อ ESP32 ส่ง MQTT ไป EMQX (`sovereign/…`) |

## 🏠 ทรัพยากรขั้นต่ำ

- x86_64 (แนะนำ) / arm64, Docker, RAM ≥ 2GB, disk ~10GB
- ระบบหลัก ~1.5–2GB RAM รวม (core-api 220MiB + Postgres + Timescale + EMQX)
- AI (Ollama) เพิ่มอีก ~4–8GB RAM ตามโมเดล

## 📂 โครงสร้าง

```
sovereign-os/
  core-api/     ← Backend (Express + Prisma, ทุกโมดูล 38 modules)
  infra/        ← docker-compose (dev/prod) + .env (ไม่เข้า git)
sovereign-frontend/  ← Dashboard (Next.js)
docs/           ← Blueprint เอกสารออกแบบ (SERIES_RED_DMS_BLUEPRINT.md)
tools/install/  ← ตัวติดตั้งคลิกเดียว
```

## 🧪 ทดสอบ

```bash
cd sovereign-os/core-api
npm test   # 994 tests (tsx --test, serial)
npm run build  # tsc ตรวจ type + build dist/
```

## 🗺️ ถนนสู่ชุด 🔴 (หลัง Soak Phase 3–7 วัน)

- External Dead-Man Switch (ESP32-S3 + 4G) — ดู `docs/SERIES_RED_DMS_BLUEPRINT.md`
- Cold Standby Machine (Postgres replication + Wake-on-LAN)
