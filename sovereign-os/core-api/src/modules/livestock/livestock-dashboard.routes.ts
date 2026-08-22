// livestock-dashboard.routes.ts — Dashboard สรุปรวม — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';
import { ROS } from './livestock-shared';

const router = Router();

// ═══════════ Dashboard สรุปรวม ═══════════

// GET /api/livestock/dashboard — ตัวเลขรวม: กลุ่ม/ควอรันไทน์/ยาค้าง/ถังต่ำ/THI ล่าสุด/โต๊ะบัญชี
router.get('/dashboard', authenticate, async (_req, res) => {
  try {
    const [groups, silos, batches] = await Promise.all([
      prisma.livestockGroup.findMany({ include: { records: true, dailyLogs: true } }),
      prisma.feedSilo.findMany(),
      prisma.batchFinancialLog.findMany(),
    ]);

    let locked = 0;
    let quarantine = 0;
    let harvested = 0;
    for (const g of groups) {
      if (g.status === 'QUARANTINE') quarantine++;
      if (g.status === 'HARVESTED') harvested++;
      const latest = g.records.reduce((mx, m) => Math.max(mx, new Date(m.safeHarvestDate).getTime()), 0);
      if (latest > Date.now()) locked++;
    }
    const lowSilos = silos.filter((s) => s.capacityKg > 0 && s.currentKg / s.capacityKg < 0.15).length;
    const totalRevenue = batches.reduce((s, b) => s + b.totalRevenue, 0);
    const totalCost = batches.reduce((s, b) => s + b.initialAnimalCost + b.totalFeedCost + b.totalMedCost + b.totalUtilityCost, 0);
    let latestClimate: any = null;
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT thi, status, at FROM livestock_climate_logs ORDER BY at DESC LIMIT 1`
      );
      if (rows[0]) {
        latestClimate = {
          thi: rows[0].thi,
          status: rows[0].status,
          at: new Date(rows[0].at).toISOString(),
        };
      }
    } catch (dbErr) {
      console.error('Livestock dashboard climate error:', dbErr);
    }

    res.json({
      summary: {
        groups: groups.length,
        quarantine,
        harvested,
        lockedWithdrawal: locked,
        silos: silos.length,
        lowSilos,
        revenue: +totalRevenue.toFixed(2),
        cost: +totalCost.toFixed(2),
        netProfit: +(totalRevenue - totalCost).toFixed(2),
        latestThi: latestClimate?.thi ?? null,
        latestClimate,
      },
      regimes: [
        { code: 'POULTRY_BROILER', label: 'ไก่เนื้อ' },
        { code: 'POULTRY_LAYER', label: 'ไก่ไข่' },
        { code: 'DUCK', label: 'เป็ด' },
        { code: 'SWINE', label: 'สุกร' },
        { code: 'CATTLE', label: 'โค' },
      ],
      standards: ROS,
    });
  } catch (err) {
    console.error('Livestock dashboard error:', err);
    res.status(500).json({ error: 'Failed to load livestock dashboard' });
  }
});

export default router;
