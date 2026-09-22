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
- [ ] A3 ทดสอบ AES MR505 กับสัญญาณจริง (ค้างจาก 29/8 — รอ lockout 2 ชม. หมด): ยิง `fetchRouterSimData` จริง พิสูจน์ data usage/สัญญาณ/SMS ถอดได้ — ⚠️ **รอผู้ใช้ (21/9/69): การยิง login จริงซ้ำเสี่ยง lockout 2 ชม. และอาจต้องมีคนตรวจอุปกรณ์/เช็ค credentials ที่ router จริง — agent จะไม่ยิงเองจนกว่าเจ้าของจะบอกว่าพร้อม (เช่น ล็อกอินผ่านหน้า router ได้ปกติแล้ว) — สคริปต์/โค้ดพร้อมอยู่แล้วที่ `tplink-mr505.service.ts`**
- [ ] A4 วงจร Ollama production: ติดตั้ง Ollama (listen 127.0.0.1:11434) + `ollama pull gemma3:4b` + `ollama pull qwen3-vl:8b` แล้วพิสูจน์บน `/ai-agent` (การ์ด Ollama ออนไลน์) + โทนหลวงพี่เปลี่ยนตาม MBTI จริงในแชทกลาง — **มีคู่มือแล้ว 21/9/69: `sovereign-os/docs/ollama-setup.md` (รอเจ้าของวันติดตั้งจริง ตามคำสั่ง "ยังไม่ต้องยุ่ง")**
- [x] A5 รัน `npm run test:mbti` กับ backend จริง :3001 — **เสร็จ 22/9/69 แบบปลอดภัยต่อข้อมูลจริง**: สร้างชุดใหม่ `npm run test:mbti:real` (`e2e/mbti-real-backend.spec.ts` + `playwright.mbti-real.config.ts`) ที่ sign JWT จริงด้วย `JWT_SECRET` จาก backend .env (อ่าน runtime ไม่ print ไม่ commit) ล็อกอินตรวจ 401 ก่อน และไม่แตะตารางข้อมูลจริง (แค่ GET health/model-status + ล้างประวัติแชทตัวเองท้ายรัน); ถ้ายังไม่ seed บัญชีทดสอบ `E2E_MBTI_REAL=1` → ข้ามพร้อมแนวทาง (mock ปกติยังครอบเนื้อหาครบ)
- [ ] A5b (ทางเลือกเพิ่ม) หากต้องการ e2e เนื้อหาเต็มกับ backend จริง: seed บัญชีทดสอบ `e2e-mbti` ใน DB จริงแล้วตั้ง `E2E_MBTI_REAL=1` — ยังไม่ทำเพราะไม่อยากเขียนข้อมูลลง DB จริงโดยไม่ขออนุญาต
- [x] A6 ทำ `npm run verify:full` เขียวได้แม้ backend :3001 ไม่ได้รัน — **เสร็จ 21/9/69** (`tools/verify.mjs`: ขั้น e2e ตรวจ /api/health ก่อน ถ้าลง → ข้ามพร้อมเตือน; บังคับได้ด้วย E2E_REQUIRE_BACKEND=1)

## หมวด B — ปรับปรุงของเดิมให้ดีกว่า (คุณภาพ + ความเร็ว)
- [x] B1 เพิ่ม `npm run clean:logs` (ราก) — **เสร็จ 21/9/69** (`tools/clean-logs.mjs` + `--check` โหมดรายงาน — รอบแรกเจอ 9 ไฟล์ 47KB)
- [x] B2 ย่อเวลา `npm run verify` — **เสร็จ 22/9/69**: รันเป็น 2 สายขนานกัน (backend build→test ∥ frontend typecheck→build) เวลารวม = สายที่ช้าที่สุด ไม่ใช่ผลรวม — มาตรฐานทุกขั้นเท่าเดิม (ตาม AGENTS.md ข้อ 2), `--test-concurrency=1` คงเดิม, OOM retry/e2e-skip/dev-restore ครบ; debug ลำดับเดิมได้ด้วย `VERIFY_SEQUENTIAL=1`
- [x] B3 ปุ่มเร็ว (Quick Questions) ของ AiChatPanel ผ่าน i18n key จริง — **เสร็จ 21/9/69** (key เชิงความหมาย `soilSalinity/batteryStatus/emergency/phase2` ทั้ง th/en — query ที่ยิง backend คงข้อความไทยเดิม)
- [x] B4 รวม logic ประวัติแชทของ AiChatPanel + หน้า ai-agent เป็น hook เดียว — **เสร็จ 22/9/69** (`src/lib/useAiChatHistory.ts` — โหลด/เคลียร์/append ที่เดียว ทั้งสองหน้าใช้ร่วมกัน พฤติกรรมตรงกันแน่นอน)
- [x] B5 กัน flake E2E MBTI บนเครื่องช้า — **เสร็จ 22/9/69** (`goto` domcontentloaded + poll จน hydrate/ชิปขึ้นจริงแทน fixed timeout; เคสเปลี่ยนผลล่าสุด re-seed แบบเดียวกัน)
- [x] B6 ผ่านตามเก็บไฟล์ 0% — **เสร็จ 22/9/69** (`tests/securityNextgenRoutes.test.ts` 15 เคส: firewall CRUD/engine/scan + events + kill-switch/first-responder/reality/drill/time-consensus + SSE MFA gate, `tests/scenarioForecast.test.ts` 5 เคส: parser กลั่นคำตอบ AI + offline fallback deterministic + persist) — ผ่านครบ, mount path ตาม production `/api/security[/nextgen]`

