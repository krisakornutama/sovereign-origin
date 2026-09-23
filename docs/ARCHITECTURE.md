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

## กฎเหล็ก 5 ข้อ (มีกลไกตรวจ ไม่ใช่ธรรมเนียม)

1. **DB จริงฉบับเดียว** — `DATABASE_URL` ใน `sovereign-os/core-api/.env` ต้องชี้ DB ที่ connect ได้จริง → ตรวจโดย **arch-gate (env-truth)**
2. **Schema สองไฟล์แก้คู่กัน** — `schema.prisma` (postgres) + `schema.sqlite.prisma` ต้องมี model ชุดเดียวกัน → ตรวจโดย **arch-gate (schema-sync)**
3. **ไฟล์ไม่โตเกิน 800 บรรทัด** — ไฟล์ใหม่/ที่แก้ใน branch ห้ามโตเกินเพดาน (ไฟล์เก่าไม่ย้อนหลัง) → ตรวจโดย **arch-gate (file-budget)**
4. **ตารางมีเจ้าของ + เส้นข้ามต้องประกาศ** — แผนที่ตาราง→โมดูล อยู่ที่ `tools/module-owners.json` (ครอบครบทุกตาราง · shared: system_settings/security_events) · การแตะตารางคนอื่นต้องมีอยู่ใน `tools/boundary-baseline.json` แล้วเท่านั้น — **เส้นข้ามใหม่ = verify fail** (เพิ่ม baseline พร้อมเหตุผลเมื่อจำเป็นจริง · เติมเจ้าของตารางใหม่ด้วย `node tools/map-owners.mjs --apply`)
   - ⚠️ blind spot ที่รู้ตัว: เกตจับเฉพาะ `prisma.<delegate>` — การเขียนผ่าน **raw SQL** (`INSERT INTO sensor_telemetry` จาก mqttIngest/wan-monitor/ups-monitor ฯลฯ) มองไม่เห็น ถ้าจะเพิ่มการเขียนตารางโมดูลอื่นด้วย raw SQL ให้ระบุใน PR และ baseline เอง
5. **prod ต้องรันโค้ดชุดเดียวกับดิสก์** — `/api/health` รายงาน `build.fingerprint` (hash เนื้อหาไฟล์ dist ที่โปรเซสโหลด) → เทียบกับดิสก์โดย **prod-truth gate** เมื่อรัน `verify:full` · parity ของอัลกอริทึมสองฝั่งถูกตรวจบน CI (`tools/check-parity.mjs`) · เห็นผลได้ทันทีที่หน้า **/system-health**

## ด่านคุณภาพ (npm run verify ที่ root)

```
verify        = Architecture Gate → backend build+test ∥ frontend typecheck+build
verify --db   = เพิ่มชุด real-Postgres (test:db) + coverage report
verify:full   = เพิ่ม Prod-Truth Gate (fingerprint disk↔runtime) + E2E Playwright
```

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

## เครื่องมือใน tools/ (แหล่งความจริง)

| เครื่องมือ | หน้าที่ |
|---|---|
| `arch-gate.mjs` | ด่านแรกของ verify: schema-sync · file-budget · env-truth · boundary (baseline แบบ fail) |
| `module-owners.json` | ตาราง→เจ้าของ + serviceAliases (แหล่งเดียว ทั้ง gate และ map-owners ใช้ร่วม) |
| `map-owners.mjs` | เติมเจ้าของตาราง unmapped จากการใช้จริง (`--apply` เขียน) |
| `boundary-baseline.json` | เส้นข้ามโมดูลที่ยอมรับแล้ว — นอกไฟล์นี้ = fail |
| `prod-truth.mjs` + `fingerprint-lib.mjs` | เทียบ fingerprint ดิสก์ ↔ runtime (verify:full) |
| `check-parity.mjs` | พิสูจน์อัลกอริทึม fingerprint สองฝั่งตรงกัน (CI รันทุก PR) |
| `verify.mjs` | Quality gate เดียว — เขียนผลล่าสุดลง `data/system-truth.json` |
| `gen-module-docs.mjs` | gen เอกสารโมดูลจากโค้ดจริง (ไม่ทับส่วนเขียนมือ) |

## Deployment จริง (สิ่งที่ต้องรู้ก่อนแตะ prod)

- Backend: `docker restart sovereign-core-api` → container rebuild `dist` จาก source ที่ mount เอง (generate + tsc) แล้ว start
- Frontend: `npm run build` ที่ `sovereign-frontend/` แล้ว restart `next start` (:3000)
- Migration: **ห้าม**รัน raw SQL ข้าม `_prisma_migrations` — ถ้าจำเป็นต้องทำมือ ให้ `prisma migrate resolve` ทันทีเพื่อให้ ledger ตรงความจริง (เคสจริง 23-09: ledger หลุด 3 รายการ + energy ไม่เคยลง prod)
- พอร์ต: :3000 frontend prod · :3001 backend · 5432 postgres (Docker)

## ข้อห้ามเดิมจาก AGENTS.md (ยังมีผล)

- ห้ามแก้ `_app.tsx`, `_document.tsx`, `globals.css`, `navigation.ts`, stores, `package.json` โดยไม่ถามเจ้าของ
- ห้าม commit ก่อน verify ผ่าน · ห้าม force push · ทำงานบน branch `ai/<feature>`
- ไฟล์ใหญ่ (property.tsx, dashboard.tsx, settings.tsx, business.service.ts) แก้ทีละจุดระวัง nesting
