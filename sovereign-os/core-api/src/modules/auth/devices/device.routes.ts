import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole, ensureNodeAccess } from '../../../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();

// GET /api/devices – list devices (filter by node if NODE_ADMIN)
router.get('/', authenticate, async (req, res) => {
  const user = req.user!;
  let where = {};
  if (user.role === 'NODE_ADMIN') {
    where = { node_id: user.assigned_node_id };
  }
  const devices = await prisma.device.findMany({ where });
  res.json(devices);
});

// POST /api/devices – create a device
router.post('/', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), async (req, res) => {
  const { node_id, type, mqtt_topic, is_active } = req.body;
  const device = await prisma.device.create({
    data: { node_id, type, mqtt_topic, is_active: is_active ?? true },
  });
  res.status(201).json(device);
});

// GET /api/devices/:id
router.get('/:id', authenticate, async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'Not found' });
  // Node access check (simplified)
  if (req.user!.role === 'NODE_ADMIN' && device.node_id !== req.user!.assigned_node_id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(device);
});

// PUT /api/devices/:id
router.put('/:id', authenticate, async (req, res) => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: 'Not found' });
  if (req.user!.role === 'NODE_ADMIN' && device.node_id !== req.user!.assigned_node_id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { type, mqtt_topic, is_active } = req.body;
  const updated = await prisma.device.update({
    where: { id: req.params.id },
    data: { type, mqtt_topic, is_active },
  });
  res.json(updated);
});

// DELETE /api/devices/:id
router.delete('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  await prisma.device.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;