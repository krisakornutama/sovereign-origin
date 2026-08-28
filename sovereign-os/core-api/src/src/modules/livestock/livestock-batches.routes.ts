// livestock-batches.routes.ts — เสา 6: Batch Financial Engine — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { WRITE_ROLES, parseDate } from './livestock-shared';

const router = Router();

// ═══════════ เสา 6: Batch Financial Engine ═══════════

// POST /api/livestock/batches — ปิดงวดบัญชีหรือสร้างงวดใหม่ → netProfit อัตโนมัติ
router.post('/batches', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { batchCode, livestockGroupId, initialAnimalCost, totalFeedCost, totalMedCost, totalUtilityCost, totalRevenue } =
      req.body || {};
    if (!batchCode || String(batchCode).trim().length === 0)
      return res.status(400).json({ error: 'batchCode is required' });
    const netProfit =
      (Number(totalRevenue) || 0) -
      (Number(initialAnimalCost) || 0) -
      (Number(totalFeedCost) || 0) -
      (Number(totalMedCost) || 0) -
      (Number(totalUtilityCost) || 0);
    const batch = await prisma.batchFinancialLog.create({
      data: {
        batchCode: String(batchCode),
        livestockGroupId: livestockGroupId || null,
        initialAnimalCost: Number(initialAnimalCost) || 0,
        totalFeedCost: Number(totalFeedCost) || 0,
        totalMedCost: Number(totalMedCost) || 0,
        totalUtilityCost: Number(totalUtilityCost) || 0,
        totalRevenue: Number(totalRevenue) || 0,
        netProfit,
      },
    });
    res.json({ batch });
  } catch (err) {
    console.error('Livestock batch create error:', err);
    res.status(500).json({ error: 'Failed to create financial batch' });
  }
});

// PATCH /api/livestock/batches/:id — อัปเดต/ปิดงวด (closedAt เมื่อมี totalRevenue สุดท้าย)
router.patch('/batches/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const current = await prisma.batchFinancialLog.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'Batch not found' });
    const data: Record<string, unknown> = {};
    for (const k of ['initialAnimalCost', 'totalFeedCost', 'totalMedCost', 'totalUtilityCost', 'totalRevenue'] as const) {
      if (req.body[k] !== undefined) data[k] = Number(req.body[k]);
    }
    if (req.body.closedAt !== undefined) {
      const c = parseDate(req.body.closedAt);
      if (c === 'invalid') return res.status(400).json({ error: 'closedAt must be a valid date' });
      data.closedAt = c;
    }
    const netProfit =
      (Number(data.totalRevenue ?? current.totalRevenue) || 0) -
      (Number(data.initialAnimalCost ?? current.initialAnimalCost) || 0) -
      (Number(data.totalFeedCost ?? current.totalFeedCost) || 0) -
      (Number(data.totalMedCost ?? current.totalMedCost) || 0) -
      (Number(data.totalUtilityCost ?? current.totalUtilityCost) || 0);
    data.netProfit = netProfit;
    const batch = await prisma.batchFinancialLog.update({ where: { id: req.params.id }, data });
    res.json({ batch });
  } catch (err) {
    console.error('Livestock batch update error:', err);
    res.status(500).json({ error: 'Failed to update financial batch' });
  }
});

// GET /api/livestock/batches?livestockGroupId= — งบทั้งหมด
router.get('/batches', authenticate, async (req, res) => {
  try {
    const where: Record<string, unknown> = {};
    if (req.query.livestockGroupId) where.livestockGroupId = String(req.query.livestockGroupId);
    const batches = await prisma.batchFinancialLog.findMany({ where, orderBy: { created_at: 'desc' } });
    res.json({ batches });
  } catch (err) {
    console.error('Livestock batches list error:', err);
    res.status(500).json({ error: 'Failed to load financial batches' });
  }
});

export default router;
