# คิวงาน (QUEUE)

เพิ่มงานด้านล่างได้โดยตรง (บรรทัดละ 1 งาน เริ่มด้วย `- [ ] `) หรือใช้คำสั่ง `/queue <งาน>`
เมื่องานเสร็จ agent จะเปลี่ยนเป็น `- [x]` พร้อมหมายเหตุผลลัพธ์

## Enterprise Fleet Control Plane v1 (19/10/69) — branch `ai/enterprise-fleet`

- [x] File-backed fleet state (policy/enrollment tokens) ใต้ `core-api/data/fleet/` — ไม่มี migration
- [x] ช่องทาง stable/beta/canary + rollout % แบบ deterministic ต่อ `(channel, machineId)`
- [x] site/group/tags/channel override รายเครื่อง + compliance จาก heartbeat/version/LAN
- [x] รหัสเชิญ `enr_...` แบบ hash-only, มีโควตา/วันหมดอายุ/เพิกถอน; รหัสเดิม `MACHINE_ENROLL_CODE` ยังใช้ได้
- [x] หมุน machine token + audit ทุก mutation; แก้ `GET /api/agent-machines` ไม่ให้ส่ง `token_hash`
- [x] ด่านอัปเดตทั้ง manifest และ asset (runner + desktop); node kit ยังสาธารณะ/stable
- [x] หน้า `/fleet` + เมนู + i18n + เทสต์ policy/enrollment/UI wiring
- [x] เอกสาร `docs/ENTERPRISE-READINESS.md` + `docs/modules/fleet.md`
- [x] หลัง Cold Soak: restart core-api + rebuild frontend — **เสร็จแล้ว 23/10/69**
- [ ] ทดสอบกับเครื่องจริง 1 เครื่อง (สร้างรหัสเชิญ + ตั้ง site/group ผ่าน UI)
- [x] Phase 2 (หลัง Cold Soak): ย้าย state เข้า DB พร้อม migration/backfill — **เสร็จแล้ว 23/10/69** (`ai/fleet-phase-2`)
  - backup `backups/postgres/sovereign_20261023_150414.dump` + restore drill ผ่าน
  - apply migration `20261023150000_fleet_persisted_model` บน production + restart core-api healthy
  - smoke API DB-backed: policy/overview/enroll-tokens/sites/audit = 200, `/fleet/` = 200
  - [ ] ทดสอบสร้างรหัสเชิญ + ตั้ง site/group ผ่าน UI กับเครื่องจริง 1 เครื่อง
- [x] P0 regression: BOM ใน migration + backfill idempotency — **เสร็จแล้ว 23/10/69** (`cdfe425`)
  - `tools/test/migration-bom.test.mjs` + `fleetPhase2-db.test.ts` (backfill รันซ้ำไม่สร้างแถวซ้ำ) + เพิ่มใน `test:db`
  - `npm run test:db` ผ่าน **36/36** (fleet DB suite 6/6) หลังแก้ harness ให้ token ชี้ UUID ของ user จริงใน DB (`51afe01`)
- [x] Phase 3A: signed runner manifest (Ed25519) + ตรวจสองชั้น — **implement + tests แล้ว 23/10/69**
  - pack เซ็น, HUB ตรวจก่อนตอบ (503 เมื่อไม่ผ่าน), runner ตรวจก่อนแตะไฟล์
  - public key ฝังสองฝั่ง + static test เทียบ; private key อยู่ `tools/agent-pack/keys/signing-key.pem` (gitignored)
  - [x] repack production manifest ด้วย key จริงแล้ว (23/10/69 · version `ab6b8b43b256` · `fleet-update-v1` · verify ผ่าน)
  - [x] restart core-api หลังได้รับอนุญาต — **เสร็จแล้ว 24/10/69 12:32** (เจ้าของอนุมัติ)
    - `prisma migrate deploy` = 65 migrations, ไม่มี drift · `_prisma_migrations` up to date
    - container healthy, restarts=0 · `/api/health` 200 · `/fleet/` 200
    - HUB ตรวจ manifest ตอนรันจริง: `readVerifiedUpdateManifest()` → `ok:true` (`ab6b8b43b256`, ed25519 `fleet-update-v1`, 20 ไฟล์)
- [x] P0 test isolation: `agent-pack.test.mjs` ห้ามเขียน production manifest — **เสร็จแล้ว 23/10/69**
  - incident: `runPack` ที่ไม่ได้ส่ง `updateDataDir` เผยแพร่ทับ production ด้วย `agent-pack-test-key` ระหว่าง full verify
  - แก้ทุกจุดให้ใช้ sandbox + guard ใน `afterEach`; เทสต์ 30/30 ผ่าน; repack production กลับเป็น key จริงแล้ว
- [x] Phase 3B: role `SITE_ADMIN` (จำกัดสาขา, อ่านอย่างเดียว) — **โค้ด + tests แล้ว 24/10/69**
  - enum `SITE_ADMIN` + `users.assigned_site_id` (FK → `fleet_sites`, `ON DELETE SET NULL`) · migration `20261024130000_site_admin_role`
  - fail closed: ไม่ผูกสาขา/สาขาหาย = 403 (`fleet-scope.service.ts`) — ไม่ใช่เห็นทั้งฝูง
  - `/api/fleet/overview|policy|sites|groups|audit` เปิดให้อ่านแบบจำกัดสาขา (summary/channels คิดใหม่, audit กรอง `machineIds`)
  - เส้นเขียน/กุญแจทั้งหมดยังเป็น SUPERADMIN · เปลี่ยน `assigned_site_id` = bump `token_version`
  - ปิดทางอ้อม: `SITE_ADMIN` ถูกปฏิเสธที่ `/api/agent-machines` (403 `SITE_SCOPE_FLEET_ONLY`)
    เพราะเส้นนั้นเปิดให้ทุก role ที่ล็อกอินและคืนเครื่อง/IP ของทุกสาขา
  - เทสต์: `tests/fleetScope.test.ts` 15/15 · `tools/test/fleet-site-scope.test.mjs` 26/26 (แดง exit 1 เมื่อถอด scope ของ `/overview` และเมื่อถอด guard ของ agent-machines)
  - [x] apply migration + restart — **เสร็จแล้ว 24/10/69 13:36** (เจ้าของอนุมัติ)
    - backup `backups/postgres/sovereign_20261024_133607.dump` (5.9 MB) + restore drill เข้าฐานชั่วคราวผ่าน
      (TimescaleDB `pre/post_restore`) — ทุกตารางตรงเป๊ะ (users 8 · audit_logs 26,725 · agent_machines 2 · payment_slips 0)
    - `prisma migrate deploy` = 66 migrations, apply `20261024130000_site_admin_role` สำเร็จ (ไม่มี drift)
    - ตรวจบน production: enum มี `SITE_ADMIN` · `users.assigned_site_id` uuid · index 1 · FK `ON DELETE SET NULL` 1
      · migration record finished (ไม่ rollback) · users ยัง 8 แถว
    - restart แล้ว healthy, restarts=0 · `/api/health` 200 · เส้น `/api/fleet/*` + `/api/users` ตอบ 401 (ต้องล็อกอิน)
    - Prisma client ใน container รู้จัก `SITE_ADMIN` และ `assigned_site_id` แล้ว
- [x] ทางลัดสำหรับเจ้าของ: ดับเบิลคลิก `PACK-MACHINE.cmd` (ไม่ต้องพิมพ์คำสั่ง) — **เสร็จแล้ว 25/10/69**
  - เดิมต้องเปิด PowerShell แล้วพิมพ์ `node tools/agent-pack/pack.mjs --name="..." --full` เอง
    (ลืม flag / แพ็กทับชุดเดิม / ชื่อชนเครื่องที่เคยออนไลน์แล้วจบด้วย error = เริ่มใหม่ทั้งรอบ)
  - ตอนนี้: ดับเบิลคลิก → ตอบชื่อเครื่อง (Enter = ชื่อเครื่องนี้) → ถาม Ollama (~20GB, ค่าเริ่มต้นไม่รวม)
    → ยืนยัน → แพ็กชุดเต็มให้เอง แล้วเปิด Explorer ที่โฟลเดอร์
  - เครื่องละโฟลเดอร์ `dist-machine-setup/<ชื่อเครื่อง>` ⇒ แพ็กเครื่องที่ 2 ไม่ทับชุดของเครื่องแรก
  - ชื่อชนเครื่องที่เคยออนไลน์ = ถามชื่อใหม่ต่อทันที · โฟลเดอร์เดิมมีอยู่ = ถามก่อนทับ (ไม่ force เอง)
  - ตรรกะอยู่ใน `tools/agent-pack/pack-machine.mjs` (`.cmd` เหลือตัวเรียก ASCII ล้วน + `pause`)
  - เทสต์: `tools/test/pack-machine-wizard.test.mjs` 32/32 (แดง exit 1 ตอนยังไม่มีไฟล์)
  - แถม: `pack.mjs --force` ส่งต่อไปถึง `scripts/issue-machine-token.ts` แล้ว
    (เดิม flag ถูกกลืน → แพ็กทับเครื่องที่เคยออนไลน์ไม่สำเร็จ ทั้งที่ข้อความช่วยเหลือบอกว่าทำได้)
    พิสูจน์ด้วยเทสต์ใหม่ใน `agent-pack.test.mjs` (แดง exit 1 เมื่อถอดบรรทัดส่ง flag)
- [x] ชุดติดตั้ง "ทั้งระบบ เลือกฟังก์ชั่นได้ + รู้ว่าเป็นลูกของใคร" — **โค้ด + tests แล้ว 25/10/69**
  - เจ้าของสั่ง: "ก็อปปี้เป็นไฟล์ใหญ่เลย ทั้งระบบ เป็นตัวติดตั้ง ให้เลือกฟังก์ชั่นที่จะติดตั้ง
    เช่น IOT ระบบเลี้ยงดูลูก · พอติดตั้งเสร็จ ระบบจะขึ้นข้อมูลในเครื่องเลยว่าเครื่องนี้เป็นลูกของ
    เครื่องไหน และมีสิทธิ์เชื่อมเข้าควบคุมเครื่องลูกได้ทันที"
  - แคตตาล็อกฟังก์ชั่น `tools/agent-pack/modules.mjs` (13 แพ็ก: `core` บังคับ + iot/kids/farm/
    restaurant/inventory/energy/treasury/health/vision/documents/ai/security) — เมนูเลข, พิมพ์รหัส,
    `a` = ทั้งหมด, Enter = ชุดแนะนำ; ชื่อที่ backend ไม่รู้จัก (iot/kids/…) **ไม่**ถูกเขียนลง
    `ENABLED_MODULES` (backend จะเตือนแล้วทิ้ง) เก็บไว้ใน `install-plan.json` แทน
  - เครื่องแม่: `--owner=<username>` (SUPERADMIN เท่านั้น) ตั้ง `owner_user_id` + upsert
    `agent_machine_hubs` + `--confirm-lan` ตั้ง `lan_confirmed_at` **ตอนแพ็ก** ⇒ heartbeat ครั้งแรก
    ก็อยู่ใน `listControllableMachines` — **ไม่ต้อง migration** (คอลัมน์/ตารางมีอยู่แล้ว)
  - `INSTALL.cmd` ที่รากชุด = ไฟล์เดียวที่ต้องดับเบิลคลิก (เดิมต้องไล่เข้า `tools\agent-pack`)
  - แก้บั๊กชุด `--full`: `setup-machine.mjs` หา `join.json` ไม่เจอ (อยู่ราก แต่สคริปต์อยู่ลึก 2 ชั้น)
    → `findBundleRoot` · เขียน `.env` ผิดที่ → เขียนที่ `sovereign-os\agent-runner` ·
    scheduled task ชี้ `src\main.mjs` ที่ไม่มี → สร้าง `RUN-RUNNER.cmd` ให้ก่อน
  - เครื่องลูกเขียน `MACHINE-PROFILE.txt`/`machine-profile.json` + เปิด `ENABLED_MODULES`/
    `PARENT_NAME`/`PARENT_HUB_URL` ใน `infra\.env` (แก้เฉพาะบรรทัดนั้น, idempotent);
    `setup-first-time.bat` เรียก `--apply-modules` ต่อท้ายขั้น [1/5]
  - เทสต์: `install-modules` 21/21 · `install-plan` 18/18 · `pack-install-plan` 7/7 ·
    `setup-install-plan` 8/8 · `wizard-modules`+`pack-machine-wizard` 45/45 ·
    `machineOwnerWiring.test.ts` 10/10 · `issueMachineTokenArgs.test.ts` 2/2 (แดง exit 1 ก่อนมีโค้ด)
  - เจอเพิ่มระหว่างทำ: `kit-coverage.test.mjs` ฟ้องว่าชุด OTA มี `install-plan.mjs` แต่ชุดเต็มไม่มี —
    แก้ที่ต้นเหตุ: ให้เทสต์derive ที่มาจาก `bundleSource()` ของตัวแพ็กเอง (เดิมฮาร์ดโค้ด 3 ชื่อ
    ⇒ เพิ่มไฟล์ใหม่แล้วสองรายการตกลงกันไม่ได้) · อ่าน JSON ทน BOM (Notepad/PowerShell 5.1
    เติม BOM ⇒ `JSON.parse` ล้ม = เครื่องลูกไม่เปิดโมดูลโดยไม่มีใครรู้สาเหตุ)
  - [x] `npm run verify` ที่ root — **ผ่าน 6/6 ขั้น (12.4 นาที) 25/10/69**
  - [x] merge เข้า `main` — **เสร็จแล้ว 25/10/69** (`242e2dd`)
  - [x] push ขึ้น GitHub — **เสร็จแล้ว 03/11/69** (`3529d2e`)
  - [x] restart core-api — **ไม่ต้อง** (ยืนยันแล้ว 25/10/69: การผูกเจ้าของเกิดฝั่ง host
    ผ่าน `tsx` ไม่ได้ผ่าน container · host Prisma client รู้จัก `agent_machine_hubs`/
    `owner_user_id`/`lan_confirmed_at` แล้ว · ไม่มี route ใหม่ ⇒ ไม่มี migration)
  - [ ] ทดสอบกับเครื่องจริง — **เจ้าของยังไม่พร้อม 25/10/69** (ยังไม่ได้ให้ชื่อเครื่องปลายทาง)
    ขั้นตอนเมื่อพร้อม: `PACK-MACHINE.cmd` → `INSTALL.cmd` ที่เครื่องปลายทาง → เห็นชื่อเครื่องแม่บนหน้าจอ

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
- [x] E5 WAL archiving + ซ้อม PITR — **ปิดด้วย I1 (28/9/69)**: archive_mode=on · archive_timeout=300s · ซ้อม replay ผ่านจริง + machine-health ด่าน WAL (ดู I1a–I1d) — ไม่ต้องทำซ้ำ
- [x] E6 (พบต่อจาก E2) สาย backup ภายใน core-api ตายเงียบ 22–26/9 — **เสร็จ 27/9/69**: ราก = scheduler เทียบเวลา "นาทีเป๊ะ" (`sched.time !== current`) เครื่องหลับ/นาฬิกา VM เหลื่อม → นาที 02:00 ถูกข้ามทั้งวัน (task ภายนอก 03:00 ปกติทุกคืน — สองสายอยู่คนละชั้นจึงปลอมสมดุล) · แก้ = catch-up window 6 ชม. (เลยเวลา + ยังไม่มี marker วันนี้ = สร้างทันที)

