// ── Governor AI Routes — มนุษย์ควบคุมทิศทาง + ตรวจสอบเรื่องใหญ่ ──
// GET    /api/governor/status            — สถานะ + proposals + บทเรียน + กิจกรรม
// PUT    /api/governor/direction         — มนุษย์ตั้งทิศทาง (เรื่องสำคัญที่สุด)
// PUT    /api/governor/autonomy          — ระดับอิสระ AI (conservative/balanced/autonomous)
// PUT    /api/governor/enabled           — เปิด/ปิด auto loop
// PUT    /api/governor/focus             — เลือก scenario ที่ governor ดูแล
// POST   /api/governor/cycle             — รันรอบทันที (manual trigger)
// POST   /api/governor/proposals/:id/approve — มนุษย์อนุมัติเรื่องใหญ่
// POST   /api/governor/proposals/:id/reject  — มนุษย์ปฏิเสธ (พร้อมเหตุผล)
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  governorStatus, setDirection, setAutonomy, setEnabled, setFocusScenario,
  runGovernorCycle, approveProposal, rejectProposal,
} from '../../services/governor.service';

const router = Router();

router.get('/status', authenticate, (_req, res) => {
  res.json(governorStatus());
});

router.put('/direction', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const r = setDirection(req.body?.direction);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(governorStatus());
});

router.put('/autonomy', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const r = setAutonomy(req.body?.autonomy);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(governorStatus());
});

router.put('/enabled', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const r = setEnabled(!!req.body?.enabled);
  res.json(governorStatus());
});

router.put('/focus', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const r = setFocusScenario(req.body?.scenarioId ?? null);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(governorStatus());
});

router.post('/cycle', authenticate, async (_req, res) => {
  const r = await runGovernorCycle({ force: true });
  if (!r.ok) return res.status(400).json({ error: r.reason || 'cycle failed' });
  res.json(governorStatus());
});

router.post('/proposals/:id/approve', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const r = approveProposal(req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(governorStatus());
});

router.post('/proposals/:id/reject', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const r = rejectProposal(req.params.id, 'human', req.body?.reason);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(governorStatus());
});

export default router;