# แผนแยก Pro ออกจาก Public Repo (วัดจากของจริง 04/11/69)

> เครื่องมือวัด: `node tools/verify/open-core-boundary.mjs` (มีเทสต์ `tools/test/open-core-boundary.test.mjs` 4/4)
> ใช้ `--check` เพื่อให้ exit 1 เมื่อยังมีจุดเชื่อม — ใส่เป็นด่าน CI หลังแยกเสร็จ

## 1) ขนาดจริงของฝั่ง Pro (นับจาก path)

| area | ไฟล์ | ขอบเขต |
|---|---|---|
| business | 3 | ร้านค้า/ออเดอร์/ใบกำกับ + ecosystem |
| restaurant | 6 | POS/เมนู/สต็อก/ของเสีย |
| treasury | 8 | treasury + dime + portfolio + payments |
| fleet | 2 | Fleet Control Plane |
| **รวม** | **19** | ยังไม่รวมเทสต์/หน้าจอ/i18n ที่ผูกอยู่ |

**จุดเชื่อมที่ต้องแก้ก่อนย้าย = 12 จุด**
- `sovereign-os/core-api/src/routes.ts` 8 จุด (import + `app.use` ของ business/restaurant/treasury/portfolio/dime/payments รวม 2 ไฟล์ใน payments)
- `sovereign-frontend/src/pages/soverien.tsx` 1 จุด → `components/business/soverien/SoverienHub`
- `sovereign-frontend/src/pages/warranty.tsx` 3 จุด → `components/business/soverien/{types,store,WarrantyCheck}`

> ตัวเลข 19/12 น้อยกว่าที่กลัวตอนแรก — เพราะโมดูลส่วนใหญ่ (telemetry, farm, health, alerts, auth, consent) เป็น CE อยู่แล้ว

## 2) ลำดับขั้นที่ปลอดภัย (ทำใน repo นี้ก่อนแยกจริง)

**ขั้น A — ตัดการผูกที่ routes (ไม่ย้ายไฟล์)**
1. สร้าง `src/modules/pro/registry.ts` ที่รวมการ mount Pro ไว้ที่เดียว และอ่าน `ENABLED_MODULES`
2. `routes.ts` เรียก registry ตัวเดียว → จุดเชื่อม 8 จุดเหลือ 1
3. เกณฑ์ผ่าน: ปิดโมดูล Pro ทั้งหมดแล้ว API ยังบูตได้ (health 200) และ `/api/business` ตอบ 404 ไม่ใช่ 500

> ✅ **ทำแล้ว (4 พ.ย. 69):** จุดเชื่อม routes 8 → 1 (`src/modules/pro/registry.ts`) · lazy `require` ต่อโมดูล ⇒ ไฟล์ถูกย้ายออกแล้ว mount เป็น 404 + log ไม่ throw · เทสต์ `tests/proRegistry.test.ts` 4/4 · boot จริงขึ้น `[pro] mounted: business, fleet, portfolio, treasury, dime, payments-slips, payments, restaurant` และ health 200

**ขั้น B — แยกหน้า frontend**
4. ย้าย `components/business/**` ไป `components/pro/**` และเปลี่ยน import 2 หน้า (`soverien`, `warranty`)
5. เกณฑ์ผ่าน: `npm run build` ผ่าน + `/warranty` ยังใช้งานได้ (หน้านี้เป็น CE? ถ้าใช่ ต้องย้าย logic ที่ใช้ร่วมออกมาก่อน)

> ✅ **ทำแล้ว (4 พ.ย. 69):** `components/business/**` → `components/pro/business/**` (35 ไฟล์, `git mv`) · build ผ่าน
> ⚠ **คำตัดสินที่ทำจริงต่างจากแผนเล็กน้อย — และเหตุผล:** หน้า `/warranty` + `/soverien` **ไม่ย้ายไป CE** เพราะทั้งคู่ตรวจ S/N จาก `orders`/`serials` ที่ขายให้ลูกค้า = รับประกันเชิงพาณิชย์ (Pro ตามคำตัดสินของเจ้าของ) การย้ายไป `components/assets/` จะได้หน้าที่ตรวจอะไรไม่ได้ (ไม่มีข้อมูลออเดอร์)
> ❗ **ที่ยังไม่มี:** CE ยังไม่มีหน้าประกันอุปกรณ์ของตัวเอง (BYOH: บอร์ด ESP32/เซนเซอร์ + วันหมดประกัน) — ต้องสร้างใหม่เป็นฟีเจอร์แยก ไม่ใช่การย้ายโค้ด

**ขั้น C — ย้ายโค้ดจริงไป private repo**
6. สร้าง repo `sovereign-pro` (private) — **ต้องให้เจ้าของสร้าง/อนุญาตก่อน** (เครื่องนี้ `gh` ยังไม่ล็อกอิน: 401)
7. `git subtree split` เฉพาะโฟลเดอร์ Pro แล้ว push ไป repo ใหม่ (เก็บประวัติ)
8. ลบโฟลเดอร์ Pro ออกจาก repo นี้ + ลบ route/import ที่เหลือ
9. ย้ายเทสต์/i18n/docs/prisma model ของ Pro ตามไป (ตารางที่ CE ยังอ้าง เช่น `business_id` ต้องคงไว้หรือทำ fallback)

**ขั้น D — ด่านกันถอยหลัง**
10. CI: `node tools/verify/open-core-boundary.mjs --check` ต้องผ่าน
11. CI: build CE จาก checkout ที่ไม่มีโฟลเดอร์ Pro (จำลองด้วย `git archive` ของ CE เท่านั้น)
12. อัปเดต `README` + `docs/OPEN-CORE.md` + `module-owners.json` + boundary baseline พร้อมกัน

