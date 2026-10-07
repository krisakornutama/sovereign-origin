# Agent Orchestration — คู่มือติดตั้ง HUB + เครื่องที่ 2

โน้ตบุ๊คเครื่องนี้ทำหน้าที่ **HUB ตัวกลาง** — ผู้ใช้สั่งงานจากที่ไหนก็ได้
(หน้าเว็บ Agent Queue หรือ Telegram) แล้ว HUB ส่งงานไปให้ agent บนเครื่องคอมอีกเครื่องทำ
แบบ **pull** (เครื่องนั้นดึงงานเอง) ⇒ ไม่ต้องเปิดพอร์ตรับ และ HUB ไม่ต้องมี public URL

```
  ผู้ใช้ ──▶ หน้าเว็บ Agent Queue / Telegram
                    │
                    ▼
        HUB  (:3000 → /api/agent-machines)
                    │
                    │  เครื่องคอมดึงเองผ่าน LAN
                    ▼
        runner ──▶ opencode CLI / freebuff / echo
```

---

## 0) ติดตั้งทั้งระบบในเทิร์นเดียว — ทำตามลำดับนี้จบ

ทั้งหมดอยู่บนไดรฟ์โปรเจกต์ (E:) เท่านั้น — ห้ามคัดลอกโฟลเดอร์โปรเจกต์ไปไดรฟ์ C:

| # | ทำอะไร | ตรวจผล (ต้องเจอ) |
|---|---|---|
| 1 | migrate DB: `cd sovereign-os/core-api && npx prisma migrate dev --name agent_orchestration` | ไม่มี error P-problem |
| 2 | เติม env การแจ้งเตือนใน `sovereign-os/infra/.env` (ตารางข้อ 2) | `docker compose config \| grep CALL_PROVIDER` เห็นค่า |
| 3 | deploy: `docker compose build core-api && docker compose up -d` (ที่ `sovereign-os/infra`) | `GET :3001/api/tts/health` ตอบ `engine: pyttsx3` · route `/api/agent-machines/*` ไม่ใช่ 404 |
| 4 | ติดตั้ง runner บนเครื่องที่ 2 (ข้อ 3) | เครื่องขึ้น `ออนไลน์` ในหน้า Agent Queue |
| 5 | สั่งงาน low-risk งานแรก | งานจบ + มีปุ่ม "ดูภาพหน้าจอตอนจบงาน" |
| 6 | สั่งงาน high-risk งานแรก | ค้าง `awaiting_approval` → กด "อนุมัติให้รัน" ในหน้า Agent Queue (หรือ ✅ ใน Telegram) แล้วค่อยวิ่ง |

---

## 1) ฝั่ง HUB — เตรียมฐานข้อมูล (ทำครั้งเดียว)

เพิ่ม `AgentMachine` + ฟิลด์ dispatch ของ `AgentJob` (nullable ทั้งหมด = ของเดิมไม่พัง)

```bash
cd sovereign-os/core-api
npx prisma migrate dev --name agent_orchestration
```

> ถ้า `DATABASE_URL` ไม่ได้อยู่ใน `.env` ให้ export เองก่อน เช่น
> `export DATABASE_URL="postgresql://...@127.0.0.1:5432/sovereign"`
> ดูค่าจริงจาก `infra/.env` (POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB)

**ถ้ายังไม่อยากแตะฐานข้อมูลจริง** — ทดสอบบน schema ชั่วคราว:

```bash
export DATABASE_URL="postgresql://...?schema=agent_orch_test"
npx prisma db push --skip-generate
# ...ทดสอบเสร็จแล้ว
npx prisma db execute --stdin <<< 'DROP SCHEMA agent_orch_test CASCADE;'
```

แล้ว deploy: `docker restart sovereign-core-api`
(route ใหม่ตอบ 404 = ยังไม่ restart — คอนเทนเนอร์ mount `src` จาก MAIN)

---

## 2) ฝั่ง HUB — ตั้งค่าระบบแจ้งเตือน (เลือกได้ว่าจะเปิดระดับไหน)

