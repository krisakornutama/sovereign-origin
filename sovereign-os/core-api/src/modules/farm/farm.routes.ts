import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { buildFarmMapSvg } from '../../services/farm-map.service';

const router = Router();
export const prisma = new PrismaClient();

const WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'];
const VALID_STATUSES = ['active', 'growing', 'harvested', 'fallow'];
const DAY_MS = 86_400_000;

// GET /api/farm/plots — แปลงทั้งหมด (?status=active&upcoming=true = เฉพาะแปลงที่ใกล้เก็บเกี่ยว)
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, upcoming } = req.query;
    const where: Record<string, unknown> = {};
    if (status && VALID_STATUSES.includes(String(status))) where.status = String(status);

    const plots = await prisma.farmPlot.findMany({
      where,
      orderBy: [{ expected_harvest_at: 'asc' }, { name: 'asc' }],
    });

    let result = plots;
    if (upcoming === 'true') {
      const soon = new Date(Date.now() + 30 * DAY_MS);
      result = plots.filter(
        (p) =>
          p.expected_harvest_at &&
          new Date(p.expected_harvest_at) <= soon &&
          p.status !== 'harvested'
      );
    }

    res.json({
      plots: result.map((p) => ({
        ...p,
        daysToHarvest: p.expected_harvest_at
          ? Math.ceil((new Date(p.expected_harvest_at).getTime() - Date.now()) / DAY_MS)
          : null,
      })),
    });
  } catch (err) {
    console.error('Farm plots list error:', err);
    res.status(500).json({ error: 'Failed to load plots' });
  }
});

// GET /api/farm/plots/overview — สรุปแปลง (นับตามสถานะ + แปลงที่ใกล้เก็บเกี่ยว)
router.get('/overview', authenticate, async (req, res) => {
  try {
    const plots = await prisma.farmPlot.findMany();
    const byStatus: Record<string, number> = {};
    for (const status of VALID_STATUSES) byStatus[status] = 0;
    for (const p of plots) byStatus[p.status] = (byStatus[p.status] || 0) + 1;

    const soon = new Date(Date.now() + 30 * DAY_MS);
    const upcomingHarvests = plots
      .filter(
        (p) => p.expected_harvest_at && new Date(p.expected_harvest_at) <= soon && p.status !== 'harvested'
      )
      .sort((a, b) => new Date(a.expected_harvest_at!).getTime() - new Date(b.expected_harvest_at!).getTime())
      .map((p) => ({
        id: p.id,
        name: p.name,
        crop: p.crop,
        expected_harvest_at: p.expected_harvest_at,
        daysLeft: Math.ceil((new Date(p.expected_harvest_at!).getTime() - Date.now()) / DAY_MS),
      }));

    res.json({ totals: { plots: plots.length, ...byStatus }, upcomingHarvests });
  } catch (err) {
    console.error('Farm plots overview error:', err);
    res.status(500).json({ error: 'Failed to load plot overview' });
  }
});

// GET /api/farm/plots/map.svg — แผนที่แปลง (SVG จากข้อมูลจริง) สำหรับฝังในหน้า /farm
router.get('/map.svg', authenticate, async (req, res) => {
  try {
    const plots = await prisma.farmPlot.findMany();
    const svg = buildFarmMapSvg(plots);
    res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch (err) {
    console.error('Farm map svg error:', err);
    res.status(500).json({ error: 'Failed to build farm map' });
  }
});

// POST /api/farm/plots — เพิ่มแปลง
router.post('/', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { name, location, crop, area_sqm, soil_notes, planted_at, expected_harvest_at, status, notes } =
      req.body || {};

    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    const plotStatus = status ? String(status) : 'active';
    if (!VALID_STATUSES.includes(plotStatus)) {
      return res.status(400).json({ error: `Invalid status — ใช้ได้: ${VALID_STATUSES.join(', ')}` });
    }
    const parseDate = (v: unknown): Date | null | 'invalid' => {
      if (v === undefined || v === null || v === '') return null;
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? 'invalid' : d;
    };
    const planted = parseDate(planted_at);
    const harvest = parseDate(expected_harvest_at);
    if (planted === 'invalid' || harvest === 'invalid') {
      return res.status(400).json({ error: 'planted_at / expected_harvest_at must be valid dates' });
    }

    const plot = await prisma.farmPlot.create({
      data: {
        name: String(name),
        location: location || null,
        crop: crop || null,
        area_sqm: area_sqm === undefined || area_sqm === null || area_sqm === '' ? null : Number(area_sqm),
        soil_notes: soil_notes || null,
        planted_at: planted,
        expected_harvest_at: harvest,
        status: plotStatus,
        notes: notes || null,
      },
    });
    res.status(201).json({ success: true, id: plot.id });
  } catch (err) {
    console.error('Create plot error:', err);
    res.status(500).json({ error: 'Failed to create plot' });
  }
});

