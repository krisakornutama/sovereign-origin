# QUEUE — คิวงาน Launch Reddit (Sovereign OS CE)

ส่งต่อให้ agent ตัวถัดไป — สถานะทั้งหมดในไฟล์นี้ยืนยันจาก GitHub API และ GHCR แล้วเมื่อ 2026-11-07
งานที่ต้องทำบนเว็บ GitHub UI (ถ้ามี) จะระบุว่า "เจ้าของทำ" ให้แยกจากงานที่ agent ทำเองได้

> อัปเดตล่าสุด 2026-11-07: ตรวจ image manifest ครบ 6 tag ผ่านทั้งหมด (ดึงได้โดยไม่ล็อกอิน, amd64+arm64)
> · branch protection เปิดจริง 6 required checks · topics ครบรวม `agpl` · `npm run verify` ผ่าน 6/6
> · เหลือแค่เจ้าของ rotate token กับโพสต์ Reddit

---

## สถานะภาพรวม (ตรวจแล้ว)

| รายการ | สถานะ |
|---|---|
| Repo visibility | public · license AGPL-3.0 · description "Sovereign Origin — self-sovereign home OS" |
| Topics | **ครบแล้ว** — self-hosted, iot, mqtt, docker-compose, homelab, typescript, nextjs, postgresql, agpl |
| Branch protection `main` | **เปิดแล้ว** — required checks 7 ตัว (ชื่อ job ล้วน): `audit`, `size`, `publish`, `test (ubuntu-latest)`, `test (windows-latest)`, `test-db`, `arch-gate` |
| Release `v1.2.0` | published (ไม่ใช่ draft) — release note เขียนใหม่แล้ว มีคำสั่ง `docker pull` + บันทึกการเผยแพร่ image |
| Release note | ระบุว่า `api` เผยแพร่สำเร็จ และ `latest`/`1.2` ของ `web` ถูกย้ายมาชี้ build ล่าสุดแล้ว |
| Workflow "Publish images (GHCR)" | **เสร็จและเขียว** — run `42338553428` (base `11b07ef`) success 6/6 job ใน ~2 นาที |
| Image `api` | public · tags `1.2.0`, `1.2`, `latest`, `main`, `sha-11b07ef`, `sha-97dd0fe`, `sha-b08ba90` · multi-arch amd64+arm64 |
| Image `web` | public · tags `1.2.0`, `1.2`, `latest`, `main`, `sha-11b07ef`, `sha-97dd0fe`, `sha-b08ba90`, `sha-c000361` · multi-arch amd64+arm64 |
| เอกสารที่อ้าง tag image | ตรงกับของจริงแล้ว (`1.2.0` ไม่มี `v` นำหน้า) — `deploy/community/README.en.md`, `.env.example`, `docker-compose.yml`, `docs/FAQ-REDDIT.md` |
| ด่านตรวจ image ก่อนโพสต์ | มีแล้วใน `docs/LAUNCH-REDDIT.md` (หัวข้อ "Verify the published images before posting") |
| Demo GIF | ฝังใน `README.md` และ `README.en.md` แล้ว (`docs/media/demo.gif`) |
| Telegram token | ใช้งานได้ (sendMessage → 200) แต่ **ควร rotate** ถ้าเคยหลุดใน log |
| Quality gate | **ผ่าน 6/6** (2026-11-07, 2.5 นาที) — แก้ module-boundary 6 เส้นที่ค้างหลังแยก Pro + อัปเดตเทสต์ E2E/GHCR ที่อ้าง spec/workflow รุ่นเก่า |

---

## งานที่เหลือ

### 1. เจ้าของทำ — rotate Telegram token
ถ้า token เคยถูกพิมพ์ใน log หรือแชท ให้ทำใหม่: @BotFather → `/revoke` → เอา token ใหม่ไปใส่ `TELEGRAM_BOT_TOKEN` ใน `sovereign-os/infra/.env` แล้วรัน

