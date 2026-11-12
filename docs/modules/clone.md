# โมดูล clone

## เจตนา

ถอดแบบ (clone) ระบบไปเครื่องอื่น: ติ๊กเลือกโมดูลในหน้า `/settings` → ดาวน์โหลดแพ็กเกจ JSON ของข้อมูลโมดูลนั้น → อัปโหลดเพื่อคืนค่าที่เครื่องใหม่/เครื่องที่สอง

## ข้อห้าม / ระวัง

- **`POST /clone/export` และ `POST /clone/import` = SUPERADMIN เท่านั้น** — export อ่านทุกตารางของโมดูลที่เลือก (ข้อมูลเด็ก/สุขภาพ/การเงิน) และ import รัน `TRUNCATE TABLE ... CASCADE` จริง ⇒ บัญชี OPERATOR/NODE_ADMIN/SYSTEM_AI/KID ต้องได้ **403** ก่อนแตะ DB (เทสต์: `tests/cloneAuthorization.test.ts`)
- **ตารางที่นำเข้าได้ต้องอยู่ใน `MODULE_MANIFEST` เท่านั้น** — `validatePackage` ปฏิเสธตารางนอก manifest (เช่น `users`, `audit_logs`) ด้วย 400 ก่อน query `information_schema` เพราะ `applyPackage` จะ TRUNCATE ทุกชื่อที่ส่งมา
- **ห้ามให้ `validatePackage` ผ่านแพ็กเกจที่ `rows` ไม่ใช่ array** — TRUNCATE ก่อน INSERT ที่พัง = ข้อมูลเดิมหายเปล่า ๆ
- `GET /clone/manifest` เปิดให้ทุก role ที่ล็อกอินแล้ว (เป็นแค่รายชื่อโมดูล ไม่มีข้อมูลแถว) — อย่าใส่ข้อมูลจริงลงไป
- `POST /clone/export` ต้อง **400 พร้อม `unknownModules` + `availableModules`** เมื่อมีคีย์ที่ระบบไม่รู้จัก — เดิมตัดเงียบแล้วคืนแพ็กเกจ `modules: []` ซึ่งผู้ใช้อ่านว่า "สำรองข้อมูลแล้ว"
- body ของ `/clone/import` ได้เพดาน 25 MB (ดู `src/lib/http-body.ts`) และต้องอยู่หลัง `authenticate` เสมอ
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `clone/clone.routes.ts` (46 บรรทัด)

### Endpoints (จาก router)
```
GET /manifest
POST /export
POST /import
```

<!-- auto:end -->

