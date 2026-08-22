import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';
import { config } from '../../config';

// ────────────────────────────────────────────────────────────────────────────
// Dashboard + modules — ย้ายมาจาก inline routes ใน server.ts
// GET /api/modules          รายชื่อโมดูลที่เปิด (UI ใช้ซ่อนเมนู)
// GET /api/dashboard/stats  metric ล่าสุดของ node ผู้ใช้
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

// GET /api/modules — รายชื่อโมดูลที่เปิดใช้งาน (ฝั่ง UI ใช้ซ่อนเมนูที่ไม่เปิด)
router.get('/modules', (_req, res) => {
  res.json({
    available: config.modules.available,
    enabled: config.modules.available.filter((m) => config.modules.isEnabled(m)),
  });
});

// Dashboard stats
router.get('/dashboard/stats', authenticate, async (req, res) => {
  try {
    const nodeId = req.user?.assigned_node_id || config.defaults.telemetryNodeId;
    const result = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT ON (metric) metric, value
       FROM sensor_telemetry
       WHERE node_id = $1::uuid
       ORDER BY metric, time DESC`,
      nodeId
    );
    const metrics: Record<string, number> = {};
    for (const row of result) {
      metrics[row.metric] = row.value;
    }
    res.json({ metrics });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    // Never return fabricated data – report the error so the UI can show
    // "no data" instead of presenting fake readings as real.
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

export default router;
