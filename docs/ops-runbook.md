# Ops Runbook — Project Sovereign (หน้าเดียวจบ)

> ระบบหลังบ้านทั้งหมดบนเครื่องนี้: 3 containers + เว็บ bare-metal + shell เดสก์ท็อป
> ทุกพาธอ้างจาก `E:\My work\Project Sovereign Origin`

## ๑. อะไรรันที่ไหน

| ชิ้น | ที่รัน | พอร์ต | วิธีเริ่มเอง |
|---|---|---|---|
| PostgreSQL (`sovereign-db`, TimescaleDB) | Docker (compose ที่ `sovereign-os/infra/`) | 5432 | `docker compose up -d timescaledb` |
| MQTT (`sovereign-emqx`) | Docker | 1883 / 18083 | `docker compose up -d emqx` |
| API (`sovereign-core-api`) | Docker | 3001 | `docker compose up -d core-api` |
| เว็บ Dashboard | **bare-metal** `next start` บน E: | 3000 | `node frontend-watchdog.mjs` (ตัวมันสตาร์ทเว็บให้) |
| เดสก์ท็อป shell | `dist-portable\Sovereign OS.exe` | — | ดับเบิลคลิก |

**ห้ามสตาร์ท compose service `frontend`** — ถูกถอดออกจาก stack แล้ว (commit `575e873`) เว็บ :3000 รันบนเครื่องเป็นตัวเดียวเท่านั้น

## ๒. บูตหลังเปิดเครื่อง (อัตโนมัติ — ไม่ต้องทำอะไร)

```
Windows Startup → sovereign-autostart.vbs → autostart.mjs
  1) รอ Docker Desktop พร้อม
  2) docker compose up -d timescaledb emqx core-api
  3) node frontend-watchdog.mjs  (เฝ้าเว็บ :3000 ตลอดชีวิตเครื่อง)
```

ถ้า Docker ยังไม่พร้อมตอนบูต ตัวสคริปต์ข้ามขั้น compose ไปเอง → รัน `start-sovereign.bat` ภายหลัง (ทำหน้าที่เดิม + รอ API พร้อม 240 วิ)

## ๓. รีสตาร์ตทีละชิ้น

```bash
cd "E:\My work\Project Sovereign Origin\sovereign-os\infra"

docker restart sovereign-core-api    # API :3001
docker restart sovereign-db          # ฐานข้อมูล (API reconnect เอง)
docker restart sovereign-emqx        # MQTT

```

ทั้งระบบพร้อมกันคำสั่งเดียว: **`start-sovereign.bat`** (ดับเบิลคลิกก็ได้)

### เว็บ :3000 ค้าง

```bash
cd "E:\My work\Project Sovereign Origin"
netstat -ano | grep ":3000" | grep -i LISTENING   # อ่าน PID จากคอลัมน์สุดท้าย
taskkill //F //PID <PID> //T
node frontend-watchdog.mjs                        # idempotent — เช็คและชุบเอง
```

โหมดของ :3000 เลือกอัตโนมัติจากไฟล์ `sovereign-frontend/.next/BUILD_ID`:

- **มี BUILD_ID = production build (`next start`)** — สถานะปกติตั้งแต่ 20 ก.ย. 2026
- **ไม่มี = `next dev`** (fallback สำหรับเครื่องที่ยังไม่เคย build)

**Rollback กลับไป next dev** (เมื่อ prod build มีปัญหา):

```bash
rm "E:\My work\Project Sovereign Origin\sovereign-frontend\.next\BUILD_ID"
netstat -ano | grep ":3000" | grep -i LISTENING   # kill PID เดิม
taskkill //F //PID <PID> //T
sleep 70                                          # รอ watchdog tick ชุบเองเป็น dev
# หรือชุบทันที: node frontend-watchdog.mjs
```

**กลับมา prod:** build ใหม่ (`cd sovereign-frontend && npm run build`) — BUILD_ID กลับมา แล้ว watchdog จะชุบเป็น prod เอง

## ๔. เช็คสุขภาพ 1 นาที (Git Bash / PowerShell)

```bash
cd "/e/My work/Project Sovereign Origin"
curl -s -o /dev/null -w "web     : %{http_code}\n"  http://localhost:3000
curl -s http://localhost:3001/healthz | grep -o '"ok":true' && echo "API     : OK"
docker ps --filter name=sovereign --format "{{.Names}}: {{.Status}}"
ls -t backups/postgres/sovereign_*.dump | head -1   # ฐานรวมชื่อ sovereign ตั้งแต่ 20 ก.ย. (ไฟล์ sovereign_v2_* เก่า = ประวัติ)
tasklist | grep -i node | grep -c .   # >0 = watchdog/node มีชีวิต
```

