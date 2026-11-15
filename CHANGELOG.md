# CHANGELOG — Sovereign OS

ประวัติการพัฒนา แยกเป็นเวอร์ชัน บอกสิ่งที่พัฒนาใหม่ และบัคที่แก้ในแต่ละรอบ

รูปแบบ: ใช้ [Keep a Changelog](https://keepachangelog.com/) และ [Semantic Versioning](https://semver.org/)

---

## [Unreleased]

## [1.3.10] — 2026-11-14

- **หนึ่งเหตุ = หนึ่งบรรทัด** — `oneLine()` ยุบ error หลายบรรทัดของ Prisma ให้เหลือบรรทัดเดียว (หัวบอก worker, ท้ายบอกตาราง) หลังวัดได้ว่า 1.3.9 ยังเขียน 180 บรรทัดใน 80 วิ · `log-once` 8/8 · `verify` 6/6

- **error หนึ่งครั้ง = log หนึ่งบรรทัด** — `oneLine()` ยุบข้อความ Prisma หลายบรรทัด (หัวบอก worker, ท้ายบอกตารางที่หาย) ทำให้ 1.3.9 ที่ยังได้ 180 บรรทัด/80 วิ ลดเหลือหนึ่งบรรทัดต่อชนิดข้อผิดพลาด · `log-once` 8/8

## [1.3.9] — 2026-11-14

- **log ตอน DB ล่มเงียบจริงแล้ว** — `installErrorDedupe()` ครอบ `console.error` ทั้งโปรเซส: 1.3.8 ยังสร้าง 315 บรรทัดใน 75 วิ จาก worker ~15 ตัว ตอนนี้เหลือบรรทัดเดียวต่อชนิดข้อผิดพลาดต่อ 5 นาที · `log-once` 6/6 · `verify` 6/6

- **กัน log ซ้ำครอบทั้งโปรเซส** — `installErrorDedupe()` ครอบ `console.error` ทำให้ worker ทุกตัวที่ยิง error เดียวกันตอน DB ล่มถูกกลืนเหลือบรรทัดเดียวต่อ 5 นาที (หลักฐาน: 1.3.8 ยังได้ 315 บรรทัด/75 วิ จากการแก้ 2 จุดแรก) · `log-once` 6/6

## [1.3.8] — 2026-11-14

- **ตอน DB ใช้ไม่ได้ log ไม่สแปมแล้ว** — `createLogOnce` พิมพ์เหตุเต็มครั้งแรก ครั้งต่อไปนับเงียบ แล้วสรุปทุก 5 นาที (`ซ้ำ N ครั้งใน … วิ`) ใช้กับ `threat-detection.recordAnomaly` และ `relay.ensureDefaultRelays` · รอบทดสอบบน 1.3.7 ได้ stderr 830 บรรทัดในไม่กี่วินาที ตอนนี้เหลือไม่กี่บรรทัด · เทสต์ใหม่ `log-once` 4/4 · `verify` 6/6

- **stderr ของ sidecar ขึ้น log ทันที** — เดิมเก็บเป็นก้อนแล้วพิมพ์ตอน exit ⇒ migrate ที่ล้มแต่โปรเซสยังเสิร์ฟต่อ (schema drift/ไม่มีสิทธิ์) ไม่เหลือร่องรอยใน `desktop-shell.log` เลย · ตอนนี้ทุกบรรทัดที่ sidecar เขียนลง stderr ถูก log ทันที (`backend stderr: …`) · เทสต์ `desktop-backend-secret` 9/9
_(ยังไม่มีรายการ)_

---

## [v1.3.6] — 2026-11-13 (released)

### 🧹 ล้าง `sovereign-api-url` ค้างในแอปเดสก์ท็อป (DESKTOP-004)

- **ค่า api-url ที่ค้างถูกล้างทิ้งจริง** — เดิมแอปเขียน key `sovereign-api-url` ใน localStorage เฉพาะตอนหันไปพอร์ตสำรอง (เช่น `http://localhost:3011`) แล้วไม่เคยล้าง ⇒ รอบเปิดถัดไปที่กลับมาใช้ 3001 หรือไม่ spawn sidecar เลย renderer ยังชี้ไปพอร์ตที่ตาย (โหลดไม่รู้จบทั้งแอป) · ตอนนี้ `apiUrlFor()`/`applyApiUrl()` ใน `backend-port.cjs` คำนวณค่าจากพอร์ตที่ใช้จริงและ **`removeItem('sovereign-api-url')` เมื่อกลับมาที่ 3001** · `main.js` เรียกทั้งตอนเลือกพอร์ต (`onPort`) และหลัง supervisor สรุปผล · เทสต์ `desktop-backend-port` 5/5 (เคสใหม่แดงก่อนแก้: module ไม่มี `apiUrlFor`)

### 🛡️ คำขอที่ล้มใน backend ตอบ 500 ไม่ค้าง (SEC-030)

- **handler async ที่โยน error ไม่แขวนคำขออีกต่อไป** — Express 4 ไม่ดัก promise ที่ reject ⇒ handler ที่ `await` DB/executor แล้วโยน error จะไม่ตอบ 500 แต่ปล่อยคำขอค้างจน client timeout (connection ถูกจับไว้) · สแกนด้วย TypeScript AST พบ **60 handler ใน 15 ไฟล์ routes** ที่ `await` โดยไม่มี `try`/`.catch` (เคยเกิดจริงที่ SEC-023/026/029) · แก้: `src/lib/async-handler.ts` `asyncRoute()` (rejection → 500 JSON + `detail` ≤200 ตัวอักษร, `headersSent` → `next(err)` ไม่เขียนทับ) ห่อครบ 60 handler · เพิ่มด่าน `tests/routeAsyncSafety.test.ts` สแกน AST ทุก `*.routes.ts` — handler ใหม่ที่ลืมห่อ = CI แดง · กติกาใน `docs/ARCHITECTURE.md`

---

## [v1.3.5] — 2026-11-13 (released)

### 🗄️ ฐานข้อมูลของ sidecar

- **sidecar migrate DB ก่อนเสิร์ฟ + health บอกความจริงเรื่อง DB** — `MIGRATE_ON_START=1` รัน `migrate-deploy` ก่อน `listen()` (worker เริ่มหลัง migrate); `file:` (SQLite) ถูกปฏิเสธพร้อมเหตุผลเพราะ Prisma เป็น postgresql; `/api/health` เพิ่ม `db.state` + `db.reason` แทน `migrationHead: null` ที่แยกไม่ออกว่า "ยังไม่มี migration" หรือ "ต่อ DB ไม่ได้"; แอปไม่ spawn sidecar เลยถ้าเครื่องไม่มี `DATABASE_URL` (เดิมแต่ง `file:` ให้แล้วตายเงียบ) · เทสต์ `startupMigration` 6/6, `desktop-backend-secret` 8/8, `migrate-baseline` 7/7
- **`migrate-deploy` เรียก `npx` ได้บน Windows** — `spawnSync('npx', …, shell:false)` บน Windows ได้ ENOENT แล้วถูกอ่านผิดเป็น "migrate ล้มและ baseline ไม่ปลอดภัย" ทั้งที่ DB ปกติ · ตอนนี้ใช้ shell เฉพาะ win32 (`npxSpawnOptions()`) และ health รายงาน head จริงหลัง migrate · เทสต์ `migrate-baseline` 7/7

---

## [v1.3.4] — 2026-11-13 (released)

### 🔧 แอปเดสก์ท็อปใช้ API ของตัวเองได้จริง

- **sidecar มี `JWT_SECRET` ของเครื่องเอง** — `core-api` โยน `JWT_SECRET is not set` ทันทีถ้าไม่มีค่า แต่แอปที่แพ็กไม่ได้เตรียมอะไรให้ พอร์ตสำรองที่เลือกไว้จึงว่างเปล่าและ frontend ชี้ไปที่ API ที่ไม่มีอยู่ · ตอนนี้ `loadOrCreateJwtSecret()` สร้าง hex 32 ไบต์ใน `userData` (โหมด 0600, เขียนผ่านไฟล์ชั่วคราว + rename) ใช้ค่าเดิมทุกครั้งที่เปิดแอป, ค่าที่ผู้ปฏิบัติการตั้งใน env ชนะเสมอ, ไฟล์ที่สั้น/ว่างถูกสร้างใหม่ · เทสต์ `desktop-backend-secret` 6/6
- **sidecar ตายแล้วต้องมีร่องรอย** — เดิม spawn ด้วย `stdio:'ignore'` ⇒ ตายเงียบไม่มี log · ตอนนี้เก็บ stderr ท้ายสุด 12 บรรทัดและ log `backend exit code=<n> signal=<s> port=<p>` เมื่อโปรเซสจบ · ค่า secret ไม่ถูก log · เทสต์ `desktop-backend-port` 3/3 + `desktop-backend-secret` 6/6

---

## [v1.3.3] — 2026-11-12 (released)

### 🔒 ความถูกต้องของข้อมูลความปลอดภัย (patch)

- **`PUT /api/actuation/occupancy` ไม่เดาค่าที่พิมพ์ผิด** — เดิมใช้ `!!v` ⇒ สตริง `"false"` กลายเป็น "มีคน" และ `0` กลายเป็น "ไม่มีคน" เงียบ ๆ ทั้งที่กฎ OCCUPANCY ใช้ค่านี้กัน AI ปิดน้ำ/เน็ต · ตอนนี้ `parseOccupancyInput()` แปลเฉพาะ `true/false/1/0/"true"/"false"/"unknown"/null` และตอบ 400 เมื่อค่าไม่รู้จัก · เทสต์ `actuationOccupancyInput` 2/2
- **เดสก์ท็อปไม่แอบใช้ API ของคนอื่น** — sidecar เดิมยึด `PORT=3001` ตายตัวและกลืน stderr ⇒ ถ้าพอร์ตถูกคอนเทนเนอร์/บริการอื่นยึด แอปจะคุยกับเซิร์ฟเวอร์รุ่นเก่าโดยไม่มีสัญญาณ (endpoint ใหม่ตอบ 404) · ตอนนี้ตรวจ `/api/health` เทียบ `build.version` กับบิลด์ในตัวก่อน spawn: เป็นของเรา = ใช้ต่อ, ว่าง = spawn 3001, ของคนอื่น = log `backend-port-conflict` + spawn พอร์ตสำรองและบอก renderer ผ่าน `sovereign-api-url` · เทสต์ `desktop-backend-port` 3/3

---

## [v1.3.2] — 2026-11-11 (released)

### 🔧 แก้ของที่ปล่อย v1.3.1

- **`SHA256SUMS.txt` ตรวจไฟล์ที่ปล่อยได้จริง** — เดิม manifest เขียนชื่อ `Sovereign OS-<ver>-win.zip` (เว้นวรรค) แต่ GitHub เก็บ asset เป็น `Sovereign.OS-<ver>-win.zip` ทำให้ `sha256sum -c` ล้มทั้งที่เนื้อไฟล์ถูก (hash ตรง) · ตอนนี้ตั้งชื่อด้วย `githubAssetName()` ก่อนคัดลอก/เขียน manifest ⇒ ชื่อไฟล์ที่ stage = ชื่อ asset ที่ปล่อย = ชื่อใน checksum · เทสต์ `release-asset-names` 2/2 และ `release-build` 11/11

## [v1.3.1] — 2026-11-11 (released)

### 🔒 ความปลอดภัยและความถูกต้องของข้อมูล (patch)

- **ด่านพร้อมปล่อยแพทช์** — `npm run release:check` ตรวจ version ตรงกันทุก package (root/core-api/frontend), มีหัวข้อ CHANGELOG ของรุ่นพร้อมวันที่, และ `[Unreleased]` ว่าง ก่อน push tag — เดิมรู้ตัวตอน workflow ปล่อยรุ่นหยุดกลาง build · เทสต์ `release-check` 4/4
- **OTA: รายงานว่าใครยังใช้ `?token=`** — เพิ่มตัวนับในหน่วยความจำ (ไม่เก็บค่า token, จำกัด 200 รายการ) และ `GET /api/ota/legacy-clients` (SUPERADMIN) ที่บอก `readyToDisable` จากหน้าต่าง 24 ชม. เพื่อให้รู้ว่าเมื่อไรลบ `OTA_ALLOW_QUERY_TOKEN` ได้ · เทสต์ `otaLegacyClients` ผ่าน
- **OTA: ค่าเริ่มต้นไม่รับ token จาก URL** — เพิ่ม `OTA_ALLOW_QUERY_TOKEN` เป็นสวิตช์ชั่วคราวสำหรับอุปกรณ์ที่แฟลชด้วยสัญญาเดิม (เปิดเฉพาะค่า `1/true/yes/on`); ไม่ตั้ง = รับเฉพาะ header `x-ota-token` และตอบ 401 พร้อม hint · เทสต์ `otaQueryTokenSwitch` ผ่าน
- **OTA: token ออกจาก URL + ประวัติเฉพาะ SUPERADMIN** — `/deploy` ไม่ฝัง `?token=` ใน URL แล้ว (ส่ง `x-ota-token` ทาง header ใน payload), endpoint ดาวน์โหลดรับ token ทาง header ก่อนโดยยังรับ query ให้อุปกรณ์รุ่นเดิม, และ `GET /ota/events` จำกัดที่ SUPERADMIN (frontend ไม่ยิงเมื่อ role อื่น) · เทสต์ `otaDeployToken` ผ่าน
- **ปิดการดึงงานซ้ำ (double dispatch)** — `pullJobs()` เดิมเปลี่ยนสถานะงานเป็น `running` ด้วย `update` ที่ไม่มีเงื่อนไขสถานะ สองคำขอที่ดึงพร้อมกันจึงได้งานเดียวกันไปรันซ้ำ · ตอนนี้จองด้วย `updateMany` แบบมีเงื่อนไข `status=queued` และทิ้งงานที่มีคนคว้าไปก่อน · เทสต์ `jobPullClaim` ผ่าน
- **ปิดช่อง upload สองจุด** — `verifyUploadedContent()` เดิมจับแค่ MZ/ELF ทำให้ไฟล์ Mach-O, Java class และ WebAssembly ผ่านด่านได้ · และ knowledge upload (disk mode) ทิ้งไฟล์ค้างเมื่อบันทึก DB ล้ม · ตอนนี้ปฏิเสธ magic ของโค้ดที่รันได้ครบขึ้นและลบไฟล์ทิ้งเมื่อบันทึกไม่สำเร็จ · เทสต์ `uploadMagicCleanup` ผ่าน
- **จำกัดรายการเครื่อง/คิวงานตามเจ้าของ** — `GET /api/agent-machines` และ `/queue` เคยคืนทุกเครื่อง (พร้อม IP) และทุกงานของทั้งฟลีตให้ทุก role ที่ล็อกอิน · ตอนนี้ role ที่ไม่ใช่ SUPERADMIN เห็นเฉพาะเครื่องที่ผูกกับตัวเองและงานบนเครื่องนั้น (SUPERADMIN ยังเห็นทั้งฟลีตเพื่อผูก/ลงทะเบียนเครื่องใหม่) · เทสต์ `agentMachinesFleetScope` ผ่าน
- **ปิด SSRF ที่ตัวนำเข้าเว็บของ Knowledge** — `POST /api/knowledge/import` ยิง URL ที่ผู้ใช้ส่งไปตรง ๆ ทำให้สั่งเซิร์ฟเวอร์อ่าน API ภายใน/metadata ได้ · ตอนนี้ใช้ `outbound-url-guard` ตัวเดียวกับ vision: ปฏิเสธ loopback/link-local/URL ที่ฝังรหัสผ่าน, ตรวจ IP ที่ resolve จริง (กัน DNS rebinding), ไม่ตาม redirect, จำกัดขนาด 8 MB · เทสต์ `knowledgeImportSsrf` ผ่าน
- **ปิดการเปิดภาพหน้าจอข้ามเครื่อง** — `GET /api/agent-machines/screenshots/:file` ตรวจแค่ว่าล็อกอิน ทำให้ผู้ใช้ที่ไม่ได้ผูกเครื่องเปิดภาพจบงานของเครื่องคนอื่นได้ · ตอนนี้ดึง jobId จากชื่อไฟล์ → ตรวจเจ้าของเครื่องด้วย `userCanControl()` (ไม่ตรงรูปแบบ/ไม่พบงาน/ไม่ได้ผูก = 403) · เทสต์ `agentMachinesRoutes` ผ่านครบ
- **ปิดประตู OTA ที่เปิดโล่ง** — `GET /api/ota/firmwares/:file` เดิมเปิดให้ใครก็ได้เมื่อไม่ได้ตั้ง `OTA_TOKEN` และเทียบ token ด้วย `!==`; ตอนนี้เทียบแบบคงเวลา และถ้าไม่ตั้ง token จะเปิดเฉพาะ peer ในวง LAN/loopback · `POST /api/ota/deploy` ปฏิเสธ `OTA_BASE_URL` ที่เป็น http ไปยัง host สาธารณะ (อุปกรณ์ตรวจลายเซ็นไม่ได้ ⇒ บนเส้นทางสลับไฟล์ได้) · เทสต์ `tests/otaAccess.test.ts` 4/4
- **ปิดการปลอมผลข้ามเครื่อง** — `POST /api/machine-control/result` รับผลตาม `commandId` โดยไม่เทียบว่าเครื่องที่ส่งคือเครื่องที่ได้รับคำสั่ง ทำให้ runner ที่ถือ token ของเครื่องหนึ่งปลอมผล (หรือเนื้อหาไฟล์) ของคำสั่งที่ออกให้อีกเครื่อง และปิดคำสั่งนั้นทิ้งได้ · ตอนนี้ตรวจเจ้าของคำสั่งก่อนรับผล เครื่องอื่นได้ 403 และคำสั่งยังอยู่ในคิวของเครื่องจริง
- **ปิดช่องควบคุมเครื่องข้ามเจ้าของ (Socket.IO)** — `control:join` ตรวจแค่ role ทำให้ SUPERADMIN ที่ไม่ได้ผูกเครื่องเข้าห้อง รับภาพจอ และสั่งเมาส์/คีย์บอร์ด/ไฟล์ได้ (HTTP counterparts ตรวจ `userCanControl()` อยู่แล้ว) · ตอนนี้ join ต้องผ่าน `userCanControl()` และ `control:fs`/`control:snapshot`/`control:fps` บังคับให้ join ก่อน · เทสต์ socket 17/17

## [v1.3.0] — 2026-11-10 (released)

> งานหลัง tag `v1.2.0` — รวมในรุ่นนี้ (image `1.2.0` build จาก `11b07ef` จึงยังไม่มีส่วนนี้)

### 🔧 งานหลังปล่อย v1.2.0

- **CI / images** — แยก build amd64/arm64, ตัด QEMU, ใช้ runner ARM จริง + จำกัดเวลา 45 นาที; ทุก tag ของ `api`/`web` ชี้ manifest เดียวกัน
- **ความปลอดภัย / คุณภาพ** — ปิด Dependabot advisories ที่เหลือ, mount farm executive API ให้ตรงกับหน้าที่เรียก, เพิ่มเทสต์ route/E2E
- **Module boundary** — ปิด 6 เส้นข้ามโมดูลผ่าน service ของเจ้าของตาราง (`consent → health`, `consent → ai`, `farm → livestock`)
- **Nightly** — แก้ restore-check false positive (แยก pure compare + เทสต์ 5/5) และรัน restore จริงผ่าน 149/149 ตาราง
- **Nightly (8 พ.ย.)** — `migration head` แยกสายสถานะให้ถูกเจตนา: dump ที่ถ่าย *ก่อน* migration ใหม่ถูก apply (จริงสูงกว่ากู้) = ปกติของ snapshot ไม่ตีเป็นแดง — เฉพาะ "กู้สูงกว่าจริง" (live ถอยหลัง/มีการลบ migration) จึงฟ้อง, `notify()` เคารพสวิตช์ `alert-settings.json` (`enabled:false` → `{ok:true, status:'skipped_by_config'}` — แยก "ข้ามเพราะตั้งใจปิด" ออกจาก "ส่งไม่ผ่านเพราะพัง") และ main-guard ให้ `import` เพื่อเทสต์ไม่ยิง docker จริง (29.4s → 0.1s) · PR #52 (`d1687d`) — เทสต์ red-first 8/8 + รันจริง `--strict` ผ่าน (กู้ครบ 150/150 ตาราง)
- **Ops / Nightly (P0)** — ปิด `ShipShop3000` ที่ค้าง, ยืนยัน `Sovereign Nightly Verify` ผ่านจริงผ่าน Task Scheduler (Last Result 0), เพิ่ม **dead-man alert 03:30** เตือน Telegram เมื่อ nightly ไม่ผ่าน/ไม่ส่งผลติดกัน 2 คืน และแก้ `nightly-report` ให้ใช้ creds กลาง (DB → `infra/.env`) แทนการอ่าน DB อย่างเดียว
- **Release Automation (Sprint 1)** — `.github/workflows/release.yml` ปล่อยชุดติดตั้ง Windows อัตโนมัติเมื่อ push tag `v*`: ตรวจ tag ↔ version ก่อน build, build core-api + static export, แพ็ก portable exe/zip ด้วย electron-builder บน `windows-latest`, เขียน/ตรวจ `SHA256SUMS.txt` ด้วย `tools/release-build.mjs` แล้วแนบ GitHub Release · เทสต์ red-first 11 ตัว (`tools/test/release-build.test.mjs`) ครอบการคัด artifact, รูปแบบ checksum, tag gate และสัญญาของ workflow
- **Offline-First Read Cache (Sprint 2 · ระยะ 1)** — `src/lib/offline/read-cache.ts` เก็บข้อมูลอ่านลง IndexedDB แยกโดเมน (`system`/`menu`/`farm`/`inventory`/`telemetry`) พร้อม TTL ต่อคำขอ, stale-while-revalidate, ถอยไปใช้แคชเก่าเมื่อ network ล่ม และไม่ทำให้การอ่านพังเมื่อ IndexedDB ใช้ไม่ได้/เขียนไม่ได้ · เพิ่ม hook `useOfflineRead` สำหรับหน้าเว็บ · เทสต์ red-first 13 เคส (`read-cache.test.ts`) ผูกเข้า `npm run verify` ผ่าน `tools/test/frontend-offline-read-cache.test.mjs`
- **Offline-First Conflict Resolver (Sprint 2 · ระยะ 2)** — `sovereign-os/core-api/src/modules/sync/conflict-resolver.ts` คุมการ replay คิวออฟไลน์ตอนกลับมาออนไลน์: telemetry replay ได้เสมอ (ไม่ reject), ยอด stock/money ที่ทับกันจะยึดค่าที่เครื่องอื่นเขียนล่าสุด (ไม่ใช่ Last-Write-Wins ย้อนกลับไม่ได้) และเขียน `SyncConflictLog` แบบ upsert by `mutationId` — retry ไม่สร้าง log ซ้ำ · เทสต์ red-first จบเขียว 6/6 (`conflict-resolver.test.ts`, ผูกเข้า verify ผ่าน `tools/test/backend-conflict-resolver.test.mjs`) · migration แบบ additive `20261107120000_add_sync_conflict_logs` · ตารางใหม่ผูกเจ้าของใน `tools/module-owners.json` (`sync_conflict_logs → sync`) ให้ arch-gate เขียว
- **CI hardening — ปิดการค้างใน CI** — แก้ `npm run test:tools` ค้างบน runner: ไฟล์ตัวค้างจริงคือ `tools/test/desktop-shell-functions.test.mjs` (HANG 60s บน runner, run `42410357754`) — ปิด keep-alive socket ของ test server และยก script เป็น `node --test --test-force-exit --test-timeout=120000` · ใส่ `timeout-minutes` ครบทุก job ในทุก workflow (14 jobs หลังลบ probe ชั่วคราว) · พิสูจน์ผ่าน PR #51: required checks ทั้ง 7 รันจริง (10/10 pass), policy บล็อก merge ขณะ checks pending (`mergeable_state=blocked`, `gh pr merge` ปฏิเสธ "base branch policy prohibits the merge") และ merge เมื่อเขียวครบ (`d652698`)
- **Desktop** — แพ็ก `hidden-launch.cjs` + `run-hidden.vbs` ไปกับแอป (J6f) ให้เปิด `.bat` แบบไม่มีหน้าต่างได้ครบ
- **E2E / fixture ที่ล้มใน CI (9 พ.ย.)** — global-setup เคยเรียก `e2e-fixture.ts` ซึ่งถูกลบไปพร้อมหน้า `/community` ตอนแยก CE → seed ล้มทุกครั้งโดยไม่มีใครรู้สาเหตุ (Linux `ERR_MODULE_NOT_FOUND`, Windows `spawnSync npx ENOENT` จาก `execFileSync('npx')` ที่ต้องเป็น `npx.cmd`) · ลบ hook fixture ออก และย้ายการเรียกสคริปต์ backend ไปที่ `e2e/helpers/core-script.ts` ที่รันด้วย `process.execPath` (dist ก่อน → tsx ใน `node_modules` ของ core-api, ไม่พึ่ง PATH/shell) · ด่าน static 3 ตัว (`tools/test/e2e-global-setup.test.mjs`) กันการอ้างสคริปต์ที่ไม่มีไฟล์จริงกลับมาอีก
- **E2E Telegram บันทึกค่าจริง (9 พ.ย.)** — เคสใหม่กดบันทึกการตั้งค่า Telegram ในหน้า settings แล้วยืนยันจาก `GET /api/telegram/config` (mask/chatId/source) + reload แล้วค่ายังมาจาก API และคืน config เดิมของเครื่องเป๊ะ ๆ ใน `finally` · เครื่องที่ยังไม่มี DB override เขียน token ปลอมแล้ว `DELETE /config` เพื่อกลับไปใช้ `.env`, เครื่องที่มี override อยู่ทดสอบเฉพาะ chatId (merge ไม่เขียนทับ token เดิมที่อ่านกลับไม่ได้เพราะ API คืนแค่ mask) · ไม่กด "ส่งข้อความทดสอบ" เพื่อไม่ยิง Telegram จริง · local 6 passed (25.6 วิ)
- **`stage-release.mjs` ไม่รันทั้งไฟล์ตอนถูก import (10 พ.ย.)** — เดิมโค้ดทั้งหมดอยู่ที่ top-level ทำให้เทสต์ที่ `import` เอา `selectArtifacts` ไปใช้รันสคริปต์จริงทันที แล้ว `die()` เพราะ `dist-electron` ไม่มี artifact ของเวอร์ชันปัจจุบัน (เจอจริงตอน bump version เป็น 1.3.0: `tools/test/stage-release-select.test.mjs` แดงทั้งที่ logic ไม่ได้ผิด) · ย้ายเข้า `main()` และเรียกเฉพาะเมื่อเป็น entry point (เทียบ path จริงด้วย `realpathSync.native` กัน case เพี้ยนบน Windows) · เพิ่มเทสต์ "import ต้องไม่มี side effect" ครอบไว้อีกชั้น (`node tools/stage-release.mjs --out=…` ยังทำงานเหมือนเดิม)
- **E2E Telegram ดึง Chat ID อัตโนมัติ (10 พ.ย.)** — ปุ่มนี้เรียก `GET /api/telegram/updates` ซึ่งฝั่ง server ไปยิง `api.telegram.org` ด้วย token ของเครื่องจริง ⇒ เทสต์ intercept ที่ชั้นเบราว์เซอร์ (`page.route`) ตอบ fixture แทน ไม่มี request ออกไป Telegram เลย · ตรวจว่าปุ่มกดไม่ได้จนมี token, กดแล้วได้รายการ + เลือกแชทแล้ว `chatId` ถูกเติม, ผลว่างบอกผู้ใช้ตามจริง · ไม่กดบันทึก ⇒ ไม่เขียน DB และยืนยันผ่าน API ว่า config ยังเหมือนก่อนรัน · local 7 passed (26.4 วิ)
- **แก้ชื่อห้องว่างของโพสต์ในช่อง Telegram + unit test การ map `getUpdates` (10 พ.ย.)** — `GET /api/telegram/updates` เดิมอ่าน `chat` จาก `message` เท่านั้น โพสต์ในช่อง (มีแต่ `channel_post`) จึงได้ `title` ว่างเสมอ ทำให้รายการที่ผู้ใช้เลือกในหน้า settings ไม่มีชื่อห้อง · อ่าน `chat` จากทั้งสองที่ทางเดียว และเพิ่ม `sovereign-os/core-api/tests/telegramUpdates.test.ts` (7 เคส, mock axios ไม่ยิง Telegram จริง): dedup chatId ซ้ำ, กรอง `chatId` ว่าง, `channel_post` ได้ชื่อห้องถูก, ตัดข้อความที่ 60 ตัวอักษร, `type` หาย → `unknown`, จำกัด 10 แชท, Telegram ตอบ 401 → 500 พร้อมสาเหตุและไม่ retry, ไม่มี token → 400 และไม่ออก request, ไม่ล็อกอิน → 401 · Telegram ตอบ 429 → ส่ง 429 พร้อม `retry after` ต่อให้ UI (ไม่กลายเป็น 500 เหมือนบั๊กฝั่งเรา) · `result` ที่ไม่ใช่ array หรือไม่มี `data` → คืนลิสต์ว่างแทนการโยน 500
- **ตรวจ `stage-release` หลัง refactor ด้วยการจัด release จริง (10 พ.ย.)** — รัน `node tools/stage-release.mjs` หนึ่งรอบเทียบกับ `SHA256SUMS.txt` ที่โค้ดเวอร์ชันก่อน refactor สร้างไว้: **เหมือนกันไบต์ต่อไบต์** (portable `af09483…`, zip `0d20f5a…`, README `bc2d998…`) และ `sha256sum` ที่คำนวณใหม่จากไฟล์จริงตรงกับที่สคริปต์เขียน · โฟลเดอร์เวอร์ชันอื่น (`Sovereign-OS-1.1.1-win-x64`) ไม่ถูกแตะ
- **E2E ยืนยันชื่อห้องแบบช่องในรายการ Telegram (10 พ.ย.)** — เพิ่มเคสใน `settings.spec.ts`: payload ที่มี `type: 'channel'` และ chatId ติดลบต้องแสดงชื่อห้อง (`ประกาศกรรมการ`), type และข้อความในแถว — ไม่ใช่เหลือแค่ตัวเลขอย่างก่อนแก้ route — และกดเลือกแล้วช่อง Chat ID ต้องได้ค่าติดลบ · ยัง intercept ที่ชั้นเบราว์เซอร์ (ไม่เรียก Telegram จริง, ไม่แตะ config เครื่อง) · local 8 passed (19.6 วิ)
- **throttle ของ `/api/telegram/updates` แชร์ข้าม process ผ่าน Postgres (10 พ.ย.)** — ตัวกันกดรัวเดิมเป็น Map ในหน่วยความจำ ⇒ กันได้เฉพาะ process เดียวและหายเมื่อรีสตาร์ท · ย้ายไปตาราง `telegram_updates_slot` (migration `20261110120000_telegram_updates_slot`, 1 แถวต่อผู้ใช้) ตัดสินผ่าน/ไม่ผ่านด้วย `INSERT … ON CONFLICT (user_key) DO UPDATE … WHERE last_hit_at <= cutoff RETURNING last_hit_at` คำสั่งเดียว (atomic — 5 request พร้อมกันผ่านได้ 1 ตามที่ทดสอบกับ Postgres จริง) · เทสต์ route ยังใช้ store ในหน่วยความจำ (`__setUpdatesSlotStore`) จึงไม่ต้องมี DB ตอน unit test · เลือก DB แทน Redis เพราะมีอยู่แล้วทุก deployment ไม่ต้องเพิ่ม infra · ตรวจกับ Postgres จริง (schema ชั่วคราวแล้วลบ): ยิง 5 claim พร้อมกันผ่าน 1, ผู้ใช้อื่นไม่ถูกบล็อก, พ้น 3 วิ ผ่านอีกครั้ง, `TELEGRAM_UPDATES_MIN_INTERVAL_MS=0` ปิดได้ · ยืนยันผ่าน HTTP บน container จริง: call#1 `500` (Telegram 401 จาก token ปลอม) → call#2 `429 retryAfter=2` → รอ 3.2 วิ กลับเป็น `500`
- **กันกดรัว + UI บอกเวลารอเมื่อโดน 429 (10 พ.ย.)** — `GET /api/telegram/updates` ยิง `api.telegram.org/getUpdates` ทุกครั้งที่กด ⇒ เพิ่ม throttle ฝั่ง server ต่อผู้ใช้ (`src/modules/telegram/updates-throttle.ts`, ค่าเริ่มต้น 3 วิ ปรับได้ด้วย `TELEGRAM_UPDATES_MIN_INTERVAL_MS`, ตั้ง 0 = ปิด) ตอบ `429 { retryAfter }` ก่อนออกเน็ต · route ส่ง `retryAfter` ต่อให้ UI ด้วยทั้งกรณี 429 ของเราเองและของ Telegram (อ่าน `parameters.retry_after` หรือ `retry after N` ใน description) · หน้า settings แสดง "เรียก Telegram บ่อยเกินไป — ลองใหม่ภายหลังใน N วินาที" แทน error ดิบ (i18n th/en) · เทสต์: unit 13/13 (throttle ผ่าน/บล็อก/พ้นช่วง/แยกคีย์, กดรัวแล้วไม่ยิง Telegram ซ้ำ, retryAfter=12, Telegram 401 ยังคง map เป็น 500 ตามเจตนา) + E2E 9 passed (29.6 วิ) รวมเคส 429
- **เอกสาร** — อัปเดต `CHANGELOG` / `README` / `STATUS` / `QUEUE` ให้ตรงกับสถานะจริง

### ⬆️ อัปเกรดจาก `v1.2.0`

- **ต้องมี migration 1 ตัว** — `20261110120000_telegram_updates_slot` (ตาราง `telegram_updates_slot`, 1 แถวต่อผู้ใช้) ต้องถูก apply ก่อนใช้ throttle ชุดนี้ · ชุดติดตั้ง community รัน `node dist/scripts/migrate-deploy.js` ตอนคอนเทนเนอร์สตาร์ทให้เอง (baseline P3005 ได้ถ้าฐานเก่าไม่มี `_prisma_migrations`) · สแตกที่รัน `docker compose` เอง (เช่น `sovereign-os/infra`) ต้องสั่ง `npx prisma migrate deploy` เอง — ห้าม `db push` (มี gate `tools/test/no-db-push-gate.test.mjs`)

---

## [v1.2.0] — 2026-11-06 (released)

**Community Edition (CE) เปิดตัวเป็น repo สาธารณะ** — repo นี้เหลือ CE เพียว ไม่มีโมดูล Pro
(Pro ย้ายไป private repo แล้ว ดู [`docs/OPEN-CORE.md`](docs/OPEN-CORE.md))
ตัวเลข ณ วันปล่อย: backend 1,823 tests (ข้าม 1) · tooling/CI 1,287 tests (ข้าม 6) · `tsc` + `next build` สะอาด

### 🚀 งานเปิดตัว Community Edition (4–7 พ.ย. 2026)

- **แยก Pro ออกจาก CE (Clean Hard Cut)** — ลบโมดูล/หน้า/เทสต์ Pro 90+ ไฟล์, ทำ Pro registry + 404 ที่บอกชื่อโมดูล, ขยาย open-core boundary gate ให้ตรวจ frontend ด้วย
- **ชุดติดตั้ง CE คำสั่งเดียว** — `deploy/community/docker-compose.yml` (db · mqtt · migrate · api · web), named volume ล้วน, `.env.example` บังคับ 3 secrets, พิสูจน์ติดตั้งใหม่บนฐานข้อมูลว่างแล้ว
- **สมัครด้วยรหัสเชิญ (ไม่มี SMTP)** — CLI/API/UI, เก็บ SHA-256, ใช้ครั้งเดียว/มีวันหมดอายุ/เพิกถอนได้ + การ์ดจัดการในหน้าผู้ใช้
- **Alert fanout 3 ช่อง** — Telegram ยืนยัน end-to-end; Discord + LINE ผ่าน stub (รูปแบบ/headers/plain-text/mention hardening)
- **เดโม 15 วินาที 11 ฉาก** — `docs/media/demo.gif` + ภาพนิ่ง `docs/media/screens/` ฝังใน README ไทย/อังกฤษ
- **README ภาษาอังกฤษ** — `README.en.md` + สลับภาษาที่หัว README, แก้ตัวเลขเทสต์/โมดูลให้ตรงจริง, เติมขั้นตั้ง 3 secrets
- **GHCR multi-arch images** — workflow `publish-images.yml` แยก build amd64 (ubuntu) + arm64 (ubuntu-24.04-arm) แล้ว merge manifest; image `api`/`web` เป็น public, tags `1.2.0`, `1.2`, `latest` (+ `main`, `sha-*`)
- **คู่มือ/FAQ ภาษาอังกฤษ** — `deploy/community/README.en.md`, `docs/FAQ-REDDIT.md`, ด่านตรวจ image ก่อนโพสต์ใน `docs/LAUNCH-REDDIT.md`
- **ความปลอดภัย/คุณภาพรอบปล่อย** — ปิด Dependabot advisories (high 5 + moderate ที่เหลือ), mount farm executive API ให้ตรงกับหน้าที่เรียก, เทสต์ route/E2E ของ farm executive
- **UI CE** — ตัดเมนู Pro ออกจาก `navigation.ts` (Ecosystem/ร้านอาหาร/ธุรกิจ/ฟลีท/การเงิน) และ QuickDeck ชี้หน้า CE จริง

> หมายเหตุ: หลัง tag `v1.2.0` (6 พ.ย.) มี commit วันที่ 7 พ.ย. ปรับ CI + ปิด advisories + farm executive
> — image `1.2.0` build จาก `11b07ef` จึงยังไม่มีส่วนนี้ จะรวมใน release ถัดไป

### 📚 ประวัติการพัฒนาก่อนแยก Pro (ถึง 2026-11-05)

รายการด้านล่างคือสิ่งที่พัฒนาตั้งแต่ `v1.1.1` จนถึงวันที่แยก Pro ออก —
บางรายการเป็นงาน Pro ที่ **ย้ายออกจาก repo นี้แล้ว** เก็บไว้เพื่อเป็นประวัติ ไม่ใช่สิ่งที่ CE ใช้งานได้ในตอนนี้

### 🚀 ฟีเจอร์ใหญ่ที่เพิ่มเข้ามา

**ระบบติดตั้งและการเผยแพร่ (Deploy / Packaging)**
- **CE1 — ชุดติดตั้ง Community Edition แบบ Docker Compose คำสั่งเดียว** (`deploy/community/`): db · mqtt · migrate · api · web ใช้ named volume ล้วน ไม่ bind mount ซอร์ส รันบนเครื่องใดก็ได้ (x86_64/arm64) `migrate` รัน `prisma db push + seed` แล้ว `api` จึงเริ่ม
- แก้บัคจริง: `Dockerfile.prod` ของ frontend ใช้ `node:18` แต่ Next 16 บังคับ ≥ 20.9 → เปลี่ยนเป็น `node:22-alpine`
- `next.config.js`: เติม origin จาก `NEXT_PUBLIC_API_URL` เข้า CSP `connect-src` (http + ws) กัน CSP บล็อกเมื่อเปิดจากเครื่องอื่น
- เทสต์ `tools/test/community-stack.test.mjs` 13/13 (แดงก่อนแก้ 4 ข้อ) · `docker compose config` ผ่านจริง
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
- v1.2.0 ถูก push ขึ้น `origin/main` และปล่อย Release แล้ว (2026-11-06) · image `api`/`web` ขึ้น GHCR เป็น public แล้ว
- สถานะงานค้างล่าสุดดูที่ [`QUEUE.md`](QUEUE.md) · snapshot สภาพระบบดูที่ [`STATUS.md`](STATUS.md)
- CHANGELOG นี้เก็บประวัติก่อนแยก Pro ไว้ด้วย; งาน Pro ใหม่ไม่ได้อยู่ใน repo นี้
