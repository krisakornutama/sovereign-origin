import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { getPublicTrace, listLots, createLotFromHarvest } from '../../services/trace.service';

export { prisma }; // ให้เทส mock delegate ผ่านตัวเดียวกับ production

const router = Router();

// ── public rate limit — ตามรอยผลผลิตเปิดให้ใครก็สแกนได้ (ลิงก์ QR บนสินค้า) ──
const traceLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'ตามรอยถี่เกินไป ลองใหม่อีกครั้ง' });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'บันทึกล็อตถี่เกินไป ลองใหม่อีกครั้ง' });

// GET /api/trace/:lotCode — ตามรอยสาธารณะ (ไม่ต้อง login) — 404 กลางเมื่อไม่พบ ไม่เผยว่ามีรหัสอื่น
router.get('/:lotCode', traceLimiter, async (req, res) => {
  try {
    res.json(await getPublicTrace(req.params.lotCode));
  } catch (err: any) {
    if (err?.message === 'lot not found') return res.status(404).json({ error: 'lot not found' });
    res.status(400).json({ error: err.message });
  }
});

// GET /api/trace — รายการล็อตล่าสุด (login — จุดเริ่มหน้า traceability)
router.get('/', authenticate, async (_req, res) => {
  try {
    res.json({ lots: await listLots() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/trace — สร้างล็อตเอง (login + WRITE_ROLES) — สำหรับของที่ไม่ได้มาจากแปลง เช่น ของซื้อมาแปรรูป
router.post('/', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'), writeLimiter, async (req, res) => {
  try {
    const inventoryItemId = String(req.body?.inventoryItemId || '').trim();
    if (!inventoryItemId) return res.status(400).json({ error: 'inventoryItemId is required' });
    const quantityKg = Number(req.body?.quantityKg);
    if (!Number.isFinite(quantityKg) || quantityKg <= 0) {
      return res.status(400).json({ error: 'quantityKg must be > 0' });
    }
    const item = await prisma.inventoryItem.findUnique({ where: { id: inventoryItemId } });
    if (!item) return res.status(404).json({ error: 'inventory item not found' });
    const lot = await createLotFromHarvest({
      inventoryItemId,
      plotId: req.body?.plotId ? String(req.body.plotId) : null,
      crop: req.body?.crop ? String(req.body.crop).slice(0, 120) : null,
      quantityKg,
    });
    res.status(201).json(lot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
