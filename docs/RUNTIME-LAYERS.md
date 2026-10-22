# Runtime Layers — เปิดเฉพาะชั้นที่ใช้จริง

> งาน 22/10/69 · สาขา `ai/runtime-layers` · ไม่ restart backend / ไม่ migration / ไม่ deploy
>
> เป้าหมาย: ตอบคำถาม "ระบบทำงานเบื้องหลังตลอดแม้ไม่ใช้ — อะไรจำเป็น อะไรหยุดได้"
> ด้วยการแบ่งบริการเป็นชั้น + คำสั่งเดียวในการเปิด/ปิด + watchdog ที่เคารพโหมด

---

## 1) ข้อเท็จจริงจากการวัดจริง (22/10/69 ~12:21–12:38)

### Container ที่รันอยู่

| ชั้น | Container | หน่วยความจำ | ใช้จริงไหม |
|---|---|---|---|
| core | `sovereign-db` | ~160 MB | จำเป็นเมื่อใช้แอป + backup |
| core | `sovereign-core-api` | ~220–244 MB | จำเป็นเมื่อใช้แอป |
| core | frontend `:3000` (node) | ~87 MB | จำเป็นเมื่อใช้แอป/เว็บ |
| public | `sovereign-cloudflared` | ~23 MB | เปิดลิงก์สาธารณะผ่าน Cloudflare Tunnel |
| iot | `sovereign-emqx` | ~353–364 MB | **6 clients — ทั้งหมดมาจาก core-api (172.18.0.5), ภายนอก 0** |
| security | `wazuh-manager` | ~472 MB | **agents 0 · alert ทั้งหมด 1 (ตอนตัวเองเริ่ม)** |

รวม container + web ≈ **1.33 GB** ก่อนปรับ (VM Docker จำกัด 4 GB ตาม `.wslconfig`)

### หลักฐาน "ไม่ถูกใช้"

- **Wazuh:** `client.keys` ว่าง (0 agents) · alerts มีเพียง 1 บรรทัดตอน manager เริ่ม → ไม่ได้ป้องกันอะไรอยู่
- **EMQX:** clients 6 ตัวเป็น `mqttjs_*`, `worker-*`, `ota-status-*` จาก IP เดียวกันคือ core-api · `delivered_msgs=0` · ไม่มีอุปกรณ์ภายนอก/LAN
  → EMQX ยังจำเป็นกับ **โค้ด backend ที่รันอยู่** (telemetry ingest / relay / OTA / DEFCON) แต่ไม่ใช่ชั้นที่ "มีคนใช้" จากภายนอก
- **Tunnel:** ทำงานและมี connection จริง → เก็บไว้เพราะเป็นทางเข้าลิงก์สาธารณะ
- **TCP ที่ต่อกับ `:3000`:** 0 ขณะตรวจ (ไม่ได้เปิดแอป) → ตัวเว็บพร้อมใช้แต่ไม่มีคนใช้

### งานเบื้องหลังตามเวลา

| งาน | ความถี่ | ประเมิน |
|---|---|---|
| Sovereign Docker Watch | 1 นาที | เบา · จำเป็นต่อการฟื้นเอง |
| Sovereign Frontend Watch | 1 นาที | เบา · จำเป็นต่อการฟื้นเอง |
| Synthetic Browser Check | **5 นาที (ยิง) · 30 นาที (รันจริง)** | เบาลง · เปิด browser 3 โปรไฟล์/รอบ ≈ 48 รอบ/วัน (144 session) |
| Machine Watch | 10 นาที | เบา |
| Nightly Verify | 02:00 | หนัก (~15 นาที) · **เคย build ทับ `.next` ของ prod** |
| DB Backup / Offsite / Gate / Digest | คืนละครั้ง/สัปดาห์ | จำเป็น · เป็นงานตามกำหนด ไม่ใช่บริการรอใช้งาน |

> Task Manager ของเจ้าของ (ภาพ 12:18): memory 84% โดย Vmmem ~2.0 GB, Chrome ~1.3 GB, Steam ~0.7 GB, OpenCode ~0.6 GB
> → **ตัวที่กินมากที่สุดไม่ใช่ Sovereign** แต่เป็น Chrome/Steam/Docker VM · ส่วนที่หยุดได้แบบไม่กระทบแอปคือ Wazuh (472 MB)

