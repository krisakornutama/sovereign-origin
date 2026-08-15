"use client";
import { useState } from 'react';

export interface RealityCorrection {
  id: string;
  kind: 'false_positive' | 'false_negative' | 'context';
  note: string;
  by: string;
  ts: number;
  source_type?: string;
  source_event_id?: string;
}

export interface RealityStats {
  corrections30d: number;
  falsePositives30d: number;
  falseNegatives30d: number;
  alerts30d: number;
  paranoiaIndex: number;
  calibration: 'calibrated' | 'watch' | 'unstable';
  latest: RealityCorrection[];
}

const CALIB: Record<RealityStats['calibration'], { label: string; cls: string }> = {
  calibrated: { label: 'Calibrated — AI ยังเชื่อถือได้', cls: 'text-green-400 border-green-600 bg-green-950/40' },
  watch: { label: 'Watch — AI เตือนผิดบ่อยขึ้น ควรสังเกต', cls: 'text-yellow-400 border-yellow-600 bg-yellow-950/40' },
  unstable: { label: 'UNSTABLE — AI เตือนผิดเกินเกณฑ์ ลด sensitivity', cls: 'text-red-400 border-red-600 bg-red-950/40' },
};

const KIND_LABEL: Record<RealityCorrection['kind'], string> = {
  false_positive: 'AI เตือนผิด (ไม่ใช่ภัย)',
  false_negative: 'AI พลาด (ควรเตือน)',
  context: 'ข้อมูลบริบทเพิ่มเติม',
};

export default function RealityCard({
  stats,
  busy,
  onCorrect,
}: {
  stats: RealityStats | null;
  busy: boolean;
  onCorrect: (kind: RealityCorrection['kind'], note: string, sourceType?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<RealityCorrection['kind']>('false_positive');
  const [note, setNote] = useState('');

  if (!stats) return null;
  const c = CALIB[stats.calibration];

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">🧠 Reality-Check · Paranoia Index</h2>
        <span className={`text-[10px] px-2 py-1 rounded border ${c.cls}`}>{c.label}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-yellow-400">{stats.paranoiaIndex.toFixed(3)}</div>
          <div className="text-[10px] text-gray-500">Paranoia Index (เตือนผิด/alert)</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-red-400">{stats.falsePositives30d}</div>
          <div className="text-[10px] text-gray-500">เตือนผิด 30 วัน</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-blue-400">{stats.alerts30d}</div>
          <div className="text-[10px] text-gray-500">Alert ทั้งหมด 30 วัน</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-gray-200">{stats.corrections30d}</div>
          <div className="text-[10px] text-gray-500">คำยืนยันจากครอบครัว</div>
        </div>
      </div>
      <p className="text-[10px] text-gray-500">
        Paranoia Index = สัดส่วนที่ AI เตือนผิดเมื่อเทียบกับ alert ทั้งหมดใน 30 วัน
        {stats.paranoiaIndex > 0.4 && (
          <span className="text-red-400"> — เกิน 0.4 แล้ว! แนะนำให้ SUPERADMIN ลดความไวของระบบ (เช่น raise confidence_min ใน Vision/Firewall rules)</span>
        )}
        ข้อมูลนี้ยังถูกส่งให้ AI อ่านก่อนตอบคำถามทุกครั้ง (reality anchor) เพื่อกันไม่ให้ AI ติดหลงเชื่อการเตือนที่ผิดซ้ำ ๆ
      </p>
      <div className="rounded bg-gray-800/60 p-2 space-y-1.5 max-h-32 overflow-y-auto">
        {stats.latest.length === 0 && <p className="text-[10px] text-gray-600">ยังไม่มีการยืนยัน — เมื่อเห็น alert ที่ "AI เข้าใจผิด" ให้กดปุ่มในตารางเหตุการณ์ หรือแจ้งที่นี่</p>}
        {stats.latest.map((l) => (
          <div key={l.id} className="flex items-start gap-2 text-[11px]">
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] ${l.kind === 'false_positive' ? 'bg-red-900/60 text-red-300' : l.kind === 'false_negative' ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>
              {KIND_LABEL[l.kind]}
            </span>
            <span className="text-gray-300 break-all">{l.note}</span>
            <span className="shrink-0 text-gray-600 ml-auto">{(l.by || 'system').slice(0, 8)} · {new Date(l.ts).toLocaleTimeString('th-TH')}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as RealityCorrection['kind'])}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
        >
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น นี่คือช่างที่เราจ้างมาซ่อมกล้อง ไม่ใช่ผู้บุกรุก"
          className="flex-1 min-w-52 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
        />
        <button
          onClick={async () => {
            if (!note.trim()) return alert('ใส่รายละเอียดก่อน');
            await onCorrect(kind, note.trim());
            setNote('');
          }}
          disabled={busy}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold disabled:opacity-40 transition"
        >
          {busy ? '⏳...' : 'ยืนยัน (reality anchor)'}
        </button>
      </div>
    </div>
  );
}