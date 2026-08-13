import { create } from 'zustand';

export interface RunwayInfo {
  months: number | null;
  monthlyBurnUsd: number;
  energyCostUsd: number;
}

export interface WealthSummary {
  portfolioUsd: number; // มูลค่าพอร์ต (ไม่รวมเงินสด)
  inventoryUsd: number; // เสบียงกายภาพ
  grandTotalUsd: number; // พอร์ต + เสบียง + เงินสด
  cashUsd: number;
  runway: RunwayInfo | null;
  missingPrices: string[];
  timestamp?: string;
}

// Payload จาก socket (wealthEmitter) ใช้ key: totalUsd / inventoryUsd / grandTotalUsd / runway / missingPrices / cashUsd
// Payload จาก REST /api/portfolio/summary ใช้ key: portfolioUsd / ...
type WealthPayload = Partial<WealthSummary> & {
  totalUsd?: number;
  portfolioUsd?: number;
};

function normalize(data: WealthPayload): WealthSummary {
  const portfolioUsd = data.portfolioUsd ?? data.totalUsd ?? 0;
  const inventoryUsd = data.inventoryUsd ?? 0;
  const cashUsd = data.cashUsd ?? 0;
  return {
    portfolioUsd,
    inventoryUsd,
    grandTotalUsd: data.grandTotalUsd ?? portfolioUsd + inventoryUsd + cashUsd,
    cashUsd,
    runway: data.runway ?? null,
    missingPrices: data.missingPrices ?? [],
    timestamp: data.timestamp,
  };
}

interface WealthState {
  summary: WealthSummary | null;
  setWealth: (data: WealthPayload) => void;
  seed: (data: WealthPayload) => void;
}

export const useWealthStore = create<WealthState>((set) => ({
  summary: null,

  setWealth: (data) => set({ summary: normalize(data) }),
  seed: (data) => set({ summary: normalize(data) }),
}));
