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
4. **ตารางมีเจ้าของ** — แผนที่ตาราง→โมดูล อยู่ที่ `tools/module-owners.json`, การยื่นมือแตะตารางคนอื่นถูกรายงานทุก verify (ตอนนี้ report-only, เฟสถัดไป fail)
5. **prod ต้องรันโค้ดชุดเดียวกับดิสก์** — `/api/health` รายงาน `build.fingerprint` (hash เนื้อหาไฟล์ dist ที่โปรเซสโหลด) → เทียบกับดิสก์โดย **prod-truth gate** เมื่อรัน `verify:full`

## ด่านคุณภาพ (npm run verify ที่ root)

```
verify        = Architecture Gate → backend build+test ∥ frontend typecheck+build
verify --db   = เพิ่มชุด real-Postgres (test:db) + coverage report
verify:full   = เพิ่ม Prod-Truth Gate (fingerprint disk↔runtime) + E2E Playwright
```

- เกตทั้งหมดอยู่ที่ `tools/` (arch-gate.mjs, prod-truth.mjs, fingerprint-lib.mjs, module-owners.json)
- fingerprint = hash ของ `{relativePath, size, sha256(content)}` เรียงตาม path — คำนวณฝั่ง runtime (`src/lib/runtime-fingerprint.ts`) และฝั่ง tools ให้ผลตรงกันทุกไบต์

## โมดูลหลัก 8 โมดูล (เอกสารรายโมดูลอยู่ที่ docs/modules/)

| โมดูล | หน้าที่ | เอกสาร |
|---|---|---|
| auth | ล็อกอิน/MFA/rate-limit/audit | [docs/modules/auth.md](modules/auth.md) |
| business | ร้านค้า/ออเดอร์/LEDGER/PO/ชุมชน | [docs/modules/business.md](modules/business.md) |
| trace | ตามรอยผลผลิต (ล็อต+เหตุการณ์+QR) | [docs/modules/trace.md](modules/trace.md) |
| farm | แปลง/ดิน/เก็บเกี่ยว/ที่ปรึกษา | [docs/modules/farm.md](modules/farm.md) |
| inventory | สต็อกสินค้า | [docs/modules/inventory.md](modules/inventory.md) |
| energy | พลังงาน/มิเตอร์/เกณฑ์เตือน | [docs/modules/energy.md](modules/energy.md) |
| restaurant | ร้านอาหาร/เมนู/ออเดอร์/หน้า | [docs/modules/restaurant.md](modules/restaurant.md) |
| treasury | การเงิน/พอร์ต/runway/โอน | [docs/modules/treasury.md](modules/treasury.md) |

## โครงสร้าง backend

```
sovereign-os/core-api/src/
  routes.ts          # ประกาศ mount ของทุก module router + /api/health (fingerprint อยู่นี่)
  modules/<name>/    # routes — บางโมดูลเรียก service ตรง ๆ
  services/          # business logic — ทุก service ใช้ prisma client ก้อนเดียว (src/lib/prisma)
  lib/               # runtime-fingerprint, prisma ฯลฯ
  middleware/        # authenticate, requireRole, rateLimit
```

## Deployment จริง (สิ่งที่ต้องรู้ก่อนแตะ prod)

- Backend: `docker restart sovereign-core-api` → container rebuild `dist` จาก source ที่ mount เอง (generate + tsc) แล้ว start
- Frontend: `npm run build` ที่ `sovereign-frontend/` แล้ว restart `next start` (:3000)
- Migration: **ห้าม**รัน raw SQL ข้าม `_prisma_migrations` — ถ้าจำเป็นต้องทำมือ ให้ `prisma migrate resolve` ทันทีเพื่อให้ ledger ตรงความจริง (เคสจริง 23-09: ledger หลุด 3 รายการ + energy ไม่เคยลง prod)
- พอร์ต: :3000 frontend prod · :3001 backend · 5432 postgres (Docker)

## ข้อห้ามเดิมจาก AGENTS.md (ยังมีผล)

- ห้ามแก้ `_app.tsx`, `_document.tsx`, `globals.css`, `navigation.ts`, stores, `package.json` โดยไม่ถามเจ้าของ
- ห้าม commit ก่อน verify ผ่าน · ห้าม force push · ทำงานบน branch `ai/<feature>`
- ไฟล์ใหญ่ (property.tsx, dashboard.tsx, settings.tsx, business.service.ts) แก้ทีละจุดระวัง nesting
