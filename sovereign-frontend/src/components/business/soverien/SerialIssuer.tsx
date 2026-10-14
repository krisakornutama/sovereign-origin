"use client";
// components/business/soverien/SerialIssuer.tsx
// ส่วนที่ 2 — ออก Serial Number ต่อเนื่อง (14/10/69)
// รูปแบบ: Soverign-Temp-000, 001, 002 ... (ตัวนับเดินทางเดียว ห้ามซ้ำแม้ void)
// ประวัติทั้งหมด + จัดการรุ่นสินค้า
import { useMemo, useState } from 'react';
import { Db, Serial } from './types';
import { formatSn, issueSerials, modelById, peekNext, thaiDate } from './store';
import { Card, Field, inputCls, btnPrimary, btnGhost, btnDanger, Stat, Notice, Empty } from './ui';

const STATUS_LABEL: Record<Serial['status'], string> = { STOCK: 'ในคลัง', SOLD: 'ขายแล้ว', VOID: 'ยกเลิก' };
const STATUS_CLS: Record<Serial['status'], string> = {
  STOCK: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  SOLD: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  VOID: 'text-gray-500 bg-slate-800/60 border-slate-700',
};

export default function SerialIssuer({ db, setDb }: { db: Db; setDb: (d: Db) => void }) {
  const activeModels = useMemo(() => db.models.filter((m) => m.active), [db.models]);
  const [modelId, setModelId] = useState(activeModels[0]?.id ?? '');
  const [qty, setQty] = useState('10');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [issued, setIssued] = useState<Serial[]>([]);
  const [showAll, setShowAll] = useState(false);

  const model = modelById(db, modelId) ?? activeModels[0];
  const count = Math.max(1, Math.min(999, Number(qty) || 1));
  const preview = model ? peekNext(model, Math.min(count, 5)) : [];

  function generate() {
    if (!model) return;
    const made = issueSerials(db, model.id, count);
    // ⚠ ต้องสร้าง object ใหม่เสมอ 14/10/69
    //   เดิม `const next = db; next.serials = [...]` คือ object เดิมเป๊ะ
    //   → React เทียบด้วย Object.is เห็นว่าเหมือนเดิม จึง "ไม่วาดใหม่"
    //   → ผู้ใช้ต้องกดอะไรสักอย่างเพื่อให้หน้าจอรีเฟรช (อาการที่เจ้าของเจอ)
    setDb({ ...db, serials: [...db.serials, ...made] });
    setIssued(made);
    setMsg({ ok: true, text: `ออก serial แล้ว ${made.length} ชิ้น (${made[0].sn} → ${made[made.length - 1].sn})` });
  }

  function voidSerial(sn: string) {
    const s = db.serials.find((x) => x.sn === sn);
    if (!s || s.status === 'SOLD') return;
    setDb({ ...db, serials: db.serials.map((x) => (x.sn === sn ? { ...x, status: 'VOID' } : x)) });
    setMsg({ ok: true, text: `ยกเลิก ${sn} แล้ว (ตัวนับไม่ถอย — serial จะไม่ถูกใช้ซ้ำ)` });
  }

  function updateModel(id: string, patch: Partial<{ name: string; price: number; active: boolean }>) {
    setDb({ ...db, models: db.models.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }

  const listed = showAll ? db.serials : db.serials.slice(-50).reverse();

  return (
    <div className="space-y-4">
      <Card title="ออก Serial" sub={`รูปแบบ: ${model ? `${model.prefix}-000, 001, 002 …` : '—'}`}>
        {msg && <Notice kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Notice>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="รุ่น">
            <select className={inputCls} value={model?.id ?? ''} onChange={(e) => setModelId(e.target.value)} aria-label="เลือกรุ่น">
              {activeModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({formatSn(m, Math.max(0, m.lastNo + 1))} ถัดไป)</option>
              ))}
            </select>
          </Field>
          <Field label="จำนวน" hint="ครั้งละไม่เกิน 999 ชิ้น (ต้องเกิน 999 ให้เพิ่มรุ่นใหม่)">
            <input type="number" min={1} max={999} className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>

        {preview.length > 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <div className="text-xs text-gray-500 mb-1.5">
              ตัวถัดไป{count > preview.length ? ` (แสดง 5 จาก ${count})` : ''}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {preview.map((sn) => (
                <span key={sn} className="mono text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-emerald-300">{sn}</span>
              ))}
              {count > preview.length && <span className="mono text-xs px-2 py-1 text-gray-500">…</span>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={generate} disabled={!model}>ออก Serial ใหม่</button>
          <span className="self-center text-xs text-gray-500">
            ออกแล้วทั้งหมด {db.serials.length} · ในคลัง {db.serials.filter((s) => s.status === 'STOCK').length}
          </span>
        </div>

        {issued.length > 0 && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="text-xs text-gray-400 mb-1">ออกใหม่ล่าสุด {issued.length} ชิ้น</div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {issued.map((s) => (
                <span key={s.sn} className="mono text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">{s.sn}</span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="จัดการรุ่นสินค้า" sub="เพิ่มรุ่นใหม่ได้เมื่อมีสินค้าหลายแบรนด์/รุ่น">
        <div className="space-y-2">
          {db.models.map((m) => (
            <div key={m.id} className="grid gap-2 sm:grid-cols-[1fr_7rem_6rem_auto] items-center border border-slate-700 rounded-lg p-2">
              <input className={inputCls} value={m.name} onChange={(e) => updateModel(m.id, { name: e.target.value })} aria-label="ชื่อรุ่น" />
              <input className={inputCls} value={m.prefix} readOnly aria-label="prefix" title="prefix เปลี่ยนไม่ได้หลังออก serial แล้ว เพราะจะทำให้ S/N เดิมไม่ตรง" />
              <input type="number" min={0} className={inputCls} value={m.price}
                onChange={(e) => updateModel(m.id, { price: Number(e.target.value) || 0 })} aria-label="ราคาต่อหน่วย" />
              <label className="flex items-center gap-1.5 text-xs text-gray-400 whitespace-nowrap">
                <input type="checkbox" checked={m.active} onChange={(e) => updateModel(m.id, { active: e.target.checked })} />
                ใช้งาน
              </label>
            </div>
          ))}
        </div>
        <button type="button" className={btnGhost} onClick={() => {
          const id = `model-${Date.now().toString(36)}`;
          const n = db.models.length + 1;
          const nextModels = [...db.models, { id, name: `รุ่นใหม่ ${n}`, prefix: `Soverign-Unit${n}`, price: 990, active: true, lastNo: -1 }];
          setDb({ ...db, models: nextModels });
          setModelId(id);
        }}>+ เพิ่มรุ่น</button>
        <p className="text-[11px] text-gray-500">prefix เป็นตัวกำหนดรูปแบบ S/N · เปลี่ยนแล้ว serial ที่ออกไปแล้วจะไม่ตรงกับที่พิมพ์บนป้าย</p>
      </Card>

      <Card
        title="ประวัติ Serial ที่ออกแล้ว"
        sub={`ทั้งหมด ${db.serials.length} ชิ้น`}
        right={<button type="button" className={btnGhost} onClick={() => setShowAll((v) => !v)}>{showAll ? 'แสดง 50 ล่าสุด' : 'แสดงทั้งหมด'}</button>}
      >
        {listed.length === 0 ? <Empty>ยังไม่มี serial — กด “ออก Serial ใหม่” เพื่อเริ่ม</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500 border-b border-slate-700">
                <th className="py-1.5 pr-2 font-normal">S/N</th>
                <th className="py-1.5 pr-2 font-normal">รุ่น</th>
                <th className="py-1.5 pr-2 font-normal">วันที่ออก</th>
                <th className="py-1.5 pr-2 font-normal">สถานะ</th>
                <th className="py-1.5 font-normal">ออเดอร์</th>
              </tr></thead>
              <tbody>
                {listed.map((s) => (
                  <tr key={s.sn} className="border-b border-slate-800/60">
                    <td className="py-1.5 pr-2 mono text-gray-100">{s.sn}</td>
                    <td className="py-1.5 pr-2 text-gray-400">{modelById(db, s.modelId)?.name ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-gray-400">{thaiDate(s.issuedAt)}</td>
                    <td className="py-1.5 pr-2">
                      <span className={`px-1.5 py-0.5 rounded border ${STATUS_CLS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                    </td>
                    <td className="py-1.5">
                      <span className="text-gray-500">{s.orderId ?? '—'}</span>
                      {s.status === 'STOCK' && (
                        <button type="button" className={`${btnDanger} !px-2 !py-0.5 text-[11px] ml-2`} onClick={() => voidSerial(s.sn)}>ยกเลิก</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="ออกทั้งหมด" value={db.serials.length} />
        <Stat label="ในคลัง" value={db.serials.filter((s) => s.status === 'STOCK').length} tone="good" />
        <Stat label="ขายแล้ว" value={db.serials.filter((s) => s.status === 'SOLD').length} />
        <Stat label="ยกเลิก" value={db.serials.filter((s) => s.status === 'VOID').length} tone="muted" />
      </div>
    </div>
  );
}