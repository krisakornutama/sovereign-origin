# AGENTS.md — กฎเหล็กสำหรับ AI ทุกตัวที่เข้ามาแก้โค้ดในโปรเจ็ก Sovereign Origin

---

## กฎสากล (ทุก AI ต้องทำตาม)

### 1. GIT SAFETY — ห้ามแก้โค้ดโดยไม่มี backup
- **ก่อนแก้ทุกครั้ง** ต้อง `git add -A && git commit -m "backup: <คำอธิบายสั้นๆ>"` ก่อนเสมอ
- ถ้าแก้แล้วพัง → `git diff` ดูว่าแก้อะไรไป แล้ว `git checkout -- <ไฟล์>` คืนเฉพาะส่วนที่พัง
- **ห้าม force push** 除非ได้รับอนุญาตจากผู้ใช้

### 2. BUILD BEFORE COMMIT — ต้องผ่าน quality gate ก่อน commit
- หลังแก้โค้ดทุกครั้ง รัน `npm run verify` ที่ **root ของ repo** (สคริปต์เดียวครบ: **Architecture Gate** (ด่านแรก ตรวจ schema-sync/file-budget/env-truth/module-boundary) + **Frontend Gate** (import-layers · เพดานบรรทัด pages≤800/components≤400 · ทุกหน้าต้องมี Sidebar), backend build+test, frontend typecheck+build)
- ถ้า verify ไม่ผ่าน **ห้าม commit** ต้องแก้ให้ผ่านก่อน
- แก้อะไรที่กระทบหน้าเว็บ/UI ให้รัน `npm run verify:full` (เพิ่ม E2E Playwright — ต้องมี backend+DB รันอยู่)
- ถ้า error จำนวนมาก ให้ย้อนกลับไป backup แล้วแก้ทีละจุด

### 3. BRANCH WORKFLOW — ทำงานบน branch แยก
- สร้าง branch ใหม่สำหรับแต่ละ feature: `git checkout -b ai/<feature-name>`
- ทำงานบน branch นั้น ทดสอบจนแน่ใจ แล้วค่อย merge กลับ main
- ห้าม commit ตรง main โดยไม่ทดสอบ

### 4. ห้ามแตะไฟล์ critical โดยไม่จำเป็น
ไฟล์ต่อไปนี้ **ห้ามแก้** เว้นแต่ผู้ใช้สั่งโดยตรง:
- `src/pages/_app.tsx` — layout หลักของแอป
- `src/pages/_document.tsx` — HTML structure
- `src/styles/globals.css` — design system ทั้งหมด
- `src/lib/navigation.ts` — เมนูนำทาง
- `src/stores/useLanguageStore.ts` — i18n store
- `src/stores/useAuthStore.ts` — auth store
- `package.json` — ต้องถามผู้ใช้ก่อนเพิ่ม dependency ใหม่

### 5. ห้ามลบ/เปลี่ยนฟังก์ชันที่มีอยู่
- ห้ามลบฟังก์ชัน หรือเปลี่ยน signature ของฟังก์ชันที่มีอยู่แล้ว
- ห้ามเปลี่ยน interface/type ที่ใช้ร่วมกันหลายไฟล์ โดยไม่บอกผู้ใช้
- ถ้าต้องการเปลี่ยน ให้สร้างฟังก์ชันใหม่แทน แล้วให้ผู้ใช้ตัดสินใจลบของเก่า

### 6. MINIMAL CHANGE — แก้เท่าที่จำเป็น
- ห้าม refactor โค้ดที่ไม่เกี่ยวข้องกับงานที่ได้รับมอบหมาย
- ห้ามเปลี่ยน code style (indentation, quoting, formatting) ของไฟล์ทั้งหมด
- แก้เฉพาะจุดที่ต้องแก้เท่านั้น

