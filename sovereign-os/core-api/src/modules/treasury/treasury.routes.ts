// ═════════════════════════════════════════════════════════════
// Treasury & Wealth Engine — LIFE & FINANCE unified module
//   View A: Net Worth & Cashflow   → GET /overview (+ PATCH /balance-sheet)
//   View B: Survival Runway        → ฟีดใน /overview + GET /runway/history
//   View C: Investment Strategies  → 5 families + catalyst + income feeds
// Cross-link: ขายทำกำไร/ปันผล → อัปเดตเงินสดใน PersonalBalanceSheet อัตโนมัติ
// ═════════════════════════════════════════════════════════════
import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import multer from 'multer';
import { authenticate } from '../../middleware/auth.middleware';
import { resolveOwnerId } from '../portfolio/portfolio.routes';
import {
  STRATEGY_FAMILIES,
  isStrategyFamily,
  computeRunwayMonths,
  computeAnnualizedDividendUsd,
  computeNetWorth,
  computeFamilyAllocation,
  ensureBalanceSheet,
  creditLiquidCash,
  recordPositionSale,
  recordDividend,
  recordRunwaySnapshot,
  type RunwayComponents,
} from '../../services/treasury.service';
import { computePortfolioValue, computeInventoryValue, type AssetHolding, type InventoryLine } from '../../services/wealth.service';
import { createTransferOrder, confirmTransfer, cancelTransfer } from '../../services/transfer.service';

const router = Router();
export { prisma };

const VALID_ASSET_TYPES = ['CRYPTO', 'STOCK', 'COMMODITY'];

// ── สลิปหลักฐานการโอน (ภาพ) — เก็บเป็น data URL ใน evidence_url (ไม่ต้อง static server) ──
const SLIP_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);
const slipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // สลิปไม่ใหญ่ — 2MB พอ
  fileFilter: (_req, file, cb) => {
    if (SLIP_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg/png/webp/gif/bmp/tiff)'));
  },
});

// ── ตัวช่วยตรวจสอบตัวเลข (กันค่า Infinity / ติดลบ / เกินจริง) ──
// ค่าผิดรูปแบบ → คืน null (caller ส่ง 400); ตัวเลขไม่ติดลบ → คืนค่าที่ใช้ได้
function nonNegativeFinite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type PriceRow = { symbol: string; price_usd: number };

async function latestPrices(): Promise<PriceRow[]> {
  return prisma.$queryRawUnsafe<PriceRow[]>(
    `SELECT DISTINCT ON (symbol) symbol, price_usd FROM asset_prices ORDER BY symbol, time DESC`
  );
}