## 3) กับดักที่เจอมาแล้วในโปรเจกต์นี้ (บทเรียนจริง)

- **Prisma migration ใช้ไม่ได้บนฐานใหม่** (เจอ 04/11/69 · แก้แล้วด้วย `db push` ใน CE) ⇒ การแยก model ต้องคิดเรื่อง migration history ตั้งแต่ต้น ไม่งั้นคนติดตั้งใหม่พังอีก
- **`ENABLED_MODULES` ที่อ้างชื่อโมดูลที่หายไป** = 500 ตอนบูต ต้องมี fallback ที่ log ชัด ไม่ใช่ throw เงียบ
- **หน้าจอที่ CE ใช้ร่วมกับ Pro** (เช่น warranty) ถ้าย้ายทั้งโฟลเดอร์จะพัง — ต้องแยก "ของกลาง" ออกก่อนย้าย

## 4) สิ่งที่ผมทำต่อได้ทันทีโดยไม่ต้องรอ

- ขั้น A (registry + 404 fallback + เทสต์) — ไม่แตะ production ถ้าทำบน branch และไม่ deploy
- ขั้น B (ย้าย components) — ต้อง build frontend ใหม่ จึงทำบน branch แล้วทดสอบพอร์ตหลบ

## 5) สิ่งที่ต้องรอเจ้าของ

1. สร้าง private repo (หรือให้ผมสร้างผ่าน `gh auth login` ของคุณ)
2. ยืนยันว่า `warranty`/`soverien` เป็น CE หรือ Pro (ผมเดาไม่ได้ — กระทบลูกค้าจริง)
3. ยืนยันชื่อโมดูลที่ขาย: business / restaurant / treasury / fleet ครบหรือมีเพิ่ม (เช่น e-Tax, multi-tenant)

## 6) ผลขั้น C — private repo มีโค้ด Pro ครบแล้ว (04/11/69)

- repo: `krisakornutama/project-sovereign-pro` (private) · branch `main`
- เนื้อหา **65 ไฟล์**: `modules/pro/registry.ts` + routes 8 โมดูล (business / fleet / portfolio / treasury / dime / payments ×2 / restaurant), service ที่ผูกอยู่ 11 ไฟล์, `lib/business.ts`, `components/pro/**` 43 ไฟล์
- โครงพาธคงเดิมทุกไฟล์ → คัดลอกกลับเข้า CE ได้ตรง ไม่ต้องแก้ import
- ตรวจความถูกต้องแล้ว: ทุกไฟล์ใน private repo มี blob ตรงกับ public repo 100% (`git diff --name-only <pro-main> main -- <paths>` ว่าง)
- วิธีใช้อยู่ใน `README.md` ของ repo Pro

## 7) ขั้น C-2 — Clean Hard Cut ทำแล้ว (04/11/69)

ลบโค้ด Pro ออกจาก public repo แล้ว **90 ไฟล์** และปลด CE ที่เคยพึ่ง service ของ Pro:

- `components/pro/**` (43 ไฟล์), routes 8 โมดูล, service ของ Pro 11 + `business-agent-executor` + `portfolio-signal`, `lib/business.ts`
- หน้า `/business` `/ecosystem` `/soverien` `/warranty` `/treasury` `/portfolio` `/fleet` `/restaurant` ออกจาก CE (API เดิมตอบ 404 ผ่าน registry พร้อมบอกชื่อโมดูล)
- ตัดงานเบื้องหลังของ Pro ใน `workers/start.ts` (Dime scheduler, portfolio signals, low-stock/tax alerts, morning digest, wealth worker)
- `advisor.service`: ถอด wealth ออก ค่าพอร์ต/runway เป็น `null` (CE ไม่มีข้อมูลการเงิน)
- Telegram bot: ถอด dependency `business-shop.service` — ปุ่มยืนยันรับเงินตอบว่าเป็นฟีเจอร์ Pro (hook ยัง inject ได้สำหรับ Pro)
- เทสต์ Pro 20 ไฟล์ + `e2e-fixture.ts` ย้ายไป repo Pro แล้ว

**ผลตรวจ (รันจริงบน branch นี้):**

| ด่าน | ผล |
|---|---|
| `tsc --noEmit` core-api | 0 error |
| เทสต์ core-api ทั้งชุด | **867 ผ่าน / 0 ล้ม** (994 เดิม − เทสต์ Pro ที่ย้ายออก) |
| `next build` + `tsc --noEmit` ฝั่งเว็บ | ผ่าน |
| `open-core-boundary --check` | Pro ใน CE 0 ไฟล์ · CE อ้างถึง Pro 0 จุด |

**หมายเหตุที่ต้องรู้:**

- `fleet-policy` / `fleet-persistence` **ยังอยู่ CE** เพราะหน้าเครื่อง (agent machines) ใช้จัด site/group — ไม่ใช่ route ที่ขาย
- Prisma model ของธุรกิจ/การเงินยังอยู่ใน schema (ตารางว่าง ไม่มี route ใช้) เพื่อไม่ให้ migration history ของ CE พัง
- ประวัติ git ของ public ยังมีโค้ด Pro อยู่ — ถ้าต้องลบจริงต้อง `git filter-repo` + force-push (ยังไม่ทำ เพราะทำลายประวัติที่คนอื่น clone ไปแล้ว)
