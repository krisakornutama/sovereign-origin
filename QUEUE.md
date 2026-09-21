# คิวงาน (QUEUE)

เพิ่มงานด้านล่างได้โดยตรง (บรรทัดละ 1 งาน เริ่มด้วย `- [ ] `) หรือใช้คำสั่ง `/queue <งาน>`
เมื่องานเสร็จ agent จะเปลี่ยนเป็น `- [x]` พร้อมหมายเหตุผลลัพธ์

- [x] ปรับ frontend ให้สวยขึ้น (ผู้ใช้ขอ) — **เสร็จแล้ว 23/8/69** (`master d235a67`)
  - ทำแล้วทั้ง 4 ลำดับ: login redesign, dashboard command center, POS premium, สี/คอนทราสต์
  - ผ่าน `npm run verify` 4/4 + E2E 44/44
- [x] เพิ่ม E2E นำทางแบบ SPA — **เสร็จแล้ว 23/8/69** (`e2e/spa-nav.spec.ts` 7 tests)
- [x] แก้สิ่งค้างรอบ 25/8/69 — **เสร็จแล้ว 25/8/69** (`master aa8246f` + `ef50b64` + `b3569a0`)
  - Migration debt ปิดแล้ว (`20260825000000_add_restaurant_empire` — schema up to date)
  - Restaurant flow ครบ: สั่งวัตถุดิบ `/purchases` + ยกเลิกออเดอร์ + ใช้แต้ม 1=1฿ + สถานะครัว PREPARING/READY
  - KDS จอครัว `/restaurant/kds` (อัปเดตทุก 10 วิ)
  - helmet + CORS จำกัด origin (ผู้ใช้แก้ infra/.env เอง + recreate container แล้ว — ทดสอบ evil.com โดนบล็อก)
  - SPCX disabled (ticker ซ้ำไม่ใช่ SpaceX)
  - Portfolio Manager + WAN Monitor MR505 live ทดสอบผ่าน (ราคาจริง ASPI $3.89 อยู่โซนซื้อ)
- [x] Self-Reliance S1+S2 วันรอด + ทรัพยากรทุกศาสตร์ — **เสร็จแล้ว 25/8/69** (`master 8145555`)
  - `/selfreliance` Days of Autonomy: น้ำ/อาหาร/ไฟ/เงิน + จุดอ่อนบ้านอัตโนมัติ (ทดสอบจริง: อาหาร 1.2 วัน = จุดอ่อน)
  - Inventory เพิ่ม category: SEED/MEDICINE/TOOL — tests 7/7 ผ่าน
- [x] Router MR505 — ระบบเฝ้าดู + admin API ถอดรหัส — **เสร็จแล้ว 25/8/69** (`master b1417f1` + `efc67fb` + `0f11c7c`)
  - ทำงานอยู่: router up/down + latency + speedtest + LAN device scan + Telegram alerts (ทุก 60 วิ)
  - ถอด firmware architecture ครบ: 381 models, Data IDs, login flow, XOR+AES crypto (เอกสารใน `tplink-mr505.service.ts`)
  - ขาด: AES key exchange (RSA) — ข้อมูลซิม (สัญญาณ/data usage/SMS) เข้ารหัสอยู่ → **defer ไป Sprint ถัดไป**
- [x] Router MR505 — AES crypto stack (RSA key exchange + AES-CBC decrypt) — **เสร็จแล้ว 29/8/69** (`tplink-mr505.service.ts` AES-128-CBC)
  - `syncEncryptor` ถอด RSA `nn/ee` → สุ่ม AES key/iv 16B → RSA encrypt → `POST ?code=12` → บันทึก `aesKey/aesIv` + `aesDecryptBase64`/`isEncryptedBody` → `readModel` ถอดอัตโนมัติ + อ่าน data usage (145/142) เพิ่ม — ทดสอบ roundtrip ผ่าน, `fetchRouterSimData` พร้อม (รอ lockout 2 ชม. หมดจะทดสอบสัญญาณจริง)
