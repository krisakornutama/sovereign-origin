"use client";
// components/business/soverien/StickerSerialPicker.tsx
// กล่อง "เลือก Serial" (แยกจาก StickerStudio เพราะไฟล์หลักชิดเพดาน 400 บรรทัด)
import type { Db, Serial } from './types';
import { modelById, thaiDate } from './store';
import { Card, Empty } from './ui';

export default function StickerSerialPicker({
  db, pool, picked, activeSerial, onToggle, onPreview, onPickAll, onClearAll,
}: {
  db: Db;
  pool: Serial[];
  picked: Set<string>;
  activeSerial?: Serial;
  onToggle: (sn: string) => void;
  onPreview: (sn: string) => void;
  onPickAll: () => void;
  onClearAll: () => void;
}) {
  return (
    <Card title="4) เลือก Serial" sub={`เลือกแล้ว ${picked.size} / ${pool.length}`}
      right={(
        <div className="flex gap-1.5">
          <button type="button" className="text-[11px] text-cyan-400 hover:underline" onClick={onPickAll}>เลือกทั้งหมด</button>
          <button type="button" className="text-[11px] text-gray-500 hover:underline" onClick={onClearAll}>ล้าง</button>
        </div>
      )}>
      {pool.length === 0 ? <Empty>ยังไม่มี serial — ไปที่หัวข้อ “ออก Serial” ก่อน</Empty> : (
        <div className="grid gap-1.5 max-h-64 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {pool.map((s) => {
            const on = picked.has(s.sn);
            return (
              <label key={s.sn} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs cursor-pointer ${on ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-700 hover:bg-slate-800/40'}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(s.sn)} />
                <span className="mono text-gray-100 flex-1 truncate">{s.sn}</span>
                <span className="text-[10px] text-gray-500">{s.status === 'SOLD' ? 'ขายแล้ว' : 'ในคลัง'}</span>
                <button type="button" className="text-[10px] text-cyan-400 hover:underline"
                  onClick={(e) => { e.preventDefault(); onPreview(s.sn); }}>
                  ดู
                </button>
              </label>
            );
          })}
        </div>
      )}
      {activeSerial && (
        <p className="text-xs text-gray-500">
          กำลังดู: <span className="mono text-gray-200">{activeSerial.sn}</span>
          {' · '}{modelById(db, activeSerial.modelId)?.name}
          {' · '}วันที่ออก serial {thaiDate(activeSerial.issuedAt)}
        </p>
      )}
    </Card>
  );
}