เกณฑ์ผ่าน: เว็บ 200 · API `"ok":true` · 3 containers ขึ้นพร้อม `(healthy)` · dump ล่าสุดวันนี้ตอน ~03:00

## ๕. สำรอง / กู้คืนฐานข้อมูล

- **สำรองอัตโนมัติ:** Scheduled Task `Sovereign DB Backup` ทุกวัน 03:00 → `backups\postgres\sovereign_v2_YYYYMMDD_*.dump` (เก็บหลายวันย้อนหลัง)
- **กู้คืน** (ทดสอบก่อนใช้จริงเสมอ) — ต้องใช้โหมด restore ของ TimescaleDB ด้วย ไม่งั้น `pg_restore` ตรง ๆ จะล้มเหลวที่ chunk catalog (ซ้อมจริงแล้ว 14 ก.ย. 2026):
  ```bash
  # 1) ฐานปลายทาง + ปลดล็อก TimescaleDB
  docker exec sovereign-db psql -U sovereign -d postgres -c "CREATE DATABASE sovereign_restore"
  docker exec sovereign-db psql -U sovereign -d sovereign_restore \
    -c "CREATE EXTENSION IF NOT EXISTS timescaledb" \
    -Atc "SELECT timescaledb_pre_restore()"

  # 2) restore
  docker exec -i sovereign-db pg_restore -U sovereign -d sovereign_restore --clean --if-exists \
    < backups/postgres/sovereign_v2_YYYYMMDD_*.dump

  # 3) ปิดโหมด restore
  docker exec sovereign-db psql -U sovereign -d sovereign_restore -Atc "SELECT timescaledb_post_restore()"
  ```

## ๖. เส้นตายก่อนเปิดสู่อินเทอร์เน็ต

1. ปิดบัญชี `e2e-bot` (SUPERADMIN, รหัสผ่านอยู่ใน repo)
2. ตั้ง CORS เป็นโดเมนจริง + เปิด HTTPS
3. จำกัดพอร์ต 1883/18083 (MQTT) ไม่ให้โลกภายนอกเห็น
4. **กติกาคำเคลม (บังคับทุกหน้า/ทุกช่องทาง): โฆษณาเฉพาะสิ่งที่มีโค้ดจริง** — ก่อนเขียนคำเคลมให้เทียบกับ repo จริง: มี service/เทสรองรับหรือไม่ (ตัวอย่างที่ผ่าน: Telegram = มี `telegram-alert.service` + เทสครบ, ออกใบกำกับ = `TaxInvoice.tsx`) · ตัวอย่างที่ถูกตัดแล้ว (18 ก.ย. 2026): LINE (ไม่มีโค้ดเลย), "operating system" (เป็นเว็บแอป+บริการหลังบ้าน) · ที่มาของกติกา + รายการคำที่ตรวจแล้ว: บันทึกใน STATUS.md วันเดียวกัน
5. **CORS ค่า default ใช้กับ LAN เท่านั้น** — `CORS_ORIGIN` ไม่ตั้ง = `http://localhost:3000` (และ Socket.IO ใช้ค่าเดียวกันตั้งแต่ 19 ก.ย. 2026 — เดิมเปิด `*` + ไม่มี auth) · ถ้าเปิดให้โลกภายนอกใช้ **ต้อง**ตั้ง `CORS_ORIGIN` เป็นโดเมนจริง + เปิด HTTPS (TLS_CERT/TLS_KEY) ก่อนเสมอ · compose ฝัง default `CORS_ORIGIN:-*` ไว้ — อย่าพึ่งค่า default ตอน expose

## ๗. เคสฉุกเฉิน: pipeline เว็บ (เป้าหมายกู้ ≤ 5 นาที)

> อาการทั้งหมดเห็นที่ **Actions → Deploy portfolio** (run ล่าสุดบน main) เทียบกับหน้าเว็บ production
> เว็บ production ไม่เคยลงแค่เพราะ deploy พัง — มันคงเนื้อหาชุดล่าสุดที่ขึ้นสำเร็จไว้เสมอ

### ๗.๑ token ตายกลางคืน (publish ถูกข้าม)

