import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router = Router();
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

// GET /api/skill-matrix/summary — aggregate by skill, avg level, count
// Must be before /:id route
router.get('/summary', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string;
    const role = (req as any).user?.role as string;
    const isSuperadmin = role === 'SUPERADMIN';
    const where: Record<string, unknown> = isSuperadmin && typeof req.query.user_id === 'string' && req.query.user_id.trim()
      ? { user_id: String(req.query.user_id).trim() }
      : isSuperadmin && !req.query.user_id
        ? {}
        : { user_id: userId };

    const rows: Array<{ skill: string; level: number }> = await prisma.skillMatrix.findMany({
      where,
      select: { skill: true, level: true },
    });

    const map = new Map<string, { total: number; count: number }>();
    for (const r of rows) {
      const cur = map.get(r.skill) ?? { total: 0, count: 0 };
      cur.total += r.level;
      cur.count += 1;
      map.set(r.skill, cur);
    }
    const bySkill = Array.from(map.entries()).map(([skill, v]) => ({
      skill,
      avgLevel: Math.round((v.total / v.count) * 10) / 10,
      count: v.count,
    })).sort((a, b) => a.skill.localeCompare(b.skill));

    const total = rows.length;
    const avgLevel = total ? Math.round((rows.reduce((s, r) => s + r.level, 0) / total) * 10) / 10 : 0;
    const lowSkills = rows.filter((r) => r.level < 3).length;

    res.json({ bySkill, total, avgLevel, lowSkills });
  } catch (err) {
    console.error('SkillMatrix summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// GET /api/skill-matrix — list all for current user (filter by user_id if not SUPERADMIN)
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string;
    const role = (req as any).user?.role as string;
    const isSuperadmin = role === 'SUPERADMIN';
    const where: Record<string, unknown> = isSuperadmin && typeof req.query.user_id === 'string' && req.query.user_id.trim()
      ? { user_id: String(req.query.user_id).trim() }
      : isSuperadmin && !req.query.user_id
        ? {}
        : { user_id: userId };

    const items = await prisma.skillMatrix.findMany({
      where,
      orderBy: [{ skill: 'asc' }],
    });
    res.json({ items });
  } catch (err) {
    console.error('SkillMatrix list error:', err);
    res.status(500).json({ error: 'Failed to load skill matrix' });
  }
});

// POST /api/skill-matrix {skill, level 1-5, note} — create or update (upsert by user_id+skill)
router.post('/', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const userId = (req as any).user?.id as string;
    const { skill, level, note } = req.body || {};
    if (!skill || String(skill).trim().length === 0) {
      return res.status(400).json({ error: 'skill is required' });
    }
    const lvl = Number(level);
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 5) {
      return res.status(400).json({ error: 'level must be 1-5' });
    }
    const skillName = String(skill).trim();
    const item = await prisma.skillMatrix.upsert({
      where: { user_id_skill: { user_id: userId, skill: skillName } },
      update: { level: lvl, note: note != null ? String(note) : undefined },
      create: { user_id: userId, skill: skillName, level: lvl, note: note != null ? String(note) : null },
    });
    res.status(201).json({ success: true, item });
  } catch (err) {
    console.error('SkillMatrix upsert error:', err);
    res.status(500).json({ error: 'Failed to save skill' });
  }
});

// PUT /api/skill-matrix/:id {level, note}
router.put('/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const userId = (req as any).user?.id as string;
    const role = (req as any).user?.role as string;
    const isSuperadmin = role === 'SUPERADMIN';
    const { id } = req.params;
    const existing = await prisma.skillMatrix.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!isSuperadmin && existing.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });

    const data: Record<string, unknown> = {};
    if ('level' in (req.body || {})) {
      const lvl = Number(req.body.level);
      if (!Number.isInteger(lvl) || lvl < 1 || lvl > 5) return res.status(400).json({ error: 'level must be 1-5' });
      data.level = lvl;
    }
    if ('note' in (req.body || {})) {
      data.note = req.body.note == null || req.body.note === '' ? null : String(req.body.note);
    }
    if ('skill' in (req.body || {})) {
      const s = String(req.body.skill).trim();
      if (!s) return res.status(400).json({ error: 'skill cannot be empty' });
      // prevent duplicate skill for same user
      const dup = await prisma.skillMatrix.findUnique({ where: { user_id_skill: { user_id: existing.user_id!, skill: s } } });
      if (dup && dup.id !== id) return res.status(409).json({ error: 'skill already exists for this user' });
      data.skill = s;
    }
    const updated = await prisma.skillMatrix.update({ where: { id }, data });
    res.json({ success: true, item: updated });
  } catch (err) {
    console.error('SkillMatrix update error:', err);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

// DELETE /api/skill-matrix/:id
router.delete('/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const userId = (req as any).user?.id as string;
    const role = (req as any).user?.role as string;
    const isSuperadmin = role === 'SUPERADMIN';
    const { id } = req.params;
    const existing = await prisma.skillMatrix.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!isSuperadmin && existing.user_id !== userId) return res.status(403).json({ error: 'Forbidden' });
    await prisma.skillMatrix.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('SkillMatrix delete error:', err);
    res.status(500).json({ error: 'Failed to delete skill' });
  }
});

export default router;
