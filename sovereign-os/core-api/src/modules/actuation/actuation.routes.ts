// ── Actuation Engine Routes — Closed-Loop Actuation Sandbox ──
// GET    /api/actuation/status       — โหมด + envelope + actuators + ประวัติ
// GET    /api/actuation/rules        — กฎเหล็ก (hard limits) ที่ทำงานอยู่
// POST   /api/actuation/execute      — มนุษย์สั่ง actuator (ผ่าน Safety Envelope ด้วย)
// POST   /api/actuation/sync-levers  — ทดสอบ mapper: levers → actuator commands
// PUT    /api/actuation/mode         — sandbox ↔ real (real ถูกล็อกด้วย ACT_ALLOW_REAL)
// PUT    /api/actuation/occupancy    — บังคับสถานะ "มีคนอยู่บ้าน" (ทดสอบกฎ OCCUPANCY)
// POST   /api/actuation/simulate-failure — จำลอง relay ค้าง (ทดสอบ ACTUATION_FAILED + rollback)
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { actuationService } from '../../services/actuation.service';

const router = Router();

router.get('/status', authenticate, (_req, res) => {
  res.json(actuationService.status());
});

router.get('/rules', authenticate, (_req, res) => {
  res.json(actuationService.envelopeRules());
});

router.post('/execute', authenticate, async (req, res) => {
  const { actuatorId, state, reason } = req.body || {};
  if (!actuatorId || !state) return res.status(400).json({ error: 'ต้องระบุ actuatorId + state' });
  const r = await actuationService.executeCommand({
    actuatorId: String(actuatorId),
    desiredState: String(state),
    actor: 'human',
    reason: String(reason || 'มนุษย์สั่งผ่าน UI'),
  });
  res.status(r.ok ? 200 : 403).json(r);
});

router.post('/sync-levers', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const levers = req.body?.levers;
  if (!levers || typeof levers !== 'object') return res.status(400).json({ error: 'ต้องส่ง levers object' });
  const actor = req.body?.actor === 'governor' ? 'governor' : 'human';
  const results = await actuationService.syncActuatorsFromLevers(levers, actor);
  res.json({ actor, results });
});

router.put('/mode', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const r = actuationService.setMode(String(req.body?.mode || 'sandbox') as any);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json(actuationService.status());
});

router.put('/occupancy', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const v = req.body?.occupied;
  const r = actuationService.setOccupancy(v == null ? null : !!v);
  res.json(r);
});

router.post('/simulate-failure', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const actuatorId = String(req.body?.actuatorId || '');
  if (!actuatorId) return res.status(400).json({ error: 'ต้องระบุ actuatorId' });
  res.json(actuationService.toggleSimFailure(actuatorId));
});

export default router;