---

## 2) ชั้นการทำงาน (modes)

Registry: `tools/runtime-layers.json` · สถานะที่ต้องการ: `sovereign-os/core-api/data/runtime-mode.json` (gitignored)

| mode | เปิด | ใช้เมื่อ |
|---|---|---|
| `core` | db · api · web | ใช้แอปในเครื่อง ไม่ต้องมีลิงก์สาธารณะ/MQTT |
| `connected` | core + tunnel | ใช้แอป + เปิดเว็บสาธารณะ |
| `iot` | connected + emqx | ใช้ farm/IoT/OTA หรือ backend ที่ยังต้องใช้ MQTT ภายใน |
| `full` | iot + wazuh | ต้องการ Wazuh SIEM/security lab |

- `db` / `api` / `web` อยู่ใน **ทุก** mode → backup, nightly, frontend watchdog ทำงานได้เสมอ
- โหมดปัจจุบันของเครื่องนี้: **`iot`** (ตัด Wazuh ออก แต่เก็บ EMQX ไว้เพราะ backend ที่รันอยู่ยังใช้)
- หลัง restart core-api ด้วยโค้ดใหม่ (มี MQTT error listener ครบ) จึงใช้ `connected`/`core` เพื่อตัด EMQX ได้ — ต้องเติม `--force` เพราะเครื่องมือยืนยันเวอร์ชันโค้ดที่รันอยู่ไม่ได้

---

## 3) คำสั่ง

```bash
# ดูสถานะ + memory + ตัวที่ทำงานนอกโหมด (อ่านอย่างเดียว)
node tools/runtime-layers.mjs status
node tools/runtime-layers.mjs status --json

# หลักฐานการใช้งาน: Wazuh agents, EMQX clients ภายนอก, TCP :3000, tunnel
node tools/runtime-layers.mjs evidence

# ดูก่อนว่าจะ stop/start อะไร (ไม่เปลี่ยนอะไร)
node tools/runtime-layers.mjs plan connected

# เปลี่ยนโหมด
node tools/runtime-layers.mjs use iot        # ปัจจุบัน: ตัด Wazuh
node tools/runtime-layers.mjs use full       # เปิด Wazuh กลับ
node tools/runtime-layers.mjs ensure core    # เปิดเฉพาะที่ขาด (ไม่หยุดอะไร)

# หยุด EMQX (หลัง core-api restart แล้วเท่านั้น)
node tools/runtime-layers.mjs use connected --force
```

- `use` เขียน mode file **ก่อน** ลงมือ → watchdog ทุกตัวเห็นทิศทางเดียวกันทันที
- ถ้า registry/mode file เสีย → ใช้ `full` เป็นค่าเริ่มต้น (ไม่หยุดของที่อาจจำเป็น)
- `docker stop` ไม่ลบ container/volume → `use full` หรือ `docker start` กลับได้ทันที

---

## 4) Watchdog เปลี่ยนอะไร

- `tools/docker-watchdog.mjs`: เดิม hardcode `[db, api, emqx]` และปลุก emqx ทุกนาที
  → อ่าน mode แล้วเฝ้าเฉพาะ container ที่โหมดเปิด (ตอนนี้ iot = db/api/emqx; connected = db/api)
- `tools/frontend-watchdog.mjs`: อ่าน mode · ถ้าโหมดไม่มี `web` จะไม่บูต `:3000` กลับ
  (ตอนนี้ทุกโหมดมี web จึงทำงานเหมือนเดิม)
- `tools/verify.mjs`: ถ้า prod กำลังฟัง `:3000` และไม่ได้รัน e2e → build ลง `.next-verify`
  + คืน `next-env.d.ts` ตอนจบ (แม้ verify ล้ม) → **ไม่ทำ chunk/manifest 404 แบบเหตุการณ์ 15:53 อีก**
- `tools/nightly-verify.mjs`: เปลี่ยนเป็น `verify` (non-e2e) + `NEXT_DIST_DIR=.next-verify`
  → nightly ไม่แตะ `.next` ของ prod · e2e ยังรันมือด้วย `npm run verify:full`
