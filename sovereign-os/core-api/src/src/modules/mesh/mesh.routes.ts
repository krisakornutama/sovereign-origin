import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { meshLiteService } from '../../services/mesh-lite.service';

// Sovereign Mesh Lite — สำรองข้อมูลนอกสถานที่แบบเข้ารหัส
// GET  /api/mesh/status     — สถานะ + key fingerprint + bundle list
// GET  /api/mesh/manifest   — metadata ของ bundle ล่าสุด (เช็คความสด ไม่มีข้อมูล)
// GET  /api/mesh/latest     — bundle ล่าสุดทั้งก้อน (เข้ารหัส — remote pull)
// POST /api/mesh/replicate  — replicate ทันที (สร้าง bundle → stage/push)

const router = Router();

router.get('/status', authenticate, (_req, res) => {
  res.json(meshLiteService.status());
});

router.get('/manifest', authenticate, (_req, res) => {
  const info = meshLiteService.latestBundle();
  if (!info) return res.status(404).json({ error: 'ยังไม่มี bundle' });
  res.json({ latest: info });
});

router.get('/latest', authenticate, requireRole('SUPERADMIN'), (_req, res) => {
  const latest = meshLiteService.readLatestBundle();
  if (!latest) return res.status(404).json({ error: 'ยังไม่มี bundle' });
  res.json({ file: latest.file, bundle: latest.bundle });
});

router.post('/replicate', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  const result = await meshLiteService.replicate();
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

export default router;