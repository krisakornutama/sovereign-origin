# 📖 SOVEREIGN BIBLE — เอกสารอ้างอิงสูงสุดของระบบ Sovereign Origin

> เอกสารนี้คือ "คัมภีร์" ของระบบ — ว่าด้วยสถาปัตยกรรม, วิธีรัน/กู้ระบบ (runbook), และทะเบียนสิ่งที่เลิกใช้แล้ว (EOL register)
> กฎเหล็กข้อเดียวของระบบนี้: **ครอบครัวเป็น Sovereign เจ้าของระบบ — AI/ระบบอัตโนมัติเป็นเพียงผู้รับใช้**

---

## 1. สถาปัตยกรรมโดยรวม (Architecture)

```
┌──────────────────────────────────────────────────────────────────┐
│  HOST (Windows)  —  ทำงานบนเครื่องในบ้าน  ไม่พึ่งคลาวด์           │
│                                                                    │
│  ┌───────────────────────┐      ┌─────────────────────────────┐   │
│  │ sovereign-frontend    │      │ sovereign-core-api          │   │
│  │ Next.js (localhost:3000)◄────►│ Express (localhost:3001)    │   │
│  │ UI หน้าเว็บทั้งหมด      │ JWT  │ ใจกลางของระบบ — ทุกโมดูล      │   │
│  └───────────────────────┘      │  ต่อที่นี่                    │   │
│                                 └─────────┬───────────────────┘   │
│  ┌───────────────────────┐                │                        │
│  │ Docker containers     │                │                        │
│  │  sovereign-db         │◄───────────────┤  Prisma (sovereign_v2) │
│  │  (PostgreSQL)         │                │                        │
│  │  sovereign-emqx       │◄───────────────┤  MQTT (อุปกรณ์ IoT)    │
│  │  sovereign-core-api   │ (ตัวจริงรันใน  │                        │
│  │  (:3001, เปิดผ่าน     │  container)    │                        │
│  │   docker-compose)     │                │                        │
│  └───────────────────────┘                │                        │
│  ┌───────────────────────┐                │                        │
│  │ Ollama (localhost:11434)◄──────────────┤  AI ทั้งหมด (LLM)      │
│  │  gemma3:4b · qwen3-vl:8b ฯลฯ          │                        │
│  └───────────────────────┘                │                        │
│  ┌───────────────────────┐                │                        │
│  │ โมดูลต่อพ่วง (opt-in)  │◄───────────────┤  Suricata, Pi-hole,    │
│  │  ClamAV, ntopng, ฯลฯ │                │  Telegram, MQTT broker │
│  └───────────────────────┘                │                        │
└──────────────────────────────────────────────────────────────────┘
```

### โครงสร้างโฟลเดอร์
| ที่ | คืออะไร |
|---|---|
| `sovereign-os/core-api/` | Backend เดียว (Express + Prisma + tsx) — ทุกบริการภายใน (`src/services/`, `src/modules/`) |
| `sovereign-frontend/` | หน้าเว็บทั้งหมด (Next.js, `src/pages/`) |
| `sovereign-os/infra/` | `docker-compose.yml` + `.env.example` — เปิด/ปิด container |
| `sovereign-os/core-api/data/` | ไฟล์ state ที่ต้องรอดตาย (kill-switch, first-responder, reality-corrections, ฯลฯ) |
| `sovereign-os/core-api/tests/` | เทสต์ทุกชุด — `npm test` ต้องผ่าน 100% ก่อนส่งงาน |

### สายข้อมูลสำคัญ
- **DB จริง = `sovereign_v2`** — อย่าไปยุ่งกับ schema ผ่าน `prisma migrate dev` (shadow DB พัง) ใช้ migration manual + `migrate deploy`
- **AI ทั้งหมดคุยผ่าน Ollama** ในเครื่อง (`host.docker.internal:11434` จาก container)
- **ไฟล์ state ต้อง persist** เป็น JSON ใน `data/` + env override ชื่อไฟล์ได้ (ดูตารางในข้อ 3)
- **ประวัติเหตุการณ์** → ตาราง `securityEvent` + real-time ผ่าน SSE `/api/security/nextgen/events`