- `tools/verify/nightly-gate.mjs`: verify ลง `.next-verify` และ **ไม่ kill prod ที่ healthy**
  (เดิม gate ฆ่า :3000 ทุกคืนเพื่อให้รับ build ใหม่ — ตอนนี้ไม่จำเป็นและลด restart โดยไม่จำเป็น)
- `sovereign-frontend/scripts/synthetic-browser-check.mjs`: คุมความถี่เองที่ 30 นาที/รอบ
  (Task Scheduler ยังยิงทุก 5 นาที แต่ 5 ใน 6 รอบจะจบก่อนเปิด browser) · `--force` สำหรับรันมือ
- MQTT clients 5 ตัวที่ขาด error listener ถูกเติมแล้ว (`mqttIngest`, `start.ts` DEFCON, relay, OTA status, relay scheduler)
  → เมื่อ EMQX ถูกหยุดในโหมดใหม่ backend จะ log error ไม่ crash (มีผลหลัง restart core-api)
- `tools/build-node-kit.mjs` + `tools/agent-pack/pack.mjs`: ตัด `.next*` ทุกพันธุ์ (รวม `.next.broken-*`)
  ออกจากชุดเครื่องใหม่ → ไม่มี chunk ชื่อ `node_modules_*.js` หลุดเข้าชุด และเทสต์กัน node_modules ผ่าน

---

## 5) ผลที่ได้รอบนี้

- หยุด `wazuh-manager` (0 agents) → คืน memory ประมาณ **472 MB** (stats หลังปรับ: active ~876 MB จาก ~1,327 MB)
- ไม่แตะ db/api/web/tunnel/emqx → แอปและลิงก์สาธารณะทำงานต่อเนื่อง
- ลด synthetic จาก ~288 รอบ/วัน เป็น ~48 รอบ/วัน (ลด browser session ~83%)
- ปิดช่องโหว่ nightly build ทับ prod `.next` (ต้นเหตุ outage เดียวกับ 15:53)
- เพิ่มเทสต์ 38 เคส (layers 15 · wiring 2 · verify 8 · synthetic 7 · MQTT 6) + ของเดิมผ่านครบ

> หมายเหตุ: Vmmem ของ WSL อาจไม่คืน RAM ให้ Windows ทันทีแม้ container ถูก stop
> การคืนเต็มจำนวนต้อง restart Docker Desktop/WSL — ซึ่งงดระหว่าง Cold Soak

---

## 6) ยังไม่ทำ (ต้องรอ/ต้องอนุมัติ)

- **Sleep mode** (ปิด db/api/web เมื่อไม่มีคนใช้ แล้วปลุกจาก Electron) — ต้องแก้ launcher + ผูก backup/nightly ให้ปลุกเอง เสี่ยงกว่าและยังไม่จำเป็น
- **ตัด EMQX** ในโหมด `connected`/`core` — โค้ดใหม่พร้อมแล้ว แต่ container ที่รันอยู่ยังเป็นโค้ดเก่า ต้อง restart backend ก่อน (Cold Soak ห้าม)
- **การ์ด Runtime Layers บน dashboard** — ต้อง build frontend + restart :3000
- **Wazuh image/agents** — ถ้าไม่ใช้ security lab สามารถลบ image ได้ภายหลัง (ประหยัด disk) แต่ไม่ทำตอนนี้
- **Steam/Chrome/OpenCode** — ไม่ใช่ process ของ Sovereign · เจ้าของปิดเองได้ถ้าต้องการคืน RAM เพิ่ม

---

## 7) Rollback

```bash
node tools/runtime-layers.mjs use full   # เปิดทุกชั้นกลับ (รวม Wazuh)
docker start wazuh-manager                # เปิดเฉพาะ Wazuh (โหมดยังเป็น iot → status จะเตือน drift)
```

- ลบ `sovereign-os/core-api/data/runtime-mode.json` → ระบบกลับไปใช้ `full`
- Kill switch เดิมยังใช้ได้: `sovereign-os/core-api/data/frontend-watchdog.disabled` / `docker-watchdog.disabled`
- ไม่มีการลบ volume/ข้อมูลใด ๆ ในงานนี้
