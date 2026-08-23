# คิวงาน (QUEUE)

เพิ่มงานด้านล่างได้โดยตรง (บรรทัดละ 1 งาน เริ่มด้วย `- [ ] `) หรือใช้คำสั่ง `/queue <งาน>`
เมื่องานเสร็จ agent จะเปลี่ยนเป็น `- [x]` พร้อมหมายเหตุผลลัพธ์

- [x] ปรับ frontend ให้สวยขึ้น (ผู้ใช้ขอ) — **เสร็จแล้ว 23/8/69** (`master d235a67`)
  - ทำแล้วทั้ง 4 ลำดับที่วางไว้: (1) login redesign `da29420` (2) dashboard dense command center `3621d45` — DEFCON bar + กราฟ 1930-2040 + Threat Category + Sankey Alluvial + 8 Gauges + Radar ตามภาพอ้างอิง (3) restaurant POS premium `ce9fdf7` (4) สี/คอนทราสต์ตาม design tokens เดิม `69285b5` `7280b18`
  - เพิ่มเติมเกินแผน: Agri-Hub 3D iso + Breedhouse (ภาพ 3) `8d0f9e8`, Infrastructure Map + System Health `8d0f9e8`, Treasury Sankey 5 Families (ภาพ 1) `0ccbf83`, History Timeline + Lifestyle 5 Principles (ภาพ 4) `b177401`, unify ทุกหน้า 31 ไฟล์ `7280b18`
  - ไม่แตะ `globals.css` โครงหลัก/`_app.tsx`/`navigation.ts` (แก้เฉพาะ component classes ใน globals.css ที่อนุญาตแล้ว)
  - ผ่าน `npm run verify` 4/4 (backend 994 tests + typecheck + build) และ E2E 44/44 ทุกรอบ
- [x] เพิ่ม E2E นำทางแบบ SPA (คลิก sidebar จริง ไม่ใช่ page.goto) — **เสร็จแล้ว 23/8/69**
  - สาเหตุที่ตัวเดิมติด: locator แบบ text (`aside a`, hasText) ไม่เสถียรกับ label ไทย + aside ซ้อน
  - วิธีแก้: ใช้ locator แบบ `aside a[href="..."]` (deterministic) + พิสูจน์ไม่ reload ด้วย window marker (`__spaMarker` รอดเมื่อ SPA, หายเมื่อ full reload)
  - ไฟล์: `sovereign-frontend/e2e/spa-nav.spec.ts` — 7 tests (5 หน้าตัวแทน + คลิกต่อกัน 3 หน้า + NAV_GROUPS href ครบ)
  - config `playwright.config.ts:23` มี testMatch รองรับอยู่แล้ว

หมายเหตุสถานะระบบ (23 ส.ค. 69): backend 994/994 tests + E2E 44/44 (รวม spa-nav 7) + `npm run verify` 4/4 ขั้น ผ่านครบ
งานเสร็จทั้งหมดอยู่ใน master แล้ว — ทุกงานใหม่เริ่มจาก master + backup commit
