# Sovereign Origin — สถาปัตยกรรมฉบับย่อ (Context Pack แม่)

> เป้าหมายไฟล์นี้: AI/มนุษย์ใหม่เข้าใจระบบพอทำงานได้ **ภายใน 5 นาที** — ไม่ต้องอ่าน STATUS.md (17k+ บรรทัด)
> กติกา: เอกสารนี้บรรยาย "ของที่มีจริงในโค้ด" เท่านั้น ถ้าโค้ดเปลี่ยน ให้แก้ไฟล์นี้พร้อมกัน (arch-gate เตือนผ่าน file-budget เมื่อแก้ใหญ่เกิน)

## ภาพรวม

ระบบบริหารฟาร์ม/ธุรกิจ/ชีวิตแบบ self-sovereign แบ่งเป็น 2 ส่วน:

| ส่วน | เทคโนโลยี | ที่อยู่ | วิธีรัน prod |
|---|---|---|---|
| Frontend | Next.js 16.3 (Pages Router) + Tailwind + Zustand | `sovereign-frontend/` | `next start` พอร์ต :3000 บนเครื่อง |
| Backend | Node.js + Express + Prisma | `sovereign-os/core-api/` | Docker container `sovereign-core-api` (mount `dist/` จากเครื่อง, CMD = generate + tsc + start) |
| Database | PostgreSQL + TimescaleDB | Docker `sovereign-db` | DB จริงชื่อ **`sovereign`** (user `sovereign`) — ดูความจริงจาก env ของ container เสมอ |

## กฎเหล็ก 4 ข้อ (มีกลไกตรวจ ไม่ใช่ธรรมเนียม)

1. **DB จริงฉบับเดียว** — `DATABASE_URL` ใน `sovereign-os/core-api/.env` ต้องชี้ DB ที่ connect ได้จริง → ตรวจโดย **arch-gate (env-truth)**
2. **ไฟล์ไม่โตเกิน 800 บรรทัด** — ไฟล์ใหม่/ที่แก้ใน branch ห้ามโตเกินเพดาน (ไฟล์เก่าไม่ย้อนหลัง) → ตรวจโดย **arch-gate (file-budget)**
3. **ตารางมีเจ้าของ + เส้นข้ามต้องประกาศ** — แผนที่ตาราง→โมดูล อยู่ที่ `tools/module-owners.json` (ครอบครบทุกตาราง · shared: system_settings/security_events/idempotency_keys) · การแตะตารางคนอื่นต้องมีอยู่ใน `tools/boundary-baseline.json` แล้วเท่านั้น — **เส้นข้ามใหม่ = verify fail** (เพิ่ม baseline พร้อมเหตุผลเมื่อจำเป็นจริง · เติมเจ้าของตารางใหม่ด้วย `node tools/map-owners.mjs --apply`)
   - ⚠️ blind spot ที่รู้ตัว: เกตจับเฉพาะ `prisma.<delegate>` — การเขียนผ่าน **raw SQL** (`INSERT INTO sensor_telemetry` จาก mqttIngest/wan-monitor/ups-monitor ฯลฯ) มองไม่เห็น ถ้าจะเพิ่มการเขียนตารางโมดูลอื่นด้วย raw SQL ให้ระบุใน PR และ baseline เอง
4. **prod ต้องรันโค้ดชุดเดียวกับดิสก์** — `/api/health` รายงาน `build.fingerprint` (hash เนื้อหาไฟล์ dist ที่โปรเซสโหลด) → เทียบกับดิสก์โดย **prod-truth gate** เมื่อรัน `verify:full` · parity ของอัลกอริทึมสองฝั่งถูกตรวจบน CI (`tools/check-parity.mjs`) · เห็นผลได้ทันทีที่หน้า **/system-health**

## กติกา HOST-SAFE + ความปลอดภัยที่มีด่านจริง (เพิ่ม 2026-11-17)