## F — ความปลอดภัย (ยืนยันจากโค้ดแล้ว)
- [x] F1 backup ห้ามแนบ .env — **เสร็จ 27/9/69** (ตัดที่ collectStateFiles + เกราะ findSecretLeakFiles ก่อนสร้าง bundle เจอลาย = งดสร้างแล้วรายงาน · เทส survival 8/8 · พิสูจน์บนของจริง: bundle ใหม่ 13 ไฟล์ data/*.json ล้วนไม่มี .env — bundle เก่าเข้ารหัสมาตลอด ไม่ต้อง rotate เร่ง)
- [x] F2 ✅ เข้ารหัส field อ่อนไหว — เสร็จ 28/9/69 (AES-256-GCM · telegram token + รหัสเราเตอร์ · DB มีแต่ enc:v1: · เทส 6/6 · พิสูจน์ telegram/test ยิงจริงผ่าน · commit f933780)
- [x] **F2b เข้ารหัส field PII — เสร็จ 1/10/69** (commit `231dfe1`): scope ครบ 6 กลุ่ม field + `phone_hash` สำหรับ lookup (dedupe ออเดอร์ร้าน/partner→customer) · migration ลง DB จริงแล้ว (plaintext → enc + hash ครบทุกแถว idempotent) · deploy backend (rebuild image) · พิสูจน์ end-to-end บนระบบจริง: สั่งซื้อ 2 รอบเบอร์เดิม dedupe ผ่าน · QR PromptPay ถอดค่า enc ได้ · เทสต์เขียว 1293/0 (รวมแก้ `publicPromptPayInfo` ที่ส่งค่า enc เข้า QR ตอนแรก — จับจากเทสต์)
- [x] **F3 — เสร็จ 1/10/69:** npm audit ทั้งสองฝั่ง merge dependabot ครบ → **0 vulnerabilities ทั้ง FE + API** (audit fix ปิด undici/fast-uri/brace-expansion/sharp + engine.io/ip-address · commit `1577991`)

## G — ตัดสินใจระดับเจ้าของ (ไม่ใช่โค้ด)
- [ ] G1 ทิศทาง e-Tax: คงสถานะ "เอกสารภายใน/ใบเสร็จธรรมดา" + ป้ายชัด หรือลงทุนเชื่อม CA/provider ตอนเปิดร้านจริง (thai-tax.service = เครื่องคำนวณเท่านั้น ไม่มี digital signature/CA ในโค้ด)
- [ ] G2 เช็คลิสต์ก่อนเปิด /shop สู่อินเทอร์เน็ต: ~~tunnel~~ (มีแล้ว 30/9 — I4a) + consent/PDPA (F2) ยังไม่เสร็จ → ยังปิดไม่ได้

## H — คุณภาพระยะยาว (ไม่ด่วน)
- [ ] H1 retention ตาราง non-hypertable ที่โตเงียบ — วัดจริก่อน: `audit_logs` (เขียนทุก action)/`security_events` → ตั้งตามข้อมูลจริง (sensor_telemetry จัดครบแล้ว ห้ามซ้ำ)
- [ ] H2 กัน e2e fail ลูกโซ่ — จุดเดียวพัง → 63 spec did not run (เคสจริง 26/9) — spec ที่ depend login ให้ skip เฉพาะตัวแทนพังทั้งกอง (auth.setup retry แก้แล้วใน 09b0f88)
- [x] H3 รวมการอ่าน secret เป็นจุดเดียว `tools/verify/creds.mjs` — **เสร็จ 03/11/69** (`ai/verify-creds`)
      · `parseEnvText()` / `readEnvFile()` / `readSecret()` / `requireSecret()` / `requireJwtSecret()` / `maskSecret()` — คีย์หาย = `MissingSecretError` ที่บอกชื่อคีย์ + ไฟล์ + ทางแก้ (เดิม `.find()` คืน undefined แล้ว `.slice` โยน TypeError ที่อ่านไม่ออก)
      · เลิกอ่านซ้ำ 3 ที่: `full-system-check.mjs` · `security-audit.mjs` · `ui-sweep.mjs` (ทั้งสามใช้ `requireJwtSecret()` และ exit 2 พร้อมเหตุผลเมื่อไม่มีค่า)
      · เทสต์ `tools/test/verify-creds.test.mjs` **9/9** (แดงก่อนแก้: `ERR_MODULE_NOT_FOUND`) — quote/CRLF/`export`/ค่าเว้นวรรค/`=` ในค่า/คีย์ซ้ำ/ไฟล์หาย/คีย์หาย/preferEnv/mask
      · ของจริง: อ่าน `JWT_SECRET` จาก `sovereign-os/infra/.env` ได้ (64 ตัวอักษร · log แสดงแค่ `73••••33`)
- [ ] H4 Windows-coupling ชั้น ops (Task Scheduler/.bat/.ps1) — จดไว้ ทำเมื่อโมเดลขาย turnkey จริง (launcher Go เริ่มถูกทางแล้ว)
- [ ] H5 (P2 ใช้งานง่าย ต่อจาก 27/9) เชื่อม Telegram รายวัน: สรุป ops-status ตี 8:30 หลัง digest — เจ้าของเห็นสถานะครบทุกสายในแชทเดิม ไม่ต้องเปิดเว็บ/เครื่อง · ใช้คอมโพเนนต์ที่มีทั้งหมด (ops-status --quiet + nightly-report)
- [x] H6 e2e ทนเน็ตกระตุก — **เสร็จ 27/9/69**: เพิ่ม ERR_CONNECTION_TIMED_OUT + ERR_NETWORK_CHANGED ใน IGNORE ของ all-pages (เน็ต LTE กระตุก ≠ บั๊กระบบ) — พิสูจน์: all-pages 46/46 ผ่าน
- [x] H7 กัน seed e2e ซ้ำ — **เสร็จ 27/9/69**: และ **จับบั๊กจริงใหญ่** — pos-flow cleanup ชี้ DB `sovereign_v2` ที่ไม่มีอยู่แล้ว (DB จริง = sovereign) → cleanup เงียบมาตลาด → ร้าน 'E2E-ทดสอบอัตโนมัติ' ค้าง 2 รายการใน DB จริง · แก้: ชื่อ DB + cleanup ตรวจสอบได้ (คืน boolean + retry 3 รอบแล้ว throw) + เคลียร์ของค้าง — พิสูจน์: pos-flow 2/2 ผ่าน

## CE — Community Edition packaging (Phase 1: ขาย/แจกแบบ pure software)
- [x] **CE1 docker compose คำสั่งเดียว (รวม Dashboard)** — **เสร็จ 04/11/69** (`ai/community-stack`)
      · `deploy/community/`: `docker-compose.yml` (db · mqtt · migrate · api · web) + `.env.example` + `README.md`
      · named volume ล้วน (ไม่ bind mount ซอร์ส) · `migrate` รัน `prisma migrate deploy` + seed แล้ว `api` ถึงเริ่ม (`service_completed_successfully`)
      · **แก้บั๊กที่เจอ:** `sovereign-frontend/Dockerfile.prod` ใช้ `node:18` แต่ Next 16 บังคับ ≥ 20.9 → build ล้มทุกครั้ง (image นี้ไม่เคยถูกใช้ที่ไหน) · เปลี่ยนเป็น `node:22-alpine` + รับ `ARG NEXT_PUBLIC_API_URL`
      · **CSP ตาม env:** `next.config.js` เติม origin จาก `NEXT_PUBLIC_API_URL` เข้า `connect-src` (http + ws) — เดิม deploy บน Pi แล้วเปิดจากเครื่องอื่นจะถูก CSP บล็อก
      · เทสต์ `tools/test/community-stack.test.mjs` **11/11** (แดงก่อนแก้ 4 ข้อ) · `docker compose config` ผ่านจริง
      · ยังไม่ทดสอบ `up` เต็มชุด: พอร์ต 5432/3001/1883 ชนกับ production ที่รันอยู่ (Cold Soak) — รอเจ้าของเปิดหน้าต่างทดสอบ
- [ ] **CE2 README/คลิป/GitHub Community** — ต้องรอเจ้าของอนุญาต push (ยัง hold) · README หลักชี้ไป `deploy/community/` แล้ว
- [x] **CE3 ช่องแจ้งเตือน Discord/LINE** — **เสร็จ 04/11/69** (`ai/alert-fanout`)
      · `services/alert-fanout.service.ts`: แปลง HTML→ข้อความล้วน (คงลิงก์), Discord (จำกัด 2000 + `allowed_mentions.parse=[]`), LINE Messaging API (จำกัด 5000), ตรวจ URL/รหัสผู้รับก่อนตั้งช่อง
      · ต่อเข้ากับ dispatcher เดิม ⇒ severity/dedup/rate-limit ยังทำงานเหมือนเดิม · ยิงขนานแบบ soft-fail (ช่องหนึ่งล้มไม่ทำให้ช่องอื่นเงียบ)
      · `POST /api/telegram/channels/test` (SUPERADMIN) — ทดสอบทุกช่องพร้อมกัน คืนผลแยกช่อง
      · env: `DISCORD_WEBHOOK_URL` · `LINE_CHANNEL_ACCESS_TOKEN` · `LINE_TO` (LINE Messaging API — ไม่ใช่ LINE Notify ที่ปิดแล้ว)
      · เทสต์ `tests/alertFanout.test.ts` 14/14 + `tests/telegramChannels.test.ts` 4/4 · `telegramAlert.test.ts` เดิมยังผ่าน 16/16

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
- [x] I0c — **เสร็จ 1/10/69**: ผล nightly 30/9 พัง 2/6 = (1) /api/partners สาธารณะ by-design แต่ไม่อยู่รายการ public ของ full-system-check (2) CSP บล็อก tile.openstreetmap.org (bare host — wildcard `*.` ไม่ครอบ) → แก้ทั้งคู่ (ลงทะเบียน public + เติม bare host ใน next.config + noise ui-sweep pattern เต็ม) — full-system-check 24/24 เขียว

## I1 — PITR จบให้สมบูรณ์ (WAL archiving เปิดแล้วจริง 27/9 — `wip 6720af5`: archive_mode=on · archive ไหล 0 failed · archive_timeout=300s)
- [x] I1a สคริปต์ `tools/verify/pitr-drill.mjs` — **เสร็จ 28/9/69 ซ้อมผ่านจริง**: probe 'before-delete' → basebackup → ลบ → scratch replay ถึงเวลาเป้า → **probe กลับมา + users 8 ครบ** · บทเรียนจริง: docker cp ข้าม container ไม่ได้ (ผ่าน host) · ไฟล์ root ต้อง chown+700 · `exec -d` ตายพร้อม client (nohup gosu … & แทน)
- [x] I1b RPO จริง = ระดับนาที (archive_timeout 300s + replay สำเร็จถึง .MS) — จด runbook §๙ แล้ว
- [x] I1c machine-health ด่าน WAL archive (failed>0 · นิ่ง >30 นาที = warn) — รันจริง: 0 failed · สด 108 วิ
- [x] I1d runbook §๙ กู้จริงเมื่อไฟดับ (หยุดเขียน → ตัดสินเวลา → drill → กู้ผ่าน scratch → ตรวจสุขภาพ) + อุปสรรคจริงครบ

## I2 — Asymmetric encryption สำหรับ backup (สาย offsite รอบสอง — ต่อจาก E3/F1)
- [x] I2a ✅ age (X25519) เข้ารหัสคู่ขนาน — เสร็จ 28/9/69 (age.exe v1.2.1 ที่ tools/bin · identity gitignored ที่ infra/offsite · push เดียวได้ไฟล์คู่ .enc+.age · mirror พาคู่ · พิสูจน์ restore 142 ตารางจากไฟล์ .age)
- [x] I2b ✅ recovery file สองรูปแบบ — identity เต็ม + คำสั่งถอดบนมือถือ (`age -d -i …`) + key AES เดิม — อยู่ที่ mirror ทุกรอบ push
- [x] I2c — **เสร็จ 1/10/69 ตัดสาย AES สำเร็จ**: พิสูจน์ restore จาก .age จริง 2 วิธี (ถอดมือ + `offsite-push --restore-test`: users 8 · audit 26k · telemetry 133k เทียบ live) → เลิกสร้าง .enc ไฟล์ใหม่ — TG/mirror/scp ส่ง .age ทั้งหมด · เก็บช่องถอดไฟล์ .enc เก่า (`--legacy-aes`) จนกว่าจะหมดความหมาย · หมายเหตุ: ปิดรอยต่อ F2 ฝั่ง host แล้ว (telegram-creds.mjs ถอด enc:v1: ได้)
- [ ] I2d (ตัดสินเจ้าของ) tmpfs/RAM disk สำหรับ secret ชั่วคราว — เครื่องนี้ Modern Standby บ่อย อาจยุ่งยากกว่าประโยชน์ — เจ้าของเลือก

## I3 — audit_logs partitioning + retention 90 วัน (ยกระดับจาก H1 ตามลิสต์เจ้าของ) — ✅ เสร็จ 28/9/69 (commit c8cb814)
- [x] I3a ✅ วัดจริง: 26,430 แถว/2เดือน (~600/วัน) → monthly partition พอ (ต่ำเกินกว่า weekly คุ้มความซับซ้อน)
- [x] I3b ✅ migration declarative monthly (ส.ค.26–ม.ค.27 + default) — ย้ายครบ · PK (id,timestamp) · index timestamp DESC · probe เขียนจริงตก partition ถูก
- [x] I3c ✅ auto-purge/export: เดือนจบเกิน 90 วัน = export NDJSON.gz → ตรวจจำนวน → drop → mirror · ensure 3 เดือนล่วงหน้าทุกรอบ nightly · probe ผ่าน · ด่าน default-partition ใน machine-health
> **19/10/69:** 3 บรรทัด `I3a–I3c` ที่เคยค้างด้านล่างเป็น "สำเนาค้าง" ของงานที่ทำเสร็จแล้ว (157–159) — ลบออกแล้ว; เหลือ I3d ที่ยังไม่ทำจริง
- [ ] I3d machine-health เพิ่มด่านขนาด audit_logs — กันโตเงียบอีกสาย (ยังไม่ได้ทำ)

## I4 — Cloudflare Tunnel เปิด /shop สู่อินเทอร์เน็ต (ตาม G2 — ต้องรอเจ้าของ: domain บน Cloudflare + token)
- [x] I4a container cloudflared ทะลุ CGNAT/LTE (MR505) — **เสร็จ 30/9/69** (container `sovereign-cloudflared` รันจริงด้วย token ใน infra/.env · route `*`→:3000, `^/api`→:3001)
- [x] I4b WAF/access rules — **เสร็จ 30/9/69** (รายละเอียดอยู่ที่บรรทัด I4b ด้านล่าง — สองบรรทัดนี้เป็นของเดิมก่อนสรุป)
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
> **19/10/69:** งานที่แตะ **หน้าเว็บสาธารณะ** (WAF / SEO / sitemap / GSC / โดเมน) ย้ายไป repo
> `Sovereign-Web-Standalone` แล้ว — เก็บรายละเอียดในหมวดนี้ไว้เป็นประวัติอ้างอิง
> งาน backend/ธุรกิจ (P8, P18, P19, P23) ยังอยู่ใน repo นี้
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
- [x] **P19 ต่อ 3 (1/10/69 กลางคืน):** ปิด e2e-bot + แก้ nightly gate ครบ (partners by-design + CSP bare host) + I2c ตัดสาย AES (age สายเดียว restore พิสูจน์ 2 วิธี) + DEFCON ซ้อมจริง (75→L3→0) + F2b แผนพร้อมลงมือ · full-system-check 24/24 · SW v10 · verify 5/5 · merge 076771e
- [ ] **P19 รอเจ้าของลองจริง:** กดปุ่ม "✅ ยืนยันรับเงิน" / "🚫 ไม่ได้โอน" ใน Telegram จากออเดอร์จริงใบแรก (โค้ดพิสูจน์ผ่านฟังก์ชันเดียวกันบนระบบจริงแล้ว — เหลือแค่ประสบการณ์กดบนมือถือ)
- [ ] **P18 รอเจ้าของ — SMS จริง:** สมัคร thaibulksms.com (เติมขั้นต่ำ ~100฿) → ใส่ `SMS_PROVIDER=thaibulksms` + `SMS_API_KEY` + `SMS_API_SECRET` ใน infra/.env → recreate core-api 1 รอบ — OTP คู่ค้าส่ง SMS จริงทันที
- [ ] **P21 รอเจ้าของ — แก้ WAF โดเมนเดิม (sitemap/robots 403):** Deploy ผ่านปุ่ม 2 ครั้งไม่มีผล (โดน challenge เงียบแบบ 30/9) → ทางเลือก: (ก) console PUT ruleset ตาม runbook §สิบ ขั้น 6 หรือ (ข) **ALLOW rule ใหม่ชื่อ "Allow sitemap/robots" expression `http.request.uri.path in {"/robots.txt" "/sitemap.xml"}` ไว้บนสุด** (อ่านง่ายกว่า กด Deploy ตัวใหม่ไม่โดน rule เก่ากลืน) → ให้ผู้ช่วยพิสูจน์ 200
- [x] **P21 ใหม่ — ดิสก์ E: ใกล้เต็ม — แก้แล้ว 2/10/69: ว่าง 0.62 → 114.6 GB** (prune ตามอนุมัติ + **compact vhdx 106.1 → 19.2 GB คืน ~87 GB** · โฟลเดอร์เก่า `Docker/Docker/wsl` 21.9 GB ไม่อยู่แล้ว · `infra_pgdata` orphan 136 MB archive+ลบแล้ว · ตั้ง task **`Sovereign VHDX Compact` ทุกอาทิตย์ 04:00** กันดิสก์บวมซ้ำ) — รายละเอียดใน STATUS P21 ต่อ 8 · Ollama 9.4 GB เจ้าของตัดสินใจเอง
- [ ] **P21 รอเจ้าของ — ตัดสินใจ sovereign-shop (ตรวจ 2/10: ยังไม่ได้จดจริง — มีแค่ zone ใน Cloudflare):** (ก) จดจริงที่ domain.digitalplat.org → ตั้ง NS delilah+vin → Cloudflare Active → hostname 2 แถว + SSL + WAF (expression พร้อมวางใน runbook §สิบ "โซนที่สอง") → ผู้ช่วยพิสูจน์ + GSC หรือ (ข) ลบ zone ทิ้งหยุดอีเมล (โดเมนเดิม sovereignoriginshop ไม่กระทบ)
- [ ] **P22 รอเจ้าของ — ส่งค่า TXT จาก GSC (บล็อกขั้น Verify):** เปิด search.google.com/search-console → Add property → **โดเมน** `sovereignoriginshop.dpdns.org` → Google จะให้ค่า `google-site-verification=xxxx` → **ส่งค่านั้นมาในแชทนี้** (ครั้งก่อนส่งมาเป็น placeholder `วางค่า...ตรงนี้` ยังไม่ใช่ค่าจริง) → ผู้ช่วยเพิ่ม TXT ที่ Cloudflare (DNS → TXT → name `@`) ทันทีแล้วบอกกด Verify ได้เลย · ฝั่งโค้ดพร้อมแล้ว: title/description/canonical/OG/JSON-LD ครบ 10/10 · noindex ขัดกันหายแล้ว · sitemap ถูกรูป · WAF ผ่าน · IndexNow ยิงจริงแล้ว 202/200
- [x] **P22 บรรทัด `Sitemap:` ที่ 2 ใน robots.txt (sovereign-shop ยังไม่มีตัวตนจริง) — แก้แล้ว 2/10/69:** ตัดออก + เขียนคอมเมนต์กำกับว่าจะใส่คืนเมื่อโซนที่สอง Active · ยืนยันสด: robots.txt เหลือ `Sitemap:` 1 บรรทัด (public file เปลี่ยนเนื้อ → ต้อง restart :3000) · merge `f6f67b6`
- [x] **P23 fixture /community (ปิด 2/10/69) — เจ้าของเลือกทางเลือก (ก) ให้ e2e สร้าง fixture เองตอนรันแล้วลบทิ้ง (ไม่ค้างบนหน้าสาธารณะ):** `trace-community.spec.ts` คาดร้าน "ร้านผักสดตามรอย" + สินค้า 45 ฿ + ล็อต `LOT-T4ST2H` แต่สคริปต์ seed หายไปตอนคัดไฟล์ 1/10 และฐานจริงมีแค่ "ร้านทดสอบระบบ P16" · ทางเลือก: (ก) ให้ e2e สร้าง fixture เองตอนรันแล้วลบทิ้ง (ไม่ค้างบนหน้าสาธารณะ — แนะนำ) (ข) ใส่ข้อมูลตัวอย่างจริงถาวร (จะโชว์บน /community ที่เพิ่งส่งให้ Google) (ค) ข้ามเทสต์นี้ไว้ก่อนพร้อมเหตุผล แล้วค่อยกลับมาทำตอนมีข้อมูลจริง · ผลลัพธ์: `seedCommunityFixture/clearCommunityFixture` ใน `business-shop.service.ts` + `e2e/global-setup|teardown` (id คงที่ = idempotent) · **e2e 67/67 ผ่าน · fixture rows = 0 หลังรัน · `verify:full` 7/7** (รายละเอียดเรื่อง prod-truth เทียบ deploy root + คืนพอร์ต :3000 ให้ MAIN อยู่ใน STATUS.md หัวข้อ P23)- [x] **P22 noindex ของ `/shop/` และ `/community/` — เจ้าของตัดสินใจ 2/10/69 = ถอด noindex:** ทั้งสองหน้าอยู่ใน sitemap (priority 0.9/0.7) อยู่แล้ว ถอด `noindex` แล้วทั้ง 10 URL เป็น `index,follow` ตรงกัน · build MAIN + restart :3000 · พิสูจน์ด้วย UA Googlebot: 10/10 = 200 + canonical ถูกทุกหน้า · merge `e967bda`
- [x] **P24 ต่อ 2 (3/10/69) — 4 คำสั่งเจ้าของ + 2 อนุมัติเพิ่ม: เทสต์ 4 โมดุล coverage 0 · ใส่ coverage floor · เติม h1 · เขียน audit**:
  - (1) **เทสต์ `sensors` `risk` `backup` `knowledge` 94 เคส** — เทสต์รวม 1268 → **1387 ผ่านหมด** · coverage รวม 66.86% → **68.34%** · ยกรายโมดุล backup 0→84% · sensors 0→84% · risk 0→71% · knowledge 13→33% (เพิ่ม `KNOWLEDGE_DIR` env override ไม่งั้นเทสต์ไปแตะไฟล์ความรู้จริง)
  - (2) **`tools/coverage-floor.mjs` — coverage floor ใน quality gate** (4 กฎ: รวม ≥ floor · กลุ่มเดิมห้ามถอย · โมดุลใหม่ ≥ 40% · กลุ่มหายไป = violation) ผูกเข้า `npm run verify -- --db` — **coverage เคยเป็นกระจกส่อง ไม่มี threshold มาตลอด = ตัวเลขลดลงเงียบ ๆ ไม่มีใครรู้**
  - (3) **เอกสาร audit** `docs/module-audit-2026-10-03.md` — ตาราง 73 กลุ่มเรียงจาก coverage ต่ำสุด
  - (4) **เติม h1 หน้าสาธารณะ 6 หน้า** — `/about` `/partners` `/partners/guide` `/community` `/demo` `/mbti` (+ `/hover-cards`) = 7 หน้า h1=1 ยืนยันจาก build จริง
  - (5) **แก้บั๊ก 4 จุดที่เทสต์เผย (อนุมัติเพิ่ม)** — รากคือ JS coercion `Number(null)=0` ผ่าน `Number.isFinite` ทั้งหมด: sensors เขียน 0 ลง time-series · backup รับ `25:00` = ไม่มีวันเข้า catch-up (backup ไม่เคยรันอีก) · risk drill ที่ลืมส่ง index = de-escalation ระดับ 0 เงียบ ๆ · knowledge path traversal ตอบ 500
  - (6) **แก้ SSR ให้ static export เรนเดอร์หน้าสาธารณะจริง (อนุมัติเพิ่ม)** — `isPublicHostname()` คืน false ตอน SSR → HTML ที่ Googlebot ดึงไม่มี h1 ไม่มีเนื้อหา · ธงตอน build `NEXT_PUBLIC_PUBLIC_SITE=1` (เฉพาะ production ไม่ใช่ desktop export) → **`/` เปลี่ยนจาก h1=0/33,966 B เป็น h1=1/36,779 B** บนโดเมนจริง · localhost ยังเป็นฟอร์มล็อกอิน · seo-preflight ผ่าน 10/10 · verify 5/5 · merge MAIN แล้ว (`d28b39f` + `68afd36`)
- [x] **P24 ต่อ 3 (3/10/69) — เจ้าของเลือก ข. "ทำ `/sensors/` + `/shop/` เป็นสาธารณะจริงแบบข้อมูลตัวอย่าง":** เพิ่ม `SensorsPublic` + `ShopPublicLanding` (ข้อมูลสมมติ hardcode ทั้งหมด · ไม่ยิง API · ไม่แตะ auth store · ป้ายกำกับ "ตัวอย่าง" ทุกจุดที่เป็นตัวอย่าง) สลับด้วยแพตเทิร์นเดียวกับหน้าแรก (`mounted` + `isLocalHostname`) → **`/sensors/` h1=0/34,062 B → h1=1/41,839 B · `/shop/` h1=0/4,248 B → h1=1/9,881 B** บนโดเมนจริง · localhost ยัง login-gated (ยืนยันด้วย browser: `/sensors/` = "Unauthorized" · `/` = ฟอร์มล็อกอิน) · **เจอบั๊กแฝงระหว่างทำ: `SeoHead` อยู่ใน `ShopShell` → branch หน้าแนะนำ return นอก `ShopShell` ทำให้หลุด title/canonical/description (seo-preflight จับได้) แก้โดยย้าย `SeoHead` เข้าคอมโพเนนต์เอง** · seo-preflight 10/10 · verify 5/5 (`logs/verify-p24b.log`) · ตอนนี้ **ไม่เหลือหน้าใน sitemap ที่ h1=0** · commit `fc04e30` + `eef8235`
- [x] **P24 ต่อ 4 (3/10/69 — 3 คำสั่ง: แก้บั๊ก `/shop/` · ให้ gate จับหน้าว่าง · ประกาศหน้าสาธารณะ):** (1) **แก้บั๊ก `/shop/` เปล่าไม่โหลดร้านจริง** — effect เดียวมีทั้ง pageview และ fetch ร้าน default โดยมี guard `else if (mounted)` → รอบแรกบน mount `mounted=false` เสมอ = ไม่ fetch และ deps `[router.asPath]` ไม่เปลี่ยน = ไม่มีวันรันซ้ำ (พิสูจน์เดิมจาก network log: ไม่มี request เลย) · **แก้โดยแยกเป็น 2 effect ให้แต่ละเรื่องมีเจ้าของของตัวเอง** — A = `trackPageView` + `?id`/`?order` · B = ร้าน default (ข้ามถ้ามี query + มี cancel guard กันเขียน state ทิ้งหลัง) · **ไม่ใส่ `mounted` ลง deps ตรง ๆ เพราะจะทำให้ pageview ยิงซ้ำ 2 ครั้ง** · ผลวัดจริงบนโดเมน + localhost: หน้าร้านจริงโหลดขึ้นมา (`ร้านอุปกรณ์ Sovereign (DMS)`) และ network log มี `/api/shop/community` + `POST /api/track/` **อย่างละ 1 ครั้งพอดี** (2) **gate จับหน้าว่างอัตโนมัติ** — `seo-preflight` เพิ่มกติกา "ต้องมี `<h1>` 1 อัน" (ช่องว่างที่ทำให้ `/sensors/` + `/shop/` ค้าง h1=0 นานเพราะเช็คเดิมถามแค่ title/desc/canonical ไม่เคยถามว่าหน้ามีเนื้อหาจริงไหม) · แยกเป็น `checkPage()` + เพิ่ม `tools/test/seo-h1.test.mjs` 11 เคส · **และผูก `npm run test:tools` เข้า `verify`** เป็นสายที่ 3 (ก่อนนี้เทสต์ใน tools/ ไม่ถูกเรียกจากไหนเลย = กติกาที่ปกป้องระบบพังเงียบได้) — **ระวังจุดที่เกือบพลาด: `runLine` กรองด้วย `startsWith('backend'/'frontend')` = ขั้นที่ไม่ขึ้นต้นไหนจะไม่ถูกรันเลย** → พิสูจน์แล้วว่าครอบคลุม 6/6 ไม่มีขั้นหลุดเงียบ (3) **`/trace` เพิ่มใน sitemap (10 → 11 URL)** — ตรวจก่อนพบว่า **`/demo/` อยู่ใน sitemap อยู่แล้ว** (ไม่ต้องเพิ่ม · และเนื้อหาบางมากแค่ 1,243 ตัวอักษร) ส่วน **`/trace/` ไม่ใช่แค่ "ยังไม่ได้ประกาศ" แต่ยังไม่พร้อมเลย** — h1=0 ไม่มี title/canonical/description (เดิมถูก `if (!isHydrated)` บังตอน SSR + ไม่มี `SeoHead`) · แก้แบบเดียวกับหน้าแรกแล้ว: **h1=0/31,162 B → h1=1/77,590 B + metadata ครบ** · verify **6/6** (มีสาย tools) · `seo-preflight --strict` ผ่าน **11/11** · IndexNow ส่ง 11 URL · commit `2057a6a` + `5980b4d`
- [x] **P24 ต่อ 5 (3/10/69 — 4 คำสั่งเจ้าของ: ซ่อน Sidebar บนหน้าสาธารณะ · เกณฑ์ thin content · เติมเนื้อหา /demo · audit หน้าที่หลุด sitemap):** (1) **ซ่อน Sidebar/เมนูภายในตอนยังไม่ล็อกอิน** — `lib/useHideInternalNav.ts` = กติกาเดียว **`!isAuthenticated → ซ่อน` (ไม่มีรายการหน้า)** ครอบ Sidebar · MobileNav · CommandPalette · **แก้รอบ audit: รุ่นแรกใช้ allowlist `isPublicPath(pathname) && !isAuthenticated` ครอบแค่ 11 หน้าใน sitemap → หน้าที่เรนเดอร์ได้โดยไม่ต้องล็อกอินแต่ไม่อยู่ในรายการหลุด (เกิดจริง: `/partners/me` ตอบ 200 ไม่ต้องล็อกอิน → ผู้เยี่ยมชมเห็น MobileNav พร้อมลิงก์ `/users`)** แก้เป็นกติกาตามสิทธิ์ = ทุก URL ที่ไม่ต้องล็อกอินถูกคุมโดยโครงสร้าง หน้าไหนหลุดไม่ได้อีก · `PUBLIC_PATHS` เหลือหน้าที่เดียวคือประกาศใน sitemap ไม่ใช่ allowlist ของการมองเห็น (ลบ `isPublicPath`/`normalizePath`/`PUBLIC_PATH_SET` ทิ้ง) (กันที่ตัว palette เพราะผู้เยี่ยมกด Ctrl+K ได้) · **ก่อนแก้ HTML ที่บอทดึงจาก `/trace` `/mbti` `/hover-cards` มีลิงก์ Dashboard/Users/Settings/Backup ปนอยู่** (WAF บล็อกหน้าเหล่านั้น 403 จึงไม่รั่วข้อมูล แต่เปิดโครงสร้างภายในให้ crawl) · ย้ายรายการหน้าสาธารณะไป `lib/publicAccess.ts` (`PUBLIC_PATHS`) จุดเดียว · `sitemap.xml.ts` import ตรง ๆ กันรายการสองชุดหลุดกัน · **ไม่แตะ `_app.tsx` เลย** (AGENTS.md ข้อ 4) เพราะให้คอมโพเนนต์ซ่อนตัวเอง · **หน้าในระบบไม่ถูกแตะ = เจ้าของไม่มี flash ตอนเปิดใช้งาน** (2) **เกณฑ์ thin content** — `seo-preflight.mjs` ข้อ 2c: ข้อความใน HTML < 800 ตัวอักษร = จัดทำดัชนีไม่ได้ (ตัด script/style/svg/**nav** ทิ้งก่อนนับ เพราะเดิมนับเมนูภายในไปด้วยทำให้ตัวเลขหลอก) · ปรับได้ผ่าน `SEO_MIN_TEXT_CHARS` · เทสต์เพิ่ม 5 เคส (รวม 16) · **จับได้จริงรอบแรก: หลังซ่อน Sidebar หน้า `/` 527 · `/community` 299 · `/mbti` 697 · `/trace` 267 ตัวอักษร** (3) **แก้ที่ต้นเหตุ ไม่ลดเกณฑ์** — `components/public/PageIntro.tsx` (component กลาง render ตอน SSR) ใส่ที่ 4 หน้าข้างบน · ผล `/` 1,104 · `/community` 948 · `/mbti` 1,304 · `/trace` 812 · **`/demo` 1,052 → 3,608** (`DemoExplain.tsx`: อธิบาย 6 โมดูล + FAQ 5 ข้อ + FAQPage JSON-LD) · preflight **ผ่าน 11/11** (4) **`tools/verify/seo-publish-audit.mjs`** — ตรวจกลับจากโค้ด (preflight ตรวจจาก sitemap ไปข้างหน่าย ไม่เคยตรวจว่าหน้าที่ประกาศ index หลุด sitemap) + เทสต์ 6 เคส · **ผล audit: 11 หน้า index ตรงกับ 11 URL พอดี · `/partners/me` noindex ไม่อยู่ใน sitemap (ถูกต้อง)** · พิสูจน์บนโดเมนจริงด้วย Googlebot: ลิงก์เมนูภายใน **0 รายการ** ทุกหน้าสาธารณะ · verify 6/6 (`logs/verify-p24h.log`) · `verify:full` ผ่าน · merge เข้า MAIN แล้ว · **รอบแก้บั๊ก allowlist: พิสูจน์ในเบราว์เซอร์จริงหลัง JS รัน (SSR ตรวจไม่ได้เพราะ SSR ไม่มีเมนูอยู่แล้ว) ทั้ง 12 URL ที่ไม่ต้องล็อกอิน รวม `/partners/me` → `<aside>` 0 · `<nav>` ภายใน 0 · ลิงก์ภายใน 0 · ผู้ที่พิมพ์ `/users/` ตรง ๆ ถูก WAF บล็อก · ฝั่งล็อกอิน = `verify:full` (Playwright login จริง) ผ่าน → เมนูไม่พัง · preflight 11/11 ตัวเลขไม่เปลี่ยน · verify 6/6 (`logs/verify-p24i.log`) · merge เข้า MAIN แล้ว
- [ ] **🚨 P24 รอเจ้าของ — เพิ่ม `/mbti/compare*` ใน allowlist ของ Cloudflare WAF** (4/10/69 · **ทำให้ผู้ใช้จริงพังตอนนี้**)
  - **อาการ:** `/mbti` อยู่ใน sitemap + Google เข้าดูอยู่ · หน้านั้นลิงก์ไป `/mbti/compare` **3 จุด** → ผู้เยี่ยมชมกด "เปรียบเทียบผลลัพธ์" แล้วเจอ **หน้าบล็อก 403**
  - **ต้นเหตุ:** rule `Public-only: block admin/internal paths` เป็น allowlist (default-deny) · `/mbti/compare` ไม่อยู่ในรายการ → 403 **ทุกคน รวม Googlebot**
  - **แก้:** Cloudflare → `sovereignoriginshop.dpdns.org` → Security → WAF → Custom rules → rule `Public-only: block admin/internal paths` → Edit expression → เติมต่อท้ายก่อน `)` ปิดสุดท้าย: `or http.request.uri.path in {"/mbti/compare*"}` → Deploy
    - ⚠️ **เติมบวกเฉย ๆ ห้ามวาง expression ทับทั้งก้อน** (rule จริงมี `/partners` `/about` `/api/track` ฯลฯ อยู่แล้ว · วางทับจะปิดเส้นที่เปิดไว้) · วิธีเดียวกับที่แก้ `/robots.txt`+`/sitemap.xml` สำเร็จ 2/10/69
  - **พิสูจน์:** `curl -s -o /dev/null -w "%{http_code}\n" https://sovereignoriginshop.dpdns.org/mbti/compare` → ต้องได้ **200** (ตอนนี้ได้ 403)
  - **หลังแก้ WAF ยังประกาศไม่ได้ทันที** — ต้องทำต่อ: (1) เติม `<h1>` (หน้านี้**ยังไม่มี h1 เลย** · preflight บังคับ 1 อันพอดี) (2) เติมเนื้อหาจริงให้ผ่านเกณฑ์ **800 ตัวอักษร** (`SEO_MIN_TEXT_CHARS`) (3) ค่อยถอด `noindex` + เพิ่ม `/mbti/compare` ใน `PUBLIC_PATHS` → `seo-preflight` ต้องผ่าน **12/12**
  - **คู่มือฉบับเต็ม + ลำดับขั้น:** [`docs/seo-google-search-console.md`](docs/seo-google-search-console.md) หัวข้อ "🚨 งานที่ต้องให้เจ้าของทำเอง" · อ้างอิงระดับโค้ดอยู่ในคอมเมนต์ [`sovereign-frontend/src/pages/mbti/compare.tsx`](sovereign-frontend/src/pages/mbti/compare.tsx)
  - **AI แก้ให้ไม่ได้** — อยู่นอก repo + ต้องสิทธิ์ dashboard · ระหว่างนี้ห้ามแก้หน้าเอง (`noindex` ถูกต้อง ณ สภาพปัจจุบัน เพราะประกาศ URL ที่ตอบ 403 คือคำสัญญาที่ผิด)
- [ ] **P24 รอเจ้าของ — ค่า TXT จาก GSC** (ต่อจาก P22/P24 รอบก่อน: ยัง Verify ไม่ได้ เพราะข้อความที่ส่งมาก่อนหน้าเป็น placeholder ไม่ใช่ค่าจริง)

---

# คิวหมวด J — Lean + Desktop Distribution (19/10/69)

> บริบท: เจ้าของสั่ง "วิเคราะห์ทั้งโปรเจ็ก ว่าจะพัฒนาอะไรต่อได้อีก ... จัดระเบียบให้ lean ขึ้น"
> + "ทำแอปสำหรับไปติดตั้งอีกเครื่อง" · รอบนี้ทำเฉพาะของที่พิสูจน์ได้ และ **ไม่แตะ infra/.env**
> ไม่ restart runtime / ไม่ migration (โปรเจ็กอยู่ระหว่าง Cold Soak)

## J1 — ปิดของที่ทำให้ nightly แดง/มีไฟล์ขยะ (เสร็จแล้ว 19/10/69 — commit `a46d918`)

- [x] **J1a `-DryRun` ของตัวติดตั้งไม่แตะเครือข่าย** — เดิมเทสต์ `installer-cmd` ต้องยิง HUB จริง
      (`192.168.1.102:3000`) → คืนที่ :3000 ไม่ตอบ = nightly แดงทั้งคืน · ตอนนี้ dry-run จบแบบ
      deterministic (exit 0, "DRY RUN complete") ไม่ดาวน์โหลด/ไม่ติดตั้ง — เทสต์ 23/23
- [x] **J1b `system-truth.json` ถูกเขียนแม้เกตล้ม** — เดิมเขียนเฉพาะเส้นทางสำเร็จ → `lastGateOk`
      ค้าง `null` 11 รอบ (5–18 ต.ค.) · ย้ายไป `process.on('exit')` ครอบทุก `process.exit(1)`
- [x] **J1c JSON sidecar ครบ + เก็บขยะ** — host tools (`nightly-verify`, `ops-status`, `verify`)
      เขียน `.sha256` คู่ไฟล์แล้ว → data-integrity ไม่ตีเป็น BIT_ROT ปลอมอีก · ลบสำเนา
      `.corrupt-*` **1,070 ไฟล์** ที่สะสมมา (เป็นสำเนาของไฟล์ดี ไม่ใช่ข้อมูลจริง)
- [x] **J1d ลบ `prisma/schema.sqlite.prisma`** (2,248 บรรทัด ไม่มีใครใช้) + ถอดกฎ schema-sync
      ออกจาก arch-gate/docs/CI/AGENTS — เหลือ Postgres ฉบับเดียวตามความจริงของระบบ
- [x] **J1e ลิงก์ร้านชี้โดเมนจริง** — `BusinessShopTab` เปลี่ยนจาก `/shop` (404 ในแอป) เป็น
      `https://sovereignoriginshop.dpdns.org` + เปิดผ่าน `shell.openExternal` (ไม่หลุดออกจากแอป)
      · ถอด `/shop` ออกจาก `PUBLIC_PAGES` / `ALWAYS_VISIBLE`
- [x] **J1f Synthetic check เลิกตรวจ `/shop`** — ชี้หน้า login ของเดสก์ท็อป + จำกัด log 2 MB
      (เดิม FAIL 3/3 ทุก 5 นาที · log 4.15 MB)
- [x] **J1g Watchdog เหลือตัวเดียว** — `autostart.mjs` ชี้ `tools/frontend-watchdog.mjs`
      (one-shot ตัวเดียวกับ Scheduled Task) · ลบ `frontend-watchdog.mjs` ที่ราก (poller ซ้อน)

## J2 — Desktop Distribution (เสร็จแล้ว 19/10/69)

- [x] **J2a ชุดติดตั้งสำหรับอีกเครื่อง** — `PACK-DESKTOP.mjs` ประกอบใหม่จากซอร์สวันนี้ →
      `Project Sovereign Origin Install\desktop\Sovereign-OS\` + portable exe + `DESKTOP-INFO.json`
      (ถ้าแอปเปิดอยู่จะเขียน `dist-portable-staging/` — **ห้ามลบโฟลเดอร์นี้**)
- [x] **J2b ชั้นส่งมอบใน repo** — `npm run stage:release` → `release/Sovereign-OS-<ver>-win-x64/`
      (portable exe + zip + DESKTOP-INFO + README-INSTALL + SHA256SUMS) · ไฟล์ .exe/.zip gitignored
- [x] **J2c เอกสารติดตั้ง** — `docs/DESKTOP-INSTALL.md` (เครื่องปลายทางต้องมีอะไร · 2 วิธีติดตั้ง ·
      ตรวจแฮช · แก้ปัญหาจอดำ/offline · ความปลอดภัย)
- [x] **J2d เผยแพร่ node kit ปัจจุบัน** — `node tools/build-node-kit.mjs --publish` →
      1,969 ไฟล์ / 35.1 MB · manifest 19/10/69 · ตัวติดตั้งเครื่องใหม่ดึงจาก HUB ได้
      · กรอง `release/`, `dist-portable-*`, `sovereign-frontend/out`, `.env.bak`, `.env.playwright`
- [x] **J2e สลับ desktop shell เครื่องนี้** — `dist-portable` = ชุดใหม่ (boot frontend/api true)
      · เก็บ `dist-portable-prev-20261019-1035/` ไว้ย้อนกลับ

## J3 — ยังเปิด (ต้องอนุมัติ/ทำแยก branch)

- [ ] **J3a WAL `archive_timeout` 300 → 900s** — ลด WAL 24 GB/วันลง ~3 เท่า · **ต้อง recreate
      container** → ห้ามทำระหว่าง Cold Soak; ต้องให้เจ้าของอนุมัติ + ทำในหน้าต่างปิดระบบ
      → **19/10/69: แก้ compose เป็น 900s + เทสต์ `wal-config.test.mjs` แล้ว** · runtime ยัง `SHOW = 5min`
      เพราะ `-c` ของ container เดิม override — ค่าใหม่มีผลเมื่อ recreate เท่านั้น (ยังไม่ทำ)
- [x] **J3b nightly-history หาย 5 วัน** (7/9/13/14/17 ต.ค. ไม่มี entry) — **เสร็จ 03/11/69** (`ai/nightly-history-gaps`)
      · แยก logic เป็น `tools/nightly-history.mjs` (เดิม inline ใน nightly-verify = เทสต์ไม่ได้): `mergeHistoryEntry()` กันข้อมูลเสียทั้งก้อนหาย + เรียงเก่า→ใหม่ + เก็บ 30 วัน · `findHistoryGaps()` ตรวจย้อนหลัง 7 วัน (ไม่นับวันนี้)
      · `status.json` มี `historyGaps` และ Telegram เตือน `🗓 ประวัติ nightly ขาด N วัน: …` (ไม่ทำให้ nightly แดง — เครื่องอาจปิดอยู่)
      · หลักฐานกับไฟล์จริง: `gaps@2026-11-04 = ['2026-11-03']` (รอบ 02:00 ของวันนี้ไม่เขียน entry จริง) · `gaps@2026-11-03 = []`
      · เทสต์ `tools/test/nightly-history.test.mjs` **9/9** (แดงก่อนแก้: `ERR_MODULE_NOT_FOUND` exit 1)
- [ ] **J3c แยกไฟล์ใหญ่** — pages: settings 1,254 · dashboard 1,219 · treasury 1,187 ·
      ai-agent 1,064 · livestock 860 · knowledge 806 (baseline รับไว้ = หนี้ที่มองไม่เห็น)
- [ ] **J3d รวมโมดูลจิ๋ว ≤70 บรรทัด** — war-room 10 · reports 27 · mesh 28 · notes 33 · audit 36 ·
      search 36 · selfreliance 40 · clone 40 · dms 41 (62 → ~56) — ต้องแก้ `module-owners.json`
      + boundary-baseline + docs/modules พร้อมกัน = branch แยก
- [ ] **J3e รวม HTTP helper 3 ตัว** (`apiClient` / `apiFetch` / `fetchJson`) — เริ่มแล้ว 03/11/69 (`ai/http-helper-canonical`)
      · ขั้น 1 (เสร็จ): ทำ `authFetch` เป็น canonical ใน `apiFetch.ts` แล้ว re-export จาก `fetchJson.ts` + `apiClient.ts` — importจากไหนก็ได้ฟังก์ชันตัวเดียวกัน
      · เทสต์ `tools/test/http-helper-canonical.test.mjs` **4/4** (แดงก่อนแก้)
      · ขั้น 2 (**ยกเลิก 04/11/69**): จะย้าย `privacy.tsx`/`trace.tsx` → `authFetch` แต่เทสต์เดิม `tools/test/login-privacy-links.test.mjs` ห้ามไว้ชัดเจน — สองหน้านี้เป็น **สาธารณะก่อนล็อกอิน** ต้องใช้ `fetch` ตรง ไม่งั้นติด 401 อ่านนโยบาย/ตามรอยล็อตไม่ได้
      · งานที่เหลือของ J3e: เฉพาะหน้า **หลังล็อกอิน** (settings/business ฯลฯ) ที่ยิง API ตัวเอง — ต้องเช็กทีละหน้าว่า endpoint ต้องมี token จริงก่อนย้าย
- [x] **J3f `STATUS.md` 412 บรรทัด/344 KB** — **เสร็จ 03/11/69** (`ai/status-doc`)
      · ย้าย journal เดิม (บันทึกถึง 22/10/69) → `docs/history/status-journal-2026-10.md` (ไม่ตัดทิ้ง) · `STATUS.md` ใหม่ 85 บรรทัด gen จาก `system-truth.json` + `logs/nightly/status.json` + `ops-status.json` + `nightly-history.json`
      · `tools/status-doc.mjs`: `--check` (ค่าดีฟอลต์ · อ่านเท่านั้น) / `--write` / `--print` · `--check` ใช้ "สร้างเมื่อ" ในไฟล์เดิมเป็นฐาน ⇒ เวลาผ่านไปไม่ทำให้เก่า เก่าเมื่อข้อมูลจริงเปลี่ยน · `--out=` / `--root=` สำหรับ worktree
      · เทสต์ `tools/test/status-doc.test.mjs` **15/15** (แดงก่อนแก้: `ERR_MODULE_NOT_FOUND` exit 1) ครอบข้อมูลครบ/ว่าง/JSON เสีย/failedExtras/history gaps/CLI exit code/ไฟล์จริงต้องสั้น
      · ไม่ผูกเข้า nightly (กัน diff ทุกคืน) — รันมือก่อน commit · เอกสาร `docs/ops-runbook.md` §STATUS.md
- [x] **J3g ความลับจาก node kit รอบก่อน** — ตรวจชุดที่เผยแพร่วันนี้ (`node-kit-1.1.1.zip`) แล้ว **สะอาด**: มีแต่ `*.env.example`/`*.template` ไม่มี `.env.bak`/`.playwright` · **ยังต้อง revoke credential ที่เคยหลุด** (คิว J4a)
      ชุด 19/10 กรองแล้ว (`.env*` ยกเว้น `.example`) + เทสต์ · ต้อง rotate ความลับและตรวจ access log
      ของ `/api/agent-machines/node-kits/asset` **หลัง Cold Soak** (ห้ามแตะ `.env`/restart ตอนนี้)
- [x] **J3h จำกัดสิทธิ์เส้น `/api/agent-machines/node-kits/*`** — **เสร็จ 03/11/69** (`df35806') · ด่านเดียวกับ /enroll: machine token หรือรหัสเชิญ (เดิมเปิดสาธารณะ ใครรู้ URL ก็โหลดชุดได้)
      (ตามดีไซน์) → ตรวจ WAF/allowlist ว่าไม่เปิดสู่สาธารณะ + พิจารณา signed URL ในรอบถัดไป

## J4 — เจ้าของตัดสินใจ

- [ ] **J4a Telegram bot token เก่า 2 ตัว** (`8807673052`, `8671099037`) — ยังไม่ revoke ที่
      @BotFather (token ใหม่เข้ารหัสใน DB แล้ว)
- [ ] **J4b export JSON สำรองข้อมูล** ก่อนเริ่มรอบพัฒนาใหม่
- [ ] **J4c อัปโหลด template `Voltage 5V DC. in Thailand.png` กลับเข้า repo หรือไม่**

## J5 — ปรับโครงเมนูให้กระชับ (คำสั่งเจ้าของ 19/10/69) — ✅ เสร็จแล้วบน branch

- [x] **J5a ควบรวมเมนูเป็นศูนย์ (SECTIONS) + แท็บใน PageHeader** — `features/nav-consolidation`
  - AI: `/predictive` `/governance-sim` `/learning` `/risk-monitor` `/property` `/alerts` `/knowledge` `/reports` → แท็บของ `/ai` (branch `ai/nav-consolidation`)
  - ฟาร์ม: `/research/rice` → แท็บของ `/trace` · สุขภาพ: `/health/self-check` + `/mbti` → แท็บของ `/health`
  - ระบบพื้นฐาน: `/energy` `/automation` `/relay` → แท็บของ `/infrastructure`
  - ระบบ: `/system-health` `/alert-history` → แท็บของ `/system` · `/backup` `/change-password` → แท็บของ `/settings`
  - Sidebar: ร้านอาหาร + คลัง&ลงทุน พับ/กางได้ จำสถานะใน `localStorage` (`sovereign:nav-open`)
  - หน้าเดิม/ดีปลิงก์ไม่ถูกย้ายหรือลบ — `ALL_PAGES` ยังรวมแท็บทั้งหมดให้ CommandPalette ค้นเจอ
  - เทสต์: `tools/test/nav-consolidation.test.mjs` 9/9 · `npm run verify` 6/6 (13.5 นาที)
  - **ยังไม่เห็นบน :3000** เพราะ Cold Soak ห้าม rebuild/restart — จะขึ้นเมื่อ build frontend รอบถัดไป

## J6 — หน้าต่าง PowerShell/cmd เด้งเอง (เคสจริง 20/10/69) — ปิดแล้ว

- [x] **J6a หาต้นตอ** — เจ้าของส่งภาพหน้าต่าง
      `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3001/api/health …`
      เด้งขึ้นมาเอง ⇒ `sovereign-frontend/electron/main.js` เปิด `start-sovereign.bat` ด้วย
      `spawn(cmd, …, { detached: true, windowsHide: true })`
      · detached = ลูก "ไม่มี console" เลย ⇒ ทุกโปรเซส console ที่ .bat เรียกต่อ (powershell ในลูป health check
      ทุก 3 วิ · docker info · npm run build) ต้องขอ console ใหม่ของตัวเอง = หน้าต่างจริงเด้ง
      (windowsHide ซ่อนได้แค่ console ของ "ลูกโดยตรง" เท่านั้น)
- [x] **J6b พิสูจน์ด้วยเครื่องมือ ไม่ใช่คำอธิบาย** — `tools/window-flash-probe.ps1` นับเฉพาะหน้าต่างที่
      "มองเห็นได้จริง" (class ConsoleWindowClass) ⇒ detached+windowsHide จับได้ `powershell …` + `docker info`
      · ส่งผ่าน wscript + `tools/run-hidden.vbs` = 0 หน้าต่าง และ .bat ทำงานจนจบแม้ปิดตัวเปิดไปแล้ว
- [x] **J6c ทางแก้** — ตัวช่วยกลาง `tools/hidden-launch.cjs` (wscript = GUI host ไม่มี console → ให้ .bat
      มี console ของตัวเองแบบซ่อน · มี VBS สำรองเมื่อแพ็กไม่มี tools/ · ปฏิเสธคำสั่งที่มีอักขระไทย เพราะ .cmd
      อ่านด้วย codepage ของ console แล้วพังทั้งไฟล์) ใช้ทั้ง `electron/main.js` และ `autostart.mjs`
      — เดิม autostart ก็เด้ง: probe จับได้หน้าต่าง `C:\Program Files\nodejs\node.exe` ตอน login
- [x] **J6d เทสต์ล็อก** — `tools/test/hidden-launch.test.mjs` 10/10 (รวมเทสต์จริง ~9 วิ: probe ต้องได้ 0 หน้าต่าง
      + .bat ต้องจบแม้ตัวเปิดออกไปก่อน) และกฎทั้งโปรเจ็กต์ใน `tools/test/windows-hide-guard.test.mjs`
      (detached+windowsHide ต้องมีเหตุผลในรายการยกเว้น · ห้ามใช้กับ shell เด็ดขาด)
- [ ] **J6e สแตก edge-AI / agent-runner ยังใช้ detached+windowsHide แบบลูกโดยตรง (node/ollama)** — อยู่ใน
      รายการยกเว้นพร้อมเหตุผล "ยังไม่ได้พิสูจน์กับหน้าต่างจริง" (สแตกปิดอยู่ตอนตรวจ) ⇒ รอบหน้าที่เปิด edge-AI
      ให้รัน `tools/window-flash-probe.ps1` ระหว่าง `start.mjs` ถ้าเห็นหน้าต่างให้ย้ายมาใช้ hidden-launch.cjs
- [ ] **J6f แพ็ก desktop ที่ไม่มีโฟลเดอร์ tools/** — ตอนนี้ถอยไปใช้ `cmd /d /c call` แบบ windowsHide
      (ไม่มีหน้าต่าง แต่ .bat อาจตายถ้าปิดแอปกลางทาง) ⇒ ถ้าต้องการครบ ให้ก๊อป `tools/hidden-launch.cjs`
      + `tools/run-hidden.vbs` เข้าแพ็กด้วย (แก้ `tools/build-desktop.mjs` — ยังไม่แตะรอบนี้)

## J7 — Docker flap: watchdog ปลุก daemon แล้ว daemon ตายทันทีที่รอบจบ (เคสจริง 19/10/69) — ปิดแล้ว

- [x] **J7a หลักฐาน** — `logs/docker-watchdog.jsonl`: `daemon-restart` 46 ครั้งในวันที่ 19/10
      (44 ครั้งในช่วง ~1 ชม. เวลา 19:40–20:41 UTC) ทุกรอบรายงาน "daemon กลับมาใน 11–75 วิ"
      แล้วตายอีกในรอบถัดไป ⇒ ชั่วโมงนั้น `sovereign-db` ถูก kill/start วน (วันปกติมี 1–5 ครั้ง)
- [x] **J7b ต้นตอ** — `tools/docker-watchdog.mjs` ปลุก Docker Desktop ด้วย `spawn(exe, …, { windowsHide })`
      เป็นลูกของ node · Task Scheduler ห่อแต่ละรอบด้วย **job object แบบ kill-on-close** ⇒ เมื่อรอบจบ
      โปรเซสลูกทั้งหมด (รวม Docker Desktop ที่เพิ่งปลุก) ถูกปิดตาม · `detached`/`windowsHide` ไม่ช่วย
      เพราะเป็นคนละกลไกกับ job (พิสูจน์กลไกแล้ว: sleeper ที่ explorer เปิด **รอด**หลังตัวเปิดจบ)
- [x] **J7c ทางแก้** — ส่งต่อให้ `explorer.exe` เปิด Docker Desktop (โปรเซสของ session ผู้ใช้ อยู่นอก job)
      · เป็น GUI ไม่มี console → ไม่มีหน้าต่างเด้ง · ถอยไปเปิดตรงเฉพาะเมื่อไม่มี explorer
      · **ไม่ต้องลงทะเบียนงานใหม่** — task เดิมเรียกสคริปต์นี้ทุกนาทีอยู่แล้ว การแก้มีผลรอบถัดไป
      (และไม่มีผลกับระบบตอน daemon ปกติ เพราะ path นี้ทำงานเฉพาะตอน daemon ดับ)
- [x] **J7d flap guard** — `planRecovery()` (pure) + `logs/docker-watchdog.state.json`:
      ปลุกเกิน 3 ครั้งใน 30 นาที = **หยุดปลุก** + แจ้ง Telegram ครั้งเดียวต่อชั่วโมง (กัน DB ตายวน + กันสแปม)
      → มี action ใหม่ `flap-detected` (เดิมมี `containers-checked` / `daemon-restart`)
- [x] **J7e เทสต์** — `tools/test/docker-watchdog-plan.test.mjs` 16/16 (flap guard · state เพี้ยน ·
      ต้องเปิดผ่าน explorer · ของจริง: sleeper รอดหลังตัวเปิดจบ) · รันจริง 1 รอบได้
      `{"action":"containers-checked","ok":true}` exit 0 · guard เดิม 42/42 ยังเขียว
- [x] **J7f ความไม่ตรงกันเล็ก ๆ (ปิดแล้ว 21/10/69):** ของจริงคือ Task `Sovereign Docker Watch`
      **ทุก 1 นาที** (ยืนยันจาก Task Scheduler · Last Result 0) แต่ `tools/register-docker-watch.ps1`
      และคอมเมนต์ `docker-watchdog.mjs:3` เขียน "ทุก 10 นาที" → แก้ให้ตรงเป็น 1 นาทีทั้งสองที่
      (ไม่ต้องลงทะเบียน task ใหม่ — ของจริงเร็วกว่าอยู่แล้ว)

## J8 — Liquid Glass + React Three Fiber + shader gradient (คำสั่งเจ้าของ 21/10/69) — ปิดแล้ว

- [x] **J8a คัดไลบรารีจาก GitHub ให้เข้ากับ React 18 จริง** — โปรเจกต์ใช้ React 18.3.1:
      • `@vepando/liquid-glass-react@1.0.1` (MIT · กระจกหักเหแสงด้วย SVG `feDisplacementMap`
        ตามกฎของสเนลล์ · **ไม่ใช้ WebGL** ⇒ วางซ้อนได้หลายใบโดยไม่กิน context) — ประกาศรองรับ React 18+
      • `@react-three/fiber@8.18.0` — ไลน์ 8 คือคู่กับ React 18 (v9 บังคับ React ≥ 19)
      • `@shadergradient/react@2.4.20` — ฉากไล่สีแบบ shader · dist import `three`/`@react-three/fiber`
        จากโปรเจกต์ (ไม่พก three สำเนาที่สอง)
- [x] **J8b ตัวที่ต้องตัดออก (กับดักจริง)** — `liquid-glass-react` (6.4k ดาว ดาวเยอะสุดในหมวดนี้)
      ประกาศ `peer react >= 19` **ทุกเวอร์ชัน** ⇒ `npm install` บน React 18 ล้ม (ERESOLVE) หรือถ้าฝืนด้วย
      `--legacy-peer-deps` จะพังตอน `tsc`/เรนเดอร์ ⇒ เทสต์ล็อกไว้ว่าห้ามกลับไปใช้ (ทั้ง package.json + lock)
- [x] **J8c คอมโพเนนต์ใหม่** `sovereign-frontend/src/components/glass/` —
      `GlassSurface` (3 โทน panel/contrast/light · `refraction` ปิดชั้นหักเหได้) ·
      `ShaderGradientBackdrop` → `ShaderGradientScene` · `GlassOrb` → `GlassOrbScene`
      (ShaderMaterial เขียนเอง: เฟรสเนลขอบแก้ว + สีไหล 2 ชั้น, ไม่โหลด HDR/รูปนอกเครื่อง) ·
      `useReducedMotion` (SSR-safe) · `glassPalettes` (ข้อมูลล้วน ไม่ลาก WebGL เข้า bundle หน้า) ·
      `GlassLabSection` (เวทีสาธิต วางบนหน้า Design System `/hover-cards`)
- [x] **J8d กันหน้าเว็บพัง** — ฉาก WebGL เข้าได้ทาง `next/dynamic` + `ssr:false` เท่านั้น (เทสต์สแกนทั้ง `src/`)
      · shader ใช้ `lightType="3d"` เพราะโหมด `env` จะไปโหลดไฟล์ `.hdr` จากภายนอก ซึ่งโดน CSP
      (`connect-src` ไม่ได้เปิด host นอก) · CSS ของไลบรารี import ครั้งเดียวที่ `_app.tsx`
      (Pages Router import global CSS ได้เฉพาะที่นั่น) · ทุกฉากหยุดเองเมื่อ OS ตั้ง Reduced motion
- [x] **J8e พิสูจน์ด้วยภาพจริง (ไม่แตะ :3000)** — build แล้วเปิด `next start -p 3124` (โปรเซสชั่วคราว
      แยกจาก runtime ที่ serve อยู่) แล้วถ่ายภาพด้วย Playwright: 6 กระจก (`.lg`) + 2 canvas
      (1102×336 shader · 475×280 orb) · WebGL ทำงาน · **ไม่มี page error** (แปลว่า shader คอมไพล์ผ่าน) ·
      ภาพเดสก์ท็อป/มือถือผ่าน · กดสลับชุดสีเป็น "ถ่านทอง" แล้วสีเปลี่ยนจริง (`aria-pressed=true`)
      (รูปอยู่ `logs/glass-lab-*.png`)
- [x] **J8f เทสต์** — `tools/test/glass-stack.test.mjs` 11/11: React 18 peer guard · ห้าม
      `liquid-glass-react` · ขอบเขต client-only ของฉาก WebGL · CSS ที่ `_app.tsx` เท่านั้น ·
      reduced motion · เพดาน 400 บรรทัด
- [ ] **J8g รอบถัดไป (หลัง Cold Soak):** ยก `GlassSurface` ไปใช้กับหน้าจริง (การ์ดแดชบอร์ด/เฮิร์บ +
      แผงควบคุม) และวัด FPS/แรมบนเครื่องจริงก่อนตัดสินใจเปิด shader ในหน้าแรก — ตอนนี้ตั้งใจให้
      WebGL ทำงานเฉพาะหน้า `/hover-cards` เพื่อไม่ให้ทุกหน้าต้องแบก GPU
      - **เริ่มแล้ว 21–22/10/69 (ยังไม่ live):** QuickDeck บนแดชบอร์ดใช้ `GlassSurface` จริงเป็นชิ้นแรก
        (`src/components/ui/QuickDeck.tsx` — SVG, ไม่มี WebGL) + เทสต์กัน WebGL หลุดเข้าหน้าจริง ·
        เหลือการ์ด/เฮิร์บ + วัด FPS; ต้อง restart frontend หลัง Cold Soak ก่อนเห็นบน :3000
- [ ] **J8h ทางเลือกสำรอง:** ถ้าเจ้าของต้องการ "แก้วเต็มจอ" ทุกหน้า ให้ย้าย shader ไปชั้นเดียวระดับ `_app`
      (1 canvas ค้างไว้ทั้งแอป) แทนการวางใหม่ทุกการ์ด — ต้องวัดเพิ่มก่อน เพราะ `_app` เป็นไฟล์ critical

## J9 — ตรวจข้อกล่าวอ้าง B2B/SaaS กับของจริง + ปิดช่องว่างที่ปลอดภัย (21/10/69) — ทำแล้ว

- [x] **J9a ตรวจ 9 ข้อกล่าวอ้างกับโค้ดจริง** — ผลอยู่ `docs/B2B-READINESS-AUDIT-2026-10-21.md`
      (SQLite/ไม่มี off-site/ไม่มี WAF-rate limit/ไม่มี installer/ภาษี hardcode = **ไม่จริง** มีหลักฐาน file:line ครบ ·
      ขาดจริง 3 เรื่อง: ตรวจสลิปอัตโนมัติ · e-Tax XML+ลายเซ็น · cloud object storage สำหรับ backup)
- [x] **J9b ทางเข้า `/hover-cards` — ถูกด่านบล็อก (ไม่ใช่บั๊ก):** พยายามเพิ่มเป็นรายการ ⌘K แบบไม่ขึ้น Sidebar
      แต่ `tools/test/desktop-only.test.mjs:83` ห้ามเมนูทุกรูปแบบลิงก์ `/hover-cards` (อยู่ในรายการ "หน้าเว็บที่ถูกถอด")
      ⇒ เลือกทางปลอดภัย: **คืน `navigation.ts` ทั้งไฟล์ (ไม่มี diff)** คงหน้าไว้ที่ URL ตรง · ถ้าเจ้าของต้องการให้เข้าจาก ⌘K
      ต้องอนุมัติแก้ policy ก่อน (พร้อมเหตุผลว่าหน้านี้ยังใช้เป็น Design System lab)
- [x] **J9c แกนตัดสินสลิป (ไม่แตะ DB/เครือข่าย/env)** — `slip-verify.service.ts` เทียบเงินเป็นสตางค์ ·
      เทียบชื่อผู้รับแบบไทย + 4 หลักท้ายบัญชี · กันสลิปซ้ำด้วย `provider:transRef` · กันสลิปเก่า/อนาคต ·
      เทสต์ 22 เคส + boundary 3 เคส · พิสูจน์ red-first (ปิดกฎ UNDERPAID → แดง 2, exit 1 → คืน → เขียว)
- [x] **J9d ปิดช่องโหว่ dependency ที่ปลอดภัย** — backend `follow-redirects 1.16.0 → 1.16.1` (transitive ของ axios)
      → `npm audit` = 0 · frontend prod deps = 0 (15 รายการเป็น devDeps ล้วน — major upgrade เลื่อนไปหลัง soak)
- [ ] **J9e หลัง Cold Soak (ต้อง migrate):** ตาราง `payment_slips` + `UNIQUE(provider, trans_ref)` +
      endpoint `POST /api/shop/orders/:token/slip` + adapter ผู้ให้บริการ (เจ้าของเลือก) + UI เหตุผลการตัดสิน ·
      ห้าม auto-ปิดยอดเมื่อ `PAYEE_UNVERIFIED`/`AMOUNT_MISMATCH`
  - [x] **free-first backend (23/10/69):** `payment_slips` + internal endpoints `/api/payments/slips/*` +
        manual review/audit + adapter interface (`MANUAL` เท่านั้น) · DB suite 43/43 · migration
        `20261023170000_payment_slips` (ตอนนั้นยังไม่ apply — ดูรายการถัดไป)
  - [x] **ซ้อม migrate บน schema จริง (24/10/69):** dump schema-only ของ production (142 ตาราง) ลงฐานชั่วคราว
        `sovereign_migrate_dryrun` → apply migration ผ่าน **9/9 statement (exit 0)** → ตรวจพฤติกรรมจริง
        (sha256 ซ้ำ/`provider+transRef` ซ้ำถูกปฏิเสธ · `transRef` NULL ซ้ำได้ · FK cascade/set-null ถูก)
        → ลบฐานชั่วคราวแล้ว · production ยังไม่มีตาราง (`to_regclass` = NULL)
        · เทสต์กันถอยหลัง `tools/test/payment-slips-migration.test.mjs` 10/10 (แดง exit 1 เมื่อตัด unique ออก)
  - [x] **apply migration + restart (24/10/69 12:32 — เจ้าของอนุมัติ):**
        backup `backups/postgres/sovereign_20261024_122912.dump` (5.9 MB) + restore drill เข้าฐานชั่วคราว
        (TimescaleDB `pre/post_restore`) → ทุกตารางตรงเป๊ะ (sensor_telemetry 239,660 แถว ณ เวลาที่ dump;
        ผลต่าง 9 แถวคือข้อมูลไหลเข้าหลัง dump ไม่ใช่ข้อมูลหาย) → `prisma migrate deploy` สำเร็จ
        → `payment_slips=true`, index 5, FK 4, migration record 1 (finished, ไม่ rollback)
        → restart container healthy · `/api/payments/slips/<uuid>` ตอบ **401** (registered; ก่อนหน้านี้ 404)
  - [ ] public `POST /api/shop/orders/:token/slip` + UI เหตุผล + paid adapter — หน้าร้านอยู่
        `Sovereign-Web-Standalone`; ต้องให้เจ้าของเลือกที่วาง UI/ผู้ให้บริการก่อน
- [ ] **J9f e-Tax:** ต้องมี invoice + เลขรัน + ETDA schema + XMLDSig/C14N + certificate + ช่องทางที่รับรอง —
      ห้ามเขียนเองแบบเดา; เลือกผู้ให้บริการก่อนแล้วทำ adapter
- [ ] **J9g Cloud backup:** S3/R2 uploader (SigV4 เอง ไม่เพิ่ม dep) หลังได้ creds จากเจ้าของ + restore drill รายไตรมาส
- [x] **J9h Tax Rules config (ทำแล้ว รอบ 2):** `tax-rules.ts` + `getTaxRules()` — ค่าเริ่มต้น = `RATES` เดิมเป๊ะ ·
      override ผ่าน `core-api/data/tax-rules.json` (gitignored, ไม่สร้างอัตโนมัติ) · ตรวจเข้ม (rate 0–1, ขั้นเรียงขึ้น,
      ขั้นสุดท้าย null, คีย์พิมพ์ผิด, effectiveFrom อนาคต) แล้ว **fallback ค่าเดิมทั้งใบ** · เทสต์ 12 + boundary 3 ·
      red-first พิสูจน์แล้ว (ปล่อย rate 1.5 ผ่าน → แดง)
- [x] **J9i ตรวจเอกสารฉบับขยาย (รอบ 2):** 61 หน้า (45+ จริง) · KDS/ใบกำกับพร้อมพิมพ์/สมุดบัญชี/QR PromptPay มีจริง ·
      `/shop` + "แนบสลิปผ่านลิงก์ลับ" **ไม่จริงใน repo นี้** (ย้ายไป Sovereign-Web-Standalone) ·
      "self-heal 30 วิ/60 วิ" ไม่จริง (Task ตรวจทุก 1 นาที + รอ backend ถึง 180 วิ) · "PDF อัตโนมัติ" = พร้อมพิมพ์ + Save as PDF เท่านั้น
- [ ] **J9j Nice-level ให้ Ollama (ข้อเสนอในเอกสาร ยังไม่ทำ):** ต้องวัดภาระจริงก่อน設定 priority ของ process —
      ยังไม่แตะเพราะอาจทำให้ AI ถูก starvation จนฟีเจอร์อื่นพัง; ค่อยทำหลัง soak พร้อมตัววัด CPU/RAM
- **นโยบายเจ้าของ 21/10/69:** "อนุมัติเลย ถ้าทำแล้วไม่เสียเงิน และข้าม ถ้าทำแล้วเสียเงิน"
  ⇒ ทำทันทีเฉพาะงานฟรี: แก้ CI smoke ที่ชี้ `/shop` (ตายแล้ว) → `/` · ปรับ docs/Cron ให้ตรงจริง (Docker Watch 1 นาที) · รวม Dependabot patch/minor
  ⇒ **ข้ามจนเจ้าของเปิดงบ:** สลิป API (SlipOK/EasySlip), e-Tax (certificate/ผู้ให้บริการ), cloud object storage
  ⇒ **เลื่อนหลัง Cold Soak:** major upgrades (tailwind 4 / electron-builder) — ฟรีแต่ต้อง rebuild + ตรวจภาพทั้งระบบ

---

# คิวใหม่: "มองเห็นได้" (เส้นทาง A) — 27/10/69

> เจ้าของเลือก **A: มองเห็นได้** เป็นงานแรกหลังเทียบกับระบบระดับโลก (balena/Sentry/OTel)
> และตอบคำถามสถาปัตยกรรมว่า **"ขายให้คนอื่นติดตั้งเอง"** + **"ต้องขายต่อได้"** → บันทึกที่ `docs/PRODUCT-DIRECTION.md`
> ข้อจำกัด: Cold Soak — ห้าม restart/migration/deploy · งานนี้ **ไม่ต้อง migration** แต่ **ต้อง restart core-api** ก่อนมีผลจริง

- [x] **A-obs1 request-id ไล่ทั้งเส้น** — **โค้ด + tests แล้ว 27/10/69** (`ai/observability-a` → `main`)
  - `src/lib/observability.ts`: `normalizeRequestId` (รับ id ที่ปลอดภัย ≤64 ตัวอักษร / อักขระแปลก = สร้าง uuid ใหม่ กัน log injection)
  - `src/middleware/observability.middleware.ts`: `createObservability()` → `requestContext` + `metricsHandler` · instance กลาง `getObservability()`
  - frontend `src/lib/requestId.ts` + `apiFetch.ts`: ทุกคำขอแนบ `x-request-id`
  - error response พา `requestId` กลับไป (ผู้ใช้แจ้งเลข → ไล่ log เจอทันที)
- [x] **A-obs2 access log JSON + /api/metrics** — **โค้ด + tests แล้ว 27/10/69**
  - log ไม่มี query string/header/cookie/body · ตัด `/healthz` + `/api/health` ออกจาก log (ยังนับ metrics)
  - `/api/metrics` text format Prometheus · label เป็น **route pattern** (กัน cardinality ระเบิด) · `tenant` label รอ multi-tenant
  - **ปิดโดยปริญญา**: ไม่ตั้ง `METRICS_TOKEN` = 401 (timingSafeEqual) · รับ `x-metrics-token` หรือ `Authorization: Bearer`
  - `ACCESS_LOG=off` = สวิตช์ปิด log (metrics ยังนับ) · `TENANT_ID` = ชื่อผู้เช่า
  - เทสต์: `observability.test.ts` 19/19 · `observabilityWiring.test.ts` 5/5 · `requestId.test.ts` ผ่าน (แดง exit 1 ก่อนมีโค้ด)
  - `npm run verify` ที่ root — **ผ่าน 6/6 (16.5 นาที) 27/10/69** · merge เข้า `main` แล้ว (`b733213`)
- [x] **A-obs3 เอกสาร SLO** — `docs/SLO.md` (SLI/SLO/error budget + PromQL + นโยบาย budget หมด)
- [ ] **A-obs4 เปิดใช้จริง** — ต้อง **restart core-api** (รอ Cold Soak / อนุมัติเจ้าของ)
      `METRICS_TOKEN` + `TENANT_ID` + `ACCESS_LOG` อยู่ใน `sovereign-os/infra/.env` (เจ้าของแก้เอง)
      ขั้นตอน: ตั้ง token → `docker restart sovereign-core-api` → `curl -H "x-metrics-token: …" :3001/api/metrics` → ต้องได้ 200 / ไม่ส่ง token ต้องได้ 401
- [x] **A-obs5 push ขึ้น GitHub** — **เสร็จแล้ว 03/11/69** (`3529d2e`)
- [ ] **A-obs6 ตัวเก็บ log/metrics (ยังไม่ตัดสิน)** — Prometheus+Grafana ในเครื่อง หรือสรุป JSON log ด้วย `tools/` — ขึ้นกับสเปก RAM เครื่อง HUB
- [ ] **A-obs7 ต่อยอดหลัง A-obs4** — DB latency ผ่าน Prisma middleware · queue depth (offline queue/agent/MQTT) · alert "error budget กำลังหมด" · span ระดับ OTel

## คิวถัดไปที่เจ้าของเลือกไว้ (ยังไม่เริ่ม)
- [x] **B "เน็ตหลุดก็ขายได้"** — idempotency key กลาง — **ใช้งานจริงครบทั้ง backend + frontend 28/10/69** (`docs/IDEMPOTENCY.md`)
      ต่อแล้ว 4 endpoint (business order/payment · restaurant order/purchase) · migrate + restart + smoke 8/8 ผ่าน ·
      frontend build ใหม่ขึ้น `:3000` แล้ว ผู้ใช้เบราว์เซอร์ส่ง `x-idempotency-key` จริง
- [ ] **B2 local read model + กติกา conflict resolution** — ยังไม่เริ่ม (ต้องมี sync จริงก่อน)
- [x] **C "คนในบ้านใช้เองได้"** — a11y + onboarding + error ที่บอกทางแก้ — **ครบทั้งชุด 28/10/69** (C1/C2/C2b/C3/C4 + deploy ขึ้น `:3000`)
      ยอดรวม: a11y 45 เคส + `actionable-errors` 22 + `c4-onboarding` 16 · mutation พิสูจน์ 19 แบบ (5+6+8) จับได้ทั้งหมด · label ลอยทั้ง `src/**/*.tsx` = 0 · `npm run verify` 6/6 exit 0
  - [x] **C1 หน้าล็อกอิน / OTP / เปลี่ยนรหัสผ่าน** — 28/10/69
        `tools/test/a11y-forms.test.mjs` **25 เคส** (static อ่าน JSX — ไม่ต้องมีบัญชี/เซิร์ฟเวอร์)
        - `label` ผูกกับช่องกรอกจริง (`htmlFor` ↔ `id`) · ทุกช่องมีชื่อให้ screen reader · ไม่มี `htmlFor` ชี้เป้าผิด
        - ข้อความ error ของ login/OTP มี `role="alert"` (เดิมเงียบ) · ช่อง login ใช้ `aria-describedby` + `aria-invalid`
        - ช่องรหัสสำรองของ OTP มี `aria-label` + `aria-describedby` ชี้คำอธิบาย
        - mutation พิสูจน์แล้ว 5/5 (exit 1 ทั้งหมด): ถอด `htmlFor` · ถอด `role="alert"` · ถอดชื่อช่องรหัสสำรอง · ถอด `id` ของช่องรหัสใหม่ · ถอด `htmlFor` ของตัวกรองเซนเซอร์
        - บทเรียน: เทสต์ต้องตัด comment ก่อนตรวจ (คอมเมนต์ที่มี `role="alert"` ทำให้ผ่านทั้งที่ attribute จริงหาย)
          และ **ห้ามตัด block comment ด้วย `/\*...\*/`** — สตริง `accept="image/*"` ทำให้โค้ดถูกกินทั้งบล็อก
  - [x] **C2 ฟอร์มที่คนในบ้านใช้จริง (ชุดแรก)** — 28/10/69: `settings` (Telegram) · `sensors/SensorsHub` · `predictive` · `restaurant` + `restaurant/admin` · `vision`
  - [x] **C3 `img` ไม่มี `alt`** — 28/10/69: `pages/trace.tsx` (QR ในหน้าพิมพ์) ใส่ `alt="QR ${qr.lotCode}"`
  - [x] **C2b ฟอร์มที่เหลือ** — 28/10/69: ผูก `label` ↔ ช่องกรอกครบ **10 ไฟล์** (`coding/CodingIde` · `coding/SkillQueuePanel` · `scenarios/ScenarioForecast` · `pages/ai` · `pages/relay` · `pages/terrain-demo` · `pages/skills` · `pages/selfreliance` · `pages/research/rice` · `pages/treasury`)
        - 3 จุดที่เป็น "ป้ายหัวกลุ่มปุ่ม" (ไม่ใช่ label ของช่องกรอก) เปลี่ยนเป็น `<div>`: `CodingIde` (ระดับเหตุผล) · `relay` (วันในสัปดาห์) · `treasury` (ทิศทาง) — `<label>` ที่ไม่มี control ข้างในทำให้ screen reader อ่านหลอก
        - 2 ตัวที่เป็น wrapper component (`business/soverien/ui.tsx` `Field` · `agent-queue.tsx` `Field`) รับ `children` → เป็น implicit association ตาม spec **ไม่แก้โค้ด** แต่ให้เทสต์ข้ามอย่างมีเหตุผล
        - เทสต์รวมเป็น **45 เคส** · sweep ทั้ง `src/**/*.tsx` เหลือ label ลอย **0 จุด** (ไม่นับ 2 wrapper)
        - red proof: เอาไฟล์ชุดนี้จาก `HEAD` (ก่อนแก้) มารัน → **exit 1 ทั้ง 10 ไฟล์** · mutation เพิ่ม 6/6 จับได้ (ถอด `htmlFor` · ถอด `id` · ถอด `htmlFor` แบบ template · เปลี่ยน caption กลับเป็น `<label>` 2 จุด)
        - `npm run verify` 6/6 exit 0 (15.2 นาที)
  - [x] **C4 onboarding ผู้ใช้ใหม่ + ข้อความ error ที่บอก "แก้ยังไง"** — 28/10/69
        - `lib/actionableError.ts` — แปลง error (Error / Response-like / status number / string / โค้ด Prisma) เป็น `{kind, what, fix, retryable}` ครบ 11 ชนิด (`offline` · `unauthorized` · `forbidden` · `notFound` · `conflict` · `rateLimited` · `server` · `dbNotReady` · `badId` · `badRequest` · `unknown`) ทั้ง th/en — ทุก `fix` มีคำบอกให้ลงมือทำ (`docker ps` · `docker logs` · `migrate` · ล็อกอินใหม่ · รอ · โหลดใหม่)
        - `components/ui/ErrorNotice.tsx` — กล่อง `role="alert"` แสดง "เกิดอะไร + แก้ยังไง" และปุ่มลองใหม่เฉพาะเมื่อ `retryable` และมี `onRetry` จริง
        - ต่อสายจริง 3 หน้า: `energy` (ยก `load` เป็น `useCallback` เพื่อให้กดลองใหม่ได้ — เดิมอยู่ใน `useEffect`) · `inventory` · `system-health`
        - `lib/firstRun.ts` + `pages/start.tsx` — เช็กลิสต์ 6 ขั้น (รหัสผ่าน · เซนเซอร์ · พลังงาน · ของใช้ · แจ้งเตือน · สุขภาพระบบ) ลิงก์ไปหน้าที่มีจริงทุกอัน จำความคืบหน้าใน `localStorage` ผ่านคีย์กลาง และข้ามได้
        - ล็อกอินครั้งแรก (ปกติ + OTP 2 ทาง) พาไป `/start` ครั้งเดียวผ่าน `loginLandingPath()` — ครั้งต่อไป `/dashboard`; `mustChangePassword` ยังชนะทุกกรณี
        - `ApiConnectionBanner` เพิ่มคำใบ้ `docker ps` + ชื่อ container เมื่อต่อ API ไม่ได้นานเกิน 1 นาที
        - เทสต์ใหม่ 2 ไฟล์: `tools/test/actionable-errors.test.mjs` **22 เคส** (เรียกฟังก์ชันจริงผ่าน Node 24 type-stripping ไม่ใช่ grep) · `tools/test/c4-onboarding.test.mjs` **16 เคส**
        - mutation 8/8 จับได้ (exit 1): ข้อความดิบสั้น ๆ · ถอด `role="alert"` · ปุ่มลองใหม่ไม่เช็ค `retryable` · ไม่พาไป `/start` · ลิงก์ขั้นตอนผิดหน้า · login กลับไป push เอง · ถอดคำใบ้ docker · energy ไม่ใช้ ErrorNotice
        - บทเรียน: เทสต์ที่อ่านซอร์ส **ต้องตัด comment ก่อนตรวจเสมอ** — รอบแรก M2/M3 ผ่านเพราะคอมเมนต์มีคำว่า `role="alert"`/`retryable` อยู่ (แก้เทสต์ ไม่ใช่แก้ mutation)
        - `npm run verify` 6/6 exit 0 (17.1 นาที) · sweep label ลอยทั้ง `src/**/*.tsx` = 0
      - **deploy 28/10/69**: สลับ build ขึ้น `:3000` แล้ว — BUILD_ID `lAvVNVOFYVjQGF3WYRgTR` · `/start/` = 200 · `__NEXT_DATA__ page=/start` ตรง · build เก่า `R5T_mlyuNUkW18UpSCGuM` เก็บที่ `logs/next-backup-20261028_155543` (rollback = สลับโฟลเดอร์กลับ) · `sw-precache.json` regen หลังสลับ = 159 assets · backend `/api/health/` ok · ไม่มี migration/restart backend
      - **acceptance ผ่านเบราว์เซอร์จริง 28/10/69**: เปิด `http://127.0.0.1:3000/start/` บน Chromium — เรนเดอร์ครบ (หัว "เริ่มใช้ระบบใน 6 ขั้น" · 6 ขั้น · skip · footer) ·
        ลิงก์ 6 ขั้นชี้ `/change-password` `/sensors` `/energy` `/inventory` `/alerts` `/system-health` ครบ · `label htmlFor` ↔ `checkbox id` ผูกถูกทุกขั้น ·
        ติ๊กขั้นแรก → "ทำแล้ว 1 / 6" + `localStorage['sovereign.firstRunSteps'] = ["password"]` · ยกเลิก → กลับ 0/6 + `[]` ·
        กด "ข้ามไปก่อน" → client-nav ไป `/dashboard/` + `sovereign.firstRunSeen = "1"` · console error = 0 · ลบคีย์ทดสอบออกคืนสภาพเดิมแล้ว
        (ทดสอบแบบไม่ล็อกอิน — dashboard ขึ้น "ไม่มีสิทธิ์" ตาม design ไม่ใช่ข้อผิดพลาดของ `/start`)

---

# คิวใหม่: "ติดตั้งเองได้ + บอกเราได้ว่าติดตรงไหน" (27/10/69)

> เจ้าของ: *"ผมไม่รู้ความต้องการของลูกค้า ผมรู้แค่ว่าอยากพัฒนา"*
> ⇒ เปลี่ยนหลักคิดเป็น **no-regret**: ลงทุนเฉพาะสิ่งที่ต้องมีไม่ว่าลูกค้าจะต้องการอะไร
> และ **ไม่ลงทุน** กับสมมติฐานที่ยังไม่มีหลักฐาน (multi-tenant RLS / billing / license — ดู `docs/PRODUCT-DIRECTION.md`)
>
> เหตุผลที่เลือกงานนี้: จะขายให้ใครก็ต้อง "ติดตั้งจบโดยไม่ต้องมีเรา" และเมื่อไม่จบ ต้องมีใบรายงานที่ส่งกลับมาได้
> (นี่คือจุดที่ balena/Home Assistant ชนะใจคนติดตั้งเอง — ไม่ใช่ฟีเจอร์)

- [x] **D1 `tools/agent-pack/doctor.mjs` — INSTALL-CHECK (อ่านอย่างเดียว)** — **เสร็จ 27/10/69**
  - ตรวจ 10 ข้อ: Node ≥20 · ไฟล์ติดตั้งครบ · `install-plan.json` (ทน BOM) · สิทธิ์เขียนโฟลเดอร์ · พื้นที่ดิสก์ (<1 GB = fail, <6 GB = warn)
    · วิธีลงทะเบียน (join.json หรือรหัสเชิญ) · HUB `/api/health` · Docker (warn) · ของเดิมบนเครื่อง · `--heartbeat` (opt-in พิสูจน์ token)
  - เขียน `SUPPORT.txt` ข้าง ๆ ชุดติดตั้ง — **redact token 64-hex / `enr_...` / ค่า `*TOKEN*|SECRET|PASSWORD|API_KEY`** ก่อนเขียนทุกครั้ง
  - exit 0 = พร้อมติดตั้ง · exit 1 = ต้องแก้ก่อน (สคริปต์/คนตัดสินใจได้)
  - `INSTALL-CHECK.cmd` (ASCII ล้วน + chcp 65001 + CRLF + pause ทุกเส้นทาง) — ดับเบิลคลิกได้
  - `INSTALL.cmd` เมื่อล้มจะบอกให้รัน `INSTALL-CHECK.cmd` เพื่อได้ `SUPPORT.txt`
  - เทสต์ `tools/test/doctor.test.mjs` **27/27** · mutation พิสูจน์แล้ว: ถอด redact 64-hex = **exit 1** · บังคับ heartbeat = **exit 1**
  - ต่อสายเข้าชุดติดตั้งแล้ว (`bundleFiles`/`bundleSource`) + `.gitignore` allow-list (ไฟล์ใน `tools/agent-pack/*` ถูก ignore โดยปริยาย)
- [x] **D2 ทดสอบบนเครื่องลูกจริง** — **เสร็จ 28/10/69 ปลายคืน: เครื่องลูกออนไลน์จริง — ปิดเกณฑ์รับ**
      รอบแรก (เช้า 28/10/69): HUB ไม่เห็นสัญญาณใดเลย — ต้นเหตุชุดเก่าฝัง `HUB_URL=http://192.168.1.102:3000` แต่เครื่องแม่ IP = **192.168.1.101** (DHCP เปลี่ยน) → ยิงไม่ถึงทุกปุ่ม + `INSTALL-CHECK` ธรรมดาไม่ส่งสัญญาณตามดีไซน์ (ต้อง `--post`) เจ้าของจึง "รันแล้วไม่เห็นอะไรเปลี่ยน"
      รอบแก้ (เย็น 28/10/69): แพ็กชุดรันเนอร์ใหม่ผ่านชุดแก้ D5 → เจ้าของก็อปโฟลเดอร์ไปเครื่องลูก **ดับเบิลคลิก INSTALL.cmd ตัวเดียว** → **heartbeat โผล่ใน DB ทันที** (status=online · age 67 วินาทีตอนเช็ค · version=v24.19.0) — เกณฑ์รับ "heartbeat โผล่ใน DB ทันที" ผ่าน
      รายละเอียดการแพ็ก: `--hub-url=http://192.168.1.101:3000 --minimal --force` — hub_url gate ยืนยัน `/api/health` 200 ก่อนแพ็ก · token แถวเดิมถูก**หมุน** (ยัง 2 แถว ไม่สร้างซ้ำ) · เตือน DHCP ทั้งรายงาน/START-HERE · ชุดอยู่ที่ `dist-machine-setup\คอมเครื่องที่ 2`
      บทเรียนข้างทาง: (1) firewall :3000 **เปิดอยู่แล้ว**ด้วยกฎเดิม "Sovereign HUB LAN (agent runner)" (Private profile) — ครั้งแรกสรุปผิดว่าถูกบล็อก เพราะ `Get-NetFirewallRule` error ถูกกลืนด้วย `SilentlyContinue` ⇒ **อย่าเชื่อ count 0 ที่มาจาก SilentlyContinue — ใช้ netsh อ่าน** (2) backend log ไม่มีบรรทัดคำว่า "heartbeat" — DB คือแหล่งความจริง
      ค้าง: `เครื่องที่-3` ยังไม่เคย heartbeat (แถวค้าง ไม่กระทบ) · โฟลเดอร์ `…Origin Install` เก่า (6,633 ไฟล์/834 MB) ลบทิ้งแล้วตามคำสั่งเจ้าของ (exe เดียวกันยังอยู่ที่ `dist-portable`)
- [ ] **D5 ชุดติดตั้งใหม่ "ไฟล์เดียว กดเดียว"** (บทเรียนจาก D2 รอบแรก 28/10/69 — เจ้าของ: "ควรเป็นไฟล์เดียว กดติดตั้งทีเดียว")
      1) **ปุ่มเดียวจบ**: ตรวจเครื่อง → ลงทะเบียน → ตั้ง autostart → รัน runner → รายงานผลสรุปไฟล์เดียว (ปัจจุบันมี .cmd 7–8 ตัวหน้าตาคล้ายกัน — ผู้ใช้เลย "กดทุกอัน")
      2) **HUB_URL ห้ามฝัง LAN IP** — ค่าเริ่มต้นเป็นโดเมนสาธารณะ (ผ่าน cloudflared — IP เปลี่ยนก็ไม่กระทบ) · ถ้าเลือกเส้น LAN ต้องทดสอบเชื่อมต่อตอนแพ็ก + เตือนเรื่อง DHCP/firewall ชัด ๆ
      3) **doctor ต้องพิมพ์ชัดทุกรอบ**: "รอบนี้ไม่ได้ส่งสัญญาณถึง HUB — รัน `INSTALL-CHECK.cmd --post` เพื่อพิสูจน์การเชื่อมต่อ" (กันเข้าใจผิดว่ารันแล้ว HUB ต้องเห็น)
      4) โครงโฟลเดอร์ชุดติดตั้งเรียบลง — START-HERE เด่นสุด ของ build/dev ย้ายไปโฟลเดอร์ย่อย
      เกณฑ์รับ: เทสต์ red-first + mutation + `npm run verify` ผ่าน + ติดตั้งจริงบนเครื่องลูกแล้ว **heartbeat โผล่ใน DB ทันที**
      ▸ **คืบหน้า 28/10/69 (slice 1 — กันชุดพังแบบเงียบ ๆ ที่เจอจริงวันนี้)** บน branch `ai/d5-one-button-installer`:
        · pack ตรวจสายก่อนแพ็กแล้ว — ยิง `GET <hub>/api/health` จริง ไม่ผ่าน = หยุด (exit 1 `hub_unreachable` + ชี้วิธีแก้ `--hub-url`) · 403 นับเป็นยิงไม่ถึง · dry-run ยังไม่แตะเน็ต
        · HUB_URL เป็น IP ส่วนตัว (LAN/localhost) = แพ็กได้แต่**เตือน DHCP** ทั้งรายงานและ START-HERE (โดเมน = ไม่เตือน)
        · doctor พิมพ์ท้ายรายงานเสมอเมื่อรอบนั้นไม่ได้ส่งสัญญาณ: "รอบนี้ไม่ได้ส่งสัญญาณถึง HUB … INSTALL-CHECK.cmd --post" (ข้ามเมื่อโปรไฟล์ hub หรือ heartbeat ถึงตัว HUB แล้ว) — เสร็จตามข้อ 3
        · START-HERE ปิดท้ายด้วยเรื่องเดียว: **INSTALL.cmd ปุ่มเดียว** → ยังไม่ออนไลน์ = รัน `--post` แล้วส่ง `SUPPORT.txt`
        · เทสต์ red-first `tools/test/d5-installer.test.mjs` (แดง exit 1 → เขียว 9/9) · เทสต์เดิม 11 จุดที่เรียก runPack เติม fetchImpl ปลอมแล้ว
        · ยังเหลือ: ค่าเริ่มต้น HUB_URL เป็นโดเมน (ข้อ 2 ครึ่งหลัง) + รวมปุ่ม .cmd ให้เหลือตัวเดียวจริง (ข้อ 1/4) — รอ slice ถัดไป
        · ใช้จริงแล้ว 28/10/69 ปลายคืน: แพ็กชุดรันเนอร์ให้ "คอมเครื่องที่ 2" (LAN + `--force` หมุน token) → เครื่องลูก**ออนไลน์จริง heartbeat ทันที** — ปิด D2 (รายละเอียดที่หัวข้อ D2)
        · **"ติดตั้งจบ = runner เดินทันที" เสร็จ 29/10/69** (`3bc54c1` บน main · red-first: เทสต์ใหม่แดง exit 1 ก่อน → แล้วเขียว + verify 6/6) — แก้ตามเจอจริงด้านล่าง:
            - setup-machine สร้าง `RUN-START.vbs` ตอนติดตั้ง (ASCII ล้วน · ไม่ฝังพาธ — หาโฟลเดอร์ตัวเองด้วย GetParentFolderName · รัน launcher ด้วย window style 0) แล้ว **สั่ง wscript สตาร์ท runner ทันทีหลังตั้ง task** — ไม่ต้องรอล็อกอินครั้งหน้า/รีบูต
            - กันสตาร์ทซ้ำ: เช็ค process ผ่าน CIM (`*main.mjs*` — ต้องกว้างกว่าของ doctor เพราะ RUN-RUNNER.cmd รัน node แบบ relative CommandLine ไม่มีพาธโฟลเดอร์) · เจอ PID = ข้าม · ตรวจไม่ได้ = ข้ามเช่นกัน (ห้ามสตาร์ทเดา) · wscript ล้ม = ติดตั้งยังสำเร็จ + บอกทางเดินต่อ
            - `/TR` ของ task เปลี่ยนเป็น `wscript.exe "…RUN-START.vbs"` (ทั้งชุดเครื่องลูกและ HUB installer `buildRunnerTaskCreateArgs` ที่ param เปลี่ยน `launcherPath → hiddenStartPath`) ⇒ **ล็อกอินครั้งหน้าไม่เด้งหน้าต่างดำอีก** — สาย task → vbs → launcher → node ครบ · สเปกเก่า 2 จุด (install-one-shot L214 · setup-install-plan L142) อัปเดตพร้อมเหตุผล
            - ไฟล์ vbs มีสำเนา 2 ที่ (setup-machine self-contained + lib.mjs ฝั่ง HUB) — ใส่คอมเมนต์ "ฝาแฝด" ทั้งสองฝั่ง แก้ที่ไหนแก้อีกที่ด้วย
            - รอพิสูจน์บนเครื่องจริง: รัน INSTALL.cmd ซ้ำที่เครื่อง 2 จากโฟลเดอร์เดิม (token ตรงกับ .env อยู่แล้ว ไม่ต้อง --force) ควรเห็นขั้น "เริ่ม runner ให้แล้ว (แบบไม่เด้งหน้าต่าง)" และ heartbeat ต่อเนื่องโดยไม่ต้องกด run-runner.cmd — ระวัง: runner ที่รันอยู่ตอนนี้ทำให้ตัวใหม่ "ข้าม" ตาม guard (ถูกต้อง) จึงควรทดสอบเมื่อ runner ยังไม่ถูกเปิด หรือหลังรีบูต
        · **เจอจริงจากรอบติดตั้ง 28/10/69** (แก้แล้วตามข้อบน): runner**ยังไม่ถูกสตาร์ททันทีในรอบติดตั้ง** — มีแค่ heartbeat พิสูจน์ token ของตัวติดตั้ง (16:59:25) แล้วเงียบ เพราะ task เป็น `/SC ONLOGON` (ยิงเฉพาะตอนล็อกอิน) ⇒ ตอนนั้นต้องรีบูต/ดับเบิลคลิก `run-runner.cmd` เอง
        · แก้ความเข้าใจ: label "online" ค้าง **ไม่ใช่งานค้าง** — backend ตัดตามอายุ heartbeat แล้วตั้งแต่ 11/10 (`effectiveMachineStatus` · `MACHINE_STALE_MS=90s` · โชว์ `stale_sec` ใน list) ค่า "online" ที่เห็นใน DB คือค่าดิบที่ไม่มีใครแสดงตรง ๆ — หน้าเว็บ/doctor ใช้ค่าที่คำนวณแล้วเสมอ
        · **เชื่อมสาย executors ถึง .env เครื่องลูก เสร็จ 29/10/69** (`d60e3b4` บน main · red-first: 1 fail (pack-install-plan) + 2 fail (agent-pack) exit 1 ก่อน → เขียว 8/8 + 37/37 · เพื่อนบ้าน 6 ไฟล์ 139/140 (1 skipped) exit 0 · verify 6/6 14.9 นาที) — ปิดช่องว่างที่เจอตอนเตรียม "ชุด dev":
            - เดิม `--executors=echo,opencode` เปิดฝั่ง token ที่ HUB แต่ `install-plan.json` ไม่มี field executors และ CLI ของ setup-machine ไม่ส่งต่อ ⇒ เครื่องลูกเขียน `ENABLED_EXECUTORS=echo` เสมอ สั่งงาน dev ไม่ได้เลย
            - สายใหม่: pack → `buildInstallPlan({executors})` → `install-plan.json.executors` → setup-machine `readPlanExecutors()` (ทน BOM · อ่านไม่ได้คืนค่าว่าง) → `.env` · ลำดับ **CLI `--executors=` > ชุดแพ็ก > echo** · ค่าว่าง = ไม่เขียน field (ชุดเก่าไม่เปลี่ยนพฤติกรรม)
            - เทสต์คุม 3 จุด: plan.executors ตามที่แพ็ก · .env มาจาก install-plan โดยไม่ต้องพิมพ์อะไร · CLI รับ `--executors=` ทับได้
        · **ถัดไป: แพ็กชุด dev จริง** `--minimal --force --executors=echo,opencode` ให้เครื่อง 2 (token หมุน → เครื่อง 2 offline จนติดตั้งชุดใหม่ — เจ้าของอนุมัติ 29/10/69) · เครื่อง 2 ต้อง `npm install -g opencode-ai` ก่อน (HUB ใช้ 1.18.34) แล้วคลิกขวา SETUP-MACHINE.cmd → Run as administrator ครั้งเดียว
        · **แพ็กชุด dev จริงแล้ว 29/10/69** (exit 0): ชุด `dist-machine-setup\คอมเครื่องที่ 2` ใหม่ — install-plan.executors=`echo,opencode` · token หมุนแถวเดิม (64 hex · DB ยัง 2 แถว · executors `["echo","opencode"]`) · ชุดอัปเดต `c964fe38762a` (25 ไฟล์) เผยแพร่แล้ว · hub_url gate ผ่าน (HTTP 200)
            - หมายเหตุถ้อยคำ: รายงานแพ็กขึ้น "แถวเดิมแต่ยังไม่เคยออนไลน์" แม้เครื่องเคย heartbeat — ข้อความ branch `reused` เขียนกว้างเกินจริง (พฤติกรรมถูก: --force หมุนแถวเดิม) เก็บไว้แก้ถ้อยคำรอบหน้า
            - รอเจ้าของ: ก็อปชุดใหม่ → เครื่อง 2 `npm install -g opencode-ai` → SETUP-MACHINE.cmd (admin) → ตรวจ online + ลองงาน echo/opencode
            - **เครื่อง 2 กลับออนไลน์แล้ว 29/10/69 16:52** (เวลาไทย): เจ้าของก็อปชุด + รัน SETUP-MACHINE (admin) ครั้งเดียว → heartbeat ต่อเนื่องทุก ~15 วิ · executors `["echo","opencode"]` · `jobs/pull` + `update/manifest` 200 — เหลือทดสอบงาน echo (ทำได้ทันที) และ opencode (รอ `npm install -g opencode-ai` ที่เครื่อง 2 โหลดเสร็จ)
            - **พิสูจน์งาน echo ครบวงจรแล้ว 29/10/69**: ยิง `POST /api/agent-machines/jobs` (executor echo) → queued→running→**done ใน ~4 วิ** · exit 0 · result `[คอมเครื่องที่ 2] echo: สวัสดีจาก HUB — ทดสอบท่อคำสั่ง 1-2-3 (เดโม)` — ท่อ HUB→คิว→เครื่องลูก→ผลกลับ ใช้ได้จริง · เหลือ: งาน opencode (รอ CLI ที่เครื่อง 2)
            - **เจอบั๊กงานค้าง 29/10/69 (แก้แล้ว รอ deploy)**: งาน opencode ค้าง 13+ นาที ไม่จบ — พิสูจน์ด้วยมือบน HUB: `opencode run` อ่าน stdin จน EOF เมื่อ stdin ไม่ใช่ TTY ⇒ runner spawn แบบ pipe เปิดค้าง = รอตลอดไปจน timeout 30 นาที · และระหว่างงาน runner ไม่ heartbeat (loop เป็น heartbeat→pull→await งาน) ⇒ HUB เห็นเครื่อง offline ระหว่างทำงาน
                - แก้: `runJob` spawn `stdio:['ignore','pipe','pipe']` + `windowsHide` + seam `spawnImpl` · `pollOnce` มี heartbeat interval ระหว่างงาน (heartbeatSec) · red-first: 2 fails exit 1 → 23/23 เขียว · suite runner 131/134 (3 skipped) exit 0
                - ช่องว่างเกต: `npm run verify` รันแค่ `tools/test/**` ไม่รวม `sovereign-os/agent-runner/test/*.test.mjs` — บั๊กนี้จะไม่ถูกจับโดยเกตกลาง (บันทึกไว้พิจารณาเพิ่ม step)
                - เครื่อง 2 ต้องรับโค้ดใหม่: รีบูต (หรือ kill opencode + restart runner) → self-update 30 วิหลังบูตดึงชุดใหม่ → ยิงงานซ้ำ
                - เผยแพร่ชุด `d26dc25b0276` (25 ไฟล์) แล้ว 29/10/69 · งานค้างเดิม timeout เองที่ 30 นาที (`หมดเวลา 1800000ms`) เครื่องกลับ online — รอเจ้าของรีบูตเครื่อง 2 เพื่อรับโค้ดใหม่ (พิสูจน์ task ซ่อนหน้าต่างตอนล็อกอินด้วย)
            - **กับดัก 2 ข้อที่เจอตอนติดตั้งจริง 29/10/69 (เครื่อง 2 ไม่ได้รับโค้ดใหม่ทั้งที่รีบูตแล้ว)**
                - **fleet rollout policy 404 เงียบ ๆ**: `GET /update/manifest` ตอบ **404 `rollout_hold`** เพราะเครื่องถูก override ไป channel `canary` (rollout 5%) ตั้งแต่ตอนเทสต์ติดตั้ง (09:54 UTC) — runner ตีความ 404 = "ไม่มีชุดใหม่" ⇒ ไม่มีใครรู้ว่าโค้ดใหม่ถูกบล็อก · กติกา: หลังติดตั้งเครื่องใหม่/เทสต์ fleet ต้องเคลียร์ override ให้เป็น `stable` (หรือลบทิ้ง) — ตรวจด้วย `SELECT machine_id, channel FROM fleet_machine_overrides;` · แก้ผ่าน API `PUT /api/fleet/machines/:id {channel:'stable'}` (มี audit `FLEET_MACHINE_POLICY_UPDATE`) ไม่ใช่แก้ DB ตรง
                - **task เป็น `/SC ONLOGON`**: รีบูตแล้วเครื่องจะยังเงียบจนกว่าจะมีคนล็อกอิน Windows — heartbeat ไม่กลับมา · ระหว่างแก้ปัญหา ให้ดูช่องว่าง heartbeat ใน log HUB (`docker logs --since 3h sovereign-core-api`) แทนการเดา
                - **ยังไม่มี stale-job reaper**: งานที่ runner ตายกลางทาง (kill/รีบูต/ค้าง) ค้างสถานะ `running` ตลอดไป — `cancel` API ปฏิเสธงานที่รันอยู่ (409) และ pull คืนแค่ `queued` ⇒ ต้องเติม reaper ฝั่ง HUB (งานค้างเกิน N นาที + heartbeat ขาด = mark error) + เพดานเวลาฝั่ง DB
                - **ตัวเฝ้าอัตโนมัติชั่วคราว**: `.freebuff/wait-for-update-then-run.mjs` (รอ `update/manifest` = 200 → ยิงงาน opencode เอง) · ลบเมื่อจบงาน
                - **บั๊ก "timeout แล้วฆ่าไม่จริง" (แก้ 30/10/69)**: `child.kill()` บน Windows ฆ่าแค่ `cmd.exe` ที่ห่อคำสั่ง ⇒ `opencode.exe` รอดชีวิตและกิน CPU ค้างต่อ (เจอจริง: งาน timeout 21:31 แต่ opencode ยังหนักถึง 00:29+) · แก้เป็น `killProcessTree()` = `taskkill /pid <pid> /T /F` บน Windows, `SIGKILL` บน POSIX + seam `killTreeImpl` · red-first: import ไม่มี (SyntaxError) → 26/26 เขียว · suite 134/137 (3 skipped) exit 0
                - **ข้อเสนอ (ยังไม่ทำ)**: ให้ `jobs/pull` (ทุก 15 วิ) แนบสัญญาณ `updateAvailable` จาก HUB ⇒ runner สั่ง `selfUpdateOnce` ได้ทันที ไม่ต้องรอรอบ 6 ชม. หรือรีสตาร์ทเครื่อง · แก้ทั้ง core-api (แนบ field) + runner (อ่าน field) พร้อมเทสต์
                - **เผยแพร่ชุด `9c0bb18e17a8` (25 ไฟล์) 30/10/69** — รวม 3 บั๊ก: stdin EOF · heartbeat ระหว่างงาน · kill process tree ตอน timeout · ยืนยันฝั่ง HUB: `GATE allowed:true stable 100%` + `MANIFEST ok version=9c0bb18e17a8`
                - **หลักฐานว่าด่านผ่านแล้วจริง**: 19:01:18 UTC เครื่อง 2 เรียก `GET /update/manifest` ได้ **200** (ก่อนแก้ได้ 404 rollout_hold ทุกครั้ง) — แต่ยังไม่เห็น `update/file` ตามมา และ heartbeat ขาดตั้งแต่ 19:01:07 ⇒ เครื่องถูกปิด/สลีปหรือ runner ตายก่อนดาวน์โหลด (ต้องดู log ที่เครื่อง 2: `%LOCALAPPDATA%`/โฟลเดอร์คิต `.runner-update-state.json`, `.runner-rejected.json`)
                - **❌ ข้อสันนิษฐานข้างบนผิด — ต้นเหตุจริง (30/10/69 02:45)**: `applyUpdate()` เรียก `assertSafeRel()` ตรวจ **รายชื่อไฟล์ทั้งชุดก่อนดึงไฟล์แรก** แต่ `ALLOWED` ใน `selfUpdate.mjs` ไม่มี 5 ไฟล์ที่ `bundleFiles()` เพิ่มเข้ามาทีหลัง — `install-plan.mjs` · `modules.mjs` · `INSTALL.cmd` · `doctor.mjs` · `INSTALL-CHECK.cmd` ⇒ โยน `ชื่อไฟล์ในชุดอัปเดตไม่ถูกต้อง (path): install-plan.mjs` **ทันที** ⇒ manifest 200 แต่ `update/file` = 0 ตลอด (พิสูจน์ offline: เรียก `applyUpdate` ด้วย manifest จริง → THROW, `fetchFile` ถูกเรียก **0 ครั้ง** — ตรงกับ log HUB เป๊ะ) · เงียบสนิทเพราะ log อยู่ใน console ที่ไม่มีใครเปิดดู
                - **แก้แล้ว**: (1) `UPDATE_ALLOWED_PATTERN` + `isAllowedUpdatePath()` (export) ใน `selfUpdate.mjs` — เพิ่ม 5 ไฟล์นั้น (2) `publishUpdateBundle` ตรวจทุกไฟล์กับ allowlist **ก่อน** เขียน manifest (เผยแพร่ชุดที่เครื่องลูกจะปฏิเสธไม่ได้อีก) + พารามิเตอร์ `excludePaths` สำหรับ "ก้าวแรก" ของเครื่องรุ่นเก่า (3) เทสต์ใหม่ `tools/test/update-bundle-allowlist.test.mjs` — red-first: import ไม่มี (SyntaxError, exit 1) → **5/5 เขียว** · runner suite 134/137 (3 skipped) exit 0
                - **ก้าวแรก (transitional)**: ต้องเผยแพร่ชุดที่ **ตัด 5 ไฟล์ติดตั้งออก** (20 ไฟล์) เพราะ allowlist ฝั่งเครื่อง 2 ยังเป็นรุ่นเก่า ⇒ รับได้แน่นอน → ได้ `selfUpdate.mjs` ใหม่ (allowlist กว้าง) → รอบถัดไปค่อยเผยแพร่ชุดเต็ม 25 ไฟล์
                - **ค้างไว้**: คิต `dist-machine-setup/คอมเครื่องที่ 2` ยังเป็นรุ่นเก่า (c964fe38762a) — ต้อง rebuild ก่อนแจกเครื่องใหม่ · งานค้าง `7f95a60b-12ab-45e1-b77b-8a7e833cf346` ค้าง `running` มากับ **29 วัน** (หลักฐานว่า stale-job reaper จำเป็นจริง)
                - **✅ D5 พิสูจน์ครบวงจร (30/10/69 03:01 น.)**: เผยแพร่ชุด transitional **`42a2a60d8364`** (20 ไฟล์) → เครื่อง 2 เรียก `update/file` **20 ครั้งแรกในประวัติ** → ติดตั้ง + รีสตาร์ทตัวเอง → งาน `55ddc2d5-b8f4-4980-9aa5-a810224e33d6` (executor=`opencode`) **done · exit 0 · ~23 วิ** ตอบ `OK` · heartbeat ระหว่างงานอายุ 7–17 วิ (พิสูจน์ heartbeat fix) · ไม่มี `opencode.exe` ค้างกิน CPU
                - **บทเรียนที่ล็อกไว้**: `update/manifest` = 200 **ไม่พอ** — ตัวเฝ้าต้องนับ `update/file` จริงก่อนยิงงาน (รอบก่อนยิงงานทันทีที่เห็น manifest 200 ⇒ งานไปรันบนโค้ดเก่าแล้วค้าง 30 นาที) · ตัวเฝ้ารอบนี้ `.freebuff/wait-update-then-run2.mjs` ทำแบบนั้นแล้ว
                - **ยังค้าง (ไม่บล็อก D5)**: ชุดเต็ม 25 ไฟล์ยังไม่เผยแพร่ (รอบ publish ปกติถัดไปจะได้ 25 ไฟล์ เพราะเครื่องมี allowlist ใหม่แล้ว) · คิต `dist-machine-setup` ยังเก่า · งานค้าง `675af7cb` (ทดสอบของผม) + `7f95a60b` (29 วัน) ยัง `running` · เครื่องซ้ำ "เครื่องทำเว็บ" + token ที่พิมพ์ในแชท