### 7. PROJECT DRIVE ONLY — ห้ามเอาโปรเจ็กลง drive C: เด็ดขาด (คำสั่งจากเจ้าของ)
- โปรเจ็กทั้งหมดต้องอยู่บน **drive ของโปรเจ็ก (E:)** เช่น `E:\My work\Project Sovereign Origin` — **ห้าม** copy/clone/download/extract โปรเจ็กหรือไฟล์ของโปรเจ็กไปไว้ที่ **drive C:** เพราะ C: มีพื้นที่น้อย
- ครอบคลุมทุกอย่างที่ AI สร้าง/ดาวน์โหลด: worktrees, node_modules, build output, backups, dumps, logs, ไฟล์ชั่วคราวขนาดใหญ่ — ให้อยู่บน E: เสมอ
- ห้ามใช้ `C:\Users\...\Temp` หรือ `/tmp` ที่ map ไป C: เป็นที่เก็บไฟล์ถาวรของโปรเจ็ก (ไฟล์ชั่วคราวเล็กที่ตายใน session เดียวยังโอเค แต่ของสำคัญ/งานที่ต้องเก็บไว้ต้องเป็น E:)
- เวลาตั้ง scheduled task / script backup / ติดตั้งอะไรเพิ่ม ให้ target เป็น path บน E: เท่านั้น
- ถ้าเครื่องมือบังคับให้เขียน C: และเลี่ยงไม่ได้ ต้องแจ้งผู้ใช้ก่อน แล้วหาทางทำบน E: แทนเสมอ

### 8. งานพิสูจน์พฤติกรรมต้องจบด้วยเทสต์ที่ commit ไว้
- ห้ามส่งมอบงานโดยอ้างแค่ "รันสคริปต์ชั่วคราวแล้วผ่าน" — ต้องมีเทสต์ใน `tests/` ที่จับของแย่นั้นไว้ ไม่งั้นรอบหน้าจะพังซ้ำโดยไม่มีใครเห็น
- เขียนเทสต์แบบ red-first: ต้องเห็นแดงก่อนแก้ และรายงาน exit code แดง/เขียว

---

## โครงสร้างโปรเจ็ก

### Frontend (`sovereign-frontend/`)
- **Framework**: Next.js 16.3 (Pages Router + Turbopack)
- **CSS**: TailwindCSS 3.4 + custom globals.css
- **State**: Zustand (stores in `src/stores/`)
- **i18n**: `useLanguageStore` — th/en, ใช้ `t('key', 'fallback')` เสมอ
- **หน้าทั้งหมด**: อยู่ใน `src/pages/` — ทุกหน้าต้อง import `<Sidebar />`
- **Layout pattern**: `<div><Sidebar /><main>...</main></div>` เหมือนกันทุกหน้า

### Backend (`sovereign-os/core-api/`)
- **Runtime**: Node.js + Express **4** (ไม่ใช่ 5 — async handler ที่ throw จะค้างไม่ตอบ ดูหัวข้อเคล็ดลับ)
- **Database**: Prisma + **PostgreSQL/TimeScaleDB** (ไม่ใช่ SQLite — `prisma/schema.sqlite.prisma` เป็นของเก่าที่ละไว้) · container `sovereign-db` port 5432 · DATABASE_URL ใน `.env`
- **Port**: 3001
- **Routes**: `src/modules/*/`
- **Services**: `src/services/`
- **Deploy = `docker restart sovereign-core-api`**: container mount `src` จาก MAIN แล้วรัน `prisma generate && npm run build && npm start` ทุกครั้งที่บูต (**ไม่ต้อง rebuild image**) — route ใหม่ตอบ **404** ให้ restart ก่อนไปสงสัยโค้ด · ถ้า tsc ในคอนเทนเนอร์ล้ม `npm start` จะไม่รัน = API ล่มทั้งตัว จึงรัน `npm run build` ที่ MAIN ให้ผ่านก่อนเสมอ

---

## เคล็ดลับที่ไม่มีในโค้ด (เจอแล้วเสียเวลา/เสียเงิน)

