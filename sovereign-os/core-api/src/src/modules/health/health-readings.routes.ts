import { Router } from 'express';
import { HealthReadingType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';
import {
  analyzeReadings,
  validateReading,
  READING_TYPES,
  type ReadingType,
} from '../../services/health-readings.service';

const router = Router();
export { prisma };

function asType(value: unknown): ReadingType | null {
  const s = String(value ?? '').toUpperCase();
  return READING_TYPES.includes(s as ReadingType) ? (s as ReadingType) : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

// GET /api/health/readings?type=&limit=&analyze=true — ค่าล่าสุด + AI วิเคราะห์แนวโน้ม
router.get('/', authenticate, async (req, res) => {
  try {
    if (req.query.type && !asType(req.query.type)) {
      return res.status(400).json({ error: `type must be one of: ${READING_TYPES.join(', ')}` });
    }
    const wanted = req.query.type ? asType(req.query.type) : null;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const analyze = (req.query.analyze ?? 'true') !== 'false';

    const where = wanted ? { type: wanted as HealthReadingType } : {};
    const [rows, recent] = await Promise.all([
      prisma.healthReading.findMany({ where, orderBy: { measured_at: 'desc' }, take: limit }),
      analyze ? prisma.healthReading.findMany({ where, orderBy: { measured_at: 'desc' }, take: 200 }) : Promise.resolve([] as any[]),
    ]);

    const analysis: Record<string, unknown> = {};
    if (analyze) {
      const byType = new Map<string, any[]>();
      for (const r of recent) {
        const key = String(r.type);
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key)!.push({ value: r.value, systolic: r.systolic, diastolic: r.diastolic, measured_at: r.measured_at, note: r.note });
      }
      for (const [key, rowsForType] of byType) {
        analysis[key] = analyzeReadings(rowsForType, key as ReadingType);
      }
    }

    res.json({ rows, analysis });
  } catch (err) {
    console.error('Health readings error:', err);
    res.status(500).json({ error: 'Failed to load health readings' });
  }
});

// POST /api/health/readings — บันทึกค่าที่วัดด้วยมือ
router.post('/', authenticate, async (req, res) => {
  try {
    const { type, value, systolic, diastolic, note, measured_at } = req.body || {};
    const t = asType(type);
    if (!t) return res.status(400).json({ error: `type must be one of: ${READING_TYPES.join(', ')}` });

    const invalid = validateReading(t, value, systolic, diastolic);
    if (invalid) return res.status(400).json({ error: invalid });

    const reading = await prisma.healthReading.create({
      data: {
        type: t as HealthReadingType,
        value: Number(value),
        systolic: t === 'BP' ? Number(systolic) : null,
        diastolic: t === 'BP' ? Number(diastolic) : null,
        note: typeof note === 'string' ? note.slice(0, 500) : null,
        measured_at: toDate(measured_at) ?? new Date(),
      },
    });
    res.status(201).json({ success: true, id: reading.id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save reading' });
  }
});

// DELETE /api/health/readings/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await prisma.healthReading.deleteMany({ where: { id: req.params.id } });
    if (result.count === 0) return res.status(404).json({ error: 'Reading not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete reading' });
  }
});

export default router;