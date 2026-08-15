"use client";
import { useState } from 'react';

export interface FirstResponderState {
  active: boolean;
  by: string;
  at: number | null;
  note: string;
  expiresAt: number | null;
  remainingMs: number | null;
}

function fmtCountdown(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m} นาที ${s} วินาที`;
}

export default function FirstResponderCard({
  state,
  isSuperadmin,
  busy,
  onToggle,
}: {
  state: FirstResponderState | null;
  isSuperadmin: boolean;
  busy: boolean;
  onToggle: (active: boolean, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const active = !!state?.active;

  const engage = async () => {
    if (!window.confirm('🚨 เปิด First-Responder Mode?\n\nปลดล็อกประตู (relay), หยุดการแจ้งเตือนคนแปลกหน้าจาก Vision AI — สำหรับรับหน่วยกู้ภัย/เจ้าหน้าที่เข้าบ้าน · หมดอายุอัตโนมัติใน 2 ชั่วโมง')) return;
    await onToggle(true, note);
    setNote('');
  };

  const release = async () => {
    await onToggle(false, '');
  };

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${active ? 'bg-red-950/50 border-red-600' : 'bg-gray-900 border-gray-700'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">
          {active ? '🚨 FIRST-RESPONDER MODE — เปิดอยู่' : '🚨 First-Responder Mode (SOS)'}
          {active && <span className="ml-2 inline-block w-3 h-3 rounded-full bg-red-500 animate-pulse" />}
        </h2>
        {active && (
          <span className="text-[10px] px-2 py-1 rounded bg-red-900/60 border border-red-700 text-red-200">
            หมดอายุใน {state?.remainingMs != null ? fmtCountdown(state.remainingMs) : '-'} · เปิดโดย {state?.by || '-'}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        โหมดรับมือเหตุฉุกเฉิน: <b className="text-red-300">Vision AI หยุดแจ้งเตือน "คนแปลกหน้า" ทันที</b> (หน่วยกู้ภัย/ตำรวจ/เจ้าหน้าที่จะไม่ถูกมองเป็นผู้บุกรุก)
        — เหมาะกับกรณีเรียก 1669/191/ดับเพลิง ระบบจะหมดอายุอัตโนมัติไม่ให้ลืมปิด
        {active && state?.note && <span className="text-red-300"> — หมายเหตุ: {state.note}</span>}
      </p>
      {isSuperadmin && !active && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="หมายเหตุ เช่น เรียกหน่วยกู้ภัย — อุบัติเหตุในบ้าน (ไม่บังคับ)"
            className="flex-1 min-w-52 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
          />
          <button
            onClick={engage}
            disabled={busy}
            className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-bold disabled:opacity-40 transition"
          >
            {busy ? '⏳...' : '🚨 เปิดโหมดฉุกเฉิน'}
          </button>
        </div>
      )}
      {isSuperadmin && active && (
        <button
          onClick={release}
          disabled={busy}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold disabled:opacity-40 transition"
        >
          {busy ? '⏳...' : '🟢 ปิดโหมด (กลับสู่ปกติ)'}
        </button>
      )}
      {!isSuperadmin && (
        <p className="text-[10px] text-gray-600">เฉพาะ SUPERADMIN เท่านั้นที่เปิด/ปิดโหมดนี้ได้</p>
      )}
    </div>
  );
}