เพิ่มใน `sovereign-os/infra/.env` (ไม่ใช่ `core-api/.env` — ไฟล์นั้น container ไม่ได้อ่าน)
และตัวแปรทุกตัวต้องถูกประกาศไว้ใน `docker-compose.yml` ด้วย ไม่งั้นตั้งค่าแล้วก็ไม่มีผล
**ค่าเริ่มต้นคือปลอดภัยที่สุด ไม่ต้องตั้งอะไรก็ใช้ได้**

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `ORCHESTRATOR_ALERT_TIERS` | `text` | ระดับที่แจ้งเตือน: `text,voice,call` (ไม่ต้องครบทุกระดับ) |
| `CALL_PROVIDER` | `none` | `none` = ไม่โทร · `bland` = Bland AI · `twilio` = Twilio |
| `BLAND_API_KEY` | — | key ของ Bland AI (ต้องมีถ้าจะโทรผ่าน Bland) |
| `BLAND_VOICE_ID` | — | เสียงที่ใช้ (ถ้าไม่ใส่ใช้ค่าเริ่มต้นของ Bland) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `CALLER_FROM_NUMBER` | — | ต้องมีครบสามตัวถ้าจะโทรผ่าน Twilio |
| `CALLER_ALERT_PHONE` | — | เบอร์ที่โทร (E.164 เท่านั้น) · ถ้าว่างให้ตั้งในหน้า คิวเอเจนต์ แทน |
| `ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS` | `14` | เก็บภาพหน้าจอตอนจบงานกี่วันก่อนระบบล้างเอง (ทุก 6 ชม.) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | — | ต้องมีอยู่แล้วของระบบ ไม่งั้นชั้นที่ 1 ไม่ทำงาน |

ตรวจว่า container เห็นจริง (ไม่ใช่แค่ตั้งไว้แต่ไม่มีผล):

```bash
cd sovereign-os/infra && docker compose config | grep -E "CALL_PROVIDER|ORCHESTRATOR_ALERT_TIERS"
```

**เบอร์ที่ให้โทรต้องเป็น E.164** เท่านั้น (`+66812345678`) — ระบบจะไม่ยิงอะไรออกนอกเครื่อง
เบอร์ที่ไม่ผ่านจะถูกปฏิเสธตอนตั้งค่า (ไม่ใช่ตอนโทร) พร้อมบอกว่าไปตั้งที่ไหน
ตั้งเบอร์ได้จากหน้า **คิวเอเจนต์ → ระบบโทร** หรือผ่าน `PUT /api/agent-machines/call-phone`
ค่าที่ตั้งใน UI จะชนะ `CALLER_ALERT_PHONE` ในไฟล์ env

> `CALL_PROVIDER=none` คือ no-op ที่สมบูรณ์ — จะไม่ยิง HTTP ออกไปข้างนอกเลย

### งานเสี่ยง = รอคนกดอนุมัติ (Telegram หรือหน้าเว็บ)

งานที่แตะของที่ย้อนกลับไม่ได้ (`rm -rf`, `DROP TABLE`, force push, deploy production,
โอนเงิน, "ลบ…ทั้งหมด" ฯลฯ) จะถูกพักเป็นสถานะ `awaiting_approval` — เครื่องจะ**ไม่ดึงไปทำ**
จนกว่าคนจะกดอนุมัติ ที่ไหนก็ได้ 2 ทาง:

- **หน้าเว็บ Agent Queue** — ปุ่ม "อนุมัติให้รัน" / "ปฏิเสธ" ใต้งาน (ต้องล็อกอินด้วย SUPERADMIN)
- **Telegram** — กด ✅ ที่ข้อความแจ้งงานค้าง

บังคับระดับเองได้ต่องาน: ส่ง `risk: "high" | "low"` หรือพิมพ์ `@risk:high` ใน Telegram

### เสียงแจ้งเตือน (voice) + TTS ใน container

ระดับ `voice` ของ `ORCHESTRATOR_ALERT_TIERS` และการ synthesize ข้อความไทยเป็นไฟล์เสียง
รัน **ใน container core-api** ด้วย `pyttsx3` + `espeak-ng` (ลงไว้ใน image แล้ว · เสียงไทย `tai/th`)
ตัวรันสคริปต์เลือก python อัตโนมัติ: `PYTHON_BIN` (ถ้าตั้ง) → `python3` → `python`

- ตรวจว่า image มี TTS: `curl http://localhost:3001/api/tts/health` → `"engine": "pyttsx3"`
- ถ้า 404 / engine อื่น = ยังรัน image เก่า → build ใหม่ตามข้อ 3 ข้างบน
- เสียง espeak หยาบกว่า Piper/TTS บนคลาวด์ — ฟังออกชัดแต่ไม่ไพเราะ (ยอมรับแล้ว)