- [x] **D3 ใช้ doctor เป็น preflight ของ HUB installer** — **เสร็จ 27/10/69**
      `tools/install/install.mjs` เรียก `runDoctor({ profile: 'hub' })` ใน preflight แล้ว
      - ตรวจชุดเดียวกับ INSTALL-CHECK: Node · compose + `sovereign.env.template` · สิทธิ์เขียน · ดิสก์ · Docker · env ของ stack เดิม
      - **Docker ของเครื่องแม่ = fail** (ขาดไม่ได้ เพราะต้องรัน DB+เว็บ) ต่างจากเครื่องลูกที่แค่ warn
      - `allowCommands: !dryRun` ⇒ `--dry-run` ยังบริสุทธิ์: **ไม่ exec / ไม่ยิงเน็ต / ไม่เขียนไฟล์ทดสอบ**
      - ข้อความ/hint มาจากชุดเดียวกัน ⇒ คนติดตั้งเห็นภาษาเดียวกันทั้งสองเส้นทาง
- [x] **D4 ให้ doctor ตรวจ "หลังติดตั้ง" ลึกขึ้น** — **เสร็จ 27/10/69**
      `node tools\agent-pack\doctor.mjs --post` (หรือ `INSTALL-CHECK.cmd --post`)
      - **autostart task**: `schtasks /query /tn "Sovereign Agent Runner"` — ไม่มี = fail (รีบูตแล้วเครื่องหลุดจาก HUB)
      - **runner process**: PowerShell CIM `Win32_Process` จับ `node.exe` ที่ CommandLine มี `agent-runner…main.mjs` → รายงาน PID
      - **heartbeat ถึง HUB**: POST 1 ครั้ง อ่าน `{ machine: { name, last_heartbeat } }` → พิสูจน์ token + DB + เวลา
      - เทสต์ `tools/test/doctor.test.mjs` **41/41** · mutation พิสูจน์ 3 แบบ: ถอดการกัน dry-run = **exit 1** · ปิดการตรวจหลังติดตั้ง = **exit 1** · ลด Docker ของเครื่องแม่เป็น warn = **exit 1**

