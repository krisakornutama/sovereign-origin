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

## ๔. เช็คสุขภาพ 1 นาที (Git Bash / PowerShell)

```bash
cd "/e/My work/Project Sovereign Origin"
curl -s -o /dev/null -w "web     : %{http_code}\n"  http://localhost:3000
curl -s http://localhost:3001/healthz | grep -o '"ok":true' && echo "API     : OK"
docker ps --filter name=sovereign --format "{{.Names}}: {{.Status}}"
ls -t backups/postgres/sovereign_v2_*.dump | head -1
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
| Secret scanning / push protection | **ไม่พร้อมใช้บนแพลนปัจจุบัน (private + free)** — เปิดได้เมื่ออัปเกรด Pro/public ผ่าน Settings → Advanced Security |
| Required checks บน main | พร้อมเช็คทั้ง 3 แล้ว (`audit`, `size`, `publish` โหมด PR) — ตั้งจริงเมื่อแพลนรองรับด้วย `bash tools/set-required-checks.sh --apply` |

ทบทวนรอบถัดไปเมื่อ: อัปเกรดแพลน / เพิ่ม secret ใหม่ / เพิ่ม workflow ใหม่
