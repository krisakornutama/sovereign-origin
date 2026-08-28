import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  buildPropertyMapSvg,
  generateBaguaMasterplan,
  scoreStrategicPoints,
  suggestStrategicPoints,
} from '../../services/property-strategy.service';

const router = Router();
const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];

const ZONE_TYPES = ['บ้าน', 'สวน', 'รั้ว', 'ประตู', 'ที่จอดรถ', 'โรงเก็บ', 'ที่โล่ง', 'ทางเข้า', 'อื่น'];
const POINT_TYPES = ['กล้อง', 'เซ็นเซอร์ตรวจจับ', 'กับดัก', 'ไฟ'];

// ขนาดที่ดิน (ค่าเริ่มต้น 30×20 ม. — ตั้งได้ผ่าน env LAND_WIDTH/LAND_LENGTH)
const LAND_WIDTH = Number(process.env.LAND_WIDTH || 30);
const LAND_LENGTH = Number(process.env.LAND_LENGTH || 20);

// ── โซน ──
router.get('/zones', authenticate, async (_req, res) => {
  try {
    const zones = await prisma.propertyZone.findMany({ orderBy: { created_at: 'asc' } });
    res.json({ zones, land: { width: LAND_WIDTH, length: LAND_LENGTH } });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'โหลดโซนไม่สำเร็จ') });
  }
});

router.post('/zones', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.name ?? '').trim()) return res.status(400).json({ error: 'name is required' });
    const zone = await prisma.propertyZone.create({
      data: {
        name: String(b.name).trim().slice(0, 80),
        type: ZONE_TYPES.includes(b.type) ? b.type : 'อื่น',
        x: Number(b.x) || 0, y: Number(b.y) || 0, z: Number(b.z) || 0,
        width_m: Number(b.width_m) || 2, length_m: Number(b.length_m) || 2, height_m: Number(b.height_m) || 2,
        color: b.color ? String(b.color).slice(0, 20) : null,
        note: b.note ? String(b.note).trim().slice(0, 300) : null,
      },
    });
    res.status(201).json({ success: true, zone });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เพิ่มโซนไม่สำเร็จ') });
  }
});

router.put('/zones/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const data: Record<string, unknown> = {};
    if (b.name) data.name = String(b.name).trim().slice(0, 80);
    if (b.type) data.type = ZONE_TYPES.includes(b.type) ? b.type : data.type;
    if (b.x != null) data.x = Number(b.x) || 0;
    if (b.y != null) data.y = Number(b.y) || 0;
    if (b.z != null) data.z = Number(b.z) || 0;
    if (b.width_m != null) data.width_m = Number(b.width_m) || 1;
    if (b.length_m != null) data.length_m = Number(b.length_m) || 1;
    if (b.height_m != null) data.height_m = Number(b.height_m) || 1;
    if (b.color !== undefined) data.color = b.color ? String(b.color).slice(0, 20) : null;
    if (b.note !== undefined) data.note = b.note ? String(b.note).trim().slice(0, 300) : null;
    await prisma.propertyZone.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'อัปเดตโซนไม่สำเร็จ') });
  }
});

router.delete('/zones/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    await prisma.propertyZone.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบโซนไม่สำเร็จ') });
  }
});

// ── จุดยุทธศาสตร์ ──
router.get('/points', authenticate, async (_req, res) => {
  try {
    const points = await prisma.strategicPoint.findMany({ orderBy: { created_at: 'asc' } });
    res.json({ points });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'โหลดจุดไม่สำเร็จ') });
  }
});

router.post('/points', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.name ?? '').trim()) return res.status(400).json({ error: 'name is required' });
    const point = await prisma.strategicPoint.create({
      data: {
        name: String(b.name).trim().slice(0, 80),
        type: POINT_TYPES.includes(b.type) ? b.type : 'เซ็นเซอร์ตรวจจับ',
        zone_id: b.zone_id || null,
        x: Number(b.x) || 0, y: Number(b.y) || 0, z: Number(b.z) || 0,
        radius_m: Number(b.radius_m) || 4,
        reason: b.reason ? String(b.reason).trim().slice(0, 300) : null,
        enabled: b.enabled !== false,
      },
    });
    res.status(201).json({ success: true, point });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'เพิ่มจุดไม่สำเร็จ') });
  }
});

router.put('/points/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const data: Record<string, unknown> = {};
    if (b.name) data.name = String(b.name).trim().slice(0, 80);
    if (b.type) data.type = POINT_TYPES.includes(b.type) ? b.type : data.type;
    if (b.x != null) data.x = Number(b.x) || 0;
    if (b.y != null) data.y = Number(b.y) || 0;
    if (b.z != null) data.z = Number(b.z) || 0;
    if (b.radius_m != null) data.radius_m = Number(b.radius_m) || 1;
    if (b.enabled !== undefined) data.enabled = Boolean(b.enabled);
    if (b.reason !== undefined) data.reason = b.reason ? String(b.reason).trim().slice(0, 300) : null;
    await prisma.strategicPoint.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'อัปเดตจุดไม่สำเร็จ') });
  }
});

router.delete('/points/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    await prisma.strategicPoint.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: String(err?.message || 'ลบจุดไม่สำเร็จ') });
  }
});