- **ทดสอบกับ DB จริงโดยไม่แตะข้อมูล dev**: ต่อ DATABASE_URL ด้วย `?schema=<ชื่อชั่วคราว>` แล้ว `npx prisma db push --skip-generate --accept-data-loss` → รันสคริปต์ → `DROP SCHEMA ... CASCADE` ทิ้ง (`public` ไม่โดนแตะ) · mock prisma จับ type mismatch ของ schema ไม่ได้เลย
- **`@db.Uuid` ไม่มีทางจับด้วย tsc**: Prisma generate type คอลัมน์ UUID เป็น `string | null` เหมือนกัน การเขียนค่าผิดรูปแบบ (เช่น `'stripe-webhook'`) ผ่าน compile แต่รันจริงโยน **P2023**
- **Express 4 ไม่ส่ง error ออกจาก async handler**: handler ที่ `throw` หรือ await ที่ reject จะ **ค้างไม่ตอบ** (ไม่ใช่ 500) คนเรียกจะรอจน timeout — webhook Stripe จะ retry ไม่จบ ต้อง `try/catch` ใน handler เอง
- **`NEXT_PUBLIC_*` ถูกฝังตอน build**: เปลี่ยน env ตอน `next start` ไม่มีผล ถ้าจะทดสอบ UI จริงต้อง rebuild — ซึ่งจะไปทับ `.next` ที่ `:3000` กำลัง serve (ทุก chunk 404) ห้ามทำโดยไม่ได้รับอนุญาต
- **Playwright `storageState` ผูกกับ origin**: รันบนพอร์ตอื่นจาก `baseURL` = localStorage ว่าง = login หลุด ให้ replay token ชุดเดิมผ่าน `addInitScript` และ throw ถ้าหมดอายุ/ยังไม่ MFA
- **กับดัก Playwright 2 ข้อ**: `getByRole('alert')` ชนกับ `__next-route-announcer` ของ Next (scope selector ให้แคบ) · handler ของ `page.route` ต้องเป็น `async` + `await r.fulfill()` ไม่งั้น fulfill จะจบทันที
- **`node tools/gen-module-docs.mjs` ไม่มี `--dry-run`** — รันแล้วเขียนทั้ง 67 ไฟล์ทันที อย่าเรียกมั่ว
- **รัน `npm run verify` ที่ MAIN เท่านั้น**: worktree ไม่มี `node_modules` ของ root/core-api (มีแค่ frontend) และ `tools/verify.mjs` คอมไพล์จากโฟลเดอร์ที่ตัวเองอยู่ ⇒ รันใน worktree ล้มทันที · ตัวสคริปต์ตรวจจับเองว่า `:3000` มี prod เสิร์ฟอยู่และ **ไม่แตะพอร์ต/.next** · `.freebuff/` ใน worktree ใหม่ยังไม่มี — `mkdir -p` ก่อนเขียน log
- **เส้นสาธารณะเป็นทางเดียว: domain → cloudflared → `:3000` → rewrite `/api/*` → `:3001`** (backend bind `127.0.0.1` จึงไม่มีทางอื่น) · WAF ของโซนเป็น **default-deny** ⇒ path สาธารณะใหม่ต้องถูกเติมใน allowlist ไม่งั้นได้ **403 ที่ edge ก่อนถึงแอป** · `trailingSlash: true` ทำให้ `POST /api/x` → **308** `/api/x/` — ผู้เรียกที่ไม่ตาม redirect (เช่น Stripe) ต้องใช้ URL ที่มี `/` ปิดท้าย
- **webhook ตอน secret ว่างตอบ 401 ไม่ใช่ 400**: `STRIPE_WEBHOOK_SECRET` ไม่ตั้ง/เป็นช่องว่างล้วน → 401 + `rejected:true` (400 สงวนไว้ให้ body ที่ไม่ใช่ JSON หลังลายเซ็นผ่าน) — **อย่าแก้เป็น 400** เพราะ non-2xx คือเจตนาให้ Stripe retry (เทสต์คุมที่ `tests/paymentsFreshClone.test.ts`)
- **ตรวจ DNS ด้วย DoH 2 เจ้าก่อนเชื่อคำว่า "เว็บล่ม/เว็บปกติ"**: `https://dns.google/resolve?name=<host>&type=A` และ `https://cloudflare-dns.com/dns-query` (header `accept: application/dns-json`) — ได้ authority SOA โดยไม่มี Answer = ไม่มี record จริง · SOA serial บอกโซนถูกแก้ล่าสุดเมื่อไร · คู่ NS บอกว่าโดเมนยังอยู่กับ Cloudflare ไหม (tunnel ใช้ได้เฉพาะเมื่อ NS เป็นของ Cloudflare)
- **สแกนความลับก่อน push โดยไม่ทำค่าหลุดลง transcript**: นับเฉพาะรูปแบบยาวผ่าน `git log -p <range> | grep -cE 'sk_live_[A-Za-z0-9]{20,}'` (พิมพ์แค่ตัวเลข ไม่พิมพ์บรรทัดที่ match) · `grep -c` ที่ไม่เจอคืน exit 1 = ผลสะอาด ไม่ใช่ error

