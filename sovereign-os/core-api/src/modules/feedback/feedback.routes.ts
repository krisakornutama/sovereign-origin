// src/modules/feedback/feedback.routes.ts
//
// FEEDBACK (P: Publishing) — POST สาธารณะ (มี honeypot+throttle) · GET/judge/digest = admin
import { Router, Request } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { prisma } from '../../lib/prisma';
import {
  submitFeedback,
  listFeedback,
  judgeFeedback,
  sendFeedbackDigest,
  feedbackThrottled,
  ipHashOf,
} from '../../services/feedback.service';

export { prisma }; // ให้เทส mock delegate ผ่านตัวเดียวกับ production
export { submitFeedback, sendFeedbackDigest, listFeedback }; // re-export ให้เทส stub ได้

const router = Router();

const submitLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'ส่งฟีดแบ็กถี่เกินไป ลองใหม่อีกครั้ง' });

function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.ip || '0.0.0.0';
}

// POST /api/feedback — สาธารณะ (หน้า /demo และหน้าสาธารณะอื่น)
// honeypot field: website (ซ่อนด้วย CSS ในฟอร์ม — มนุษย์กรอกไม่ได้ bot มักกรอก)
router.post('/', submitLimiter, async (req, res) => {
  try {
    const ipHash = ipHashOf(clientIp(req));
    if (await feedbackThrottled(ipHash)) {
      // ปฏิเสธเงียบ — ตอบ 202 เหมือนสำเร็จ ไม่ให้ bot จับแพตเทิร์น
      return res.status(202).json({ ok: true });
    }
    const result = await submitFeedback({
      page: req.body?.page,
      topic: req.body?.topic,
      message: req.body?.message,
      senderEmail: req.body?.senderEmail,
      website: req.body?.website, // honeypot
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    });
    if (!result.accepted) {
      // invalid จริง = 400 · honeypot = 202 ปลอม (ไม่บอกเหตุผล)
      if (result.reason === 'invalid') return res.status(400).json({ error: 'ข้อความสั้นเกินไป' });
      return res.status(202).json({ ok: true });
    }
    res.status(201).json({ ok: true, id: result.id, telegramSent: result.telegramSent });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback — รายการทั้งหมด (admin)
router.get('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const take = Number(req.query.take);
    res.json({ notes: await listFeedback(Number.isFinite(take) ? take : 100) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/feedback/:id — ตัดสิน useful=true/false/null (admin)
router.patch('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const useful = req.body?.useful;
    if (useful !== true && useful !== false && useful !== null) {
      return res.status(400).json({ error: 'useful must be true, false, or null' });
    }
    const note = await judgeFeedback(String(req.params.id), useful);
    res.json(note);
  } catch (err: any) {
    if (String(err?.message ?? '').includes('does not exist') || err?.code === 'P2025') {
      return res.status(404).json({ error: 'feedback not found' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/feedback/digest — ยื่นฟีดแบ็กที่คัดแล้วถึงเจ้าของ (Telegram) (admin)
router.post('/digest', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    res.json(await sendFeedbackDigest());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
