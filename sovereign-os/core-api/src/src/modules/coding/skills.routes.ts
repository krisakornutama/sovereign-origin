// src/modules/coding/skills.routes.ts
// Skill Queue — คิวทักษะที่ผู้ใช้เพิ่มเอง + ระดับอัตโนมัติ
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/auth.middleware';
import {
  listSkills,
  addSkill,
  deleteSkill,
  runSkill,
  runSkillQueue,
} from '../../services/skill-queue.service';

const router = Router();

// GET /api/coding/skills — รายการทักษะในคิว
router.get('/skills', authenticate, async (_req, res) => {
  try {
    res.json({ skills: await listSkills() });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ดึงคิวทักษะไม่สำเร็จ') });
  }
});

// POST /api/coding/skills { title, content, autonomy, model, reasoningEffort } — เพิ่มทักษะ
router.post('/skills', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { id } = await addSkill(req.body);
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เพิ่มทักษะไม่สำเร็จ') });
  }
});

// POST /api/coding/skills/:id/run — รันทักษะเดียว
router.post('/skills/:id/run', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await runSkill(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'รันทักษะไม่สำเร็จ') });
  }
});

// POST /api/coding/skills/run-queue — รันคิวทั้งหมด (เรียงตามลำดับ)
router.post('/skills/run-queue', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  try {
    const { ran } = await runSkillQueue();
    res.json({ success: true, ran });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'รันคิวไม่สำเร็จ') });
  }
});

// DELETE /api/coding/skills/:id
router.delete('/skills/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await deleteSkill(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบทักษะไม่สำเร็จ') });
  }
});

export default router;