// PUT /api/farm/plots/:id — แก้ไขแปลง / เปลี่ยนสถานะ (เก็บเกี่ยวแล้ว, พักแปลง ฯลฯ)
router.put('/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.farmPlot.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const body = req.body || {};
    const data: Record<string, unknown> = {};
    const textFields = ['name', 'location', 'crop', 'soil_notes', 'notes'] as const;
    for (const key of textFields) {
      if (key in body) {
        const v = body[key];
        data[key] = v === undefined ? undefined : v === '' || v === null ? null : String(v);
        if (key === 'name' && (data[key] === null || String(data[key]).trim() === '')) {
          return res.status(400).json({ error: 'name cannot be empty' });
        }
      }
    }
    if ('area_sqm' in body) {
      const v = body.area_sqm;
      data.area_sqm = v === '' || v === null ? null : Number(v);
    }
    if ('status' in body) {
      const s = String(body.status);
      if (!VALID_STATUSES.includes(s)) {
        return res.status(400).json({ error: `Invalid status — ใช้ได้: ${VALID_STATUSES.join(', ')}` });
      }
      data.status = s;
    }
    const parseDate = (v: unknown): Date | null | 'invalid' => {
      if (v === undefined || v === null || v === '') return null;
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? 'invalid' : d;
    };
    for (const key of ['planted_at', 'expected_harvest_at'] as const) {
      if (key in body) {
        const parsed = parseDate(body[key]);
        if (parsed === 'invalid') return res.status(400).json({ error: `${key} must be a valid date` });
        data[key] = parsed;
      }
    }

    const updated = await prisma.farmPlot.update({ where: { id }, data });
    res.json({ success: true, id: updated.id });
  } catch (err) {
    console.error('Update plot error:', err);
    res.status(500).json({ error: 'Failed to update plot' });
  }
});

// DELETE /api/farm/plots/:id — ลบแปลง
router.delete('/:id', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    await prisma.farmPlot.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete plot error:', err);
    res.status(500).json({ error: 'Failed to delete plot' });
  }
});

// ── วิเคราะห์ดิน + NPK / ความชื้น ──

// PUT /api/farm/plots/:id/geometry { width_m, length_m, layout_image_url, boundary } — ขนาด/รูป/ขอบเขตแปลง
router.put('/:id/geometry', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const { width_m, length_m, layout_image_url, boundary } = req.body || {};
    const data: Record<string, unknown> = {};
    if (width_m != null) data.width_m = Number(width_m) || null;
    if (length_m != null) data.length_m = Number(length_m) || null;
    if (layout_image_url != null) data.layout_image_url = String(layout_image_url).trim().slice(0, 2000) || null;
    if (boundary != null) data.boundary = boundary;
    const updated = await prisma.farmPlot.update({ where: { id: req.params.id }, data });
    res.json({ success: true, id: updated.id });
  } catch (err) {
    console.error('Plot geometry error:', err);
    res.status(500).json({ error: 'Failed to update plot geometry' });
  }
});

