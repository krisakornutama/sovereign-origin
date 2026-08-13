import { Router } from 'express';
import { authenticate, requireRole, ensureNodeAccess } from '../../../middleware/auth.middleware';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/nodes (เฉพาะ SUPERADMIN เห็นทั้งหมด, NODE_ADMIN เห็นเฉพาะตัวเอง)
router.get('/', authenticate, async (req, res) => {
  try {
    const user = req.user!;
    let nodes;
    if (user.role === 'SUPERADMIN') {
      nodes = await prisma.node.findMany();
    } else if (user.role === 'NODE_ADMIN') {
      nodes = await prisma.node.findMany({
        where: { id: user.assigned_node_id ?? undefined },
      });
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/nodes (เฉพาะ SUPERADMIN)
router.post('/', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { name, gis_location } = req.body;
    const node = await prisma.node.create({
      data: { name, gis_location },
    });
    res.status(201).json(node);
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/nodes/:id (ใช้ ensureNodeAccess)
router.get('/:id', authenticate, ensureNodeAccess(), async (req, res) => {
  try {
    const node = await prisma.node.findUnique({ where: { id: req.params.id } });
    if (!node) return res.status(404).json({ error: 'Not found' });
    res.json(node);
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// PUT /api/nodes/:id (อัปเดตเฉพาะ SUPERADMIN หรือ NODE_ADMIN ของตัวเอง)
router.put('/:id', authenticate, ensureNodeAccess(), async (req, res) => {
  try {
    const { name, gis_location, status } = req.body;
    const node = await prisma.node.update({
      where: { id: req.params.id },
      data: { name, gis_location, status },
    });
    res.json(node);
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// DELETE /api/nodes/:id (เฉพาะ SUPERADMIN)
router.delete('/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await prisma.node.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;