### เปิดสายโทรจริงทีละขั้น (Bland AI)

ตัวแปรอยู่ในตารางด้านบนแล้ว (เจ้าของจริงคือ `sovereign-os/infra/.env.example`) — นี่คือลําดับที่ทําให้โทรออกได้จริง:

1. **เอา API key** — สมัคร/ล็อกอินที่ <https://bland.ai> → **dashboard → API key** (แผน Start ฟรี ไม่ต้องใช้บัตร · คิดเงินต่อนาทีที่ใช้จริง)
   โค้ดยิงไป `https://api.bland.ai/v1/calls` ด้วย `Authorization: Bearer <key>` อยู่แล้ว — ไม่ต้องแก้โค้ด
2. **ใส่ค่าใน `sovereign-os/infra/.env`** — **ไม่ใช่ `core-api/.env`** (container ไม่อ่านไฟล์นั้น):
   `CALL_PROVIDER=bland` · `BLAND_API_KEY=<key>` · `ORCHESTRATOR_ALERT_TIERS=text,voice,call` · `CALLER_ALERT_PHONE=+66XXXXXXXXX`
3. **`docker restart` ไม่พอ** — ค่า env ถูกฝังตอนสร้าง container ต้องสร้างใหม่:
   ```bash
   cd sovereign-os/infra && docker compose up -d core-api
   ```
4. **ตรวจว่าเข้า container จริง** — `docker compose config | grep -c CALL_PROVIDER` (พิมพ์แค่ชื่อตัวแปร — **อย่าพิมพ์ค่าออกมา**)
5. **ฟังเสียงไทยก่อนจ่ายเงิน** — `GET /api/agent-machines/call-status` ต้องได้ `blandReady: true` → ตั้งเบอร์ให้โทร → ยิง `POST /api/agent-machines/call-test` แล้วรอสายเข้า
   Bland เป็น English-first (โค้ดส่ง `language: 'th'` ให้ระบบ optimize) — คุณภาพเสียงไทยต้องฟังเองจาก call-test
   ถ้าไม่พอใจ: Twilio `<Say language="th-TH">` โค้ดรองรับอยู่แล้ว (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `CALLER_FROM_NUMBER`)
6. ต้องมีคําว่า `call` ใน `ORCHESTRATOR_ALERT_TIERS` **และ**มีเบอร์ (E.164) ไม่งั้นชั้นโทรข้ามเงียบ ๆ · ถ้า `TELEGRAM_*` ว่าง ชั้น text/voice จะ no-op เหลือแต่สายโทรที่ทํางาน

---

## 3) ฝั่งเครื่องที่ 2 — ติดตั้ง runner

ดูคู่มือเต็มที่ [README.md](README.md) สรุปสั้น ๆ:

### ไฟล์ที่ต้องคัดลอก (ทั้งโฟลเดอร์นี้)

| ไฟล์ | จำเป็น | หมายเหตุ |
|---|---|---|
| `src/main.mjs` · `src/runner.mjs` · `src/screenshot.mjs` | ✅ | ตัว runner ทั้งหมด |
| `package.json` | ✅ | ไม่มี `dependencies` เลย — มีไว้บอกสคริปต์ `npm test` เท่านั้น |
| `.env.example` | ✅ | ต้นแบบของ `.env` |
| `install-runner.cmd` | ✅ (Windows) | ตั้ง Scheduled Task |
| `.gitignore` | แนะนำ | กัน `.env` หลุดเข้า git |
| `README.md` | แนะนำ | executor · โมเดล · ข้อจำกัด |
| `test/` | ไม่จำเป็น | ไว้รัน `npm test` บนเครื่องนั้น |
| `.env` | ❌ **ห้ามคัดลอก** | token ผูกกับเครื่องเดียว (ออกจากหน้าเว็บครั้งเดียว) — เอาไปเครื่องอื่นได้ `401` และเครื่องเดิมพังตาม |

**เครื่องที่ 2 ต้องมี:** Node.js ≥ 20 (`node -v`) · PowerShell (มีใน Windows ทุกตัว ใช้จับภาพหน้าจอ)
· **ไม่ต้องรัน `npm install`** และไม่ต้องมี git