---

## 2. Runbook (วิธีรัน/กู้ระบบ — 2 หน้า)

### 2.1 เปิดระบบ (ปกติ)
```
# 1) เปิด Ollama ก่อน (ถ้ายังไม่เปิด) — รอให้ models โหลดเสร็จ
# 2) เปิด database + core-api + emqx
cd sovereign-os\infra
docker compose up -d
# 3) เปิด frontend
cd ..\..\sovereign-frontend
npm run dev
# 4) เปิดหน้าจอ
http://localhost:3000  →  login
```

### 2.2 ตรวจสอบความเรียบร้อย
```
docker compose ps                    # 3 containers: db, emqx, core-api ต้อง Running
curl http://localhost:3001/api/health
docker logs sovereign-core-api --tail 50
```

### 2.3 Core API ตาย / container ไม่ขึ้น
```
docker compose logs sovereign-core-api --tail 100   # ดู error
docker compose restart sovereign-core-api
# ถ้ายังไม่ขึ้น: ดู syntax error จากการแก้โค้ด → แก้แล้ว restart ใหม่
# ข้อควรระวัง: แก้ไฟล์ใน src/ แล้ว container รัน tsx watch → restart ได้เลย
```

### 2.4 DB มีปัญหา
```
docker compose logs sovereign-db --tail 50
docker compose restart sovereign-db
# สำรองข้อมูลเสมอ: หน้า Backup & Restore (หรือ docker exec pg_dump)
# อย่าใช้ prisma migrate dev — ใช้ migration manual เท่านั้น
```

### 2.5 ลืมรหัสผ่าน admin / ถูก lock จาก rate limiter
1. rate limiter login = 10 ครั้ง/15 นาที/IP (in-memory) — รอ 15 นาที หรือ restart container
2. reset hash admin ได้โดยแก้ `admin_hash` ใน DB โดยตรง (bcryptjs cost 12) — อย่าลืมคืน hash เดิม

### 2.6 เหตุฉุกเฉิน AI อาละวาด → 3 ขั้น
1. **เปิด Kill-Switch** ที่หน้า Security (SUPERADMIN) — ทุกคำสั่ง AI หยุดทันที (ยัง approve/cancel approval ได้)
2. **เปิด First-Responder Mode** (ถ้ามีหน่วยกู้ภัย/เจ้าหน้าที่เข้าบ้าน) — Vision หยุดแจ้งคนแปลกหน้า หมดอายุอัตโนมัติ 2 ชม.
3. ถ้ายังไม่พอ: `docker compose stop sovereign-core-api` — ระบบตัด AI ทั้งหมด แต่หน้าเว็บ/DB ยังอยู่

### 2.7 แก้ code แล้วต้องทำอะไร
```
cd sovereign-os\core-api && npx tsc --noEmit   # 0 error
cd ..\..\sovereign-frontend && npx tsc --noEmit
npm test                                        # 484+ ผ่านทุกตัว (ใน core-api)
npm run build                                   # frontend ต้อง build ผ่าน
docker compose restart sovereign-core-api       # ใช้โค้ดใหม่
```

### 2.8 เช็คสุขภาพรวม (ซ้อมวิกฤต)
หน้า System Health → ปุ่ม **🧯 Chaos Drill** (SUPERADMIN) ตรวจ: DB, MQTT, backup ล่าสุด (72 ชม.), Threat Intel, IDS, AI Analyst, uptime — ควรทำเดือนละครั้ง

---

## 3. ไฟล์ state ที่ระบบพึ่งพา (อย่าลบ อย่าแก้มั่ว)

