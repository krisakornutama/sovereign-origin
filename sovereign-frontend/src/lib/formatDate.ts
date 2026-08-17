// ─────────────────────────────────────────────────────────────
//  formatDate — รูปแบบวันที่/เวลาตามภาษาที่เลือก (th → th-TH, en → en-US)
//  ใช้แทน new Date(x).toLocaleString('th-TH', ...) ที่เคยตายตัวภาษาไทย
//    fmtDate(x)                                  → วันที่+เวลา
//    fmtDate(x, { day:'2-digit' }, 'date')       → วันที่อย่างเดียว
//    fmtDate(x, { hour:'2-digit' }, 'time')      → เวลาอย่างเดียว
// ─────────────────────────────────────────────────────────────
import { useLanguageStore } from '../stores/useLanguageStore';

export type FmtMode = 'datetime' | 'date' | 'time';

export function fmtLocale(): string {
  return useLanguageStore.getState().lang === 'th' ? 'th-TH' : 'en-US';
}

export function fmtDate(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
  mode: FmtMode = 'datetime'
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const loc = fmtLocale();
  if (mode === 'date') return d.toLocaleDateString(loc, options);
  if (mode === 'time') return d.toLocaleTimeString(loc, options);
  return d.toLocaleString(loc, options);
}