async function avgPowerKw(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ avg_power: number | null }>>(
    `SELECT AVG(value) AS avg_power FROM sensor_telemetry
     WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
  );
  return rows[0]?.avg_power != null ? Number(rows[0].avg_power) : 0;
}

/** ดึงพอร์ตพร้อมราคา — ใช้ร่วมกันทั้ง overview/strategies/catalysts */
async function loadPositions(ownerId: string) {
  const rows = await prisma.assetPosition.findMany({ where: { user_id: ownerId }, orderBy: { symbol: 'asc' } });
  const prices = await latestPrices();
  const { assets } = computePortfolioValue(
    rows.map((r) => ({ symbol: r.symbol, type: r.type, quantity: r.quantity })),
    prices.map((r) => ({ symbol: r.symbol, priceUsd: Number(r.price_usd) }))
  );
  const priceMap = new Map(assets.map((a) => [a.symbol.toUpperCase(), a.priceUsd]));
  return rows.map((r) => {
    const priceUsd = priceMap.get(r.symbol.toUpperCase()) ?? null;
    return {
      id: r.id,
      symbol: r.symbol,
      type: r.type,
      quantity: r.quantity,
      wallet_address: r.wallet_address,
      notes: r.notes,
      strategyFamily: r.strategy_family,
      avgCostUsd: r.avg_cost_usd,
      expectedDividendYieldPct: r.expected_dividend_yield_pct,
      catalystNote: r.catalyst_note,
      lastDividendUsd: r.last_dividend_usd,
      lastDividendAt: r.last_dividend_at,
      realizedGainUsd: r.realized_gain_usd,
      soldQty: r.sold_qty,
      // ── ฟิลด์จากสเตตเมนต์ Dime! (อัปเดตทุกเดือนที่ import) ──
      companyName: r.company_name,
      allocationPct: r.allocation_pct,
      totalReturnPct: r.total_return_pct,
      totalReturnUsd: r.total_return_usd,
      priceUsd,
      valueUsd: priceUsd ? r.quantity * priceUsd : 0,
    };
  });
}

// ═══════ View A+B+C: Unified Treasury Overview ═══════

// GET /api/treasury/overview — หน้าควบคุมรวม: Net Worth + Runway + 5 Families + Catalysts + Income
router.get('/overview', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const [sheet, positions, inventory] = await Promise.all([
      ensureBalanceSheet(prisma, ownerId),
      loadPositions(ownerId),
      prisma.inventoryItem.findMany({ where: { user_id: ownerId }, orderBy: { name: 'asc' } }),
    ]);

    const electricityPricePerKwh = parseFloat(process.env.ELECTRICITY_PRICE_USD_PER_KWH || '0.12');
    const avgKw = await avgPowerKw();
    const energyCostUsd = avgKw * 24 * 30 * electricityPricePerKwh;
    const monthlyBurnUsd = (sheet.monthly_burn_usd || 0) + energyCostUsd;

    const assetsUsd = positions.reduce((s, p) => s + (p.valueUsd || 0), 0);
    const inventoryUsd = computeInventoryValue(
      inventory.map((r) => ({
        name: r.name,
        category: r.category,
        quantity: r.quantity,
        unit: r.unit,
        unitPriceUsd: r.unit_price_usd,
      }))
    );
    const liquidCashUsd = sheet.liquid_cash_usd || 0;
    const annualizedDividendUsd = computeAnnualizedDividendUsd(positions);
    const runwayMonths = computeRunwayMonths({ liquidCashUsd, annualizedDividendUsd, monthlyBurnUsd });

    const { allocation, totalUsd: familyTotal } = computeFamilyAllocation(positions);
    const netWorthUsd = computeNetWorth({ liquidCashUsd, assetsUsd, inventoryUsd, liabilitiesUsd: sheet.liabilities_usd || 0 });

    // Asymmetric Catalyst Watchlist — ตำแหน่งที่รอจุดเปลี่ยน + QUANT/รองรับใน matrix
    const catalysts = positions
      .filter((p) => p.catalystNote)
      .map((p) => ({ id: p.id, symbol: p.symbol, note: p.catalystNote, family: p.strategyFamily, valueUsd: p.valueUsd }));

    // Income Stream Feeds — ปันผลล่าสุด + กำไรรับรู้ + รายได้ประจำ
    const recentEvents = await prisma.treasuryEvent.findMany({ where: { user_id: ownerId }, orderBy: { created_at: 'desc' }, take: 20 });
    const dividendStreams = positions.filter((p) => p.strategyFamily === 'PASSIVE_INCOME' || p.expectedDividendYieldPct > 0);

    // สเตตเมนต์ Dime! ล่าสุด (ข้าม record เปล่า อย่าง confirmation note)
    const recentStmts = await prisma.dimeStatement.findMany({ where: { user_id: ownerId }, orderBy: { parsed_at: 'desc' }, take: 3 });
    const latestStmt = recentStmts.find((s) => (s.assets as unknown[])?.length > 0) ?? null;

    res.json({
      generatedAt: new Date().toISOString(),
      dime: latestStmt
        ? {
            statementPeriod: latestStmt.statement_period,
            parsedAt: latestStmt.parsed_at,
            accountNo: latestStmt.account_no,
            fxRate: latestStmt.fx_rate,
            totalBalanceUsd: latestStmt.total_balance_usd,
            totalBalanceThb: latestStmt.total_balance_thb,
            cashBalanceUsd: latestStmt.cash_balance_usd,
            cashBalanceThb: latestStmt.cash_balance_thb,
            totalReturnPct: latestStmt.total_return_pct,
            totalReturnUsd: latestStmt.total_return_usd,
            sectors: latestStmt.sectors,
            assetCount: (latestStmt.assets as unknown[])?.length ?? 0,
          }
        : null,
      netWorth: {
        usd: netWorthUsd,
        liquidCashUsd,
        assetsUsd,
        inventoryUsd,
        liabilitiesUsd: sheet.liabilities_usd || 0,
      },
      cashflow: {
        monthlyBurnUsd,
        energyCostUsd,
        coreBurnUsd: sheet.monthly_burn_usd || 0,
        monthlyIncomeUsd: sheet.monthly_income_usd || 0,
        annualizedDividendUsd,
      },
      runway: {
        months: runwayMonths,
        formula: {
          liquidCashUsd,
          annualizedDividendUsd,
          monthlyBurnUsd,
        } satisfies RunwayComponents,
      },
      strategies: { families: STRATEGY_FAMILIES, allocation, totalUsd: familyTotal },
      catalysts,
      income: {
        dividendStreams: dividendStreams.map((p) => ({
          id: p.id,
          symbol: p.symbol,
          family: p.strategyFamily,
          quantity: p.quantity,
          yieldPct: p.expectedDividendYieldPct,
          annualEstimateUsd: p.priceUsd ? p.quantity * p.priceUsd * (p.expectedDividendYieldPct / 100) : 0,
          lastDividendUsd: p.lastDividendUsd,
          lastDividendAt: p.lastDividendAt,
        })),
        events: recentEvents,
        totalRealizedGainUsd: positions.reduce((s, p) => s + (p.realizedGainUsd || 0), 0),
      },
      positions,
    });
  } catch (err) {
    console.error('Treasury overview error:', err);
    res.status(500).json({ error: 'Failed to load treasury overview' });
  }
});

// ═══════ View A: Balance Sheet (Net Worth & Cashflow) ═══════

// PATCH /api/treasury/balance-sheet — อัปเดตเงินสด/หนี้สิน/ค่าใช้จ่าย/รายได้
router.patch('/balance-sheet', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    await ensureBalanceSheet(prisma, ownerId);
    const { liquidCashUsd, liabilitiesUsd, monthlyBurnUsd, monthlyIncomeUsd, adjustCashUsd, adjustNote } = req.body || {};
    const data: Record<string, number> = {};
    for (const [key, val] of Object.entries({ liquidCashUsd, liabilitiesUsd, monthlyBurnUsd, monthlyIncomeUsd })) {
      if (val !== undefined) {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${key} ต้องเป็นตัวเลขไม่ติดลบ` });
        data[key] = n;
      }
    }
    const sheet = await prisma.personalBalanceSheet.update({ where: { user_id: ownerId }, data });

    // CASH_ADJUST — ปรับเงินสดมือเปล่า (เช่น ฝาก/ถอนบัญชีจริง)
    let adjustment = null;
    let withdrawnAmt = 0;
    const adj = Number(adjustCashUsd);
    if (Number.isFinite(adj) && adj !== 0) {
      if (adj > 0) {
        adjustment = await creditLiquidCash(prisma, ownerId, adj, { type: 'CASH_ADJUST', note: adjustNote || `ฝากเงินสด $${adj.toFixed(2)}` });
      } else {
        // ถอน — ลดตรงโดย atomic decrement (กัน 2 request พร้อมกันหักยอดซ้ำ)
        const requested = Math.abs(adj);
        const step = await prisma.personalBalanceSheet.updateMany({
          where: { user_id: ownerId, liquid_cash_usd: { gte: requested } },
          data: { liquid_cash_usd: { decrement: requested } },
        });
        if (step.count === 1) {
          withdrawnAmt = requested;
          await prisma.treasuryEvent.create({
            data: { user_id: ownerId, type: 'CASH_ADJUST', amount_usd: -requested, note: adjustNote || `ถอนเงินสด $${requested.toFixed(2)}` },
          });
        } else {
          // เหลือน้อยกว่าที่ขอ → หักเท่าที่ยังมี (atomic อีกที กัน race ระหว่างอ่านกับหัก)
          const avail = Math.max(0, sheet.liquid_cash_usd || 0);
          if (avail > 0) {
            const step2 = await prisma.personalBalanceSheet.updateMany({
              where: { user_id: ownerId, liquid_cash_usd: { gte: avail } },
              data: { liquid_cash_usd: { decrement: avail } },
            });
            if (step2.count === 1) {
              withdrawnAmt = avail;
              await prisma.treasuryEvent.create({
                data: { user_id: ownerId, type: 'CASH_ADJUST', amount_usd: -avail, note: adjustNote || `ถอนเงินสด $${avail.toFixed(2)}` },
              });
            }
          }
        }
      }
    }

    const fresh = await prisma.personalBalanceSheet.findUnique({ where: { user_id: ownerId } });
    if (withdrawnAmt > 0) adjustment = { balance: { liquid_cash_usd: fresh?.liquid_cash_usd ?? 0 }, withdrawalUsd: withdrawnAmt };
    else if (adj !== 0 && Number.isFinite(adj) && adj < 0) adjustment = { withdrawalUsd: 0 };
    res.json({ sheet: fresh, adjustment });
  } catch (err) {
    console.error('Treasury balance sheet error:', err);
    res.status(500).json({ error: 'Failed to update balance sheet' });
  }
});

