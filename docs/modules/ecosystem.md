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
