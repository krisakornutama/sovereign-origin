"use client";
// components/business/soverien/OrderVault.tsx
// ส่วนที่ 5 — คลังออเดอร์ทั้งหมด (14/10/69)
// ค้นหา · กรองสถานะ · ไฮไลต์สีประกัน · Export CSV · พิมพ์ · Void · สร้างสติกเกอร์ใหม่
import { useMemo, useState } from 'react';
import { Db, Order } from './types';
import { orderTotal, todayIso, thaiDate, warrantyState, WState } from './store';
import { ordersToCsv, printHtml, ordersPrintTable } from './csv';
import { downloadText } from './zip';
import { Card, inputCls, btnGhost, btnDanger, Empty, Notice } from './ui';

type Filter = 'ALL' | 'IN' | 'NEAR' | 'OUT' | 'VOID';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'IN', label: 'ในประกัน' },
  { key: 'NEAR', label: 'ใกล้หมด' },
  { key: 'OUT', label: 'หมดประกัน' },
  { key: 'VOID', label: 'ยกเลิก' },
];

const ROW_CLS: Record<WState, string> = {
  IN: 'border-l-2 border-l-emerald-500/70',
  NEAR: 'border-l-2 border-l-amber-500/80',
  OUT: 'border-l-2 border-l-rose-500/70',
  VOID: 'border-l-2 border-l-slate-600 opacity-60',
  UNKNOWN: '',
};

const DOT: Record<WState, string> = {
  IN: '🟢', NEAR: '🟡', OUT: '🔴', VOID: '⚫', UNKNOWN: '',
};

const STATE_LABEL: Record<WState, string> = {
  IN: 'อยู่ในประกัน', NEAR: 'ใกล้หมดประกัน', OUT: 'หมดประกัน', VOID: 'ยกเลิก', UNKNOWN: '—',
};