- **อาการ:** run ขึ้น warning `ยังไม่มี secret PAGES_TOKEN` (preflight) หรือ push โดน 401/403 — เว็บยังใช้ได้ แค่ไม่อัปเดต
- **กู้:** หมุน token ตาม `docs/token-rotation.md` §๒:
  1. สร้าง fine-grained PAT ใหม่ (repo `project-sovereign`, Contents read/write, 90 วัน)
  2. `gh secret set PAGES_TOKEN -R krisakornutama/sovereign-origin` (พิมพ์ค่าตอบโต้ — ห้ามวางใน chat/log)
  3. แก้ตัวแปร `PAGES_TOKEN_EXPIRES` ให้ตรงวันหมดอายุใหม่
  4. ยิงทดสอบ: `gh workflow run deploy-portfolio.yml -R krisakornutama/sovereign-origin`
- **ทางเลือก: เผยแพร่ทันทีจากเครื่องโดยไม่รอ CI** (publish repo อยู่ในเครื่องอยู่แล้ว):
  ```bash
  cd "/e/My work/Project Sovereign Origin"
  node tools/publish-portfolio.mjs --message "manual publish (CI token dead)"
  node tools/indexnow-notify.mjs --wait   # ยิงบอทค้นหาทีหลัง หลังเห็น production เปลี่ยน
  ```
- **ยืนยัน:** run ใหม่เขียว + `curl -s https://krisakornutama.github.io/project-sovereign/sitemap.xml | grep -o 'lastmod>[0-9-]*' | head -1` ได้วันล่าสุด

### ๗.๒ publish repo ถูก lock

- **อาการ:** step Sync ล้ม — push โดน `protected branch hook rejected` / `repository is archived` / `repo lock`
- **วินิจฉัย:** `gh repo view krisakornutama/project-sovereign --json isLocked,isArchived,viewerPermission` และดู branch protection/ruleset ของ repo นั้น (Settings → Branches)
- **กู้:** ปลด lock/archive หรือปรับกฎบน `project-sovereign` → ยิง `gh workflow run deploy-portfolio.yml -R krisakornutama/sovereign-origin` ใหม่ · ถ้าเพิ่ง rewrite history และต้อง force: `git fetch origin && git push --force-with-lease origin main` จาก publish repo (ห้ามใช้ `--force` เปล่า)
- **ยืนยัน:** `gh api repos/krisakornutama/project-sovereign/commits/main --jq .sha` เปลี่ยนเป็น sha ใหม่

### ๗.๓ Pages deploy ค้าง (push สำเร็จแต่ production ไม่เปลี่ยน)

- **อาการ:** IndexNow ขึ้น `⏱ ยังไม่ตรง` (รอหลายนาที) · deployment บน `project-sovereign` ค้าง pending หรือ error
- **วินิจฉัย:**
  ```bash
  gh api "repos/krisakornutama/project-sovereign/deployments?per_page=3" --jq '.[0].id, .[0].sha'
  gh api "repos/krisakornutama/project-sovereign/deployments/<ID>/statuses" --jq '.[0].state'
  ```
- **กู้:** สั่ง build ใหม่ของ Pages โดยตรง:
  ```bash
  gh api -X POST repos/krisakornutama/project-sovereign/pages/builds   # เข้าคิว build ใหม่
  # หรือ re-run workflow: gh run rerun <run-id ของ pages-build-and-deployment>
  ```
  รอ 1–2 นาที ถ้ายังค้างซ้ำ ดู log ของ workflow `pages-build-and-deployment` ที่ repo นั้น (มักเจอไฟล์ >100MB หรือ Jekyll error — repo นี้มี `.nojekyll` แล้วจึงน่าจะเป็นขนาดไฟล์)
- **ยืนยัน:** production ตอบเนื้อหาชุดล่าสุด (`curl` sitemap lastmod) แล้วยิง IndexNow เอง: `node tools/indexnow-notify.mjs --wait`

## ๘. สุขภาพความปลอดภัยของ pipeline (ตรวจครั้งล่าสุด 2026-09-17)

