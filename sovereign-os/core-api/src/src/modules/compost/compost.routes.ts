import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { deductStock } from '../../services/inventory.service';

const router = Router();
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];
const DAY_MS = 86_400_000;

const METHOD_DAYS: Record<string, number> = {
  hot: 30,
  vermi: 60,
  bokashi: 14,
  biochar: 7,
};
const VALID_METHODS = Object.keys(METHOD_DAYS);
const VALID_REASONS = ['trim', 'spoiled', 'expired', 'plate_waste', 'prep_error'];

function parseNote(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v).slice(0, 500);
}

// POST /api/compost/batches {inputKg, method: hot|vermi|bokashi|biochar, note}
router.post('/batches', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const inputKg = Number(req.body?.inputKg);
    const method = String(req.body?.method || '').toLowerCase().trim();
    const note = parseNote(req.body?.note);

    if (!Number.isFinite(inputKg) || inputKg <= 0) {
      return res.status(400).json({ error: 'inputKg must be > 0' });
    }
    if (inputKg > 100000) return res.status(400).json({ error: 'inputKg too large (max 100000)' });
    if (!VALID_METHODS.includes(method)) {
      return res.status(400).json({ error: `method must be one of: ${VALID_METHODS.join(', ')}` });
    }

    const now = new Date();
    const days = METHOD_DAYS[method];
    const estReadyAt = new Date(now.getTime() + days * DAY_MS);

    const batch = await prisma.compostBatch.create({
      data: {
        inputKg,
        method,
        note,
        startAt: now,
        estReadyAt,
        status: 'active',
        outputKg: null,
      },
    });
    res.status(201).json(batch);
  } catch (err) {
    console.error('Create compost batch error:', err);
    res.status(500).json({ error: 'Failed to create compost batch' });
  }
});

// GET /api/compost/batches
router.get('/batches', authenticate, async (_req, res) => {
  try {
    const batches = await prisma.compostBatch.findMany({ orderBy: { startAt: 'desc' } });
    res.json({ batches });
  } catch (err) {
    console.error('List compost batches error:', err);
    res.status(500).json({ error: 'Failed to load compost batches' });
  }
});

// POST /api/compost/:id/harvest {outputKg?, note?}
router.post('/:id/harvest', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await prisma.compostBatch.findUnique({ where: { id } });
    if (!batch) return res.status(404).json({ error: 'Compost batch not found' });

    let outputKg: number | null = null;
    if (req.body?.outputKg != null && req.body.outputKg !== '') {
      outputKg = Number(req.body.outputKg);
      if (!Number.isFinite(outputKg) || outputKg <= 0) {
        return res.status(400).json({ error: 'outputKg must be > 0' });
      }
      if (outputKg > 100000) return res.status(400).json({ error: 'outputKg too large (max 100000)' });
    }
    const finalOutput = outputKg != null ? outputKg : Number(batch.inputKg) * 0.5;
    const note = parseNote(req.body?.note);
    const readyAt = new Date();

    const updated = await prisma.compostBatch.update({
      where: { id },
      data: {
        status: 'ready',
        outputKg: finalOutput,
        readyAt,
        ...(note != null ? { note } : {}),
      },
    });

    const userId = (req as any).user?.id as string;
    let inventoryItem: any = null;
    try {
      inventoryItem = await prisma.inventoryItem.create({
        data: {
          user_id: userId,
          name: `ปุ๋ยหมัก ${batch.method}`,
          category: 'COMPOST',
          quantity: finalOutput,
          unit: 'kg',
          unit_price_usd: 0,
          location: 'ปุ๋ยหมัก',
          notes: note ? `จากกองปุ๋ย ${batch.id} — ${note}` : `จากกองปุ๋ย ${batch.id}`,
        },
      });
    } catch (e) {
      console.error('Create compost inventory error:', e);
    }

    res.json({ success: true, batch: updated, inventoryId: inventoryItem?.id ?? null, outputKg: finalOutput });
  } catch (err) {
    console.error('Harvest compost error:', err);
    res.status(500).json({ error: 'Failed to harvest compost' });
  }
});

// POST /api/compost/waste {inventoryItemId?, qtyKg, reason?: trim|spoiled|expired|plate_waste, note?, restaurantId?}
router.post('/waste', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const inventoryItemId = req.body?.inventoryItemId ? String(req.body.inventoryItemId) : null;
    const qtyKg = Number(req.body?.qtyKg);
    const reasonRaw = req.body?.reason ? String(req.body.reason).toLowerCase().trim() : 'spoiled';
    const reason = VALID_REASONS.includes(reasonRaw) ? reasonRaw : 'spoiled';
    const note = parseNote(req.body?.note);
    const restaurantId = req.body?.restaurantId ? String(req.body.restaurantId) : null;

    if (!Number.isFinite(qtyKg) || qtyKg <= 0) {
      return res.status(400).json({ error: 'qtyKg must be > 0' });
    }
    if (qtyKg > 100000) return res.status(400).json({ error: 'qtyKg too large (max 100000)' });

    let stock: any = null;
    if (inventoryItemId) {
      stock = await deductStock(prisma as any, inventoryItemId, qtyKg);
      if (!stock.ok && stock.reason) {
        // still log waste even if stock shortfall — don't block
        console.warn('Compost waste deductStock shortfall:', stock.reason);
      }
    }

    const log = await prisma.restaurantWasteLog.create({
      data: {
        restaurantId,
        inventoryItemId,
        qtyKg,
        reason,
        note,
      },
    });

    res.status(201).json({ success: true, log, stock });
  } catch (err) {
    console.error('Compost waste log error:', err);
    res.status(500).json({ error: 'Failed to log waste' });
  }
});

export default router;
