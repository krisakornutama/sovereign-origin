import axios from 'axios';

// ── Price Feed: ดึงราคาหลักทรัพย์จากแหล่งฟรี ไม่ต้องใช้ API key ──
// - CRYPTO: Binance public API (BTCUSDT …)
// - STOCK / COMMODITY: Yahoo Finance chart API (ฟรี, ไม่มี key — Stooq q/l CSV API ถูกลบไปแล้ว)
// มี in-memory cache (TTL) เพื่อกันยิง API ซ้ำเกิน rate limit

export interface PriceQuote {
  symbol: string;
  priceUsd: number;
  source: string;
}

/** อ่านราคาจาก Binance ticker JSON — คืน null ถ้า format ผิด */
export function parseBinanceTicker(body: string): number | null {
  try {
    const data = JSON.parse(body);
    const price = Number(data?.price);
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** อ่านราคาจาก Yahoo Finance chart JSON — meta.regularMarketPrice (คืน null ถ้า format ผิด/มี error) */
export function parseYahooChart(body: string): number | null {
  try {
    const data = JSON.parse(body);
    if (data?.chart?.error) return null;
    const meta = data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** แมปสัญลักษณ์ COMMODITY ไทย/สากล → Yahoo symbol (futures) */
const YAHOO_COMMODITY: Record<string, string> = {
  XAUUSD: 'GC=F', // ทองคำ (futures)
  XAU: 'GC=F',
  GOLD: 'GC=F',
  CL: 'CL=F', // น้ำมันดิบ WTI
  OIL: 'CL=F',
  SI: 'SI=F', // เงิน
  SILVER: 'SI=F',
  NG: 'NG=F', // ก๊าซธรรมชาติ
  COPPER: 'HG=F',
};

/** in-memory cache กัน rate limit — expired คืน null */
export class PriceCache {
  private store = new Map<string, { value: number; fetchedAt: number }>();

  constructor(
    private ttlMs: number,
    private now: () => number = Date.now
  ) {}

  get(symbol: string): number | null {
    const entry = this.store.get(symbol);
    if (!entry) return null;
    if (this.now() - entry.fetchedAt >= this.ttlMs) {
      this.store.delete(symbol);
      return null;
    }
    return entry.value;
  }

  set(symbol: string, value: number): void {
    this.store.set(symbol, { value, fetchedAt: this.now() });
  }

  clear(): void {
    this.store.clear();
  }
}

export type AssetTypeStr = 'CRYPTO' | 'STOCK' | 'COMMODITY';

/** ดึงราคาล่าสุดของ symbol — คืน null เมื่อดึงไม่ได้ (offline / ผิด format) */
export async function fetchPrice(symbol: string, type: AssetTypeStr): Promise<PriceQuote | null> {
  const norm = symbol.toUpperCase().trim();
  if (!norm) return null;

  if (type === 'CRYPTO') {
    try {
      const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${norm}USDT`, {
        timeout: 10000,
        headers: { 'User-Agent': 'sovereign-os/1.0' },
      });
      const price = parseBinanceTicker(JSON.stringify(res.data));
      return price != null ? { symbol: norm, priceUsd: price, source: 'binance' } : null;
    } catch (err) {
      console.warn(`📉 Price feed: Binance ${norm} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  // STOCK (เช่น AAPL) / COMMODITY (เช่น XAUUSD = ทองคำ, CL = น้ำมันดิบ) — ผ่าน Yahoo Finance chart API
  try {
    const yahooSymbol = type === 'COMMODITY' ? YAHOO_COMMODITY[norm] ?? `${norm}=F` : norm;
    const res = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
      { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const price = parseYahooChart(JSON.stringify(res.data));
    return price != null ? { symbol: norm, priceUsd: price, source: 'yahoo' } : null;
  } catch (err) {
    console.warn(`📉 Price feed: Yahoo ${symbol} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
