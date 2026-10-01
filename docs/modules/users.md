# โมดูล users

## เจตนา
การจัดการบัญชีผู้ใช้โดยผู้ดูแล — สร้าง/แก้/ลบบัญชี, รีเซ็ตรหัสผ่าน (ระบบนี้ **ไม่มีการสมัครเอง** ทุกบัญชีมาจากผู้ดูแล)

## ข้อห้าม / ระวัง
- การเปลี่ยน role ของบัญชี = เปลี่ยนสิทธิ์ทั้งระบบทันที — ต้องผ่านผู้ดูแลสูงสุดเท่านั้น
- `reset-password` ต้องบังคับเปลี่ยนรหัสรอบแรก (must-change-password) และถูกบันทึก audit ทุกครั้ง
- ห้ามลบบัญชีที่ยังผูก node/ข้อมูลธุรกิจอยู่โดยไม่โอนย้ายความเป็นเจ้าของก่อน
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `users/users.routes.ts` (89 บรรทัด)

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

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `users/users.routes.ts` (89 บรรทัด)

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
