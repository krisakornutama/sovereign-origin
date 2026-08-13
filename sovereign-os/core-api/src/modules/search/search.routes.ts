import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { search, rebuildIndex, indexStats } from '../../services/semantic-search.service';

const router = Router();

// POST /api/knowledge/search { query, top_k? } — ค้นหาความหมาย (fallback keyword)
router.post('/search', authenticate, async (req, res) => {
  try {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query) return res.status(400).json({ error: 'query required' });
    const topK = Math.min(Math.max(parseInt(req.body?.top_k, 10) || 5, 1), 20);
    const results = await search(query, topK);
    res.json({ results });
  } catch (err) {
    console.error('Semantic search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /api/knowledge/index — สร้าง/อัปเดต index ใหม่ (embed ทุกไฟล์)
router.post('/index', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const result = await rebuildIndex();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Index rebuild error:', err);
    res.status(500).json({ error: 'Index rebuild failed' });
  }
});

// GET /api/knowledge/index/status — สถานะ index (จำนวน chunk + embed model)
router.get('/index/status', authenticate, async (req, res) => {
  try {
    res.json(await indexStats());
  } catch (err) {
    res.status(500).json({ error: 'Status failed' });
  }
});

export default router;