| กติกา | ทำไม (เคสจริง) | ด่านที่บังคับ |
|---|---|---|
| **ห้ามโค้ดโปรเจ็กแตะเน็ต/พร็อกซี/ไฟร์วอลล์/autorun ระดับ OS** | ตั้ง `ProxyServer` ค้างใน `HKCU\...\Internet Settings` ทำให้เครื่องทั้งเครื่องขาดเน็ตหลังรีบูต (SEC-044) | `tools/security/host-network-guard.mjs` (0 hit) |
| **สคริปต์ host ต้องมี sha256 ใน manifest** | malware เขียน scheduled task เอง + นโยบาย Defender ถูกเขียนกลับหลังบูต (SEC-037/032) | `tools/security/host-integrity.mjs` + `tools/test/host-integrity.test.mjs` |
| **ค่าจากผู้ใช้ห้ามถึง sink ดิบ** (HTML/CSV) | stored XSS ในรายงานสุขภาพและเกียรติบัตร · CSV formula injection (SEC-052/056/057) | `tests/health.routes.test.ts` · `tools/test/certificate-html-escape.test.mjs` · `tools/test/csv-formula-guard.test.mjs` |
| **ไฟล์ที่ผู้ใช้วางได้ ต้องเสิร์ฟด้วย Content-Type ปลอดภัย** | เขียน `.html` ลง `uploads/` แล้วเสิร์ฟเป็น `text/html` = XSS บน origin เดียวกับ JWT (SEC-053) | `tools/test/file-serve-extension-gate.test.mjs` (ทุก `sendFile` ต้องมี allowlist นามสกุล · ห้าม `express.static`) |
| **URL จากผู้ใช้ต้องผ่าน SSRF guard** | `import-gguf` เคยยิง loopback/docker/metadata ได้ (SEC-045) | `src/lib/ssrf-guard.ts` + `tests/ssrfGuard.test.ts` |
| **role มาจาก `src/lib/roles.ts` เท่านั้น** | ชุด role กระจาย 14 ที่ + `requireRole` เขียนสด 128 จุด ⇒ สิทธิ์หลุดเป็นรายโมดูล (SEC-046/047/048/049) | `tests/roleSourceOfTruth.test.ts` |

**หนี้ที่รู้ตัว (ยังไม่แก้ — ห้ามลืม):** CSP ของเว็บยังมี `script-src 'unsafe-inline' 'unsafe-eval'` (`SEC-055`) เพราะ nonce ต้องออกจาก middleware ซึ่งใช้ไม่ได้กับ `output: 'export'` ของแอปเดสก์ท็อป ⇒ ต้องแยก CSP สองชุด + มีหน้าต่างทดสอบที่เจ้าของอนุมัติ · ระหว่างนี้ถือว่า **XSS ครั้งเดียว = ยึดบัญชีได้** (JWT อยู่ใน `localStorage`)

## ด่านคุณภาพ (npm run verify ที่ root)

```
verify        = Architecture Gate → backend build+test ∥ frontend typecheck+build
verify --db   = เพิ่มชุด real-Postgres (test:db) + coverage report
verify:full   = เพิ่ม Prod-Truth Gate (fingerprint disk↔runtime) + E2E Playwright
```

### Checklist ก่อน commit (รายการเดียว — ทุกบรรทัดมี exit code ที่คาด)

| # | คำสั่ง (รันจาก worktree ของ branch ตัวเอง) | EXIT ที่คาด |
|---|---|---|
| 1 | **red-first**: `cd sovereign-os/core-api && npx tsx --test tests/<ไฟล์ใหม่>.test.ts` — เขียนเทสต์ก่อนแก้ ต้องเห็นแดงก่อน | **1** ก่อนแก้ → **0** หลังแก้ |
| 2 | `cd sovereign-os/core-api && ./node_modules/.bin/tsc --noEmit` (อย่าใช้ `npx tsc` — ค้างบน Windows) | **0** |
| 3 | `node tools/arch-gate.mjs` (file-budget · env-truth · boundary) | **0** |
| 4 | `cd sovereign-os/core-api && npm test` — จำนวนเคสต้อง **≥ baseline ของรอบก่อนหน้า** (ห้ามลดลง) | **0** |
| 5 | `cd sovereign-frontend && npm run typecheck` แล้ว `npm run build` | **0** และ **0** |
| 6 | `npm run test:tools` (เทสต์ตรรกะเครื่องมือใน tools/ — อยู่ใน verify ด้วย) | **0** |
| 7 | **`npm run verify` ที่ MAIN (รากโปรเจกต์) เท่านั้น** — worktree ไม่มี node_modules ครบ รันที่ worktree ล้มทันที · ทุกด่านเขียวแล้วค่อย commit · แก้ UI ที่มีผลหน้าเว็บ = `npm run verify:full` (เพิ่ม e2e) | **0** |