⚠️ คัดลอกจาก **MAIN working folder** เท่านั้น — `E:\My work\Project Sovereign Origin\sovereign-os\agent-runner` — **ห้าม**คัดลอกจากโฟลเดอร์ `.freebuff/worktrees/...` (ยังเป็นโค้ดก่อนแก้)
ตัวที่ต้องได้คือ commit `6481d8a` (branch `ai/hub-lan-install`) ตรวจได้ด้วย:

```bash
grep -n 'jobs/${jobId}/screenshot/' src/runner.mjs   # ต้องพิมพ์บรรทัดออกมา
```

ไม่มีบรรทัดออกมา = โค้ดก่อนแก้ → งานจะจบ `done` แต่ภาพหน้าจอไม่ขึ้นโดยไม่มี error

### ลำดับติดตั้ง (ทำตามนี้)

1. **เอา token จาก HUB** — หน้าเว็บ HUB → หัวข้อ "เครื่องสั่งงาน" → กด **ลงทะเบียนเครื่องใหม่** (คืน token **ครั้งเดียว** — คัดลอกก่อนปิดหน้าต่าง)
2. **ตรวจ Node** — `node -v` ต้องได้ v20 ขึ้นไป
3. (ทางเลือก) ติดตั้ง agent CLI ถ้าจะให้เครื่องนี้รัน `opencode`: `npm i -g opencode-ai` — เริ่มด้วย `echo` พิสูจน์สายก่อนก็ได้
4. **คัดลอกทั้งโฟลเดอร์นี้** ไปวางบนเครื่องที่ 2 (USB/zip — ใช้ `git pull` ไม่ได้ เพราะโฟลเดอร์นี้ยังไม่ขึ้น remote)
   · ตรวจก่อนว่าถึง HUB ได้จากเครื่องที่ 2 — ดูหัวข้อ "เปิดพอร์ตให้เครื่องที่ 2 เข้าถึงได้" ท้ายข้อนี้
5. **สร้าง `.env`** จาก `.env.example` แล้วใส่ค่า (พอร์ตต้องเป็น **3000**):

```
HUB_URL=http://<IP-ของ-โน้ตบุ๊ค>:3000
MACHINE_NAME=คอมเครื่องที่ 2
MACHINE_TOKEN=<token จากหน้าเว็บ>
ENABLED_EXECUTORS=echo
```

ตัวอย่างจริง: `HUB_URL=http://192.168.1.102:3000`

> **ห้ามใช้ `:3001`** — API ผูกกับ `127.0.0.1:3001` เท่านั้น (ดู `sovereign-os/infra/docker-compose.yml`)
> เครื่องอื่นใน LAN ต่อ 3001 ตรง ๆ ไม่ติด · `:3000` คือหน้าเว็บ prod ที่ rewrite `/api/*` ให้เอง
> ถ้าใส่ผิด runner จะไม่บอกว่า "พอร์ตผิด" — จะรายงาน `ติดต่อ HUB ไม่ได้` ทุก 15 วินาที

> ชื่อตัวแปรคือ `ENABLED_EXECUTORS` (ไม่ใช่ `MACHINE_EXECUTORS`)
> ถ้าใส่ชื่อผิด runner จะไม่ error — จะรันได้แค่ `echo` เงียบ ๆ
> ตรวจว่าถูกได้ด้วยบรรทัดแรกตอนรัน: ต้องเห็น `executor=echo`
> (ถ้าติดตั้ง opencode CLI แล้ว ให้ใส่ `ENABLED_EXECUTORS=echo,opencode`)

6. **ทดสอบก่อน** (ยังไม่ต้องติดตั้งถาวร) — `node src/main.mjs` ต้องเห็นบรรทัดแรก
   `[runner] เครื่อง=… hub=http://<IP>:3000 executor=echo captureScreenshot=true` แล้วไม่มี error
7. **ตรวจว่าเครื่องขึ้น `ออนไลน์`** ในหน้า Agent Queue แล้วกด Ctrl+C ปิด runner ทดสอบ
8. **ติดตั้งให้รันเอง** — คลิกขวา `install-runner.cmd` → **Run as administrator** (สร้าง Scheduled Task "Sovereign Agent Runner")
9. **สั่งงานแรกจากหน้าเว็บ** — เลือกเครื่องนี้ · executor `echo` → งานจบ + กด "ดูภาพหน้าจอตอนจบงาน"

### หา IP ของ HUB

