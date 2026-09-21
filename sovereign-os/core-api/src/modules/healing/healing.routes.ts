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
    // MBTI — frontend (healing.tsx) ส่ง `mbti` มาให้หลวงพี่ปรับโทนตามบุคลิก (16 ประเภท)
    const mbti = typeof req.body?.mbti === 'string' ? req.body.mbti.slice(0, 4) : null;
    const result = await dhammaCompanion(message, mbti);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'AI ปลอบโยนไม่สำเร็จ') });
  }
});

// GET /api/healing/herbs — ฐานข้อมูลสมุนไพรไทย
router.get('/herbs', authenticate, (_req, res) => {
  res.json({ herbs: HERB_DB });
});

// GET /api/healing/herbs-unified — รวม HERB_DB + HERBAL_REMEDIES 12 ชนิด (SystemSetting หรือ hardcode)
router.get('/herbs-unified', authenticate, async (_req, res) => {
  try {
    // ลองอ่านจาก SystemSetting ก่อน (admin อาจตั้งค่า herbs.unified ไว้)
    try {
      const setting = await (db as any).systemSetting?.findUnique?.({ where: { key: 'herbs.unified' } });
      if (setting?.value) {
        const parsed = JSON.parse(setting.value);
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.herbs) ? parsed.herbs : null;
        if (arr && arr.length > 0) {
          return res.json({ herbs: arr.slice(0, 12), total: arr.length, source: 'systemSetting' });
        }
      }
    } catch {}
    // fallback: hardcode merge HERB_DB + HERBAL_REMEDIES (จาก health.routes.ts)
    const HERBAL_REMEDIES_FALLBACK: Array<{ herb: string; herbId: string; note: string }> = [
      { herb: 'กระเจี๊ยบแดง', herbId: 'hibiscus', note: 'ช่วยขับปัสสาวะและปรับสมดุลของเหลว เตือนให้ดื่มน้ำให้เพียงพอระหว่างวัน' },
      { herb: 'ดอกคำฝอย', herbId: 'safflower', note: 'ช่วยผ่อนคลายและส่งเสริมการนอนหลับ ควรดื่มก่อนนอน 1 ชั่วโมง' },
      { herb: 'ขิง', herbId: 'ginger', note: 'ช่วยเจริญอาหารและกระตุ้นการย่อยอาหาร ใช้ในปริมาณพอเหมาะ' },
      { herb: 'บัวบก', herbId: 'gotu-kola', note: 'ช่วยฟื้นฟูความอ่อนเพลียและเพิ่มความสดชื่น ควรพักผ่อนให้เพียงพอร่วมด้วย' },
      { herb: 'ฟ้าทะลายโจร', herbId: 'andrographis', note: 'ช่วยบรรเทาอาการไข้หวัด ใช้เฉพาะเมื่อมีอาการ และไม่ควรใช้ติดต่อกันเกิน 5 วัน' },
      { herb: 'ขมิ้นชัน', herbId: 'turmeric', note: 'ช่วยลดท้องอืดและอาการไม่ย่อย ใช้ครั้งละเล็กน้อย' },
      { herb: 'มะขามป้อม', herbId: 'amla', note: 'ช่วยปรับอารมณ์และลดความเครียด ควรหาเวลาพักผ่อนและพูดคุยกับคนใกล้ชิด' },
    ];
    const merged: typeof HERB_DB = [...HERB_DB];
    for (const r of HERBAL_REMEDIES_FALLBACK) {
      if (!merged.some((h) => h.name === r.herb)) {
        merged.push({ name: r.herb, uses: [r.note], warnings: [], interactions: [] });
      }
    }
    const unified = merged.slice(0, 12);
    res.json({ herbs: unified, total: unified.length, source: 'merged' });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'ดึงข้อมูลสมุนไพรรวมไม่สำเร็จ') });
  }
});

// POST /api/healing/herbs/check { herb, meds[] } — ตรวจสมุนไพรกับยาที่ทาน (auto-merge HealthProfile)
router.post('/herbs/check', authenticate, async (req, res) => {
  try {
    const herb = String(req.body?.herb ?? '').trim();
    if (!herb) return res.status(400).json({ error: 'herb is required' });
    let meds = Array.isArray(req.body?.meds) ? req.body.meds.map((m: any) => String(m)) : [];
    // auto-merge HealthProfile medications/conditions
    try {
      const profile = await (db as any).healthProfile.findFirst();
      if (profile) {
        const pMeds = Array.isArray(profile.medications) ? (profile.medications as string[]) : [];
        const pConds = Array.isArray(profile.conditions) ? (profile.conditions as string[]) : [];
        const merged = [...meds, ...pMeds, ...pConds].map((s) => String(s).trim()).filter(Boolean);
        meds = [...new Set(merged)];
      }
    } catch {}
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