| ไฟล์ (`core-api/data/`) | หน้าที่ | env override |
|---|---|---|
| `ai-kill-switch.json` | สถานะฉุกเฉินหยุด AI ทั้งระบบ | `AI_KILL_SWITCH_FILE` |
| `first-responder.json` | โหมดรับมือเหตุฉุกเฉิน (หมดอายุอัตโนมัติ) | `FIRST_RESPONDER_FILE` |
| `reality-corrections.json` | reality anchors — คำยืนยันครอบครัวว่า AI เตือนผิด | `REALITY_CORRECTIONS_FILE` |
| `chaos-drill-last.json` | รายงาน Chaos Drill ครั้งล่าสุด | `CHAOS_DRILL_FILE` |
| `living-mode.json` | Living Mode — ระบบห้ามเตือนรบกวนการใช้ชีวิต | `LIVING_MODE_FILE` |
| `manual-day.json` | วันไร้ระบบอัตโนมัติ (พัก automation + หมดอายุอัตโนมัติ) | `MANUAL_DAY_FILE` |
| `maintenance-radar.json` | ทะเบียนงานบำรุง + สถานะ sensor drift | `MAINTENANCE_RADAR_FILE` |
| `app-control.json` (ฯลฯ) | สถานะควบคุมแอป/กฎอื่น ๆ | ตามที่ service นั้นประกาศ |

---

## 4. ทะเบียน EOL (เลิกใช้แล้ว — ห้ามนำกลับมาใช้ใหม่)

| รายการ | สถานะ | หมายเหตุ |
|---|---|---|
| `core-api/src/modules/auth/devices/device.routes.ts` | ❌ ลบแล้ว (2026-08-14) | Dead code — duplicate ของ `modules/devices`; backup อยู่ที่ `%TEMP%\opencode\dupes-backup\auth-devices` |
| `core-api/src/modules/auth/nodes/node.routes.ts` | ❌ ลบแล้ว (2026-08-14) | Dead code — duplicate ของ `modules/nodes`; backup อยู่ที่ `%TEMP%\opencode\dupes-backup\auth-nodes` |
| `prisma migrate dev` | ⛔ ห้ามใช้ | Shadow DB พัง — ใช้ migration manual + `migrate deploy` |

