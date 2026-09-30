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
import { createPartnerBill, partnerBills, foundationBusinessId, partnerBillsAuthorized } from '../../services/business-shop.service';
import { sendPartnerOtp, verifyPartnerOtp, issueVerifiedToken } from '../../services/partner-guard.service';

export { prisma }; // ให้เทส mock delegate ผ่านตัวเดียวกับ production
export { applyPartner, publicPartners, partnerCounts };

const router = Router();

// max ปรับได้ทาง env (เทสต์คลายเป็น 100 — prod คง 5/นาที)
const applyLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.PARTNER_APPLY_LIMIT || 5), message: 'ส่งใบสมัครถี่เกินไป ลองใหม่อีกครั้ง' });

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
      otpToken: req.body?.otpToken,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    // P17: unverified = ไม่มี OTP token → บอกผู้ใช้จริงให้ไปยืนยันเบอร์ (บอทที่ไม่มี token ก็โดนทิ้งเหมือนกัน)
    if (!r.accepted && r.reason === 'unverified') {
      return res.status(403).json({ error: 'กรุณายืนยันเบอร์โทรด้วยรหัส OTP ก่อนส่งใบสมัคร' });
    }
    if (!r.accepted && r.reason === 'spam') {
      return res.status(429).json({ error: r.error ?? 'ใบสมัครนี้ไม่สามารถรับได้ในขณะนี้' });
    }
    // honeypot/invalid = ตอบยอมรับเฉย ๆ (บอทไม่รู้ว่าโดนทิ้ง)
    return res.status(202).json({ ok: true, accepted: r.accepted, id: r.accepted ? r.id : undefined });
  } catch {
    return res.status(500).json({ error: 'ส่งใบสมัครไม่สำเร็จ' });
  }
});

// ── P17 — OTP ยืนยันเบอร์ก่อนสมัคร (กันสแปมชั้น 3) ──

// POST /api/partners/otp/send { contactPhone } → { sent: true, devCode? }
router.post('/otp/send', applyLimiter, async (req, res) => {
  const phone = String(req.body?.contactPhone ?? '');
  if (!phone.trim()) return res.status(400).json({ error: 'ต้องระบุเบอร์โทร' });
  const r = await sendPartnerOtp(phone);
  if (!r.sent) return res.status(502).json({ error: r.error });
  return res.json({ sent: true, ...(r as any).devCode ? { devCode: (r as any).devCode } : {} });
});

// POST /api/partners/otp/verify { contactPhone, code } → { verified: true, token }
router.post('/otp/verify', applyLimiter, async (req, res) => {
  const phone = String(req.body?.contactPhone ?? '');
  const code = String(req.body?.code ?? '');
  const r = verifyPartnerOtp(phone, code);
  if (!r.ok) return res.status(400).json({ error: r.reason });
  return res.json({ verified: true, token: issueVerifiedToken(phone) });
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

// ── P17 — บิลค่าบริการ IoT คู่ค้า ──
// POST /api/partners/:id/bills (SUPERADMIN) — สร้างบิล + งานติดตั้ง → คืนลิงก์ลับชำระ PromptPay
router.post('/:id/bills', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const bizId = await foundationBusinessId();
    if (!bizId) return res.status(500).json({ error: 'ไม่พบธุรกิจหลัก' });
    const bill = await createPartnerBill(bizId, {
      partnerId: String(req.params.id),
      title: String(req.body?.title ?? ''),
      amount: Number(req.body?.amount ?? 0),
      installTitle: req.body?.installTitle ? String(req.body.installTitle) : undefined,
      note: req.body?.note ? String(req.body.note) : undefined,
    });
    return res.status(201).json({
      ...bill,
      payUrl: `${process.env.PUBLIC_APP_URL || 'https://sovereignoriginshop.dpdns.org'}/shop/?order=${bill.publicToken}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/.test(msg)) return res.status(404).json({ error: 'ไม่พบคู่ค้านี้' });
    return res.status(400).json({ error: msg });
  }
});

// GET /api/partners/:id/bills?t=<token> — คู่ค้าดูบิลตัวเองผ่านลิงก์ลับ (token = publicToken ของบิลล่าสุด)
router.get('/:id/bills', applyLimiter, async (req, res) => {
  try {
    const token = String(req.query.t ?? '');
    const bills = await partnerBillsAuthorized(String(req.params.id), token);
    if (!bills) return res.status(403).json({ error: 'ลิงก์ไม่ถูกต้อง' });
    return res.json({ bills });
  } catch {
    return res.status(500).json({ error: 'โหลดบิลไม่สำเร็จ' });
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
