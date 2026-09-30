// src/modules/analytics/analytics.routes.ts
//
// VISITOR TRACKING (P10) — POST /api/track สาธารณะ (beacon · honeypot) · GET /api/analytics/summary = admin
import { Router, Request } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { prisma } from '../../lib/prisma';
import { trackEvent, visitorSummary } from '../../services/visitor-tracking.service';

export { prisma }; // ให้เทส mock delegate ผ่านตัวเดียวกับ production

const router = Router();

const trackLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'ยิง beacon ถี่เกินไป' });

function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.ip || '0.0.0.0';
}

// POST /api/track — สาธารณะ (navigator.sendBeacon จากหน้าเว็บ) — honeypot: website ต้องว่าง
router.post('/track', trackLimiter, async (req, res) => {
  try {
    const r = await trackEvent({
      kind: req.body?.kind,
      page: req.body?.page,
      detail: req.body?.detail,
      value: req.body?.value,
      website: req.body?.website,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    // ทุกกรณีตอบยอมรับ (ของเพี้ยน/บอททิ้งเงียบ) — beacon ต้องไม่กลายเป็น error ใน console ผู้ใช้
    return res.status(202).json({ ok: true, accepted: r.accepted });
  } catch {
    return res.status(202).json({ ok: true });
  }
});

// GET /api/analytics/summary?days=7 — admin ดูพฤติกรรมผู้เยี่ยมชม
router.get('/analytics/summary', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
    const summary = await visitorSummary(days);
    return res.json(summary);
  } catch {
    return res.status(500).json({ error: 'สรุปพฤติกรรมไม่สำเร็จ' });
  }
});

export default router;
