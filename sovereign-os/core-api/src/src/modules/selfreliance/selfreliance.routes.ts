import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  buildAutonomyOverview, getSettings, saveSettings,
  type SelfRelianceSettings,
} from '../../services/selfreliance.service';

const router = Router();
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

// GET /api/selfreliance/overview — วันรอดทุกทรัพยากร + จุดอ่อนของบ้าน
router.get('/overview', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string;
    const overview = await buildAutonomyOverview(userId);
    res.json(overview);
  } catch (err: any) {
    console.error('Self-reliance overview error:', err);
    res.status(500).json({ error: 'Failed to build autonomy overview' });
  }
});

// GET /api/selfreliance/settings — ค่าตั้งบ้านปัจจุบัน
router.get('/settings', authenticate, async (_req, res) => {
  res.json(await getSettings());
});

// PUT /api/selfreliance/settings — ตั้งค่าบ้าน { people, waterTankL, waterLPerPersonDay, foodKgPerPersonDay, targetDays }
router.put('/settings', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const patch: Partial<SelfRelianceSettings> = {};
    if (b.people != null) patch.people = Number(b.people);
    if (b.waterTankL != null) patch.waterTankL = Number(b.waterTankL);
    if (b.waterLPerPersonDay != null) patch.waterLPerPersonDay = Number(b.waterLPerPersonDay);
    if (b.foodKgPerPersonDay != null) patch.foodKgPerPersonDay = Number(b.foodKgPerPersonDay);
    if (b.targetDays != null) patch.targetDays = Number(b.targetDays);
    const saved = await saveSettings(patch);
    res.json(saved);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
