import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';

// ────────────────────────────────────────────────────────────────────────────
// Automation Alerts — ประวัติถาวรอยู่ข้าม restart — ย้ายมาจาก inline routes ใน server.ts
// GET /api/automation/alerts — คืน shape เดิม (ruleId …) เพื่อให้ frontend ทำงานได้ไม่ต้องแก้
// หมายเหตุ: mount หลัง automation.routes.ts เสมอ (route /alerts/stream อยู่ที่ตัวหลัก)
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

router.get('/alerts', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const alerts = await prisma.automationAlert.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    // คืน shape เดิม (ruleId …) เพื่อให้ frontend ทำงานได้ไม่ต้องแก้
    res.json(
      alerts.map((a) => ({
        ruleId: a.rule_id,
        metric: a.metric,
        value: a.value,
        threshold: a.threshold,
        message: a.message,
        severity: a.severity,
        timestamp: a.timestamp,
      }))
    );
  } catch (err) {
    console.error('Load alerts error:', err);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

export default router;
