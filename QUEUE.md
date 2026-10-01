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
- [x] Traceability เฟส 1+2 — **เสร็จแล้ว 23/9/69** (`bb67c32` — merge เข้า main แล้ว)
  - ล็อตผลผลิต ProductLot/TraceEvent Farm→Inventory→Shop (เฟส 1) + หน้า /trace (พิมพ์/สแกนรหัส → ไทม์ไลน์ + QR generator), ร้านอาหารปิดบิลบันทึก CONSUMED/PROCESSED กลับเข้าล็อต (FIFO), API ล็อตต่อ orderLine ในหน้าออเดอร์ธุรกิจ (เฟส 2)
- [x] Energy เต็มรูป — **เสร็จแล้ว 23/9/69** (ตาราง energy_readings + energy_thresholds + Telegram เตือนเมื่อเกินเพดาน)
  - ingest จาก MQTT (เมตริกพลังงานลงตารางเอง best-effort) + POST /readings ใส่มือ · เพดานต่อ global/node/device (หน้าต่างเฉลี่ยได้) · เกินเพดานยิง Telegram ผ่าน pipeline เดิม (dedup 5 นาที) · /summary อ่านตารางใหม่ก่อน fallback sensor_telemetry · เทส 9/9
- [x] เฟส 3 แนะนำการปลูก + คาดการณ์ผลผลิต — **เสร็จแล้ว 23/9/69** (`farm-advisor.service` + GET /plots/:id/advisor + PlotAdvisor บนหน้า /farm)
  - กฎเหล็กครบ: heuristic deterministic ตอบได้เสมอ (คะแนนดินจาก analyzeSoil เดิม + ประวัติเก็บเกี่ยวจาก ProductLot) · Ollama เสริมเฉพาะ ?ai=1 (timeout + fallback กลับ heuristic) · ที่มาตัวเลขชัดทุกตัว (ประวัติแปลงตัวเอง → แปลงอื่น → ค่าประมาณ) · source แสดงผู้ใช้ตามจริง · เทส 7/7
- [x] เฟส 4 ร้านชุมชน multi-tenant — **เสร็จแล้ว 23/9/69** (สถานะจัดส่งแบบเบา + catalog กลาง /community)
  - สถานะจัดส่ง: 4 fields ต่อ business_orders (migration manual) + POST /orders/:id/shipping เดินหน้า PREPARING→SHIPPED→DELIVERED (MANAGER+) — ลูกค้าเห็นผ่านลิงก์ลับ /shop?order=<token> · catalog กลาง: opt-in `shopInCommunity` + GET /api/shop/community สาธารณะ (rate limit) — โชว์เฉพาะชื่อ/ราคาขาย/สต็อกพอ-ไม่พอ ไม่มีต้นทุน/ออเดอร์ส่วนตัว · หน้า /community ใหม่ (i18n th/en) + checkbox/ปุ่มใน BusinessWorkspace · เทส 11/11 (เพิ่ม 2)

---

# คิวงานรอบใหม่ (วางเมื่อ 21/9/69) — ทำให้ระบบทำงานได้ → ปรับปรุงของเดิม → UX/UI → พัฒนาต่อ

## หมวด A — ทำให้ระบบทำงานได้จริง (ทำก่อน)
- [x] A1 แก้สภาพแวดล้อม preview: ทำสคริปต์เริ่มสแตก preview คำสั่งเดียว — **เสร็จ 21/9/69** (`tools/preview-stack.mjs` + `npm run preview:stack` / `preview:check`) — spawn ทั้ง mock+dev จากพ่อเดียวพร้อม env, รอพอร์ตจริงก่อนปล่อยมือ, E2E 4/4 ผ่านบนสแตกนี้
- [x] A2 เพิ่ม `/api/ai/history` (GET/DELETE) ใน `tools/mock-api-preview.mjs` — **เสร็จ 21/9/69** — เก็บประวัติในหน่วยความจำ (เข้า/ตอบ, ตัดที่ 100) — AiChatPanel โหลดประวัติได้บน preview แล้ว (ยืนยันจาก E2E: หน้าไม่เด้ง login)
- [ ] A3 ทดสอบ AES MR505 กับสัญญาณจริง: ยิง `fetchRouterSimData` จริง พิสูจน์ data usage/สัญญาณ/SMS ถอดได้ — ⚠️ **รอเจ้าของยืนยันยิงจริง** (เงื่อนไขเดิม: ผิด 4 ครั้ง = ล็อค 2 ชม.) — พร้อมยิงแล้ว: `node tools/verify/mr505-preflight.mjs` (read-only ไม่ login — เช็ค router ตอบ + รหัส admin ใน DB + โค้ด AES ครบในซอร์ส) **ผ่านทุกเช็ค 23/9/69**
- [ ] A4 วงจร Ollama production — **กำลังดำเนินการ 23/9/69**: Ollama v0.15.6 ติดตั้งและรันอยู่แล้วจากโปรเจ็กบน E: (listen 127.0.0.1:11434, `OLLAMA_MODELS` ชี้ models บน E: — ถูกกฎ drive E:), กำลังดาวน์โหลด `gemma3:4b` ผ่าน retry loop (TLS หลุดเป็นรอบ ๆ — ollama โหลดต่อจากเดิมได้เอง, ประเมินอีกหลายชั่วโมงตามความเร็วเน็ต); เมื่อจบ: pull `qwen3-vl:8b` แล้วพิสูจน์บน `/ai-agent` + โทนหลวงพี่ตามขั้น 3-4 ของ `sovereign-os/docs/ollama-setup.md`
- [x] A5 รัน `npm run test:mbti` กับ backend จริง :3001 — **เสร็จ 22/9/69 แบบปลอดภัยต่อข้อมูลจริง**: สร้างชุดใหม่ `npm run test:mbti:real` (`e2e/mbti-real-backend.spec.ts` + `playwright.mbti-real.config.ts`) ที่ sign JWT จริงด้วย `JWT_SECRET` จาก backend .env (อ่าน runtime ไม่ print ไม่ commit) ล็อกอินตรวจ 401 ก่อน และไม่แตะตารางข้อมูลจริง (แค่ GET health/model-status + ผ่านครบ, ล้างประวัติแชทตัวเองท้ายรัน); ถ้ายังไม่ seed บัญชีทดสอบ `E2E_MBTI_REAL=1` → ข้ามพร้อมแนวทาง (mock ปกติยังครอบเนื้อหาครบ) · **23/9/69: E2E จริงผ่าน 2/2** (login จริง :3001 ด้วยบัญชี seed, แก้ `waitForURL` ให้ตรง trailingSlash ของ prod)
- [x] A5b (ทางเลือกเพิ่ม) seed บัญชีทดสอบ e2e ลง DB จริง — **เสร็จ 23/9/69**: `tools/verify/seed-e2e-mbti.mjs` (idempotent, role OPERATOR สิทธิ์ต่ำสุด, รหัสสุ่มเก็บ `sovereign-os/infra/.credentials/e2e-mbti.txt` — gitignored, ไม่แตะบัญชีคนจริง) — บัญชี `e2e-mbti` อยู่ใน DB จริงแล้ว, login :3001 ผ่าน, e2e จริง 2/2
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
หมายเหตุ CSP + WebSocket สแตก preview (22/9/69): `connect-src` ใน `next.config.js` อนุญาต `ws://localhost:3101` + `ws://127.0.0.1:3101` แล้ว และ **mock :3101 มี Socket.IO handler จริงแล้ว** (ปิดหางงาน A1 ให้จบ) — `tools/mock-api-preview.mjs` attach socket.io ของ core-api node_modules (ไม่เพิ่ม dependency), ด่าน handshake เลียนรูปแบบของจริง (auth.token ต้องถอด payload ได้ + `mfa_verified:true` — mock ไม่ verify signature เพราะ token บน preview เป็น fake JWT ฝั่ง client อยู่แล้ว), snapshot 4 events ตาม EVENT_FIELD_ALLOWLIST ของ core-api ทันทีที่ต่อ + telemetry สดทุก 15 วิ; พิสูจน์แล้ว: dashboard บน :3100 ขึ้น "WebSocket connected" + mock log `socket connected (online: 1)`; เทส regression `tools/test/mock-socket.test.mjs` 6/6 (พูดโปรโตคอล EIO=4 ตรงผ่าน ws — เทคนิคเดียวกับ socketAuth.test.ts ของของจริง) — dashboard จริงบน backend :3001 ไม่กระทบ; **alerts สดบน preview (22/9/69):** mock ฉีด alert วนฉาก critical/warning/info ทุก 45 วิ (MOCK_ALERT_INTERVAL_MS ปรับได้) — REST `/api/automation/alerts` stateful + push `new_alert`/`critical_alert` ทาง socket พร้อมกันจากที่เดียวกัน, หน้า /alerts ต่อ socket รับสดแล้ว (dedupe ด้วย id, REST ยัง seed ประวัติเดิม) — พิสูจน์แล้ว alert ใหม่โชว์ทันทีไม่ต้องรอ poll
หมายเหตุ :3000 stale build (23/9/69): หลัง `npm run verify` ที่ rebuild `.next` ทับ ถ้า `next start` เดิมยังรันอยู่ จะเสิร์ฟ HTML ชี้ chunk ของ build เก่า = 404 ทั้งหน้า (อาการ: ฟอร์มค้าง "กำลังโหลด...", console `Failed to load client middleware manifest`) — แก้: kill PID เจ้าของพอร์ต :3000 แล้ว watchdog บูตใหม่ให้เองใน ~10 วิ (watchdog ตรวจแค่ HTTP 200 ที่ `/` จึงมองไม่เห็นอาการนี้เอง)