// POST /api/property/points/:id/trigger — จำลองเหตุการณ์ตรวจจับ (คน/สัตว์ผ่าน) → แจ้งเตือน
router.post('/points/:id/trigger', authenticate, async (req, res) => {
  try {
    const point = await prisma.strategicPoint.findUnique({ where: { id: req.params.id } });
    if (!point) return res.status(404).json({ error: 'Point not found' });
    if (!point.enabled) return res.status(400).json({ error: 'จุดนี้ถูกปิดอยู่' });
    await prisma.strategicPoint.update({
      where: { id: point.id },
      data: { last_triggered_at: new Date() },
    });
    const subject = String(req.body?.subject || 'บุคคล/สัตว์').slice(0, 60);
    const message =
      `🚨 แผนที่บ้าน: ตรวจจับการเคลื่อนไหวที่ "${point.name}" (${point.type})\n` +
      `📌 สิ่งที่ตรวจพบ: ${subject}\n` +
      `📍 ตำแหน่ง: x=${point.x} y=${point.y} z=${point.z} · รัศมี ${point.radius_m} ม.\n` +
      `💬 เหตุผลที่วาง: ${point.reason || 'จุดยุทธศาสตร์'}`;
    // บันทึกเป็น security event ด้วย (สอดคล้องระบบความปลอดภัย)
    await prisma.securityEvent.create({
      data: {
        event_type: 'INTRUSION',
        severity: 'warning',
        description: message,
        raw_data: { point_id: point.id, point_type: point.type, x: point.x, y: point.y },
      },
    });
    let telegram = false;
    try {
      const { sendTelegram } = await import('../telegram/telegram.routes');
      await sendTelegram(message);
      telegram = true;
    } catch {
      telegram = false;
    }
    res.json({ success: true, message, telegram });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'trigger ไม่สำเร็จ') });
  }
});

// GET /api/property/strategy — คะแนนจุดยุทธศาสตร์ + คำแนะนำจุดใหม่
router.get('/strategy', authenticate, async (_req, res) => {
  try {
    const [zones, points] = await Promise.all([
      prisma.propertyZone.findMany({ orderBy: { created_at: 'asc' } }),
      prisma.strategicPoint.findMany({ orderBy: { created_at: 'asc' } }),
    ]);
    const scored = scoreStrategicPoints(zones, points, LAND_WIDTH, LAND_LENGTH);
    const suggestions = suggestStrategicPoints(zones, LAND_WIDTH, LAND_LENGTH);
    res.json({ scored, suggestions, land: { width: LAND_WIDTH, length: LAND_LENGTH } });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'วิเคราะห์จุดยุทธศาสตร์ไม่สำเร็จ') });
  }
});

// GET /api/property/map.svg — แผนที่จำลอง (2D + ไอโซเมตริก 3D)
router.get('/map.svg', authenticate, async (_req, res) => {
  try {
    const [zones, points] = await Promise.all([
      prisma.propertyZone.findMany({ orderBy: { created_at: 'asc' } }),
      prisma.strategicPoint.findMany({ orderBy: { created_at: 'asc' } }),
    ]);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildPropertyMapSvg(zones, points, LAND_WIDTH, LAND_LENGTH));
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'สร้างแผนที่ไม่สำเร็จ') });
  }
});

// GET /api/property/bagua-masterplan — พิมพ์เขียวค่ายกล ปรับตามขนาดที่ดินจริง
//  query: width=80&length=60 (ค่าเริ่มต้น 3 ไร่ = 80×60 ม.), regenerate=1 เพื่อทับตำแหน่งเดิม
router.get('/bagua-masterplan', authenticate, async (req, res) => {
  try {
    const width = Math.min(2000, Math.max(10, Number(req.query.width) || Number(process.env.BAGUA_WIDTH) || 80));
    const length = Math.min(2000, Math.max(10, Number(req.query.length) || Number(process.env.BAGUA_LENGTH) || 60));
    const regenerate = req.query.regenerate === '1' || req.query.regenerate === 'true';
    const plan = generateBaguaMasterplan(width, length);
    const created = { zones: 0, points: 0 };
    const updated = { zones: 0, points: 0 };

    for (const z of plan.zones) {
      const data = {
        type: z.type,
        x: z.x, y: z.y, z: z.z,
        width_m: z.width_m, length_m: z.length_m, height_m: z.height_m,
        color: z.color,
        note: z.note,
      };
      const existing = await prisma.propertyZone.findFirst({ where: { name: z.name } });
      if (existing) {
        if (regenerate) await prisma.propertyZone.update({ where: { id: existing.id }, data });
        updated.zones++;
      } else {
        await prisma.propertyZone.create({ data: { name: z.name, ...data } });
        created.zones++;
      }
    }

    for (const p of plan.points) {
      const zone = await prisma.propertyZone.findFirst({ where: { name: p.zoneName } });
      const data = {
        type: p.type,
        x: p.x, y: p.y, z: p.z,
        radius_m: p.radius_m,
        reason: p.reason,
        zone_id: zone?.id ?? null,
        enabled: true,
      };
      const existing = await prisma.strategicPoint.findFirst({ where: { name: p.name } });
      if (existing) {
        if (regenerate) await prisma.strategicPoint.update({ where: { id: existing.id }, data });
        updated.points++;
      } else {
        await prisma.strategicPoint.create({ data: { name: p.name, ...data } });
        created.points++;
      }
    }

    const [zones, points] = await Promise.all([
      prisma.propertyZone.findMany({ orderBy: { created_at: 'asc' } }),
      prisma.strategicPoint.findMany({ orderBy: { created_at: 'asc' } }),
    ]);
    const svg = buildPropertyMapSvg(zones, points, plan.land.width, plan.land.length);
    res.json({ success: true, plan, created, updated, land: plan.land, zones, points, svg });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || 'สร้างพิมพ์เขียวค่ายกลไม่สำเร็จ') });
  }
});

export default router;
