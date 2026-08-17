// หน้าเข้าสู่ระบบ / MFA — ภาษาไทย
export default {
  username: 'ชื่อผู้ใช้',
  password: 'รหัสผ่าน',
  signIn: 'เข้าสู่ระบบ',
  subtitle: 'ศูนย์บัญชาการนอกระบบ · เข้าสู่ระบบ',
  rateLimited: 'ระบบจำกัดจำนวนครั้ง — ลองอีกครั้งใน {time}',
  wait: 'รอ {time}',
  loading: 'กำลังโหลด...',
  mfaTitle: 'ยืนยันตัวตน 2FA — ขั้นตอนที่ 2',
  mfaHint: 'กรอกรหัส 6 หลักจากแอป Authenticator (Google / Microsoft)',
  mfaDigitLabel: 'หลักที่ {n}',
  verifying: 'กำลังยืนยัน…',
  confirm: 'ยืนยัน',
  mfaGate: 'SESSION GATE · TOTP (SHA-1) · 30 วินาทีต่อรหัส · พยายามจำกัด 10 ครั้ง/15 นาที',
  loginFailed: 'เข้าสู่ระบบล้มเหลว',
  otpInvalid: 'รหัส OTP ไม่ถูกต้อง',
  genericError: 'เกิดข้อผิดพลาด',
} as const;