> **กฎ EOL:** ทุกสิ่งที่ลบ ต้อง backup ไป `%TEMP%\opencode\` ก่อน แล้วจดไว้ในตารางนี้ พร้อมวันที่

---

## 5. ปรัชญา (อ่านก่อนแก้ระบบ)

1. **Synthetic Insanity** — AI ที่ถูกหลอก/เตือนผิดซ้ำ ๆ จนเฟ้อ — ระบบต้องมี reality anchor (หน้า Security → Reality-Check)
2. **Antifragility** — ระบบต้องแข็งแรงขึ้นเมื่อโดนโจมตี/ซ้อม (Chaos Drill) ไม่ใช่เปราะแตก
3. **Boundary Friction** — อย่าทำให้ AI "เรียบเกินไป" จนใช้คำสั่งแรง ๆ ได้สะดวก — ทุกคำสั่งอันตรายต้อง friction (อนุมัติ/ยืนยัน)
4. **Intergenerational Dynasty** — ระบบต้องอยู่ข้ามรุ่น: รหัสอ่านง่าย, เอกสารชัด, ไม่พึ่งคนคนเดียว — เอกสารนี้คือส่วนหนึ่งของข้อนี้
5. **Hardware Supply-Chain Decay** — อุปกรณ์จีน/ฮาร์ดแวร์ที่ห้ามพึ่งไม่ได้ — ทุกอย่าง local-first, backup ในเครื่องเสมอ

---

## 5. Phase 5 — Embracing Chaos (ภัยซ่อนเร้นระดับ Emergent — หน้า 🌿 วิถีชีวิต)

> ระบบเราสร้างมาเพื่อ "ควบคุม" — หน้าที่ของ Phase 5 คือออกแบบ **ช่องว่างแห่งความไม่ควบคุมโดยตั้งใจ**
> กฎเหล็ก: **มนุษย์คือ actuator ตัวจริง ระบบแค่แนะนำ** (advisory-only ในส่วนนี้ ไม่สร้าง actuator เพิ่ม)

| ภัย Emergent | หลักการ | ระบบรับมือ (implemented) |
|---|---|---|
| ① **Immunological Sterilization** (Hygiene Hypothesis) | บ้านสะอาดเกินไป → ภูมิคุ้มกันถดถอย 3-5 ปี | Chaos Windows: เป้าเปิดรับอากาศธรรมชาติ 60 นาที/วัน, นับจากเซ็นเซอร์ `door_state`, เตือนเมื่อต่ำ (หน้า วิถีชีวิต) |
| ② **Goodhart's Law of Living** | ดัชนีกลายเป็นเป้า → ชีวิตไปรับใช้กราฟ | Living Mode: กฎ automation ที่วัด "ร่องรอยการมีชีวิต" (`LIFESTYLE_METRICS` = smoke/power_kw/เสียง ฯลฯ) **ห้ามเตือน/alert/Telegram** เมื่อเปิด — ระบบไม่เคยลงโทษการใช้ชีวิต |
| ③ **Chrono-Disruption / Circadian Drift** | แสง/อุณหภูมิ "ราบรื่นเกินไป" → Melatonin/Cortisol รวน | Chaos Windows: คำนวณพระอาทิตย์ขึ้น/ตก (ละติจูดบ้าน) + ช่วงหรี่แสง/ตัดแสงสีฟ้า + drift envelope อุณหภูมิ ±3°C — สอนให้มนุษย์ปล่อยธรรมชาติทำงาน |
| ④ **Sovereignty Tax** (O(N²)) | 40 modules = 780 จุดเชื่อมต่อ = ภาษีเวลาชีวิต | Maintenance Radar (หน้า System Health): ทะเบียนงาน 6 งาน (แบต/calibrate/backup/update/drill/MQTT), งานที่ไม่เคยทำ = overdue ทันที, ประเมินชั่วโมง/เดือน, ตรวจ sensor drift ข้าม node อัตโนมัติ |
| ⑤ **Generational Concept Shift** | ลูกที่โตในบ้านอัตโนมัติ ไม่มีโครงสร้างความคิดเรื่องโลกกายภาพ | Manual Day: พัก automation ทั้งบ้าน (default 24 ชม., lazy expiry) — ให้มือคนกดสวิตช์จริง + การ์ด "บ้านทำงานยังไง" ในหน้า วิถีชีวิต |

### ไฟล์/จุดสำคัญของ Phase 5
- `services/chaos-windows.service.ts` — solar calc (NOAA ย่อ) + นับนาที door open จาก `sensor_telemetry` (time_bucket 1 นาที)
- `services/living-mode.service.ts` + guard ใน `automation.service.ts:checkMetrics` (`LIFESTYLE_METRICS`)
- `services/manual-day.service.ts` — พัก `automationEngine.paused` + lazy expiry
- `services/maintenance-radar.service.ts` — ทะเบียนงาน + drift check (cross-node อุณหภูมิ >2.5°C / ความชื้น >8%)
- `modules/lifestyle/lifestyle.routes.ts` → `/api/lifestyle/*` (feature: `/lifestyle`)
- config: `config.lifestyle.*` — `HOME_LATITUDE`/`HOME_LONGITUDE`/`HOME_UTC_OFFSET_MIN` (ไทย 420) ฯลฯ

> ⚠️ **เวลาแสดง:** container รัน TZ=UTC → ทุกเวลาธรรมชาติต้องคำนวณด้วย `utcOffsetMin` เอง อย่าใช้ `toLocaleTimeString` กับข้อมูล solar ใน backend

---

## 5b. Phase 6 — The Final Hardening (Meta-Layer / Epistemic Isolation)

> ช่องโหว่ระดับ meta 5 ข้อ: เอาโหมดช่วยเหลือเป็นอาวุธ, เวลาเบี้ยว, SSD ตายเงียบ, ชิปฮาร์ดแวร์รวน, แฮก AI ผ่านคนในบ้าน
> แบ่งเป็น **ชั้นซอฟต์แวร์ (implemented ครบ)** + **ชั้นฮาร์ดแวร์ (ต้องติดตั้งจริง — checklist ท้ายหมวด)**

| ภัย Meta | หลักการ | ระบบรับมือ (implemented) |
|---|---|---|
| ① **Emergency Exploitation** — ผู้บุกรุกจัดฉากเหตุฉุกเฉินให้ระบบสลับ First-Responder/Living Mode | Zero-Trust Emergency: เปิดโหมดฉุกเฉินต้องมาจาก**ปุ่มกลไกในบ้าน** (MQTT `sovereign/{node}/emergency/button` → source=`physical`) ผ่าน API/UI ได้แต่ต้องเป็น SUPERADMIN + หลักฐาน | MQTT physical button (worker `mqttIngest.ts`) + **Honeypot Logging**: FR mode ระบบยังถ่ายภาพ/วิเคราะห์เงียบ ๆ → `VisionAlert kind='honeypot'` (ลับ — ดูได้ที่ `GET /api/vision/honeypot` SUPERADMIN เท่านั้น, ไม่มี Telegram, ไม่ขึ้น alert) |
| ② **Byzantine Time Drift & NTP Poisoning** — นาฬิกาเบี้ยว 30 วิ = token ทั้งบ้านหมดอายุ + chaos windows ผิด + logs ไม่เป็นเหตุเป็นผล | Time-Consensus: 3 อาการ (clock jump / DB desync / non-causal log order) เกณฑ์ 2 วิ → `TIME_DESYNC_ALERT` | `time-consensus.service.ts` ตรวจทุก 60 วิ (เปรียบเทียบ `Date.now()` vs `SELECT NOW()` vs ลำดับ securityEvents ล่าสุด 25 ตัว) + SSE + route `GET /api/security/nextgen/time-consensus` + check ใน Chaos Drill |
| ③ **NAND Flash Exhaustion & Silent Bit Rot** — SSD เสื่อม TBW, ข้อมูลเพี้ยนเงียบ 0→1 | เช็คซัมทุก state file + เขียน atomic | `data-integrity.service.ts`: ไฟล์ state ทั้งหมดเขียน `.sha256` sidecar (7 services), ตรวจตอนโหลดทุกครั้ง, สแกนทั้ง `data/` ทุกสัปดาห์ + ตอน boot → ไฟล์เพี้ยน = quarantine (`*.corrupt-ts`) + `BIT_ROT` critical; Chaos Drill เพิ่ม check `storage-write-budget` (นับ rows/ชม. → TBW/ปี vs `SSD_TBW` — อายุ < 5 ปี = เตือนย้าย RAMDisk) |
| ④ **Hardware Chatter / Relay Chattering** — ชิปรวนสับรีเลย์ 100 ครั้ง/วิ = แผงไฟไหม้ก่อน server รู้ | ซอฟต์แวร์ RC filter: ≥3 วิ/คำสั่ง/relay + ฟิวส์ล็อก + ฟัง relay state จากชิป | `relay-guard.service.ts`: gate 3 วิ (`429`), สั่งถี่ 10 ครั้ง/60 วิ → ล็อก 10 นาที (ปลดได้ `POST /api/relay/unlock/:relayId` SUPERADMIN), ชิปสับ 8+ ครั้ง/3 วิ (MQTT `sovereign/+/relay/+`) → `RELAY_CHATTER` critical + ล็อก; ดูสถานะ `GET /api/relay/guard` |
| ⑤ **Prompt Injection via Family Members** — "พ่อบอกให้ทำ แต่พ่อลืม passcode" | Strict AI/Actuator Separation: AI = Adviser เท่านั้น; action ระดับความปลอดภัยต้องมีมนุษย์ยืนยันเสมอ | `prompt-injection.guard.ts` (7 pattern: อ้างอำนาจครอบครัว/ลืมรหัส/ปิด security/ข้ามขั้นตอน/instruction override) — บล็อกก่อน Ollama + `PROMPT_INJECTION` event; `SENSITIVE_TOOLS` (blockIP/unblockIP/killProcess) **บังคับอนุมัติแม้ autonomy=autonomous** (`agent-actions.service.ts`) |

### ไฟล์/จุดสำคัญของ Phase 6 (ซอฟต์แวร์)
- `services/time-consensus.service.ts` + `data-integrity.service.ts` + `relay-guard.service.ts` + `prompt-injection.guard.ts`
- `services/first-responder.service.ts` — `source: 'physical'|'api'|'system'` + `activatePhysical()`
- `services/vision-rule.service.ts` — Honeypot (FR active → ยังวิเคราะห์, บันทึก `kind='honeypot'`)
- `workers/mqttIngest.ts` — subscriptions ใหม่: `sovereign/+/emergency/button`, `sovereign/+/relay/+`
- Stream types ใหม่: `TIME_DESYNC`, `RELAY_CHATTER`, `BIT_ROT`, `INJECTION`
- config: `config.storage.ssdTbw` (`SSD_TBW`, default 150)

### 🛠️ Hardware Checklist — Phase 6 (ต้องติดตั้งจริง — ซอฟต์แวร์ทำได้แค่ตรวจจับ/เตือน)

| ข้อ | สิ่งที่ต้องทำ | สถานะ |
|---|---|---|
| ① | ปุ่มกลไก (physical panic button) ต่อ ESP32 → publish `sovereign/{node}/emergency/button` (payload `1`/`ON`) | ⏳ ต้องติดตั้ง |
| ② | Hardware RTC **DS3231** ต่อตรง server (อย่าพึ่ง NTP internet อย่างเดียว) + GPS NMEA module = แหล่งอ้างอิงที่ 2/3 — `TIME_DESYNC` ที่ขึ้นคือสัญญาณให้เริ่มต้นที่ตรงนี้ | ⏳ ต้องติดตั้ง |
| ③ | ย้าย telemetry รายวินาทีลง RAMDisk/Redis แล้ว aggregate ลง SSD ทุก 15-30 นาที; root/logs mount แบบ read-only; พิจารณา ZFS/Btrfs (checksum + scrub รายสัปดาห์) — `storage-write-budget` FAIL ใน Chaos Drill = ถึงเวลาต้องทำ | ⏳ ต้องติดตั้ง |
| ④ | **RC Filter / Delay Circuit** ที่ตัวรีเลย์ (กันสับถี่เกิน 1 ครั้ง/3 วิได้แม้ชิปพัง) + **VLAN แยก IoT/ESP32 ออกจาก WAN 100%** — relay-chatter ที่เห็นใน SSE คือหลักฐานว่าอุปกรณ์เริ่มรวน | ⏳ ต้องติดตั้ง |
| ⑤ | (ซอฟต์แวร์ซีลแล้ว) — เสริม: ปุ่มยืนยันกายภาพ/ตัวเลข OTP หน้า API สำหรับ action ระดับวิกฤต (ไฟ/น้ำ/ประตู) | ⏳ optional |

---

## 6. ปรัชญา (อ่านก่อนแก้ระบบ)

> **สุดท้าย:** ถ้าเอกสารนี้กับโค้ดขัดแย้งกัน — เอกสารผิด ไปแก้เอกสาร แล้วบันทึกการแก้ที่ `/audit` เสมอ