// POST /api/farm/plots/:id/soil-readings { n, p, k, ph, moisture_pct, ec, note } — บันทึกค่าดิน
router.post('/:id/soil-readings', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
    const reading = await prisma.farmSoilReading.create({
      data: {
        plot_id: req.params.id,
        n: num(b.n), p: num(b.p), k: num(b.k),
        ph: num(b.ph), moisture_pct: num(b.moisture_pct), ec: num(b.ec),
        note: b.note ? String(b.note).trim().slice(0, 300) : null,
      },
    });
    res.status(201).json({ success: true, reading });
  } catch (err) {
    console.error('Soil reading error:', err);
    res.status(500).json({ error: 'Failed to save soil reading' });
  }
});

// GET /api/farm/plots/:id/soil-readings — ประวัติค่าดิน
router.get('/:id/soil-readings', authenticate, async (req, res) => {
  try {
    const readings = await prisma.farmSoilReading.findMany({
      where: { plot_id: req.params.id },
      orderBy: { recorded_at: 'desc' },
      take: 30,
    });
    res.json({ readings });
  } catch (err) {
    console.error('Soil readings list error:', err);
    res.status(500).json({ error: 'Failed to load soil readings' });
  }
});

// POST /api/farm/plots/:id/harvest {yieldKg, grade?, note?} — เก็บเกี่ยว -> InventoryItem + harvested
router.post('/:id/harvest', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const plot = await prisma.farmPlot.findUnique({ where: { id: req.params.id } });
    if (!plot) return res.status(404).json({ error: 'Plot not found' });
    const yieldKg = Number(req.body?.yieldKg);
    if (!yieldKg || yieldKg <= 0) return res.status(400).json({ error: 'yieldKg must be > 0' });
    if (yieldKg > 100000) return res.status(400).json({ error: 'yieldKg too large (max 100000)' });
    const grade = req.body?.grade ? String(req.body.grade).slice(0, 20) : null;
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
    const userId = (req as any).user?.id as string;
    const cropName = plot.crop || plot.name;
    // สร้างวัตถุดิบใน Inventory (FOOD) ผูกกับผู้เก็บเกี่ยว
    const item = await prisma.inventoryItem.create({
      data: {
        user_id: userId,
        name: `${cropName}${grade ? ` (${grade})` : ''}`,
        category: 'FOOD',
        quantity: yieldKg,
        unit: 'kg',
        unit_price_usd: 0,
        location: plot.name,
        notes: note ? `จากแปลง ${plot.name} — ${note}` : `จากแปลง ${plot.name}`,
      },
    });
    await prisma.farmPlot.update({ where: { id: plot.id }, data: { status: 'harvested' } });
    res.status(201).json({ success: true, inventoryId: item.id, plotId: plot.id, yieldKg });
  } catch (err) {
    console.error('Harvest error:', err);
    res.status(500).json({ error: 'Failed to harvest' });
  }
});

// GET /api/farm/plots/:id/analysis?crop=ทุเรียน — วิเคราะห์ดินเทียบกับพืชที่ต้องการปลูก
router.get('/:id/analysis', authenticate, async (req, res) => {
  try {
    const { analyzeSoil, soilAmendmentPlan, CROP_IDEALS } = await import('../../services/farm-soil.service');
    const crop = String(req.query.crop || req.query.plant || '').trim() || null;
    const plot = await prisma.farmPlot.findUnique({ where: { id: req.params.id } });
    if (!plot) return res.status(404).json({ error: 'Plot not found' });
    const latest = await prisma.farmSoilReading.findFirst({
      where: { plot_id: req.params.id },
      orderBy: { recorded_at: 'desc' },
    });
    if (!latest) {
      return res.json({ analysis: null, readings: 0, message: 'ยังไม่มีค่าดิน — บันทึกค่า NPK/ความชื้นก่อนวิเคราะห์', crop });
    }
    const target = crop || plot.crop || 'ผักสลัด';
    const analysis = analyzeSoil(latest, target);
    const plan = soilAmendmentPlan(latest, target);
    res.json({
      analysis,
      plan,
      crop: target,
      crops: Object.keys(CROP_IDEALS),
      readings: 1,
      reading: latest,
    });
  } catch (err) {
    console.error('Soil analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze soil' });
  }
});

export default router;