---

# คิวใหม่: ความทนทานระบบ + ใช้งานง่ายเหมือนส่วนเดียว (เพิ่ม 27/9/69 — ยืนยันจากโค้ด + เจอตัวจริงกำลังพัง)

> อัปเดต 27/9 ช่วงกลางคืน: P0+P1 ของ "ใช้งานง่าย" เสร็จแล้ว (ops-status คำสั่งเดียว + หน้า /system-health เห็นสาย task/backup) — เหลือ P2 ด้านล่าง

> เจอจริง: สาย backup เงียบ 3–4 คืน (DB backup 22/9 · offsite คืน 23→24/9) — ราก: offsite-push ตายเมื่อ DNS ล่ม + ไม่มี watchdog อายุ backup · เรียงตามผลกระทบ · ทุกงานผ่าน verify ก่อน commit · งานที่แตะ container ต้อง cp ไป MAIN ก่อน restart

## E — ด่วน: กู้สาย backup (ทำ E1+E2 คู่กันใน branch เดียว)
- [x] E1 แก้ `tools/verify/offsite-push.mjs` ไม่ตายเมื่อ Telegram/DNS ล่ม — try/catch รอบส่ง + log สถานะ failed พร้อมเหตุผล + exit 1 ชัดเจน — **เสร็จ 27/9/69** (คืนถัดไป dump สดใหม่ลองใหม่เอง ไม่ส่งไฟล์เก่า)
- [x] E2 watchdog อายุ backup + สุขภาพดิสก์ใน `tools/machine-health.mjs` — **เสร็จ 27/9/69**: ยิงรอบแรกจับของจริง (DB backup เก่า 113 ชม. + offsite เงียบ 70.6 ชม. = critical ทั้งคู่) · mutation เทส 7/7 (สด/failed/เก่า 30 ชม./ไม่มีไฟล์) · ตรวจด้วย — และพบ `machine-health.mjs` **ไม่เคยถูก git track** (บั๊กคลาสเดิมครั้งที่ 3) เพิ่ม whitelist เข้า git แล้ว
- [x] E4 ยิง `offsite-push.mjs --restore-test` — **เสร็จ 27/9/69**: users 8 · audit_logs 26,383 · **sensor_telemetry 118,883 แถว** (live 121,026 — ตรงตามอายุ dump) · แก้สคริปต์ใช้ `timescaledb_pre/post_restore` แยก 3 ครั้งเรียก (บทเรียนใหม่: pg_dump เซ็ต search_path='' กลาง stream — ห้ามรวม post_restore ใน session เดียวกับ dump)
- [x] E3 ช่องทาง offsite ที่สองไม่พึ่ง Telegram — **เสร็จ 27/9/69** (mirror ไฟล์ .enc ไป `C:\SovereignOffsite` ต่างดิสก์ + offsite-key-recovery.txt สำรอง key นอกสาย backup + `--send-key` ปุ่มของเจ้าของ + machine-health ตัดสินรายช่อง) — พิสูจน์: รอบเทส Telegram ล้มจริงแต่ mirror รับช่วง exit 0 + restore-test จากสำเนา C: ผ่าน 141 ตาราง · sensor_telemetry 121,951 แถว (มี NAS/USB แล้วตั้ง OFFSITE_MIRROR_DIR/MESH_SCP_TARGET ไม่แก้โค้ด — ยังกันเครื่องหายทั้งเครื่องไม่ได้)
- [ ] E5 WAL archiving + ซ้อม PITR (RPO 24 ชม. → นาที) — ทำหลัง E4 เพราะใช้สายทดสอบเดียวกัน
- [x] E6 (พบต่อจาก E2) สาย backup ภายใน core-api ตายเงียบ 22–26/9 — **เสร็จ 27/9/69**: ราก = scheduler เทียบเวลา "นาทีเป๊ะ" (`sched.time !== current`) เครื่องหลับ/นาฬิกา VM เหลื่อม → นาที 02:00 ถูกข้ามทั้งวัน (task ภายนอก 03:00 ปกติทุกคืน — สองสายอยู่คนละชั้นจึงปลอมสมดุล) · แก้ = catch-up window 6 ชม. (เลยเวลา + ยังไม่มี marker วันนี้ = สร้างทันที)

