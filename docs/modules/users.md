# โมดูล users

## เจตนา
การจัดการบัญชีผู้ใช้โดยผู้ดูแล — สร้าง/แก้/ลบบัญชี, รีเซ็ตรหัสผ่าน (ระบบนี้ **ไม่มีการสมัครเอง** ทุกบัญชีมาจากผู้ดูแล)

## ข้อห้าม / ระวัง
- การเปลี่ยน role ของบัญชี = เปลี่ยนสิทธิ์ทั้งระบบทันที — ต้องผ่านผู้ดูแลสูงสุดเท่านั้น
- `reset-password` ต้องบังคับเปลี่ยนรหัสรอบแรก (must-change-password) และถูกบันทึก audit ทุกครั้ง
- `POST /:id/reset-mfa` เป็น**ทางกู้เมื่อสมาชิกทำ authenticator หาย** — SUPERADMIN เท่านั้น, เขียน audit `USER_MFA_RESET_BY_ADMIN` ทุกครั้ง, ล้าง `mfa_secret`/`pending_mfa_secret`/`mfa_backup_hash` และ **bump `token_version`** ให้ session เดิมตายทันที
  - **รีเซ็ต 2FA ของตัวเองผ่าน endpoint นี้ไม่ได้ (400)** — ต้องใช้หน้าตั้งค่าที่บังคับยืนยันรหัสผ่าน (กันคนที่ยึด session อยู่ไล่ปิด 2FA ของเจ้าของ)
  - `GET /` ส่งเฉพาะ `mfa_enabled` (boolean) — **ห้ามส่ง `mfa_secret`/`mfa_backup_hash`/`pending_mfa_secret` ออกไปไม่ว่ากรณีใด**
- ห้ามลบบัญชีที่ยังผูก node/ข้อมูลธุรกิจอยู่โดยไม่โอนย้ายความเป็นเจ้าของก่อน
  - **API กันเอง ไม่พึ่งปุ่มที่ UI ปิดไว้**: `DELETE /:id` ปฏิเสธลบบัญชีตัวเอง (400), ลบ `SUPERADMIN` คนสุดท้าย (400), FK ยังผูกอยู่ `P2003` (400), ไม่พบผู้ใช้ (404), id ผิดรูป `P2023` (400)
  - `PUT /:id` ลดสิทธิ์ `SUPERADMIN` คนสุดท้ายไม่ได้ (400) — ไม่งั้นระบบไม่เหลือใครอนุมัติ/กู้ และต้องเปิด DB console
  - **ห้ามถอดด่านพวกนี้ออก** เพราะ "ปุ่มถูก disable" ไม่ใช่การป้องกัน (ยิง API ตรงได้เสมอ) และการกู้คืนทำได้ที่คอนเทนเนอร์เท่านั้น
- `PUT /:id` รับ `assigned_site_id` (สาขาของ `SITE_ADMIN`) — ตรวจว่าสาขามีจริงผ่าน service ของ fleet
  (โมดูลนี้ไม่ query ตาราง `fleet_*` เอง) และ bump `token_version` ทุกครั้งที่เปลี่ยนสาขา
- role ที่รับได้: `SUPERADMIN`, `NODE_ADMIN`, `OPERATOR`, `SYSTEM_AI`, `SITE_ADMIN`
  (`SITE_ADMIN` อ่าน `/api/fleet` ได้อย่างเดียวและเห็นเฉพาะสาขาตัวเอง — ไม่ผูกสาขา = 403)
- `POST /` (สร้างบัญชี) ต้องตรวจ input **ก่อน** แตะ bcrypt/prisma เพราะ Express 4 ไม่ส่ง error
  ออกจาก async handler ⇒ สิ่งที่ throw จะกลายเป็น request ที่ **ค้าง** ไม่ใช่ 500
  - `username` ถูก trim, ต้องไม่ว่างและ ≤ 64 ตัวอักษร · `role` ต้องอยู่ในชุด `VALID_ROLES` (ที่เดียวกับ `PUT`)
  - `password` ผ่าน `AuthService.validateNewPassword` (8–128 + บล็อกรหัสยอดนิยม) — กฎเดียวกับตอนผู้ใช้ตั้งรหัสเอง
  - username ซ้ำ = Prisma `P2002` → **409** (ไม่ใช่ 500/ค้าง) · สำเร็จคืน 200 + `{ success, user:{id,username,role} }`
  - **ห้ามคืน `password_hash` หรือรหัสผ่านจริงใน response** — ใช้ `select` ที่ `create` เสมอ
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `users/users.routes.ts` (100 บรรทัด)

### Endpoints (จาก router)
```
GET /
POST /
DELETE /:id
POST /:id/reset-password
PUT /:id
```

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- users → auth(users)

<!-- auto:end -->