- [x] **B idempotency กลาง — "เน็ตหลุดก็ขายได้"** — **โค้ด + tests แล้ว 27/10/69** (`docs/IDEMPOTENCY.md`)
  - ตาราง `idempotency_keys` (scope + key + fingerprint + ผล 2xx + TTL) · middleware `idempotent(scope)` · config `IDEMPOTENCY*`
  - **ไม่ส่ง header = ผ่านปกติ ไม่เขียนตาราง** (client เก่าไม่พัง) · คีย์เดิม + payload เดิม = ตอบผลเดิม (`Idempotency-Replayed: true`)
  - คีย์เดิม + payload ต่าง / คนละผู้ใช้ = **409** · คำขอแรกยังไม่จบ = **409 + Retry-After** · 4xx/5xx = ไม่แคช (ลองใหม่ได้)
  - **fail-open เมื่อตารางยังไม่มี (P2021)** ⇒ deploy โค้ดก่อน migrate ได้ · DB ล่มจริง = **503** (ไม่ยอมให้ทำเงินซ้ำ)
  - ต่อ 4 endpoint: `business.order` · `business.payment` · `restaurant.order` · `restaurant.purchase` (หลัง `authenticate`/`requireRole`)
  - frontend: `newIdempotencyKey()` + `authFetch` แนบให้ทุก POST/PUT/PATCH/DELETE (caller ตั้งเองได้) · คิวออฟไลน์เก็บ header ไว้ replay
  - เทสต์: backend `tests/idempotency.test.ts` **22/22** · `tools/test/idempotency-migration.test.mjs` 14 · `tools/test/idempotency-wiring.test.mjs` 10
  - mutation พิสูจน์แล้ว (exit 1 ทั้งหมด): ถอด `idempotent()` ออกจาก route · สลับก่อน `requireRole` · `authFetch` ทับคีย์ caller · แก้ชื่อคอลัมน์ migration
  - [x] apply migration `20261027120000_idempotency_keys` + restart core-api — **เสร็จ 28/10/69**
        backup `backups/postgres/sovereign_20261028_001831.dump` (6.1 MB) → migrate deploy (67/67 up to date) →
        restart healthy 27 วิ · `/api/health` `migrationHead=20261027120000_idempotency_keys` · restarts=0
        - ซ้อม SQL ใน scratch schema ก่อน (unique กันแถวซ้ำได้จริง) แล้ว DROP ทิ้ง
        - smoke 8/8: คีย์ผิดรูปแบบ = 400 `IDEMPOTENCY_INVALID_KEY` · ไม่ส่งคีย์ = 400 เดิม ·
          replay บนตารางจริง = handler รันครั้งเดียว + `Idempotency-Replayed: true` · payload ต่าง = 409 ·
          เก็บกวาดแล้วเหลือ 0 แถว · log ไม่มี "table ... is missing"
  - [x] deploy frontend ให้เบราว์เซอร์ส่งคีย์จริง — **เสร็จ 28/10/69 11:18**
        build ใหม่ `R5T_mlyuNUkW18UpSCGuM` (`.next-verify` ที่ผ่าน verify) แทน build เก่า `9tdx3EoGEaS8w4byISX5h`
        - ซ้อมก่อนบนพอร์ต 3099 (`NEXT_DIST_DIR=.next-verify`): `/` 200 ไบต์เท่ากับ prod · chunk ที่มี header 200 (บน :3000 ยัง 404)
        - สลับแล้ว regen `public/sw-precache.json` (157 asset) · boot ขึ้นใน ~1 วิ · `logs/frontend-restart.log`
        - smoke: static asset ที่ `/` อ้าง 12/12 = 200 · chunk `3pr0dgpzmk4ac.js` 200 + มี `x-idempotency-key` ·
          `/mbti/` `/dashboard/` `/business/` `/settings/` `/inventory/` = 200 · `/about` `/partners` ฯลฯ = 404 มาก่อนแล้วทั้ง 2 build
        - rollback: build เก่าอยู่ที่ `logs/next-backup-20261028_111819` (สลับกลับ + boot ~20 วิ)
  - [x] push ขึ้น GitHub — **เสร็จแล้ว 03/11/69** (`3529d2e`)
