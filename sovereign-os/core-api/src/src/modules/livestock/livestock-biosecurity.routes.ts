// livestock-biosecurity.routes.ts — เสา 5: Biosecurity Access Control — แยกจาก livestock.routes.ts
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { gateCheck, GATE_SANITIZE_MIN_SEC } from '../../services/livestock-vet-ai.service';
import { WRITE_ROLES, notify } from './livestock-shared';

const router = Router();

// ═══════════ เสา 5: Biosecurity Access Control ═══════════

// POST /api/livestock/biosecurity — ลงบันทึกเข้าฟาร์ม → gateCheck (ฉีดพ่น ≥180s)
router.post('/biosecurity', authenticate, async (req, res) => {
  try {
    const { visitorName, vehiclePlate, sanitizedSec } = req.body || {};
    if (!visitorName || String(visitorName).trim().length === 0)
      return res.status(400).json({ error: 'visitorName is required' });
    const sec = Number(sanitizedSec);
    if (!Number.isFinite(sec) || sec < 0) return res.status(400).json({ error: 'sanitizedSec must be >= 0' });
    const gate = gateCheck(sec);
    const entry = await prisma.biosecurityLog.create({
      data: {
        visitorName: String(visitorName),
        vehiclePlate: vehiclePlate || null,
        sanitizedSec: sec,
        passedGate: gate.passed,
      },
    });
    if (!gate.passed) {
      await notify(`🚧 GATE DENIED: ${visitorName} ฉีดพ่น ${sec}s (<${GATE_SANITIZE_MIN_SEC}s) — ห้ามเข้าฟาร์ม`, 'warn');
    }
    res.json({ entry, gate });
  } catch (err) {
    console.error('Livestock biosecurity error:', err);
    res.status(500).json({ error: 'Failed to record biosecurity log' });
  }
});

// GET /api/livestock/biosecurity — ประวัติเข้า-ออก (รวมคนที่ยังอยู่ในฟาร์ม)
router.get('/biosecurity', authenticate, async (_req, res) => {
  try {
    const logs = await prisma.biosecurityLog.findMany({
      orderBy: { entryTime: 'desc' },
      take: 100,
    });
    const denied = logs.filter((l) => !l.passedGate).length;
    const inside = logs.filter((l) => l.passedGate && !l.exitTime).length;
    res.json({ logs, summary: { total: logs.length, denied, inside } });
  } catch (err) {
    console.error('Livestock biosecurity list error:', err);
    res.status(500).json({ error: 'Failed to load biosecurity logs' });
  }
});

// POST /api/livestock/biosecurity/:id/exit — ลงเวลาออกฟาร์ม (ครบรอบเข้า-ออก)
router.post('/biosecurity/:id/exit', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const entry = await prisma.biosecurityLog.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: 'Biosecurity log not found' });
    if (entry.exitTime) return res.status(400).json({ error: 'บันทึกเวลาออกแล้ว' });
    const exited = await prisma.biosecurityLog.update({
      where: { id: entry.id },
      data: { exitTime: new Date() },
    });
    res.json({ entry: exited, durationMs: new Date(exited.exitTime!).getTime() - new Date(entry.entryTime).getTime() });
  } catch (err) {
    console.error('Livestock biosecurity exit error:', err);
    res.status(500).json({ error: 'Failed to record biosecurity exit' });
  }
});

export default router;
