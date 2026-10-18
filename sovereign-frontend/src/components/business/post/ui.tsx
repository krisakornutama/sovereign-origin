"use client";
// components/business/post/ui.tsx
// ชิ้นส่วน UI เล็ก ๆ ของแท็บ "📣 โพสต์"
//
// ⚠ ตั้งใจไม่ import จาก ../soverien/ui โดยเด็ดขาด
//   tools/frontend-gate.mjs ห้าม components/<โฟลเดอร์> import ข้ามไปโฟลเดอร์ feature อื่น
//   (ยกเว้น ui/ กับ layout/) — ข้ามแล้วเกตล้ม
import { ReactNode } from 'react';

export const INPUT_CLS =
  'w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-cyan-500';

export const BTN_BASE =
  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const BTN_PRIMARY = `${BTN_BASE} bg-cyan-600 border-cyan-500 hover:bg-cyan-500 text-white`;
export const BTN_GHOST = `${BTN_BASE} bg-slate-800 border-slate-600 hover:bg-slate-700 text-gray-200`;
export const BTN_GOOD = `${BTN_BASE} bg-emerald-600 border-emerald-500 hover:bg-emerald-500 text-white`;

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

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-gray-500 leading-relaxed">{children}</p>;
}

/** ตัวนับตัวอักษร — เปลี่ยนเป็นสีเตือนทันทีที่เกินเพดาน (ก่อนกดโพสต์ ไม่ใช่หลัง) */
export function Counter({ len, max }: { len: number; max: number }) {
  const over = len > max;
  return (
    <span className={`text-[11px] tabular-nums ${over ? 'text-rose-400 font-semibold' : 'text-gray-500'}`}>
      {len.toLocaleString('th-TH')}/{max.toLocaleString('th-TH')}
      {over ? ` · เกิน ${(len - max).toLocaleString('th-TH')}` : ''}
    </span>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  const cls =
    kind === 'error'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
      : kind === 'warn'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`border rounded px-3 py-2 text-xs leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}