## ประเภทธุรกิจ "ขายซอฟต์แวร์เป็นโปรเจ็ก" + แก้บั๊กคิวเอเจนต์ (30/10/69) — branch `ai/prompt-stdin-final-answer`

- [x] **ประเภทธุรกิจใหม่ `SOFTWARE_PROJECT`** — เปลี่ยนยุทธศาสตร์ตามเจ้าของ: ขาย Source Code / Blueprint / License ให้นักพัฒนา/เอเจนซี
  - `Business.bizType` ใหม่ + ตัวเลือกในหน้า `/business` (💻 ขายซอฟต์แวร์เป็นโปรเจ็ก) พร้อมคำอธิบายตอนเลือก
  - สร้างธุรกิจปุ๊บได้ **แคตตาล็อกดิจิทัล 4 ชุด** อัตโนมัติ: `SW-TAX-CORE` 1,900 · `SW-BIZ-OS` 11,900 · `SW-IOT-FW` 2,500 · `SW-ARCH-BOOK` 1,290
    (ราคาอยู่ในช่วงที่เจ้าของกำหนด · `stockQty=9999` เพราะสินค้าดิจิทัลไม่มีสต็อกจริง ต้องออกออเดอร์ได้ไม่จำกัด)
  - ได้ **ผู้ช่วย AI สายเทคนิค 5 คน**: `presales` · `license_advisor` · `docs_writer` · `delivery_qa` · `accountant` (ไม่ใช้ชุด IoT เดิม)
  - ตรรกะแยกไฟล์ `business-software.service.ts` เพราะ `business.service.ts` มี 877 บรรทัด เกินเพดาน 800 ของ arch-gate (แตะไฟล์เดิม = file-budget fail)
  - UI สินค้าแสดง "ดิจิทัล · ไม่จำกัด" แทน "สต็อก 9999" สำหรับหมวด `SOFTWARE`
  - เทสต์: `businessSoftware.test.ts` (presets + seed idempotent) + route test ใน `businessPlatform.test.ts` — **26/26** (exit 0)
