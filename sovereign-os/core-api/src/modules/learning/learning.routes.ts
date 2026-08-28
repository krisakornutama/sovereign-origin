import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { collectDailySnapshots, getRecentSnapshots, backfillFromHistory } from '../../services/data-lake.service';
import { createPrediction, evaluatePrediction, getModelState, nightlyLearn } from '../../services/learning-engine.service';
import { prisma } from '../../lib/prisma';

const router = Router();

// GET /api/learning/snapshots?domain=sensor&limit=20
router.get('/snapshots', authenticate, async (req, res) => {
  const domain = req.query.domain ? String(req.query.domain) : undefined;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json(await getRecentSnapshots(domain, limit));
});

// POST /api/learning/collect — เก็บ snapshot รายวันทันที (SUPERADMIN หรือใครก็ได้ที่ login)
router.post('/collect', authenticate, async (_req, res) => {
  const n = await collectDailySnapshots();
  res.json({ snapshots: n });
});

// POST /api/learning/backfill {days:30}
router.post('/backfill', authenticate, async (req, res) => {
  const days = Math.min(Number(req.body?.days) || 30, 90);
  const n = await backfillFromHistory(days);
  res.json({ backfilled: n });
});

// POST /api/learning/predict {domain, features}
router.post('/predict', authenticate, async (req, res) => {
  const { domain, features } = req.body || {};
  if (!domain || !features) return res.status(400).json({ error: 'domain and features required' });
  const pred = await createPrediction(String(domain), features as any);
  res.status(201).json(pred);
});

// POST /api/learning/predictions/:id/evaluate {actual}
router.post('/predictions/:id/evaluate', authenticate, async (req, res) => {
  const { actual } = req.body || {};
  if (!actual) return res.status(400).json({ error: 'actual required' });
  await evaluatePrediction(req.params.id, actual as any);
  res.json({ success: true });
});

// GET /api/learning/predictions?domain=sensor&limit=20
router.get('/predictions', authenticate, async (req, res) => {
  const where: any = {};
  if (req.query.domain) where.domain = String(req.query.domain);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const list = await prisma.learningPrediction.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });
  res.json(list);
});

// GET /api/learning/predict/sensor — Engine A: trend 7วัน → พยากรณ์ 7วันข้างหน้า (ไม่ต้องส่ง features)
router.get('/predict/sensor', authenticate, async (_req, res) => {
  const { predictSensorTrends } = await import('../../services/learning-engine.service');
  res.json(await predictSensorTrends());
});
router.get('/predict/farm', authenticate, async (_req, res) => {
  const { predictFarmTrends } = await import('../../services/learning-engine.service');
  res.json(await predictFarmTrends());
});

// GET /api/learning/models — accuracy ต่อ domain
router.get('/models', authenticate, async (_req, res) => {
  res.json(await getModelState());
});
router.get('/models/:domain', authenticate, async (req, res) => {
  const m = await getModelState(req.params.domain);
  if (!m) return res.status(404).json({ error: 'not found' });
  res.json(m);
});

// POST /api/learning/nightly — รัน nightly loop ทันที (ทดสอบ)
router.post('/nightly', authenticate, async (_req, res) => {
  const r = await nightlyLearn();
  res.json(r);
});

export default router;