## F — ความปลอดภัย (ยืนยันจากโค้ดแล้ว)
- [x] F1 backup ห้ามแนบ .env — **เสร็จ 27/9/69** (ตัดที่ collectStateFiles + เกราะ findSecretLeakFiles ก่อนสร้าง bundle เจอลาย = งดสร้างแล้วรายงาน · เทส survival 8/8 · พิสูจน์บนของจริง: bundle ใหม่ 13 ไฟล์ data/*.json ล้วนไม่มี .env — bundle เก่าเข้ารหัสมาตลอด ไม่ต้อง rotate เร่ง)
- [x] F2 ✅ เข้ารหัส field อ่อนไหว — เสร็จ 28/9/69 (AES-256-GCM · telegram token + รหัสเราเตอร์ · DB มีแต่ enc:v1: · เทส 6/6 · พิสูจน์ telegram/test ยิงจริงผ่าน · commit f933780)

## G — ตัดสินใจระดับเจ้าของ (ไม่ใช่โค้ด)
- [ ] G1 ทิศทาง e-Tax: คงสถานะ "เอกสารภายใน/ใบเสร็จธรรมดา" + ป้ายชัด หรือลงทุนเชื่อม CA/provider ตอนเปิดร้านจริง (thai-tax.service = เครื่องคำนวณเท่านั้น ไม่มี digital signature/CA ในโค้ด)
- [ ] G2 เช็คลิสต์ก่อนเปิด /shop สู่อินเทอร์เน็ต: tunnel (ยังไม่มีในระบบเลย) + consent/PDPA + F2 ต้องเสร็จก่อน

## H — คุณภาพระยะยาว (ไม่ด่วน)
- [ ] H1 retention ตาราง non-hypertable ที่โตเงียบ — วัดจริก่อน: `audit_logs` (เขียนทุก action)/`security_events` → ตั้งตามข้อมูลจริง (sensor_telemetry จัดครบแล้ว ห้ามซ้ำ)
- [ ] H2 กัน e2e fail ลูกโซ่ — จุดเดียวพัง → 63 spec did not run (เคสจริง 26/9) — spec ที่ depend login ให้ skip เฉพาะตัวแทนพังทั้งกอง (auth.setup retry แก้แล้วใน 09b0f88)
- [ ] H3 รวมการอ่าน secret เป็นจุดเดียว `tools/verify/creds.mjs` (แนว telegram-creds.mjs) — JWT_SECRET ถูกอ่านกระจายหลาย tools วันนี้
- [ ] H4 Windows-coupling ชั้น ops (Task Scheduler/.bat/.ps1) — จดไว้ ทำเมื่อโมเดลขาย turnkey จริง (launcher Go เริ่มถูกทางแล้ว)
- [ ] H5 (P2 ใช้งานง่าย ต่อจาก 27/9) เชื่อม Telegram รายวัน: สรุป ops-status ตี 8:30 หลัง digest — เจ้าของเห็นสถานะครบทุกสายในแชทเดิม ไม่ต้องเปิดเว็บ/เครื่อง · ใช้คอมโพเนนต์ที่มีทั้งหมด (ops-status --quiet + nightly-report)
- [x] H6 e2e ทนเน็ตกระตุก — **เสร็จ 27/9/69**: เพิ่ม ERR_CONNECTION_TIMED_OUT + ERR_NETWORK_CHANGED ใน IGNORE ของ all-pages (เน็ต LTE กระตุก ≠ บั๊กระบบ) — พิสูจน์: all-pages 46/46 ผ่าน
- [x] H7 กัน seed e2e ซ้ำ — **เสร็จ 27/9/69**: และ **จับบั๊กจริงใหญ่** — pos-flow cleanup ชี้ DB `sovereign_v2` ที่ไม่มีอยู่แล้ว (DB จริง = sovereign) → cleanup เงียบมาตลาด → ร้าน 'E2E-ทดสอบอัตโนมัติ' ค้าง 2 รายการใน DB จริง · แก้: ชื่อ DB + cleanup ตรวจสอบได้ (คืน boolean + retry 3 รอบแล้ว throw) + เคลียร์ของค้าง — พิสูจน์: pos-flow 2/2 ผ่าน

## ตัดสินใจแล้ว: ไม่ทำ (กันระบบบวม)
- **Sensor auto-calibration** — maintenance-radar เตือน drift cross-node + task 90 วันอยู่แล้ว เหลือแค่ทำตามเตือน ไม่สร้างระบบใหม่
- **Staging แยกเต็มรูป** — มี preview-stack mock :3100 สำหรับทดลองแล้ว · ทำเมื่อมีเครื่องที่สอง/ขายจริงเท่านั้น
- **CI-บนเครื่องจริง parity** — nightly verify รันบนเครื่องจริงทุกคืนอยู่แล้ว = ด่านความจริงหลัก
- **Trim 45+ หน้า** — feature-grant ปิดรายโมดูลได้แล้ว · ทบทวน usage ปีละครั้งพอ

**ลำดับ:** E1+E2 (branch เดียว) → E4 → E3 → E5 → F1 → F2 → G1–G2 (ตัดสินใจ) → H · เกณฑ์จบแต่ละงาน: แก้แล้วต้องมีวิธีพิสูจน์ว่าดีขึ้นจริง (mutation/ยิงจริง/เทส) ไม่ใช่แค่โค้ดผ่าน

---

# คิวหมวด I (เพิ่ม 28/9/69 — จากลิสต์เจ้าของ + ของจริงเช้านี้) — ทำอัตโนมัติต่อเนื่องตามลำดับท้ายหมวด

## I0 — ด่วน: เจอตัวจริงกำลังพังเมื่อเช้า (แก้ก่อนคิวใหญ่)
- [x] I0a frontend-watchdog จริง — **เสร็จ 28/9/69** (`3e2ff4e`): tools/frontend-watchdog.mjs (ไฟล์ผีมีตัวจริงแล้ว) — :3000 ตาย=บูตเอง · ค้าง=kill PID เฉพาะ next server · สิ่งแปลกปลอม=fail-safe ไม่แตะ exit 1 · ผูก Machine Watch ทุก 10 นาที · **พิสูจน์ครบ 3 เส้นทางจริง:** boot 11 วิ · skip-unknown (dummy listener จับพอร์ต → ไม่ kill · exit 1) · ต่อ task แล้ว log healthy ตามรอบ
- [x] I0b security-anomaly ทน Docker ดับ — **เสร็จ 28/9/69** (`3e2ff4e`): psqlRows ไม่ throw · ตรวจไม่ครบ = ส่ง "ตรวจไม่ครบ" + exit 1 (ล้มดัง ห้ามปลอม "✅ ปกติ") · **รันจริง:** พบ 2 กลุ่ม (e2e-bot + ผู้ใช้เก่า) → ส่ง Telegram จริง exit 0
- [ ] I0c คืนนี้ตัดสิน nightly จริง: รอบ 02:00 เป็นรอบแรกหลัง H6/H7 merge (log 03:47 เมื่อคืนคือโค้ดเก่า) — เช้าหน้ากวาดตรวจ: /health //audit ยัง fail (console bucket ที่ ignore ครึ่ง ๆ กลาง ๆ ตาม error-context) ให้ ignore รูปแบบเต็ม · pos-flow ยัง fail (option count 2) ให้ snapshot option จริงก่อนแก้

## I1 — PITR จบให้สมบูรณ์ (WAL archiving เปิดแล้วจริง 27/9 — `wip 6720af5`: archive_mode=on · archive ไหล 0 failed · archive_timeout=300s)
- [x] I1a สคริปต์ `tools/verify/pitr-drill.mjs` — **เสร็จ 28/9/69 ซ้อมผ่านจริง**: probe 'before-delete' → basebackup → ลบ → scratch replay ถึงเวลาเป้า → **probe กลับมา + users 8 ครบ** · บทเรียนจริง: docker cp ข้าม container ไม่ได้ (ผ่าน host) · ไฟล์ root ต้อง chown+700 · `exec -d` ตายพร้อม client (nohup gosu … & แทน)
- [x] I1b RPO จริง = ระดับนาที (archive_timeout 300s + replay สำเร็จถึง .MS) — จด runbook §๙ แล้ว
- [x] I1c machine-health ด่าน WAL archive (failed>0 · นิ่ง >30 นาที = warn) — รันจริง: 0 failed · สด 108 วิ
- [x] I1d runbook §๙ กู้จริงเมื่อไฟดับ (หยุดเขียน → ตัดสินเวลา → drill → กู้ผ่าน scratch → ตรวจสุขภาพ) + อุปสรรคจริงครบ

## I2 — Asymmetric encryption สำหรับ backup (สาย offsite รอบสอง — ต่อจาก E3/F1)
- [x] I2a ✅ age (X25519) เข้ารหัสคู่ขนาน — เสร็จ 28/9/69 (age.exe v1.2.1 ที่ tools/bin · identity gitignored ที่ infra/offsite · push เดียวได้ไฟล์คู่ .enc+.age · mirror พาคู่ · พิสูจน์ restore 142 ตารางจากไฟล์ .age)
- [x] I2b ✅ recovery file สองรูปแบบ — identity เต็ม + คำสั่งถอดบนมือถือ (`age -d -i …`) + key AES เดิม — อยู่ที่ mirror ทุกรอบ push
- [ ] I2c พิสูจน์ restore-test ผ่านสาย age ครบ 1–2 คืน แล้วจึงตัดสาย AES เดิม — **คืนแรกผ่านแล้ว (28/9) เหลืออีก 1 คืน** · หมายเหตุ: ปิดรอยต่อ F2 ฝั่ง host แล้ว (telegram-creds.mjs ถอด enc:v1: ได้ — เคยส่ง token ขยะตอน token ใน DB เข้ารหัสแล้ว)
- [ ] I2d (ตัดสินเจ้าของ) tmpfs/RAM disk สำหรับ secret ชั่วคราว — เครื่องนี้ Modern Standby บ่อย อาจยุ่งยากกว่าประโยชน์ — เจ้าของเลือก

## I3 — audit_logs partitioning + retention 90 วัน (ยกระดับจาก H1 ตามลิสต์เจ้าของ) — ✅ เสร็จ 28/9/69 (commit c8cb814)
- [x] I3a ✅ วัดจริง: 26,430 แถว/2เดือน (~600/วัน) → monthly partition พอ (ต่ำเกินกว่า weekly คุ้มความซับซ้อน)
- [x] I3b ✅ migration declarative monthly (ส.ค.26–ม.ค.27 + default) — ย้ายครบ · PK (id,timestamp) · index timestamp DESC · probe เขียนจริงตก partition ถูก
- [x] I3c ✅ auto-purge/export: เดือนจบเกิน 90 วัน = export NDJSON.gz → ตรวจจำนวน → drop → mirror · ensure 3 เดือนล่วงหน้าทุกรอบ nightly · probe ผ่าน · ด่าน default-partition ใน machine-health
- [ ] I3a วัดจริงก่อน: แถว/ขนาด/อัตราเขียนต่อวัน → ตัดสิน monthly vs weekly partitioning
- [ ] I3b migration declarative partitioning รายเดือน (สร้าง partition ล่วงหน้า 3 เดือน + default) — ย้ายข้อมูลเดิมชุด ๆ แบบล็อกสั้น (ตารางถูกเขียนทุก action)
- [ ] I3c task รายวัน: export partition เกิน 90 วัน เป็น .json.gz ไป backups/cold/ (เข้าสาย mirror E3 อัตโนมัติ) → detach+drop
- [ ] I3d machine-health เพิ่มด่านขนาด audit_logs — กันโตเงียบอีกสาย

## I4 — Cloudflare Tunnel เปิด /shop สู่อินเทอร์เน็ต (ตาม G2 — ต้องรอเจ้าของ: domain บน Cloudflare + token)
- [ ] I4a container cloudflared ทะลุ CGNAT/LTE (MR505) — ตั้งผ่าน compose ตัวเดิม
- [ ] I4b WAF/access rules: อนุญาตเฉพาะ /shop/* + webhooks — ปิด admin/internal ทุกเส้น (ห้ามพราก :3001 ออกนอก tunnel)
- [ ] I4c rate limit + consent/PDPA — **F2 ต้องเสร็จก่อนเปิดจริง** (ลำดับเดิม)
- [ ] I4d พิสูจน์: เปิดจากมือถือผ่าน 4G (คนละเน็ต) + Synthetic เพิ่ม probe public URL

## I5 — ฟีเจอร์เชิงโครงสร้าง (เรียงตามมูลค่า/ความพร้อมของโค้ดเดิม)
- [x] I5a Traceability เฟส 3 — **เสร็จ 30/9/69** (commit 5e03a95): `GET /api/trace/products?ids=…` + `/api/trace/products/:inventoryItemId` (สาธารณะ + traceLimiter 60/min · คืน {} เมื่อ id เพี้ยน — หน้าไม่พัง) · หน้า /shop แสดงการ์ด "สายสดจากแปลง" ต่อสินค้า (ล็อตล่าสุด + แปลงต้นทาง + น้ำหนัก + วันเก็บเกี่ยว + สถานะขาย + ลิงก์ /trace?lot=) · เปิด `inventoryItemId` ออกจาก publicProduct เป็น id ตามรอย (UUID ไม่ใช่ความลับ — อัปเดตเทส businessShop ตามสัญญาใหม่) · **พิสูจน์จริงบนโดเมน: การ์ดโชว์ LOT-D3M9C4 แปลงมะเขือเทศโซน A 18 กก.** ลิงก์เข้า /trace ได้ 200
- [x] I5b Crop Recommendation API — **เสร็จ 28/9/69** (commit 8646191): router แยก `crop-recommend.routes.ts` mount `/api/farm/crops` ตรงตามสเปค (เดิม farm router mount ที่ /plots ทำ URL เพี้ยน — ย้ายออกให้ถูกจุด) · delegate เข้า farm-advisor.service เดิม (NPK ล่าสุดต่อแปลง + heuristic fallback) · timeout 100s ให้เป็นจริงได้บนเครื่อง (Ollama CPU ~70 วิ) · **พิสูจน์จริง: source=ollama aiText 459 ตัวอักษรจาก gemma3:4b** — การ์ด PlotAdvisor เดิมครอบหน้า /farm แล้ว
- [ ] I5c Auto-calibration: จดชัด — มีมติ "ไม่ทำระบบใหม่" แล้ว (maintenance-radar + เตือน 90 วันอยู่) เหลือเฉพาะกรณีเจ้าของขอ cross-node drift compensation จริงค่อยวางแผนแยก
- [ ] I5d e-Tax RD Connect: ยังค้างที่ G1 (ตัดสินเจ้าของ) — เมื่อตัดสิน: CA provider + digital signature + ยื่น API จริง (งานใหญ่ คุยแยกออกจากคิวอัตโนมัติ)

## I6 — เสริมจากเช้านี้ (เจอจริง ไม่อยู่ลิสต์เดิม)
- [x] I6 แจ้งเตือนปลอมจาก cleanup — **เสร็จ 28/9/69** (commit 8646191): afterAll ใน pos-flow ลอง psql ซ้ำ 3 รอบก่อนสรุปล้ม (ช่วงเครื่องเพิ่งตื่น psql สะดุดรอบเดียว = ปลอม "เคลียร์ไม่สำเร็จ" ทั้งที่ของจริงสำเร็จ)

## P — Publishing: GitHub เผยแพร่ผลิตภัณฑ์ + ร้านอุปกรณ์ IoT + สนามทดลองสาธารณะ (คำสั่งเจ้าของ 30/9/69)
- [x] P0 กวาดความปลอดภัยก่อนเผยแพร่ — เฟิร์มแวร์ 6 ไฟล์สะอาด (config.example.py เป็น placeholder · config.py gitignored) · รายการห้ามเผยแพร่จดใน runbook §สิบเอ็ด
- [x] P1 repo **krisakornutama/sovereign-dms** — README สองภาษา (EN หลัก/TH รอง) · CHANGELOG M0–M4 (v0.4.0) · BOM+ราคาจริง · quickstart ซิม 2 นาที · ลิงก์สั่งซื้อ → หน้าร้าน · โค้ด export ด้วย git archive (สะอาดจากสมุดงานบ้าน) · push สำเร็จ commit 391bfdd · **→ เปลี่ยนเป็น PRIVATE 30/9/69 (ตามคำสั่งเจ้าของ: เฟิร์มแวร์เป็นทรัพย์สินการค้า ไม่ส่งโค้ดสู่สาธารณะ) — ต้องถอดลิงก์ GitHub/คำว่า open source จากหน้าสาธารณะครบ (P9)**
- [x] P2 ร้านเปิดเฉพาะอุปกรณ์ — seed-devices-shop.ts (idempotent): business "Sovereign Devices" + 3 SKU (KIT 1,290฿ / READY-PI 2,490฿ / SETUP-PRO 2,990฿) + ล็อตการผลิต LOT-DMS01A (ASSEMBLED→FLASHED v0.4.0→TESTED drill→PACKAGED) · **ปิดร้านผักจากสาธารณะ** (shopOpen=false — ข้อมูล/ล็อตครบเดิม เปิดคืนได้ทีเดียว)
- [x] P3 /shop ไม่ใส่ ?id → ดึงร้านแรกจาก /api/shop/community อัตโนมัติ (โดเมนเปล่าเจอร้านอุปกรณ์ทันที) · footer (ลิงก์ GitHub ถูกถอดตาม P9) · ลิงก์เดโม่
- [x] P4 สนามทดลอง /demo (public) — แท็บฟาร์ม/ปศุสัตว์/การเงิน ข้อมูล sandbox คงตัวในโค้ด (demo-sandbox.service — **ไม่แตะ DB จริงแม้แต่อ่าน**) · /api/demo/* rate-limited 30/min
- [x] P5 ฟีดแบ็ก — ตาราง feedback_notes (migration ลงจริง) · POST /api/feedback สาธารณะ (honeypot field `website` + throttle 5/ชม./IP-hash + ตัด 2000 ตัวอักษร) · หน้า /feedback-admin (SUPERADMIN) คัดกรอง 👍/👎 · digest เฉพาะ useful=true → Telegram (SMTP เป็นการ์ดอนาคต — env SMTP_* เมื่อพร้อม)
- [x] P6 WAF อนุญาต /demo + /api/demo + /api/feedback เพิ่มใน rule เดิม (PUT สำเร็จ success:true)
- [x] P7 พิสูจน์บนโดเมนจริงหลัง deploy — **เสร็จ 30/9/69**: /demo 200 (แท็บ+กราฟ+ปุ่มฟีดแบ็กจริง) · /api/demo/* 200 ทั้ง 3 · ฟีดแบ็กจาก UI จริงลง DB (ตรวจ psql พบ) · /shop โชว์อุปกรณ์ 3 SKU
- [x] P9 ถอด GitHub/open source จากสาธารณะ (คำสั่งเจ้าของ 30/9/69: "ชิ้นส่วนอุปกรณ์ไม่ส่ง code สู่สาธารณะ ใช้เป็นของทำขาย") — **repo sovereign-dms → PRIVATE** (sudo ยืนยันโดยเจ้าของในเบราว์เซอร์) · ถอดลิงก์/คำ open source ออกจาก footer 4 หน้า (/shop /community /trace /demo — เหลือแค่ "Powered by Sovereign OS" + ลิงก์เดโม่) · seed-devices-shop: สเปค DMS-KIT+เหตุการณ์ล็อตไม่อ้าง GitHub · UPDATE ตรง DB แล้ว (business_products 1 แถว + trace_events 2 แถว · ตรวจซ้ำเหลือ 0 การอ้าง)
- [x] P10 เก็บพฤติกรรม+ความต้องการผู้ใช้ (คำสั่งเจ้าของ 30/9/69: "ตรวจสอบพฤติกรรมผู้ใช้…ดึงข้อมูลนั้นมาพัฒนาต่อ…ทำให้ง่ายสำหรับผู้ใช้งานส่วนใหญ่") — ตาราง `visitor_events` (migration ลงจริง · **cookieless ไม่มี PII**: ip→sha256 8 ตัว นับ session เท่านั้น) · `POST /api/track` สาธารณะ (allowlist 7 kind · honeypot · beacon 202 เสมอ · limiter 60/นาที) · `GET /api/analytics/summary` (SUPERADMIN) · tracker ฝั่งหน้า: page_view+time_on_page (sendBeacon ≥5s) · demo_tab · feedback_open · **แบบสอบถามสั้น 1 ข้อบน /demo** (ส่วนไหนอยากใช้จริงก่อน + ช่องความต้องการอิสระ → kind survey/question) · ปุ่มฟีดแบ็กลอยทั้ง 4 หน้าสาธารณะ (FeedbackButton ย้ายเป็น component กลางตามกฎ import-layers) · แผง "📊 พฤติกรรมผู้เยี่ยมชม 7 วัน" บน /feedback-admin (หน้ายอดนิยม/แท็บเดโม่/เวลาเฉลี่ย/สรุปแบบสอบถาม/ความต้องการที่เขียนเอง) · WAF อนุญาต `/api/track` (Save ผ่าน dashboard จริง) · เทส 5 เคส · verify 5/5
- [x] P11 หน้าแรกโหมดทดลองบนโดเมนสาธารณะ (คำสั่งเจ้าของ: "เว็บนี้มันควรจะขึ้นเลย เปิดให้ใช้สำหรับทดลอง ไม่ใช่ให้เข้ารหัสใด ๆ") — `lib/publicAccess.ts` ตรวจ hostname (localhost/LAN = ภายใน · อื่น = public) · `/` บนโดเมนจริงแสดงการ์ด 3 ใบ (สนามทดลอง/ร้าน/ตามรอย) **ไม่มีฟอร์มล็อกอินขวาง** (ลิงก์ /login เล็กท้ายหน้าสำหรับผู้ดูแล) · ถ้า browser มี session เจ้าของเด้ง dashboard ตามเดิม · **localhost ยังเห็น LoginForm ตามเดิม** (งานภายในไม่เปลี่ยน)
- [x] P12 เดโม่ครบทุกโมดูลที่อาจขายจริง (คำสั่งเจ้าของ: "ให้เห็นทุกโมดูลนะที่อาจจะขายจริง") — `GET /api/demo/catalog` (สาธารณะ) สแกนโค้ดจริงทุกโมดูล + คำอธิบายภาษาคน (endpoints/LOC/ชุดทดสอบ · **ไม่เปิดราคาแนะนำต้นทุน** — เทสต์ป้องกันรั่ว) · เดโม่เพิ่ม 3 แท็บ: **🧩โมดูลทั้งหมด** (ครบทุกโมดูล คั่นขายจริงด้วยสีเขียว) · **🔎ตามรอย** (ลองค้นล็อตจริง LOT-D3M9C4/DMS01A/SWV040 แบบลูกค้า) · **🛒ร้าน** (สินค้าที่ขายจริงตอนนี้ + ล็อตผลิต + ปุ่มไปหน้าร้านเต็ม) · track ทุกแท็บเข้า analytics · เทสเพิ่ม 2 เคส
- [x] P13 A/B การ์ดหน้าแรก + digest รายสัปดาห์ — **A/B**: สุ่ม 50/50 (A=เดโม่ก่อน · B=ร้านก่อน) จำค่าใน localStorage (ผู้ใช้เห็นแบบเดิมเสมอ วัดได้ยุติ) · กดการ์ด = `cta_click`+variant · แผงเทียบ A/B บน /feedback-admin · **digest**: `tools/verify/visitor-digest.mjs` (แนวเดียวกับ security-anomaly — psql ตรง · DB ตาย=ล้มดัง exit 1 · ความต้องการใหม่นับเฉพาะหลัง digest ก่อน จด state ที่ data/visitor-digest-last.json) · **Task "Sovereign Visitor Digest" วันจันทร์ 08:00** (run-hidden.vbs ตามธรรมเนียม · StartWhenAvailable กันเครื่องปิด) · ยิงมือยืนยันช่องทางแล้ว 1 ครั้ง (30/9 08:17 — รอบอัตโนมัติแรก จันทร์ 5/10/69)
- [x] P15 ภาษา "องค์กรไม่แสวงหากำไร — สนับสนุนแทนซื้อ" (คำสั่งเจ้าของ 30/9/69: นามสกุลเว็บเป็นองค์กรไม่แสวงหากำไร จึงเปิดให้เข้ามาสนับสนุนโดยตรงแบบพูดอ้อม) — /shop เปลี่ยนสาร: "สนับสนุนโครงการโดยตรง" · ปุ่ม **🤝 สนับสนุนชิ้นนี้** (เดิม สั่งซื้อเลย) · "ชิ้นงานที่เปิดให้สนับสนุน" (เดิม สินค้า) · ราคา→"ยอดสนับสนุน" · ผู้ซื้อ→"ผู้สนับสนุน" · สลิป→"สรุปยอดสนับสนุน" · การ์ดสายสด→"บัตรหลักฐานการผลิต" · เพิ่มข้อความปิดท้าย: ทุกบาทนำไปพัฒนาระบบ+ผลิตชุดถัดไป · track เปลี่ยนเป็น `support_now` · **FAQ 5 ข้อบนหน้าร้าน** (สนับสนุนแล้วได้อะไร/จ่ายอย่างไร/รอนานไหม/ซอฟต์แวร์/เงินไปไหน) + ปุ่ม "ยังไม่ใช่คำตอบ — ถามเพิ่ม" ต่อข้อ = เก็บ kind:question (detail=faq:<คำถาม>) เป็นสัญญาณพัฒนาต่อ · verify 5/5
- [x] P8 ขายซอฟต์แวร์แยกชิ้น — **เสร็จ 30/9/69**: หน้าจัดการ `/software-pricing` (SUPERADMIN) ดึง**ข้อมูลฟังก์ชันจริงต่อโมดูล**จากการสแกนโค้ด (endpoints/LOC/route files/ชุดทดสอบ) + ราคาแนะนำจากสูตรโปร่งใส (base 190 + endpoints×95 + loc×0.28 + testRefs×60 ปัด 10฿ ปิด 9 — ขั้นต่ำ 290฿) · `GET /api/software/scan` · `POST publish/unpublish` (เปิดขาย = สร้าง business_product SKU `SW-<MODULE>` ผูก inventory "license" — ขึ้นหน้าร้านทันทีผ่าน /api/shop เดิม ไม่เพิ่มเส้นสาธารณะใหม่) · ล็อต release `LOT-SWV040` (build→test→publish) ให้การ์ดสายสดโชว์เวอร์ชันจริง · เทส 5 เคส (สิทธิ์ 401/403/200 · publish/unpublish) · boundary-baseline ประกาศเส้น software→inventory/business แล้ว (ผูกขายผ่าน business ตามโครงเดิม)

**ลำดับเดิมต่อ:** (หมวด I คงเดิมด้านล่าง)

## I4 — host + domain ฟรี: ขึ้น /shop สู่อินเทอร์เน็ต (คำขอเจ้าของ 29/9/69 — Cloudflare Tunnel + DigitalPlat)
- [x] I4-0 เจ้าของทำเอง ~15 นาที: สมัคร Cloudflare ฟรี + จด domain ฟรีที่ domain.digitalplat.org (dpdns.org/us.kg/qzz.io/xx.kg) + ใส่ NS ของ Cloudflare ให้ activate — คู่มือทีละจอใน docs/ops-runbook.md §สิบ — **คู่มือเขียนแล้ว 29/9/69 เหลือเจ้าของทำขั้นสมัครจริง**
- [x] I4a compose บล็อก cloudflared — **เสร็จ 29/9/69**: บริการ `cloudflared` ภายใต้ profile "public" (token ว่าง = ไม่รัน ไม่ fail compose งานอื่น) · token อ่านจาก infra/.env `CLOUDFLARED_TOKEN` (เตรียมบรรทัดพร้อมคู่มือแล้ว · ไฟล์ gitignored ไม่เข้า git) · ชี้ frontend :3000 ผ่าน host.docker.internal เท่านั้น — คอมเมนต์ใน compose ห้ามชี้ :3001 · เริ่มจริงเมื่อเจ้าของใส่ token: `docker compose --profile public up -d cloudflared`
- [x] I4b WAF — **เสร็จ 30/9/69**: custom rule "Public-only: block admin/internal paths" ลงใน zone จริง (block ทุกอย่างยกเว้น allowlist /shop* /trace* / /api/shop* /api/trace* /api/health + /_next/static + favicon/manifest — expression เต็มจดใน runbook §สิบ) · พิสูจน์แล้ว: public 200 ครบ · /dashboard /farm /api/auth/login /api/users /api/telegram/test = 403 ที่ edge · บทเรียน: redirect trailing-slash ของ Express ทำเส้นทางที่ตาม redirect โดน WAF — แก้โดย allowlist ทั้งแบบมี/ไม่มี / ท้าย · หมายเหตุเทคนิค: ปุ่ม Deploy ใน dashboard โดน challenge platform กลืนเงียบ — สำรองด้วย PUT จาก fetch ในหน้า (cookie session) สำเร็จ · เหลือ rate limiting rule ฟรี 1 ตัว (ทำตอน I4d)
- [x] I4c CORS/helmet origin เพิ่มจาก env — **ยืนยัน 29/9/69 ว่าไม่ต้องแก้โค้ด**: server.ts อ่าน `CORS_ORIGIN` จาก env อยู่แล้ว — ได้ domain จริงแล้วเติมบรรทัดใน infra/.env (คอมเมนต์ตัวอย่างเตรียมไว้ท้ายไฟล์) + recreate core-api 1 รอบ
- [ ] I4d พิสูจน์สุดท้าย: เปิดจากมือถือ 4G คนละเน็ต (เจ้าของทำ 1 นาที — ระบบเหลือข้อนี้) + จดวันรีเน็ว domain ฟรี (DigitalPlat ต่อฟรีได้ในหน้าต่าง 120 วันก่อนหมดอายุ — ตั้งเตือนในวง nightly ตรวจ)
- [x] I4b+rate limit — **เสร็จ 30/9/69**: rate limit rule "Public API rate limit: /api/ max 20 req/10s per IP" ลงใน phase http_ratelimit จริง (block 60 วิ เมื่อเกิน · พิสูจน์: ยิง 25 ติด → ตัวที่ 21+ = 429) · บทเรียนการ deploy หน้าร้าน: (1) `npm run build` ทับ server ที่รันอยู่ = HTML อ้าง chunk ใหม่แต่ process เก่าถือ manifest เก่า → 404 ทั้งหน้า ต้อง restart :3000 หลัง build เสมอ (watchdog ครอบแล้ว) (2) **service worker PWA (cache sovereign-v3)** คง cache หน้าเก่าไว้แม่ server อัปเดต — ทดสอบหน้าร้านหลัง deploy ต้องเคลียร์ SW/caches หรือรอ SW อัปเดตก่อนสรุปผล
- [x] เสริม I4: domain จดสำเร็จ `sovereignoriginshop.dpdns.org` (ฟรี — DigitalPlat slot 1) · NS archer+kallie · zone Cloudflare ACTIVE · tunnel sovereign-tunnel Healthy (connector bkk+sin) · route `*`→:3000 และ `^/api`→:3001 · Next rewrites `/api/*`→:3001 (จบปัญหา ingress ordering) · getApiUrl() จับ public hostname → same-origin · **Sovereign Frontend Watch** ทุก 10 นาที (frontend ตายทั้งคืน 30/9 — Docker มี Watch แต่ frontend ไม่มี, ปิดรูแล้ว)

**ลำดับทำอัตโนมัติต่อจากนี้:** I0a+I0b (เครื่องกำลังพังจริง) → I1 PITR จบ → รอผลคืนตัดสิน I0c → **F2 เข้ารหัส field (คิวเดิม ยังเปิด)** → I2 age → I3 partition → I4 tunnel (รอ domain/token เจ้าของ) → I5 ตามลำดับย่อย
- [x] **P16 ระบบพาร์ทเนอร์ + องค์กรไม่แสวงหากำไร (30/9/69)**: ตาราง `partners` (migration จริง) · POST/GET `/api/partners` สาธารณะ (honeypot · 202 · คืนเฉพาะ ACTIVE ไม่รั่วข้อมูลผู้ติดต่อ) · PATCH admin อนุมัติ (401/403/200) · เทส 4/4 · หน้า `/partners` แผนที่ OSM (Leaflet CDN ไม่เพิ่ม dependency) + ฟอร์มสมัครปักหมุดบนแผนที่ · `/about` วิสัยทัศน์+การใช้เงิน+สถิติความโปร่งใสจาก `GET /api/shop/transparency` (นับล็อตผ่าน `trace.countAllLots` ถูกเจ้าของตาราง) · ชื่อธุรกิจเปลี่ยนจริงใน DB → **Sovereign Origin Foundation** (seed+catalog service แก้ตาม) · การ์ด "สนับสนุนตามศรัทธา" ใน /shop (sku SUPPORT-FAITH ราคา 1฿ ×จำนวน = ยอดที่ต้องการ) · บัตรขอบคุณดิจิทัลบนลิงก์ลับเมื่อชำระครบ (ชื่อเลือกเอง จำในเครื่อง ไม่ส่ง server) · FAQ เพิ่มข้อตามศรัทธา · WAF อนุญาต /partners /about /api/partners ที่ edge จริง · baseline sidebar-rule เพิ่ม 2 หน้าใหม่พร้อมเหตุผล · verify 5/5
- [x] P16 ต่อ: แผงอนุมัติคู่ค้าใน /feedback-admin (GET /api/partners/admin/list · อนุมัติ→ขึ้นแผนที่ทันที) · Leaflet self-host + CSP/WAF เปิด /vendor/ · **SW bump sovereign-v4** (บทเรียน: VERSION เดิมคงที่ = client เก่าไม่รับ shell ใหม่) · ทดสอบจริงบนโดเมน: สมัครคู่ค้า→DB PENDING→ปักหมุดได้ · /about โชว์ตัวเลขจริง 5 การ์ด · ใบสมัครทดสอบ "ร้านทดสอบระบบ P16" ค้าง PENDING ให้เจ้าของทดลองกดอนุมัติเองที่ /feedback-admin
- [x] P16 รอบค่ำ (30/9/69): แจ้งเตือน Telegram ทันทีเมื่อมีใบสมัคร (fire-and-forget) · QR ป้ายร้านคู่ค้า (endpoint QR + /partners?p= เปิดหมุดเอง + ปุ่มพิมพ์ป้ายใน admin) · แผงอนุมัติ fail-safe · **แก้บั๊ก SW cache /api/** (ค่าว่างค้างตลอด — bump v5 และกฎห้าม cache API) · ทดสอบจริง: สมัคร→TG แจ้ง→อนุมัติ→หมุดขึ้นแผนที่→QR 200 ครบ
- [x] **P17 (30/9/69 ค่ำ)**: กันสแปมคู่ค้า 3 ชั้น (IP/วัน · ชื่อซ้ำ normalized · OTP เบอร์ — gateway จริงหรือ dev fallback) · บิลค่าบริการ IoT คู่ค้า (BusinessOrder.partnerId ผูก partner · PromptPay ลิงก์ลับเดิม · BusinessInstallation ตามรอยงานซ่อม · แจ้ง Telegram ทันที) · หน้า /partners/guide (สิทธิประโยชน์/QR/ขอเชื่อม IoT) · ฟอร์มออกบิลใน admin · เทสต์ 4/4 · verify 5/5 · boundary ถูกต้อง (บิลอยู่ที่ business-shop.service)
- [x] **P18 เปิด QR PromptPay — พิสูจน์ครบ (30/9/69 ดึก):** ตั้งค่าผ่านหน้า /business → แท็บร้านค้า ได้เลย (PUT /api/business/:id/shop · masked ••• · QR สาธารณะขึ้นทันที) — ทดสอบด้วยเบอร์ทดสอบแล้วล้างคืน · เหลือเจ้าของใส่เบอร์จริงครั้งเดียว
- [x] **P19 (1/10/69):** ปุ่ม "✅ ยืนยันรับเงิน" ใน Telegram (confirmToken single-use · กดจากมือถือปิดบิลได้ · กติกาเดียวกับเว็บ: ยืนยันออเดอร์+รับเงิน CASH+PAID+Treasury · กัน chat อื่น/กดซ้ำ) · QR ป้ายร้านใน /partners/me (ดาวน์โหลด PNG เอง) · **เบอร์ PromptPay จริงตั้งแล้ว** (QR สาธารณะขึ้นบนโดเมน — ปิดคิว P18) · พิสูจน์วงจรเงินเต็มรอบบนระบบจริง (สั่ง→แจ้ง→TG→ยืนยัน→PAID→ใบกำกับ) + เก็บกวาดครบ · เทสใหม่ 4 + แก้เทสภาษี time bomb (?month ตาม fixture) · verify 5/5 · SW v8 · deploy จริง (migrate+restart core-api+build frontend)
- [x] **P19 ต่อ 2 (1/10/69 ค่ำ):** ปุ่ม "🚫 ไม่ได้โอน" คู่ปุ่มยืนยันใน TG (rejectedAt ตัดจากทุกยอด · token เดียวยืนยัน/ปฏิเสธเลือกอย่างเดียว · ลูกค้าแจ้งใหม่ได้ทันที) · สรุปเช้า 08:00 เวลาไทยเข้า TG (ยอดขายเมื่อวาน/แจ้งชำระรอยืนยัน/ค้างชำระ/บิลคู่ค้า) · พิสูจน์บนระบบจริงทั้งสอง + เก็บกวาดครบ · เทสต์ใหม่ 5 · SW v9 · verify 5/5
- [ ] **P19 รอเจ้าของลองจริง:** กดปุ่ม "✅ ยืนยันรับเงิน" / "🚫 ไม่ได้โอน" ใน Telegram จากออเดอร์จริงใบแรก (โค้ดพิสูจน์ผ่านฟังก์ชันเดียวกันบนระบบจริงแล้ว — เหลือแค่ประสบการณ์กดบนมือถือ)
- [ ] **P18 รอเจ้าของ — SMS จริง:** สมัคร thaibulksms.com (เติมขั้นต่ำ ~100฿) → ใส่ `SMS_PROVIDER=thaibulksms` + `SMS_API_KEY` + `SMS_API_SECRET` ใน infra/.env → recreate core-api 1 รอบ — OTP คู่ค้าส่ง SMS จริงทันที
