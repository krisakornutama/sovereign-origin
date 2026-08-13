import { PrismaClient, Prisma } from '@prisma/client';
import EventEmitter from 'events';
import cron from 'node-cron';
import { fetchPrice, PriceCache, type PriceQuote } from './price-feed.service';

export const wealthEmitter = new EventEmitter();

// ── Pure logic (ทดสอบได้โดยไม่ต้องพึ่ง DB / เครือข่าย) ──

export interface AssetHolding {
  symbol: string;
  type: 'CRYPTO' | 'STOCK' | 'COMMODITY';
  quantity: number;
}

export interface LatestPrice {
  symbol: string;
  priceUsd: number;
}

export interface InventoryLine {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unitPriceUsd: number;
}

/** มูลค่ารวมพอร์ต = Σ quantity × ราคาล่าสุด — asset ที่ไม่มีราคาไม่นับใน total */
export function computePortfolioValue(
  assets: AssetHolding[],
  prices: LatestPrice[]
): { totalUsd: number; assets: Array<AssetHolding & { priceUsd: number | null; valueUsd: number }>; missingPrices: string[] } {
  const priceMap = new Map(prices.map((p) => [p.symbol.toUpperCase(), p.priceUsd]));
  const missingPrices: string[] = [];
  let totalUsd = 0;
  const enriched = assets.map((a) => {
    const priceUsd = priceMap.get(a.symbol.toUpperCase()) ?? null;
    if (priceUsd == null) {
      missingPrices.push(a.symbol);
      return { ...a, priceUsd: null, valueUsd: 0 };
    }
    const valueUsd = a.quantity * priceUsd;
    totalUsd += valueUsd;
    return { ...a, priceUsd, valueUsd };
  });
  return { totalUsd, assets: enriched, missingPrices };
}

/** มูลค่าเสบียงกายภาพ = Σ quantity × ราคาต่อหน่วย */
export function computeInventoryValue(items: InventoryLine[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPriceUsd, 0);
}

export interface RunwayParams {
  cashUsd: number;
  liquidAssetUsd: number;
  monthlyExpensesUsd: number;
  avgPowerKw: number;
  electricityPricePerKwh: number;
}

/**
 * Survival Runway — จำนวนเดือนที่อยู่รอด
 * monthlyBurn = ค่าใช้จ่ายประจำ + ค่าพลังงาน (avgPower kW × 24h × 30d × ราคา/kWh)
 * months = สภาพคล่องรวม / monthlyBurn (null เมื่อ burn = 0)
 */
export function computeSurvivalRunway(p: RunwayParams): { months: number | null; monthlyBurnUsd: number; energyCostUsd: number } {
  const energyCostUsd = p.avgPowerKw * 24 * 30 * p.electricityPricePerKwh;
  const monthlyBurnUsd = p.monthlyExpensesUsd + energyCostUsd;
  const liquidity = p.cashUsd + p.liquidAssetUsd;
  const months = monthlyBurnUsd > 0 ? liquidity / monthlyBurnUsd : null;
  return { months, monthlyBurnUsd, energyCostUsd };
}

// ── Worker: cron job ดึงราคา + บันทึก history ──

export interface WealthWorkerConfig {
  enabled: boolean;
  fetchCron: string; // node-cron expression (default ทุก 4 ชม.)
  priceCacheTtlMs: number;
  cashUsd: number;
  monthlyExpensesUsd: number;
  electricityPricePerKwh: number;
}

export interface WealthWorkerDeps {
  listAssets: () => Promise<AssetHolding[]>;
  listInventory: () => Promise<InventoryLine[]>;
  latestPrices: (symbols: string[]) => Promise<LatestPrice[]>;
  loadAvgPowerKw: () => Promise<number | null>;
  savePrice: (quote: PriceQuote) => Promise<void>;
  saveWealthHistory: (totalUsd: number, payload: Prisma.InputJsonValue) => Promise<void>;
  fetchPrice: (symbol: string, type: 'CRYPTO' | 'STOCK' | 'COMMODITY') => Promise<PriceQuote | null>;
  log: (message: string) => void;
}

export class WealthWorker {
  private cache: PriceCache;
  private task: ReturnType<typeof cron.schedule> | null = null;

  constructor(
    private deps: WealthWorkerDeps,
    private cfg: WealthWorkerConfig
  ) {
    this.cache = new PriceCache(cfg.priceCacheTtlMs);
  }

