import { Router } from 'express';
import { aiAgent } from '../../services/AiAgentService';
import { appendExchange } from '../../services/chat-memory.service';
import { authenticate } from '../../middleware/auth.middleware';

// ────────────────────────────────────────────────────────────────────────────
// AI Chat — ย้ายมาจาก inline routes ใน server.ts
// POST /api/ai/chat — บันทึกประวัติสนทนา (Conversational Memory)
// + รองรับแนบรูปภาพ (base64 → vision model)
// หมายเหตุ: mount หลัง ai.routes.ts (policy/approvals) เสมอ
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

router.post('/chat', authenticate, async (req, res) => {
  const { message } = req.body;
  const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : undefined;
  // MBTI — client แนบโค้ด 4 ตัว (mbtiAi.ts) ให้ AI ปรับโทนตามบุคลิก (16 ประเภท)
  const mbti = typeof req.body?.mbti === 'string' ? req.body.mbti.slice(0, 4) : null;
  try {
    const reply = await aiAgent.processMessage(message, {
      actor: req.user?.id,
      source: 'chat',
      ip: req.ip,
    }, { imageBase64, mbti });
    if (req.user?.id && typeof message === 'string') {
      await appendExchange(req.user.id, imageBase64 ? `[รูปภาพ] ${message}` : message, reply);
    }
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'AI service unavailable' });
  }
});

export default router;