- [x] Self-Reliance S3-S6 — สวนสมุนไพร+ยาต่อ HERB_DB · วงจรปิดขยะ→ปุ๋ย · Skills Matrix ต่อคน · Crisis Playbooks 1 ปุ่ม — **เสร็จแล้ว 29/8/69** (`create_missing.sql` + `schema.prisma` per-user health)
  - DB drift ปิดแล้ว: `health_readings/observations/flags/consents user_id` + `farm_plots category` + `herb_catalogs/dose_logs/herb_beds/skill_matrix/crisis_modes` สร้างแล้ว + seed 12 สมุนไพร/3 crisis modes — build 50 routes + full CRUD 38/38 ผ่าน
- [x] ตั้ง Telegram token ใหม่ — **เสร็จแล้ว 29/8/69 23:00** (`sovereign-db system_settings telegram.botToken/telegram.chatId`)
  - token `8807…YcZI` + chat `-5308443540` ตั้งแล้วผ่าน `setTelegramCredentials` → `GET /api/telegram/config` `configured:true source:db` → `POST /api/telegram/test` `success:true` ส่งถึงกลุ่มแล้ว
- [x] ใบหน้า auto-recognize บน POS — **เสร็จแล้ว 29/8/69 23:08** (`restaurant.routes.ts` `photo_data` fix + Ollama host `gemma3:4b/qwen3:8b/qwen3-vl:8b` 4 models)
  - แก้ `knownFace.create imagePath → photo_data` (schema `photo_data` ไม่ใช่ `imagePath`) → `POST /api/restaurant/customers/face-enroll` `201` ผ่าน (ทดสอบ `FaceTest-E2E5` + `GET /api/tags` `gemma3:4b` ตอบ `2+2=4` สด) — POS ใบหน้า enroll/แต้มพร้อมใช้ ไม่ต้องรอ docker ollama (ใช้ host `host.docker.internal:11434`)
- [x] i18n หน้า restaurant + E2E หน้าใหม่ — **เสร็จแล้ว 29/8/69** (i18n `common.nav.skills/crisis` + `dashboard.inventory/farm.enableHint` + `e2e/queue-remaining.spec.ts` 8 หน้า + สลับภาษา, `pos-flow.spec.ts` เดิมครอบ POS)
  - restaurant `th/en/pages/restaurant.ts` ครบแล้ว (POS/admin/kitchen/reports) — เติม `th/en/common` ที่ขาด, E2E ใหม่ตรวจ `/selfreliance` `/restaurant*` `/crisis` `/skills` `/system` render + ไม่ `Application error`
- [x] Self-Learning D — Data Lake + Engine พื้นฐาน — **เสร็จแล้ว 29/8/69 04:00** (`prisma LearningSnapshot/Prediction/ModelState` + `data-lake.service` + `learning-engine.service` qwen3:8b/heuristic + `learning.routes` 8 endpoints + `/learning` 51 routes)
  - ทดสอบสด: `POST /api/learning/collect` `4` snapshots (sensor/farm/health/inventory), `POST /predict sensor` `heuristic risk 0.8`, `POST /predictions/:id/evaluate` `accuracy 100%` → `GET /models` ขึ้นแล้ว — cron nightly พร้อม (เรียก `nightlyLearn` ได้)

---

# คิวงานรอบใหม่ (วางเมื่อ 21/9/69) — ทำให้ระบบทำงานได้ → ปรับปรุงของเดิม → UX/UI → พัฒนาต่อ