  /** รอบเดียว: ดึงราคา symbol ทั้งหมด (ใช้ cache ถ้ายังสด) → บันทึก history + emit event */
  async runOnce(): Promise<{
    totalUsd: number;
    inventoryUsd: number;
    missingPrices: string[];
    freshQuotes: number;
  }> {
    const [assets, inventory] = await Promise.all([this.deps.listAssets(), this.deps.listInventory()]);

    // 1) ดึงราคา — ใช้ cache ภายใน TTL กัน rate limit
    const freshQuotes: PriceQuote[] = [];
    const priceMap = new Map<string, number>();
    for (const asset of assets) {
      const cached = this.cache.get(asset.symbol);
      if (cached != null) {
        priceMap.set(asset.symbol.toUpperCase(), cached);
        continue;
      }
      const quote = await this.deps.fetchPrice(asset.symbol, asset.type);
      if (quote) {
        this.cache.set(quote.symbol, quote.priceUsd);
        priceMap.set(quote.symbol.toUpperCase(), quote.priceUsd);
        freshQuotes.push(quote);
        await this.deps.savePrice(quote); // บันทึกไทม์ซีรีส์ลง TimescaleDB
      }
    }

    // 2) มูลค่า
    const prices: LatestPrice[] = [...priceMap.entries()].map(([symbol, priceUsd]) => ({ symbol, priceUsd }));
    const { totalUsd, missingPrices } = computePortfolioValue(assets, prices);
    const inventoryUsd = computeInventoryValue(inventory);

    // 3) Survival runway (อ่านกำลังไฟฟ้าเฉลี่ยจาก telemetry)
    const avgPowerKw = await this.deps.loadAvgPowerKw();
    const runway = computeSurvivalRunway({
      cashUsd: this.cfg.cashUsd,
      liquidAssetUsd: totalUsd, // สภาพคล่อง = พอร์ตที่ขายได้ + เงินสด
      monthlyExpensesUsd: this.cfg.monthlyExpensesUsd,
      avgPowerKw: avgPowerKw ?? 0,
      electricityPricePerKwh: this.cfg.electricityPricePerKwh,
    });

    // 4) บันทึก history + emit
    const payload = {
      totalUsd,
      inventoryUsd,
      grandTotalUsd: totalUsd + inventoryUsd,
      runway,
      missingPrices,
      cashUsd: this.cfg.cashUsd,
      timestamp: new Date().toISOString(),
    };
    await this.deps.saveWealthHistory(totalUsd + inventoryUsd, payload);
    wealthEmitter.emit('wealth_update', payload);
    this.deps.log(
      `💰 Wealth: total $${totalUsd.toFixed(2)} + inventory $${inventoryUsd.toFixed(2)} (${freshQuotes.length} fresh quotes)`
    );
    return { totalUsd, inventoryUsd, missingPrices, freshQuotes: freshQuotes.length };
  }

  start(): void {
    if (!this.cfg.enabled) {
      this.deps.log('💤 Wealth worker disabled (PORTFOLIO_ENABLED=false)');
      return;
    }
    this.task = cron.schedule(this.cfg.fetchCron, () => {
      this.runOnce().catch((err) => this.deps.log(`💰 Wealth worker error: ${err instanceof Error ? err.message : err}`));
    });
    this.deps.log(`💰 Wealth worker started (cron: ${this.cfg.fetchCron})`);
    // รอบแรกทันที — ไม่รอจนกว่า cron จะถึง
    this.runOnce().catch((err) => this.deps.log(`💰 Wealth initial run error: ${err instanceof Error ? err.message : err}`));
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

// ── Instance สำหรับ wiring ใน server.ts ──
const prisma = new PrismaClient();

export function createWealthWorker(cfg: WealthWorkerConfig): WealthWorker {
  return new WealthWorker(
    {
      listAssets: async () =>
        prisma.asset.findMany().then((rows) =>
          rows.map((r) => ({ symbol: r.symbol, type: r.type, quantity: r.quantity }))
        ),
      listInventory: async () =>
        prisma.inventoryItem.findMany().then((rows) =>
          rows.map((r) => ({
            name: r.name,
            category: r.category,
            quantity: r.quantity,
            unit: r.unit,
            unitPriceUsd: r.unit_price_usd,
          }))
        ),
      latestPrices: async (symbols) => {
        if (symbols.length === 0) return [];
        const rows = await prisma.$queryRawUnsafe<Array<{ symbol: string; price_usd: number }>>(
          `SELECT DISTINCT ON (symbol) symbol, price_usd
           FROM asset_prices WHERE symbol = ANY($1::text[])
           ORDER BY symbol, time DESC`,
          symbols
        );
        return rows.map((r) => ({ symbol: r.symbol, priceUsd: Number(r.price_usd) }));
      },
      loadAvgPowerKw: async () => {
        const rows = await prisma.$queryRawUnsafe<Array<{ avg_power: number | null }>>(
          `SELECT AVG(value) AS avg_power FROM sensor_telemetry
           WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
        );
        return rows[0]?.avg_power != null ? Number(rows[0].avg_power) : null;
      },
      savePrice: async (quote) => {
        await prisma.$queryRawUnsafe(
          `INSERT INTO asset_prices (time, symbol, type, price_usd, source)
           VALUES (NOW(), $1, $2::"AssetType", $3, $4)`,
          quote.symbol,
          quote.symbol.startsWith('XAU') ? 'COMMODITY' : quote.symbol.includes('.') ? 'STOCK' : 'CRYPTO',
          quote.priceUsd,
          quote.source
        );
      },
      saveWealthHistory: async (totalUsd, payload) => {
        await prisma.wealthHistory.create({ data: { total_usd_value: totalUsd, payload } });
      },
      fetchPrice,
      log: (m) => console.log(m),
    },
    cfg
  );
}