| หัวข้อ | สถานะ |
|---|---|
| `GITHUB_TOKEN` ค่าเริ่มต้น | **read** ทั้ง repo + ห้ามอนุมัติ PR (Settings → Actions → General) |
| สิทธิ์ราย workflow | ทั้งหมด `contents: read` — เว้น token-expiry-watch (`issues: write` ตามหน้าที่) |
| Deploy keys | 0 ตัว |
| Secrets | `PAGES_TOKEN` ตัวเดียว (เดินทางผ่าน env + http.extraheader — ดู §๗.๑) |
| Dependabot security updates | enabled — **alerts เปิดค้าง 0** (ปิดครบ 10 เมื่อ 2026-09-17 ใน `f02ee74`: multer 2.4.0, qs 6.16.0*, uuid 11.1.1*, next 16.3.5, sharp 0.35.4 — * = npm overrides เพราะ express/body-parser และ node-cron pin ด้วย tilde) |
| Dependabot version updates | `.github/dependabot.yml` — รายสัปดาห์วันเสาร์ รวมกลุ่ม patch/minor เป็น PR เดียวต่อ ecosystem · major ถูก hold back (ยกเว้น security) |
| Secret scanning / push protection | **พร้อมใช้ — repo เป็น public ตั้งแต่ 18 ก.ย. 2026** — เปิดผ่าน Settings → Advanced Security (ก่อนเปิดตรวจประวัติแล้ว: hit เดียวของ `github_pat_` คือ fake fixture ใน token-hygiene เทส `27503c4` ไม่ใช่ token จริง) |
| Required checks บน main | **พร้อมตั้งครบ 6** — `audit`, `size`, `publish` โหมด PR, `Core API tests / test (ubuntu-latest)`, `Core API tests / test (windows-latest)`, **`Core API tests / test-db`** (context ล่าสุดเพิ่มใน `7b90e5c` · ยืนยันจาก check-runs จริงของ commit `1be5fa6`: audit/size/test (ubuntu)/test (windows)/test-db = เขียวครบ 5 ตัว) — **บังคับจริงแล้ว (18 ก.ย. 2026)**: repo เป็น public + `set-required-checks.sh --apply` ตั้งสำเร็จ — ยืนยันจาก branch protection API: ครบ 6 contexts รวม **`Core API tests / test-db`**, strict=true · บั๊กสคริปต์ที่จับตอน apply จริง (โหมด apply ไม่เคยถูกรันจนวันนี้): `$(printf …)` แตก context ที่มีช่องว่างเป็น 25 args → แก้เป็น array สะสม args, และ `-f strict=true` โดน 422 เพราะส่งสตริง → แก้เป็น `-F` (typed boolean) · คู่มือ: `docs/enable-required-checks.md` |
| CI: Core API tests | `core-api-tests.yml` — **2 jobs**: `test` (เมทริกซ์ ubuntu+windows × Node 24, mock suite, `TZ=Asia/Bangkok` ตรง prod) + `test-db` (ubuntu + Postgres 15 service container, `prisma db push` แล้วรัน real-DB lifecycle ผ่าน `RUN_DB_TESTS=1` ด้วย harness กลาง `tests/db-harness.ts` — knowledge upload (รวมเส้นทาง AV quarantine ด้วยไฟล์ EICAR + Threat Intel FILE hit แบบ seed hash จริง) + documents scan-to-inventory + treasury slip + OTA firmware + whisper disk lifecycle ผ่าน `WHISPER_RUN_OVERRIDE` + detections (Camera จริง → detection_events → vision-rule เปิดไฟล์จากพาธใน DB จริง) + สัญญา security_events (INTRUSION / MALWARE_DETECTED / vocabulary ทุกแถว) + Dime import (multipart PDF → dime_statements + asset_positions + asset_prices จริง, dedupe ผ่าน UNIQUE(raw_text_hash) จริง) + **Telegram alert content ของ Dime ผ่าน DI** (`setTelegramAlertSender` แทน sender ปลอม — พิสูจน์เนื้อหา alert ⚠️ WARN ตรงเหตุผล parse ทั้งกรณี PDF เสียและแจ้ง IMAP โดยไม่ยิง network): `tests/knowledge-db.test.ts`, `tests/uploads-db.test.ts`, `tests/vision-detections-db.test.ts`, `tests/security-events-db.test.ts`, `tests/dime-db.test.ts`) — เขียวครบตั้งแต่ `2027836` ล่าสุด run `35242162204` บน head `1be5fa6` = success ทั้ง 2 jobs (5m26s)
| CI: test:db บนเครื่อง | `npm run test:db` = `tools/test-db-local.mjs` — รันชุด real-Postgres เดียวกับ job `test-db` บนเครื่องจริง: หา container `sovereign-db` + รหัสผ่านจาก `sovereign-os/infra/.env` → สร้าง TCP forwarder จิ๋วใน container publish พอร์ต 15432 (แก้ปัญหา WSL relay กิน startup packet ของ 5432) → `prisma db push` ฐาน `sovereign_test` → รัน 5 ไฟล์ `-db.test.ts` (30 เทส, `--test-concurrency=1`) → เก็บกวาด forwarder เอง — ผ่านครบ 30/30 เมื่อ 17 ก.ย. 2026 · **รวมเข้า quality gate แล้ว**: `npm run verify -- --db` = 6 ขั้น (build → mock → typecheck → next build → real-DB → **coverage จาก `coverage:core` แบบไม่บังคับ threshold**; พิสูจน์จบรอบจริง 6/6 เมื่อ 18 ก.ย. 2026) (ไฟล์รันเนอร์ test-db-local ไม่ถูก track ตามกฎ `tools/*` — อยู่บนเครื่องนี้เท่านั้น ตามที่มันต้องแตะ Docker/ดิสก์เครื่องจริง) |
| Desktop release ความปลอดภัย | **v1.1.1 published จริง (18 ก.ย. 2026)** — **เวอร์ชันแรกที่แพ็กเกจมีด่านในตัว** (v1.1.0 สร้างก่อนด่านถูกเขียน — updater ของ v1.1.0 ยังดาวน์โหลดได้โดยไม่ตรวจ จนกว่าจะได้ v1.1.1) · asset `Sovereign-OS-1.1.1-portable.exe` (sha256 `598957a6…fc06eca` = GitHub digest ตรงทุกไบต์) + `SHA256SUMS.txt` · ด่าน fail-closed (`electron/verify-asset.js`): ไม่ตรง/ไม่มีลายเซ็นอ้างอิง/ตรวจไม่ได้ = ลบไฟล์ ไม่เปิดติดตั้ง · **พิสูจน์ในแอปจริงครบ 2 ทิศ** (เชลล์ dev ผ่าน IPC + inspector, จำลองฝั่งลูกเท่านั้น — release จริงไม่ถูกแตะ): ลายเซ็นไม่ตรง → "ยกเลิกการติดตั้ง — ลายเซ็นไม่ตรง… ลบไฟล์ที่ดาวน์โหลดแล้ว" + ไฟล์หายจริง + openPath=0 · ลายเซ็นตรง → ผ่านด่าน (GitHub digest) + openPath 1 ครั้ง (ตัวบันทึก ไม่รันจริง) · **จับ+แก้บั๊ก wiring จริง:** `downloadFile` เดิมไม่ settle เมื่อไฟล์ปลายทางเขียนไม่ได้ (EPERM ก่อน listener = IPC ค้างเงียบ) → แยกเป็น `electron/download.js` + เทส regression 7 เคสใน `tools/test/download.test.mjs` (ต้องแก้เพิ่ม: transport ตาม protocol + Location แบบ relative) · เทสด่าน 12/12 (`verify-asset.test.mjs`) — รวม 19/19 ใน `npm run test:tools` · แอปแพ็กเกจ v1.1.1 บูตจริง: log `version 1.1.1` + `tray created` + `packaged: true`, ตรวจอัปเดตตอนรันตอบ `latest=v1.1.1, hasUpdate=false` · วงจรปล่อย release: §๑๐ |
| Socket.IO + ai-models (API) | **ด่านใหม่ 19 ก.ย. 2026** (`89e708b`): Socket.IO ต้อง **JWT + mfa_verified** ตอน handshake · CORS ใช้ `config.corsOrigin` เดียวกับ Express (เดิมเปิด `*` + ไม่มี auth) · payload ทุก broadcast ถูกตัดเหลือ allowlist ต่อ event ที่ `src/realtime/socket.ts` · เทส `socketAuth.test.ts` 7/7 (พูดโปรโตคอล EIO=4 ผ่าน ws ไม่เพิ่ม dep) · **ai-models ทุกเส้นทาง authenticate + SUPERADMIN** บน pull/import/route/delete/unload (เดิมเปิดหมด) · เทส `ai-models-auth.test.ts` 6/6 — จับบั๊กเพิ่ม: pull route เขียน res หลัง client disconnect → เติม `res.on('close')` · **หมายเหตุ:** container `sovereign-core-api` ที่รันอยู่ต้อง rebuild/restart จึงจะใช้ด่านใหม่จริง |
| บัญชี admin + MFA | **สถานะ 19 ก.ย. 2026:** รหัสตายตัว `123456` **ไม่ใช่** รหัสของ admin มาแล้ว — seed ถูก hardened (ใช้ `SEED_ADMIN_PASSWORD` จาก env หรือสุ่ม 16 ตัวปริ้นท์ครั้งเดียว; พิสูจน์ด้วยยิง login → 401 + เทียบ bcrypt ใน DB ตรง = false) · กรอกรหัสซ้ำ ๆ → **429 ล็อกบัญชี 15 นาที** (ด่าน brute-force ต่อบัญชีทำงานถูกต้อง ไม่ใช่บั๊ก; limiter อยู่ใน memory — รีสตาร์ต container คือการเคลียร์) · **วิธีกู้:** `node scripts/reset-admin-and-verify.mjs` ใน core-api (ตั้งรหัสใหม่ปริ้นท์ครั้งเดียว + พิสูจน์ login→2FA→authed ครบวงจร; ส่ง `ADMIN_PASSWORD=...` เพื่อใช้รหัสเดิมต่อ) · **MFA ปิดชั่วคราวตามคำสั่งเจ้าของ** (ยังไม่ใช้งานจริง): ยกเลิกผ่านทางการ `/api/auth/mfa/disable` (login → verify-mfa ด้วย secret ใน DB → disable) พิสูจน์แล้ว login รอบใหม่ได้ full token ทันที (`mfa_required=false`) + `mfa_secret` ใน DB ว่าง · **เปิดใหม่:** ปุ่มตั้งค่าในแอป (enroll → สแกน QR → confirm) — เมื่อเปิดแล้วด่านที่ต้อง `mfa_verified` (Socket.IO handshake, SSE, SUPERADMIN) จะกลับมาเข้มเต็มรูปแบบ · รหัสผ่านถูกปริ้นท์ครั้งเดียวให้เจ้าของเก็บเอง — ห้ามบันทึกลงไฟล์ที่ถูก track |
| Coverage: core-api | วัดอัตโนมัติด้วย **`npm run coverage:core`** (c8 ใน devDependencies, ชุด mock ล้วน ไม่ต้องมี DB) — ล่าสุด 18 ก.ย. 2026 (1,097+34 เทส ผ่านครบ): **lines 63.76% · branches 75.02% · functions 81.94%** · ไม่มี threshold บังคับ (กะจกส่อง ไม่ใช่กับดัก) · หลุมใหญ่ 10 อันดับแรก: ดู §๙ |
| CI: กฎเวลาท้องถิ่น | เทสใหม่ห้ามยึดเวลาเครื่อง (`getHours`) โดยไม่ inject `now` — CI วิ่ง Asia/Bangkok เท่านั้น (case จริง: agentTeam morning reports, `7cd7b9e`) |
| CI: กฎชื่อไฟล์ | ไฟล์ที่สร้างต่อเนื่องใน ms เดียว (bundle/upload) ต้องมี suffix สุ่ม — ชื่อ timestamp ล้วนชนกันบน Linux (case จริง: mesh-lite, `2027836`) |
| Test flake: Prisma engine ในชุด mock | **แก้ที่รากแล้ว (18 ก.ย. 2026)** — อาการเดิม: ไฟล์เทสล้ม**ทั้งไฟล์แบบสุ่ม** (telegram/firstResponder/ota/mesh-lite/businessPlatform เคยโดน) ด้วย `Unable to deserialize cloned data` หรือ `'test failed'` ระดับไฟล์ ทั้งที่ subtest ไม่พังเอง · ต้นเหตุ: โค้ดที่เรียก Prisma โดยไม่มีใคร stub (เช่น `sendTelegramAlert` แบบ fire-and-forget ของ mesh-lite → `getTelegramCredentials` → `systemSetting.findMany`) ปลุก Prisma engine จริงให้วิ่งหา `127.0.0.1:5432` ปลอม (DATABASE_URL ของชุด mock) — engine (native worker) รบกวน IPC ของ test runner จน report เสีย · ทางแก้: `tests/setup-env.ts` ผูก delegate no-op "ตารางว่าง" ให้ทุกโมดูล**เฉพาะชุด mock** (`RUN_DB_TESTS !== '1'` — ชุด real-DB ไม่ถูกแตะ) + `mockModel` เฉพาะจุดใน telegram/firstResponder + เพิ่ม listener `error` ให้ MQTT client ของ ota.routes (กัน uncaught ทั้ง process เมื่อ broker ล่ม — เป็นบั๊ก prod ที่แฝงมาด้วย) · **วิธีแยกแยะว่าไม่ใช่บั๊ก verify:** verify แค่รัน `npm test` แล้วสะท้อน exit code — ถ้าพังให้รัน `cd sovereign-os/core-api && npm test` ตรง ๆ: ผ่านเมื่อรันตรงแต่พังผ่าน verify = flake timing ของเทส · ล้มทั้งไฟล์โดยไม่มี subtest พัง = ปัญหาระดับ process/IPC ไม่ใช่ assertion · พิสูจน์หลังแก้: ชุดเต็ม (พาธทางการ `npm test`) **3/3 รอบ** + `npm run verify -- --db` **3/3 รอบ** (มี/ไม่มี server บน :3000) เขียวครบ |