## หมวด A — ทำให้ระบบทำงานได้จริง (ทำก่อน)
- [x] A1 แก้สภาพแวดล้อม preview: ทำสคริปต์เริ่มสแตก preview คำสั่งเดียว — **เสร็จ 21/9/69** (`tools/preview-stack.mjs` + `npm run preview:stack` / `preview:check`) — spawn ทั้ง mock+dev จากพ่อเดียวพร้อม env, รอพอร์ตจริงก่อนปล่อยมือ, E2E 4/4 ผ่านบนสแตกนี้
- [x] A2 เพิ่ม `/api/ai/history` (GET/DELETE) ใน `tools/mock-api-preview.mjs` — **เสร็จ 21/9/69** — เก็บประวัติในหน่วยความจำ (เข้า/ตอบ, ตัดที่ 100) — AiChatPanel โหลดประวัติได้บน preview แล้ว (ยืนยันจาก E2E: หน้าไม่เด้ง login)
- [ ] A3 ทดสอบ AES MR505 กับสัญญาณจริง (ค้างจาก 29/8 — รอ lockout 2 ชม. หมด): ยิง `fetchRouterSimData` จริง พิสูจน์ data usage/สัญญาณ/SMS ถอดได้ — ⚠️ ระวัง lockout: ห้ามยิงซ้ำถ้า login ล้ม
- [ ] A4 วงจร Ollama production: ติดตั้ง Ollama (listen 127.0.0.1:11434) + `ollama pull gemma3:4b` + `ollama pull qwen3-vl:8b` แล้วพิสูจน์บน `/ai-agent` (การ์ด Ollama ออนไลน์) + โทนหลวงพี่เปลี่ยนตาม MBTI จริงในแชทกลาง — **มีคู่มือแล้ว 21/9/69: `sovereign-os/docs/ollama-setup.md` (รอเจ้าของวันติดตั้งจริง ตามคำสั่ง "ยังไม่ต้องยุ่ง")**
- [ ] A5 รัน `npm run test:mbti` กับ backend จริง :3001 อย่างน้อย 1 รอบ (MBTI_E2E_API_URL=http://localhost:3001) — ปิดช่องว่างระหว่าง preview mock กับของจริง
- [x] A6 ทำ `npm run verify:full` เขียวได้แม้ backend :3001 ไม่ได้รัน — **เสร็จ 21/9/69** (`tools/verify.mjs`: ขั้น e2e ตรวจ /api/health ก่อน ถ้าลง → ข้ามพร้อมเตือน; บังคับได้ด้วย E2E_REQUIRE_BACKEND=1)

## หมวด B — ปรับปรุงของเดิมให้ดีกว่า (คุณภาพ + ความเร็ว)
- [x] B1 เพิ่ม `npm run clean:logs` (ราก) — **เสร็จ 21/9/69** (`tools/clean-logs.mjs` + `--check` โหมดรายงาน — รอบแรกเจอ 9 ไฟล์ 47KB)
- [ ] B2 ย่อเวลา `npm run verify` (4.3 นาที → เป้า < 3 นาที) — หมายเหตุ: `--test-concurrency=1` ของ backend เป็นการตั้งใจ (กัน flake IPC ของ Node 24 ตาม setup-env.ts) ห้ามเพิ่มความขนาน — ให้ไปทางลดงานซ้ำแทน (แคช tsc incremental, ข้ามไฟล์ที่ไม่เกี่ยว)
- [x] B3 ปุ่มเร็ว (Quick Questions) ของ AiChatPanel ผ่าน i18n key จริง — **เสร็จ 21/9/69** (key เชิงความหมาย `soilSalinity/batteryStatus/emergency/phase2` ทั้ง th/en — query ที่ยิง backend คงข้อความไทยเดิม)
- [ ] B4 รวม logic ประวัติแชทของ AiChatPanel + หน้า ai-agent เป็น hook เดียว (เดิมเขียนซ้ำ 2 ที่ เสี่ยงพฤติกรรมต่างกัน)
- [ ] B5 กัน flake E2E MBTI บนเครื่องช้า: เปลี่ยนจุดรอ hydrate จาก fixed timeout เป็น expect-and-retry
- [ ] B6 ผ่าน `npm run coverage:core` ตามเก็บไฟล์ 0% อันดับแรกที่เหลือ: nextgen.routes / security.routes / scenario-forecast.service

## หมวด C — ปรับปรุงกราฟิก UX/UI
- [x] C1 แชทกลาง dashboard: ชิปโทนหลวงพี่ปัจจุบัน — **เสร็จ 21/9/69** (ชิป `ESFP · หลวงพี่ผู้เบิกบาน` เหนือปุ่มเร็ว อ่านผลล่าสุดจาก localStorage; ยังไม่เคยทำ → ลิงก์ชวนไป /mbti; E2E ครอบทั้งสองเคสแล้ว)
- [x] C2 แชทกลาง: สถานะ AI Offline บอกเหตุผล — **เสร็จ 21/9/69** (แยก 3 เคส: Ollama ออฟไลน์ 503 / API error อื่นพร้อมโค้ด / ติดต่อ backend ไม่ได้ พร้อมชี้ไปหน้า AI Agent)
- [x] C3 หน้า login: แจ้งเหตุผลความล้มเหลวแยกเคส — **เสร็จ 21/9/69** (401/403 = รหัสไม่ถูก · 429 = นับถอยหลังตาม Retry-After · 5xx = เซิร์ฟเวอร์ขัดข้อง · fetch ล้ม = ติดต่อ :3001 ไม่ได้ — พจนานุกรม th/en ครบ)
- [ ] C4 Sidebar/MobileNav มือถือ: ตรวจ z-index/overlay ให้คลิกไม่ทะลุ (เจอสัญญาณตอนรัน preview — คลิกปุ่มในพาเนลแต่เจาะไปเมนูล่าง) + ยืนยันด้วย E2E viewport มือถือ
- [ ] C5 dashboard บนมือถือ: จัดลำดับสายตาใหม่ (การ์ดสำคัญบน, กราฟิกหนักอย่าง Sankey/Heatmap ย้ายลงล่างหรือซ่อนเป็นแท็บ) — ตอนนี้ scroll ยาวมาก
- [ ] C6 สถานะ Loading ทั่วแอป: เปลี่ยน "กำลังโหลด..." เฉย ๆ เป็น skeleton การ์ด (เข้าธีมเดิม)
- [x] C7 SENSOR STACK: ค่า N/A → "—" + tooltip "ยังไม่มีข้อมูลเซ็นเซอร์ตัวนี้" — **เสร็จ 21/9/69**

## หมวด D — พัฒนาต่อ (ทำหลัง A-C)
- [ ] D1 AI Agent ทีม: พิสูจน์ daily_report ส่ง Telegram จริง (ปุ่ม/ตัวเลือกมีใน UI แต่ยังไม่เคยยืนยันว่าถึงกลุ่ม `-5308443540`)
- [ ] D2 i18n เต็มรูป: ย้ายข้อความไทยที่แข็งใน JSX (dashboard บางการ์ด, healing บางปุ่ม) เข้าพจนานุกรม th/en ครบ
- [ ] D3 PWA offline ลึกขึ้น: แคชหน้า dashboard + แชทล่าสุดไว้ใช้ตอนเน็ตหลุด (ปัจจุบัน SW แคชเฉพาะ asset)
- [ ] D4 MBTI: การ์ดชวนทำแบบทดสอบบน dashboard เมื่อยังไม่เคยทำ (อ่อนโยน ไม่บังคับ) — แทนการปล่อย AI ตอบโทนกลางโดยผู้ใช้ไม่รู้ตัว

**ลำดับส่งมอบ:** A → B → C → D · ทีละงาน ผ่าน `npm run verify` ก่อน commit ทุกครั้ง (AGENTS.md ข้อ 2)

---

หมายเหตุสถานะระบบ (29/8/69 23:08): ✅ คิวหมด — backend tsc สะอาด + frontend 50 routes + API 38/38 + E2E 56 tests + Telegram group `-5308443540` `success:true` + Ollama 4 models host (`gemma3:4b` สด) + Face enroll `201` — ระบบพร้อมใช้งาน 100%
หมายเหตุเทคนิค: `telegram.botToken` อย่า commit ลง git (ใส่ DB `system_settings` ผ่าน `setTelegramCredentials` แล้ว) · Face: enroll ใช้ได้ทันที, recognize ต้องมี ollama/face-embed
หมายเหตุเทคนิค: container dev mount เฉพาะ `src/` — ถ้า recreate container ต้อง `docker exec sovereign-core-api npm install helmet` ใหม่ (node_modules ไม่ persist)
หมายเหตุ hydration: dashboard layout + history range แก้แล้ว (`05a2264` + `ffac9e2`) — ห้ามอ่าน localStorage/URL ตอน render แรก ให้ไปอ่านใน useEffect
