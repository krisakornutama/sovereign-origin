// livestock-vision.routes.ts — Multimodal Vision Ingestion — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { parseLivestockVisionResponse, LIVESTOCK_VISION_PROMPT } from '../../services/livestock-vet-ai.service';
import { callVision, VISION_ENABLED, VISION_MODEL } from '../../services/vision.service';
import { getModelForTask } from '../../services/ai-router.service';
import { WRITE_ROLES, notify } from './livestock-shared';

const router = Router();

// ═══════════ Multimodal Vision Ingestion — ภาพอาการป่วย → Qwen2-VL → JSON สรุป ═══════════

// POST /api/livestock/groups/:id/vision — ส่งภาพ (ผื่นผิวหนัง/อุจจาระ/รอยโรค) → VL model → สรุปอาการ
router.post('/groups/:id/vision', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { imageBase64, prompt } = req.body || {};
    if (!imageBase64 || String(imageBase64).length < 100)
      return res.status(400).json({ error: 'imageBase64 is required (data URL หรือ base64 ของภาพ)' });
    if (!VISION_ENABLED)
      return res.status(400).json({ error: 'Vision AI disabled (VISION_ENABLED=false)' });
    const group = await prisma.livestockGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const b64 = String(imageBase64).replace(/^data:image\/[^;]+;base64,/, '').trim();
    const text = await callVision(b64, prompt || LIVESTOCK_VISION_PROMPT);
    const parsed = parseLivestockVisionResponse(text);

    const report = await prisma.livestockVisionReport.create({
      data: {
        livestockGroupId: group.id,
        model: await getModelForTask('VISION_AI', VISION_MODEL),
        severity: parsed.severity,
        summary: parsed.summary || 'ไม่สามารถสกัดอาการได้',
        symptomsJson: JSON.stringify({ symptoms: parsed.symptoms, recommendation: parsed.recommendation }),
      },
    });

    // อาการผิดปกติ → แจ้งสัตวบาลผ่าน Telegram ทันที (dedup ต่อรายงาน)
    if (parsed.severity !== 'info') {
      await notify(
        `🐄 VISION(${group.code}): ${(parsed.summary || 'พบความผิดปกติ').slice(0, 220)}`,
        parsed.severity === 'critical' ? 'critical' : 'warn',
        `vision-${group.id}-${report.id}`
      );
    }
    res.json({ report, analysis: parsed });
  } catch (err) {
    console.error('Livestock vision ingestion error:', err);
    res.status(500).json({ error: 'Failed to analyze livestock image' });
  }
});

// GET /api/livestock/groups/:id/vision — ประวัติวิเคราะห์ภาพ
router.get('/groups/:id/vision', authenticate, async (req, res) => {
  try {
    const reports = await prisma.livestockVisionReport.findMany({
      where: { livestockGroupId: req.params.id },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json({ reports });
  } catch (err) {
    console.error('Livestock vision history error:', err);
    res.status(500).json({ error: 'Failed to load vision reports' });
  }
});

export default router;
