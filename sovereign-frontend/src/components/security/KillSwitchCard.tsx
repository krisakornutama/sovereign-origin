"use client";
import { useState } from 'react';

export interface KillSwitchState {
  active: boolean;
  reason: string;
  by: string;
  at: number | null;
}

export default function KillSwitchCard({
  state,
  isSuperadmin,
  busy,
  onToggle,
}: {
  state: KillSwitchState | null;
  isSuperadmin: boolean;
  busy: boolean;
  onToggle: (active: boolean, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const active = !!state?.active;

  const engage = async () => {
    if (!window.confirm('⛔ เปิด Kill-Switch?\n\nAI Agent ทุกตัว (chat, action tools, approvals) จะถูกหยุดทันทีทั่วทั้งระบบ โดยไม่ต้องรออนุมัติรายคำสั่ง')) return;
    await onToggle(true, reason);
    setReason('');
  };

  const release = async () => {
    if (!window.confirm('🟢 ปิด Kill-Switch?\n\nปลดล็อกให้ AI Agent ทำงานได้ตามปกติ')) return;
    await onToggle(false, '');
  };

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${active ? 'bg-red-950/40 border-red-700' : 'bg-gray-900 border-gray-700'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">
          {active ? '⛔ AI KILL-SWITCH — เปิดอยู่' : '⛔ Emergency Kill-Switch'}
          <span className={`ml-2 inline-block w-3 h-3 rounded-full ${active ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
        </h2>
        {active && (
          <span className="text-[10px] px-2 py-1 rounded bg-red-900/60 border border-red-700 text-red-200">
            โดย {state?.by || 'ไม่ทราบ'} · {state?.at ? new Date(state.at).toLocaleString('th-TH') : ''}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        ปุ่มหยุดฉุกเฉิน (Global Override) — กดแล้ว AI Agent ทุกตัวหยุดทำงานทันที:
        ปฏิเสธ action tool ทุกชนิด, ระงับการอนุมัติคำสั่งทั้งหมด, และ AI chat ตอบกลับด้วยข้อความแจ้งหยุด
        {active && state?.reason && <span className="text-red-300"> — เหตุผล: {state.reason}</span>}
      </p>
      {isSuperadmin && !active && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เหตุผล (เช่น พบ loop ผิดปกติ / เจอ prompt injection) — บังคับใส่"
            className="flex-1 min-w-52 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
          />
          <button
            onClick={engage}
            disabled={busy || !reason.trim()}
            className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-bold disabled:opacity-40 transition"
          >
            {busy ? '⏳...' : '⛔ เปิด Kill-Switch'}
          </button>
        </div>
      )}
      {isSuperadmin && active && (
        <button
          onClick={release}
          disabled={busy}
          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-xs font-bold disabled:opacity-40 transition"
        >
          {busy ? '⏳...' : '🟢 ปลดล็อก (ปิด Kill-Switch)'}
        </button>
      )}
      {!isSuperadmin && (
        <p className="text-[10px] text-gray-600">เฉพาะ SUPERADMIN เท่านั้นที่เปิด/ปิดสวิตช์นี้ได้</p>
      )}
    </div>
  );
}