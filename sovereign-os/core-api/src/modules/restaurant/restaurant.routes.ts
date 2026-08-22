import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

const router = Router();
const prisma = new PrismaClient();
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

// ── Restaurant ──
router.post('/', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const r = await prisma.restaurant.create({ data: { name: name.slice(0, 80), ownerId: (req as any).user?.id } });
    res.status(201).json(r);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/', authenticate, async (_req, res) => {
  const list = await prisma.restaurant.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(list);
});

router.put('/:id/camera', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const cameraId = req.body?.cameraId ? String(req.body.cameraId) : null;
    const r = await prisma.restaurant.update({ where: { id: req.params.id }, data: { cameraId } });
    res.json(r);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ── Customers (ใบหน้า + แต้ม) ──
router.post('/customers', authenticate, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const c = await prisma.restaurantCustomer.create({
      data: {
        name: name.slice(0, 80),
        phone: req.body?.phone ? String(req.body.phone).slice(0, 20) : null,
        knownFaceId: req.body?.knownFaceId ? String(req.body.knownFaceId) : null,
        consentFace: !!req.body?.consentFace,
      },
    });
    res.status(201).json(c);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.post('/customers/face-enroll', authenticate, async (req, res) => {
  try {
    const { name, phone, imageBase64, consentFace } = req.body || {};
    if (!name || !imageBase64) return res.status(400).json({ error: 'name and imageBase64 required' });
    if (!consentFace) return res.status(400).json({ error: 'consentFace required for PDPA' });
    // สร้าง KnownFace แบบง่าย (เก็บ embedding ภายหลังค่อยผูก face-embed)
    const face = await prisma.knownFace.create({ data: { name: String(name).slice(0, 80), imagePath: String(imageBase64).slice(0, 5000) } as any });
    const customer = await prisma.restaurantCustomer.create({
      data: { name: String(name).slice(0, 80), phone: phone ? String(phone).slice(0, 20) : null, knownFaceId: (face as any).id, consentFace: true },
    });
    res.status(201).json({ customer, faceId: (face as any).id });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/customers', authenticate, async (_req, res) => {
  const list = await prisma.restaurantCustomer.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(list);
});

// ── Menu + Recipe ──
router.post('/menus', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { restaurantId, name, priceTHB, category } = req.body || {};
    if (!restaurantId || !name || priceTHB == null) return res.status(400).json({ error: 'restaurantId, name, priceTHB required' });
    const m = await prisma.menuItem.create({
      data: { restaurantId: String(restaurantId), name: String(name).slice(0, 80), priceTHB: Number(priceTHB), category: category ? String(category).slice(0, 30) : 'FOOD' },
    });
    res.status(201).json(m);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.get('/menus', authenticate, async (req, res) => {
  const where: any = {};
  if (req.query.restaurantId) where.restaurantId = String(req.query.restaurantId);
  const list = await prisma.menuItem.findMany({ where, include: { recipes: true }, orderBy: { createdAt: 'desc' } });
  res.json(list);
});

router.put('/menus/:id/recipe', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    // ลบสูตรเก่าแล้วสร้างใหม่
    await prisma.recipeLine.deleteMany({ where: { menuId: req.params.id } });
    for (const l of lines) {
      await prisma.recipeLine.create({
        data: {
          menuId: req.params.id,
          inventoryItemId: l.inventoryItemId ? String(l.inventoryItemId) : null,
          farmCrop: l.farmCrop ? String(l.farmCrop).slice(0, 80) : null,
          qtyGram: Number(l.qtyGram) || 0,
          isSelfProduced: l.isSelfProduced !== false,
          isOptional: !!l.isOptional,
        },
      });
    }
    const menu = await prisma.menuItem.findUnique({ where: { id: req.params.id }, include: { recipes: true } });
    res.json(menu);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.get('/menus/available', authenticate, async (req, res) => {
  try {
    const restaurantId = String(req.query.restaurantId || '');
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId required' });
    const menus = await prisma.menuItem.findMany({ where: { restaurantId, isActive: true }, include: { recipes: true } });
    const result = [];
    for (const m of menus) {
      let canMake = true;
      let missing: string[] = [];
      for (const r of m.recipes) {
        if (r.isOptional) continue;
        if (r.inventoryItemId) {
          const inv = await prisma.inventoryItem.findUnique({ where: { id: r.inventoryItemId } });
          if (!inv || inv.quantity * 1000 < r.qtyGram) { canMake = false; missing.push(r.farmCrop || r.inventoryItemId); }
        } else if (r.isSelfProduced) {
          // วัตถุดิบผลิตเองแต่ไม่มี inventory -> ทำไม่ได้
          canMake = false; missing.push(r.farmCrop || 'self-produced');
        }
      }
      result.push({ ...m, canMake, missing });
    }
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Orders ──
function genOrderNo() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${d}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

router.post('/orders', authenticate, async (req, res) => {
  try {
    const { restaurantId, items, tableNo, type, customerId } = req.body || {};
    if (!restaurantId || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'restaurantId and items required' });
    let total = 0;
    for (const it of items) {
      const menu = await prisma.menuItem.findUnique({ where: { id: it.menuId } });
      if (!menu) return res.status(400).json({ error: `menu ${it.menuId} not found` });
      total += Number(menu.priceTHB) * Number(it.qty || 1);
    }
    const order = await prisma.restaurantOrder.create({
      data: {
        orderNo: genOrderNo(),
        restaurantId: String(restaurantId),
        customerId: customerId ? String(customerId) : null,
        tableNo: tableNo ? String(tableNo).slice(0, 20) : null,
        type: type === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN',
        totalTHB: total,
        status: 'PENDING',
      },
    });
    for (const it of items) {
      const menu = await prisma.menuItem.findUnique({ where: { id: it.menuId } });
      await prisma.restaurantOrderLine.create({ data: { orderId: order.id, menuId: it.menuId, qty: Number(it.qty || 1), priceAtOrder: Number(menu!.priceTHB) } });
    }
    const full = await prisma.restaurantOrder.findUnique({ where: { id: order.id }, include: { lines: true } });
    res.status(201).json(full);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/orders', authenticate, async (req, res) => {
  const where: any = {};
  if (req.query.restaurantId) where.restaurantId = String(req.query.restaurantId);
  if (req.query.status) where.status = String(req.query.status);
  const list = await prisma.restaurantOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, include: { lines: true } });
  res.json(list);
});

router.post('/orders/:id/pay', authenticate, async (req, res) => {
  try {
    const order = await prisma.restaurantOrder.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'PAID') return res.json(order);
    const payment = req.body?.payment === 'PROMPTPAY' ? 'PROMPTPAY' : 'CASH';
    const pointsEarned = Math.floor(order.totalTHB / 20);
    const actorId = (req as any).user?.id;
    const updated = await prisma.$transaction(async (tx) => {
      for (const line of order.lines) {
        const menu = await tx.menuItem.findUnique({ where: { id: line.menuId }, include: { recipes: true } });
        for (const r of menu?.recipes || []) {
          if (r.inventoryItemId) {
            const inv = await tx.inventoryItem.findUnique({ where: { id: r.inventoryItemId } });
            if (inv) {
              const needKg = (r.qtyGram * line.qty) / 1000;
              await tx.inventoryItem.update({ where: { id: inv.id }, data: { quantity: Math.max(0, inv.quantity - needKg) } });
            }
          }
        }
      }
      const upd = await tx.restaurantOrder.update({ where: { id: order.id }, data: { status: 'PAID', payment, pointsEarned } });
      if (order.customerId && pointsEarned > 0) {
        await tx.restaurantCustomer.update({ where: { id: order.customerId }, data: { points: { increment: pointsEarned } } });
      }
      if (actorId) {
        await tx.treasuryEvent.create({ data: { user_id: actorId, type: 'SALE', amount_usd: order.totalTHB / 35, note: `ร้าน ${order.restaurantId} order ${order.orderNo} ${payment}` } as any });
      }
      return upd;
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
