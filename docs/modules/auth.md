# โมดูล auth — ยืนยันตัวตน + ความปลอดภัยพื้นฐาน

## เจตนา
ทุกการเข้าถึงข้อมูลส่วนตัว/ธุรกิจต้องผ่านการล็อกอิน พร้อม MFA สำหรับบัญชีที่เปิดใช้ และถูกบันทึก audit ทุกเหตุการณ์สำคัญ

## ตารางที่เป็นเจ้าของ
- `users` — บัญชีผู้ใช้ (username, password hash, MFA secret, role)
- `audit_logs` — ทุกการกระทำที่บันทึกได้
- `feature_grants` — สิทธิ์เปิด/ปิดฟีเจอร์ต่อผู้ใช้
- `nodes` — อุปกรณ์/โหนดที่ผูกกับผู้ใช้

## Endpoints หลัก (mounted ที่ `/api/auth`)
- `POST /login` · `POST /verify-mfa` · `POST /change-password`
- MFA: `POST /mfa/enroll` · `/mfa/confirm` · `/mfa/disable` · `/mfa/backup-codes` · `GET /mfa/status`
- Rate limit สถานะ/เคลียร์: `GET /rate-limit-status` · `POST /rate-limit/clear`

## กลไกสำคัญ
- Brute-force สองชั้น: per-IP (10/15 นาที) + per-account (5/15 นาที, แยก bucket ตาม username, เขียน audit เมื่อโดน 429)
- Service: `src/services/auth.service.ts` (export `AuthService` + `prisma`)
- Middleware ที่โมดูลอื่นใช้ร่วม: `authenticate`, `requireRole` (`src/middleware/auth.middleware`)

## ห้ามแตะ / ระวัง
- `users` เป็นตารางที่ทุกโมดูลอ้าง (FK) — เปลี่ยน schema ต้องคิดข้ามโมดูลเสมอ
- ห้าม log รหัสผ่าน/MFA secret ลง audit_logs หรือ response
- บัญชี `e2e-bot` ใช้โดยเกต E2E (auth.setup) — ห้ามลบ/เปลี่ยนรหัสโดยไม่แจ้ง

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`audit_logs` · `feature_grants` · `nodes` · `user_feature_grants` · `users`

### Routes
- `auth/auth.routes.ts` (228 บรรทัด)

### Endpoints (จาก router)
```
POST /login
POST /verify-mfa
POST /change-password
POST /mfa/enroll
POST /mfa/confirm
POST /mfa/disable
POST /mfa/backup-codes
GET /mfa/status
GET /rate-limit-status
POST /rate-limit/clear
```

### Services ที่ทำงานให้โมดูลนี้
`audit.service` · `auth.service` · `feature-grant.service`

<!-- auto:end -->
