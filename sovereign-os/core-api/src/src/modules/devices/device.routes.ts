import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router = Router();

// GET /api/devices
router.get('/', authenticate, async (req, res) => {
  const user = req.user!;
  let where = {};
  if (user.role === 'NODE_ADMIN') {
    where = { node_id: user.assigned_node_id };
  }
  const devices = await prisma.device.findMany({ where });
  res.json(devices);
});

// ตรวจสอบพิกัด GPS (คืน null ถ้าไม่ได้ส่ง) — กันค่าผิดช่วง
function parseLocation(body: any): { latitude?: number; longitude?: number } | { error: string } {
  const out: { latitude?: number; longitude?: number } = {};
  if (body.latitude !== undefined && body.latitude !== null && body.latitude !== '') {
    const lat = Number(body.latitude);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) return { error: 'latitude must be between -90 and 90' };
    out.latitude = lat;
  }
  if (body.longitude !== undefined && body.longitude !== null && body.longitude !== '') {
    const lng = Number(body.longitude);
    if (Number.isNaN(lng) || lng < -180 || lng > 180) return { error: 'longitude must be between -180 and 180' };
    out.longitude = lng;
  }
  return out;
}

// POST /api/devices
router.post('/', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), async (req, res) => {
  const { node_id, type, mqtt_topic, is_active } = req.body;
  const loc = parseLocation(req.body);
  if ('error' in loc) return res.status(400).json({ error: loc.error });
  const device = await prisma.device.create({
    data: { node_id, type, mqtt_topic, is_active: is_active ?? true, ...loc },
  });
  res.status(201).json(device);
});

// ⚠️ ต้องวาง route ที่เป็น static path ไว้ก่อน dynamic path
// GET /api/devices/status
router.get('/status', authenticate, async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      select: {
        id: true,
        type: true,
        is_active: true,
        last_heartbeat: true,
      },
    });
    const now = Date.now();
    const result = devices.map(d => {
      const online = d.last_heartbeat && (now - new Date(d.last_heartbeat).getTime()) < 120000;
      return { ...d, online };
    });
    res.json({
      total: devices.length,
      online: result.filter(d => d.online).length,
      offline: result.filter(d => !d.online).length,
      devices: result,
    });
  } catch (err) {
    res.status(500).json({ error: 'Status error' });
  }
});

// GET /api/devices/:id
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  // ตรวจสอบว่า id เป็น UUID ที่ถูกต้อง
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'Invalid device ID format' });
  }

  try {
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) return res.status(404).json({ error: 'Not found' });
    if (req.user!.role === 'NODE_ADMIN' && device.node_id !== req.user!.assigned_node_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(device);
  } catch (err) {
    console.error('Device get error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// PUT /api/devices/:id
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'Invalid device ID format' });
  }

  try {
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) return res.status(404).json({ error: 'Not found' });
    if (req.user!.role === 'NODE_ADMIN' && device.node_id !== req.user!.assigned_node_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { type, mqtt_topic, is_active } = req.body;
    const loc = parseLocation(req.body);
    if ('error' in loc) return res.status(400).json({ error: loc.error });
    const updated = await prisma.device.update({
      where: { id },
      data: { type, mqtt_topic, is_active, ...loc },
    });
    res.json(updated);
  } catch (err) {
    console.error('Device update error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// DELETE /api/devices/:id
router.delete('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: 'Invalid device ID format' });
  }

  try {
    await prisma.device.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Device delete error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;