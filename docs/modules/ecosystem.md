# โมดูล ecosystem

## เจตนา

ที่เก็บ "บัญชีทุก platform ของเจ้าของ" ไว้ที่เดียว (Fiverr · Fastwork · YouTube · Gmail ·
Facebook · LinkedIn · GitHub · Stripe · เว็บไซต์ ฯลฯ) พร้อมปุ่มเปิดเว็บตรงและที่เก็บรหัสผ่าน
ที่เข้ารหัสจริง — แก้ปัญหา "platform เยอะจนพลาดคอมเมนต์/ข้อความลูกค้า"

## ข้อห้าม / ระวัง

- **ห้ามคืนรหัสผ่านใน list/สรุป** — ทางเดียวคือ `POST /api/ecosystem/accounts/:id/reveal`
  (และทุกครั้งต้องเขียน audit log)
- ห้ามเก็บ `password` เป็น plaintext หรือถอดรหัสแล้ว cache ไว้ในหน่วยความจำระยะยาว
- ทุก query ต้องผูก `user_id` จาก token — ห้ามรับ `userId` จาก body/query
- URL ที่จะเปิดต้องเป็น `http`/`https` เท่านั้น (กัน `javascript:` / `file:` / `data:`)
- ใช้ `field-crypto.service` (AES-256-GCM, key อยู่ `data/field-crypto.key`) — ห้ามสร้าง crypto ใหม่ซ้อน

## Gmail เป็นบัญชีหลัก (31/10/69)

เจ้าของมีหลาย platform ที่สมัครด้วยอีเมล Gmail เดียวกัน — จึงให้ Gmail ทำหน้าที่เป็น
"บัญชีหลัก" และให้บัญชีอื่นผูกเข้าไป เพื่อเห็นทั้ง Ecosystem เป็นชุดเดียว

- คอลัมน์ `primary_account_id` (UUID, nullable, FK ชี้ตัวเอง `ON DELETE SET NULL`)
- บัญชีหลักต้องเป็น `platform = 'gmail'` ของผู้ใช้คนเดียวกัน — ผูกข้าม user = 404
- ผูกได้ชั้นเดียว: Gmail ที่ถูกผูกเป็นลูกแล้วเป็นหลักให้ใครไม่ได้ และบัญชีที่มีลูกอยู่จะถูกนำไปผูกเป็นลูกไม่ได้ (`HAS_LINKED_ACCOUNTS`)
- ห้ามผูกกับตัวเอง (`SELF_LINK`)
- **จับคู่อัตโนมัติ:** ตอนสร้าง/แก้ ถ้า `loginId` ตรงกับ Gmail ที่ยังว่าง (trim + lowercase) จะผูกให้ทันที — แก้ฟิลด์อื่นไม่ทำให้ผูกกลับเองหลังถอด
- `POST /api/ecosystem/accounts/auto-link` ผูกบัญชีเดิมที่ยังไม่ผูกทั้งหมด (คืน `{linked, checked}`)
- ลบ Gmail หลัก: บัญชีลูกยังอยู่ แต่ `primary_account_id` ถูกตั้งเป็น NULL (ไม่ลบตาม)
- list คืน `primaryAccountId` และ `linkedCount` — ยังไม่คืนรหัสผ่านเหมือนเดิม

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`user_ecosystem_accounts`

### Routes
- `ecosystem/ecosystem.routes.ts`

### Endpoints (จาก router)
```
GET /catalog
GET /accounts
POST /accounts
PATCH /accounts/:id
DELETE /accounts/:id
POST /accounts/:id/reveal
POST /accounts/:id/open
```

### Services ที่ทำงานให้โมดูลนี้
`ecosystem.service`

<!-- auto:end -->
