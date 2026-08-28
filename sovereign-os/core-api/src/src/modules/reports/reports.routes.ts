import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { reportService } from '../../services/report.service';

const router = Router();

// GET /api/reports?limit=50 – รายการรายงาน (เรียงใหม่สุดก่อน)
router.get('/', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const reports = await reportService.list(limit);
    res.json(reports);
  } catch (err) {
    console.error('List reports error:', err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// POST /api/reports/generate { type: 'daily' | 'weekly' } – สร้างรายงานเดี๋ยวนี้
router.post('/generate', authenticate, async (req, res) => {
  const type = req.body?.type === 'weekly' ? 'weekly' : 'daily';
  try {
    const report = await reportService.generateNow(type);
    res.json(report);
  } catch (err) {
    console.error('Generate report error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

export default router;
