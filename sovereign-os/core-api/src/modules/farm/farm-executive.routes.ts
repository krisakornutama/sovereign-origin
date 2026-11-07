// farm-executive.routes.ts — ภาพรวมฟาร์มสำหรับผู้บริหาร
// แยกไฟล์เพราะ farm.routes ถูก mount ที่ /api/farm/plots (แปลงพืช) แต่หน้านี้ใช้ /api/farm/executive
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';
import { buildFarmExecutive } from '../../services/farm-executive.service';

const router = Router();
const DAY_MS = 86_400_000;

// GET /api/farm/executive — ภาพรวมสำหรับผู้บริหาร: KPI ฟาร์ม + ปศุสัตว์ + ความเสี่ยงที่ต้องตัดสินใจวันนี้
// รวมข้อมูลจากหลายโมดูลในคำขอเดียว (หน้า /farm-executive เรียกครั้งเดียว)
router.get('/', authenticate, async (_req, res) => {
  try {
    const now = new Date();
    const [plots, groups, silos] = await Promise.all([
      prisma.farmPlot.findMany(),
      prisma.livestockGroup.findMany({ include: { records: true, schedules: true, dailyLogs: true } }),
      prisma.feedSilo.findMany(),
    ]);

    // THI ล่าสุด — ตาราง climate เป็น hypertable ที่อ่านผ่าน SQL (เหมือน livestock dashboard)
    let climate: { thi: number; status: string } | null = null;
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT thi, status FROM livestock_climate_logs ORDER BY at DESC LIMIT 1`
      );
      if (rows[0]) climate = { thi: Number(rows[0].thi), status: String(rows[0].status) };
    } catch (dbErr) {
      console.error('Farm executive climate error:', dbErr);
    }

    const result = buildFarmExecutive({
      now,
      plots: plots.map((p) => ({
        id: p.id,
        name: p.name,
        crop: p.crop ?? null,
        status: String(p.status),
        expectedHarvestAt: p.expected_harvest_at ? new Date(p.expected_harvest_at) : null,
      })),
      groups: groups.map((g) => {
        const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(g.birthDate).getTime()) / DAY_MS));
        const since = now.getTime() - 7 * DAY_MS;
        const mortality7d = g.dailyLogs
          .filter((l) => new Date(l.logDate).getTime() >= since)
          .reduce((sum, l) => sum + Number(l.mortalityCount ?? 0), 0);
        return {
          id: g.id,
          code: g.code,
          species: g.species,
          quantity: g.quantity,
          status: String(g.status),
          ageDays,
          quarantineEndAt: g.quarantineEndAt ? new Date(g.quarantineEndAt) : null,
          medical: g.records.map((r) => ({ drugName: r.drugName, safeHarvestAt: new Date(r.safeHarvestDate) })),
          vaccines: g.schedules.map((s) => ({
            vaccineName: s.vaccineName,
            targetAgeDays: s.targetAgeDays,
            completed: Boolean(s.isCompleted),
          })),
          mortality7d,
        };
      }),
      silos: silos.map((s) => ({ siloCode: s.siloCode, capacityKg: s.capacityKg, currentKg: s.currentKg })),
      climate,
    });

    res.set('Cache-Control', 'private, no-store');
    res.json(result);
  } catch (err) {
    console.error('Farm executive error:', err);
    res.status(500).json({ error: 'Failed to build farm executive overview' });
  }
});

export default router;
