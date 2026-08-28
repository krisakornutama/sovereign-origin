import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// ────────────────────────────────────────────────────────────────────────────
// Audit log viewer (SUPERADMIN only) — ย้ายมาจาก inline routes ใน server.ts
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

router.get('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { user: { select: { username: true } } },
    });
    res.json(logs);
  } catch (err) {
    console.error('Audit API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
