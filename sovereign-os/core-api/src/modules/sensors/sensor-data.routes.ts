import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';
import { config } from '../../config';

// ────────────────────────────────────────────────────────────────────────────
// Sensor data CRUD ด้วยมือ (UI) — ย้ายมาจาก inline routes ใน server.ts
// POST   /api/sensors/data         เพิ่มค่าเซนเซอร์ด้วยมือ
// GET    /api/sensors/metrics      รายชื่อ metric ทั้งหมด
// GET    /api/sensors/all          ข้อมูลย้อนหลัง
// DELETE /api/sensors/:metric      ลบ record ของ metric (manual-input)
// DELETE /api/sensors/:metric/all  ลบทุก record ของ metric
// หมายเหตุ: mount หลัง sensor.routes.ts เสมอ (ต้องให้ /devices จับก่อน /:metric)
// ────────────────────────────────────────────────────────────────────────────
const router = Router();

// Manual sensor data insertion (for UI)
router.post('/data', authenticate, async (req, res) => {
  try {
    const { node_id, device_id, metric, value } = req.body;
    // ตรวจค่าก่อนแตะ TimescaleDB — metric เป็นชื่อ และ value ต้องเป็นตัวเลขจริง
    if (!metric || typeof metric !== 'string' || metric.length > 60) {
      return res.status(400).json({ error: 'metric ต้องเป็น string ยาว 1-60 ตัวอักษร' });
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return res.status(400).json({ error: 'value ต้องเป็นตัวเลข' });
    }
    const nodeId = node_id || req.user?.assigned_node_id || config.defaults.telemetryNodeId;
    const deviceId = device_id || 'manual-input';
    await prisma.$queryRawUnsafe(
      `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value)
       VALUES (NOW(), $1::uuid, $2, $3, $4)`,
      nodeId, deviceId, metric, numericValue
    );
    res.status(201).json({ success: true, message: `เพิ่ม ${metric} = ${numericValue} สำเร็จ` });
  } catch (err) {
    console.error('Add sensor error:', err);
    res.status(500).json({ error: 'เพิ่มข้อมูลไม่สำเร็จ' });
  }
});

// Sensor metrics list
router.get('/metrics', authenticate, async (_req, res) => {
  try {
    const result = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT metric FROM sensor_telemetry ORDER BY metric`
    );
    res.json(result.map((r: any) => r.metric));
  } catch (err) {
    res.json([]);
  }
});

// Sensor data list
router.get('/all', authenticate, async (req, res) => {
  try {
    const { metric, limit } = req.query;
    let query = `SELECT time, node_id, device_id, metric, value FROM sensor_telemetry WHERE 1=1`;
    const params: any[] = [];
    if (metric && metric !== 'all') {
      query += ` AND metric = $${params.length + 1}`;
      params.push(metric);
    }
    query += ` ORDER BY time DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string) || 50);
    const result = await prisma.$queryRawUnsafe<Array<any>>(query, ...params);
    res.json(result);
  } catch (err) {
    res.status(500).json([]);
  }
});

// Delete sensor record
router.delete('/:metric', authenticate, async (req, res) => {
  try {
    const { metric } = req.params;
    const { device_id } = req.query;
    await prisma.$queryRawUnsafe(
      `DELETE FROM sensor_telemetry WHERE metric = $1 AND device_id = $2`,
      metric,
      device_id || 'manual-input'
    );
    res.json({ success: true, message: `ลบ ${metric} สำเร็จ` });
  } catch (err) {
    res.status(500).json({ error: 'ลบไม่สำเร็จ' });
  }
});

// Delete all records of a metric
router.delete('/:metric/all', authenticate, async (req, res) => {
  try {
    await prisma.$queryRawUnsafe(`DELETE FROM sensor_telemetry WHERE metric = $1`, req.params.metric);
    res.json({ success: true, message: `ลบ ${req.params.metric} ทั้งหมดสำเร็จ` });
  } catch (err) {
    res.status(500).json({ error: 'ลบไม่สำเร็จ' });
  }
});

export default router;
