# Project Analysis — 19 Oct 2026 (lean pass)

> **ขอบเขต**: repo นี้ = แอปเดสก์ท็อป Sovereign OS (Electron shell + core-api + หน้าเว็บที่รันบนเครื่อง)
> เว็บสาธารณะ (ร้าน/catalog/demo/SEO/WAF) ย้ายไป repo `Sovereign-Web-Standalone` แล้ว
> โดเมนหลัก: `https://sovereignoriginshop.dpdns.org`
>
> เอกสารนี้เป็น "แผนที่หลักฐาน" สำหรับ agent ตัวถัดไป: อะไรวัดได้ อะไรแก้แล้ว และอะไรยังไม่ควรแตะ

---

## 1) ตัวเลขจริง (นับจาก git + ดิสก์)

| ตัวชี้วัด | ค่า |
|---|---|
| ไฟล์ที่ git track | 1,204 |
| ไฟล์โค้ด / บรรทัด | 1,010 ไฟล์ / 182,019 บรรทัด |
| `sovereign-os/core-api` | 460 ไฟล์ / 86,148 บรรทัด |
| `src/pages` | 60 ไฟล์ / 22,805 บรรทัด |
| `src/components` | 130 ไฟล์ / 20,306 บรรทัด |
| โมดูล backend | 62 (docs/modules 67 ไฟล์ — มากกว่าจำนวนโมดูล) |
| deps | frontend 7 + 10 dev · core-api 17 + 14 dev |
| tools tests | 850 tests (849 pass / 1 skip / 0 fail) เมื่อ 19/10/69 |

เพดาน lines ที่ frontend-gate บังคับ: pages ≤ 800 · components ≤ 400 — แต่ baseline รับของเก่าไว้:
pages เกิน 6 ไฟล์ (settings 1,254 · dashboard 1,219 · treasury 1,187 · ai-agent 1,064 ·
livestock 860 · knowledge 806) และ components เกิน 5 ไฟล์ (CodingIde 791 · KidHomePanel 765 ·
use-kid-home 554 · Icon 653 · SensorsHub 483) → **ตัวเลข "ผ่าน gate" ไม่ได้แปลว่าไม่มีหนี้**

---

## 2) ปัญหาที่พิสูจน์ได้ (และแก้แล้วรอบนี้)

### 2.1 Nightly gate แดงติดกัน 11 รอบ — ราก 2 จุด

หลักฐาน: `nightly-history.json` ตั้งแต่ 3 ต.ค. เป็น `ok=false` ทุกแถว (3,4,5,6,8,10,11,12,15,16,18)
และ 5 วันไม่มีแถวเลย (7,9,13,14,17) · `data/system-truth.json` ค้างที่ 17 ต.ค. · `lastGateOk:null`

1. **`tools/test/installer-cmd.test.mjs` ไม่ hermetic** — spawn `INSTALL-SOVEREIGN-NODE.cmd -DryRun`
   แล้วตัว `.cmd` ไปยิง HUB จริง (`http://192.168.1.102:3000`) → คืนที่ frontend ไม่ตอบ = แดง
   **แก้**: `-DryRun` ไม่แตะเครือข่ายอีก (exit 0 + "DRY RUN complete") · เทสต์ 23/23
2. **`verify.mjs` เขียน `system-truth.json` เฉพาะตอนจบสำเร็จ** — พอ tools test ล้มหนึ่งครั้ง
   ก็ `process.exit(1)` ก่อนถึงบล็อกเขียน → nightly อ่านไม่ได้
   **แก้**: ย้ายเป็น `writeSystemTruth()` + `process.on('exit')` ครอบทุกเส้นทางล้ม

### 2.2 BIT_ROT ปลอม + ไฟล์ขยะ 1,070 ไฟล์

`data-integrity.service.ts` สแกน JSON ทุก boot + รายสัปดาห์ เทียบ `.sha256` sidecar
แต่ host tools (`nightly-verify`, `ops-status`, `verify`) เขียน JSON ตรง ๆ **โดยไม่อัปเดต sidecar**
→ checksum ไม่ตรง → ระบบตีเป็น `BIT_ROT` (critical) แล้ว quarantine สำเนาไว้ทุกครั้ง
ผลสะสม: `nightly-history.json.corrupt-*`, `ops-status.json.corrupt-*`, `system-truth.json.corrupt-*`
รวม **1,070 ไฟล์** (ทั้งหมดเป็นสำเนาของไฟล์ดี ไม่ใช่ข้อมูลจริง)

**แก้**: `tools/json-checksum.mjs` (tmp → sidecar → rename) ใช้ใน 3 tools + เขียน sidecar ใหม่ให้ไฟล์
ปัจจุบัน + ลบสำเนา `.corrupt-*` ทั้งหมด · มีเทสต์ `tools/test/json-checksum.test.mjs` 4 เคส

### 2.3 โมดูล/ไฟล์ที่ไม่มีความหมาย

- `prisma/schema.sqlite.prisma` 2,248 บรรทัด — ไม่มีใครอ้างถึง (ระบบใช้ Postgres เท่านั้น)
  → ลบ + ถอดกฎ schema-sync ออกจาก arch-gate/docs/CI/AGENTS
- `frontend-watchdog.mjs` ที่ราก — poller ซ้อนกับ `tools/frontend-watchdog.mjs` (one-shot)
  ที่ Scheduled Task เรียกอยู่ → ลบ, `autostart.mjs` ชี้ตัวเดียว
- `synthetic-browser-check.mjs` ตรวจ `/shop` ซึ่งย้ายไปเว็บแล้ว → 404 ทุก 5 นาที
  (FAIL 8,144 บรรทัด, log 4.15 MB) → ชี้หน้า login + จำกัด log 2 MB
