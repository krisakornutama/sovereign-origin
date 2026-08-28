// ── Governance Simulation Routes ──
// War Room API: สร้าง/โหลด scenario, tick, levers, narrative, history
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import {
  createScenario, listScenarios, loadScenario, deleteScenario,
  tickScenario, applyLevers, addNarrative, getView,
} from '../../services/governance-sim.service';
import { generateNarrative } from '../../services/govsim-narrative.service';

const router = Router();

// รายการ scenario (สั้น)
router.get('/scenarios', authenticate, (_req, res) => {
  res.json(listScenarios());
});

// สร้าง scenario ใหม่ — เริ่มจาก "เพิ่งยึดเมืองเสร็จ"
router.post('/scenarios', authenticate, (req, res) => {
  try {
    const { name, population, seed } = req.body || {};
    const scenario = createScenario({
      name: typeof name === 'string' ? name : undefined,
      population: population !== undefined ? Math.max(100, Math.min(20000, Math.floor(Number(population)))) : undefined,
      seed: seed !== undefined ? Math.floor(Number(seed)) : undefined,
    });
    res.status(201).json(getView(scenario));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'create scenario failed' });
  }
});

// ดูสถานะเต็ม (view)
router.get('/scenarios/:id', authenticate, (req, res) => {
  const s = loadScenario(req.params.id);
  if (!s) return res.status(404).json({ error: 'scenario not found' });
  res.json(getView(s));
});

// ลบ scenario
router.delete('/scenarios/:id', authenticate, (req, res) => {
  const ok = deleteScenario(req.params.id);
  res.json({ success: ok });
});

// เดินเวลา (tick) — 1 tick = 1 เดือนในเกม
router.post('/scenarios/:id/tick', authenticate, (req, res) => {
  const steps = req.body?.steps !== undefined ? Number(req.body.steps) : 1;
  const { scenario, ok, error } = tickScenario(req.params.id, steps);
  if (!ok) return res.status(404).json({ error });
  res.json({ view: getView(scenario), events: scenario.lastTickEvents });
});

// ตั้ง Levers (เครื่องมือผู้ปกครอง)
router.put('/scenarios/:id/levers', authenticate, (req, res) => {
  const { scenario, ok, error } = applyLevers(req.params.id, req.body || {});
  if (!ok) return res.status(404).json({ error });
  res.json(getView(scenario));
});

// สร้าง narrative (LLM)
router.post('/scenarios/:id/narrative', authenticate, async (req, res) => {
  const kind = req.body?.kind || 'analysis';
  if (!['newspaper', 'threat_letter', 'analysis'].includes(kind)) {
    return res.status(400).json({ error: 'kind ต้องเป็น newspaper | threat_letter | analysis' });
  }
  const result = await generateNarrative(req.params.id, kind);
  addNarrative(req.params.id, result);
  res.json(result);
});

// ประวัติ narrative
router.get('/scenarios/:id/narrative', authenticate, (req, res) => {
  const s = loadScenario(req.params.id);
  if (!s) return res.status(404).json({ error: 'scenario not found' });
  res.json(s.narratives.slice(-50).reverse());
});

export default router;