ทบทวนรอบถัดไปเมื่อ: อัปเกรดแพลน / เพิ่ม secret ใหม่ / เพิ่ม workflow ใหม่

## ๙. แผนที่ช่องว่างเทส core-api (วัด 18 ก.ย. 2026 ด้วย `npm run coverage:core` — ชุด mock ผ่านครบ)

> วิธีวัด: **`npm run coverage:core`** = c8 + `tests/*.test.ts` แล้วพิมพ์ตัวเลขรวม + ไฟล์ 0% ใหญ่สุด + หลุมบรรทัดมากสุด (c8 อยู่ใน devDependencies ของ core-api แล้ว) · ที่มาของอันดับ = จำนวน**บรรทัดที่ยังไม่ถูกครอบ** · ตัวเลข total: lines **63.76%** · branches **75.02%** · functions **81.94%** (บรรทัดที่วัด 39,390 — ขึ้นจาก 61.64% หลังปิดหลุม health + restaurant ในรอบเดียวกัน)

| # | ไฟล์ | ไม่ครอบ/รวม (บรรทัด) | อะไรอยู่ข้างใน — จะเทสอะไรก่อน |
|---|---|---|---|
| 1 | `src/modules/knowledge/teach.routes.ts` | 675/675 (0%) | AI สอนลูกทั้งโมดูล — **รีวิวความปลอดภัยเนื้อหาเด็กเสร็จแล้ว** ที่ `sovereign-os/core-api/docs/teach-kids-security-review.md` (R1 ความเสี่ยงสูงสุด = เนื้อหาจาก AI ไม่มีด่านกรอง) — แผนเทสอยู่ท้ายเอกสารนั้น |
| 2 | `src/workers/start.ts` | 657/657 (0%) | ตัวติดตั้ง cron/worker ทั้งหมด — โครงสร้าง wiring ล้วน; อย่าวัดให้ถึง 100% — เทสปลายทางต่อ worker ที่เหลือแบบ `defcon-dryrun` |
| 3 | `src/modules/ai/ai.routes.ts` | 510/706 (27.8%) | เส้นทาง AI router/Ollama — แตะถึง router เลือกโมเดลแล้ว แต่ยังไม่ครอบ fallback/timeout/error บางเส้น |
| 4 | `src/services/dem-processor.service.ts` | 387/387 (0%) | อ่าน GeoTIFF ความสูง (DEM/DSM) — ต้องมีไฟล์ fixture เล็ก ๆ |
| 5 | `src/services/scenario-forecast.service.ts` | 376/514 (26.8%) | คาดการณ์สถานการณ์ % — ครอบส่วนคำนวณพื้นฐานแล้ว เหลือกิ่งเงื่อนไขพิเศษ/ข้อมูลไม่ครบ |
| 6 | `src/modules/security/nextgen.routes.ts` | 365/365 (0%) | เส้นทาง nextgen — `/av/scan` มี real-DB test แล้ว (`uploads-db`); ที่เหลือ = firewall/proxy ผ่าน mock |
| 7 | `src/modules/security/security.routes.ts` | 315/315 (0%) | เส้นทาง security หลัก — real-DB suite ครอบบางเส้น (security_events) แต่ mock ไม่แตะเลย |
| 8 | `src/services/coding-agent.service.ts` | 282/421 (33.0%) | Coding Agent — ครอบแผนแล้ว เหลือทางเขียนไฟล์/ยกเลิกกลางทาง |
| 9 | `src/modules/property/property.routes.ts` | 269/269 (0%) | ผังที่ดิน/หลักผัง — มี `propertyOwner` เทส resolveOwnerId แล้วบางส่วน (คนละโมดูล) |
| 10 | `src/services/tplink-mr505.service.ts` | 257/257 (0%) | ควบคุมเราเตอร์ TP-Link — เทสด้วย HTTP mock แทนเราเตอร์จริง |

