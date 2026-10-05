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
# จบแค่นี้ — watchdog ที่รันอยู่ชุบเองภายใน ≤30 วิ (tick ทุก 30 วิ)
# อย่ารัน `node frontend-watchdog.mjs` ซ้ำ: มันไม่ออกเอง จะกลายเป็น poller ซ้ำสองตัว (ทดสอบจริง 20 ก.ย. 2026)
# ปลุก watchdog ใหม่เฉพาะเมื่อมันตาย:
#   powershell Start-Process node -ArgumentList 'frontend-watchdog.mjs' -WorkingDirectory 'E:\My work\Project Sovereign Origin' -WindowStyle Hidden
```

โหมดของ :3000 เลือกอัตโนมัติจากไฟล์ `sovereign-frontend/.next/BUILD_ID`:

- **มี BUILD_ID = production build (`next start`)** — สถานะปกติตั้งแต่ 20 ก.ย. 2026
- **ไม่มี = `next dev`** (fallback สำหรับเครื่องที่ยังไม่เคย build)

**Rollback กลับไป next dev** (เมื่อ prod build มีปัญหา):

```bash
rm "E:\My work\Project Sovereign Origin\sovereign-frontend\.next\BUILD_ID"
netstat -ano | grep ":3000" | grep -i LISTENING   # kill PID เดิม
taskkill //F //PID <PID> //T
# รอ watchdog ชุบเองเป็น dev — วัดจริง 20 ก.ย. 2026: 57 วิ (tick ≤30 วิ + dev boot ~27 วิ)
# ยืนยันโหมดจริงเสมอ — dev ก็ตอบ 200 เหมือน prod ต้องดู cmdline:
#   powershell "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"" | grep -oE 'next" (start|dev)'
```

**กลับมา prod:** ต้อง kill dev ก่อน build — watchdog จะไม่สลับเองถ้า :3000 ยังตอบ!

### EOL ต้องเป็น LF ทั้งโฟลเดอร์ทำงาน (เพิ่ม 2/10/69 — กติกาที่แก้บั๊กแย่กว่าที่คิด)

`.gitattributes` บังคับ `* text=auto eol=lf` (ยกเว้น `.bat`/`.cmd` = CRLF และไฟล์ binary) เพราะ `core.autocrlf=true` เคยทำให้ **โฟลเดอร์ทำงานหนึ่งเดียวมีไฟล์ปนกันสองแบบ** — ตอนนี้ราก repo เป็น LF 999 ไฟล์ + CRLF 16 ไฟล์ (bat/cmd) · build จาก commit เดียวกันจึงได้ byte เดียวกัน (พิสูจน์แล้ว: MAIN กับ worktree fingerprint `85fbf786e09b4562` ตรงกัน 228 ไฟล์)

- **`git status` มองไม่เห็น CRLF ที่หลงเหลือ** — เพราะ clean filter แปลง CRLF→LF ก่อนเทียบ (ไฟล์ที่เคยถูกเครื่องมือเขียนทับจะค้างเป็น LF/CRLF ผสมโดย git ยังบอกว่าสะอาด) · `git ls-files --eol` ก็ไม่ช่วย (อ่านจาก stat cache) → **ต้องใช้ตัวมือที่อ่านไฟล์จริง**
- รันครั้งเดียวหลัง clone/checkout เก่า: `node tools/normalize-eol.mjs` (ตรวจโดยไม่แก้: `--check` · exit 1 ถ้ายังมี · ใช้เป็น CI gate ได้)
- ไฟล์ binary (`.png`/`.ttf`) มีไบต์ `0x0D` อยู่จริงโดยธรรมชาติ = **ไม่ใช่ปัญหา** เครื่องมือข้ามให้อัตโนมัติ (เคยพังตรงนี้: วน parse attribute ผิด stride → ไปแก้ `.ttf` จนไฟล์เสีย กู้คืนด้วย `rm` + `git checkout-index -f`)

### nightly verify 02:00 — รันอะไรบ้างและดูผลที่ไหน (เพิ่ม 2/10/69)

Task Scheduler ชื่อ **Sovereign Nightly Verify** → `tools/nightly-verify.mjs` (ลงทะเบียนครั้งเดียว: `powershell -File tools/register-nightly-task.ps1`) · ทดสอบทันที: `Start-ScheduledTask -TaskName 'Sovereign Nightly Verify'`

ลำดับในรอบหนึ่ง (รวม ~6–20 นาที):

1. `machine-health.mjs` — แจ้งปัญหาเครื่อง (แรม/ดิสก์/docker) **ก่อน** verify จะพัง
2. **เช็ค backend :3001 → ถ้าตายให้ `docker compose up -d` รอสุด 180 วิ** (เพิ่ม 2/10/69 — เคยรายงาน "ผ่าน" ทั้งที่สเปก 0 ตัวถูกรัน เพราะเครื่องรีบูตแล้ว docker ยังไม่ขึ้นตอน 02:00) · ถ้ายังไม่ขึ้น = รันแค่ `npm run verify` + รายงานว่า e2e ถูกข้ามพร้อมเหตุผล
3. `npm run verify:full` พร้อม `E2E_REQUIRE_BACKEND=1` = **e2e ห้ามถูกข้ามเงียบ** (ถ้า backend ตายกลางทาง = ต้อง fail ให้เห็น)
4. `IndexNow` → `SEO pre-flight` → `GSC coverage` → `backup restore-check` (fail-safe ทุกตัว ล้มไม่ทำให้รอบพัง แต่ต้องเห็นในรายงาน)
5. เขียน `logs/nightly/status.json` + ส่ง Telegram

**อ่านสัญญาณที่รายงานส่งมา:**

| สัญลักษณ์ | แปลว่า |
|---|---|
| ✅ ผ่าน | ทุกอย่างรันครบ รวม e2e |
| ⚠️ ผ่าน (มีขั้นข้าม) | มีบางอย่าง**ไม่ได้ตรวจ** — ดูบรรทัด "ข้าม N รายการ" พร้อมเหตุผล (ห้ามนับเป็นผ่าน) |
| 🚨 ไม่ผ่าน | มีขั้นตอนพัง ดู `logs/nightly/last-run.log` |
| "เกตล่าสุด: ไม่ทราบ" | gate ล้มก่อนเขียนผล = ไม่รู้ว่าขั้นไหนพัง (รายงานจะไม่อ้างผลของรอบเก่าแล้ว) |

สวิตช์ทดลอง: `NIGHTLY_SKIP_RESTORE=1` (ข้าดการกู้ dump) · `NIGHTLY_REPORT_DRY=1` (พิมพ์ข้อความลง `logs/nightly/report.log` ไม่ส่ง Telegram จริง) · log ทั้งหมด: `logs/nightly/`

### `verify:full` แตะ :3000 อย่างไร (เพิ่ม 2/10/69 — ทำให้รอบ gate ผ่านได้จริง)

`npm run verify:full` = build ทับ `.next` ของ prod → ต้อง kill แล้วบูตใหม่ก่อน e2e ไม่งั้น chunk เก่า/ใหม่ผสมกัน 404

- `taskkill` **ต้องมี `/T`** — `npm run start` spawn ลูก `next start` ที่เป็นตัวถือพอร์ตจริง (kill แค่พ่อ = ลูกยังถือ :3000 → server ใหม่ bind ไม่ได้)
- watchdog มีตารางเวลาของมันเอง — verify รอ 20 วิ แล้ว **บูตเองเอง** (ไม่รอ 90 วิ) พยายามได้ 3 ครั้ง ถ้ายังไม่ขึ้นจะพิมพ์หาง log ที่ `logs/frontend-restart.log` พร้อมบอกว่าบูตจากโฟลเดอร์ไหน
- **ถ้ารัน verify จาก worktree**: :3000 จะถูกบูตด้วย build ของ worktree เพื่อให้ e2e ทดสอบโค้ดใหม่ → **verify คืนพอร์ตให้ MAIN เองตอนจบ** (ไม่งั้นโดเมนจริง 502 วันที่ worktree ถูกลบ)
- Prod-Truth Gate เทียบ fingerprint กับ **dist ของ deploy root (MAIN)** เสมอ ไม่ใช่ dist ของ worktree — เพราะ `core.autocrlf=true` ทำให้ checkout สองที่ได้ EOL ต่างกัน (2 ไฟล์ = 21 ไบต์) → เทียบผิดที่ = ล้มทั้งที่โค้ดเหมือนกัน

```bash
netstat -ano | grep ":3000" | grep -i LISTENING   # kill dev ทั้งกิ่งก่อน
taskkill //F //PID <PID> //T
cd "E:\My work\Project Sovereign Origin\sovereign-frontend" && npm run build
# watchdog ชุบเป็น prod เอง — วัดจริง ~1 วิ (16:47:53 เริ่ม → 16:47:54 ตอบ)
```

⚠️ บทเรียนจริง 20 ก.ย. 2026: dev ตัวค้างแย่งพอร์ต :3000 กลับไปเงียบ ๆ และ dev boot จะลบ BUILD_ID ทิ้ง
— watchdog แยก prod/dev ไม่ได้จาก HTTP (ตอบ 200 เหมือนกัน) จึงต้องยืนยันโหมดด้วย cmdline เสมอ

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

- **สำรองอัตโนมัติ:** Scheduled Task `Sovereign DB Backup` ทุกวัน 03:00 → `backups\postgres\sovereign_YYYYMMDD_*.dump` (เก็บหลายวันย้อนหลัง)
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
- **พิสูจน์เองอัตโนมัติ (2/10/69):** `node tools/verify/backup-restore-check.mjs` — กู้ dump ล่าสุดเข้า DB ชั่วคราว `sovereign_restore_check` (อ่านอย่างเดียว · ฐานจริงไม่ถูกแตะ) แล้วเทียบทีละตาราง: ตารางครบไหม · มีตารางไหนแถวมากกว่าฐานจริง (= เพี้ยน) · migration head ตรงไหม → เขียน `logs/backup-restore-check.json` · **รันทุกคืนหลัง verify:full** (ปิดได้ด้วย `NIGHTLY_SKIP_RESTORE=1`) · ผิดปกติ = แจ้ง Telegram เป็นเรื่องด่วน · ผลรอบแรก 2/10: ผ่าน 131/131 ตาราง (TimescaleDB ต้องมี pre/post_restore ตามข้างบน ไม่งั้นล้มที่ `could not find hypertable`)

## ๖. เส้นตายก่อนเปิดสู่อินเทอร์เน็ต

1. ปิดบัญชี `e2e-bot` (SUPERADMIN, รหัสผ่านอยู่ใน repo) — **2/10/69 แก้โดยไม่ผ่อนเส้นตาย:** e2e สุ่มรหัสใหม่ตอนเริ่มรัน (`e2e/global-setup.ts` → `core-api e2e-account grant`) แล้วล็อกกลับทันทีตอนจบ (`global-teardown` → `revoke`) = นอกช่วงเทสต์บัญชียังล็อกเหมือนเดิม ไม่มีรหัสที่รู้อยู่ใน repo · ดูวิธีสั่งเอง: `node sovereign-os/core-api/dist/scripts/e2e-account.js grant|revoke e2e-bot`
   - **ข้อควรรู้:** account limiter = 5 ครั้ง/15 นาที ต่อ username (`auth.routes.ts`) — ถ้ารัน e2e ซ้ำใน 15 นาทีเดียวกันจะโดน 429 (auth.setup ลดเหลือ 1 ครั้งต่อรอบแล้ว แต่รอบที่ 2 ใน 15 นาทียังชน) → ถ้าเจอ 429 ให้รอ 15 นาที หรือ `docker restart sovereign-core-api` เพื่อล้างตัวนับในหน่วยความจำ
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

> วิธีวัด: **`npm run coverage:core`** = c8 + `tests/*.test.ts` แล้วพิมพ์ตัวเลขรวม + ไฟล์ 0% ใหญ่สุด + หลุมบรรทัดมากสุด (c8 อยู่ใน devDependencies ของ core-api แล้ว) · ที่มาของอันดับ = จำนวน**บรรทัดที่ยังไม่ถูกครอบ** · ตัวเลข total **ล่าสุด 3/10/69: lines 68.34%** (30,120/44,070) · branches 74.77% · functions 84.15% (บรรทัดที่วัด 39,390 → 44,070 หลังเพิ่มเทสต์ 4 โมดุล)
> **ตารางข้างล่างเป็นสำเนาเก็บไว้ ณ 18/9/69** — ของจริงที่ครบ 73 กลุ่มเรียงจากต่ำสุดอยู่ที่ [`module-audit-2026-10-03.md`](module-audit-2026-10-03.md)

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

รองลงมา (แตะได้เร็ว): `learning-engine.service.ts` 245 (0%) · `AiAgentService.ts` 256/485 (~47%) · `relay.routes.ts` 198 (0%)

**ปิดเพิ่ม 3/10/69 (รอบที่ 4):** `sensors` (เดิม 0% → **84%**) · `risk.routes.ts` (เดิม 211 บรรทัด 0% → **71%**) · `backup` (เดิม 0% → **84%**) · `knowledge` (13% → **33%**) — 4 ไฟล์นี้คือ 4 โมดุลที่ลูกค้า/ระบบปฏิบัติการแตะจริง (เครื่อง sensor, DEFCON drill, สำรองข้อมูล, คลังความรู้) รายละเอียดรายเคส + บั๊กที่เจออยู่ที่ [`module-audit-2026-10-03.md`](module-audit-2026-10-03.md)

กติกาตีความ: แถว "0%" = ไฟล์ไม่ถูก import ในชุด mock เลย (ครอบผ่าน HTTP mock server ด้วยแพทเทิร์น `createTestServer` เดิม — พิสูจน์แล้ว 6 โมดูล) · แถว % ปานกลาง = เติมเฉพาะกิ่งที่ขาด · วัดซ้ำได้ทุกเมื่อด้วย `npm run coverage:core` (~2 นาที ไม่ต้องมี DB)

### Coverage floor — ไม่มีโมดุลใหม่ที่ลงที่ 0% ได้อีก (เพิ่ม 3/10/69)

> **ก่อนหน้านี้ coverage เป็น "กระจกส่อง" ไม่มี threshold มาตลอด** = ตัวเลขลดลงเงียบ ๆ ไม่มีใครรู้ ทั้งที่ gate รันอยู่ทุกคืน · `tools/coverage-floor.mjs` + `tools/coverage-floor.json` ปิดช่องนี้แล้ว · ผูกเข้า `tools/coverage-core.mjs` → อยู่ใน `npm run verify -- --db`

| กฎ | ตรวจอะไร |
|---|---|
| รวม | lines รวม ≥ floor (ปัจจุบัน 68.34) |
| ห้ามถอย | กลุ่มที่มีใน baseline ห้ามต่ำกว่าเดิม |
| **โมดุลใหม่** | กลุ่มที่ไม่มีใน baseline ต้อง ≥ **40%** ไม่งั้น violation (นี่คือกฎที่ทำให้ "ลงที่ 0%" เป็นไปไม่ได้) |
| หายไป | กลุ่มที่เคยมีใน baseline แล้วหายจากรายงาน = violation (กันตัดไฟล์ทิ้งเพื่อหนีตัวเลข) |

คำสั่งใช้ (จากรากโปรเจกต์):

```bash
node tools/coverage-floor.mjs --no-enforce   # รายงานอย่างเดียว ไม่บังคับ
node tools/coverage-floor.mjs --update      # ยก baseline ขึ้น (ยกเฉพาะขึ้น ลดไม่ได้)
npm run coverage:core -- --no-floor          # วัดเฉย ๆ ไม่ผูก floor (แก้เทสต์สะดุด)
```

**เพิ่มโมดูลใหม่แล้วทำอะไร:** เขียนเทสต์ให้ ≥ 40% → รัน `--update` → commit · ถ้าทำไม่ได้ในรอบนั้น ให้เขียนเหตุผลไว้ใน baseline ด้วย (มีฟิลด์ `note`) ไม่ใช่ปิดเงียบ

**บทเรียนจากการเขียนเทสต์รอบ 3/10/69 (อ่านก่อนเขียนเทสต์ backend):**
- env ต้องตั้ง**ที่ระดับ module body ไม่ใช่ใน `before()`** — `backup.service` อ่าน `BACKUP_DIR` ครั้งเดียวตอน import → ตั้งใน `before()` = ชี้ไปโฟลเดอร์จริง (เคสจริง: เทสต์แรกไปอ่าน backup จริง) · ทางแก้ = `await import()` แบบ dynamic ใน `before()`
- ที่ระบบอ่าน env เป็นตัวแปร instance เช่น `KNOWLEDGE_DIR` ให้เพิ่ม override ได้ (ไม่ตั้ง = พฤติกรรมเดิมทุกประการ) ไม่งั้นเทสต์จะไปแตะไฟล์จริงของระบบ
- ไฟล์ที่สร้างในมิลลิวินาทีเดียวกันมี mtime เท่ากัน → service ที่เรียงไฟล์ด้วย mtime จะเรียงผิด ใช้ `fs.utimesSync` แยกเวลาในเทสต์
- route ที่อ่าน `req.app.locals` (เช่น `defconEngine` / `riskWorker`) เทสต์ต้อง mock `app.locals` และเตรียมทั้ง 2 โหมด (มี engine / `RISK_MONITOR_ENABLED=false`)

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

## ๙ · กู้ฐานข้อมูลถึงนาทีใดนาทีหนึ่ง (PITR — เพิ่ม 28/9/69)

**สถานะ:** WAL archiving เปิดแล้วจริง (archive_mode=on · `data/wal-archive/` บน host · RPO ~5 นาที) — ซ้อมจริงผ่าน `pitr-drill.mjs` 28/9 (probe โดนลบ → กู้กลับได้ครบ)

**เมื่อเกิดเหตุ (ลบผิด/ไฟดับ/ข้อมูลเสีย):**
1. **หยุดเขียนทันที** — อย่าให้ core-api ยิง DB ต่อ (docker stop sovereign-core-api) เพื่อคงจุดเวลาให้ตัดสินใจได้
2. **ตัดสินเวลาเป้า:** เวลาเหตุการณ์ (ไทย −7 = UTC) — recovery จะ replay ถึง "ก่อน" เวลาที่ระบุ
3. **ซ้อมกู้แบบอัตโนมัติ (แนะนำ):** `node tools/verify/pitr-drill.mjs` — เวอร์ชันนี้ซ้อมด้วยตารางทดสอบ pitr_probe ไม่แตะข้อมูลจริง
4. **กู้จริง:** ตามขั้นตอนเดียวกับ pitr-drill แต่เป้าคือ live: ตั้ง recovery_target_time เป็นเวลาที่ 2 → ให้ scratch promote → ตรวจข้อมูล → dump ออก → นำกลับเข้า live (pg_restore --clean) — อย่าสลับ datadir ตรง ๆ ถ้าไม่จำเป็น
5. **หลังกู้:** `docker start sovereign-core-api` → รัน `node tools/machine-health.mjs` ต้องเห็น wal-archive ไม่มี failed

**อุปสรรคที่เจอจริง (จดกันพลาด):**
- `docker cp` ระหว่าง container ทำไม่ได้ → ผ่าน temp บน host (`infra/data/pitr-base-tmp`)
- ไฟล์ที่ docker cp เขียนเป็น root → postgres ปฏิเสธ datadir → ต้อง chown postgres:postgres + chmod 700 ก่อนสตาร์ตเสมอ
- `docker exec -d` โปรเซสตายพร้อม client (Windows job object) → สตาร์ต postgres ด้วย `nohup gosu postgres postgres … &` ผ่าน `sh -c`
- pg_dump เซ็ต search_path='' กลาง stream → ห้ามรวม timescaledb_post_restore ใน session เดียวกับ dump (บทเรียนเดิม §ห้า)

## สิบ · ขึ้นร้านสู่อินเทอร์เน็ตด้วย host + domain ฟรี (Cloudflare Tunnel + DigitalPlat — เพิ่ม 29/9/69)

**สถาปัตยกรรม:** ไม่ต้อง "จ่ายเช่า host" — เครื่องนี้คือ host (backend + DB สดที่เดียวในโลก) · สิ่งที่ขาดคือช่องทางเข้าที่ทะลุ CGNAT ของเราเตอร์ LTE (MR505) — **Cloudflare Tunnel (ฟรี)** แก้ตรงนี้: cloudflared ต่อ "ออก" หา Cloudflare เท่านั้น ไม่เปิดพอร์ตเข้าเลย · domain ฟรีตลอดจาก **DigitalPlat FreeDomain** (dpdns.org / us.kg / qzz.io / xx.kg — domain.digitalplat.org)

**ขั้นเจ้าของทำเอง (~15 นาที — สมัครแทนไม่ได้):**

> **สถานะจริง 29/9/69:** บัญชี DigitalPlat สร้าง+ยืนยันเมลแล้ว (`krisakornutama` / owteenhoper@gmail.com · Account ID 1790697100 · Free slots: 1) · Cloudflare มีอยู่แล้ว (ล็อกอิน GitHub) และ zone `sovereign-shop.dpdns.org` ถูกเพิ่มเรียบร้อย — **NS ของบัญชีนี้: `delilah.ns.cloudflare.com` และ `vin.ns.cloudflare.com`**
> ⚠️ ตัวตรวจ availability ตอบ "unavailable" ให้ทุกชื่อเมื่อควบคุมผ่านระบบอัตโนมัติ (ตัวตรวจมนุษย์บล็อกเงียบ) — **ขั้นจดจริงต้องทำในเบราว์เซอร์ปกติของเจ้าของเอง** (แชท AI จะจดให้ไม่ได้ ไม่ใช่เพราะเทคนิค แต่เพื่อกันบัญชีโดนแฟล็ก)
> **สถานะจริง 2/10/69 — จดจริง 1 ชื่อ, อีกชื่อเป็นแค่ zone ใน Cloudflare:** `sovereignoriginshop.dpdns.org` (30/9 — ACTIVE ใช้งานจริง NS archer+kallie) · `sovereign-shop.dpdns.org` — **มีตัวตนแค่ในบัญชี Cloudflare** (zone ทดสอบ 29/9) — **ยังไม่ได้จดจริงที่ DigitalPlat** (ตรวจ 2/10: parent ทั้ง 4 NS + ns1/ns2.dpdns.org ตอบ NXDOMAIN เทียบเท่าชื่อปลอม) — ยังไม่ต้องใช้ tunnel คู่ (แผนต่อใน "### โซนที่สอง" ท้าย §นี้)
1. สมัครบัญชีฟรี https://dash.cloudflare.com/sign-up (อีเมล + รหัส — ไม่ต้องใส่บัตร)
2. https://domain.digitalplat.org → Register → ค้นชื่อ เช่น `sovereign-shop` เลือก suffix `.dpdns.org` → ยืนยันตัวตนผ่าน GitHub/Discord ตามที่หน้าสมัครถาม (กัน bot — ฟรีไม่มีบัตร)
3. เมื่อได้ domain: ในหน้าจัดการของ DigitalPlat ตั้ง Nameserver เป็น 2 ชื่อที่ Cloudflare ให้ (Cloudflare dashboard → เว็บไซต์/domain → DNS → Nameservers) แล้วรอสถานะ Active (ปกติไม่เกิน ~1 ชม.)
4. Cloudflare → Zero Trust → Networks → Tunnels → Create a tunnel → เลือก Cloudflared → ตั้งชื่อ `sovereign-shop` → **คัดลอก token ยาว ๆ** (`eyJ…`) ใส่ไฟล์ `sovereign-os/infra/.env` บรรทัด `CLOUDFLARED_TOKEN=eyJ…` แล้วบอก agent จะรัน compose ให้
5. หน้า Tunnel เดิม → Public Hostname → เพิ่ม: subdomain `shop` · domain ที่จด · service `http://host.docker.internal:3000` → Save
6. **WAF บังคับทำ (หน้า domain → Security → WAF):** Custom rule ALLOW = hostname เป็นโดเมนเรา AND URI Path starts with `/shop` (เพิ่ม `/trace` ถ้าต้องการ) · Custom rule BLOCK = hostname เดียวกัน ทุก path อื่น — เพราะ :3000 เสิร์ฟหน้า dashboard/admin ด้วย ห้ามปล่อยทะลุ · Rate limiting ฟรี 1 rule: `/api/` เกิน 20 คำขอ/10 วิ ต่อ IP = block
   **[ทำแล้ว 30/9/69 — บันทึกของจริง]** rule เดียวชื่อ "Public-only: block admin/internal paths" action=Block · expression (รูปแบบ default-deny): `not (starts_with(http.request.uri.path, "/shop") or http.request.uri.path in {"/" "/trace" "/trace/" "/favicon.ico" "/icon.png" "/icon.svg" "/manifest.json" "/sw.js" "/sw-precache.json" "/robots.txt" "/sitemap.xml"} or starts_with(http.request.uri.path, "/_next/static/") or starts_with(http.request.uri.path, "/api/shop") or starts_with(http.request.uri.path, "/api/trace") or http.request.uri.path in {"/api/health" "/api/health/"})` · **บทเรียน 2 ข้อ:** (1) Express redirect trailing-slash (`/api/health`→`/api/health/`) ทำให้ request ที่ตาม redirect โดน block — allowlist ต้องครอบทั้งสองรูปแบบ (2) ปุ่ม Deploy ใน dashboard คลิกแล้วเงียบ (โดน challenge platform กลืนเมื่อหน้าถูกควบคุมอัตโนมัติ) — ทางแก้: PUT ตรงไป `/api/v4/zones/<zone-id>/rulesets/phases/http_request_firewall_custom/entrypoint` จาก fetch **ในหน้า dashboard** (ใช้ cookie session มีสิทธิ์ครบ) · พิสูจน์แล้ว: public 200 ครบ / admin+auth 403 ที่ edge · **แก้ 1/10/69: เพิ่ม `/robots.txt` `/sitemap.xml` ใน expression — ตรวจ live พบว่าเดิม 2 path นี้ตอบ 403 (Google ดึง sitemap ไม่ได้ = บั๊ก SEO จริง) · ต้องลงแก้ใน dashboard ทั้งสองโซน (โซนเดิม + โซนใหม่) — ยังไม่ได้กด คิวแรกของงาน SEO**
7. พิสูจน์: เปิด `https://shop.<ชื่อ>.dpdns.org` จากมือถือ ปิด Wi-Fi (4G ล้วน) — เห็นหน้าร้าน = สำเร็จ · เปิด `/dashboard` ต้องโดน 403 จาก WAF
8. **[ทำแล้ว 30/9/69] Rate limiting:** rule "Public API rate limit: /api/ max 20 req/10s per IP" ใน phase `http_ratelimit` (action=block, mitigation_timeout=10 วิ — ค่าที่ Free plan อนุญาต · characteristics ip.src+colo) — พิสูจน์: ยิง 25 ติดตัวที่ 21+ ได้ 429
9. **[ทำแล้ว 30/9/69] สายสด Farm→Shop (I5a):** การ์ด "สายสดจากแปลง" บนหน้าร้านดึงจาก `GET /api/trace/products?ids=<inventoryItemId,…>` (สาธารณะ) — QR ติดสินค้าอิง `PUBLIC_APP_URL` (ตั้งใน infra/.env เป็นโดเมนจริงแล้ว) · **ข้อควรระวังตอน deploy frontend:** (1) build ทับ server ที่รันอยู่ = หน้า 404 ทั้งชุด (chunk ใหม่ vs manifest เก่า) — restart :3000 หลัง build เสมอ (2) service worker cache `sovereign-v3` คงหน้าเก่า — ทดสอบหลัง deploy ต้องเคลียร์ SW/caches ก่อนสรุปผล

### สถานะ 4/10/69 — ทำไมร้านยังรับเงินจริงไม่ได้ (ตรวจจากของจริงทุกบรรทัด)

รอบนี้ตรวจว่า "เงินจะเข้าบัญชีได้ไหม" แล้วเจอ **4 ด่าน** ที่ยังปิดอยู่ — ฝั่ง Stripe ไม่ใช่ปัญหา (บัญชีผูก THB → KRUNG THAI •••6505 เรียบร้อยแล้ว Stripe โอนเอง ~7 วันทำการ)

**ด่าน 1 — โดเมนหลุดจาก Cloudflare (เว็บสาธารณะล่มอยู่):** `sovereignoriginshop.dpdns.org` ตอบ **NS = `dns1.digitalplat.org` / `dns2.digitalplat.org`** และ **ไม่มี A record** ทั้ง apex และ `www` → `curl https://…/ ` = exit 6 / code 000 · ตรวจซ้ำ 2 ที่ (Cloudflare DoH + Google DoH) ได้ authoritative ตรงกัน SOA serial `2026100409` (= แก้ล่าสุด 4/10/69) · ยังมี TXT `google-site-verification=…` อยู่ในโซน DigitalPlat ⇒ **zone ยังอยู่ แต่ย้ายออกจาก Cloudflare** · **tunnel ไม่ได้พัง** — `cloudflared` (tunnelID `ecce3206-c35c-4e73-88a1-40514a7f37d8`) ยังรันและยังถือ Public Hostname ของโดเมนนี้ (config version 2, อัปเดต 3/10 10:29) ⇒ **ตั้ง NS กลับเป็นคู่ของ Cloudflare แล้วเว็บกลับมาเอง ไม่ต้องแตะ tunnel** · ⚠️ TXT ของ Google ต้องย้ายไปอยู่ใน Cloudflare zone ด้วย ไม่งั้น GSC verify หลุดเมื่อ NS เปลี่ยน

**ด่าน 2 — API ที่รันอยู่ไม่มีโมดูล payments (แยกจากบั๊กโค้ด):** container `sovereign-core-api` mount `src` จากโฟลเดอร์ MAIN และรัน `npx prisma generate && npm run build && npm start` ทุกครั้งที่บูต ⇒ **`docker restart sovereign-core-api` = deploy จริง ไม่ต้อง rebuild image** · 4/10/69 container ยังเป็น build 1/10 13:31 แต่โมดูล payments เกิด 4/10 11:52 → `/api/payments/*` ตอบ **404** · หลัง restart (healthy ที่ t+40s) ตอบ **401** ⇒ ถ้าเจอ payments 404 อีก **ให้ restart container ก่อนไปสงสัยโค้ด** · ลำดับที่ถูก: `npx prisma generate && npm run build` ใน MAIN ให้ผ่านก่อน แล้วค่อย restart (ถ้า build ล้มในคอนเทนเนอร์ `npm start` ไม่รัน = API ล่มทั้งตัว)

**ด่าน 3 — ไม่มี `STRIPE_WEBHOOK_SECRET`:** ยังไม่ตั้ง ⇒ ทุก delivery ถูกปฏิเสธ (โดยเจตนา) · ต้องสร้าง endpoint ใน **Workbench → Webhooks** และคัด `whsec_…` มาใส่ **`sovereign-os/infra/.env`** (เฉพาะค่านี้ · ห้ามส่ง `sk_`/`rk_`/เลขบัญชีในแชท)

> ⚠️ **ห้ามใส่ผิดไฟล์ — ไฟล์นี้คือจุดที่ทำให้เงินหายเงียบในรอบ 4/10/69**
> ค่านี้มีผลกับ container **เฉพาะเมื่ออยู่ใน `sovereign-os/infra/.env`** เพราะ docker-compose อ่านไฟล์นั้นแล้วส่งเข้า container
> ส่วน `sovereign-os/core-api/.env` **ไม่มีผลกับ container เลย** (ใช้ได้เฉพาะตอนรันบน host · เพราะ `.dockerignore` ตัด `.env` ออกจาก image และไม่มี mount)
> ใส่ผิดไฟล์ = หน้าเว็บปกติ แต่ webhook ปฏิเสธทุก delivery (401) แบบไม่มีอะไรเตือน
> **ตรวจว่ามีผลจริงหรือยัง:** `npm run check:stripe-secret` (ดูหัวข้อ "หมุน secret อย่างไรให้มีผลจริง" ข้างล่าง) · สัญญาที่พิสูจน์แล้ว: secret ไม่ตั้ง/ลายเซ็นไม่ผ่าน → **401** + `rejected:true` (ไม่ใช่ 400) ส่วน **400** ใช้เฉพาะ body ที่ไม่ใช่ JSON หลังลายเซ็นผ่าน — เทสต์ที่คุมสัญญานี้คือ [`tests/paymentsFreshClone.test.ts`](../sovereign-os/core-api/tests/paymentsFreshClone.test.ts) (assert ข้อความ `webhook signing secret is not configured`) · ตอบ non-2xx ไว้ถูกแล้ว ห้ามเปลี่ยนเป็น 2xx: secret อาจเพิ่งหมุน แล้ว Stripe จะส่งซ้ำให้

**ด่าน 4 — WAF default-deny ยังไม่รู้จัก path ของ webhook:** rule "Public-only: block admin/internal paths" (ข้อ 6 ด้านบน) อนุญาตเฉพาะ path ที่อยู่ใน allowlist ซึ่ง **ยังไม่มี `/api/payments/*`** ⇒ เมื่อโดเมนกลับมา Stripe จะได้ **403 ที่ edge** ต้องเติม **บวกอย่างเดียว** ต่อท้ายในวงเล็บ allowlist (ครอบทั้งมี/ไม่มี `/` ปิดท้ายด้วย `starts_with`):
```
or starts_with(http.request.uri.path, "/api/payments/webhook")
```
เกณฑ์ตรวจ: `curl -s -o /dev/null -w '%{http_code}' -X POST https://sovereignoriginshop.dpdns.org/api/payments/webhook/` → ต้องได้ **401** (ไม่ใช่ 403) — ถ้าได้ 403 = ยังไม่ขึ้น rule

**⚠️ URL ของ endpoint ต้องมี `/` ปิดท้ายเสมอ:** `next.config.js` ตั้ง `trailingSlash: true` ⇒ `POST /api/payments/webhook` ผ่านประตู `:3000` ตอบ **308** แล้ว redirect ไป `/api/payments/webhook/` · **Stripe ไม่ตาม redirect ของ delivery** (นับเป็น fail) — วัดจริง 4/10/69: `no_slash=308`, `with_slash=401` (ที่ :3001 ตรง ๆ ตอบ 401 ทั้งสองรูปแบบเพราะ Express ไม่ strict routing แต่ Stripe วิ่งผ่าน :3000 เท่านั้น) ⇒ ใช้ `https://sovereignoriginshop.dpdns.org/api/payments/webhook/`

**เงินจ่ายแล้วแต่ระบบไม่บันทึก (เงินหายเงียบ) → ดูที่ไหน:**
`sovereign-os/core-api/data/payments-rejected-deliveries.jsonl` (ใน container: `/app/data/`) · หนึ่งบรรทัด = ลูกค้าจ่ายจริง 1 รายการที่ระบบปฏิเสธถาวร เพราะ **สกุลเงินไม่ตรง / ยอดไม่ตรง / ยอดของ order ใช้ไม่ได้** — กรณีนี้ webhook ตอบ 200 ตามที่ถูก (retry ซ้ำไม่ช่วย เพราะส่งชุดเดิมก็ยังไม่ตรง) แต่ Stripe จะ**เลิกส่ง event นั้นถาวร** ไฟล์นี้คือร่องรอยเดียวที่เหลือ · อ่านค่าที่ได้: `eventId` (ไปเปิดหน้า Stripe ที่ event นี้) · `refCode` (ไปแก้ order) · `receivedAmountSatang`/`expectedAmountSatang` (ยอดที่ได้จริงเทียบที่คาดไว้) · `orderAmountRaw` (ยอดดิบของ order ที่ใช้ไม่ได้) · แล้วสั่ง Stripe ยิงใหม่หรือจ่าย/คืนด้วยมือ · **ไม่มีอีเมล/ชื่อ/เลขบัตรลูกค้าในไฟล์** (เก็บเท่าที่จำเป็นต่อการตามเงิน) · ทดสอบว่าไฟล์ยังถูกเขียน: `docker exec sovereign-core-api wc -l /app/data/payments-rejected-deliveries.jsonl` · รายละเอียดเชิงเทคนิค: [`docs/modules/payments.md`](modules/payments.md)

**หมุน secret อย่างไรให้มีผลจริง (หมุนบ่อย — ทำตามนี้ทุกครั้ง):**

1. เปิด **Workbench → Webhooks** คัด `whsec_…` ใหม่ (ห้ามส่งค่านี้ในแชท/ส่งอีเมล)
2. เขียนค่าใหม่ลง **`sovereign-os/infra/.env`** เป็นบรรทัด `STRIPE_WEBHOOK_SECRET=…` (ไฟล์เดียวนี้คือเจ้าของค่า)
3. **recreate** (ไม่ใช่ restart): `cd sovereign-os/infra && docker compose up -d --no-deps core-api`
   — ค่าใน `environment:` ถูกอ่านตอน**สร้าง** container ถ้าแค่ `docker restart` ค่าเก่ายังอยู่ (นี่คือเหตุผลว่าการหมุนแล้ว "ดูเหมือนไม่มีผล")
4. **พิสูจน์** — อย่าเดา ให้รันคำสั่งนี้:
   ```
   npm run check:stripe-secret
   ```
   ผ่าน = ค่าที่ container ใช้อยู่ **ตรงกับไฟล์เจ้าของจริง** พิมพ์ fingerprint (12 ตัวถัด) ของทั้งสองฝั่งเทียบกัน
   ไม่ตรง = หมุนแล้วยังไม่มีผล พร้อมบอกคำสั่งแก้ให้ในผลลัพธ์

**หลักฐานว่ามีผลจริงดูจากตรงไหน:** ตอน container บูต จะพิมพ์ใน `docker logs sovereign-core-api` ว่า
`✅ STRIPE_WEBHOOK_SECRET ตรงกับ sovereign-os/infra/.env (fingerprint xxxxxxxxxxxx)`
→ **หมุนแล้วต้องเห็น fingerprint เปลี่ยน** ถ้าไม่เปลี่ยน = ยังใช้ค่าเก่า ยังไม่มีผลจริง
(ถ้าไม่ตรงจะพิมพ์คำเตือนสีแดงพร้อมคำสั่งแก้ทันทีที่บูต ไม่ต้องรอลูกค้าจ่ายเงินจริงถึงจะรู้)

**ทำไมต้องมี fingerprint:** มันพิสูจน์ว่า "หมุนแล้ว" มีผลจริงโดย**ไม่ต้องเปิดเผยค่า** — เป็น hash 12 ตัว ทำให้ได้ตัวเลขที่เทียบกันได้ (เก่า/ใหม่) แต่เอาไปเซ็นอะไรไม่ได้

**ค่าลับตัวอื่นหลุดแบบเดียวกันไหม (ตรวจได้เอง):**
```
npm run audit:env-secrets
```
พิมพ์รายชื่อคีย์ที่**เขียนไว้แต่ไม่มีผลกับ container** — คำสั่งนี้**รายงานเท่านั้น ไม่ลบ ไม่ย้าย** (ค่าลับต้องให้คนดูแลตัดสินใจเอง)

**ผลที่ตรวจได้ตอนนี้ (5/10/69):** `STRIPE_SECRET_KEY` และ `STRIPE_PUBLISHABLE_KEY` อยู่ใน `core-api/.env` แต่**ไม่ถึง container เลย** ⇒ ถ้าวันหนึ่งตั้ง key จริงใส่ไฟล์นั้น ระบบก็ยังเป็นโหมดปลอมอยู่ (ยิง Stripe จริงไม่ได้) — ต้องย้ายไป `sovereign-os/infra/.env` **และ**เพิ่มบรรทัดส่งค่าใน `docker-compose.yml` ก่อน · นี่คือด่านถัดไปก่อนเปิดขายจริง

**ช่องของค่าในไฟล์ตัวอย่าง (`.env.example`):** ช่องของ `STRIPE_WEBHOOK_SECRET` อยู่ที่**`sovereign-os/infra/.env.example`** (ไฟล์เจ้าของ) เท่านั้น · `sovereign-os/core-api/.env.example` จงใจไม่มีช่องนี้ เพราะไฟล์นั้นไม่มีผลกับ container · มีเทสต์คุมไว้ที่ `tools/test/env-secret-ownership.test.mjs` ⇒ ถ้าวันหนึ่งมีใครย้ายช่องกลับไปผิดไฟล์ รอบ verify จะแดงทันที ไม่ต้องรอลูกค้าจ่ายเงินจริงถึงจะรู้

**ไล่เงินหายอัตโนมัติ (ทุก 30 นาที):** worker `stripe-reconcile` ดึงรายการที่ Stripe บอกว่า "จ่ายแล้ว" มาเทียบกับที่ระบบบันทึก · ดูผลที่ `docker logs sovereign-core-api | grep stripe-reconcile`

- ตอนยังไม่มี `STRIPE_SECRET_KEY` หรือยังไม่เปิด `STRIPE_LIVE_ENABLED` จะพิมพ์ `⚠️ [stripe-reconcile] ข้ามรอบนี้: …` **ทุกรอบ** — นี่คือตั้งใจ ไม่ใช่บั๊ก: งานที่จับเงินหายห้ามเงียบตอนปิด ไม่งั้นกลับไปอยู่ในสถานะเดิมโดยไม่มีใครรู้
- ถ้าขึ้น `⚠️ พบช่องว่าง N รายการ` = **เงินจริงอยู่คนละฝั่งกับที่ระบบบันทึก** ต้องให้คนตรวจและแก้ด้วยมือ (ระบบไม่แก้ทับให้ เพราะการแก้ทับเงินอัตโนมัติคืออีกช่องที่ทำให้เงินหาย)

**ลำดับที่ถูกก่อนเปิดรับเงิน (ห้ามสลับ):** ตั้ง NS กลับ → เติม WAF allowlist → สร้าง endpoint + เอา `whsec` ใส่ `.env` → ตั้งเบอร์ `shopPromptPay` ของร้านให้ตรงบัญชีรับเงิน → **สุดท้าย**ค่อยเปิด `STRIPE_LIVE_ENABLED=true` แล้วซื้อทดสอบ 1 บาท · **ห้ามเปิด live ก่อนมี `whsec`**: เงินเข้าจริงแต่ออเดอร์ไม่ถูกบันทึก และ Stripe จะ retry ไม่จบ

> **หมายเหตุเครื่องมือ:** `PROMPTPAY_TARGET` เป็นของ **treasury** (คำสั่งโอน/QR ส่วนตัว) — **ไม่เกี่ยวกับ PromptPay ของร้าน** ซึ่งเก็บที่ `businesses.shopPromptPay` (เข้ารหัส · ตั้งจากหน้า `/business` → แท็บร้าน) ⇒ ตั้งร้านให้ใช้เบอร์ที่ถูกต้องจาก UI ไม่ต้องแก้ `.env`

## §สิบเอ็ด — การจัดการ repo public + สนามทดลองสาธารณะ (P: Publishing 30/9/69)

### กฎการเผยแพร่ (ตัดสินครั้งเดียว — คงไว้ตลอด)
- **ไม่มี repo สาธารณะ — สั่งเด็ดขาด 30/9/69:** "ชิ้นส่วนอุปกรณ์ไม่ส่ง code สู่สาธารณะ — ใช้เป็นของทำขาย" → `krisakornutama/sovereign-dms` **เปลี่ยนเป็น PRIVATE** (sudo ยืนยันโดยเจ้าของ) · เฟิร์มแวร์/สเปค/ซิมเป็นทรัพย์สินการค้า อัปเดตโค้ดที่ `E:\My work\sovereign-dms` (repo แยก) → tag ตาม CHANGELOG (เช่น `git tag v0.4.1 && git push --tags`)
- **ห้ามรั่วสู่สาธารณะเด็ดขาด:** ลิงก์ github.com บนหน้าเว็บสาธารณะ · คำว่า "open source/โอเพนซอร์ส" · ops-runbook.md · QUEUE.md · STATUS.md · ชื่อ LAN/IP/เราเตอร์/โดเมนจริง · config.py · token ทุกชนิด (repo หลัก sovereign-origin คง private ตลอด — ไม่ต้องการประวัติ 512 commits ให้โลกเห็น)
- **บทเรียนความเชื่อถือ:** ความน่าเชื่อถือของร้านมาจาก *ของจริง+บัตรตามรอย* (WAF จริง · rate limit จริง · ล็อตการผลิตจริง) ไม่ได้มาจากการเปิดโค้ด — footer ทุกหน้าสาธารณะเหลือแค่ "Powered by Sovereign OS" + ลิงก์เดโม่
- สนามทดลอง `/demo` ใช้ **sandbox คงตัวในโค้ด** (`demo-sandbox.service.ts`) — ห้ามเปลี่ยนให้ไปอ่าน DB จริงเด็ดขาด (แม้ read-only)

### ฟีดแบ็กจากหน้าสาธารณะ → ถึงมือเจ้าของ
1. ผู้เยี่ยมชมกดปุ่มลอย "💬 ส่งความคิดเห็น" บนหน้าเดโม่ → เก็บตาราง `feedback_notes` (มี honeypot+throttle)
2. เจ้าของเปิด **หน้า Admin → ฟีดแบ็กจากผู้เยี่ยมชม** (`/feedback-admin` — SUPERADMIN) → กด 👍/👎 ต่อรายการ
3. กด **"📮 ยื่นถึงผม"** → ของที่ 👍 ที่ยังไม่ sent ถูกย่อส่ง Telegram เจ้าของ (ส่งซ้ำไม่ได้ — mark sent_at)
- อีเมล digest (แทน Telegram): เติม SMTP_* ใน infra/.env แล้วขยาย `feedback.service.ts` — การ์ดอนาคต

### สรุปสิ่งที่เปิดสู่โลกภายนอก (WAF allowlist 30/9/69)
`/shop*` · `/trace*` · `/demo*` · `/api/shop*` · `/api/trace*` · `/api/demo*` · `/api/feedback` · `/api/track` · `/api/health` · `/partners` · `/about` · `/api/partners*` (เพิ่ม 30/9) · `/robots.txt` · `/sitemap.xml` (เพิ่ม 1/10 — เดิม 403 ต้องแก้ใน dashboard ทั้งสองโซน) — ที่เหลือ block ทั้งหมด (403 ที่ edge)

### เก็บพฤติกรรม/ความต้องการผู้ใช้ (P10 — 30/9/69) + หน้าแรกโหมดทดลอง (P11)
- **ตาราง `visitor_events`** (migration 20260930150000) — **cookieless ไม่มี PII**: ไม่เก็บชื่อ/อีเมล/IP เปล่า (ip→sha256+salt 8 ตัว ใช้นับผู้มาเยือนประมาณ) · kind ต้องอยู่ allowlist: `page_view · demo_tab · time_on_page · survey · question · feedback_open · outbound`
- **`POST /api/track`** สาธารณะ — honeypot `website` · page ต้องขึ้น `/` · ตอบ 202 เสมอ (tracking ต้องไม่กลายเป็น error ฝั่งผู้ใช้) · limiter 60/นาที · **`GET /api/analytics/summary?days=N`** = SUPERADMIN (หน้า /feedback-admin แผง "📊 พฤติกรรมผู้เยี่ยมชม 7 วัน")
- **ตัดสินใจสถาปัตยกรรมที่ gate จับ:** `FeedbackButton` ย้ายจาก pages/demo.tsx → **components/public/** ตามกฎ import-layers (ห้าม page import page) — หน้าใดก็ import component ได้
- **แบบสอบถามสั้นบน /demo**: "ส่วนไหนอยากใช้จริงก่อน?" (farm/livestock/finance/trace/shop/อื่น ๆ) + ช่องความต้องการอิสระ → kind `survey`/`question` — นี่คือสายข้อมูล "ความต้องการผู้ใช้" ที่เจ้าของใช้จัดลำดับการพัฒนาต่อ
- **หน้าแรกสองบุคลิก** (`lib/publicAccess.ts`): โดเมนจริง → การ์ด 3 ใบ (เดโม่/ร้าน/ตามรอย) ไม่มีล็อกอินขวาง (ลิงก์ /login เล็กท้ายหน้า) · localhost/LAN → LoginForm เดิม · session เจ้าของบนโดเมนจริงเด้ง dashboard ตามเดิม

### ขายซอฟต์แวร์แยกชิ้น (P8 — 30/9/69)
- หน้าจัดการ: **`/software-pricing`** (SUPERADMIN) — สแกนโค้ดจริง 61 โมดูล → ตาราง endpoints/LOC/ชุดทดสอบ + ราคาแนะนำ → ตั้งชื่อ/สเปค/ราคาเอง → กด "เปิดขาย" = ขึ้นหน้าร้านทันที (SKU `SW-<MODULE>` ผูก inventory "license")
- สูตรราคาแนะนำ (แก้ได้ที่ `software-catalog.service.ts`): base 190 + endpoints×95 + LOC×0.28 + testRefs×60 → ปัด 10฿ ปิดท้าย 9 (ขั้นต่ำ 290฿) — โมดูลที่มีเทสต์ครอบ = ราคาสูงขึ้นตามคุณภาพจริง
- ปิดขาย = isActive=false (หายจากหน้าร้าน ราคา/ข้อมูลคงอยู่ — เปิดใหม่ได้) · หน้าร้านโชว์ผ่าน `/api/shop` เดิม — WAF ไม่ต้องแตะเพิ่ม
- ล็อต release: แต่ละเวอร์ชันใหม่ สร้างล็อต `LOT-SWVxxx` (build→test→publish) ผ่าน seed-devices-shop.ts — การ์ดสายสดบนหน้าร้านโชว์เวอร์ชันที่ลูกค้าได้จริง

**ฝั่งระบบที่ agent ทำแล้ว:** compose มีบริการ `cloudflared` พร้อม (รอ token ใน .env — ยังไม่รัน) · CORS อ่านจาก env อยู่แล้ว — โดเมนสาธารณะใช้ **same-origin** (getApiUrl คืน `window.location.origin` เมื่อ host ไม่ใช่ LAN) จึงไม่ต้องเติม CORS_ORIGIN · ค่าปัจจุบันใน .env ยังเป็น localhost/LAN ล้วน (ตรวจ 1/10) — ทำงานถูกต้องตามดีไซน์ same-origin

### โซนที่สอง: `sovereign-shop.dpdns.org` (เริ่ม 1/10/69 — ชื่อสั้นตามแผนเดิมมาว่าง จดเพิ่ม)

สถานะ (**ตรวจ DNS จริง 2/10** — แก้ข้อมูลผิดที่เคยจดว่า "จดแล้ว"): **ยังไม่ได้จดจริงที่ DigitalPlat** — ชื่อมีตัวตนแค่เป็น zone ในบัญชี Cloudflare (เพิ่มไว้ทดสอบ 29/9 ซึ่งเป็นที่มาของอีเมล Cloudflare 1/10) · หลักฐาน: `nslookup -type=NS sovereign-shop.dpdns.org ns1.digitalplat.org` → NXDOMAIN ทุก NS ของ DigitalPlat เทียบเท่าชื่อปลอม (control) ข้ามวันแล้ว · ถ้าเจ้าของอยากได้ชื่อนี้จริง → จดก่อนที่ domain.digitalplat.org (ขั้น 2 ด้านบน) แล้วค่อยตั้ง NS เป็น delilah+vin ตามขั้นของเจ้าของด้านล่าง · ถ้าไม่เอา → ลบ zone ใน Cloudflare (ขั้นล่าง) เพื่อหยุดอีเมล (โดเมนเดิม sovereignoriginshop ทำงานต่อไม่กระทบ)

   **ขั้นลบ zone ใน Cloudflare (ทำเอง ~1 นาที):** (1) dash.cloudflare.com → เลือกโซน `sovereign-shop.dpdns.org` (2) เมนูขวาล่าง **Manage domain** (หรือ Overview → ล่างสุด) → กด **Remove zone** / **Delete zone** ท้ายสุด (3) ยืนยันพิมพ์ชื่อโดเมนตามที่ระบบถาม (4) เสร็จ = โซนหายจากรายการ + อีเมล "ยังไม่ใช้ Cloudflare NS" หยุด (คิวข้อ 2 ใน QUEUE ปิดเอง) · **ห้ามลบ `sovereignoriginshop.dpdns.org`** (โดเมนจริง — ถ้าลบคือเว็บล่มทันที) · tunnel/token/compose ใช้ตัวเดิมถ้าทำต่อ · frontend โค้ดรองรับอัตโนมัติ (`isPublicHostname` pattern ไม่ใช่-localhost · API same-origin · rewrites host-agnostic — แก้โค้ด 0 จุด)

**ขั้นของเจ้าของ (ตามอีเมล Cloudflare 1/10):**
1. dash.domain.digitalplat.org → เลือก `sovereign-shop.dpdns.org` → **Nameservers** → ใส่ `delilah.ns.cloudflare.com` และ `vin.ns.cloudflare.com` → บันทึก
2. Cloudflare → โซน sovereign-shop.dpdns.org → กด **"Check nameservers now"** → รอสถานะ Active

**ขั้นถัดไปเมื่อ Active (เจ้าของแก้ dashboard — agent พิสูจน์ต่อ):**
3. Zero Trust → Networks → Tunnels → tunnel เดิม → **Public Hostname → Add 2 แถว** (คัดค่า Service จากแถวของ sovereignoriginshop เป๊ะ): แถว path `^/api` → `http://host.docker.internal:3001` · แถว path `*` → `http://host.docker.internal:3000` — Cloudflare สร้าง CNAME ให้เอง (apex flatten ให้เอง)
4. **SSL/TLS → Full (strict)** ที่โซนใหม่
5. **WAF:** สร้าง custom rule เดียวชื่อ "Public-only: block admin/internal paths" action=Block ด้วย expression เต็มพร้อมวาง (คัดจาก expression **จริง** บนโซนเดิม ณ 2/10/69 — ครอบ allowlist ล่าสุด รวม `/robots.txt` `/sitemap.xml` หน้าสาธารณะ 4 หน้า และไฟล์คีย์ IndexNow):
   ```
   not (starts_with(http.request.uri.path, "/shop") or starts_with(http.request.uri.path, "/demo") or starts_with(http.request.uri.path, "/partners") or starts_with(http.request.uri.path, "/about") or starts_with(http.request.uri.path, "/vendor/") or starts_with(http.request.uri.path, "/api/shop") or starts_with(http.request.uri.path, "/api/trace") or starts_with(http.request.uri.path, "/api/partners") or starts_with(http.request.uri.path, "/api/demo") or starts_with(http.request.uri.path, "/api/feedback") or starts_with(http.request.uri.path, "/api/track") or http.request.uri.path in {"/" "/trace" "/trace/" "/partners" "/about" "/favicon.ico" "/icon.png" "/icon.svg" "/manifest.json" "/sw.js" "/sw-precache.json" "/api/health" "/api/health/"} or starts_with(http.request.uri.path, "/_next/static/") or http.request.uri.path in {"/robots.txt" "/sitemap.xml" "/community" "/community/" "/mbti" "/mbti/" "/sensors" "/sensors/" "/hover-cards" "/hover-cards/" "/60bbc7d06ef7aa163fcc6f406145cfeb.txt"})
   ```
   (แถวไหนโดน block ทั้งที่ควรผ่าน — ดู Security → Events แล้วเติมเส้นนั้น) · **ลงแก้ expression บนโดเมนเดิมด้วย** (วิธีบวกอย่างเดียว 5 นาที จดใน `docs/seo-google-search-console.md` §คู่มือแก้ WAF) รอบเดียวกัน
6. พิสูจน์ปลายทาง: `/` `/shop` `/api/health` `/sitemap.xml` = 200 · `/dashboard` = 403 · sitemap = 200 (ไม่ซ้ำบั๊กโดเมนเดิม) · **ครบทั้ง 10 URL ใน sitemap ต้อง 200 ด้วย** (4 หน้า `/community /mbti /sensors /hover-cards` เคยโดน 403 เพราะไม่อยู่ใน allowlist — ถ้าโซนใหม่ลืม 4 path นี้ Google จะ crawl ได้แค่ครึ่งเดียว) · แล้วทำ GSC property ที่สองตาม `docs/seo-google-search-console.md`

**ห้ามพลาด:** ห้ามชี้ Public Hostname ไป :3001 หรือ API ภายใน (admin/auth ทั้งหมดอยู่ข้างใน) · Domain ฟรีต้องยืนยันตามรอบที่ DigitalPlat ส่งเมลมา ไม่งั้นโดนคืนชื่อ — จดวันจดที่นี่: ________

## §สิบสอง — ระบบพาร์ทเนอร์ + องค์กรไม่แสวงหากำไร (P16 30/9/69)

### แผนที่คู่ค้า (/partners)
- **ตาราง `partners`** (migration `20260930170000_add_partners`): สมัครสาธารณะ → `PENDING` → เจ้าของอนุมัติที่ `/feedback-admin` → `ACTIVE` ขึ้นแผนที่
- **API**: `POST /api/partners` (202 · honeypot `website` · ของเพี้ยนทิ้งเงียบ) · `GET /api/partners` (ACTIVE เท่านั้น + counts · ไม่มี contactName/contactPhone รั่ว) · `PATCH /api/partners/:id` (SUPERADMIN เท่านั้น)
- **แผนที่**: OpenStreetMap ผ่าน Leaflet **CDN** (`unpkg.com/leaflet@1.9.4`) — ตั้งใจไม่เพิ่ม dependency · ฟอร์มสมัครปักหมุดโดยคลิกแผนที่ (โหมดปักหมุด)
- **WAF**: edge อนุญาต `/partners` `/about` `starts_with /api/partners` แล้ว (แก้ expression ใน dashboard จริง 30/9/69)

### องค์กรไม่แสวงหากำไร
- **ชื่อธุรกิจใน DB = "Sovereign Origin Foundation"** (เดิม Sovereign Devices) — seed + software-catalog service แก้ตามแล้ว (ถ้า restore กลับต้องรัน UPDATE ซ้ำ: `UPDATE businesses SET name='Sovereign Origin Foundation' WHERE name='Sovereign Devices';`)
- **การ์ด "สนับสนุนตามศรัทธา"** ใน /shop = business_product sku `SUPPORT-FAITH` ราคาหน่วย **1฿** หมวด `SUPPORT` (กำหนดยอด = จำนวนชิ้น; ซ่อนจากรายการชิ้นงานปกติด้วย filter category SUPPORT) — seed ครั้งใหม่ต้อง INSERT ตัวนี้ด้วย (idempotent ตาม runbook)
- **บัตรขอบคุณดิจิทัล** = คอมโพเนนต์ใน `/shop?order=<token>` โชว์เมื่อชำระครบ — ชื่อบนบัตรเก็บ `localStorage: sovereign-support-name` (ไม่ส่ง server · ไม่มี PII ใหม่ใน DB)
- **สถิติ /about** = `GET /api/shop/transparency` (สาธารณะ, ครอบด้วย WAF `/api/shop` อยู่แล้ว): นับออเดอร์สด/ชิ้นงาน/คู่ค้า/ล็อต/ผู้มาเยือน 7 วัน — **นับล็อตต้องผ่าน `trace.countAllLots`** (boundary gate: business ห้ามแตะ product_lots ตรง)

### บทเรียน deploy รอบ P16 (30/9/69) — จับได้ 3 ชั้น
1. **CSP บล็อก CDN**: `script-src 'self'` กิน Leaflet จาก unpkg ทิ้ง (โหลดเงียบ ไม่มี console error ชัด) → แก้ด้วย **self-host** `public/vendor/leaflet/` (leaf 1.9.4 js+css) + เติม `https://*.tile.openstreetmap.org` ใน img-src · **WAF ก็ต้องอนุญาต** `starts_with /vendor/` ด้วย (default-deny กิน /vendor/* เป็น 403)
2. **SW VERSION คงที่ข้าม build**: `sovereign-v3` ไม่เคยเปลี่ยน → client (รวม PWA มือถือ) ใช้ shell เก่าต่อได้เป็นสัปดาห์หลัง deploy · แก้ที่ราก: **bump เป็น sovereign-v4 ทุกครั้งที่ deploy เปลี่ยน UI** (activate มีลบ cache เก่ารออยู่แล้ว + skipWaiting พร้อม)
3. **build ที่ MAIN เสมอ**: งานใน worktree ที่แก้ public/sw.js ไม่มีผลจนกว่า merge — ยืนยันฝั่งเสิร์ฟด้วย `curl localhost:3000/sw.js | grep sovereign-v` และ HTML ต้องไม่มี unpkg

### เสริม P16 รอบค่ำ (30/9/69) — แจ้งเตือนทันที + QR ป้ายร้าน + บั๊ก SW cache API
- **แจ้งเตือน Telegram ทันที**: `partner.service.ts → notifyNewPartner` (fire-and-forget · อ่าน creds เดียวกับ F2 · ล้มเงียบไม่กระทบการสมัคร) — ข้อความมีลิงก์เข้าหน้าอนุมัติ
- **QR ป้ายร้าน**: `GET /api/partners/:id/qr` (สาธารณะ · ACTIVE เท่านั้น · ใช้ qrcode ที่มีอยู่) → QR ชี้ `/partners/?p=<id>` — หน้าแผนที่เห็น `?p=` = ซูมหมุดร้าน + เปิดการ์ด + แบนเนอร์ยืนยัน · ปุ่ม "🏷️ QR ป้ายร้าน" + "🖨️ พิมพ์ป้าย" อยู่ในแผงคู่ค้า ACTIVE ที่ /feedback-admin
- **แผงอนุมัติ fail-safe**: ลบแถวออกจอเมื่อ server ยืนยันเท่านั้น (เดิม optimistic ลบทั้งที่ request ล้ม — ผู้ใช้กดแล้ว "หาย" ทั้งที่ DB ยัง PENDING)
- **บั๊กใหญ่ที่จับได้: SW cache-first ครอบ GET same-origin ทุกเส้น รวม `/api/*`** — `/api/partners` ถูก cache ค่าว่างจากครั้งแรกที่เปิดหน้า (ก่อนมีข้อมูล) แล้วตอบจาก cache ตลอด = แผนที่/ข้อมูลสดค้างเก่าเสมอบนเครื่องที่เคยเข้าก่อน · แก้: SW เพิ่ม `if (url.pathname.startsWith('/api/')) return;` (network เสมอ) + bump `sovereign-v5` · **กฎ: SW ห้าม cache /api/ เด็ดขาด — เขียนโค้ดใหม่ที่ยิง API ต้องเช็คบรรทัดนี้เสมอ**
- พิสูจน์: สมัครจริงบนโดเมน → Telegram แจ้งเข้าทันที (log เงียบ = ส่งสำเร็จ) · อนุมัติแล้วหมุด+การ์ดชื่อร้านขึ้นบนแผนที่จริง (เห็นบนจอ) · QR endpoint 200 ทั้ง local/สาธารณะ

### P17 (30/9/69 ค่ำ) — กันสแปมคู่ค้า 3 ชั้น + บิลค่าบริการ IoT + คู่มือคู่ค้า
- **กันสแปม** (`partner-guard.service.ts`): ① IP ≤3 ใบ/วัน (`PARTNER_IP_DAILY_LIMIT`) ② ชื่อซ้ำ (normalized ตัดวรรณยุกต์ — คอลัมน์ `partners.name_normalized` + index) ③ **OTP ยืนยันเบอร์ก่อนสมัคร**: `POST /api/partners/otp/send` → ส่ง SMS ผ่าน gateway (`SMS_GATEWAY_URL`+`SMS_GATEWAY_KEY` ถ้าตั้ง) **ไม่มี gateway = dev fallback โค้ดลง docker logs และคืน devCode เฉพาะ non-production** → `POST /api/partners/otp/verify` คืน HMAC token (30 นาที ใช้ครั้งเดียว) → POST /api/partners ต้องแนบ `otpToken` (ไม่มี = 403) · ตัวหนังสือ error จริงคืนให้ผู้ใช้ (403 unverified · 429 spam)
- **บิลค่าบริการ IoT คู่ค้า**: `POST /api/partners/:id/bills` (SUPERADMIN) {title, amount, installTitle?} → สร้าง BusinessOrder ผูก `partnerId` (prefix `P…` · line "ค่าบริการ" · งานติดตั้ง = BusinessInstallation) → คืน `payUrl` (ลิงก์ลับ PromptPay เดิม) · แจ้ง Telegram ทำงานทันที · คู่ค้าดูบิลตัวเอง `GET /api/partners/:id/bills?t=<publicToken>` (403 ถ้า token ไม่ตรง) · **boundary: สร้าง/อ่านบิลอยู่ที่ business-shop.service (เจ้าของ business_orders) — partners เรียกผ่านเท่านั้น**
- **คู่มือคู่ค้า** หน้า `/partners/guide`: สิทธิประโยชน์ 4 ข้อ · ติดตั้ง QR ป้าย 4 ขั้น · ขอเชื่อม IoT 4 ขั้น — ลิงก์จากหัวหน้า /partners
- **ฟอร์มออกบิลในแผง admin**: แถวคู่ค้า ACTIVE → "🧾 ออกบิลค่าบริการ" → ใส่รายการ/ยอด/งานติดตั้ง → ได้ลิงก์ + ปุ่มคัดลอกข้อความส่งคู่ค้า
- บทเรียนเทสต์: limiter อ่าน env **ตอน import** — เทสต์ที่ต้องคลาย limit ตั้ง env ก่อนแล้ว dynamic import routes ใน before()
- **P18 — Telegram แจ้งชำระ + การ์ดรวมรอยืนยัน + guard LAN (30/9/69 ดึก):**
  - **Telegram แจ้งชำระทันที:** `payPublicOrderByToken` ใน business-shop.service ยิง TG ทุกครั้งที่ลูกค้าแจ้งชำระ (fire-and-forget · รูปแบบเดียวกับ notifyPartnerNewBill — อ่าน creds ผ่าน getTelegramCredentials ทุกครั้ง) — ห้ามแตะ flow หลัก
  - **การ์ดรวมรอยืนยัน:** `PendingPaymentsCard.tsx` + `computePendingReports()` (แจ้ง PROMPTPAY > 0 และ paidAmount < total) + `useConfirmReportedPayment()` — เรนเดอร์ที่แท็บออเดอร์ (สิทธิ์ SALES ขึ้นไป) · ยืนยัน = POST payments method CASH ยอดเท่าที่แจ้ง (กติกาเดียวกับ markPaid ปกติ) · **แก้ไฟล์นี้ = อย่าพ่วงเข้า BusinessWorkspace (เพดาน 400 บรรทัด components — gate จับแล้ว)**
  - **guard ชั้น 2:** business.routes.ts ตรวจ Host/x-forwarded-host ต้อง localhost/10./192.168./172.16-31 — host สาธารณะ = 403 ทันที (ชั้นหลัง WAF — WAF ยังเป็นด่านแรก) · ทดสอบ: Host: sovereignoriginshop.dpdns.org → 403
  - **บทเรียนจอจริง:** token ที่ login ไม่ถูกบันทึก = ล็อกอินไม่สำเร็จจริง แม้หน้าเปลี่ยน (shell เมนูโชว์ตั้งแต่ก่อน auth) — เช็ค `localStorage['sovereign-auth'].state.token` ก่อนสรุปผล · e2e-bot ไม่ใช่ member ของธุรกิจ = เห็นแค่ "ผู้ดู" (แท็บร้านค้าซ่อน) — ต้องเพิ่ม business_members OWNER ชั่วคราวเท่านั้น (ถอนหลังทดสอบ)
  - **เก็บกวาดหลังทดสอบ:** เบอร์ PromptPay ทดสอบ (UPDATE NULL) · ออเดอร์ทดสอบ + payments · business_members ชั่วคราว — ตารางเช็คใน STATUS.md
- **P18 §ความปลอดภัย — แผนป้องกันครบวงจร (red-team รอบ 30/9/69):**
  - **แนวคิดโจมตีที่จำลอง:** ①ระเบิด OTP รู้รหัสก่อนส่งจริง (devCode รั่วเพราะ NODE_ENV=development) ②SMS bombing เป่าเครดิตล่วงหน้า ③brute OTP ข้าม IP ด้วย proxy pool ④เข้า API ตรงจาก LAN ข้ามหน้าเว็บ ⑤แอบอ้าง Host header หลอก guard
  - **ประตูบานที่ปิดแล้ว:** (1) devCode ต้องมาจาก localhost/LAN เท่านั้น — ตรวจ 2 ชั้น (service + route) ด้วย `isPublicRequest`: cf-connecting-ip (Cloudflare ใส่เสมอบน tunnel) = สาธารณะแน่นอน + host ตรวจ localhost/LAN (2) OTP cooldown 60 วิ/เบอร์ (3) cap verify 10 ครั้ง/15 นาที/**ต่อเบอร์** — นับทุกครั้งแม้ OTP หมดอายุ (บั๊กที่จับ: cap อยู่หลัง early-return ทำงานไม่ถูก — ย้ายขึ้นบรรทัดแรก) (4) **:3001 bind 127.0.0.1 เท่านั้น** (compose) — LAN เข้า API ตรงไม่ได้ ต้องผ่าน :3000 (5) juice-shop (เว็บฝึกแฮก) ปิด + restart=no (6) guard ชั้น 2 ใช้ lib กลาง `lib/local-host.ts`
  - **จุดแข็งที่แฮกไม่ผ่าน (ตรวจแล้ว):** JWT secret 64 chars + บังคับความแข็งตอน boot · brute-force login 2 ชั้น+lockout+audit · SQL parameterized ทั้งหมด (ไม่มี *Unsafe กับ input ผู้ใช้) · React escape กัน XSS · ต้นทุน/PII ไม่ออกสาธารณะ · honeypot+WAF+rate-limit edge
  - **ข้อจำกัดที่รับรู้:** cooldown/cap ต่อเบอร์เป็น in-memory — restart backend = รีเซ็ต (รับได้ในสเกลนี้ ถ้าขยายค่อยย้าย Redis) · **บทเรียน deploy:** backend รันจาก /app/dist ใน **image** (ไม่ใช่ mount) — แก้ backend ต้อง `docker compose build core-api` + `up -d --force-recreate` เสมอ แค่ restart ไม่พอ
  - **ควรทำต่อ (ลำดับถัดไป):** ตั้ง NODE_ENV=production + mock-admin เป็นบัญชีจริงตอนขายจริง · Cloudflare Turnstile หน้าสมัครถ้าสแปมเพิ่ม · จำกัด CORS_ORIGIN ให้เหลือเฉพาะที่ใช้จริง