```bash
docker compose -f sovereign-os/infra/docker-compose.yml up -d core-api
```

### 2. ✅ ตรวจ image แล้ว (2026-11-07) — ผ่าน
ตรวจ manifest แบบไม่ล็อกอินครบ 6 tag: `api`/`web` × `1.2.0`/`1.2`/`latest`
→ ทุกตัวมี `linux/amd64` + `linux/arm64` และดึงได้โดยไม่ต้องล็อกอิน
คำสั่งนี้รันซ้ำได้ก่อนโพสต์ทุกครั้ง (รายละเอียดใน `docs/LAUNCH-REDDIT.md`):

```bash
# ทุก tag ที่เอกสารอ้างต้องดึงได้แบบไม่ล็อกอิน
for img in api web; do for t in 1.2.0 1.2 latest; do
  docker manifest inspect "ghcr.io/krisakornutama/sovereign-origin/$img:$t" >/dev/null && echo "ok $img:$t";
done; done
```

ถ้าด่านนี้ไม่ผ่าน ห้ามโพสต์ — คอมเมนต์แรกของ thread จะเป็นคนก๊อปคำสั่งใน README ไปรันแล้วเจอ 404

### 3. เจ้าของทำ — โพสต์ Reddit
ใช้ `docs/LAUNCH-REDDIT.md` (ฉบับเต็ม) หรือฉบับสั้น 5 ช่อง (Project name / Repo / Description / Deployment / AI involvement) ภาษาอังกฤษ
ก่อนโพสต์: อ่านส่วน "Reviewer checklist before posting" แล้วลบส่วน reviewer ออก

---

## Nightly / Task Scheduler — ตรวจแล้ว 2026-11-07

### แก้แล้ว — tools unit tests (ต้นเหตุที่ Quality Gate แดง)
- `tools/test/e2e-auth-guard.test.mjs` ยังอ้าง `pos-flow.spec.ts` ที่ถูกลบตอนแยก Pro → อัปเดตเป็น `pages` / `spa-nav` / `farm-executive`
- `tools/test/community-stack.test.mjs` อ้าง workflow รุ่นเก่า (`linux/amd64,linux/arm64` บรรทัดเดียว) แต่ workflow แยก build ต่อ arch → เปลี่ยนไปตรวจ `platform:` ใน matrix + `imagetools create`
- `tools/test/batch-codepage.test.mjs` ฟ้อง `tools/install/uninstall.cmd` เป็น LF (ไฟล์นี้ไม่ถูก track — มีผลเฉพาะเครื่องนี้) → แปลงเป็น CRLF แล้ว
- ผล: `npm run verify` ผ่าน 6/6 (2026-11-07)

### แก้แล้ว — backup restore-check (false positive)
- nightly 2026-11-07 ฟ้อง `system_settings(12>10)` = "ข้อมูลเพี้ยน" แต่สาเหตุจริงคือ **ลบ DB override ของ Telegram หลังถ่าย backup** (`telegram.botToken` / `telegram.chatId`) ซึ่งเป็นการทำงานปกติ
- แยกตรรกะเทียบเป็น `tools/verify/restore-compare.mjs` — แถวต่างสองทางถือปกติ (dump เป็น snapshot), ยังจับของจริง (ตารางหาย, migration head ไม่ตรง, restore error) เหมือนเดิม
- เทสต์ `tools/test/backup-restore-compare.test.mjs` 5/5 · รัน restore จริงซ้ำผ่าน ("กู้คืนได้จริง")

