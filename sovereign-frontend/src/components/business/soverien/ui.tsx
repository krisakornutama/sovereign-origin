"use client";
// components/business/soverien/ui.tsx
// ชิ้นส่วน UI ที่ใช้ซ้ำทุกแท็บของชุดเครื่องมือ Soverien
// แยกไฟล์เพื่อไม่ให้แต่ละแท็บต้องเขียน markup ซ้ำ (และให้แต่ละไฟล์อยู่ใต้เพดาน 400 บรรทัด)
import { ReactNode, useState } from 'react';

export function Card({ title, sub, right, children }: { title?: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4 space-y-3">
      {(title || right) && (
        <header className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            {title && <h3 className="font-semibold text-gray-100">{title}</h3>}
            {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-gray-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-gray-100 ' +
  'placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/60';

export const btn =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40';
export const btnPrimary = `${btn} bg-emerald-600 hover:bg-emerald-500 text-gray-950`;
export const btnGhost = `${btn} border border-slate-600 hover:bg-slate-700/40 text-gray-200`;
export const btnDanger = `${btn} border border-rose-800 text-rose-300 hover:bg-rose-950/50`;

export function Stat({ label, value, tone = 'default', hint }: { label: string; value: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'muted'; hint?: string }) {
  const map = {
    default: 'text-gray-100 border-slate-700',
    good: 'text-emerald-300 border-emerald-500/30',
    warn: 'text-amber-300 border-amber-500/30',
    bad: 'text-rose-300 border-rose-500/30',
    muted: 'text-gray-400 border-slate-800',
  } as const;
  return (
    <div className={`rounded-lg border bg-slate-900/40 px-3 py-2 ${map[tone]}`}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-semibold mono">{value}</div>
      {hint && <div className="text-[10px] text-gray-500">{hint}</div>}
    </div>
  );
}

export function Notice({ kind, children }: { kind: 'ok' | 'err'; children: ReactNode }) {
  const cls = kind === 'ok'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  return <div role={kind === 'err' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500 border border-dashed border-slate-700 rounded-lg px-3 py-6 text-center">{children}</p>;
}

/** ปุ่มล็อกด้วย PIN 4 หลัก (ตั้งค่าได้จากแท็บสำรอง/ความปลอดภัย) */
export function PinGate({ pin, onUnlock, title = 'ใส่ PIN เพื่อเข้าใช้' }: { pin: string; onUnlock: () => void; title?: string }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  return (
    <div className="max-w-xs mx-auto space-y-3 py-10 text-center">
      <div className="text-2xl">🔒</div>
      <p className="text-sm text-gray-300">{title}</p>
      <input
        inputMode="numeric" maxLength={4} value={v} autoFocus
        onChange={(e) => { setErr(false); setV(e.target.value.replace(/\D/g, '')); }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (v === pin) onUnlock(); else { setErr(true); setV(''); }
        }}
        className={`${inputCls} text-center mono tracking-[0.5em] text-lg ${err ? 'border-rose-500' : ''}`}
        aria-label="PIN 4 หลัก"
      />
      {err && <div className="text-xs text-rose-400">PIN ไม่ถูกต้อง</div>}
      <button className={btnPrimary} onClick={() => { if (v === pin) onUnlock(); else { setErr(true); setV(''); } }}>
        เข้าใช้
      </button>
    </div>
  );
}