"use client";
/**
 * วงจรปุ๋ยหมัก (CompostPanel) — สายงานจริง: ขยะ → กองหมัก → ปุ๋ยเข้าคลังอัตโนมัติ
 * backend: /api/compost (batches GET/POST, :id/harvest POST, waste POST)
 * signature: soil heat-bar — ความเข้ม = วันหมักผ่านไปเทียบระยะเวลาของวิธีจริง
 *   biochar 7 วัน / bokashi 14 / hot 30 / vermi 60 (ตรงกับ METHOD_DAYS ฝั่ง API)
 */
import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useCanWriteModules } from '../../lib/roles';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtDate } from '../../lib/formatDate';
import Icon from '../ui/Icon';
import EmptyState from '../ui/EmptyState';

type Batch = {
  id: string;
  method: string;
  status: string;
  inputKg: number;
  outputKg: number | null;
  startAt: string;
  estReadyAt: string | null;
  readyAt: string | null;
  note: string | null;
};

const METHOD_DAYS: Record<string, number> = { biochar: 7, bokashi: 14, hot: 30, vermi: 60 };
const METHOD_LABEL: Record<string, string> = { hot: 'หมักร้อน', vermi: 'ไส้เดือน', bokashi: 'โบคาชิ', biochar: 'ถ่านชีวภาพ' };
// สีของแต่ละวิธี — มาจากวัสดุจริง: ถ่าน = เทา, โบคาชิ = รำข้าว, หมักร้อน = ถ่านไฟแดง, ไส้เดือน = ดินเหนียว
const METHOD_COLOR: Record<string, string> = { hot: '#E8730C', vermi: '#B4654A', bokashi: '#C9A227', biochar: '#9CA3AF' };
const REASON_LABEL: Record<string, string> = { trim: 'แต่งก้าน/เศษผัก', spoiled: 'เน่าเสีย', expired: 'หมดอายุ', plate_waste: 'เศษจาน', prep_error: 'เตรียมผิด' };

const EMBER = '#E8730C';
const SPROUT = '#7BC96A';
const HUMUS = '#1C140D';
const LOAM = '#3A2C1B';

const API = `${process.env.NEXT_PUBLIC_API_URL}/api/compost`;
const DAY_MS = 86_400_000;

/** % ความร้อนของกอง = เวลาผ่านไป / ระยะเวลาวิธีนั้น */
function heatPct(b: Batch): number {
  const days = METHOD_DAYS[b.method] ?? 30;
  const start = new Date(b.startAt).getTime();
  const est = b.estReadyAt ? new Date(b.estReadyAt).getTime() : start + days * DAY_MS;
  if (est <= start) return 100;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (est - start)) * 100)));
}

function daysLeft(b: Batch): number {
  const days = METHOD_DAYS[b.method] ?? 30;
  const start = new Date(b.startAt).getTime();
  const est = b.estReadyAt ? new Date(b.estReadyAt).getTime() : start + days * DAY_MS;
  return Math.ceil((est - Date.now()) / DAY_MS);
}

