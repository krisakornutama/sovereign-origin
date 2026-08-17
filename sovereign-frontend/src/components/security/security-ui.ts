import { fmtLocale } from '../../lib/formatDate';

export type ActionMsgType = 'success' | 'info' | 'error';

export interface ActionMsg {
  type: ActionMsgType;
  text: string;
}

// แยก IP ออกจาก address ที่อาจมี port ต่อท้าย ([::1]:80, 1.2.3.4:5432, ...)
export function extractIp(addr: string): string {
  const t = (addr || '').trim();
  const bracket = t.match(/^\[([^\]]+)\]/);
  if (bracket) return bracket[1];
  const parts = t.split(':');
  if (parts.length === 2 && parts[0].includes('.')) return parts[0];
  return t;
}

export const ACTION_STYLES: Record<ActionMsgType, string> = {
  success: 'bg-emerald-900/30 text-emerald-400 border-emerald-800 shadow-neon-green',
  info: 'bg-amber-900/30 text-amber-300 border-amber-700',
  error: 'bg-red-900/30 text-red-400 border-red-800 shadow-neon-red',
};

export function fmtTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString(fmtLocale());
}

export function fmtArgs(args: any): string {
  if (!args || Object.keys(args).length === 0) return '{}';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}