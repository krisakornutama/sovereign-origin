import { Router, Request } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  computeExpiryStatus,
  computeStockStatus,
  computeExpiryDate,
  isCategoryValid,
  type ExpiryStatus,
} from '../../services/inventory.service';

const router = Router();
export { prisma };

const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

interface InventoryRow {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unit_price_usd: number;
  location: string | null;
  expiry_date: Date | null;
  shelf_life_days: number | null;
  minimum_stock: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

/** ประกอบ item + สถานะหมดอายุ/สต็อก (คำนวณฝั่งเซิร์ฟเวอร์ เพื่อให้ UI ไม่ต้องคำนวณเอง) */
function enrich(item: InventoryRow) {
  const expiry = computeExpiryStatus(item.expiry_date);
  const stock = computeStockStatus(item.quantity, item.minimum_stock);
  return {
    ...item,
    expiry: { ...expiry, date: item.expiry_date ? item.expiry_date.toISOString() : null },
    lowStock: stock.low,
  };
}

function parseNullableDate(value: unknown): Date | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

// ── รายการเสบียง ──

// ── พอร์ตแยกต่อคน: สมาชิกเห็นเสบียงของตัวเองเท่านั้น (backend บังคับ ไม่เชื่อฝั่ง UI)
// SUPERADMIN ดูเสบียงสมาชิกคนอื่นได้ผ่าน ?userId=<uuid> (ถ้าไม่ส่ง = ของตัวเอง)
function resolveOwnerId(req: Request): string {
  if (req.user?.role === 'SUPERADMIN' && typeof req.query.userId === 'string' && req.query.userId.trim()) {
    return req.query.userId.trim();
  }
  return req.user?.id ?? '';
}

// GET /api/inventory — รายการของเจ้าของ พร้อม filter: ?category=&status=&low=true
router.get('/', authenticate, async (req, res) => {
  try {
    const { category, status, low } = req.query;
    const where: Record<string, unknown> = { user_id: resolveOwnerId(req) };
    if (category && category !== 'ALL') where.category = String(category);

    const rows = (await prisma.inventoryItem.findMany({
      where,
      orderBy: [{ expiry_date: 'asc' }, { name: 'asc' }],
    })) as InventoryRow[];

    let items = rows.map(enrich);
    if (status === 'expired') items = items.filter((i) => i.expiry.status === 'expired');
    else if (status === 'expiring') items = items.filter((i) => i.expiry.status === 'expiring');
    else if (status === 'ok') items = items.filter((i) => i.expiry.status === 'ok');
    else if (status === 'no-expiry') items = items.filter((i) => i.expiry.status === 'na');
    if (low === 'true') items = items.filter((i) => i.lowStock);

    res.json({ items, total: items.length });
  } catch (err) {
    console.error('Inventory list error:', err);
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});

// GET /api/inventory/status — ตัวเลขสรุปสำหรับหน้าแรก (หมดอายุ / ใกล้หมด / น้ำ / อาหาร)
router.get('/status', authenticate, async (req, res) => {
  try {
    const rows = (await prisma.inventoryItem.findMany({
      where: { user_id: resolveOwnerId(req) },
    })) as InventoryRow[];
    const items = rows.map(enrich);
    const countBy = (status: ExpiryStatus | 'low') =>
      status === 'low'
        ? items.filter((i) => i.lowStock).length
        : items.filter((i) => i.expiry.status === status).length;
    const totalByCategory = (category: string) =>
      items.filter((i) => i.category === category).length;

    // ของที่ใกล้หมดอายุเรียงจากด่วนสุด (เหลือวันน้อยสุดก่อน)
    const expiringSoon = items
      .filter((i) => i.expiry.status === 'expiring' || i.expiry.status === 'expired')
      .sort((a, b) => (a.expiry.daysLeft ?? 0) - (b.expiry.daysLeft ?? 0))
      .slice(0, 10)
      .map((i) => ({ id: i.id, name: i.name, category: i.category, ...i.expiry }));

    res.json({
      totals: {
        items: items.length,
        water: totalByCategory('WATER'),
        food: totalByCategory('FOOD'),
        expiring: countBy('expiring'),
        expired: countBy('expired'),
        lowStock: countBy('low'),
      },
      expiringSoon,
    });
  } catch (err) {
    console.error('Inventory status error:', err);
    res.status(500).json({ error: 'Failed to load inventory status' });
  }
});

// POST /api/inventory — เพิ่มรายการ (ถ้าใส่ shelf_life_days จะคำนวณ expiry_date ให้อัตโนมัติ)
router.post('/', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const {
      name,
      category,
      quantity,
      unit,
      unit_price_usd,
      location,
      expiry_date,
      shelf_life_days,
      minimum_stock,
      notes,
    } = req.body || {};

    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    const cat = String(category || 'OTHER').toUpperCase();
    if (!isCategoryValid(cat)) {
      return res.status(400).json({
        error: `Invalid category — ใช้ได้: WATER, FOOD, FUEL, MATERIAL, PRECIOUS_METAL, OTHER`,
      });
    }
    if (!(Number(quantity) >= 0)) {
      return res.status(400).json({ error: 'quantity must be >= 0' });
    }

    // วันหมดอายุ: ระบุตรง ๆ หรือคำนวณจาก shelf_life_days (รับของเข้าชุดใหม่)
    const parsedExpiry = parseNullableDate(expiry_date);
    if (parsedExpiry === 'invalid') {
      return res.status(400).json({ error: 'expiry_date is not a valid date' });
    }
    let expiry: Date | null = parsedExpiry;
    const shelfDays =
      shelf_life_days === undefined || shelf_life_days === null || shelf_life_days === ''
        ? null
        : Number(shelf_life_days);
    if (expiry == null && shelfDays != null) {
      expiry = computeExpiryDate(shelfDays);
    }

    const item = await prisma.inventoryItem.create({
      data: {
        user_id: req.user?.id || '',
        name: String(name),
        category: cat,
        quantity: Number(quantity),
        unit: String(unit || 'piece'),
        unit_price_usd: Number(unit_price_usd) || 0,
        location: location || null,
        expiry_date: expiry,
        shelf_life_days: shelfDays != null && Number.isFinite(shelfDays) ? Math.floor(shelfDays) : null,
        minimum_stock:
          minimum_stock === undefined || minimum_stock === null || minimum_stock === ''
            ? null
            : Number(minimum_stock),
        notes: notes || null,
      },
    });
    res.status(201).json({ success: true, id: item.id });
  } catch (err) {
    console.error('Create inventory error:', err);
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

// PUT /api/inventory/:id — แก้ไขรายการของตัวเอง (fields ที่ไม่ส่ง = คงค่าเดิม)
router.put('/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.inventoryItem.findFirst({ where: { id, user_id: resolveOwnerId(req) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const body = req.body || {};
    const data: Record<string, unknown> = {};
    const fields: Array<[string, (v: unknown) => unknown]> = [
      ['name', (v) => (v !== undefined ? String(v) : undefined)],
      ['category', (v) => (v !== undefined ? String(v).toUpperCase() : undefined)],
      ['quantity', (v) => (v !== undefined ? Number(v) : undefined)],
      ['unit', (v) => (v !== undefined ? String(v) : undefined)],
      ['unit_price_usd', (v) => (v !== undefined ? Number(v) : undefined)],
      ['location', (v) => (v === undefined ? undefined : v === '' || v === null ? null : String(v))],
      ['notes', (v) => (v === undefined ? undefined : v === '' || v === null ? null : String(v))],
      ['minimum_stock', (v) => (v === undefined ? undefined : v === '' || v === null ? null : Number(v))],
      ['shelf_life_days', (v) => (v === undefined ? undefined : v === '' || v === null ? null : Math.floor(Number(v)))],
    ];
    for (const [key, fn] of fields) {
      if (key in body) {
        const value = fn(body[key]);
        if (key === 'name' && (value === undefined || String(value).trim() === '')) {
          return res.status(400).json({ error: 'name cannot be empty' });
        }
        if (key === 'category' && value !== undefined && !isCategoryValid(String(value))) {
          return res.status(400).json({ error: `Invalid category — ใช้ได้: WATER, FOOD, FUEL, MATERIAL, PRECIOUS_METAL, OTHER` });
        }
        if (key === 'quantity' && value !== undefined && !(Number(value) >= 0)) {
          return res.status(400).json({ error: 'quantity must be >= 0' });
        }
        if (value !== undefined) data[key] = value;
      }
    }
    if ('expiry_date' in body) {
      const parsed = parseNullableDate(body.expiry_date);
      if (parsed === 'invalid') return res.status(400).json({ error: 'expiry_date is not a valid date' });
      data.expiry_date = parsed;
    }

    const updated = await prisma.inventoryItem.update({ where: { id }, data });
    res.json({ success: true, id: updated.id });
  } catch (err) {
    console.error('Update inventory error:', err);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

// DELETE /api/inventory/:id — ลบรายการของตัวเอง (ขาย/ใช้หมด/ทิ้ง)
router.delete('/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const existing = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await prisma.inventoryItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete inventory error:', err);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

export default router;
