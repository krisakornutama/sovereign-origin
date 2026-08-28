import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { prisma } from '../../lib/prisma';

const router = Router();

// ─────────────────────────────────────────────────────────────
// Phase 5: Off-Grid Infrastructure Hub
// 1) AI Computer Vision & Perimeter Defense
// 2) Water & Food Inventory Infrastructure
// 3) Offline Emergency Radio & Mesh Comms
// 4) Predictive Equipment & Generator Maintenance
// ─────────────────────────────────────────────────────────────

const OBJECT_TYPES = ['person', 'vehicle', 'animal', 'venomous', 'other'];
const RADIO_CHANNELS = ['sdr', 'meshtastic', 'lora', 'fm'];
const WATER_SOURCES = ['sensor', 'manual'];

// ── 1) Cameras + Detection Events (Local AI: Frigate / YOLO) ──

// GET /api/infrastructure/cameras
router.get('/cameras', authenticate, async (req, res) => {
  try {
    const cameras = await prisma.camera.findMany({ orderBy: { created_at: 'desc' } });
    res.json(cameras);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load cameras' });
  }
});

// POST /api/infrastructure/cameras
router.post('/cameras', authenticate, async (req, res) => {
  try {
    const { name, rtsp_url, location, enabled } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name required' });
    }
    const camera = await prisma.camera.create({
      data: {
        name: name.trim().slice(0, 100),
        rtsp_url: typeof rtsp_url === 'string' ? rtsp_url.slice(0, 500) : null,
        location: typeof location === 'string' ? location.slice(0, 100) : null,
        enabled: enabled !== false,
      },
    });
    res.status(201).json(camera);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create camera' });
  }
});

// PUT /api/infrastructure/cameras/:id
router.put('/cameras/:id', authenticate, async (req, res) => {
  try {
    const { name, rtsp_url, location, enabled } = req.body || {};
    const data: any = {};
    if (name !== undefined) data.name = String(name).slice(0, 100);
    if (rtsp_url !== undefined) data.rtsp_url = rtsp_url ? String(rtsp_url).slice(0, 500) : null;
    if (location !== undefined) data.location = location ? String(location).slice(0, 100) : null;
    if (enabled !== undefined) data.enabled = Boolean(enabled);
    const camera = await prisma.camera.update({ where: { id: req.params.id }, data });
    res.json(camera);
  } catch (err) {
    res.status(404).json({ error: 'Camera not found' });
  }
});

// DELETE /api/infrastructure/cameras/:id
router.delete('/cameras/:id', authenticate, async (req, res) => {
  try {
    await prisma.camera.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: 'Camera not found (has events? delete events first)' });
  }
});

// GET /api/infrastructure/detections?camera_id=&limit=
router.get('/detections', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const cameraId = (req.query.camera_id as string) || '';
    const rows = await prisma.detectionEvent.findMany({
      where: cameraId ? { camera_id: cameraId } : {},
      orderBy: { detected_at: 'desc' },
      take: limit,
      include: { camera: { select: { name: true, location: true } } },
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load detections' });
  }
});

// POST /api/infrastructure/detections — AI (Frigate/YOLO) ส่งผลตรวจจับ
// ถ้า object_type = venomous หรือช่วง DEFCON 2 → กำหนด triggered_action ได้ (เปิด floodlight/relay)
router.post('/detections', authenticate, async (req, res) => {
  try {
    const { camera_id, object_type, confidence, image_path, triggered_action, detected_at } = req.body || {};
    const camera = await prisma.camera.findUnique({ where: { id: camera_id } });
    if (!camera) return res.status(400).json({ error: 'camera_id not found' });
    if (!OBJECT_TYPES.includes(object_type)) {
      return res.status(400).json({ error: `object_type must be one of: ${OBJECT_TYPES.join(', ')}` });
    }
    const event = await prisma.detectionEvent.create({
      data: {
        camera_id,
        object_type,
        confidence: confidence != null ? Math.min(1, Math.max(0, Number(confidence))) : null,
        image_path: typeof image_path === 'string' ? image_path.slice(0, 500) : null,
        triggered_action: typeof triggered_action === 'string' ? triggered_action.slice(0, 100) : null,
        detected_at: detected_at ? new Date(detected_at) : new Date(),
      },
    });
    await prisma.camera.update({
      where: { id: camera_id },
      data: { last_event_at: new Date() },
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: 'Failed to record detection' });
  }
});

