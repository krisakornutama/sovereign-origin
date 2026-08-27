import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { deductStock } from '../../services/inventory.service';

const router = Router();
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];
const VALID_REASONS = ['trim', 'spoiled', 'expired', 'plate_waste', 'prep_error'];

// POST /api/inventory/:id/move-to-waste {qtyKg?, reason?, note?}
router.post('/:id/move-to-waste', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Inventory item not found' });

    let qtyKg: number;
    if (req.body?.qtyKg != null && req.body.qtyKg !== '') {
      qtyKg = Number(req.body.qtyKg);
      if (!Number.isFinite(qtyKg) || qtyKg <= 0) {
        return res.status(400).json({ error: 'qtyKg must be > 0' });
      }
      if (qtyKg > 100000) return res.status(400).json({ error: 'qtyKg too large (max 100000)' });
    } else {
      qtyKg = Number(existing.quantity);
      if (!Number.isFinite(qtyKg) || qtyKg <= 0) {
        return res.status(400).json({ error: 'Item quantity is 0 — nothing to move' });
      }
    }

    const reasonRaw = req.body?.reason ? String(req.body.reason).toLowerCase().trim() : 'spoiled';
    const reason = VALID_REASONS.includes(reasonRaw) ? reasonRaw : 'spoiled';
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;

    const stock = await deductStock(prisma as any, id, qtyKg);

    const log = await prisma.restaurantWasteLog.create({
      data: {
        inventoryItemId: id,
        qtyKg,
        reason,
        note,
      },
    });

    res.json({ success: true, log, stock });
  } catch (err) {
    console.error('Move to waste error:', err);
    res.status(500).json({ error: 'Failed to move to waste' });
  }
});

export default router;
