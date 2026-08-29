import { prisma } from '../../lib/prisma';
import { computePortfolioValue } from '../../services/wealth.service';

export function nonNegativeFinite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export type PriceRow = { symbol: string; price_usd: number };

export async function latestPrices(): Promise<PriceRow[]> {
  return prisma.$queryRawUnsafe<PriceRow[]>(
    `SELECT DISTINCT ON (symbol) symbol, price_usd FROM asset_prices ORDER BY symbol, time DESC`
  );
}

export async function avgPowerKw(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ avg_power: number | null }>>(
    `SELECT AVG(value) AS avg_power FROM sensor_telemetry WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
  );
  return rows[0]?.avg_power != null ? Number(rows[0].avg_power) : 0;
}

export async function loadPositions(ownerId: string) {
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
      companyName: r.company_name,
      allocationPct: r.allocation_pct,
      totalReturnPct: r.total_return_pct,
      totalReturnUsd: r.total_return_usd,
      priceUsd,
      valueUsd: priceUsd ? r.quantity * priceUsd : 0,
    };
  });
}