// ── 2) Water Quality (TDS / pH / turbidity) + Inventory ──

// GET /api/infrastructure/water — ค่าล่าสุดรายถัง + ประวัติ
router.get('/water', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
    const tank = (req.query.tank as string) || '';
    const readings = await prisma.waterQualityReading.findMany({
      where: tank ? { tank_name: tank } : {},
      orderBy: { measured_at: 'desc' },
      take: limit,
    });
    const tanks = [...new Set(readings.map((r) => r.tank_name))];
    const latest = tanks.map((t) => readings.find((r) => r.tank_name === t)!);
    res.json({ latest, readings, tanks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load water readings' });
  }
});

// POST /api/infrastructure/water — บันทึกค่าคุณภาพน้ำ
router.post('/water', authenticate, async (req, res) => {
  try {
    const { tank_name, tds, ph, turbidity, source, measured_at } = req.body || {};
    if (!tank_name || typeof tank_name !== 'string' || !tank_name.trim()) {
      return res.status(400).json({ error: 'tank_name required' });
    }
    const reading = await prisma.waterQualityReading.create({
      data: {
        tank_name: tank_name.trim().slice(0, 100),
        tds: tds != null ? Number(tds) : null,
        ph: ph != null ? Number(ph) : null,
        turbidity: turbidity != null ? Number(turbidity) : null,
        source: WATER_SOURCES.includes(source) ? source : 'manual',
        measured_at: measured_at ? new Date(measured_at) : new Date(),
      },
    });
    res.status(201).json(reading);
  } catch (err) {
    res.status(500).json({ error: 'Failed to record water reading' });
  }
});

// ── 3) Offline Emergency Radio & Mesh Comms (SDR / Meshtastic / LoRa) ──

// GET /api/infrastructure/radio?channel=&emergency=
router.get('/radio', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const channel = (req.query.channel as string) || '';
    const where: any = {};
    if (RADIO_CHANNELS.includes(channel)) where.channel = channel;
    if (req.query.emergency === 'true') where.is_emergency = true;
    const rows = await prisma.radioMessage.findMany({
      where,
      orderBy: { received_at: 'desc' },
      take: limit,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load radio messages' });
  }
});

// POST /api/infrastructure/radio — รับ/ส่งข้อความ (direction: in | out)
router.post('/radio', authenticate, async (req, res) => {
  try {
    const { direction, channel, text, remote_id, is_emergency, received_at } = req.body || {};
    if (!['in', 'out'].includes(direction)) return res.status(400).json({ error: 'direction must be in or out' });
    if (!RADIO_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: `channel must be one of: ${RADIO_CHANNELS.join(', ')}` });
    }
    if (!text || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text required' });
    const message = await prisma.radioMessage.create({
      data: {
        direction,
        channel,
        text: text.trim().slice(0, 2000),
        remote_id: typeof remote_id === 'string' ? remote_id.slice(0, 100) : null,
        is_emergency: is_emergency === true,
        received_at: received_at ? new Date(received_at) : new Date(),
      },
    });
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: 'Failed to record radio message' });
  }
});

// ── 4) Equipment & Run Hours (predictive maintenance) ──