// ═══════ View B: Survival Runway History ═══════

// POST /api/treasury/runway/snapshot — บันทึกสแนปชอตปัจจุบัน (เรียกจาก UI หรือ cron ได้)
router.post('/runway/snapshot', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const [sheet, positions] = await Promise.all([ensureBalanceSheet(prisma, ownerId), loadPositions(ownerId)]);
    const avgKw = await avgPowerKw();
    const energyCostUsd = avgKw * 24 * 30 * parseFloat(process.env.ELECTRICITY_PRICE_USD_PER_KWH || '0.12');
    const components: RunwayComponents = {
      liquidCashUsd: sheet.liquid_cash_usd || 0,
      annualizedDividendUsd: computeAnnualizedDividendUsd(positions),
      monthlyBurnUsd: (sheet.monthly_burn_usd || 0) + energyCostUsd,
    };
    const snap = await recordRunwaySnapshot(prisma, ownerId, components);
    res.json({ snapshot: snap, months: computeRunwayMonths(components) });
  } catch (err) {
    console.error('Treasury runway snapshot error:', err);
    res.status(500).json({ error: 'Failed to record runway snapshot' });
  }
});

// GET /api/treasury/runway/history — เส้นประวัติเดือนที่อยู่รอด
router.get('/runway/history', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 60, 1), 500); // clamp — ค่าไม่ถูกต้อง/ติดลบ → อย่างน้อย 1
    const rows = await prisma.survivalRunway.findMany({
      where: { user_id: ownerId },
      orderBy: { snapshot_at: 'desc' },
      take: limit,
    });
    res.json({
      history: rows
        .map((r) => ({ snapshotAt: r.snapshot_at, months: r.months, liquidCashUsd: r.liquid_cash_usd, annualizedDividendUsd: r.annualized_dividend_usd, monthlyBurnUsd: r.monthly_burn_usd }))
        .reverse(),
    });
  } catch (err) {
    console.error('Treasury runway history error:', err);
    res.status(500).json({ error: 'Failed to load runway history' });
  }
});