## หมวด C — ปรับปรุงกราฟิก UX/UI
- [x] C1 แชทกลาง dashboard: ชิปโทนหลวงพี่ปัจจุบัน — **เสร็จ 21/9/69** (ชิป `ESFP · หลวงพี่ผู้เบิกบาน` เหนือปุ่มเร็ว อ่านผลล่าสุดจาก localStorage; ยังไม่เคยทำ → ลิงก์ชวนไป /mbti; E2E ครอบทั้งสองเคสแล้ว)
- [x] C2 แชทกลาง: สถานะ AI Offline บอกเหตุผล — **เสร็จ 21/9/69** (แยก 3 เคส: Ollama ออฟไลน์ 503 / API error อื่นพร้อมโค้ด / ติดต่อ backend ไม่ได้ พร้อมชี้ไปหน้า AI Agent)
- [x] C3 หน้า login: แจ้งเหตุผลความล้มเหลวแยกเคส — **เสร็จ 21/9/69** (401/403 = รหัสไม่ถูก · 429 = นับถอยหลังตาม Retry-After · 5xx = เซิร์ฟเวอร์ขัดข้อง · fetch ล้ม = ติดต่อ :3001 ไม่ได้ — พจนานุกรม th/en ครบ)
- [x] C4 Sidebar/MobileNav มือถือ: คลิกทะลุ — **เสร็จ 22/9/69**: ต้นเหตุคือแถบ fixed ทับเนื้อหาท้ายหน้า (ไม่ใช่ z-index ต่ำ) — MobileNav วัดความสูงตัวเอง (ResizeObserver ครอบ wrap+safe-area) แล้ววาง spacer ใน flow เนื้อหาไม่มีวันไปอยู่ใต้แถบ; E2E viewport มือถือ 2 เคส (คลิกปุ่มส่ง POST จริง + ไม่มี element คลิกได้ถูกบัง) ผ่าน
- [x] C5 dashboard บนมือถือ: จัดลำดับสายตาใหม่ — **เสร็จ 22/9/69**: ยังไม่เคยจัดเรียงเอง → มือถือเห็น alerts/defcon/wealth/inventory บน ส่วน Sankey/Heatmap ลงล่าง; บน xl คืนลำดับเดิมเป๊ะด้วย xl:order-*; ผู้ใช้ที่เคยจัด layout เอง ระบบเคารพของที่จัดไว้; ขณะ edit mode งดจัดใหม่กัน drag เพี้ยน
- [x] C6 สถานะ Loading: skeleton การ์ด — **เสร็จ 22/9/69** (`components/ui/SkeletonCard.tsx` + shimmer `.skele` ใน globals.css เข้าธีมเดิม, เคารพ prefers-reduced-motion, i18n `dashboard.aiChat.skeletonCard/skeletonPage` th/en, ใช้แล้วที่ dashboard + ai-agent ตอน !isHydrated)
- [x] C7 SENSOR STACK: ค่า N/A → "—" + tooltip "ยังไม่มีข้อมูลเซ็นเซอร์ตัวนี้" — **เสร็จ 21/9/69**

