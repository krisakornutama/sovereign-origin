// src/modules/partners/partners.routes.ts
//
// PARTNER NETWORK (P16) — POST /api/partners สาธารณะ (สมัคร · honeypot · limiter)
//                        GET  /api/partners สาธารณะ (แผนที่/รายชื่อ ACTIVE เท่านั้น)
//                        GET  /api/partners/admin/list · PATCH /api/partners/:id (SUPERADMIN อนุมัติ/ปฏิเสธ)
import { Router, Request } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { prisma } from '../../lib/prisma';
import { applyPartner, publicPartners, partnerCounts } from '../../services/partner.service';

export { prisma }; // ให้เทส mock delegate ผ่านตัวเดียวกับ production
export { applyPartner, publicPartners, partnerCounts };

const router = Router();

const applyLimiter = rateLimit({ windowMs: 60_000, max: 5, message: 'ส่งใบสมัครถี่เกินไป ลองใหม่อีกครั้ง' });

function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.ip || '0.0.0.0';
}

// POST /api/partners — สมัครสาธารณะ (honeypot: website ต้องว่าง)
router.post('/', applyLimiter, async (req, res) => {
  try {
    const r = await applyPartner({
      name: req.body?.name,
      category: req.body?.category,
      detail: req.body?.detail,
      address: req.body?.address,
      phone: req.body?.phone,
      lat: req.body?.lat,
      lng: req.body?.lng,
      contactName: req.body?.contactName,
      contactPhone: req.body?.contactPhone,
      contactEmail: req.body?.contactEmail,
      website: req.body?.website,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    // ทุกกรณีตอบยอมรับ (บอทไม่รู้ว่าโดนทิ้ง)
    return res.status(202).json({ ok: true, accepted: r.accepted, id: r.accepted ? r.id : undefined });
  } catch {
    return res.status(500).json({ error: 'ส่งใบสมัครไม่สำเร็จ' });
  }
});

// GET /api/partners — แผนที่/รายชื่อสาธารณะ (ACTIVE เท่านั้น · ไม่มีข้อมูลผู้สมัคร)
router.get('/', applyLimiter, async (_req, res) => {
  try {
    const [partners, counts] = await Promise.all([publicPartners(), partnerCounts()]);
    return res.json({ partners, counts });
  } catch {
    return res.status(500).json({ error: 'โหลดแผนที่พาร์ทเนอร์ไม่สำเร็จ' });
  }
});

// GET /api/partners/:id/qr — QR ป้ายร้าน (P16 คำสั่งเจ้าของ): สแกนแล้วเปิดหมุดร้านตัวเองบน /partners?p=<id>
//  สาธารณะ (ติดป้ายหน้าร้าน — ไม่เปิดเผยอะไรเกิน GET /api/partners อยู่แล้ว) · ACTIVE เท่านั้น
router.get('/:id/qr', applyLimiter, async (req, res) => {
  try {
    const p = await prisma.partner.findFirst({ where: { id: String(req.params.id), status: 'ACTIVE' }, select: { name: true } });
    if (!p) return res.status(404).json({ error: 'ไม่พบคู่ค้านี้' });
    const QRCode = (await import('qrcode')).default;
    const base = process.env.PUBLIC_APP_URL || 'https://sovereignoriginshop.dpdns.org';
    const target = `${base}/partners/?p=${String(req.params.id)}`;
    const qrDataUrl = await QRCode.toDataURL(target, { width: 480, margin: 2 });
    return res.json({ name: p.name, target, qrDataUrl });
  } catch {
    return res.status(500).json({ error: 'สร้าง QR ไม่สำเร็จ' });
  }
});

// GET /api/partners/admin/list — ทั้งหมดรวม PENDING (SUPERADMIN)
router.get('/admin/list', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const rows = await prisma.partner.findMany({ orderBy: { created_at: 'desc' }, take: 300 });
    return res.json({ partners: rows });
  } catch {
    return res.status(500).json({ error: 'โหลดรายการไม่สำเร็จ' });
  }
});

// PATCH /api/partners/:id — อนุมัติ/ปฏิเสธ (SUPERADMIN)
router.patch('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const status = String(req.body?.status ?? '');
    if (!['ACTIVE', 'REJECTED', 'PENDING'].includes(status)) return res.status(400).json({ error: 'status ต้องเป็น ACTIVE | REJECTED | PENDING' });
    const row = await prisma.partner.update({
      where: { id: String(req.params.id) },
      data: { status, decided_at: status === 'PENDING' ? null : new Date(), note: req.body?.note ? String(req.body.note).slice(0, 300) : undefined },
    });
    return res.json({ ok: true, id: row.id, status: row.status });
  } catch {
    return res.status(500).json({ error: 'อัปเดตไม่สำเร็จ' });
  }
});

export default router;
