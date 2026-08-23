# คิวงาน (QUEUE)

เพิ่มงานด้านล่างได้โดยตรง (บรรทัดละ 1 งาน เริ่มด้วย `- [ ] `) หรือใช้คำสั่ง `/queue <งาน>`
เมื่องานเสร็จ agent จะเปลี่ยนเป็น `- [x]` พร้อมหมายเหตุผลลัพธ์

- [ ] ปรับ frontend ให้สวยขึ้น (ผู้ใช้ขอ) — แนวทางที่เตรียมไว้แล้ว:
  - ห้ามแตะ `globals.css` / `_app.tsx` / `navigation.ts` โดยไม่ขออนุญาต (กฎ AGENTS.md ข้อ 4)
  - ทำเป็นรอบเล็กๆ ต่อหน้า รัน `npm run verify` ที่ root ทุกรอบ (E2E 11 เคสคุม regression ให้อยู่แล้ว)
  - ลำดับที่คุ้มสุด: (1) หน้า login จุดแรกที่คนเห็น (2) dashboard cards/spacing/typography ให้พังนานาชาติขึ้น (3) หน้า restaurant POS (ใช้งานจริงหน้าร้าน) (4) สี/คอนทราสต์ตาม design tokens เดิม อย่าประดิษฐ์ธีมใหม่ทั้งระบบ
  - มี skill ช่วย: `frontend-design` (ทิศทางสไตล์) และ `web-design-guidelines` (ตรวจ UI หลังแก้)
  - ใช้ browser จริงเทียบภาพก่อน-หลัง (IAB หรือ `npm run e2e` + screenshot)

หมายเหตุสถานะระบบ (22-23 ส.ค. 65): backend 994/994 tests + E2E 11/11 + `npm run verify` (5 ขั้น) ผ่านครบ
งานเสร็จทั้งหมดอยู่ใน master แล้ว (branches ai/* รวมได้หมด) — ทุกงานใหม่เริ่มจาก master + backup commit
- [ ] เพิ่ม E2E นำทางแบบ SPA (คลิก sidebar จริง ไม่ใช่ page.goto) — ตัวทดสอบเดิมติดเรื่อง locator: ลิงก์ปรากฏใน a11y snapshot แต่ locator('aside a', hasText) หาไม่เจอ สงสัยมี aside ซ้อน/โครงสร้าง wrapper — ไล่จาก error-context ใน test-results ได้