> red-first คือกติกา ไม่ใช่คำแนะนำ: งานที่พิสูจน์พฤติกรรมต้องมีเทสต์ใน `tests/` จับไว้
> และเห็น EXIT=1 จริงก่อนแก้โค้ด — "รันสคริปต์ชั่วคราวผ่าน" ไม่นับเป็นหลักฐาน

- เกตทั้งหมดอยู่ที่ `tools/` (arch-gate.mjs, prod-truth.mjs, fingerprint-lib.mjs, module-owners.json)
- fingerprint = hash ของ `{relativePath, size, sha256(content)}` เรียงตาม path — คำนวณฝั่ง runtime (`src/lib/runtime-fingerprint.ts`) และฝั่ง tools ให้ผลตรงกันทุกไบต์

## โมดูล (เอกสารครบทุกโมดูลที่ docs/modules/)

- **ครบ 60+ โมดูล** — ส่วน "ของจริงในโค้ด" (ตารางเจ้าของ · routes · endpoints · services · เส้นข้ามที่ยอมรับ) gen อัตโนมัติจากโค้ดด้วย `node tools/gen-module-docs.mjs` (ห้ามแก้มือใน marker auto)
- 8 โมดูลหลักมีเจตนา/ข้อห้ามเขียนมือ: [auth](modules/auth.md) · [business](modules/business.md) · [trace](modules/trace.md) · [farm](modules/farm.md) · [inventory](modules/inventory.md) · [energy](modules/energy.md) · [restaurant](modules/restaurant.md) · [treasury](modules/treasury.md) — โมดูลอื่นมีช่อง "เจตนา/ข้อห้าม" ให้เจ้าของโมดูลเติม

## โครงสร้าง backend

```
sovereign-os/core-api/src/
  routes.ts          # ประกาศ mount ของทุก module router + /api/health (fingerprint อยู่นี่)
  modules/<name>/    # routes — บางโมดูลเรียก service ตรง ๆ
  services/          # business logic — ทุก service ใช้ prisma client ก้อนเดียว (src/lib/prisma)
  lib/               # runtime-fingerprint, prisma ฯลฯ
  middleware/        # authenticate, requireRole, rateLimit
```

**Express 4 ไม่ดัก promise ที่ reject** — async handler ที่ `await` แล้วโยน error จะทำให้คำขอ **ค้าง** จน client timeout (ไม่ใช่ 500) ⇒ route handler ที่ `await` ต้องมี `try/catch` ของตัวเอง หรือห่อด้วย `asyncRoute()` จาก `src/lib/async-handler.ts` (ตอบ 500 JSON + `detail` ให้อัตโนมัติ) · มีด่านบังคับอยู่ที่ `tests/routeAsyncSafety.test.ts` (สแกนด้วย TypeScript AST — handler ใหม่ที่ลืมจะทำให้ CI แดง)

## เครื่องมือใน tools/ (แหล่งความจริง)

