import jwt from 'jsonwebtoken';
import { config } from '../config';

// ────────────────────────────────────────────────────────────────────────────
// จุด verify JWT เดียวของระบบ
//
// เหตุผล: jsonwebtoken ยอมรับ HMAC ทุกอัลกอริทึมที่เข้ากับ secret ที่ให้มา
// ⇒ token ที่เซ็นด้วย HS512 (secret เดียวกัน) ก็ผ่าน authenticate ได้ ทั้งที่
// ระบบนี้ออก token ด้วย HS256 เท่านั้น (auth.service.generateToken)
// การล็อก algorithms ที่จุดเดียวทำให้ทุกทางเข้า (HTTP, socket, automation) ตรงกัน
// และตัดเส้นทางที่ไม่รองรับออกก่อนตรวจลายเซ็น
// ────────────────────────────────────────────────────────────────────────────
export const JWT_ALGORITHMS = ['HS256'] as const;

export function verifyJwt(token: string): any {
  return jwt.verify(token, config.jwtSecret, { algorithms: [...JWT_ALGORITHMS] });
}
