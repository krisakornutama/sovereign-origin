// src/modules/auth/register.routes.ts
// ทางเข้าเดียวสำหรับสมัครสมาชิกเอง: ต้องมีรหัสเชิญจาก SUPERADMIN เท่านั้น
import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { checkInvite, registerWithInvite, InviteError } from '../../services/invite.service';

const router = Router();

// เปิดให้เรียกได้โดยไม่ต้องล็อกอิน จึงต้องกัน brute-force รหัสเชิญราย IP
// export ไว้ให้เทสต์เคลียร์ bucket ได้ (ไม่ต้องสลับ IP ปลอม)
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'พยายามสมัครหลายครั้งเกินไป กรุณารอ 15 นาที',
});

// POST /api/auth/register/check — ตรวจรหัสเชิญก่อนกรอกฟอร์ม (ไม่กินสิทธิ์)
router.post('/register/check', registerLimiter, async (req, res) => {
  const result = await checkInvite(req.body?.code);
  if (!result.valid) return res.status(400).json({ valid: false, reason: result.reason });
  res.json({ valid: true, role: result.role, usesLeft: result.usesLeft, expiresAt: result.expiresAt });
});

// POST /api/auth/register — สมัครด้วยรหัสเชิญ + บันทึกความยินยอมขั้นจำเป็น
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { code, username, password, consents } = req.body ?? {};
    const result = await registerWithInvite({ code, username, password, consents, ip: req.ip });
    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof InviteError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.message?.includes('รหัสผ่าน')) return res.status(400).json({ error: err.message, code: 'WEAK_PASSWORD' });
    console.error('[register] failed:', err?.code || '', err?.message || err);
    res.status(500).json({ error: 'สมัครสมาชิกไม่สำเร็จ' });
  }
});

export default router;