// ═══════ View C: Investment Strategies (5 Families) ═══════

// POST /api/treasury/positions — เปิดตำแหน่งลงทุน (ระบุ family/avg cost/yield/catalyst ได้)
router.post('/positions', authenticate, async (req, res) => {
  try {
    const { symbol, type, quantity, wallet_address, notes, strategyFamily, avgCostUsd, expectedDividendYieldPct, catalystNote } = req.body || {};
    if (!symbol || !VALID_ASSET_TYPES.includes(type))
      return res.status(400).json({ error: 'symbol และ type (CRYPTO|STOCK|COMMODITY) จำเป็น' });
    const symbolStr = String(symbol).trim().toUpperCase();
    if (!symbolStr || symbolStr.length > 32)
      return res.status(400).json({ error: 'symbol ต้องมี 1–32 ตัวอักษร' });
    const qty = nonNegativeFinite(quantity);
    if (qty === null) return res.status(400).json({ error: 'quantity ต้องเป็นตัวเลขไม่ติดลบ' });
    const family = String(strategyFamily || 'FUNDAMENTAL').toUpperCase();
    if (!isStrategyFamily(family))
      return res.status(400).json({ error: `strategyFamily ต้องเป็น: ${STRATEGY_FAMILIES.join(', ')}` });
    let avgCost: number | null = null;
    if (avgCostUsd !== undefined && avgCostUsd !== null) {
      avgCost = nonNegativeFinite(avgCostUsd);
      if (avgCost === null) return res.status(400).json({ error: 'avgCostUsd ต้องเป็นตัวเลขไม่ติดลบ' });
    }
    const yieldPct = nonNegativeFinite(expectedDividendYieldPct);
    if (yieldPct === null || yieldPct > 100)
      return res.status(400).json({ error: 'expectedDividendYieldPct ต้องอยู่ระหว่าง 0–100' });
    const position = await prisma.assetPosition.create({
      data: {
        user_id: resolveOwnerId(req),
        symbol: symbolStr,
        type,
        quantity: qty,
        wallet_address: wallet_address || null,
        notes: notes || null,
        strategy_family: family,
        avg_cost_usd: avgCost,
        expected_dividend_yield_pct: yieldPct,
        catalyst_note: catalystNote || null,
      },
    });
    res.status(201).json({ success: true, id: position.id });
  } catch (err) {
    console.error('Treasury create position error:', err);
    res.status(500).json({ error: 'Failed to create position' });
  }
});