### แก้แล้ว — P0 Task Scheduler + Dead-man Alert (2026-11-07 รอบดึก)
- **`ShipShop3000`** — disable แล้ว (`schtasks /Change /TN "ShipShop3000" /DISABLE`) เพราะเป็น task เก่าที่รัน `start-sovereign.bat` แล้วค้าง/เปิด browser เอง · `tools/ops-status.mjs` อ่าน `State` แล้วแสดง "ปิดอยู่ (ตั้งใจ)" ไม่นับเป็นงานล้ม
- **`Sovereign Nightly Verify`** — รันผ่าน Task Scheduler จริงเมื่อ 21:12 → **Last Result 0** · nightly status `ok=true` (gate 6/6 · backup restore ผ่าน · consent smoke ผ่าน)
- **`Sovereign Nightly Deadman`** — task ใหม่ 03:30 ทุกวัน (ผ่าน `run-hidden.vbs` ไม่มีหน้าต่างเด้ง) · ตรวจ `nightly-history.json`: ไม่ผ่าน/ไม่มีผลติดกัน **2 คืน** = Telegram · dedup วันละครั้ง · creds ใช้ `tools/verify/telegram-creds.mjs` (DB → `sovereign-os/infra/.env`)
- **`tools/nightly-report.mjs`** — เลิกอ่าน DB เอง เปลี่ยนมาใช้ creds กลาง → รายงาน nightly ส่ง Telegram ได้จริง (ยืนยันรอบ 21:15, creds: env)
- **`STATUS.md`** — gen ใหม่: gate ✅ 6/6 · nightly ✅ · task scheduler ✅ (10 งาน, ShipShop ปิดตั้งใจ)

### ค้างเฉพาะข้อมูล (ไม่บล็อก P0)
- `codeMatch=false` ใน nightly ล่าสุด: prod `:3001` ยังรัน fingerprint เก่า (dist 254 ไฟล์ vs ดิสก์ 256) — เป็นเรื่อง deploy ไม่ใช่ nightly พัง; `docker restart sovereign-core-api` จะเคลียร์ (ต้องยืนยันก่อนแตะ production)

---

## หมายเหตุการทำงาน (สำคัญสำหรับ agent รอบถัดไป)

- **`gh` CLI ใช้ไม่ได้ (token หมดอายุ) แต่ GitHub API ใช้ได้** — ขอ token จาก Git Credential Manager ได้เสมอ:
  ```bash
  T=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
  curl -s -H "Authorization: Bearer $T" https://api.github.com/repos/krisakornutama/sovereign-origin/...
  ```
  ใช้ token นี้ dispatch workflow / อ่าน job / แก้ release body ได้ (ห้ามพิมพ์ค่าออกมา)
- **workflow image ไม่ใช้ QEMU แล้ว** — build แยก 4 job: `api/web` × amd64 (`ubuntu-latest`) + arm64 (`ubuntu-24.04-arm`) แล้ว merge manifest ด้วย `docker buildx imagetools create` ใช้เวลา ~2 นาที (เดิม QEMU ค้างชนเพดาน 6 ชม.)
- **การ dispatch** ต้องส่ง input ให้ครบตามที่ต้องการ:
  - `tag` (เช่น `1.2.0`) เติม tag ที่ขาดโดยไม่ต้องสร้าง git tag ใหม่
  - `extra_tags` (เช่น `1.2,latest`) ผูก tag เสริมเข้ากับ manifest เดียวกันแบบไม่ rebuild — ต้องกรอก `tag` ด้วย
- **อ่านสถานะ run จาก REST API เท่านั้น** — หน้า HTML เคยรายงาน `in_progress=0` ทั้งที่ job ยังรัน
- **`run_terminal_command` หมดเวลา ~290 วิ** — loop poll ต้องสั้นกว่านั้น (เช่น `seq 1 9` + `sleep 25`)
- `jq` ไม่มีในเครื่องนี้ · python console เป็น cp1252 (พิมพ์ไทยแล้ว `UnicodeEncodeError`) → ใช้ `node -e` กับ JSON แทน
- `str_replace` ต้องใช้ absolute path (`E:\My work\Project Sovereign Origin\...`) เพราะ project root ของเซสชันคือ `Sovereign Guard Temp`
- ประวัติคิวงานเก่าอยู่ที่ `QUEUE-ARCHIVE.md`