- [x] **บั๊กคิวเอเจนต์จากการใช้งานจริงครั้งแรก (เครื่อง 2)**
  - **prompt หลายบรรทัดถูกตัดเหลือบรรทัดแรก**: `shell:true` บน Windows ต่อ args ด้วย space ดิบ ⇒ ย้าย prompt ไปทาง **stdin** แล้ว `end()` ทันที
    (opencode อ่าน stdin จน EOF — ยืนยันจาก binary: `process.stdin.isTTY ? undefined : await Bun.stdin.text()`)
  - **`result` แสดง JSON ดิบ/ข้อความเริ่มงาน**: `parseOpencodeOutput` อ่าน `ev.text` แต่รูปแบบจริงคือ `ev.part.text` ⇒ อ่านถูกจุด + เลือก **คำตอบสุดท้าย** (messageID ล่าสุด รวมทุก part)
  - เทสต์ red-first: 3 fails exit 1 → **29/29** (`runner.test.mjs`) · suite runner **157 ผ่าน · 3 ข้าม** exit 0
- [x] **เผยแพร่ชุดอัปเดตเต็ม 25 ไฟล์** — version `88b09635891b` (เซ็น `fleet-update-v1` · ตรวจลายเซ็นด้วย trust anchor ของ runner ผ่าน)
  - คอนเทนเนอร์ `sovereign-core-api` เห็น manifest ใหม่ทันที (mount `data/` · อ่านต่อ request ไม่ต้องรีสตาร์ท)
