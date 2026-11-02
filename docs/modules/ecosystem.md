# โมดูล ecosystem

## เจตนา

ที่เก็บ "บัญชีทุก platform ของเจ้าของ" ไว้ที่เดียว (Fiverr · Fastwork · YouTube · Gmail ·
Facebook · LinkedIn · GitHub · Stripe · เว็บไซต์ ฯลฯ) พร้อมปุ่มเปิดเว็บตรงและที่เก็บรหัสผ่าน
ที่เข้ารหัสจริง — แก้ปัญหา "platform เยอะจนพลาดคอมเมนต์/ข้อความลูกค้า"

## ข้อห้าม / ระวัง

- **ห้ามคืนรหัสผ่านใน list/สรุป** — ทางเดียวคือ `POST /api/ecosystem/accounts/:id/reveal`
  (และทุกครั้งต้องเขียน audit log)
- **`reveal` ถูกจำกัด 10 ครั้ง/นาที ต่อผู้ใช้** (`revealLimiter` ใน `ecosystem.routes.ts`)
  ครั้งที่ 11 = `429` + `Retry-After` + audit `ECOSYSTEM_REVEAL_RATE_LIMITED`
  — session ที่หลุดต้องไล่เก็บรหัสทั้งคลังไม่ได้ในไม่กี่วินาที
- **กุญแจ `field-crypto.key` ห้ามหาย**: ถ้าไฟล์หาย ระบบจะสร้างใหม่เงียบ ๆ และข้อมูล
  `enc:v1:` เดิมจะอ่านไม่ได้ตลอดกาล → ตรวจด้วย `node tools/verify/crypto-key-check.mjs`
  และสำรองแบบ explicit ด้วย `--backup` (ไฟล์สำเนาอยู่ `backups/keys/` ซึ่ง gitignore)
  — ต้องย้ายสำเนาไปเก็บนอกเครื่องเอง
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

## Social Studio (02/11/69)

ย้ายงาน "โพสต์คลิป" ออกจากหน้าธุรกิจ (`ธุรกิจของฉัน` ไม่มีแท็บ `📣 โพสต์` แล้ว) เข้ามาอยู่ใน
Ecosystem → แท็บ **สตูดิโอโพสต์** และแยกเป็น 2 งานชัดเจน:

1. **โพสต์ข้อความ → Facebook** (`TextStudio.tsx`) — พิมพ์/แนบลิงก์/คัดลอก/เปิด Facebook
   - Facebook ไม่เปิด API ให้แอปบุคคลทั่วไปโพสต์แทน ⇒ แอปเตรียมข้อความให้พร้อมเท่านั้น
     ห้ามทำให้ผู้ใช้เข้าใจว่าโพสต์ให้แล้ว
   - เพดาน 63,206 ตัวอักษร · ร่างเก็บที่ `sovereign-social-text-v1`
2. **ลงคลิปวิดีโอ → YouTube · Instagram · TikTok · Facebook** (`ClipStudio.tsx`)
   - เตรียมชื่อ/ไฟล์/คำอธิบายครั้งเดียว แล้วกระจายไปทุกแพลตฟอร์ม
   - YouTube อัปโหลดอัตโนมัติผ่าน OAuth ในแอป (`PostYouTube.tsx`) — ค่าเริ่มต้น `private`
   - อีกสามแพลตฟอร์มเปิดหน้าอัปโหลด + คัดลอกข้อความ (เบราว์เซอร์ยัดไฟล์ข้ามเว็บไม่ได้)
   - ร่างเก็บที่ `sovereign-post-draft-v1`
- **บัญชีที่แสดง = อีเมลที่ผูกไว้ใน Ecosystem** (`loginId`) — ไม่ต้องล็อกอินซ้ำในสตูดิโอ
  ถ้ายังไม่มีบัญชี การ์ดจะเปิดฟอร์มเพิ่มบัญชีพร้อมเลือก platform ให้
