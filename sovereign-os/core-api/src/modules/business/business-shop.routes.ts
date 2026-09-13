// src/modules/business/business-shop.routes.ts
//
// PUBLIC SHOP routes — endpoint สาธารณะของหน้าร้าน /shop (ไม่ต้อง login)
// ทุกเส้นโดน rate limit (public = ผิวเปิดที่สุดของระบบ) — ปิดร้าน/ไม่มีธุรกิจ = 404 กลาง
import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import * as shop from '../../services/business-shop.service';

const router = Router();

// ── public rate limit — แยก bucket ต่อเส้นทางสำคัญ (โจมตีสั่งซื้อ/แจ้งชำระ ไม่พาหน้าเสียหายร่วมกัน) ──
const browseLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'ร้านพยายามเรียกถี่เกินไป ลองใหม่อีกครั้ง' });
const orderLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'สั่งซื้อถี่เกินไป ลองใหม่อีกครั้ง' });
const payLimiter = rateLimit({ windowMs: 60_000, max: 15, message: 'แจ้งชำระถี่เกินไป ลองใหม่อีกครั้ง' });

/** shop/order not found จาก service = ปิดร้าน/ไม่มีจริง → 404 กลาง (ไม่เผยว่ามีอยู่); อย่างอื่น = 400 */
function fail(res: any, err: any): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/.test(msg)) res.status(404).json({ error: 'ไม่พบร้านนี้' });
  else res.status(400).json({ error: msg });
}

// GET /api/shop/:businessId — หน้าร้าน (สินค้า + ชื่อร้าน) — สาธารณะ
router.get('/:businessId', browseLimiter, async (req, res) => {
  try {
    res.json(await shop.getPublicShop(String(req.params.businessId)));
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/shop/:businessId/orders — ลูกค้าสั่งซื้อ (สร้าง QUOTE + publicToken) — สาธารณะ
router.post('/:businessId/orders', orderLimiter, async (req, res) => {
  try {
    const order = await shop.createPublicOrder(String(req.params.businessId), req.body);
    res.status(201).json(order);
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/shop/orders/:token — สถานะออเดอร์ผ่านลิงก์ลับ (token = publicToken UUID) — สาธารณะ
router.get('/orders/:token', browseLimiter, async (req, res) => {
  try {
    res.json(await shop.getPublicOrderByToken(String(req.params.token)));
  } catch (err) {
    fail(res, err);
  }
});

// POST /api/shop/orders/:token/pay — ลูกค้าแจ้งชำระผ่านลิงก์ลับ (จำกัดยอด = ส่วนค้างชำระ) — สาธารณะ
router.post('/orders/:token/pay', payLimiter, async (req, res) => {
  try {
    res.json(await shop.payPublicOrderByToken(String(req.params.token), req.body));
  } catch (err) {
    fail(res, err);
  }
});

// GET /api/shop/:businessId/promptpay?amount=… — QR สำเร็จรูป (data URL) ฝังยอด — สาธารณะ
router.get('/:businessId/promptpay', browseLimiter, async (req, res) => {
  try {
    const amount = Number(req.query.amount);
    res.json(await shop.publicPromptPayInfo(String(req.params.businessId), Number.isFinite(amount) ? amount : 0));
  } catch (err) {
    fail(res, err);
  }
});

export default router;