export default function CompostPanel() {
  const t = useLanguageStore((s) => s.t);
  const canWrite = useCanWriteModules();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // ฟอร์มเริ่มกอง
  const [inputKg, setInputKg] = useState('');
  const [method, setMethod] = useState('hot');
  const [note, setNote] = useState('');
  // ฟอร์มบันทึกขยะ
  const [wasteKg, setWasteKg] = useState('');
  const [wasteReason, setWasteReason] = useState('trim');
  // เก็บปุ๋ยต่อกอง (id → กก.)
  const [harvestKg, setHarvestKg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`${API}/batches`);
      const d = await r.json();
      if (r.ok) setBatches(d.batches || []);
    } catch { /* ปล่อยเงียบ — panel แสดงสถานะว่าง */ }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr(''); setMsg('');
    try { setMsg(await fn()); } catch (e: any) { setErr(e.message || 'ผิดพลาด'); } finally { setBusy(false); }
  };

  const startBatch = () => run(async () => {
    const kg = Number(inputKg);
    if (!Number.isFinite(kg) || kg <= 0) throw new Error('ระบุน้ำหนักวัสดุ (กก.) ให้มากกว่า 0');
    const r = await authFetch(`${API}/batches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputKg: kg, method, note: note || undefined }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'เริ่มกองไม่สำเร็จ');
    setInputKg(''); setNote('');
    await load();
    return `เริ่มกองหมักแล้ว — ${METHOD_LABEL[method] ?? method} ใช้เวลาราว ${METHOD_DAYS[method] ?? '?'} วัน`;
  });

  const logWaste = () => run(async () => {
    const kg = Number(wasteKg);
    if (!Number.isFinite(kg) || kg <= 0) throw new Error('ระบุน้ำหนักขยะ (กก.) ให้มากกว่า 0');
    const r = await authFetch(`${API}/waste`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qtyKg: kg, reason: wasteReason }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'บันทึกขยะไม่สำเร็จ');
    setWasteKg('');
    return `บันทึกขยะแล้ว ${kg} กก. (${REASON_LABEL[wasteReason] ?? wasteReason})`;
  });

  const harvest = (b: Batch) => run(async () => {
    const raw = harvestKg[b.id]?.trim();
    const body: Record<string, unknown> = {};
    if (raw) {
      const kg = Number(raw);
      if (!Number.isFinite(kg) || kg <= 0) throw new Error('น้ำหนักปุ๋ยต้องเป็นตัวเลขมากกว่า 0');
      body.outputKg = kg;
    }
    const r = await authFetch(`${API}/${b.id}/harvest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'เก็บปุ๋ยไม่สำเร็จ');
    setHarvestKg((p) => ({ ...p, [b.id]: '' }));
    await load();
    return `เก็บปุ๋ยแล้ว ${d.outputKg} กก. — เข้าคลังของใช้เป็น "ปุ๋ยหมัก ${METHOD_LABEL[b.method] ?? b.method}" แล้ว`;
  });

  const active = batches.filter((b) => b.status === 'active').sort((a, b) => daysLeft(a) - daysLeft(b));
  const ready = batches.filter((b) => b.status !== 'active');
  const sumIn = batches.reduce((s, b) => s + Number(b.inputKg || 0), 0);
  const sumOut = batches.reduce((s, b) => s + Number(b.outputKg || 0), 0);

  const inputCls = 'input text-[11px] py-1 px-2';
  const emberBtn = 'text-[11px] font-bold rounded px-3 py-1.5 border transition-colors disabled:opacity-50';
  const emberBtnCls = `${emberBtn} bg-[#E8730C]/15 hover:bg-[#E8730C]/25 text-[#E8730C] border-[#E8730C]/40`;

  return (
    <div className="card p-4 space-y-4 border-[#3A2C1B]/60" style={{ background: `linear-gradient(180deg, ${HUMUS}cc, rgba(17,24,39,0.6))` }}>
      {/* หัว panel + สายงานขยะ→กอง→ปุ๋ย */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-bold tracking-widest text-[#D9CDB8] flex items-center gap-1.5">
          <Icon name="refresh" size={13} /> {t('farm.compost.title', 'วงจรปุ๋ยหมัก')}
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500" aria-hidden>
          <span>ขยะ</span><Dot /><span>กองหมัก</span><Dot /><span>ปุ๋ย</span>
        </div>
      </div>

      {/* ตัวเลขสายงาน */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        {[
          [String(active.length), 'กองกำลังหมัก', 'text-[#E8730C]'],
          [String(ready.length), 'พร้อมใช้', 'text-[#7BC96A]'],
          [`${sumIn.toLocaleString()} กก.`, 'วัสดุเข้ากองรวม', 'text-[#D9CDB8]'],
          [`${sumOut.toLocaleString()} กก.`, 'ได้ปุ๋ยรวม', 'text-[#7BC96A]'],
        ].map(([v, l, c]) => (
          <div key={l} className="bg-gray-800/40 border border-[#3A2C1B]/50 rounded-lg p-2">
            <div className={`mono text-xl font-bold ${c}`}>{v}</div>
            <div className="text-[11px] text-gray-400">{l}</div>
          </div>
        ))}
      </div>

      {/* ฟอร์ม (เฉพาะที่เขียนได้) */}
      {canWrite && (
        <div className="grid md:grid-cols-2 gap-2">
          <div className="flex flex-wrap gap-1.5 items-center bg-[#1C140D]/50 border border-[#3A2C1B]/60 rounded-lg p-2">
            <input value={inputKg} onChange={(e) => setInputKg(e.target.value)} type="number" min="0" step="0.5"
              placeholder="วัสดุ (กก.)" className={`${inputCls} w-24`} aria-label="น้ำหนักวัสดุเข้ากอง" />
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${inputCls} w-28`} aria-label="วิธีหมัก">
              {Object.keys(METHOD_DAYS).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]} · {METHOD_DAYS[m]}วัน</option>)}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ" className={`${inputCls} flex-1 min-w-20`} />
            <button onClick={startBatch} disabled={busy} className={emberBtnCls}>{t('farm.compost.start', 'เริ่มกอง')}</button>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center bg-[#1C140D]/50 border border-[#3A2C1B]/60 rounded-lg p-2">
            <input value={wasteKg} onChange={(e) => setWasteKg(e.target.value)} type="number" min="0" step="0.5"
              placeholder="ขยะ (กก.)" className={`${inputCls} w-24`} aria-label="น้ำหนักขยะ" />
            <select value={wasteReason} onChange={(e) => setWasteReason(e.target.value)} className={`${inputCls} w-36`} aria-label="สาเหตุ">
              {Object.keys(REASON_LABEL).map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
            <span className="text-[10px] text-gray-500 flex-1">ลดสต๊อกคลังให้อัตโนมัติถ้าผูกของไว้</span>
            <button onClick={logWaste} disabled={busy} className={emberBtnCls}>{t('farm.compost.logWaste', 'บันทึกขยะ')}</button>
          </div>
        </div>
      )}

      {(msg || err) && (
        <div role="status" className={`text-[11px] rounded px-2 py-1 border ${err ? 'text-red-300 border-red-800/60 bg-red-950/30' : 'text-[#7BC96A] border-[#3A2C1B]/60 bg-[#1C140D]/40'}`}>
          {err || msg}
        </div>
      )}

      {/* กองกำลังหมัก */}
      {loaded && batches.length === 0 ? (
        <EmptyState
          icon={<Icon name="refresh" size={20} />}
          title={t('farm.compost.empty', 'ยังไม่มีกองหมัก')}
          description={t('farm.compost.emptyDesc', 'เศษผัก ใบไม้ และของหมดอายุ กลายเป็นปุ๋ยได้ — เริ่มกองแรกได้เลย')}
        />
      ) : (
        <>
          {active.length > 0 && (
            <div className="grid md:grid-cols-2 gap-2">
              {active.map((b) => {
                const pct = heatPct(b);
                const left = daysLeft(b);
                const color = METHOD_COLOR[b.method] ?? EMBER;
                const done = left <= 0;
                return (
                  <div key={b.id} className="rounded-lg border border-[#3A2C1B]/60 bg-[#1C140D]/40 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}88` }} aria-hidden />
                      <span className="text-xs font-bold text-[#D9CDB8]">{METHOD_LABEL[b.method] ?? b.method}</span>
                      <span className="mono text-[11px] text-gray-400">{Number(b.inputKg).toLocaleString()} กก.</span>
                      <span className={`ml-auto mono text-[11px] font-bold ${done ? 'text-[#7BC96A]' : 'text-[#E8730C]'}`}>
                        {done ? t('farm.compost.readyNow', 'พร้อมเก็บ') : `อีก ${left} วัน`}
                      </span>
                    </div>
                    {/* soil heat-bar — signature */}
                    <div className="h-1.5 rounded-full bg-[#3A2C1B]/50 overflow-hidden"
                      role="img" aria-label={`หมักมาแล้ว ${pct}%`}>
                      <div className="h-full rounded-full transition-all duration-700 motion-reduce:transition-none"
                        style={{ width: `${Math.max(pct, 4)}%`, background: `linear-gradient(90deg, ${color}55, ${color})` }} />
                    </div>
                    {b.note && <div className="text-[11px] text-gray-500 truncate">{b.note}</div>}
                    {canWrite && (
                      <div className="flex gap-1.5 items-center pt-0.5">
                        <input value={harvestKg[b.id] ?? ''} onChange={(e) => setHarvestKg((p) => ({ ...p, [b.id]: e.target.value }))}
                          type="number" min="0" step="0.5" placeholder={`ปุ๋ย (กก. · เว้นว่าง = ${Math.round(Number(b.inputKg) * 0.5)})`}
                          className={`${inputCls} flex-1`} aria-label="น้ำหนักปุ๋ยที่ได้" />
                        <button onClick={() => harvest(b)} disabled={busy}
                          className={`${emberBtn} bg-[#7BC96A]/10 hover:bg-[#7BC96A]/20 text-[#7BC96A] border-[#7BC96A]/40`}>
                          {t('farm.compost.harvest', 'เก็บปุ๋ย')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {ready.length > 0 && (
            <div className="space-y-1" aria-label="กองที่เก็บปุ๋ยแล้ว">
              {ready.map((b) => (
                <div key={b.id} className="flex items-center gap-2 text-[11px] text-gray-400 border-t border-[#3A2C1B]/40 pt-1">
                  <Icon name="check" size={12} />
                  <span className="text-[#7BC96A] font-bold">{METHOD_LABEL[b.method] ?? b.method}</span>
                  <span>{Number(b.inputKg).toLocaleString()} → {Number(b.outputKg ?? 0).toLocaleString()} กก.</span>
                  <span className="ml-auto">{b.readyAt ? fmtDate(b.readyAt, { day: '2-digit', month: 'short' }, 'date') : ''}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** จุดเชื่อมสายงาน ขยะ→กอง→ปุ๋ย */
function Dot() {
  return <span className="w-1 h-1 rounded-full bg-[#E8730C]/60 inline-block" aria-hidden />;
}