- ไฟล์ทั้งหมดอยู่ `sovereign-frontend/src/components/ecosystem/studio/` (กลุ่ม `ecosystem`
  เดียวกัน — ผ่าน import-layers ของ frontend gate)
- pure logic ที่เทสต์ Node เรียกตรง: `post-model.ts` · `post-validate.ts` ·
  `post-clipboard.ts` · `bridge.ts` · `studio-model.ts`

### ประวัติการโพสต์ + สถานะต่อแพลตฟอร์ม (02/11/69)

สตูดิโอเดิม "คัดลอกแล้วจบ" — ไม่มีอะไรจำว่าแพลตฟอร์มไหนโพสต์แล้ว ⇒ โพสต์ซ้ำ/ลืมปลายทาง
จึงเพิ่มแท็บที่ 3 **ประวัติการโพสต์** และเก็บประวัติใน DB (ไม่ใช่ localStorage) เพื่อข้ามเครื่อง

- ตาราง `social_posts` (เจ้าของ: ecosystem) — `kind` (`text` | `clip`), `title`, `body`,
  `link`, `video_name`, `video_size` (เก็บเป็น string เพราะไฟล์อาจเกิน 2 GB)
- ตาราง `social_post_targets` — หนึ่งแถวต่อแพลตฟอร์ม: `status` (`pending` | `posted` | `skipped`),
  `external_url`, `external_id`, `posted_at`
  - `ON DELETE CASCADE` จากโพสต์ · `account_id → user_ecosystem_accounts` เป็น `SET NULL`
    (ลบบัญชี = ประวัติยังอยู่ แต่ไม่ผูกบัญชี)
  - unique `(post_id, platform)` — กันปลายทางซ้ำ
- API ใต้ `/api/ecosystem/social` (`social-history.routes.ts` + `social-history.service.ts`):
  - `GET /posts?limit=` (สูงสุด 50) · `POST /posts` · `PATCH /posts/:id/targets/:platform` · `DELETE /posts/:id`
  - ทุก query ผูก `user_id` — ของคนอื่น/id ผิดรูปแบบ = `404` (ไม่ใช่ `500`)
  - `accountId` ต้องเป็นบัญชีของผู้ใช้เองและ platform ตรงกัน ไม่งั้น `400`
  - `externalUrl` ต้องเป็น `http`/`https` เท่านั้น · audit ตอนสร้าง/ทำเครื่องหมายโพสต์แล้ว/ลบ
  - ห้ามเก็บรหัสผ่านหรือ secret ใด ๆ ในประวัติ
- UI: `TextStudio`/`ClipStudio` มีปุ่ม **“บันทึกงานนี้ลงประวัติ”** (ไม่บันทึกอัตโนมัติ —
  ผู้ใช้ต้องกดเมื่อเตรียมงานเสร็จ) · `PostHistory.tsx` แสดงสถานะและปุ่ม “โพสต์แล้ว/ข้าม”
- คำอธิบายของคลิปที่ต่างกันต่อแพลตฟอร์มจะถูกเก็บรวมพร้อมหัวข้อ `[YouTube]` ฯลฯ
  เพื่อไม่ให้ประวัติโกหกว่าทุกแพลตฟอร์มใช้ข้อความเดียวกัน

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`social_post_targets` · `social_posts` · `user_ecosystem_accounts`

### Routes
- `ecosystem/ecosystem.routes.ts` (149 บรรทัด)
- `ecosystem/social-history.routes.ts` (80 บรรทัด)

### Endpoints (จาก router)
```
GET /catalog
GET /accounts
POST /accounts
POST /accounts/auto-link
PATCH /accounts/:id
DELETE /accounts/:id
POST /accounts/:id/reveal
POST /accounts/:id/open
GET /posts
POST /posts
PATCH /posts/:id/targets/:platform
DELETE /posts/:id
```

### Services ที่ทำงานให้โมดูลนี้
`ecosystem.service` · `social-history.service`

<!-- auto:end -->
