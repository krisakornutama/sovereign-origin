import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// ────────────────────────────────────────────────────────────────────────────
// Audit log viewer (SUPERADMIN only) — ย้ายมาจาก inline routes ใน server.ts
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

router.get('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    // q ค้นทั้ง action_type/payload, actionPrefix กรองตามคำนำหน้า (เช่น USER_PASSWORD)
    const q = ((req.query.q as string) || '').trim();
    const actionPrefix = ((req.query.actionPrefix as string) || '').trim();
    const where: Prisma.AuditLogWhereInput = {};
    if (q) {
      // payload เป็น JSONB (Prisma filter ยังครอบไม่หมด) → ค้นด้วย ILIKE บน text dump ตรง ๆ
      const hits = await prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "audit_logs" WHERE action_type ILIKE ${`%${q}%`} OR payload::text ILIKE ${`%${q}%`}`,
      );
      where.id = { in: hits.map((h) => h.id) };
    }
    if (actionPrefix) where.action_type = { startsWith: actionPrefix };
    const logs = await prisma.auditLog.findMany({
      where,
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