// GET /api/infrastructure/equipment — พร้อมสถานะบำรุงรักษา (due = run_hours ≥ interval)
router.get('/equipment', authenticate, async (req, res) => {
  try {
    const items = await prisma.equipment.findMany({
      orderBy: { created_at: 'desc' },
      include: { run_hours_logs: { orderBy: { logged_at: 'desc' }, take: 5 } },
    });
    const enriched = items.map((e) => ({
      ...e,
      maintenance_due: e.service_interval_hours != null && e.run_hours >= e.service_interval_hours,
      hours_until_service:
        e.service_interval_hours != null ? Math.max(0, e.service_interval_hours - e.run_hours) : null,
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load equipment' });
  }
});

// POST /api/infrastructure/equipment
router.post('/equipment', authenticate, async (req, res) => {
  try {
    const { name, type, run_hours, service_interval_hours, last_service_at, notes } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name required' });
    }
    const equipment = await prisma.equipment.create({
      data: {
        name: name.trim().slice(0, 100),
        type: typeof type === 'string' ? type.slice(0, 30) : 'other',
        run_hours: run_hours != null ? Number(run_hours) : 0,
        service_interval_hours: service_interval_hours != null ? Number(service_interval_hours) : null,
        last_service_at: last_service_at ? new Date(last_service_at) : null,
        notes: typeof notes === 'string' ? notes.slice(0, 300) : null,
      },
    });
    res.status(201).json(equipment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create equipment' });
  }
});

// POST /api/infrastructure/equipment/:id/run-hours — บันทึกชั่วโมงการทำงานสะสม
router.post('/equipment/:id/run-hours', authenticate, async (req, res) => {
  try {
    const { hours, note, logged_at } = req.body || {};
    const amount = Number(hours);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'hours must be a non-negative number' });
    }
    const equipment = await prisma.equipment.findUnique({ where: { id: req.params.id } });
    if (!equipment) return res.status(404).json({ error: 'Equipment not found' });
    const log = await prisma.runHoursLog.create({
      data: {
        equipment_id: req.params.id,
        hours: amount,
        note: typeof note === 'string' ? note.slice(0, 300) : null,
        logged_at: logged_at ? new Date(logged_at) : new Date(),
      },
    });
    const updated = await prisma.equipment.update({
      where: { id: req.params.id },
      data: { run_hours: equipment.run_hours + amount },
    });
    res.status(201).json({ log, equipment: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log run hours' });
  }
});

// POST /api/infrastructure/equipment/:id/service — บันทึกการบำรุงรักษา (reset interval)
router.post('/equipment/:id/service', authenticate, async (req, res) => {
  try {
    const equipment = await prisma.equipment.update({
      where: { id: req.params.id },
      data: { last_service_at: new Date() },
    });
    res.json(equipment);
  } catch (err) {
    res.status(404).json({ error: 'Equipment not found' });
  }
});

// DELETE /api/infrastructure/equipment/:id
router.delete('/equipment/:id', authenticate, async (req, res) => {
  try {
    await prisma.equipment.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: 'Equipment not found (has logs? delete logs first)' });
  }
});

// ── Overview: รวมสถานะทั้ง 4 ระบบ (สำหรับหน้าเดียว) ──

// GET /api/infrastructure/overview
router.get('/overview', authenticate, async (req, res) => {
  try {
    const [cameras, latestDetections, waterLatest, emergencyRadio, equipment] = await Promise.all([
      prisma.camera.findMany({ orderBy: { created_at: 'desc' } }),
      prisma.detectionEvent.findMany({ orderBy: { detected_at: 'desc' }, take: 10, include: { camera: { select: { name: true, location: true } } } }),
      prisma.waterQualityReading.findMany({ orderBy: { measured_at: 'desc' }, take: 100 }),
      prisma.radioMessage.findMany({ where: { is_emergency: true }, orderBy: { received_at: 'desc' }, take: 10 }),
      prisma.equipment.findMany({ orderBy: { created_at: 'desc' } }),
    ]);
    const tanks = [...new Set(waterLatest.map((r) => r.tank_name))];
    const latestWater = tanks.map((t) => waterLatest.find((r) => r.tank_name === t)!);
    res.json({
      cameras,
      detections: latestDetections,
      water: {
        latest: latestWater,
        total: waterLatest.length,
      },
      radio: {
        emergency: emergencyRadio,
        channels: [...new Set(emergencyRadio.map((r) => r.channel))],
      },
      equipment: equipment.map((e) => ({
        ...e,
        maintenance_due: e.service_interval_hours != null && e.run_hours >= e.service_interval_hours,
      })),
    });
  } catch (err) {
    console.error('Infrastructure overview error:', err);
    res.status(500).json({ error: 'Failed to load infrastructure overview' });
  }
});

export default router;
