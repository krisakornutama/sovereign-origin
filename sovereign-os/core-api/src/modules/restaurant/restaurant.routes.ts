import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { config } from '../../config';

const router = Router();
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

// ตรวจสิทธิ์ระดับร้าน: SUPERADMIN ผ่านเสมอ, เจ้าของร้านผ่านร้านตัวเอง
function isOwnerOrSuper(user: any, restaurant: { ownerId: string | null } | null): boolean {
  if (!restaurant) return false;
  return user?.role === 'SUPERADMIN' || restaurant.ownerId === user?.id;
}

// ตรวจตัวเลขในช่วงที่กำหนด (กัน NaN/ติดลบ/พุ่งสูงผิดปกติจากภายนอก)
function numInRange(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

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
    // ผูกกล้องเป็นงาน admin — อนุญาตเฉพาะเจ้าของร้านหรือ SUPERADMIN
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id } });
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    if (!isOwnerOrSuper((req as any).user, restaurant)) return res.status(403).json({ error: 'Only the restaurant owner or SUPERADMIN can manage cameras' });
    const cameraId = req.body?.cameraId ? String(req.body.cameraId).slice(0, 100) : null;
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
    const price = numInRange(priceTHB, 0, 1_000_000);
    if (price == null) return res.status(400).json({ error: 'priceTHB must be a number between 0 and 1000000' });
    const m = await prisma.menuItem.create({
      data: { restaurantId: String(restaurantId), name: String(name).slice(0, 80), priceTHB: price, category: category ? String(category).slice(0, 30) : 'FOOD' },
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
    if (lines.length > 200) return res.status(400).json({ error: 'too many recipe lines (max 200)' });
    for (const l of lines) {
      if (!l || typeof l !== 'object') return res.status(400).json({ error: 'each line must be an object' });
      const qty = numInRange(l.qtyGram, 0, 100_000);
      if (qty == null) return res.status(400).json({ error: 'qtyGram must be a number between 0 and 100000' });
      l.qtyGram = qty;
    }
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
    if (items.length > 100) return res.status(400).json({ error: 'too many items (max 100)' });
    // ตรวจรูปร่าง items ก่อนแตะฐานข้อมูล — กัน qty ติดลบ/ทศนิยม/NaN ที่จะบิดยอดorder
    for (const it of items) {
      if (!it || typeof it !== 'object' || !it.menuId || typeof it.menuId !== 'string') {
        return res.status(400).json({ error: 'each item needs menuId (string)' });
      }
      const qty = numInRange(it.qty ?? 1, 1, 999);
      if (qty == null || !Number.isInteger(qty)) return res.status(400).json({ error: 'item qty must be an integer between 1 and 999' });
      it.qty = qty;
    }
    let total = 0;
    for (const it of items) {
      const menu = await prisma.menuItem.findUnique({ where: { id: it.menuId } });
      if (!menu) return res.status(400).json({ error: `menu ${it.menuId} not found` });
      total += Number(menu.priceTHB) * it.qty;
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
        await tx.treasuryEvent.create({ data: { user_id: actorId, type: 'SALE', amount_usd: order.totalTHB / config.restaurant.thbPerUsd, note: `ร้าน ${order.restaurantId} order ${order.orderNo} ${payment}` } as any });
      }
      return upd;
    });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Kitchen IOT — HX711 weight + DS18B20 fridge_temp ──
router.post('/iot/weight', authenticate, async (req, res) => {
  try {
    const { inventoryItemId, weightKg, deviceId } = req.body || {};
    if (!inventoryItemId || weightKg == null) return res.status(400).json({ error: 'inventoryItemId and weightKg required' });
    const w = numInRange(weightKg, 0, 10000);
    if (w == null) return res.status(400).json({ error: 'weightKg invalid' });
    const item = await prisma.inventoryItem.update({ where: { id: String(inventoryItemId) }, data: { quantity: w } });
    // บันทึก telemetry ด้วย (ให้ dashboard เห็น) — node ผ่าน config ไม่ฝังตายตัว
    try {
      await prisma.$queryRawUnsafe(
        `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value) VALUES (NOW(), $3::uuid, $1, 'kitchen_weight', $2)`,
        String(deviceId || 'hx711-kitchen').slice(0, 60), w, config.defaults.telemetryNodeId
      );
    } catch {}
    res.json({ success: true, item });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/kitchen-sensors', authenticate, async (_req, res) => {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT DISTINCT ON (metric) metric, value, time FROM sensor_telemetry WHERE metric IN ('kitchen_weight','fridge_temp','kitchen_temp','kitchen_humidity','pantry_door') ORDER BY metric, time DESC`);
    const map: Record<string, any> = {};
    for (const r of rows) map[r.metric] = { value: Number(r.value), time: r.time };
    // เช็คตู้เย็น >8°C แจ้งเตือน
    const alerts: string[] = [];
    if (map.fridge_temp && map.fridge_temp.value > 8) alerts.push(`ตู้เย็นร้อน ${map.fridge_temp.value}°C (>8°C) — เสี่ยงของเสีย`);
    if (map.kitchen_weight && map.kitchen_weight.value < 1) alerts.push(`วัตถุดิบใกล้หมด (น้ำหนัก ${map.kitchen_weight.value}kg)`);
    res.json({ sensors: map, alerts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Reports — superadmin เห็นหมด, owner เห็นร้านตัวเอง ──
router.get('/reports/summary', authenticate, async (req, res) => {
  try {
    const user = (req as any).user;
    const isSuper = user?.role === 'SUPERADMIN';
    const where: any = { status: 'PAID' };
    if (req.query.restaurantId) where.restaurantId = String(req.query.restaurantId);
    else if (!isSuper) {
      const own = await prisma.restaurant.findMany({ where: { ownerId: user.id }, select: { id: true } });
      where.restaurantId = { in: own.map(o=>o.id) };
      if (own.length===0) return res.json({ totalRevenue:0, totalOrders:0, byRestaurant:[], daily:[] });
    }
    const days = Math.min(Math.max(parseInt(String(req.query.days||'30')),1),90);
    const since = new Date(Date.now() - days*86400000);
    where.createdAt = { gte: since };
    const orders = await prisma.restaurantOrder.findMany({ where, include: { lines: true } });
    const totalRevenue = orders.reduce((s,o)=>s+o.totalTHB,0);
    const byRestaurant: Record<string, { revenue:number; count:number }> = {};
    const daily: Record<string, number> = {};
    for (const o of orders) {
      byRestaurant[o.restaurantId] = byRestaurant[o.restaurantId] || { revenue:0, count:0 };
      byRestaurant[o.restaurantId].revenue += o.totalTHB;
      byRestaurant[o.restaurantId].count += 1;
      const k = o.createdAt.toISOString().slice(0,10);
      daily[k] = (daily[k]||0)+o.totalTHB;
    }
    const restaurants = await prisma.restaurant.findMany({ where: isSuper ? {} : { ownerId: user.id } });
    const byRestaurantArr = Object.entries(byRestaurant).map(([id, v])=>({ restaurantId: id, name: restaurants.find(r=>r.id===id)?.name||id, ...v }));
    res.json({ totalRevenue, totalOrders: orders.length, avgPerOrder: orders.length? totalRevenue/orders.length:0, byRestaurant: byRestaurantArr, daily, since, days });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
