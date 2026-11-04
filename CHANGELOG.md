# CHANGELOG — Sovereign OS

ประวัติการพัฒนา แยกเป็นเวอร์ชัน บอกสิ่งที่พัฒนาใหม่ และบัคที่แก้ในแต่ละรอบ

รูปแบบ: ใช้ [Keep a Changelog](https://keepachangelog.com/) และ [Semantic Versioning](https://semver.org/)

---

## [v1.2.0] — กำลังพัฒนา (unreleased)

รวมทุกสิ่งที่ commit หลังจาก `v1.1.1` จนถึงปัจจุบัน (HEAD = `5f4277d`) — ครอบทั้ง frontend, backend, deploy, ops, test และเอกสาร

### 🚀 ฟีเจอร์ใหญ่ที่เพิ่มเข้ามา

**ระบบติดตั้งและการเผยแพร่ (Deploy / Packaging)**
- **CE1 — ชุดติดตั้ง Community Edition แบบ Docker Compose คำสั่งเดียว** (`deploy/community/`): db · mqtt · migrate · api · web ใช้ named volume ล้วน ไม่ bind mount ซอร์ส รันบนเครื่องใดก็ได้ (x86_64/arm64) `migrate` รัน `prisma migrate deploy + seed` แล้ว `api` จึงเริ่ม
- แก้บัคจริง: `Dockerfile.prod` ของ frontend ใช้ `node:18` แต่ Next 16 บังคับ ≥ 20.9 → เปลี่ยนเป็น `node:22-alpine`
- `next.config.js`: เติม origin จาก `NEXT_PUBLIC_API_URL` เข้า CSP `connect-src` (http + ws) กัน CSP บล็อกเมื่อเปิดจากเครื่องอื่น
- เทสต์ `tools/test/community-stack.test.mjs` 11/11 (แดงก่อนแก้ 4 ข้อ) · `docker compose config` ผ่านจริง
- `INSTALL-CHECK` doctor พร้อม `SUPPORT.txt` (ซ่อนข้อมูล敏感) สำหรับตรวจก่อน/หลังติดตั้ง
- ตัวติดตั้งเครื่องใหม่แบบไฟล์เดียว 4.7 KB + ชุดติดตั้งเครื่องลูก (agent-pack) 36 MB

**ช่องแจ้งเตือน (Alerts / Notifications)**
- **CE3 — Discord + LINE** ต่อจาก dispatcher เดิม (Telegram) ที่มี severity/dedup/rate-limit อยู่แล้ว
  - `services/alert-fanout.service.ts`: แปลง HTML → ข้อความล้วน (คงลิงก์), Discord จำกัด 2,000 ตัวอักษร + ปิด mention (`allowed_mentions.parse=[]`), LINE Messaging API จำกัด 5,000 ตัวอักษร, ตรวจ URL/รหัสผู้รับก่อนตั้งช่อง
  - ยิงขนานทุกช่องแบบ soft-fail: ช่องหนึ่งล้มไม่ทำให้ช่องอื่นเงียบ
  - `POST /api/telegram/channels/test` (SUPERADMIN) — ทดสอบทุกช่องพร้อมกัน คืนผลแยกช่อง
  - env: `DISCORD_WEBHOOK_URL` · `LINE_CHANNEL_ACCESS_TOKEN` · `LINE_TO` (LINE Messaging API — ไม่ใช่ LINE Notify ที่ปิดแล้ว)
  - เทสต์ `alertFanout.test.ts` 14/14 + `telegramChannels.test.ts` 4/4 · `telegramAlert.test.ts` เดิมยังผ่าน 16/16

**ระบบควบคุมเครื่องระยะไกล (Machine Control / Orchestrator)**
- Machine Console: ดูจอสด / ควบคุมเมาส์คีย์บอร์ด / จัดการไฟล์ของเครื่องในเครือข่าย
- Agent Queue: หน้าเว็บคิวงาน + คำสั่ง Telegram + ปุ่ม "ควบคุมเครื่อง 2" → `/machine-console`
- Orchestrator: HUB สั่งงานผ่าน LAN + ด่านอนุมัติงานเสี่ยง + แจ้งเตือน text/voice/call + TTS ใน container (espeak-ng + pyttsx3)
- agent-pack: ตัวช่วยติดตั้งเครื่องลูก — ก๊อปโฟลเดอร์เดียว ดับเบิลคลิก แล้วออนไลน์เอง · อัปเดตโค้ดตัวเองจาก HUB แทนก๊อปผ่าน USB
- Fleet control plane v1: persist สถานะใน PostgreSQL · SITE_ADMIN สิทธิ์อ่านเฉพาะไซต์ · sign runner manifests

**ระบบชำระเงิน (Payments / Stripe)**
- หน่วยคิดเงิน THB (minor unit) + จุดเสียบ Stripe Checkout (ยังใช้ของปลอมก่อนเปิดจริง)
- Webhook ยืนยันการจ่ายเงินจริง (THB) · บังคับ `success_url` + เพดาน `client_reference_id` + `unit_amount`
-atomicity ของการเขียนเงิน: ให้ Prisma ปลอมย้อนกลับ transaction ได้ · idempotency-key guard สำหรับเขียนเงิน/สต็อก
- แผงชำระผ่านบัตรบนหน้าร้าน + webhook รับออเดอร์หน้าร้าน · บันทึกแถวเงินจริงตอน Stripe ยืนยัน

**ความเป็นส่วนตัว (PDPA / Consent)**
- บังคับความยินยอมเป็นด่านจริงก่อนบันทึกข้อมูลสุขภาพ (consent gate)
- ขอความยินยอมใหม่เฉพาะวัตถุประสงค์ที่ถูกแก้ + UI ยืนยันฉบับใหม่ได้จริง
- ลิงก์นโยบายความเป็นส่วนตัวบนหน้าเข้าสู่ระบบ · consent smoke เข้า nightly
- สิทธิ์ลบข้อมูล (DELETE) ยังทำได้เสมอ — สิทธิ์ของเจ้าของข้อมูล

**ระบบสำรองข้อมูลและกู้คืน (Backup / PITR)**
- Offsite backup รายวัน: dump → เข้ารหัส AES-256-GCM → ส่ง Telegram
- สาย offsite รอบสอง: age (X25519) เข้ารหัสคู่ขนาน → ตัดสาย AES เก่า (เก็บช่องถอด `.enc` เก่าไว้จนกว่าจะหมดความหมาย)
- PITR สมบูรณ์: เปิด WAL archiving จริง (`archive_mode=on`, `archive_timeout=300s`) + drill อัตโนมัติซ้อมผ่านจริง + runbook §๙ กู้จริงเมื่อไฟดับ
- frontend-watchdog ตัวจริง: :3000 ตาย=บูตเอง · ค้าง=kill PID เฉพาะ · สิ่งแปลกปลอม=fail-safe

**อื่น ๆ**
- MBTI ระบบครบวงจร: แบบทดสอบ 93/32 ข้อ + เทียบสองคน + AI ปรับโทนตามบุคลิกภาพ + ตราแปดส่วน + โปรไฟล์คนในบ้าน
- ธีมบรรยากาศรายโดเมน (atmo-*) + Dashboard โทน circadian + เมนูเปลี่ยนสีตามหน้า
- ระบบพาร์ทเนอร์ (แผนที่คู่ค้า + สมัครปักหมุด + แผงอนุมัติ) + SMS gateway จริง (OTP)
- ระบบติดตาม Traceability เฟส 1–2: ล็อตผลผลิต Farm→Inventory→Shop + หน้า /trace
- โซเชียลสตูดิโอ: โพสต์/ลงคลิป YouTube (OAuth loopback + resumable upload) + Instagram 第四ช่องทาง
- ระบบธุรกิจ: เมนู 9 ส่วน + พิมพ์หลายใบต่อ A4 + สลิป PromptPay + แจ้งเตือน Telegram ห้องธุรกิจ

### 🐛 แก้บัคที่สำคัญ

| บัค | ผลกระทบ | วิธีแก้ |
|-----|----------|--------|
| Test file ไม่ import `./setup-env` | เขียนแถวขยะลง `alert_events` ใน DB จริง (key `x`, `k`, `warn once`, `same text`, `synthetic-streak-critical` รวม 4,378 แถว) | เติม `import './setup-env'` ให้ 19 ไฟล์เทสต์ + เพิ่มเทสต์กันถอยหลัง `tools/test/test-env-isolation.test.mjs` |
| Webhook TransferOrder ค้างไม่ตอบ | `verified_by` เป็นคอลัมน์ `@db.Uuid` แต่อ่านเป็นสตริงธรรมดา → Prisma P2023 | ปรับให้อ่าน/เขียนเป็น UUID ตรงกัน |
| `/shop/` ไม่ยิงร้าน default | หน้าร้านแสดงว่าง | แก้ให้ยิงร้าน default + gate จับหน้าว่าง |
| `DELETE /api/users/:id` ค้าง | `audit_logs.user_id` FK ไม่ใช่ nullable + SetNull | ทำให้ nullable + onDelete SetNull |
| Service worker ค้างของเก่า | "แก้แล้วแต่ยังเห็นของเก่า" | cache-bust อัตโนมัติทุก build |
| Nightly verify ล้มทุกคืน | Build ทับ server ที่ serve prod อยู่ | แยก build ออกเป็นโหมด prod-build + rollback copy |
| คำสั่งไทยใน `.cmd`/`.bat` พัง | cmd.exe อ่านไบต์ไทยเป็นคำสั่ง → `<ไทย>' is not recognized` | วาง `chcp 65001` บนสุด + พิมพ์ ASCII ล้วนเท่านั้น |
| `%VAR%` กับ `set` บรรทัดเดียวกัน | `%VAR%` ถูกแทนค่าก่อน `set` รัน → เรียกสตริงว่าง | เรียกพาธตรง ๆ หรือใช้ `if exist (...) else (...)` |
| Docker build ค้างเมื่อ port drift | Port ชนกับ production ที่รันอยู่ | next-env.d.ts + verify cleans dist ก่อน build |

### 🎨 ปรับ UI / UX
- **QuickDeck**: glass shortcuts ปุ่มทางลัดงานประจำ (ขาย/หน้าร้าน · สินค้าสต็อก · จอครัว KDS · เงินภาษี · ฟาร์ม) กดครั้งเดียวเข้างาน
- **PageHeader ใหม่** ครบ 42 หน้า + badge แสดงสถานะ
- รวม `EmptyState` / `StatCard` / `SectionCard` ใช้ทั่ว inventory/farm/status/stats
- **Dashboard**: skeleton loading แทนข้อความเฉย ๆ · sparkline เทรนด์เซ็นเซอร์ · edit mode ลากจัดเรียงวิดเจ็ตได้ · mobile เรียงลำดับใหม่เหมาะจอเล็ก
- หน้าล็อกอินปรับให้สวยขึ้น + แก้ ss log spam ใน container
- ควบคุมอัตราเฟรมของการเลื่อนหน้า (กันเลื่อนกลับบนสุดเมื่อเปลี่ยนหน้า)

### 🔒 ความปลอดภัย
- ตรวจช่องโหว่ระบบตัวเอง: headers / SQLi / brute-force / IDOR + ผนวกเป็น check ที่ 5 ของ quality gate
- Rate-limit bucket แยกต่อ section ด้วย `X-Forwarded-For` (trust proxy=1) กันกิน quota IP จริงร่วมกับ gate
- เก็บ telegram token + รหัสเราเตอร์ เข้ารหัส AES-256-GCM เสมอ (`enc:v1:...`) · ค่าเก่า plaintext อ่านได้จนกว่าจะตั้งใหม่
- เข้ารหัส field PII (phone / taxId / PromptPay) + `phone_hash` สำหรับ lookup · migrate ข้อมูลจริงครบ
- `npm audit fix` ปิดช่องโหว่ทั้งหมด → **0 vulnerabilities ทั้ง FE + API**
- เก็บกวาดราก repo: ย้าย credentials เข้าที่ปลอดภัย + เอกสาร CORS + ปิด X-Powered-By
- Socket.IO ด่าน JWT+MFA+allowlist payload + ล็อก ai-models ทุกเส้นทาง
- Bind db/mqtt ports loopback-only + เพิ่ม CSP/Permissions-Policy ทั้ง web และ API
- `/api/health/truth` ต้องล็อกอิน (เดิมเปิดสาธารณะ)

### 📦 ปรับระบบปฏิบัติการ (Ops)
- **Quality gate เดียว**: `npm run verify` ครบ 6/6 (Architecture Gate + Frontend Gate + backend build+test + frontend typecheck+build)
- **Nightly gate** 03:20: verify + db-doctor แจ้ง Telegram เมื่อพัง + credential อ่านจาก system_settings → env
- **db-doctor**: ตรวจ app env ↔ compose ↔ ฐานจริง + ฐานแปลกปลอม + schema drift + backup ผิดตัว
- **Security-anomaly digest**: 6 กลุ่มจาก audit_logs (brute-force / MFA / นอกเวลา / บัญชี / first-seen / spike) ส่ง Telegram 08:00 ทุกวัน
- **Machine-alert watcher**: เฝ้าเครื่องทุก 10 นาที แจ้ง Telegram ทันทีเมื่อดิสก์/แรมวิกฤต/docker ล่ม
- เคลียร์พื้นที่ดิสก์ E: (Docker prune + compact vhdx 106→19 GB) + ตั้ง task compact ทุกอาทิตย์ 04:00

### 🧪 ทดสอบและคุณภาพโค้ด
- เทสต์ a11y auth screens + ฟอร์มทั้งระบบ (รวม mutation proof 6 จุด)
- เทสต์ E2E กวาดทุกหน้าจากเมนูจริง 34 หน้า + all-pages จับ console/JS error
- เทสต์ desktop app 45 เคส (โหลด main.js จริงใน VM + stub electron)
- เทสต์ orchestrator กับ HUB จริง + ไม่ทิ้ง state ค้างเมื่อติดตั้งโดยไม่รีสตาร์ท
- เทสต์ atomicity ของการเขียนเงิน + เทสต์ idempotency-key
- เทสต์กันเทสต์เขียน DB จริง (setup-env isolation) 2/2

### 📄 เอกสาร
- `AGENTS.md`: กฎเหล็กสำหรับ AI (GIT SAFETY, BUILD BEFORE COMMIT, BRANCH WORKFLOW, ฯลฯ)
- `docs/ARCHITECTURE.md` + `docs/modules/<โมดูล>.md`: สถาปัตยกรรมรวม + กติกาที่เกตตรวจอัตโนมัติ
- `docs/history/`: journal เดิมที่ย้ายมาจาก STATUS.md
- `STATUS.md`: snapshot ที่ gen จากข้อมูลจริงด้วย `tools/status-doc.mjs`
- `QUEUE.md`: คิวงานทั้งหมด พร้อมสถานะทำ/ค้าง/บล็อก

---

## [v1.1.1] — dbe43d0

- Desktop: แยก `downloadFile` เป็นโมดูล + เทส regression 7 เคส
- Bump 1.1.1 สำหรับ release ที่มีด่านในตัว

---

## [v1.1.0] — 016dffa

- Publish: รวม `evidence/` directory เข้า whitelist (guardmini field evidence ไม่เคยถึง Pages)

---

## [v1.0] — 15f2e68

- Publish: กันไฟล์ทดลอง (`tmp-*`, `*.bak`) ออกจาก production sync

---

### หมายเหตุ
- ยังไม่ได้ push ไป GitHub (main นำ `origin/main` อยู่ 12 commit) รอเจ้าของอนุญาตก่อน push
- งานใดที่ระบุ "รอเจ้าของอนุมัติ" (เช่น การลบข้อมูลจริงตาม retention, push GitHub, เปิด /shop สู่อินเทอร์เน็ต) ยังไม่ได้ดำเนินการ