- `BusinessShopTab` + `_app.tsx` + `useFeatureStore` ยังอ้าง `/shop` ในแอป → ชี้โดเมนจริง
  + เปิดผ่าน `shell.openExternal`

---

## 3) สิ่งที่ยัง **ไม่** แก้ (และเหตุผล)

| งาน | ทำไมยังไม่ทำ |
|---|---|
| `archive_timeout` 300 → 900s (WAL 24 GB) | ต้อง recreate container = ผิดกติกา Cold Soak — ต้องให้เจ้าของอนุมัติ + ปิดระบบ |
| แยก `settings.tsx` / `dashboard.tsx` | ไฟล์ 1,200+ บรรทัด เสี่ยง regression สูง ต้องมี E2E ครอบก่อน |
| รวมโมดูลจิ๋ว 62 → ~56 | ต้องแก้ `module-owners.json` + boundary-baseline + docs/modules พร้อมกัน = branch แยก |
| รวม HTTP helper 3 ตัว | ~50 หน้ายังเรียก `fetch('/api…')` ตรง — ต้องทยอยย้าย ไม่ใช่ rename ทั้งกอง |
| `STATUS.md` 412 บรรทัด / 344 KB | เป็น journal มีคุณค่าทางประวัติ → ย้ายไป `docs/history/` ก่อนทำ STATUS สั้น |

---

## 4) แผนที่ระบบ (อ่านก่อนแก้)

```
sovereign-frontend/
  electron/        main.js (thin shell: :3000 → :4100 → offline, sidecar, tray, YouTube)
  src/pages/       60 หน้า · ทุกหน้าต้องมี <Sidebar /> (ยกเว้น public ที่ถูกถอดออกแล้ว)
  src/components/  130 ไฟล์ · business/post/* = ตัวโพสต์ + YouTube upload UI
  src/lib/         config.ts (API URL + public site), apiFetch/apiClient/fetchJson (3 helper)
  src/stores/      auth · language · feature flags (ALWAYS_VISIBLE)
sovereign-os/core-api/
  src/modules/     62 โมดูล (routes) — เจ้าของตารางดู tools/module-owners.json
  src/services/    data-integrity (sidecar), business-shop, youtube? (ไม่ — YouTube อยู่ Electron)
  prisma/          schema.prisma ฉบับเดียว
tools/
  verify.mjs       quality gate (arch-gate → backend ∥ frontend → tools tests)
  nightly-verify   รัน verify:full + เขียน nightly-history (มี sidecar แล้ว)
  json-checksum    เขียน JSON + .sha256 (contract เดียวกับ core-api saveJsonAtomic)
  stage-release    รวม artifact → release/ + SHA256SUMS
Project Sovereign Origin Install/
  PACK-DESKTOP.mjs / INSTALL-DESKTOP.cmd / desktop/  (ชุดติดตั้งเครื่องอื่น)
```

**เส้นสาธารณะ**: domain → cloudflared → `:3000` → rewrite `/api/*` → `:3001`
(backend bind `127.0.0.1`) · WAF เป็น default-deny → path ใหม่ต้องเติม allowlist ก่อน

**เดสก์ท็อป**: Electron probe `:3000` (dashboard), `:4100` (launcher), `:3001` (API)
ถ้าไม่มี dashboard → launcher/offline · sidecar `resources/core-api/dist/server.js` รันด้วย `node` ของเครื่อง
(ไม่ใช้ Docker ภายใน) → เครื่องปลายทางต้องมี Node.js ถ้าอยากให้ API ขึ้นเอง

---

## 5) กติกาความปลอดภัยที่ห้ามละเมิด

- **ห้ามแตะ `sovereign-os/infra/.env`** (มี token จริง) · ห้าม print/commit
- **Cold Soak**: ห้าม restart runtime / migration / deploy — build artifact ได้ แต่ห้าม recreate container
- **PROJECT DRIVE ONLY**: ทุกอย่างอยู่บน E: (worktree, build, backup, log)
- `sovereign-frontend/electron/youtube-client.json` = client ของแอป (gitignored) — ห้ามขึ้น repo สาธารณะ
- ก่อน push: สแกน `sk_live_…` ด้วย `git log -p <range> | grep -cE 'sk_live_[A-Za-z0-9]{20,}'`
  (พิมพ์แค่ตัวเลข ไม่พิมพ์บรรทัดที่ match)

---

## 6) งานถัดไปที่คุ้มที่สุด (เรียงตามผลตอบแทน)

1. **ปิดช่องว่าง nightly** — เพิ่ม "เมื่อวานไม่มีแถว" ใน nightly-report (ตอนนี้รู้แค่ว่า ok=false)
2. **WAL** — เมื่อเจ้าของอนุมัติ: `archive_timeout=900` + วัด 24 ชม. (คาดลด 24 GB → ~8 GB)
3. **แยกหน้าใหญ่ทีละหน้า** — เริ่ม `settings.tsx` (แยกแท็บเป็น component) พร้อม E2E ของเดิม
4. **รวม helper HTTP** — ทำ `fetchJson` เป็น canonical แล้ว re-export จากอีกสองตัวก่อน
5. **Soverien shop toolkit** — export/import JSON + sticker 81×55 (งานผลิตจริงของเจ้าของ)
6. **อัปเดตเว็บจาก source นี้** — repo `Sovereign-Web-Standalone` ใช้ `src/` ชุดเดียวกัน
   แต่หน้า public ถูกถอดออกจาก desktop แล้ว → อย่าเพิ่มกลับโดยไม่ตั้งใจ