- [ ] พิสูจน์เครื่อง 2 อัปเดต + งาน multi-line จริง — **รอเครื่อง 2 เปิด** (heartbeat ล่าสุด 29/10/69 20:24 UTC) · runner เช็คอัปเดตใน ~30 วิหลังบูต
- [ ] **รอไฟเขียวเจ้าของ**: รีสตาร์ท `sovereign-core-api` (ให้โค้ดประเภทธุรกิจใหม่มีผล) + rebuild frontend (ให้ปุ่มใหม่แสดงบน :3000)

## Runner เปิดเองตอนบูต + ทางเข้าควบคุมเครื่อง 2 + ชุด prompt ขาย Source Code (31/10/69) — branch `ai/sell-source-code-prompt`

- [x] **Runner ติดตั้ง autostart ให้ตัวเองทุกครั้งที่บูต** (`66e62a3`)
  - `src/autostart.mjs`: เขียน `autostart-hidden.vbs` เป็น **UTF-16LE + BOM** (path ไทย/ยูนิโค้ดถ้าเป็น UTF-8 จะเปิดไม่ขึ้นเงียบ ๆ) + วาง pointer ใน Startup folder + พยายามสร้าง Scheduled Task ONLOGON (ล้มได้ ไม่ทำให้ runner ล้ม)
  - เปิด/ปิดด้วย `AUTOSTART=true|false` ใน `.env` · `doctor.mjs` ยอมรับ autostart ทาง Startup folder (ไม่ fail เมื่อไม่มี Scheduled Task)
  - เทสต์ 11/11 (`test/autostart.test.mjs`) — เริ่มแดง (exit -1 module not found) → เขียว · suite runner 171 tests: **168 pass · 3 skipped · 0 fail**
  - พิสูจน์จริงด้วย `wscript` บน path ที่มีเว้นวรรค: `WSCRIPT_STATUS=0` · `MARKER_EXISTS=true`
- [x] **ทางเข้าควบคุมเครื่อง 2** (`61ba503`, `a22e656`, `81dd0de`)
  - ปุ่ม "ควบคุมเครื่อง 2" บน `/agent-queue` + เมนู tray ของเดสก์ท็อป → `/machine-console`
  - แยกแท็บ "สิทธิ์ควบคุม" เป็น `components/machine-console/AccessPanel.tsx` เพราะ `machine-console.tsx` เดิม 829 บรรทัด เกินเพดาน 800 → 733
  - `tsc --noEmit` exit 0 · `npm run verify` ผ่าน exit 0 (tools tests 105/105)
- [x] **ชุด prompt ส่งงานเอเจนต์สำหรับขาย Source Code** — `docs/SELL-SOURCE-CODE-AGENT-PROMPT.md`
  - สถานะ platform ที่ตรวจจริง 31/10: GitHub/Stripe/Telegram/Cloudflare/Docker **มีแล้ว** · **Lemon Squeezy ยังไม่มี (ต้องสมัคร)** · SMTP ยังไม่มี
  - บันทึกของจริง: **ไม่มีหน้าร้าน · ไม่มีระบบ license/activation/download · ไม่มีธุรกิจ `SOFTWARE_PROJECT` ใน DB** (มีแค่ 3 SKU เก่า `SW-DEMO`/`SW-INVENTORY`/`SW-TRACE`)
  - MASTER PROMPT 5 phase + sub-prompt 4 ตัว + ตารางแบ่งงานเอเจนต์ + Definition of Done
- [ ] **เครื่อง 2 ต้องเปิด runner ด้วยมือ 1 ครั้ง** — heartbeat หยุดตั้งแต่ 30/10 11:47 UTC → สั่ง `update.apply` ระยะไกลไม่ได้ · หลังเปิด ~1 นาทีจะได้ชุด `90f18cf3dc85` และขึ้น "เปิดเองตอนล็อกอิน=installed"
- [x] **rebuild frontend** — build ใหม่ `hIaUYWqzABWgRry505iMm` (02/11/69 03:37) · `:3000` ตอบ 200 · chunk Social Studio ถูกเสิร์ฟจริง (`0vad7s8ns0482`) · ครบทั้งแท็บ "สิทธิ์ควบคุม" และ Social Studio
- [ ] **Pairing 6 หลัก** — ยังไม่ได้ทำ (ต้องพิมพ์รหัสบนเครื่อง 2 จริง)
- [x] **i18n Social Studio คุมครบ th/en** — **เสร็จ 03/11/69** (commit `cfa5866`)
      - พจนานุกรมใหม่ `i18n/{th,en}/pages/ecosystem.ts` + index เชื่อมทั้งสองภาษา
      - แก้ต้นเหตุจากงานค้าง: TextStudio/ClipStudio/PostHistory เรียกคีย์ไม่มีพรีฟิกซ์ `ecosystem.` ⇒ en resolve ไม่ได้ตลอด — เติมพรีฟิกซ์ครบ 32 จุด
      - SocialStudio เลิก hard-code ไทย (ยังใช้ `t()` + คีย badge ใหม่ `badgeFb/badgeFbNone/badgeClip/badgeClipNone` พร้อม `{n}`)
      - gate `social-post.test.mjs`: อนุญาต import `stores/` (โฟลเดอร์กลางชั้นเดียวกับ lib/ui) + เพิ่มด่านคุมว่าคีย์ t() ต้องมีพรีฟิกซ์ `ecosystem.` — mutation พิสูจน์: ถอดพรีฟิกซ์ 1 จุด = **exit 1** กลับเขียว 64/64
      - ยืนยัน: `tsc --noEmit` exit 0 · `youtube-bridge.test.mjs` exit 0

- [x] push GitHub — **เสร็จแล้ว 03/11/69** (อนุญาตในคำสั่ง "push GitHub / stale-job reaper / พัฒนาต่อ")

## Social Studio ใน Ecosystem + ปิดบั๊ก runner เปิดซ้อน (02/11/69) — branch `ai/social-studio`

- [x] **ย้ายงานโพสต์ออกจาก "ธุรกิจของฉัน" → Ecosystem → แท็บ "สตูดิโอโพสต์"**
  - `components/business/post/*` → `components/ecosystem/studio/*` (อยู่กลุ่ม `ecosystem` เดียวกัน — ผ่าน import-layers)
  - ลบแท็บ `📣 โพสต์` ออกจาก `TABS` ของธุรกิจ + ถอด `PostHub` เดิม
  - แยก 2 งานชัดเจน: **โพสต์ข้อความ → Facebook** (`TextStudio`) กับ **ลงคลิป → YouTube/IG/TikTok/Facebook** (`ClipStudio`)
  - บัญชีที่แสดง = `loginId` (อีเมล) จาก `user_ecosystem_accounts` — ไม่ต้องล็อกอินซ้ำ · การ์ดที่ยังไม่มีบัญชีเปิดฟอร์มเพิ่มพร้อมเลือก platform ให้
  - Facebook ไม่มี API ให้แอปบุคคลทั่วไปโพสต์แทน → แอปเตรียม/คัดลอกข้อความ + เปิดหน้า Facebook และบอกผู้ใช้ตรง ๆ
  - YouTube ยังอัปโหลดอัตโนมัติผ่าน OAuth เดิม (ค่าเริ่มต้น `private`)
  - เทสต์: `social-post.test.mjs` **63/63** (เพิ่ม `studio-model` + โครงหน้า) · `youtube-bridge.test.mjs` อัปเดต path หลังย้ายโฟลเดอร์ · `tsc --noEmit` exit 0
- [x] **ปิดบั๊ก runner เปิดซ้อน + tools test ค้าง** (`8be59bd`, `61f8b40`, `5b52f15`)
  - single-instance lock ต่อเครื่อง + autostart ทางเดียว + long-poll ซ้อนได้
  - `setup-node.mjs` ส่งต่อ `dockerWaitMs` (เทสต์ไม่นอน 10 นาที) + `buildRunnerEnv` เขียน `SINGLE_INSTANCE_PORT`
  - `ecosystem.tsx` await `openExternal` + เทสต์ `sovereign:openUserLink`
- [x] **rebuild frontend** — เจ้าของอนุมัติแล้ว · build `hIaUYWqzABWgRry505iMm` (03:37) · `next start` PID 3416 ตอบ 200 · chunk Social Studio ถูกเสิร์ฟจริง (`0vad7s8ns0482`)
- [x] **เผยแพร่ runner update bundle + restart `sovereign-core-api`** — version `1cd408915f8d` (27 ไฟล์ · เซ็น `fleet-update-v1`) · container healthy · `/api/health` = 200

## Ecosystem hardening + ประวัติการโพสต์ (02/11/69) — branch `ai/ecosystem-hardening`

- [x] **P0: จำกัด `reveal` 10 ครั้ง/นาที ต่อผู้ใช้**
  - `revealLimiter` ใน `ecosystem.routes.ts` (backoff + keyBy user) · ครั้งที่ 11 = `429` + `Retry-After`
  - audit `ECOSYSTEM_REVEAL_RATE_LIMITED` (ไม่เก็บรหัสผ่าน) · เทสต์ `ecosystem.test.ts` **27/27**
- [x] **P0: ด่านตรวจ/สำรองกุญแจ `field-crypto.key`**
  - `tools/verify/crypto-key-check.mjs` (`--json` / `--backup` / `--to`) + เทสต์ **9/9**
  - ตรวจจริง: key 32 ไบต์ · fingerprint `4dc0f1f5b948bf2d` · ข้อมูล `enc:v1:` 13 รายการ
  - สำเนา `backups/keys/field-crypto-20261102-214219.key` (gitignored — ต้องย้ายไปเก็บนอกเครื่องเอง)
- [x] **ประวัติการโพสต์ + สถานะต่อแพลตฟอร์ม (DB)**
  - ตาราง `social_posts` / `social_post_targets` (เจ้าของ: ecosystem) + migration `20261102120000_add_social_posts`
  - `social-history.service.ts` + `social-history.routes.ts` ใต้ `/api/ecosystem/social/posts` (GET/POST/PATCH target/DELETE)
  - UI: แท็บที่ 3 “ประวัติการโพสต์” (`PostHistory.tsx`) + ปุ่ม “บันทึกงานนี้ลงประวัติ” ใน `TextStudio`/`ClipStudio`
  - เทสต์ backend `social-history.test.ts` **15/15** · wiring `social-history-wiring.test.mjs` **7/7**
  - `tools/module-owners.json` ประกาศ `social_posts`/`social_post_targets`/`social-history.service` → ecosystem
- [x] apply migration `20261102120000_add_social_posts` บน production + restart `sovereign-core-api` — **เสร็จ 03/11/69**
      - ยอมรับตามตรง: deploy ก่อนแคร์ backup มือ (สั่งงานรอบนี้พร้อมกัน) — โชคช่วย draw ที่ dump รายวิของ 03:00 (`sovereign_20261102_030002.dump`) คือ before-state อยู่แล้ว + ม.น. additive table (ไม่พิมพ์แตะแถวเดิม)
      - ตรวจบน DB จริง: ตาราง `social_posts` + `social_post_targets` มี · migration record finished ไม่ rollback
      - dump หลังสถานะใหม่: `backups/postgres/sovereign_20261102_235032_post-social-posts.dump` (44 MB)
      - restart `sovereign-core-api` 50 วิ healthy · `/api/health` `migrationHead=20261102120000_add_social_posts` · `/api/ecosystem/social/posts` = 401 (401 กันสิทธิ์ถูกต้อง)
