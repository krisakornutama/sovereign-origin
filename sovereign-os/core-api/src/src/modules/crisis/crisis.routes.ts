import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router = Router();

const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'] as const;

const VALID_MODES = ['flood', 'blackout', 'security'] as const;
type CrisisModeKey = (typeof VALID_MODES)[number];

const DEFAULT_ACTIONS: Record<CrisisModeKey, string[]> = {
  flood: ['ปิดรีเลย์ non-critical', 'สำรองข้อมูล', 'DEFCON 2'],
  blackout: ['ปิดรีเลย์ non-critical', 'ประหยัดไฟ', 'สำรองข้อมูล'],
  security: ['DEFCON 1', 'ล็อกประตู', 'เปิดกล้อง'],
};

function isValidMode(mode: string): mode is CrisisModeKey {
  return (VALID_MODES as readonly string[]).includes(mode);
}

// GET /api/crisis/modes — list all CrisisMode (id, mode, active, actions, activatedAt)
router.get('/modes', authenticate, async (_req, res) => {
  try {
    const modes = await prisma.crisisMode.findMany({
      orderBy: { mode: 'asc' },
      select: { id: true, mode: true, active: true, actions: true, activatedAt: true },
    });
    res.json({ modes });
  } catch (err) {
    console.error('Crisis list error:', err);
    res.status(500).json({ error: 'Failed to list crisis modes' });
  }
});

// GET /api/crisis/modes/:mode — get one
router.get('/modes/:mode', authenticate, async (req, res) => {
  try {
    const { mode } = req.params;
    if (!isValidMode(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Valid: flood, blackout, security' });
    }
    const item = await prisma.crisisMode.findUnique({ where: { mode } });
    if (!item) return res.status(404).json({ error: 'Mode not found' });
    res.json(item);
  } catch (err) {
    console.error('Crisis get error:', err);
    res.status(500).json({ error: 'Failed to get crisis mode' });
  }
});

// POST /api/crisis/modes/:mode/activate — set active=true, actions = default actions for mode, activatedAt now, deactivate others (only one active at a time)
router.post('/modes/:mode/activate', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { mode } = req.params;
    if (!isValidMode(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Valid: flood, blackout, security' });
    }
    const actions = DEFAULT_ACTIONS[mode];
    const now = new Date();

    // Deactivate others first — only one active at a time
    await prisma.crisisMode.updateMany({
      where: { mode: { not: mode } },
      data: { active: false },
    });

    const updated = await prisma.crisisMode.upsert({
      where: { mode },
      update: { active: true, actions, activatedAt: now },
      create: { mode, active: true, actions, activatedAt: now },
    });

    res.json(updated);
  } catch (err) {
    console.error('Crisis activate error:', err);
    res.status(500).json({ error: 'Failed to activate crisis mode' });
  }
});

// POST /api/crisis/modes/:mode/deactivate — set active=false
router.post('/modes/:mode/deactivate', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { mode } = req.params;
    if (!isValidMode(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Valid: flood, blackout, security' });
    }
    const existing = await prisma.crisisMode.findUnique({ where: { mode } });
    if (!existing) return res.status(404).json({ error: 'Mode not found' });

    const updated = await prisma.crisisMode.update({
      where: { mode },
      data: { active: false },
    });
    res.json(updated);
  } catch (err) {
    console.error('Crisis deactivate error:', err);
    res.status(500).json({ error: 'Failed to deactivate crisis mode' });
  }
});

export default router;
