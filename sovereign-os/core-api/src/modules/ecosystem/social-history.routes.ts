// src/modules/ecosystem/social-history.routes.ts
//
// ── ประวัติการโพสต์ของ Social Studio ────────────────────────────────────────
// ทุก endpoint ต้องล็อกอิน และเห็นเฉพาะโพสต์ของตัวเอง (user_id จาก token)
//   GET    /posts                              ประวัติล่าสุด (limit สูงสุด 50)
//   POST   /posts                              บันทึกงานโพสต์/ลงคลิป + ปลายทาง
//   PATCH  /posts/:id/targets/:platform        อัปเดตสถานะปลายทาง (pending/posted/skipped)
//   DELETE /posts/:id                          ลบโพสต์ของตัวเอง
//
// Express 4: async handler ที่ throw จะค้างไม่ตอบ ⇒ ทุก handler มี try/catch เอง
import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { EcosystemError } from '../../services/ecosystem.service';
import {
  createSocialPost,
  deleteSocialPost,
  listSocialPosts,
  updateSocialPostTarget,
} from '../../services/social-history.service';

const router = Router();

function fail(res: Response, err: unknown, where: string) {
  if (err instanceof EcosystemError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  console.error(`${where} error:`, err instanceof Error ? err.message : err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบประวัติการโพสต์' });
}

// GET /api/ecosystem/social/posts?limit=20
router.get('/posts', authenticate, async (req: Request, res: Response) => {
  try {
    const posts = await listSocialPosts(req.user!.id, Number(req.query.limit) || 20);
    // ห้าม cache: เนื้อหาที่ผู้ใช้เขียนเอง — เครื่องที่ใช้ร่วมกันต้องไม่เห็นของคนก่อน
    res.setHeader('Cache-Control', 'no-store');
    res.json({ posts });
  } catch (err) {
    fail(res, err, 'GET /api/ecosystem/social/posts');
  }
});

// POST /api/ecosystem/social/posts
router.post('/posts', authenticate, async (req: Request, res: Response) => {
  try {
    const post = await createSocialPost(req.user!.id, req.body || {});
    res.status(201).json({ post });
  } catch (err) {
    fail(res, err, 'POST /api/ecosystem/social/posts');
  }
});

// PATCH /api/ecosystem/social/posts/:id/targets/:platform
router.patch('/posts/:id/targets/:platform', authenticate, async (req: Request, res: Response) => {
  try {
    const post = await updateSocialPostTarget(
      req.user!.id,
      String(req.params.id || ''),
      String(req.params.platform || ''),
      req.body || {},
    );
    res.json({ post });
  } catch (err) {
    fail(res, err, 'PATCH /api/ecosystem/social/posts/:id/targets/:platform');
  }
});

// DELETE /api/ecosystem/social/posts/:id
router.delete('/posts/:id', authenticate, async (req: Request, res: Response) => {
  try {
    await deleteSocialPost(req.user!.id, String(req.params.id || ''));
    res.json({ success: true });
  } catch (err) {
    fail(res, err, 'DELETE /api/ecosystem/social/posts/:id');
  }
});

export default router;
