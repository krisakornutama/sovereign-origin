import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';

// I5b (28/9/69): GET /api/farm/crops/recommend — crop recommendation ตามสเปคเจ้าของ
// delegate เข้า farm-advisor.service เดิมทั้งหมด (heuristic ตอบเสมอ — Ollama เป็นตัวเสริม timeout+fallback)
// mount แยกที่ /api/farm/crops (farm router ตัวหลักถูก mount ที่ /api/farm/plots — ใส่ในนั้นจะชน /:id)
const router = Router();

router.get('/recommend', authenticate, async (req, res) => {
  try {
    const topN = Math.min(Math.max(parseInt(String(req.query.top)) || 3, 1), 50);
    const wantsAi = req.query.ai === '1' || req.query.ai === 'true';
    const { computePlotAdvisor, askFarmAdvisor } = await import('../../services/farm-advisor.service');
    const plotId = String(req.query.plotId || req.query.plot || '').trim();

    // ระบุ plotId = รูปร่างเดียวกับ GET /api/farm/plots/:id/advisor เป๊ะ (ai=1 เรียก Ollama พร้อม fallback)
    if (plotId) {
      if (!wantsAi) {
        const heuristic = await computePlotAdvisor(plotId, topN);
        return res.json({ ...heuristic, aiText: null, source: 'heuristic' });
      }
      const result = await askFarmAdvisor(plotId, { topN });
      return res.json({ ...result.heuristic, aiText: result.aiText, source: result.source });
    }

    // ไม่ระบุ plotId = สรุปทุกแปลง (อันดับ 1 ต่อแปลง)
    const { prisma } = await import('../../lib/prisma');
    const plots = await prisma.farmPlot.findMany({ select: { id: true }, orderBy: { name: 'asc' } });
    const plotsOut = [];
    for (const p of plots) {
      const r = await computePlotAdvisor(p.id, 1);
      plotsOut.push({
        plotId: r.plotId,
        plotName: r.plotName,
        currentCrop: r.currentCrop,
        hasSoilData: r.hasSoilData,
        top: r.recommendations[0] ?? null,
        forecast: r.forecast,
      });
    }
    res.json({ plots: plotsOut, source: 'heuristic', generatedAt: new Date().toISOString() });
  } catch (err: any) {
    if (err?.message === 'Plot not found') return res.status(404).json({ error: err.message });
    console.error('Crop recommend error:', err);
    res.status(500).json({ error: 'Failed to recommend crops' });
  }
});

export default router;
