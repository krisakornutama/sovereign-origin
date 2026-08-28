// livestock-breeding.routes.ts — เสา 4: Reproductive & Breeding Cycle — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { computeHatchability } from '../../services/livestock-vet-ai.service';
import { WRITE_ROLES, DAY_MS, BREED_STATUSES, parseDate } from './livestock-shared';

const router = Router();

// ═══════════ เสา 4: Reproductive & Breeding Cycle ═══════════

// POST /api/livestock/groups/:id/breeding — บันทึกผสมเทียม/กกไข่
router.post('/groups/:id/breeding', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { inseminatedAt, expectedBirthAt, eggSetCount } = req.body || {};
    const ins = parseDate(inseminatedAt);
    if (ins === 'invalid') return res.status(400).json({ error: 'inseminatedAt must be a valid date' });
    const rec = await prisma.breedingRecord.create({
      data: {
        livestockGroupId: req.params.id,
        inseminatedAt: ins ?? new Date(),
        expectedBirthAt: (() => {
          const e = parseDate(expectedBirthAt);
          if (e === 'invalid') throw new Error('bad date');
          return e ?? new Date((ins ?? new Date()).getTime() + 21 * DAY_MS);
        })(),
        eggSetCount: eggSetCount === undefined || eggSetCount === '' ? null : Number(eggSetCount),
      },
    });
    res.json({ record: rec });
  } catch (err) {
    console.error('Livestock breeding create error:', err);
    res.status(500).json({ error: 'Failed to create breeding record' });
  }
});

// PATCH /api/livestock/breeding/:id — อัปเดตผล (คลอด/ฟัก/แท้ง) → hatchability
router.patch('/breeding/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { actualBirthAt, litterSize, hatchedCount, status } = req.body || {};
    const data: Record<string, unknown> = {};
    const birth = parseDate(actualBirthAt);
    if (birth === 'invalid') return res.status(400).json({ error: 'actualBirthAt must be a valid date' });
    if (birth) data.actualBirthAt = birth;
    if (litterSize !== undefined) data.litterSize = Number(litterSize);
    if (hatchedCount !== undefined) data.hatchedCount = Number(hatchedCount);
    if (status !== undefined) {
      if (!BREED_STATUSES.includes(String(status)))
        return res.status(400).json({ error: `Invalid status — ใช้ได้: ${BREED_STATUSES.join(', ')}` });
      data.status = String(status);
    }
    const rec = await prisma.breedingRecord.update({ where: { id: req.params.id }, data });
    res.json({
      record: rec,
      hatchabilityPct: computeHatchability(rec.hatchedCount, rec.eggSetCount),
    });
  } catch (err) {
    console.error('Livestock breeding update error:', err);
    res.status(500).json({ error: 'Failed to update breeding record' });
  }
});

export default router;