// PATCH /api/treasury/positions/:id — แก้ family/yield/catalyst/qty/ต้นทุน
router.patch('/positions/:id', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const owned = await prisma.assetPosition.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Position not found' });
    const { quantity, notes, strategyFamily, avgCostUsd, expectedDividendYieldPct, catalystNote, wallet_address } = req.body || {};
    const data: Record<string, unknown> = {};
    if (quantity !== undefined) {
      const qty = nonNegativeFinite(quantity);
      if (qty === null) return res.status(400).json({ error: 'quantity ต้องเป็นตัวเลขไม่ติดลบ' });
      data.quantity = qty;
    }
    if (notes !== undefined) data.notes = notes;
    if (wallet_address !== undefined) data.wallet_address = wallet_address;
    if (strategyFamily !== undefined) {
      const family = String(strategyFamily).toUpperCase();
      if (!isStrategyFamily(family)) return res.status(400).json({ error: `strategyFamily ต้องเป็น: ${STRATEGY_FAMILIES.join(', ')}` });
      data.strategy_family = family;
    }
    if (avgCostUsd !== undefined && avgCostUsd !== null) {
      const avgCost = nonNegativeFinite(avgCostUsd);
      if (avgCost === null) return res.status(400).json({ error: 'avgCostUsd ต้องเป็นตัวเลขไม่ติดลบ' });
      data.avg_cost_usd = avgCost;
    }
    if (expectedDividendYieldPct !== undefined) {
      const yieldPct = nonNegativeFinite(expectedDividendYieldPct);
      if (yieldPct === null || yieldPct > 100) return res.status(400).json({ error: 'expectedDividendYieldPct ต้องอยู่ระหว่าง 0–100' });
      data.expected_dividend_yield_pct = yieldPct;
    }
    if (catalystNote !== undefined) data.catalyst_note = catalystNote;
    await prisma.assetPosition.update({ where: { id: owned.id }, data });
    res.json({ success: true });
  } catch (err) {
    console.error('Treasury update position error:', err);
    res.status(500).json({ error: 'Failed to update position' });
  }
});