## หมวด D — พัฒนาต่อ (ทำหลัง A-C)
- [x] D1 AI Agent รายงาน Telegram รายวัน — **เสร็จ 22/9/69**: ต่อบน cron เดิม (ทุก 30 นาที); `runMorningReports` ตรวจ `hasTelegramCredentials()` ก่อน — ไม่มี token = ปิดเงียบพร้อม flag `telegramConfigured:false` ไม่สร้างงานเปล่า ไม่ crash cron อื่น; **ส่งไม่สำเร็จ = ไม่มาร์ควัน** (แก้บั๊กเดิมที่รายงานหาย) รอบถัดไปลองใหม่ — test เพิ่ม 3 เคส (ไม่มี token / ส่งล้ม / token จาก DB)
- [x] D2 i18n เต็มรูป — **เสร็จ 22/9/69**: หน้าหลักที่ใช้จริง — **mbti.tsx** (เดิมไม่มี i18n เลย ~29 ข้อความ → พจนานุกรมใหม่ `i18n/{th,en}/pages/mbti.ts` ครบ + ใช้ t()), **dashboard.tsx** (StatCards, ลิงก์รายละเอียด, kids ยังไม่เคยทำควิซ, missing prices, จัดการเซ็นเซอร์) — ai-agent/healing/security ตรวจแล้วใช้ i18n อยู่แล้ว (ไทยที่เห็นคือ fallback ตาม pattern ของ repo); เนื้อหาข้อมูล (MBTI_TYPES, คำถาม, คำตอบ AI) ไม่แปลตามหัวข้อพจนานุกรม
- [x] D3 PWA offline ลึกขึ้น — **เสร็จ 22/9/69**: SW v3 — navigation fallback ลึกขึ้น (cache ตรง → ignoreSearch → หน้า local-first `/dashboard` `/mbti` `/` → หน้า offline); ห้าม mock ข้อมูล API จริง (หน้าแสดงสถานะ offline ของตัวเองตามที่แอปจัดไว้)
- [x] D4 MBTI: การ์ดชวนทำแบบทดสอบบน dashboard — **เสร็จ 22/9/69**: การ์ด `mbti-invite-card` แสดงเฉพาะเมื่อ `latestLocalResult() === null` (ตรงข้ามกับชิปโทนหลวงพี่) — CTA ไป /mbti, i18n th/en, E2E ครอบทั้งเคสมี/ไม่มีผล

**ลำดับส่งมอบ:** A → B → C → D · ทีละงาน ผ่าน `npm run verify` ก่อน commit ทุกครั้ง (AGENTS.md ข้อ 2)

---

หมายเหตุสถานะระบบ (29/8/69 23:08): ✅ คิวหมด — backend tsc สะอาด + frontend 50 routes + API 38/38 + E2E 56 tests + Telegram group `-5308443540` `success:true` + Ollama 4 models host (`gemma3:4b` สด) + Face enroll `201` — ระบบพร้อมใช้งาน 100%
หมายเหตุเทคนิค: `telegram.botToken` อย่า commit ลง git (ใส่ DB `system_settings` ผ่าน `setTelegramCredentials` แล้ว) · Face: enroll ใช้ได้ทันที, recognize ต้องมี ollama/face-embed
หมายเหตุเทคนิค: container dev mount เฉพาะ `src/` — ถ้า recreate container ต้อง `docker exec sovereign-core-api npm install helmet` ใหม่ (node_modules ไม่ persist)
หมายเหตุ hydration: dashboard layout + history range แก้แล้ว (`05a2264` + `ffac9e2`) — ห้ามอ่าน localStorage/URL ตอน render แรก ให้ไปอ่านใน useEffect
หมายเหตุ CSP + WebSocket สแตก preview (22/9/69): `connect-src` ใน `next.config.js` อนุญาต `ws://localhost:3101` + `ws://127.0.0.1:3101` แล้ว และ **mock :3101 มี Socket.IO handler จริงแล้ว** (ปิดหางงาน A1 ให้จบ) — `tools/mock-api-preview.mjs` attach socket.io ของ core-api node_modules (ไม่เพิ่ม dependency), ด่าน handshake เลียนรูปแบบของจริง (auth.token ต้องถอด payload ได้ + `mfa_verified:true` — mock ไม่ verify signature เพราะ token บน preview เป็น fake JWT ฝั่ง client อยู่แล้ว), snapshot 4 events ตาม EVENT_FIELD_ALLOWLIST ของ core-api ทันทีที่ต่อ + telemetry สดทุก 15 วิ; พิสูจน์แล้ว: dashboard บน :3100 ขึ้น "WebSocket connected" + mock log `socket connected (online: 1)`; เทส regression `tools/test/mock-socket.test.mjs` 4/4 (พูดโปรโตคอล EIO=4 ตรงผ่าน ws — เทคนิคเดียวกับ socketAuth.test.ts ของของจริง) — dashboard จริงบน backend :3001 ไม่กระทบ