- [x] rebuild frontend ให้แท็บ/ปุ่มใหม่ขึ้น `:3000` — **เสร็จ 03/11/69** (อนุญาตในคำสั่ง "ทำต่อจากเดิม พร้อมปรับปรุงโปรเจ็กให้ดีขึ้น")
      - build ใหม่ `N6KKs3a_3jLSOF-L-8lek` (BUILD_ID 23:52) · `next start` :3000 ตอบ 200 ทั้ง `/` และ `/ecosystem/`
      - chunk Social Studio ใหม่ถูกเสิร์ฟจริง `:3000/_next/static/chunks/1wumzn46bphb6.js` = 200 (ตรวจหาข้อความ badge th ใน chunk)
- [x] push GitHub — **เสร็จแล้ว 03/11/69** (`3529d2e`)
- [x] stale-job reaper ฝั่ง HUB — **เสร็จ 03/11/69** (`496bbf9`)
  - `reapStaleJobs()` ใน `agent-machines.service.ts`: งาน `running` ที่ส่งไปเครื่องแล้ว + ค้างเกิน 45 นาที (runner timeout 30) + เครื่องไม่มี heartbeat เกิน 10 นาที → mark `error` พร้อมเหตุผล `reaper: … heartbeat ล่าสุด: …`
  - ต้องครบทั้งสองเงื่อนไข: งานยาวที่เครื่องยังออนไลน์ไม่ถูกตัด และงานที่รันใน process ของ HUB ไม่อยู่ในขอบเขต (ดูแลด้วย `processAgentQueue`) — มีการตรวจ `status !== "running"` ซ้ำในหน่วยความจำกัน mock/where หลุด
  - cron ทุก 5 นาทีใน `workers/start.ts` + แจ้ง Telegram (severity warn, source `reaper`, eventKey กันแจ้งซ้ำ)
  - เทสต์ `tests/agentMachines.test.ts` 6 เคสใหม่ (ทั้งชุด 27/27) รวมเคสเครื่องยัง heartbeat อยู่ และเคส `dispatched_at` ว่าง
  - ตรวจ DB จริงตอนรัน: เก็บได้ 0 รายการ (ไม่มีงานค้างจริง ณ 03/11) — งาน `7f95a60b…` เป็น `error` ตั้งแต่ 29/10 ⇒ reaper ทำหน้าที่เป็นแผงกันล่วงหน้า
- [x] สัญญาณอัปเดตผ่าน `jobs/pull` — **เสร็จ 03/11/69** (`496bbf9`)
  - HUB แนบ header `x-agent-update-version: <manifest.version>` ทุกครั้งที่ `POST /jobs/pull` และมีชุดผ่าน trust — ถ้าไม่มีชุดผ่าน trust ต้องไม่แนบ (runner ไม่เดาเอง)
  - runner ฝั่งเครื่อง: `api()` อ่าน header → `noteHubUpdateVersion()` จำรุ่น, `onIdle` เรียก `selfUpdateOnce` เฉพาะรอบที่จบแบบไม่มี error และไม่มีงานส่งมา
  - เทสต์: `agentMachinesRoutes` 31/31 (เคสมีชุด = header ตรงกับ manifest ที่เซ็นแล้ว, ไม่มีชุด = header null) · `runner.test.mjs` 3 เคสใหม่ (suite exit 0)
  - เหลือพิสูจน์บนเครื่องจริง: เครื่อง 2 ต้องรับโค้ดชุดนี้ผ่าน OTA ปกติก่อน แล้วจึงเห็น `x-agent-update-version` ทำงาน

- [x] ปิดช่องโหว่ชุดติดตั้ง + เริ่ม production สำหรับขาย — **เสร็จบางส่วน 03/11/69** (`df35806`)
  - พบบั๊กตอน repack: กติกาตัด Ollama ดูแค่โฟลเดอร์ `Ollama` ⇒ `sovereign-os/edge-ai/{models,runtime}` หลุดเข้าชุด (แชร์ 1.3 GB จาก 36 MB) — แก้ที่ `tools/build-node-kit.mjs` (`f69e721`) · dry-run เหลือ 2,181 ไฟล์ / 61.4 MB
  - node-kits ทั้งสามเส้นต้องมีสิทธิ์ (401 fail-closed) · ผ่านด้วย machine token หรือรหัสเชิญ · รหัสฝูงตรวจแบบไม่กินโควตา
    - ตัวติดตั้งฝั่งเครื่อง (PowerShell + ตัวสร้างไฟล์เดียว) ส่ง `x-enroll-code` และถามรหัสเมื่อยังไม่มี · **repack + publish แล้ว 03/11/69**: `node-kit-1.1.1.zip` 35.8 MB (sha `3b7dabf9…`) bootstrap 17,520 B (sha `63e8c04c…`) — ไฟล์ที่เสิร์ฟมี header จริง
  - หลักฐาน: เทสต์ 38/38 (แดงก่อนแก้ 3 ข้อ) · tsc 0 · build 0 · restart healthy ~36 วิ · ยิงจริงไม่มีสิทธิ์ = 401 ทั้ง manifest/asset/รหัสผิด
  - หมายเหตุ production: container ยังไม่ได้ตั้ง `MACHINE_ENROLL_CODE` (0 ไบต์) ⇒ เส้นจริงคือรหัสฝูง `enr_…` ใน DB — ถ้าจะใช้รหัสเดิมต้องใส่ env แล้ว recreate
  - เอกสาร go-live: `docs/PRODUCTION-GO-LIVE.md` (นิยามพร้อมขาย 5 ข้อ + P0 ที่ยังบล็อก)

- [x] PDPA consent + สิทธิ์ลบข้อมูล (backend) — **เสร็จ 03/11/69** (`93e6a85`)
  - ตาราง `user_consents` + `consent_events` (append-only) + `users.deleted_at` · migration `20261103120000_add_user_consents`
  - `GET/PUT /api/consent` · `GET /api/consent/history` · `DELETE /api/consent/account` (ต้องรหัสผ่าน + พิมพ์ DELETE, ผู้ดูแลคนสุดท้ายลบไม่ได้)
  - วัตถุประสงค์จำเป็นปิดไม่ได้, ที่เหลือถอนได้; ลบบัญชี = anonymize ไม่ลบแถว (audit ยังตรวจย้อนหลังได้)
  - เทสต์ `tests/consent.test.ts` 10/10 · tsc 0 · backup `sovereign_20261103_015249.dump` ก่อน migrate · health 200 · `/api/consent` = 401 เมื่อไม่ล็อกอิน

- [x] ปิดช่องโหว่ภายนอกเพิ่ม (03/11/69) — `bc22338`
  - `/api/health/truth` บังคับล็อกอิน (เดิมเปิดสาธารณะ: fingerprint dist + สถานะเกต + ประวัติ nightly) · `/api/health` ยังเปิดให้ watchdog
  - `DELETE /api/consent/account` จำกัด 5 ครั้ง/15 นาที ต่อบัญชี + audit `ACCOUNT_DELETE_RATE_LIMITED` (กันใช้เป็นช่องเดารหัสผ่าน)
  - ตรวจแล้วไม่พบการเสิร์ฟไฟล์ระบบ: `/.env` = 404 · `/backups/` = 404 · CORS ไม่ได้ตั้ง `*` (ค่าเริ่มต้นผูก localhost:3000)
  - นโยบายความเป็นส่วนตัว: `GET /api/consent/policy` + หน้า `/privacy` (th/en) เวอร์ชันเดียวกับหลักฐานยินยอม
  - **เจ้าของต้องเติมก่อนเผยแพร่**: `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTACT_EMAIL`, `PRIVACY_CONTACT_ADDRESS` (หน้าเว็บเตือนถ้ายังว่าง)
  - ทดสอบกับบัญชีจริง: `cd sovereign-os/core-api && node tools/consent-smoke.mjs --confirm` → 15/15 ผ่าน (สร้างบัญชี → API → DB → ลบทิ้ง) · **ตั้งแต่ 03/11/69 ต้องมี `CONSENT_SMOKE_ENV=test` หรือใช้ `tools/consent-smoke-runner.mjs --full --env=test` (ดู P1)**

## สิ่งที่ควรทำต่อ — เรียงตามความเสี่ยง (บันทึก 03/11/69 หลังปิดรอบนโยบาย/PDPA)

### P0 — บล็อกการขายจริง (ทำก่อนเปิดให้คนนอกใช้)
- [x] **บังคับใช้ความยินยอมเป็นด่านจริงก่อนบันทึกข้อมูลอ่อนไหว** — **เสร็จ 03/11/69** (`ai/consent-gate`)
  - ด่านกลาง `services/consent-gate.service.ts` (`checkSensitiveConsent` / `requireConsent`) — ค่าเริ่มต้น = **ไม่ยินยอม** (ไม่มีแถว = 403 `consent_required`), นโยบายเวอร์ชันเก่า = 403 `consent_version_stale`, DB ล่ม = 503 fail-closed
  - ใช้กับข้อมูลสุขภาพทุกเส้นเขียน: `POST /api/health/observations` · `POST /api/health/flags` · `PUT /api/health/profile` (อ่าน/ลบไม่กั้น — สิทธิ์เจ้าของข้อมูล)
  - ผูก `health_consents` เข้ากับ `user_consents`: `PUT /api/health/consents {conversation}` เขียนทั้งสองตาราง · `GET` แสดงค่าจริงจาก PDPA (เดิมโชว์ ON จากค่า default ทั้งที่ยังไม่เคยยินยอม) · แถวเดิมเป็นรายผู้ใช้ (เดิมแถวส่วนกลางรั่วข้ามผู้ใช้)
  - UI ไม่โกหกแล้ว: `health.tsx` + `health/self-check.tsx` ตรวจ `res.ok` ก่อนประกาศสำเร็จ และบอกทางไป `/consent` (เดิม 403 จะขึ้น "บันทึกแล้ว" ทั้งที่ไม่มีอะไรถูกเก็บ)
  - เทสต์: `tests/consentGate.test.ts` **12/12** (แดงก่อนแก้: 201 แทน 403) · `tests/health.routes.test.ts` 15/15 · `tools/test/health-consent-ui.test.mjs` **5/5** (แดง exit 1 เมื่อ stash โค้ดหน้าเว็บ) · arch-gate ผ่าน (ประกาศเจ้าของตาราง `user_consents`/`consent_events` → consent)
  - เอกสาร `docs/modules/health.md` ระบุกติกาด่านไว้แล้ว
- [ ] **เติมข้อมูลผู้ควบคุมข้อมูล (เจ้าของเท่านั้น)** — `PRIVACY_CONTROLLER_NAME`, `PRIVACY_CONTACT_EMAIL`, `PRIVACY_CONTACT_ADDRESS`
  - ตรวจหลังเติม: `/privacy` ต้องไม่ขึ้นป้ายเตือน และ `GET /api/consent/policy` ตอบ `controller` ครบทั้งสามฟิลด์
- [ ] **Revoke bot token เก่า 2 ตัว (เจ้าของเท่านั้น)** — ต้องยืนยันก่อนว่าไม่มีบอทที่ยังทำงานอยู่ใช้ token นั้น ไม่งั้นบอทจะดับเงียบ
- [ ] **WAF allowlist `/mbti/compare*` (เจ้าของเท่านั้น, Cloudflare console)** — ผู้ใช้จริงถูกบล็อกอยู่; ต้องแก้ที่ต้นทางไม่ใช่ปิด WAF
- [x] **บังคับ backup ก่อน deploy อัตโนมัติ** — **เสร็จ 03/11/69** (`ai/deploy-guard`)
  - `tools/deploy-guard.mjs`: `assessDeployBackup()` ตรวจ dump ล่าสุดเทียบ migration ล่าสุด + เพดานอายุ 24 ชม. · ไม่มี dump = `no_dump` · dump เก่ากว่า schema = `dump_older_than_migration` · เก่าเกิน = `dump_too_old` → **exit 1 พร้อมคำสั่ง `tools\backup-db.ps1`** (ไม่ใช่แค่เตือน)
  - `tools/deploy-db.mjs`: ทาง deploy เดียว — ด่าน backup → `npm run build` → `prisma migrate deploy` → `docker restart sovereign-core-api` → poll `/healthz` 200 · ต้องมี `--yes` · `--dry-run` แสดงแผนโดยไม่แตะระบบ
  - เทสต์ `tools/test/deploy-guard.test.mjs` **11/11** (แดงก่อนแก้: `ERR_MODULE_NOT_FOUND` exit 1) — รวมเคส CLI จริงและเคส "dump เก่า → ไม่มีคำว่า migrate สำเร็จใน output"
  - รันจริงกับของจริง: `node tools/deploy-guard.mjs` → ผ่าน (dump 03/11 03:00 ใหม่กว่า migration `add_user_consents`) · `--dry-run` แสดงแผนครบ 4 ขั้น
  - เอกสาร: `docs/ops-runbook.md` §deploy/migrate + `docs/ARCHITECTURE.md` (ทาง deploy เดียว) · ยังไม่ deploy จริง (Cold Soak)
- [x] **ทดสอบ re-consent เมื่อเวอร์ชันนโยบายเปลี่ยน** — **เสร็จ 03/11/69** (`ai/reconsent-policy`)
  - `CONSENT_PURPOSE_REVISED_IN` = เวอร์ชันที่ถ้อยคำของ **แต่ละ** วัตถุประสงค์เปลี่ยนล่าสุด ⇒ bump นโยบายที่แตะเฉพาะสุขภาพ = ขอใหม่เฉพาะสุขภาพ (การตลาด/วิเคราะห์ไม่ถูกถามซ้ำ) · `isConsentCurrent()` เทียบรายวัตถุประสงค์ + fail-closed ถ้าเวอร์ชันอ่านไม่ได้
  - `GET /api/consent` ตอบ `needsReconsent` ต่อวัตถุประสงค์ + `reconsentRequired` ระดับบน (UI ไม่ต้องเดา) · คนที่ไม่เคยยอม = ครั้งแรก ไม่ใช่ "ขอใหม่"
  - ด่านข้อมูลสุขภาพใช้กติกาเดียวกัน ⇒ `consent_version_stale` เฉพาะเมื่อวัตถุประสงค์นั้นถูกแก้จริง
  - UI `/consent`: แบนเนอร์ amber + ปุ่มเปลี่ยนเป็น "ต้องยืนยันใหม่" และ **ส่ง `granted:true`** (เดิมกดปุ่มเดียวจะกลายเป็นการถอน — ยืนยันฉบับใหม่ไม่ได้เลย) + i18n th/en
  - หลักฐาน append-only: ยืนยันใหม่ = เขียน `policy_version` ใหม่ลง `user_consents` + event ใหม่ โดย event เดิมยังคงเวอร์ชันเดิม
  - เทสต์: `tests/consentPolicyVersion.test.ts` **11/11** (แดงก่อนแก้: import ไม่มี/`needsReconsent` undefined) · `tools/test/consent-reconsent-ui.test.mjs` **5/5** (แดงก่อนแก้ 5 ข้อ) · `tests/consentGate.test.ts` 12/12 + `tests/consent.test.ts` 10/10 ไม่พัง
  - ยังไม่ bump `CONSENT_POLICY_VERSION` จริง (ต้องแก้ข้อความนโยบายก่อน) — เมื่อจะ bump: อัปเดต `CONSENT_PURPOSE_REVISED_IN` เฉพาะวัตถุประสงค์ที่กระทบ

### P1 — ควรมีก่อนมีลูกค้ารายที่ 2
- [x] เชื่อม `/privacy` เข้าหน้าล็อกอิน — **เสร็จ 03/11/69** (`ai/privacy-on-login`)
  - ไม่มีหน้าสมัครเองในระบบ (ผู้ดูแลสร้างบัญชี) ⇒ หน้าจอแรกของผู้ใช้ใหม่คือ login: เพิ่มลิงก์ “นโยบายความเป็นส่วนตัว” + บรรทัดบอกว่าจะขอความยินยอมหลังเข้าสู่ระบบ (th/en)
  - ล็อกคุณสมบัติ “อ่านได้ก่อนล็อกอิน”: `tools/test/login-privacy-links.test.mjs` **5/5** (แดงก่อนแก้ exit 1) ตรวจลิงก์อยู่ในฟอร์ม login, `/privacy` ใช้ `fetch` ตรง (ไม่ใช่ `authFetch`), `/api/consent/policy` ไม่มี `authenticate` กั้น
  - เทสต์พฤติกรรมจริงเพิ่มใน `tests/consent.test.ts`: `GET /api/consent/policy` = 200 โดยไม่ส่ง token (11/11)
- [x] เพิ่ม `consent-smoke.mjs` เข้า nightly/CI + runner ที่ปฏิเสธการรันนอกสภาพแวดล้อมทดสอบ — **เสร็จ 03/11/69** (`ai/consent-smoke-nightly`)
  - `tools/consent-smoke-runner.mjs` แยก 2 โหมด: `--check` (ค่าดีฟอลต์ · nightly) = อ่านเท่านั้น GET 3 เส้น ไม่แตะ DB · `--full` = เขียนจริง (สร้าง/ลบบัญชี) ต้องผ่านทุกข้อ: `--env=test`, hub ไม่ใช่ `:3001`, `--scratch-db` ที่ schema ไม่ใช่ `public` และไม่ใช่ `DATABASE_URL` ของโปรเจกต์ → ไม่ผ่าน = **exit 2 ก่อนแตะอะไร**
  - `--check` ตรวจจริง: policy 200 + เวอร์ชัน ISO + หัวข้อ PDPA ครบ (`who`/`data`/`purpose`/`rights`/`changes`/`contact`) · `/api/consent` + `/history` ต้อง 401 เมื่อไม่ส่ง token (200 = ข้อมูลรั่ว) · เตือน (ไม่ทำให้แดง) เมื่อ runtime ต่างจากโค้ด หรือผู้ควบคุมข้อมูลยังว่าง
  - `consent-smoke.mjs` ปฏิเสธเองถ้าไม่ได้ `CONSENT_SMOKE_ENV=test` (เดิมค่าเริ่มต้นยิงใส่ production `:3001`) — ทางออกฉุกเฉิน `--allow-non-test` พิมพ์เตือนทุกครั้ง
  - nightly-verify: รัน `--check --json` หลัง restore-check · เก็บ `consentSmoke` + `failedExtras` ใน `status.json` · **ขั้นเสริมล้ม = nightly ไม่ผ่าน** (เดิม restore ล้มแต่รายงานยังขึ้น ✅) · Telegram มีบรรทัด 🧾 · log `logs/nightly/consent-smoke.log` · ปิดได้ด้วย `NIGHTLY_SKIP_CONSENT=1`
  - เทสต์ `tools/test/consent-smoke-runner.test.mjs` **19/19** (แดงก่อนแก้: `ERR_MODULE_NOT_FOUND` exit 1) — รวม CLI จริง: `--full` ไม่มี `--env=test` = exit 2 · `--check` ชน hub ตาย = exit 1
  - รันจริงกับ production แบบอ่านเท่านั้น: `OK · 6/7 · ⚠️ 1 คำเตือน (ผู้ควบคุมข้อมูลยังว่าง)` · `--full` ชี้ `:3001` = exit 2 · `consent-smoke.mjs --confirm` ไม่มี env = exit 2
  - เอกสาร: `docs/ops-runbook.md` §consent smoke
- [ ] ทดสอบ fleet กับเครื่องจริง 1 เครื่อง (สร้างรหัสเชิญ + ตั้ง site/group ผ่าน UI) — งานค้างเดิมจาก Phase 2
- [ ] ตัดสินใจเรื่อง `MACHINE_ENROLL_CODE` บน production: ใช้รหัสเดิม (ต้องใส่ env + recreate) หรือใช้รหัสฝูง `enr_…` อย่างเดียวแล้วลบเอกสารที่ยังพูดถึงรหัสเดิม
- [ ] ตรวจ `/api/metrics` ว่า `METRICS_TOKEN` ถูกตั้งบน production จริง (ว่าง = 401 ซึ่งปลอดภัย แต่ต้องยืนยันว่าไม่ได้ตั้งเป็นค่าอ่อน)
  - 03/11/69 ตรวจพฤติกรรมแล้ว (อ่านเท่านั้น): ไม่ส่ง token = **401** · ส่ง token ผิด = **401** ⇒ ด่านทำงาน
  - **ยังค้าง (เจ้าของ)**: ยืนยันว่าค่าที่ตั้งไม่ใช่ค่าอ่อน/ค่า default — ต้องอ่าน env ของ container `sovereign-core-api` (ห้ามทำในช่วง Cold Soak)
- [ ] ตรวจ CORS/HSTS อีกครั้งเมื่อผูกโดเมนจริง (ตอนนี้ผูก `localhost:3000` ซึ่งถูกต้องสำหรับเครื่องนี้ แต่จะพังทันทีที่เปิดให้คนนอก)
  - 03/11/69 วัด baseline: preflight จาก origin แปลกปลอม (`https://evil.example`) = **204 แต่ไม่มี `Access-Control-Allow-Origin`** ⇒ browser บล็อก (deny by default ถูกต้อง) · `Strict-Transport-Security: max-age=31536000; includeSubDomains` มีอยู่แล้ว
  - **ยังค้าง**: วัดซ้ำกับโดเมนจริง (ผ่าน cloudflared) — HSTS ต้องไม่หายที่ edge และ CORS ต้องไม่กลายเป็น `*`

### P2 — หลังเปิดขาย
- [ ] e-Tax: ยังไม่มี CA/ใบรับรอง — ต้องตัดสินใจว่าจะทำเองหรือใช้ผู้ให้บริการรับรอง
- [ ] ทบทวนนโยบายเป็นรอบ (แนะนำทุก 6 เดือน หรือเมื่อเปลี่ยนผู้ให้บริการประมวลผล) — ทุกครั้งที่แก้ต้อง bump เวอร์ชันและเก็บหลักฐานเดิมไว้
