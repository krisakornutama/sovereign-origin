import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  prisma,
  listKnownFaces,
  addKnownFace,
  deleteKnownFace,
  getVisionRule,
  updateVisionRule,
  runVisionCheck,
} from '../../services/vision-rule.service';

const router = Router();

// ── ใบหน้าที่คุ้นเคย ──
router.get('/known-faces', authenticate, async (_req, res) => {
  try {
    const faces = await listKnownFaces();
    res.json({ success: true, faces });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'โหลดใบหน้าไม่สำเร็จ') });
  }
});

// POST /api/vision/known-faces { name, photoUrl?, photoData?, dhash?, note? } — ลงทะเบียนคนคุ้นเคย
router.post('/known-faces', authenticate, async (req, res) => {
  try {
    const { name, photoUrl, photoData, dhash, note } = req.body || {};
    const item = await addKnownFace({ name, photo_url: photoUrl, photo_data: photoData, dhash, note });
    res.status(201).json({ success: true, ...item, face: item });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เพิ่มใบหน้าไม่สำเร็จ') });
  }
});

// DELETE /api/vision/known-faces/:id — ลบคนคุ้นเคย
router.delete('/known-faces/:id', authenticate, async (req, res) => {
  try {
    await deleteKnownFace(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบใบหน้าไม่สำเร็จ') });
  }
});

// ── กฎการเฝ้าระวัง ──
router.get('/rule', authenticate, async (_req, res) => {
  try {
    const rule = await getVisionRule();
    res.json({ success: true, rule });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'โหลดกฎไม่สำเร็จ') });
  }
});

// PUT /api/vision/rule { enabled?, interval_min?, notify_telegram?, confidence_min?, only_strangers? }
router.put('/rule', authenticate, async (req, res) => {
  try {
    const rule = await updateVisionRule(req.body || {});
    res.json({ success: true, rule });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ตั้งกฎไม่สำเร็จ') });
  }
});

// POST /api/vision/check { photoUrl? } — ตรวจด้วยมือ (หรือ worker ใช้ภาพล่าสุด)
router.post('/check', authenticate, async (req, res) => {
  try {
    const result = await runVisionCheck({ photo: (req.body || {}).photoUrl });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'ตรวจภาพไม่สำเร็จ') });
  }
});

// ── ประวัติแจ้งเตือน ──
router.get('/alerts', authenticate, async (_req, res) => {
  try {
    const alerts = await prisma.visionAlert.findMany({ orderBy: { created_at: 'desc' }, take: 100 });
    res.json({ success: true, alerts });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'โหลดประวัติไม่สำเร็จ') });
  }
});

// POST /api/vision/alerts/:id/clear — ทำเครื่องหมายว่าจัดการแล้ว
router.post('/alerts/:id/clear', authenticate, async (req, res) => {
  try {
    await prisma.visionAlert.update({ where: { id: req.params.id }, data: { cleared: true } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'อัปเดตไม่สำเร็จ') });
  }
});

export default router;