**ปิดแล้วในรอบนี้:** `health.routes.ts` (เดิม 505/505 · 0%) และ `restaurant.routes.ts` (เดิม 380/380 · 0%) → มีเทส HTTP จริง `tests/health.routes.test.ts` (15 เทส: validation/triage flag/consent/contraindication/export) + `tests/restaurant.routes.test.ts` (19 เทส: สิทธิ์/กันเลขผิด/PDPA/วงจรออเดอร์จนจ่าย ตัดสต็อก-แต้ม-treasury/รายงาน) — หลุมเดิมอันดับ 4 กับ 6 หลุดจากลิสต์

รองลงมา (แตะได้เร็ว): `learning-engine.service.ts` 245 (0%) · `AiAgentService.ts` 256/485 (~47%) · `risk.routes.ts` 211 (0%) · `relay.routes.ts` 198 (0%)

กติกาตีความ: แถว "0%" = ไฟล์ไม่ถูก import ในชุด mock เลย (ครอบผ่าน HTTP mock server ด้วยแพทเทิร์น `createTestServer` เดิม — พิสูจน์แล้ว 2 โมดูลในรอบนี้) · แถว % ปานกลาง = เติมเฉพาะกิ่งที่ขาด · วัดซ้ำได้ทุกเมื่อด้วย `npm run coverage:core` (~2 นาที ไม่ต้องมี DB) — และตอนนี้รันอัตโนมัติเป็นขั้นสุดท้ายของ `npm run verify -- --db` แล้ว (ไม่บังคับ threshold)

