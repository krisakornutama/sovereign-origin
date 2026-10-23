import { rateLimit } from './rateLimit.middleware';

/**
 * จำกัด upload ต่อบัญชี/IP — กันการยิงไฟล์ถี่ผิดปกติไปยัง endpoint ที่ประมวลผลไฟล์
 * (documents/vision/treasury/whisper/knowledge/agent screenshot/dime)
 * ใช้หลัง authenticate (หรือ machine-token) เสมอ เพื่อให้ key เป็นผู้ใช้จริงเมื่อมี
 */
export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'อัปโหลดถี่เกินไป กรุณาลองใหม่ภายหลัง',
  keyBy: (req) => String(req.user?.id ?? ''),
});
