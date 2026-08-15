import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { automationEngine, automationEmitter } from '../../services/automation.service';
import { warRoomSessionClosed, warRoomSessionOpened } from '../../services/war-room.service';

const router = Router();

function validateRule(body: any): string | null {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (typeof body.metric !== 'string' || !body.metric.trim()) return 'metric required';
  if (!['gt', 'lt', 'eq'].includes(body.condition)) return 'condition must be gt, lt or eq';
  if (typeof body.threshold !== 'number' || Number.isNaN(body.threshold)) return 'threshold must be a number';
  if (typeof body.message !== 'string' || !body.message.trim()) return 'message required';
  if (!['info', 'warning', 'critical'].includes(body.severity)) return 'severity must be info, warning or critical';
  return null;
}

// GET /api/automation/rules
router.get('/rules', authenticate, (req, res) => {
  res.json(automationEngine.getRules());
});

// POST /api/automation/rules – สร้างกฎใหม่ (Custom Rule Builder)
router.post('/rules', authenticate, async (req, res) => {
  const err = validateRule(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const rule = await automationEngine.addRule({
      metric: req.body.metric.trim(),
      condition: req.body.condition,
      threshold: req.body.threshold,
      message: req.body.message.trim(),
      severity: req.body.severity,
      enabled: req.body.enabled !== false,
    });
    res.json(rule);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

// PUT /api/automation/rules/:id – แก้ไขกฎ (เช่น เปลี่ยน threshold/ข้อความ)
router.put('/rules/:id', authenticate, async (req, res) => {
  const err = validateRule(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const rule = await automationEngine.updateRule(req.params.id, {
      metric: req.body.metric.trim(),
      condition: req.body.condition,
      threshold: req.body.threshold,
      message: req.body.message.trim(),
      severity: req.body.severity,
      enabled: req.body.enabled !== false,
    });
    res.json(rule);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// POST /api/automation/rules/:id/toggle
router.post('/rules/:id/toggle', authenticate, async (req, res) => {
  const enabled = req.body?.enabled !== false;
  try {
    await automationEngine.toggleRule(req.params.id, enabled);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to toggle rule' });
  }
});

// DELETE /api/automation/rules/:id – ลบกฎ (กฎสำเร็จรูป is_default ลบไม่ได้)
router.delete('/rules/:id', authenticate, async (req, res) => {
  try {
    const rule = automationEngine.getRules().find((r) => r.id === req.params.id);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    if (rule.is_default) return res.status(409).json({ error: 'Cannot delete built-in rule (disable it instead)' });
    await automationEngine.removeRule(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// POST /api/automation/check – ตรวจสอบเงื่อนไขด้วยข้อมูลล่าสุด
router.post('/check', authenticate, (req, res) => {
  const { metrics } = req.body;
  const alerts = automationEngine.checkMetrics(metrics);
  res.json({ alerts });
});

// GET /api/automation/alerts/stream (SSE)
router.get('/alerts/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  warRoomSessionOpened(); // ข้อ 3: หน้า Dashboard เปิดอยู่ = War Room ตื่น

  const listener = (alert: any) => {
    res.write(`data: ${JSON.stringify(alert)}\n\n`);
  };

  automationEmitter.on('alert', listener);

  req.on('close', () => {
    automationEmitter.off('alert', listener);
    warRoomSessionClosed();
  });
});

export default router;