## ๑๐. วงจรปล่อย release แอป desktop (ทำตามนี้ทุกครั้ง)

> หลักการ: **ตัวติดตั้งทุกตัวต้องมีลายเซ็นอ้างอิง** — updater ของเครื่องผู้ใช้จะตรวจ SHA-256 ก่อนเปิดรัน และ**ไม่มีลายเซ็น = ลบทิ้ง** (fail-closed) ดังนั้นลืมขั้นที่ 3 = release นั้นใช้ auto-update ไม่ได้เลย

1. **bump เวอร์ชัน:** `sovereign-frontend/package.json` → เปลี่ยนค่า `"version": "1.x.y"`
2. **build:** `cd sovereign-frontend && npm run electron:build` (ได้ `dist-electron/Sovereign-OS-<ver>-portable.exe` + zip · ใช้เวลานาน จัดสิทธิ์เครื่องว่าง)
3. **สร้าง SHA256SUMS.txt:** `cd dist-electron && sha256sum Sovereign-OS-<ver>-portable.exe > SHA256SUMS.txt` (รูปแบบมาตรฐาน `<64hex>␣␣<ชื่อไฟล์>`)
4. **เผยแพร่:** `gh release create v<ver> <ไฟล์ exe> SHA256SUMS.txt --repo krisakornutama/sovereign-origin --title "..." --notes "..."` (อย่าลืม SHA256SUMS ในคำสั่งเดียวกัน — ถ้าแยกให้ `gh release upload v<ver> SHA256SUMS.txt --clobber` ต่อ)
5. **ยืนยันลายเซ็นอ้างอิง:** `gh api repos/.../releases/latest --jq '.assets[].name'` ต้องเห็น exe + SHA256SUMS.txt และ digest ของ API ต้องตรงกับ SHA256SUMS
6. **พิสูจน์ในแอปจริง:** รัน `win-unpacked/Sovereign OS.exe` ที่เวอร์ชันเก่ากว่า → ตรวจอัปเดต → ต้องเห็นเวอร์ชันใหม่ + ปุ่มดาวน์โหลด · ทดสอบด่าน: ไฟล์ดาวน์โหลดถูกแก้ = updater ลบทิ้ง ไม่เปิดรัน
7. **อัปเดตเอกสาร:** STATUS.md (สถานะ+บันทึกวงจร) + แถว "Desktop release" ใน §๘ ของไฟล์นี้

> สถานะปัจจุบัน: v1.1.0 ผ่านครบทุกขั้นแล้ว (18 ก.ย. 2026) — ตัวอย่างที่ใช้งานจริงของวงจรนี้
