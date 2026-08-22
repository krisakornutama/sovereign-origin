import { Router, Request } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { prisma } from '../../lib/prisma';
import { wealthEmitter } from '../../services/wealth.service';
import {
  computePortfolioValue,
  computeInventoryValue,
  computeSurvivalRunway,
  type AssetHolding,
  type InventoryLine,
} from '../../services/wealth.service';

const router = Router();

const VALID_ASSET_TYPES = ['CRYPTO', 'STOCK', 'COMMODITY'];

// ── กันค่าเกินจริง/ติดลบ (ตารางเดียวกันกับ treasury — ต้องตรวจเท่ากัน) ──
function nonNegativeFinite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── พอร์ตแยกต่อคน: ใครเป็นเจ้าของพอร์ตที่กำลังดู/แก้ ──
// - สมาชิกทั่วไป → เห็นได้เฉพาะพอร์ตของตัวเองเท่านั้น (backend บังคับ ไม่เชื่อฝั่ง UI)
// - SUPERADMIN → ดูได้ทุกคน โดยส่ง ?userId=<uuid> (ถ้าไม่ส่ง = พอร์ตของตัวเอง)
export function resolveOwnerId(req: Request): string {
  const me = req.user?.id;
  if (req.user?.role === 'SUPERADMIN' && typeof req.query.userId === 'string' && req.query.userId.trim()) {
    return req.query.userId.trim();
  }
  return me ?? '';
}

// ── Assets (พอร์ต) ──

// GET /api/portfolio/assets — asset ของเจ้าของพอร์ต + ราคาล่าสุดจาก asset_prices
// SUPERADMIN ดูพอร์ตสมาชิกคนอื่นได้ผ่าน ?userId=<uuid>
router.get('/assets', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const rows = await prisma.assetPosition.findMany({ where: { user_id: ownerId }, orderBy: { symbol: 'asc' } });
    const assets: AssetHolding[] = rows.map((r) => ({ symbol: r.symbol, type: r.type, quantity: r.quantity }));
    const latest = await prisma.$queryRawUnsafe<Array<{ symbol: string; price_usd: number }>>(
      `SELECT DISTINCT ON (symbol) symbol, price_usd
       FROM asset_prices ORDER BY symbol, time DESC`
    );
    const prices = latest.map((r) => ({ symbol: r.symbol, priceUsd: Number(r.price_usd) }));
    const result = computePortfolioValue(assets, prices);
    // แมป id/หมายเหตุ กลับจากแถว DB (asset เรียงตามลำดับเดียวกับ assets)
    const idBySymbol = new Map(rows.map((r) => [r.symbol.toUpperCase(), r]));
    res.json({
      assets: result.assets.map((a) => {
        const row = idBySymbol.get(a.symbol.toUpperCase());
        return { ...a, id: row?.id, wallet_address: row?.wallet_address ?? null, notes: row?.notes ?? null };
      }),
      totalUsd: result.totalUsd,
      missingPrices: result.missingPrices,
    });
  } catch (err) {
    console.error('Portfolio assets error:', err);
    res.status(500).json({ error: 'Failed to load assets' });
  }
});

