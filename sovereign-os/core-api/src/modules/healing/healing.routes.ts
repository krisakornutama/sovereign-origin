// src/modules/healing/healing.routes.ts
// Sovereign Buddhist Healing Module — ธรรมะบำบัดใจ + สมุนไพรคู่ยา + สมาธิ + ติดตามผล
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { prisma as db } from '../../services/buddhist-healing.service';
import {
  HERB_DB,
  checkHerbWithMeds,
  computeHealingProgress,
  dhammaCompanion,
  logMeditationSession,
  logHealingMetric,
} from '../../services/buddhist-healing.service';

const router = Router();

// GET /api/healing/teachings — รายการพุทธวจนะในฐาน
router.get('/teachings', authenticate, async (_req, res) => {
  try {
    const items = await db.buddhistTeaching.findMany({ orderBy: { category: 'asc' } });
    res.json({ teachings: items });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ดึงข้อมูลหลักธรรมไม่สำเร็จ') });
  }
});

// POST /api/healing/companion { message } — AI ปลอบโยนด้วยพุทธวจนะ
router.post('/companion', authenticate, async (req, res) => {
  try {
    const message = String(req.body?.message ?? '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: 'message is required' });
    const result = await dhammaCompanion(message);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'AI ปลอบโยนไม่สำเร็จ') });
  }
});

// GET /api/healing/herbs — ฐานข้อมูลสมุนไพรไทย
router.get('/herbs', authenticate, (_req, res) => {
  res.json({ herbs: HERB_DB });
});

// POST /api/healing/herbs/check { herb, meds[] } — ตรวจสมุนไพรกับยาที่ทาน
router.post('/herbs/check', authenticate, (req, res) => {
  try {
    const herb = String(req.body?.herb ?? '').trim();
    const meds = Array.isArray(req.body?.meds) ? req.body.meds.map((m: any) => String(m)) : [];
    if (!herb) return res.status(400).json({ error: 'herb is required' });
    res.json(checkHerbWithMeds(herb, meds));
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ตรวจสมุนไพรไม่สำเร็จ') });
  }
});

// POST /api/healing/meditation { type, duration_min, note } — บันทึกสมาธิ
router.post('/meditation', authenticate, async (req, res) => {
  try {
    const item = await logMeditationSession({
      type: req.body?.type,
      duration_min: Number(req.body?.duration_min) || 5,
      note: req.body?.note,
    });
    res.status(201).json({ success: true, session: item });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'บันทึกสมาธิไม่สำเร็จ') });
  }
});

// POST /api/healing/log { metric, value, note } — บันทึกตัววัด (stress/สมาธิ/นอน/HRV/WBC)
router.post('/log', authenticate, async (req, res) => {
  try {
    const metric = String(req.body?.metric ?? '').trim();
    if (!metric) return res.status(400).json({ error: 'metric is required' });
    const item = await logHealingMetric({ metric, value: Number(req.body?.value) || 0, note: req.body?.note });
    res.status(201).json({ success: true, log: item });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'บันทึกตัววัดไม่สำเร็จ') });
  }
});

// GET /api/healing/progress?days=60 — ความคืบหน้า (ก่อน vs หลัง)
router.get('/progress', authenticate, async (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 60));
    const since = new Date(Date.now() - days * 86400000);
    const logs = await db.healingLog.findMany({ where: { logged_at: { gte: since } }, orderBy: { logged_at: 'asc' } });
    const progress = computeHealingProgress(logs);
    const meditation = await db.meditationSession.aggregate({
      _sum: { duration_min: true },
      _count: true,
      where: { started_at: { gte: since } },
    });
    res.json({ progress, meditation: { total_min: meditation._sum.duration_min ?? 0, sessions: meditation._count }, days });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'คำนวณความคืบหน้าไม่สำเร็จ') });
  }
});

export default router;