---

## Context Pack (อ่านก่อนแตะโค้ด)

- สถาปัตยกรรมรวม + กฎที่เกตตรวจอัตโนมัติ: **docs/ARCHITECTURE.md**
- เอกสารรายโมดูล (auth, business, trace, farm, inventory, energy, restaurant, treasury): **docs/modules/<โมดูล>.md**
- กติกา: ก่อนแก้โมดูลไหน ให้อ่านเอกสารโมดูลนั้นก่อนเสมอ — เจตนา/ตารางที่เป็นเจ้าของ/ข้อห้ามอยู่ที่นั่น
- แผนที่ตาราง→โมดูล: tools/module-owners.json (ครอบทุกตารางยกเว้น orphan จริง · เติมใหม่ด้วย `node tools/map-owners.mjs --apply`)
- **เส้นข้ามโมดูล (แตะตารางคนอื่น) = fail ถ้าไม่ประกาศ** — เส้นที่ยอมรับแล้วอยู่ที่ tools/boundary-baseline.json · เส้นใหม่ที่ arch-gate จับ = แก้ผ่าน service ของเจ้าของตาราง หรือเพิ่ม baseline พร้อมเหตุผล (รีวิวใน PR)
- เอกสารโมดูลครบทุกโมดูลที่ docs/modules/ — ส่วน "ของจริงในโค้ด" gen ด้วย `node tools/gen-module-docs.mjs` (ห้ามแก้มือใน marker auto)

## โฟลว์ทำงานที่ถูกต้อง

```
1. git add -A && git commit -m "backup: before <task>"
2. git checkout -b ai/<task-name>
3. แก้โค้ด
4. npm run verify (ที่ root — ครอบ build+test ทั้งสองฝั่ง)
5. ถ้า build ไม่ผ่าน → แก้ หรือ git checkout -- ไฟล์ที่พัง
6. ถ้า build ผ่าน → git add -A && git commit -m "<task description>"
7. git checkout main && git merge ai/<task-name>
8. ถ้า merge แล้วพัง → git revert HEAD
```

---

## ตัวอย่างไฟล์ที่ต้องระวัง

| ไฟล์ | เหตุผล |
|---|---|
| `src/pages/property.tsx` | มี JSX nesting ซับซ้อน, แก้ผิดจุดเดียวพังทั้งหน้า |
| `src/pages/_app.tsx` | Layout หลัก, hydration logic, SPA navigation |
| `src/components/layout/Sidebar.tsx` | ทุกหน้าใช้ร่วมกัน |
| `src/stores/*.ts` | State management ทั้งระบบ |
| `package.json` | Dependency อาจ conflict กัน |

---

## แผนสำรองเมื่อ AI ทำพัง

```bash
# ดูว่าแก้อะไรไป
git diff

# คืนไฟล์เดียว
git checkout -- src/pages/property.tsx

# คืนทุกอย่าง
git checkout -- .

# ย้อน commit ล่าสุด (เก็บ history ไว้)
git revert HEAD

# ย้อนหลาย commit
git reset --soft HEAD~3
```