// POST /api/portfolio/assets — เพิ่ม asset เข้าพอร์ตของตัวเอง (SUPERADMIN ผ่าน ?userId= เพิ่มให้สมาชิกได้)
router.post('/assets', authenticate, async (req, res) => {
  try {
    const { symbol, type, quantity, wallet_address, notes } = req.body || {};
    if (!symbol || !VALID_ASSET_TYPES.includes(type)) {
      return res.status(400).json({ error: 'symbol and type (CRYPTO|STOCK|COMMODITY) are required' });
    }
    const symbolStr = String(symbol).trim().toUpperCase();
    if (!symbolStr || symbolStr.length > 32) {
      return res.status(400).json({ error: 'symbol must be 1-32 characters' });
    }
    const qty = nonNegativeFinite(quantity);
    if (qty === null) return res.status(400).json({ error: 'quantity must be a non-negative number' });
    const asset = await prisma.assetPosition.create({
      data: {
        user_id: resolveOwnerId(req),
        symbol: symbolStr,
        type,
        quantity: qty,
        wallet_address: wallet_address || null,
        notes: notes || null,
      },
    });
    res.status(201).json({ success: true, id: asset.id });
  } catch (err) {
    console.error('Create asset error:', err);
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

// DELETE /api/portfolio/assets/:id — ลบได้เฉพาะของตัวเอง (SUPERADMIN ลบพอร์ตสมาชิกได้ผ่าน ?userId=)
router.delete('/assets/:id', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const owned = await prisma.assetPosition.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Asset not found in this portfolio' });
    await prisma.assetPosition.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

// PUT /api/portfolio/assets/:id — แก้ไข quantity / notes (เฉพาะของตัวเอง)
router.put('/assets/:id', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const { quantity, notes } = req.body || {};
    const owned = await prisma.assetPosition.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Asset not found in this portfolio' });
    const data: Record<string, unknown> = {};
    if (quantity !== undefined) {
      const qty = nonNegativeFinite(quantity);
      if (qty === null) return res.status(400).json({ error: 'quantity must be a non-negative number' });
      data.quantity = qty;
    }
    if (notes !== undefined) data.notes = notes;
    await prisma.assetPosition.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

// ── Tangible Inventory (เสบียงกายภาพ) ──

// GET /api/portfolio/inventory — รายการเสบียงของเจ้าของพอร์ต + มูลค่ารวม
router.get('/inventory', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const rows = await prisma.inventoryItem.findMany({ where: { user_id: ownerId }, orderBy: { name: 'asc' } });
    const items: InventoryLine[] = rows.map((r) => ({
      name: r.name,
      category: r.category,
      quantity: r.quantity,
      unit: r.unit,
      unitPriceUsd: r.unit_price_usd,
    }));
    res.json({ items: rows, totalUsd: computeInventoryValue(items) });
  } catch (err) {
    console.error('Inventory error:', err);
    res.status(500).json({ error: 'Failed to load inventory' });
  }
});

// POST /api/portfolio/inventory — เพิ่มรายการเสบียงเข้าพอร์ตของตัวเอง
router.post('/inventory', authenticate, async (req, res) => {
  try {
    const { name, category, quantity, unit, unit_price_usd, notes } = req.body || {};
    const qty = nonNegativeFinite(quantity);
    const price = nonNegativeFinite(unit_price_usd);
    if (!name || qty === null || price === null) {
      return res.status(400).json({ error: 'name, quantity and unit_price_usd are required (non-negative numbers)' });
    }
    const item = await prisma.inventoryItem.create({
      data: {
        user_id: resolveOwnerId(req),
        name: String(name),
        category: String(category || 'OTHER'),
        quantity: qty,
        unit: String(unit || 'piece'),
        unit_price_usd: price,
        notes: notes || null,
      },
    });
    res.status(201).json({ success: true, id: item.id });
  } catch (err) {
    console.error('Create inventory error:', err);
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

// PUT /api/portfolio/inventory/:id (เฉพาะของตัวเอง)
router.put('/inventory/:id', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const { quantity, unit_price_usd, notes, name } = req.body || {};
    const owned = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Inventory item not found in this portfolio' });
    const data: Record<string, unknown> = {};
    if (quantity !== undefined) {
      const qty = nonNegativeFinite(quantity);
      if (qty === null) return res.status(400).json({ error: 'quantity must be a non-negative number' });
      data.quantity = qty;
    }
    if (unit_price_usd !== undefined) {
      const price = nonNegativeFinite(unit_price_usd);
      if (price === null) return res.status(400).json({ error: 'unit_price_usd must be a non-negative number' });
      data.unit_price_usd = price;
    }
    if (notes !== undefined) data.notes = notes;
    if (name !== undefined) data.name = name;
    await prisma.inventoryItem.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

// DELETE /api/portfolio/inventory/:id (เฉพาะของตัวเอง)
router.delete('/inventory/:id', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const owned = await prisma.inventoryItem.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Inventory item not found in this portfolio' });
    await prisma.inventoryItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

// ── Summary + Survival Runway ──

// GET /api/portfolio/summary — มูลค่าพอร์ตของเจ้าของ + เสบียง + runway + history
// SUPERADMIN ดูพอร์ตสมาชิกคนอื่นได้ผ่าน ?userId=<uuid>
router.get('/summary', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const [assetRows, inventoryRows, avgRow, latestHistory] = await Promise.all([
      prisma.assetPosition.findMany({ where: { user_id: ownerId } }),
      prisma.inventoryItem.findMany({ where: { user_id: ownerId } }),
      prisma.$queryRawUnsafe<Array<{ avg_power: number | null }>>(
        `SELECT AVG(value) AS avg_power FROM sensor_telemetry
         WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
      ),
      prisma.wealthHistory.findMany({ where: { user_id: ownerId }, orderBy: { timestamp: 'desc' }, take: 30 }),
    ]);

    const assets: AssetHolding[] = assetRows.map((r) => ({ symbol: r.symbol, type: r.type, quantity: r.quantity }));
    const inventory: InventoryLine[] = inventoryRows.map((r) => ({
      name: r.name,
      category: r.category,
      quantity: r.quantity,
      unit: r.unit,
      unitPriceUsd: r.unit_price_usd,
    }));

    const latest = await prisma.$queryRawUnsafe<Array<{ symbol: string; price_usd: number }>>(
      `SELECT DISTINCT ON (symbol) symbol, price_usd FROM asset_prices ORDER BY symbol, time DESC`
    );
    const { totalUsd, missingPrices } = computePortfolioValue(
      assets,
      latest.map((r) => ({ symbol: r.symbol, priceUsd: Number(r.price_usd) }))
    );
    const inventoryUsd = computeInventoryValue(inventory);

    const cashUsd = parseFloat(process.env.PORTFOLIO_CASH_USD || '0');
    const monthlyExpensesUsd = parseFloat(process.env.PORTFOLIO_MONTHLY_EXPENSES_USD || '0');
    const electricityPricePerKwh = parseFloat(process.env.ELECTRICITY_PRICE_USD_PER_KWH || '0.12');
    const avgPowerKw = avgRow[0]?.avg_power != null ? Number(avgRow[0].avg_power) : 0;

    const runway = computeSurvivalRunway({
      cashUsd,
      liquidAssetUsd: totalUsd,
      monthlyExpensesUsd,
      avgPowerKw,
      electricityPricePerKwh,
    });

    res.json({
      portfolioUsd: totalUsd,
      inventoryUsd,
      grandTotalUsd: totalUsd + inventoryUsd,
      cashUsd,
      runway,
      missingPrices,
      history: latestHistory.map((h) => ({ timestamp: h.timestamp, totalUsd: h.total_usd_value })),
    });
  } catch (err) {
    console.error('Portfolio summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// GET /api/portfolio/history — ประวัติมูลค่ารวมของเจ้าของพอร์ต
router.get('/history', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 60, 1), 500); // clamp — ค่าไม่ถูกต้อง/ติดลบ → อย่างน้อย 1
    const rows = await prisma.wealthHistory.findMany({ where: { user_id: ownerId }, orderBy: { timestamp: 'desc' }, take: limit });
    res.json(rows.map((r) => ({ timestamp: r.timestamp, totalUsd: r.total_usd_value, payload: r.payload })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// POST /api/portfolio/refresh — บังคับดึงราคาทันที (จากหน้า UI)
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const { wealthWorker } = req.app.locals as { wealthWorker?: { runOnce: () => Promise<Record<string, unknown>> } };
    if (!wealthWorker) return res.status(503).json({ error: 'Wealth worker not running (PORTFOLIO_ENABLED=false?)' });
    const result = await wealthWorker.runOnce();
    res.json({ success: true, ...(result as object) });
  } catch (err) {
    console.error('Portfolio refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh prices' });
  }
});

// ── Aladdin Risk Engine — ใช้ข้อมูลอดีตทำนายอนาคต (สไตล์ BlackRock Aladdin) ──

// GET /api/portfolio/risk — รายงานความเสี่ยงเต็มรูปแบบ: วิเคราะห์รายตัว + Monte Carlo + VaR + สิ่งที่ต้องทำ
router.get('/risk', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const { analyzeAssetRisk, simulatePortfolio, portfolioRisk, buildRiskActions } = await import('../../services/aladdin-risk.service');
    const assets = await prisma.assetPosition.findMany({ where: { user_id: ownerId }, orderBy: { symbol: 'asc' } });
    const latest = await prisma.$queryRawUnsafe<Array<{ symbol: string; price_usd: number }>>(
      `SELECT DISTINCT ON (symbol) symbol, price_usd FROM asset_prices ORDER BY symbol, time DESC`
    );
    const priceMap = new Map(latest.map((r) => [r.symbol.toUpperCase(), Number(r.price_usd)]));

    const historyRows = await prisma.$queryRawUnsafe<Array<{ symbol: string; time: Date; price_usd: number }>>(
      `SELECT symbol, time, price_usd FROM asset_prices ORDER BY symbol, time ASC`
    );
    const bySymbol = new Map<string, Array<{ time: string; price: number }>>();
    for (const r of historyRows) {
      const arr = bySymbol.get(r.symbol.toUpperCase()) || [];
      arr.push({ time: new Date(r.time).toISOString(), price: Number(r.price_usd) });
      bySymbol.set(r.symbol.toUpperCase(), arr);
    }

    const analyses = assets.map((a) => {
      const sym = a.symbol.toUpperCase();
      return analyzeAssetRisk({
        symbol: a.symbol,
        type: a.type,
        history: bySymbol.get(sym) ?? [],
        valueUsd: (priceMap.get(sym) ?? 0) * a.quantity,
      });
    });

    const simInputs = assets
      .filter((a) => (priceMap.get(a.symbol.toUpperCase()) ?? 0) > 0)
      .map((a) => ({
        symbol: a.symbol.toUpperCase(),
        valueUsd: (priceMap.get(a.symbol.toUpperCase()) ?? 0) * a.quantity,
        history: bySymbol.get(a.symbol.toUpperCase()) ?? [],
      }));

    const sim = simInputs.length > 0
      ? simulatePortfolio(simInputs, { horizonDays: 30, paths: 1000, seed: 20260812 })
      : null;
    const pRisk = simInputs.length > 0 ? portfolioRisk(simInputs) : null;
    const actions = buildRiskActions(analyses.map((a) => ({ symbol: a.symbol, signal: a.signal, trend: a.trend })));

    res.json({
      generatedAt: new Date().toISOString(),
      engine: 'Aladdin-style',
      assets: analyses,
      simulation: sim,
      portfolio: pRisk,
      actions,
    });
  } catch (err) {
    console.error('Portfolio risk error:', err);
    res.status(500).json({ error: 'Failed to compute risk report' });
  }
});

export { wealthEmitter, prisma };
export default router;
