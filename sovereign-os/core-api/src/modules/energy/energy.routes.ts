import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  ENERGY_METRICS,
  ingestReading,
  checkAndAlert,
  getSummary,
  isEnergyMetric,
} from '../../services/energy.service';

const router = Router();

// บทบาทที่แก้ระบบพลังงานได้ (ingest ค่าวัด / ตั้งเพดาน) — เดียวกับโมดูลอื่น
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

// ────────────────────────────────────────────────────────────────────────────
// ENERGY เต็มรูป — ระบบวัดพลังงานโรงงาน/บ้านเล็ก
// GET  /api/energy/summary        สรุปพลังงาน (คงเดิม + เพิ่ม source)
// POST /api/energy/readings       บันทึกค่าวัด (จาก sensor/manual) + check เพดานทันที
// GET  /api/energy/readings       ค่าวัดย้อนหลัง (กรอง node/device/metric + limit)
// GET  /api/energy/thresholds     รายการเพดาน
// POST /api/energy/thresholds     ตั้งเพดาน (upsert ตาม scope+scopeName+metric)
// PATCH /api/energy/thresholds/:id  แก้/ปิดเพดาน
// DELETE /api/energy/thresholds/:id ลบเพดาน
// POST /api/energy/check          ตรวจเพดานทันที + เตือน Telegram เฉพาะที่เกิน
// ────────────────────────────────────────────────────────────────────────────

// GET /api/energy/summary – สรุปพลังงาน (คงพฤติกรรมเดิม — ย้าย logic ไป service)
router.get('/summary', authenticate, async (_req, res) => {
  try {
    res.json(await getSummary());
  } catch (err) {
    console.error('Energy summary error:', err);
    res.status(500).json({ error: 'Failed to load energy summary' });
  }
});

// POST /api/energy/readings — บันทึกค่าวัดพลังงาน + ตรวจเพดานทันที (เตือนเมื่อเกิน)
router.post('/readings', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { node_id, device_id, metric, value, read_at } = req.body ?? {};
    if (!node_id || typeof node_id !== 'string') {
      return res.status(400).json({ error: 'node_id ต้องเป็น uuid ของ node' });
    }
    if (!isEnergyMetric(String(metric))) {
      return res.status(400).json({ error: `metric ต้องเป็นหนึ่งใน: ${ENERGY_METRICS.join(', ')}` });
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return res.status(400).json({ error: 'value ต้องเป็นตัวเลข' });
    }
    const reading = await ingestReading({
      node_id,
      device_id: device_id ? String(device_id) : undefined,
      metric: String(metric),
      value: numericValue,
      read_at: read_at ? new Date(read_at) : undefined,
    });
    // ตรวจเพดานทันทีที่มีค่าวัดใหม่ — เกินแล้วยิง Telegram ผ่าน pipeline เดิม
    const breaches = await checkAndAlert();
    res.status(201).json({ reading, breaches });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/energy/readings — ค่าวัดย้อนหลัง (กรอง node/device/metric + limit ≤ 1000)
router.get('/readings', authenticate, async (req, res) => {
  try {
    const { node_id, device_id, metric } = req.query;
    const where: any = {};
    if (node_id) where.node_id = String(node_id);
    if (device_id) where.device_id = String(device_id);
    if (metric) where.metric = String(metric);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 1000);
    const readings = await prisma.energyReading.findMany({
      where,
      orderBy: { read_at: 'desc' },
      take: limit,
    });
    res.json(readings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/energy/thresholds — รายการเพดานทั้งหมด (รวมที่ปิดไว้)
router.get('/thresholds', authenticate, async (_req, res) => {
  try {
    const thresholds = await prisma.energyThreshold.findMany({ orderBy: [{ scope: 'asc' }, { scopeName: 'asc' }] });
    res.json(thresholds);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/energy/thresholds — ตั้งเพดาน (upsert ตาม scope+scopeName+metric)
router.post('/thresholds', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const scope = String(req.body?.scope || '');
    if (!['global', 'node', 'device'].includes(scope)) {
      return res.status(400).json({ error: 'scope ต้องเป็น global | node | device' });
    }
    const scopeName = scope === 'global' ? '*' : String(req.body?.scopeName || '');
    if (!scopeName) {
      return res.status(400).json({ error: 'scopeName จำเป็นสำหรับ scope node/device' });
    }
    const metric = isEnergyMetric(String(req.body?.metric || 'power_kw')) ? String(req.body?.metric || 'power_kw') : null;
    if (!metric) {
      return res.status(400).json({ error: `metric ต้องเป็นหนึ่งใน: ${ENERGY_METRICS.join(', ')}` });
    }
    const maxKw = Number(req.body?.maxKw);
    if (!Number.isFinite(maxKw) || maxKw <= 0) {
      return res.status(400).json({ error: 'maxKw ต้องเป็นตัวเลขมากกว่า 0' });
    }
    const windowMin = Math.min(Math.max(parseInt(String(req.body?.windowMin)) || 60, 1), 1440);
    const threshold = await prisma.energyThreshold.upsert({
      where: { scope_scopeName_metric: { scope, scopeName, metric } },
      update: { maxKw, windowMin, isActive: req.body?.isActive === false ? false : true },
      create: { scope, scopeName, metric, maxKw, windowMin, isActive: req.body?.isActive === false ? false : true },
    });
    res.status(201).json(threshold);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/energy/thresholds/:id — แก้ค่า/ปิด-เปิดเพดาน
router.patch('/thresholds/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const data: any = {};
    if (req.body?.maxKw != null) {
      const maxKw = Number(req.body.maxKw);
      if (!Number.isFinite(maxKw) || maxKw <= 0) return res.status(400).json({ error: 'maxKw ต้องเป็นตัวเลขมากกว่า 0' });
      data.maxKw = maxKw;
    }
    if (req.body?.windowMin != null) {
      data.windowMin = Math.min(Math.max(parseInt(String(req.body.windowMin)), 1), 1440);
    }
    if (req.body?.isActive != null) data.isActive = Boolean(req.body.isActive);
    const threshold = await prisma.energyThreshold.update({ where: { id: req.params.id }, data });
    res.json(threshold);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// DELETE /api/energy/thresholds/:id
router.delete('/thresholds/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    await prisma.energyThreshold.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// POST /api/energy/check — ตรวจเพดานทันที (cron/manual) + เตือน Telegram เฉพาะรายการที่เกิน
router.post('/check', authenticate, requireRole(...WRITE_ROLES), async (_req, res) => {
  try {
    res.json({ breaches: await checkAndAlert() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