```bash
ipconfig    # บน Windows — ดู IPv4 Address ของการ์ด LAN
```

### เปิดพอร์ตให้เครื่องที่ 2 เข้าถึงได้ (ทำครั้งเดียวบน HUB)

`next start` (หน้าเว็บ :3000) bind `0.0.0.0` อยู่แล้ว — ที่เหลือคือให้ Windows Firewall
ยอมรับขาเข้าที่พอร์ต 3000 (ค่าเริ่มต้นของ Windows คือ **ปิด**) เปิดเฉพาะ profile `private`
เท่านั้น เพื่อไม่ให้เปิดหน้าเว็บออกสู่วง Wi-Fi สาธารณะ:

```powershell
# PowerShell แบบ Run as administrator (บนโน้ตบุ๊ค HUB)
netsh advfirewall firewall add rule name="Sovereign HUB LAN (agent runner)" dir=in action=allow protocol=TCP localport=3000 profile=private
```

ตรวจว่ามีจริง (ไม่ต้อง admin):

```powershell
netsh advfirewall firewall show rule name="Sovereign HUB LAN (agent runner)"
```

**ตรวจก่อนติดตั้ง runner** — รันจาก **เครื่องที่ 2** (แทน IP ด้วยของจริง):

```bash
curl http://192.168.1.102:3000/api/health
```

ต้องได้ `200` + `"status":"ok"` · ถ้า timeout = ยังไม่ได้เปิด firewall (หรือ IP เปลี่ยน) — อย่าไปต่อ
(ปิด rule เมื่อเลิกใช้: `netsh advfirewall firewall delete rule name="Sovereign HUB LAN (agent runner)"`)

---

## 4) คำสั่ง Telegram

| คำสั่ง | ทำอะไร |
|---|---|
| `/queue` หรือ `/queue 5` | ดูคิว (ไม่ระบุ = 10 รายการ) |
| `/add <งาน> @opencode @machine:<id> @model:<โมเดล> @priority:9` | สั่งงาน |
| `/add <งาน> @opencode @machine:<id> @risk:high` | สั่งงานและบังคับให้รอกด |
| `/cancel <id>` | ยกเลิกงานที่ยังรออยู่ |
| `/repeat <id>` | ทำซ้ำงานเดิมลงคิว |

**โมเดลมาจากผู้ใช้เสมอ** — ถ้าไม่ระบุ `@model:` ระบบจะไม่เดาให้
(dispatcher จะใช้ค่าเริ่มต้นของ agent บนเครื่องนั้น)

`@machine:` ดู id ได้จากหน้า Agent Queue (คัดลอกโค้ดสีเทาท้ายการ์ดเครื่อง)
หรือพิมพ์ `/add ...` ลืมใส่ — บอทจะรายงานรายการเครื่องที่มีอยู่ให้เลือก

---

## 5) รู้จักข้อจำกัด

- **Freebuff ยังสั่งแบบ headless ไม่ได้** — runner จะรายงาน `executor not supported: freebuff`
  ตรง ๆ ไม่ทำเป็นสำเร็จปลอม ใช้ `opencode` หรือ `echo` ก่อน
- **โมเดลที่ไม่รองรับ tool calling ใช้เป็นตัวแก้โค้ดไม่ได้** (เช่น `gemma3:4b` ของ Ollama
  จะได้ `does not support tools`) — ใช้เป็น "คนตัดสินใจ" ของ HUB ได้ แต่ใช้สั่งงานไม่ได้
- **OpenCode ต้องมีเครดิตในบัญชี** — ถ้าหมดจะได้ `Insufficient account funds`
- **ภาพหน้าจอ** จับอัตโนมัติตอนจบงาน (ค่าเริ่มต้น) แล้วส่งขึ้น HUB เก็บเป็น `screenshot_url`
  ดูได้จากปุ่ม "ดูภาพหน้าจอตอนจบงาน" ในหน้า Agent Queue
  · ปิดได้ด้วย `CAPTURE_SCREENSHOT=false` ในไฟล์ `.env` ของเครื่อง runner
  · ภาพเก็บฝั่ง HUB ที่ `core-api/data/orchestrator-shots` (persist ผ่าน mount `/app/data`)
  · ต้องมี PowerShell — แพลตฟอร์มอื่นจะข้ามการจับภาพไปเงียบ ๆ ไม่ทำให้งานพัง