export default function OrderVault({ db, setDb, onGenSticker }: {
  db: Db; setDb: (d: Db) => void; onGenSticker: (serials: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [open, setOpen] = useState<Order | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const today = todayIso();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return db.orders
      .map((o) => ({ o, w: warrantyState(o, db.settings, today) }))
      .filter(({ o, w }) => filter === 'ALL' || w.state === filter)
      .filter(({ o }) => !needle
        || o.no.toLowerCase().includes(needle)
        || o.customerName.toLowerCase().includes(needle)
        || o.phone.includes(needle)
        || o.serials.some((sn) => sn.toLowerCase().includes(needle)))
      .sort((a, b) => b.o.issueDate.localeCompare(a.o.issueDate) || b.o.createdAt.localeCompare(a.o.createdAt));
  }, [db, q, filter, today]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: db.orders.length, IN: 0, NEAR: 0, OUT: 0, VOID: 0 };
    for (const o of db.orders) c[warrantyState(o, db.settings, today).state] += 1;
    return c;
  }, [db, today]);

  function voidOrder(o: Order) {
    if (!window.confirm(`ยกเลิกออเดอร์ ${o.no} ของ ${o.customerName}?\nS/N ที่ผูกไว้จะกลับเป็น "ในคลัง"`)) return;
    const next = db;
    const target = next.orders.find((x) => x.id === o.id);
    if (!target) return;
    target.status = 'VOID';
    for (const sn of target.serials) {
      const s = next.serials.find((x) => x.sn === sn);
      if (s) { s.status = 'STOCK'; s.orderId = undefined; }
    }
    setDb(next);
    setOpen(null);
    setMsg(`ยกเลิกออเดอร์ ${o.no} แล้ว · S/N กลับเข้าคลัง`);
  }

  function exportCsv() {
    const all = filter === 'ALL' && !q.trim() ? db.orders : rows.map((r) => r.o);
    if (!all.length) { setMsg('ไม่มีข้อมูลให้ export'); return; }
    const csv = ordersToCsv({ ...db, orders: all });
    downloadText(csv, `soverien-orders-${today}.csv`, 'text/csv;charset=utf-8');
    setMsg(`export CSV แล้ว ${all.length} ออเดอร์`);
  }

  function printList() {
    const list = (filter === 'ALL' && !q.trim() ? db.orders : rows.map((r) => r.o));
    if (!list.length) { setMsg('ไม่มีข้อมูลให้พิมพ์'); return; }
    printHtml('รายการออเดอร์ Soverien', ordersPrintTable(list, (o) => db.models.find((m) => o.serials[0]?.startsWith(m.prefix + '-'))?.name ?? '—'));
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind="ok">{msg}</Notice>}

      <Card title="คลังออเดอร์" sub={`ทั้งหมด ${db.orders.length} ออเดอร์ · แสดง ${rows.length} รายการ`}
        right={<div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={exportCsv}>Export CSV</button>
          <button type="button" className={btnGhost} onClick={printList}>พิมพ์</button>
        </div>}
      >
        <div className="flex flex-wrap gap-2">
          <input className={`${inputCls} flex-1 min-w-[14rem]`} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหา: S/N · เลขออเดอร์ · ชื่อลูกค้า · เบอร์โทร" aria-label="ค้นหาออเดอร์" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-lg text-xs border ${filter === f.key ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 text-gray-400 hover:bg-slate-700/30'}`}>
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>

        {rows.length === 0 ? <Empty>ไม่พบรายการตามเงื่อนไขที่เลือก</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-slate-700">
                  <th className="py-2 pr-2 font-normal">S/N</th>
                  <th className="py-2 pr-2 font-normal">รุ่น</th>
                  <th className="py-2 pr-2 font-normal">ลูกค้า</th>
                  <th className="py-2 pr-2 font-normal">วันที่ออก</th>
                  <th className="py-2 pr-2 font-normal">ประกันถึง</th>
                  <th className="py-2 pr-2 font-normal">สถานะ</th>
                  <th className="py-2 font-normal">เหลือ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ o, w }) => (
                  <tr key={o.id} onClick={() => setOpen(o)}
                    className={`cursor-pointer hover:bg-slate-800/40 border-b border-slate-800/60 ${ROW_CLS[w.state]}`}>
                    <td className="py-2 pr-2 mono text-gray-100">{o.serials.join(', ')}</td>
                    <td className="py-2 pr-2 text-gray-400">{db.models.find((m) => o.serials[0]?.startsWith(m.prefix + '-'))?.name ?? '—'}</td>
                    <td className="py-2 pr-2 text-gray-300">
                      <span className="mono text-[10px] text-gray-500">{o.no}</span> {o.customerName}
                      <div className="text-[10px] text-gray-500">{o.phone}</div>
                    </td>
                    <td className="py-2 pr-2 text-gray-400">{thaiDate(o.issueDate)}</td>
                    <td className="py-2 pr-2 text-gray-400">{thaiDate(o.warrantyEnd)}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">{DOT[w.state]} {STATE_LABEL[w.state]}</td>
                    <td className="py-2 mono text-gray-300">{w.state === 'OUT' ? '—' : `${w.daysLeft} ว.`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-lg card p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="flex items-start gap-3">
              <div>
                <h3 className="font-semibold text-gray-100">ออเดอร์ {open.no}</h3>
                <p className="text-xs text-gray-500">{thaiDate(open.createdAt.slice(0, 10))}</p>
              </div>
              <button type="button" className="ml-auto text-gray-500 hover:text-gray-200" onClick={() => setOpen(null)} aria-label="ปิด">✕</button>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['ลูกค้า', open.customerName],
                ['เบอร์โทร', open.phone],
                ['LINE', open.line ?? '—'],
                ['วันที่ออกใบ', thaiDate(open.issueDate)],
                ['เริ่มประกัน', thaiDate(open.warrantyStart)],
                ['สิ้นสุดประกัน', thaiDate(open.warrantyEnd)],
                ['ราคาต่อหน่วย', `${open.unitPrice.toLocaleString('th-TH')} ฿`],
                ['ยอดรวม', `${orderTotal(open).toLocaleString('th-TH')} ฿`],
              ].map(([k, v]) => (
                <div key={k} className="rounded border border-slate-700 px-2 py-1.5">
                  <dt className="text-[10px] text-gray-500">{k}</dt>
                  <dd className="text-gray-200 break-words">{v}</dd>
                </div>
              ))}
            </dl>

            {open.address && <p className="text-xs text-gray-400">ที่อยู่: {open.address}</p>}
            {open.note && <p className="text-xs text-gray-400">หมายเหตุ: {open.note}</p>}
            <div className="text-xs">
              <div className="text-gray-500 mb-1">S/N ({open.serials.length})</div>
              <div className="flex flex-wrap gap-1">{open.serials.map((sn) => <span key={sn} className="mono text-[11px] px-1.5 py-0.5 rounded bg-slate-800">{sn}</span>)}</div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className={btnGhost} onClick={() => { onGenSticker(open.serials); setOpen(null); }}>สร้างสติกเกอร์ใหม่</button>
              {open.phone && <a className={btnGhost} href={`tel:${open.phone}`}>โทร</a>}
              {open.status === 'ACTIVE'
                ? <button type="button" className={btnDanger} onClick={() => voidOrder(open)}>Void ออเดอร์</button>
                : <span className="self-center text-xs text-gray-500">ออเดอร์นี้ถูกยกเลิกแล้ว</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}