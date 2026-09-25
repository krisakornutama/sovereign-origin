import type { ReactNode } from 'react';
import { fmtLocale } from '../../lib/formatDate';

// ── ส่วนใช้ร่วมของ NextGenPanel (แยกจาก NextGenPanel — phase 4 ลดหนี้ไฟล์ยักษ์) ──
// Pillar 1: Threat Intelligence DB · Pillar 2: App Control (DPI) · Pillar 3: Network Visibility
// + integrations: Pi-hole (DNS filter) · Suricata (IDS/IPS) · ntopng · ClamAV · AI Analyst (Ollama)
export const API = `${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen`;

export const CATEGORIES = ['all', 'malware', 'phishing', 'cnc', 'scam', 'ad', 'tracking', 'gambling', 'piracy', 'violence', 'unknown'];
export const CATEGORY_LABEL: Record<string, string> = {
  malware: 'มัลแวร์', phishing: 'ฟิชชิ่ง', cnc: 'C2/Botnet', scam: 'สแกม', ad: 'โฆษณา',
  tracking: 'ติดตาม', gambling: 'พนัน', piracy: 'ละเมิดลิขสิทธิ์', violence: 'รุนแรง', unknown: 'ไม่ทราบ',
};

export function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="panel panel-cyan p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Btn({ onClick, children, disabled, tone = 'default' }: any) {
  const tones: Record<string, string> = {
    default: 'btn-secondary',
    green: 'btn-primary',
    red: 'btn-danger',
    amber: 'btn-secondary',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-xs font-bold ${tones[tone] || tones.default}`}
    >
      {children}
    </button>
  );
}

export function Chip({ label, value, tone = 'default' }: { label: string; value: any; tone?: 'ok' | 'err' | 'warn' | 'default' }) {
  const tones: Record<string, string> = {
    ok: 'text-emerald-400', err: 'text-red-400', warn: 'text-amber-400', default: 'text-gray-100',
  };
  return (
    <div className="inset px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tones[tone]} glow-text`}>{value}</div>
    </div>
  );
}

export const SEV_COLORS: Record<string, string> = {
  critical: 'bg-red-900/60 text-red-300 border-red-800',
  warning: 'bg-amber-900/50 text-amber-300 border-amber-800',
  info: 'bg-blue-900/40 text-blue-300 border-blue-800',
};

export function fmtTime(ts?: string): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    return d.toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
}

// context ที่แท็บทุกตัวใช้ร่วม (เดิมเป็น closure ของ NextGenPanel — แยกไฟล์แล้วส่งเป็น props)
export interface NextGenCtx {
  t: (key: string, fallback?: string, params?: Record<string, unknown>) => string;
  notify: (type: 'ok' | 'err', text: string) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  status: any;
  loadStatus: () => void;
  isSuperadmin: boolean;
  catLabel: (c: string) => string;
}

