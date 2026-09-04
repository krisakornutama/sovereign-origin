-- บังคับเปลี่ยนรหัสผ่านหลัง login ครั้งแรก (สมาชิกใหม่) หรือเมื่อ admin ตั้งให้
-- true = หลัง login ต้องเปลี่ยนรหัสผ่านก่อนเข้าใช้งาน (ล้าง flag เมื่อเปลี่ยนสำเร็จ)
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;