// modules/payments/payment-slips.routes.ts
//
// Free-first payment slips:
//   POST   /api/payments/slips/:businessId              อัปโหลดภาพสลิป (multipart: file + amount/provider/transRef/orderId/note)
//   GET    /api/payments/slips/:businessId              รายการ (metadata; ไม่ส่ง imageData)
//   GET    /api/payments/slips/:businessId/:id/image    ภาพต้นฉบับ
//   POST   /api/payments/slips/:businessId/:id/review   ตรวจด้วยมือ (APPROVED | REJECTED)
//
// ยังไม่มี public /shop ใน repo นี้ — จุดนี้จึงเป็น API ให้พนักงาน/เจ้าของธุรกิจใช้ก่อน
import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { hasBusinessAccess } from '../../lib/business';
import { hardenUpload, handledUpload, IMAGE_MIME } from '../../lib/harden-upload';
import * as svc from '../../services/payment-slip.service';

const router = Router();

const slipUpload = hardenUpload({
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  mode: 'memory',
  maxSizeMB: 5,
  mimeAllow: IMAGE_MIME,
});

function fail(res: Response, err: unknown): Response {
  if (err instanceof svc.SlipError) return res.status(err.status).json({ error: err.message });
  console.error('[payment-slip]', err);
  return res.status(500).json({ error: 'จัดการสลิปไม่สำเร็จ' });
}

async function canAccess(req: Request, businessId: string, min: 'VIEWER' | 'SALES' | 'MANAGER'): Promise<boolean> {
  if (!req.user) return false;
  return Boolean(await hasBusinessAccess(businessId, req.user.id, req.user.role, min));
}

router.post('/:businessId', authenticate, handledUpload(slipUpload, 'file'), async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.businessId ?? '');
    if (!svc.isSlipUuid(businessId)) return res.status(400).json({ error: 'businessId ไม่ถูกต้อง' });
    if (!(await canAccess(req, businessId, 'SALES'))) return res.status(403).json({ error: 'ไม่มีสิทธิ์อัปโหลดสลิปของธุรกิจนี้' });

    const file = (req as Request & { file?: { buffer?: Buffer } }).file;
    if (!file?.buffer?.length) return res.status(400).json({ error: 'ต้องแนบไฟล์สลิป (field: file)' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const slip = await svc.createPaymentSlip({
      businessId,
      orderId: body.orderId,
      provider: body.provider,
      transRef: body.transRef,
      amount: body.amount,
      note: body.note,
      image: file.buffer,
      uploadedBy: req.user!.id,
    });
    return res.status(201).json({ success: true, slip });
  } catch (err) {
    return fail(res, err);
  }
});

router.get('/:businessId', authenticate, async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.businessId ?? '');
    if (!svc.isSlipUuid(businessId)) return res.status(400).json({ error: 'businessId ไม่ถูกต้อง' });
    if (!(await canAccess(req, businessId, 'VIEWER'))) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูสลิปของธุรกิจนี้' });

    const slips = await svc.listPaymentSlips({
      businessId,
      status: typeof req.query.status === 'string' ? req.query.status : null,
      limit: req.query.limit,
    });
    return res.json({ success: true, slips });
  } catch (err) {
    return fail(res, err);
  }
});

router.get('/:businessId/:id/image', authenticate, async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.businessId ?? '');
    const id = String(req.params.id ?? '');
    if (!svc.isSlipUuid(businessId) || !svc.isSlipUuid(id)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
    if (!(await canAccess(req, businessId, 'VIEWER'))) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูสลิปของธุรกิจนี้' });

    const image = await svc.getPaymentSlipImage({ businessId, id });
    if (!image) return res.status(404).json({ error: 'ไม่พบสลิป' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', image.mime);
    return res.send(image.data);
  } catch (err) {
    return fail(res, err);
  }
});

router.post('/:businessId/:id/review', authenticate, async (req: Request, res: Response) => {
  try {
    const businessId = String(req.params.businessId ?? '');
    const id = String(req.params.id ?? '');
    if (!svc.isSlipUuid(businessId) || !svc.isSlipUuid(id)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });
    if (!(await canAccess(req, businessId, 'MANAGER'))) return res.status(403).json({ error: 'ต้องเป็นเจ้าของหรือผู้จัดการจึงตรวจสลิปได้' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await svc.reviewPaymentSlip({
      businessId,
      id,
      decision: body.decision,
      note: body.note,
      reviewedBy: req.user!.id,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return fail(res, err);
  }
});

export default router;
