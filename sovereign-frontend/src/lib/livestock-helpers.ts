// lib/livestock-helpers.ts — constants/type/ฟังก์ชันฟอร์แมตร่วมของหน้าปศุสัตว์
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003) — ห้ามแก้ค่า/รูปแบบโดยตรง
import { fmtLocale } from './formatDate';

export type Group = {
  id: string;
  code: string;
  name: string | null;
  species: string;
  quantity: number;
  birthDate: string;
  houseCode: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  _count?: { records?: number; dailyLogs?: number };
};

export const SPECIES_ORDER = ['POULTRY_BROILER', 'POULTRY_LAYER', 'DUCK', 'SWINE', 'CATTLE'];
export const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  QUARANTINE: 'bg-red-500/15 text-red-300 border-red-500/30',
  HARVESTED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  LOCKED_WITHDRAWAL: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};
export const speciesLabel = (s: string) =>
  ({ POULTRY_BROILER: 'speciesBroiler', POULTRY_LAYER: 'speciesLayer', DUCK: 'speciesDuck', SWINE: 'speciesSwine', CATTLE: 'speciesCattle' })[s] ?? s;
export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(fmtLocale()) : '—');
export const fmtNum = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toLocaleString(fmtLocale(), { maximumFractionDigits: digits }));

export const TABS = ['groups', 'medical', 'climate', 'production', 'biosecurity', 'finance'] as const;
export type TabId = (typeof TABS)[number];