// DELETE /api/treasury/positions/:id
router.delete('/positions/:id', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const owned = await prisma.assetPosition.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Position not found' });
    await prisma.assetPosition.delete({ where: { id: owned.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Treasury delete position error:', err);
    res.status(500).json({ error: 'Failed to delete position' });
  }
});

// POST /api/treasury/positions/:id/sell — ขายทำกำไร → realized gain → เครดิตเงินสดอัตโนมัติ
router.post('/positions/:id/sell', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const owned = await prisma.assetPosition.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Position not found' });
    const { quantity, priceUsd, note } = req.body || {};
    const result = await recordPositionSale(prisma, owned, Number(quantity), Number(priceUsd), { note });
    if (!result.ok) return res.status(400).json({ error: result.reason });
    const fresh = await prisma.assetPosition.findUnique({ where: { id: owned.id } });
    res.json({ success: true, sale: result, position: fresh });
  } catch (err) {
    console.error('Treasury sell error:', err);
    res.status(500).json({ error: 'Failed to sell position' });
  }
});

// POST /api/treasury/positions/:id/dividend — รับเงินปันผล → เครดิตเงินสดอัตโนมัติ
router.post('/positions/:id/dividend', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const owned = await prisma.assetPosition.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!owned) return res.status(404).json({ error: 'Position not found' });
    const { amountUsd, note } = req.body || {};
    const result = await recordDividend(prisma, owned, Number(amountUsd), note);
    if (!result.ok) return res.status(400).json({ error: 'amountUsd ต้องมากกว่า 0' });
    const fresh = await prisma.assetPosition.findUnique({ where: { id: owned.id } });
    res.json({ success: true, payout: result, position: fresh });
  } catch (err) {
    console.error('Treasury dividend error:', err);
    res.status(500).json({ error: 'Failed to record dividend' });
  }
});

// GET /api/treasury/events — ฟีดปันผล/กำไรรับรู้ (income streams)
router.get('/events', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 500); // clamp — ค่าไม่ถูกต้อง/ติดลบ → อย่างน้อย 1
    const events = await prisma.treasuryEvent.findMany({ where: { user_id: ownerId }, orderBy: { created_at: 'desc' }, take: limit });
    res.json({ events });
  } catch (err) {
    console.error('Treasury events error:', err);
    res.status(500).json({ error: 'Failed to load treasury events' });
  }
});

// ═══════ View D: Transfer Orders — โอน/รับเงินจริง + ยืนยันด้วย txid ═══════
// วงจร: PENDING (สร้าง + QR PromptPay) → โอนจริงผ่านแอปธนาคาร → VERIFIED (txid)
//      หลัง VERIFIED → ledger (PersonalBalanceSheet) อัปเดตอัตโนมัติ (OUT หัก / IN เครดิต)

// GET /api/treasury/transfers — รายการคำสั่งโอน (filters: status, limit)
router.get('/transfers', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    const where: Record<string, unknown> = { user_id: ownerId };
    if (status === 'PENDING' || status === 'VERIFIED' || status === 'CANCELLED') where.status = status;
    const rows = await prisma.transferOrder.findMany({ where, orderBy: { created_at: 'desc' }, take: limit });
    res.json({
      transfers: rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        status: r.status,
        category: r.category,
        amountUsd: r.amount_usd,
        amountThb: r.amount_thb,
        payee: r.payee,
        bank: r.bank,
        accountNumber: r.account_number,
        note: r.note,
        refCode: r.ref_code,
        qrPayload: r.qr_payload,
        txid: r.txid,
        evidenceUrl: r.evidence_url,
        requestedBy: r.requested_by,
        verifiedBy: r.verified_by,
        verifiedAt: r.verified_at,
        createdAt: r.created_at,
      })),
      promptpayConfigured: Boolean(process.env.PROMPTPAY_TARGET),
    });
  } catch (err) {
    console.error('Treasury transfers list error:', err);
    res.status(500).json({ error: 'Failed to load transfer orders' });
  }
});

