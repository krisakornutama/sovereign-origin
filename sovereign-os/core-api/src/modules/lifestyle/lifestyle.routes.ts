import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { getDayPlan } from '../../services/chaos-windows.service';
import { livingMode } from '../../services/living-mode.service';
import { manualDay } from '../../services/manual-day.service';
import { maintenanceRadar } from '../../services/maintenance-radar.service';

// ═══ LIFESTYLE (Phase 5 — Embracing Chaos) ═══
// วิถีชีวิต: จังหวะธรรมชาติ (ภัย 1+3), Living Mode กัน Goodhart (ภัย 2),
// Maintenance Radar (ภัย 4), Manual Day (ภัย 5)

export const lifestyleRoutes = Router();

// ── F. Chaos Windows — แผนจังหวะธรรมชาติของวันนี้ (advisory — มนุษย์คือ actuator) ──
lifestyleRoutes.get('/chaos-windows', authenticate, async (_req, res) => {
  res.json(await getDayPlan());
});

// ── G. Living Mode (Anti-Goodhart) — ระบบห้ามเตือนรบกวนการใช้ชีวิต ──
lifestyleRoutes.get('/living-mode', authenticate, async (_req, res) => {
  res.json(livingMode.status());
});

lifestyleRoutes.put('/living-mode', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'), async (req, res) => {
  const { active } = req.body || {};
  res.json(livingMode.set(Boolean(active), req.user?.id || 'unknown'));
});

// ── I. Manual Day — วันไร้ระบบอัตโนมัติ (พัก automation ตามเวลาที่กำหนด) ──
lifestyleRoutes.get('/manual-day', authenticate, async (_req, res) => {
  res.json(manualDay.status());
});

lifestyleRoutes.put('/manual-day', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'), async (req, res) => {
  const { active, note, hours } = req.body || {};
  res.json(await manualDay.set(Boolean(active), req.user?.id || 'unknown', typeof note === 'string' ? note : '', typeof hours === 'number' ? hours : undefined));
});

// ── H. Maintenance Radar (Sovereignty Tax) ──
lifestyleRoutes.get('/maintenance', authenticate, async (_req, res) => {
  res.json(maintenanceRadar.status());
});

lifestyleRoutes.post('/maintenance/:id/done', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { id } = req.params;
  if (!maintenanceRadar.status().tasks.some((t) => t.id === id)) {
    return res.status(404).json({ error: 'ไม่พบงานบำรุงรักษานี้' });
  }
  res.json(maintenanceRadar.markDone(id, req.user?.id || 'unknown'));
});

lifestyleRoutes.post('/maintenance/drift-check', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  const flags = await maintenanceRadar.driftCheck();
  res.json({ flags, ...maintenanceRadar.status() });
});