| เครื่องมือ | หน้าที่ |
|---|---|
| `arch-gate.mjs` | ด่านแรกของ verify: file-budget · env-truth · boundary (baseline แบบ fail) |
| `module-owners.json` | ตาราง→เจ้าของ + serviceAliases (แหล่งเดียว ทั้ง gate และ map-owners ใช้ร่วม) |
| `map-owners.mjs` | เติมเจ้าของตาราง unmapped จากการใช้จริง (`--apply` เขียน) |
| `boundary-baseline.json` | เส้นข้ามโมดูลที่ยอมรับแล้ว — นอกไฟล์นี้ = fail |
| `prod-truth.mjs` + `fingerprint-lib.mjs` | เทียบ fingerprint ดิสก์ ↔ runtime (verify:full) |
| `check-parity.mjs` | พิสูจน์อัลกอริทึม fingerprint สองฝั่งตรงกัน (CI รันทุก PR) |
| `verify.mjs` | Quality gate เดียว — เขียนผลล่าสุดลง `data/system-truth.json` |
| `gen-module-docs.mjs` | gen เอกสารโมดูลจากโค้ดจริง (ไม่ทับส่วนเขียนมือ) |
| `deploy-guard.mjs` | ด่าน backup ก่อน deploy/migrate (ไม่มี dump / dump เก่ากว่า migration / เก่าเกิน 24 ชม. = หยุด) |
| `deploy-db.mjs` | ทาง deploy เดียวของ core-api: ด่าน backup → build → migrate deploy → restart → poll `/healthz` |
| `security/host-network-guard.mjs` | ห้ามโค้ดแตะเน็ต/พร็อกซี/autorun ระดับ OS (ด่าน HOST-SAFE) |
| `security/host-integrity.mjs` + `.json` | sha256 ของสคริปต์ host 28 ไฟล์ — ตรวจอัตโนมัติ, `--write` อัปเดต (ต้อง commit สคริปต์ก่อน) |
| `host-smoke.mjs` | พิสูจน์ว่า "ยังใช้งานได้จริง" หลังงาน: API/DB/เว็บ/container/scheduled task (READ-ONLY) |
| `preflight.mjs` | ด่านในเครื่องก่อน push: copy · secrets · arch-gate · frontend-gate · host-smoke · promote-web |

## Deployment จริง (สิ่งที่ต้องรู้ก่อนแตะ prod)

- Backend: **`node tools/deploy-db.mjs --yes`** (ด่าน backup → `npm run build` → `prisma migrate deploy` → `docker restart sovereign-core-api` → poll `/healthz`) — container rebuild `dist` จาก source ที่ mount เอง (generate + tsc) แล้ว start · ด่าน backup คือ `tools/deploy-guard.mjs`: ไม่มี dump / dump เก่ากว่า migration ล่าสุด / เก่าเกิน 24 ชม. = **exit 1 ก่อนแตะ DB หรือ container** · `--dry-run` ดูแผนได้โดยไม่แตะระบบ
- Frontend: `npm run build` ที่ `sovereign-frontend/` แล้ว restart `next start` (:3000)
- Migration: **ห้าม**รัน raw SQL ข้าม `_prisma_migrations` — ถ้าจำเป็นต้องทำมือ ให้ `prisma migrate resolve` ทันทีเพื่อให้ ledger ตรงความจริง (เคสจริง 23-09: ledger หลุด 3 รายการ + energy ไม่เคยลง prod)
- พอร์ต: :3000 frontend prod (bind 0.0.0.0 — **เครื่องใน LAN เข้าถึงได้ทางนี้เท่านั้น**) · :3001 backend (ผูก 127.0.0.1:3001 เท่านั้น เครื่องอื่นใน LAN ต่อตรงไม่ได้ ต้องผ่าน rewrite `/api/*` ของ :3000) · 5432 postgres (Docker)

## ข้อห้ามเดิมจาก AGENTS.md (ยังมีผล)

- ห้ามแก้ `_app.tsx`, `_document.tsx`, `globals.css`, `navigation.ts`, stores, `package.json` โดยไม่ถามเจ้าของ
- ห้าม commit ก่อน verify ผ่าน · ห้าม force push · ทำงานบน branch `ai/<feature>`
- ไฟล์ใหญ่ (property.tsx, dashboard.tsx, settings.tsx, business.service.ts) แก้ทีละจุดระวัง nesting
