// src/modules/coding/coding.routes.ts
// Coding Agent — พิมพ์ภาพรวมครั้งเดียว → AI วางแผน เขียนโค้ด ตรวจงาน เสนอทางต่อ (ทำงานเบื้องหลัง)
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  createCodingJob,
  listCodingJobs,
  deleteCodingJob,
  processCodingQueue,
  suggestNext,
} from '../../services/coding-agent.service';

const router = Router();

// POST /api/coding/jobs { task } — สั่งงานเขียนโค้ด (ตอบกลับทันที, รันเบื้องหลัง)
router.post('/jobs', authenticate, async (req, res) => {
  try {
    const { id } = await createCodingJob(String(req.body?.task ?? ''));
    // kick runner แบบไม่บล็อก (route ไม่รอผล)
    void processCodingQueue().catch((err) => console.error('coding queue kick error:', err));
    res.status(202).json({ success: true, id });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'สั่งงานเขียนโค้ดไม่สำเร็จ') });
  }
});

// GET /api/coding/jobs — รายการงานทั้งหมด (poll ได้)
router.get('/jobs', authenticate, async (_req, res) => {
  try {
    const jobs = await listCodingJobs();
    res.json({ jobs });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ดึงรายการงานไม่สำเร็จ') });
  }
});

// DELETE /api/coding/jobs/:id
router.delete('/jobs/:id', authenticate, async (req, res) => {
  try {
    await deleteCodingJob(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบงานไม่สำเร็จ') });
  }
});

// POST /api/coding/suggest { task, summary } — เสนอทางต่อ 2-4 ตัวเลือก
router.post('/suggest', authenticate, async (req, res) => {
  try {
    const opts = await suggestNext(String(req.body?.task ?? ''), String(req.body?.summary ?? ''));
    res.json({ suggestions: opts });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'สร้างข้อเสนอไม่สำเร็จ') });
  }
});

export default router;