// POST /api/treasury/transfers — สร้างคำสั่งโอน/รับ (ยังไม่แตะ ledger)
router.post('/transfers', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const { direction, category, amountUsd, amountThb, payee, bank, accountNumber, note } = req.body || {};
    const result = await createTransferOrder(prisma, ownerId, {
      direction,
      category,
      amountUsd: Number(amountUsd),
      amountThb: amountThb !== undefined && amountThb !== null && amountThb !== '' ? Number(amountThb) : null,
      payee,
      bank,
      accountNumber,
      note,
      usdThbRate: Number(process.env.USD_THB_RATE || 35),
      promptpayTarget: process.env.PROMPTPAY_TARGET || null,
      promptpayName: process.env.PROMPTPAY_NAME || null,
    });
    if (!result.ok || !result.order) return res.status(400).json({ error: result.reason || 'ไม่สามารถสร้างคำสั่งโอนได้' });
    res.status(201).json({
      success: true,
      order: {
        id: result.order.id,
        refCode: result.order.ref_code,
        direction: result.order.direction,
        amountUsd: result.order.amount_usd,
        amountThb: result.order.amount_thb,
        qrPayload: result.order.qr_payload,
        status: result.order.status,
      },
      promptpayConfigured: Boolean(result.qrPayload),
    });
  } catch (err) {
    console.error('Treasury create transfer error:', err);
    res.status(500).json({ error: 'Failed to create transfer order' });
  }
});

// POST /api/treasury/transfers/:id/confirm — ยืนยันโอนจริง → ledger อัปเดตอัตโนมัติ
router.post('/transfers/:id/confirm', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const order = await prisma.transferOrder.findFirst({ where: { id: req.params.id, user_id: ownerId } });
    if (!order) return res.status(404).json({ error: 'Transfer order not found' });
    const { txid } = req.body || {};
    const result = await confirmTransfer(prisma, order, req.user?.id || ownerId, String(txid || ''));
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json({
      success: true,
      direction: order.direction,
      amountUsd: order.amount_usd,
      actualDebitedUsd: result.actualDebitedUsd,
      balanceUsd: result.balance?.liquid_cash_usd,
      refCode: order.ref_code,
    });
  } catch (err) {
    console.error('Treasury confirm transfer error:', err);
    res.status(500).json({ error: 'Failed to confirm transfer' });
  }
});

// POST /api/treasury/transfers/:id/cancel — ยกเลิกคำสั่งที่ยัง PENDING
router.post('/transfers/:id/cancel', authenticate, async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req);
    const result = await cancelTransfer(prisma, req.params.id, ownerId);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json({ success: true });
  } catch (err) {
    console.error('Treasury cancel transfer error:', err);
    res.status(500).json({ error: 'Failed to cancel transfer' });
  }
});

// POST /api/treasury/transfers/:id/evidence — อัปโหลดสลิปหลักฐาน (ภาพ ≤ 2MB) → เก็บใน evidence_url
router.post(
  '/transfers/:id/evidence',
  authenticate,
  (req, res, next) => {
    // multer ปิด error ด้วย next(err) — เปลี่ยนเป็นตอบ 400 JSON ทันที (กันหลุดไป error handler กลาง)
    slipUpload.single('file')(req, res, (err?: any) => {
      if (err) {
        if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'ไฟล์ใหญ่เกิน 2MB' });
        return res.status(400).json({ error: err?.message || 'invalid upload' });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const ownerId = resolveOwnerId(req);
      const order = await prisma.transferOrder.findFirst({ where: { id: req.params.id, user_id: ownerId } });
      if (!order) return res.status(404).json({ error: 'Transfer order not found' });
      if (order.status !== 'PENDING')
        return res.status(400).json({ error: 'อัปโหลดสลิปได้เฉพาะคำสั่งที่ยัง PENDING' });
      if (!req.file) return res.status(400).json({ error: 'ต้องแนบไฟล์ภาพ (form-data field: file)' });
      const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const updated = await prisma.transferOrder.update({
        where: { id: order.id },
        data: { evidence_url: dataUrl },
      });
      res.json({ success: true, evidenceUrl: updated.evidence_url });
    } catch (err) {
      console.error('Treasury evidence upload error:', err);
      res.status(500).json({ error: 'Failed to upload evidence' });
    }
  }
);

export default router;