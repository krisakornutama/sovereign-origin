"use client";
// components/business/soverien/CustomerCRM.tsx
// ส่วนที่ 8 — ระบบจัดการลูกค้าเบื้องต้น (14/10/69)
// รวมจากออเดอร์ทั้งหมด · dedupe ด้วยเบอร์โทร · เตือนลูกค้าที่ไม่ซื้อเกิน 90 วัน
import { useMemo, useState } from 'react';
import { Db, Order } from './types';
import { buildCustomers, normPhone, thaiDate, orderTotal } from './store';
import { Card, inputCls, btnGhost, Empty, Notice } from './ui';

const STALE_DAYS = 90;

export default function CustomerCRM({ db }: { db: Db }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [onlyStale, setOnlyStale] = useState(false);

  const all = useMemo(() => buildCustomers(db), [db]);
  const stale = all.filter((c) => c.daysSince > STALE_DAYS);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all
      .filter((c) => !onlyStale || c.daysSince > STALE_DAYS)
      .filter((c) => !n || c.name.toLowerCase().includes(n) || (c.phone || '').includes(n) || (c.line || '').toLowerCase().includes(n))
      .sort((a, b) => b.value - a.value);
  }, [all, q, onlyStale]);

  const history: Order[] = useMemo(
    () => (open ? db.orders.filter((o) => normPhone(o.phone) === normPhone(open) || o.customerName === open).sort((a, b) => b.issueDate.localeCompare(a.issueDate)) : []),
    [open, db.orders],
  );

  return (
    <div className="space-y-4">
      {stale.length > 0 && (
        <Notice kind="err">
          ลูกค้า {stale.length} คนไม่ได้ซื้อเกิน {STALE_DAYS} วัน — โอกาสขายเพิ่ม:{' '}
          <span className="mono">{stale.slice(0, 6).map((c) => c.name).join(', ')}{stale.length > 6 ? ` และอีก ${stale.length - 6} คน` : ''}</span>
        </Notice>
      )}

      <Card title="ลูกค้า" sub={`รวมจากออเดอร์ · dedupe ด้วยเบอร์โทร · ทั้งหมด ${all.length} คน`}
        right={<label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={onlyStale} onChange={(e) => setOnlyStale(e.target.checked)} />
          เฉพาะที่นานเกิน {STALE_DAYS} วัน ({stale.length})
        </label>}
      >
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา: ชื่อ · เบอร์ · LINE" aria-label="ค้นหาลูกค้า" />

        {list.length === 0 ? <Empty>ยังไม่มีลูกค้า — ออกออเดอร์แรกแล้วข้อมูลจะมาอัตโนมัติ</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500 border-b border-slate-700">
                <th className="py-2 pr-2 font-normal">ชื่อ</th>
                <th className="py-2 pr-2 font-normal">เบอร์ / LINE</th>
                <th className="py-2 pr-2 font-normal">ออเดอร์</th>
                <th className="py-2 pr-2 font-normal">มูลค่ารวม</th>
                <th className="py-2 pr-2 font-normal">ซื้อล่าสุด</th>
                <th className="py-2 font-normal">ติดต่อ</th>
              </tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.phone || c.name} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                    <td className="py-2 pr-2">
                      <button type="button" className="text-gray-100 hover:text-emerald-300 hover:underline" onClick={() => setOpen(c.phone || c.name)}>
                        {c.name}
                      </button>
                      {c.daysSince > STALE_DAYS && <span className="ml-1 text-[10px] text-amber-400">นาน {c.daysSince} ว.</span>}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="mono text-gray-300">{c.phone || '—'}</div>
                      {c.line && <div className="text-[10px] text-gray-500">LINE: {c.line}</div>}
                    </td>
                    <td className="py-2 pr-2 mono text-gray-300">{c.orderCount}</td>
                    <td className="py-2 pr-2 mono text-emerald-300">{c.value.toLocaleString('th-TH')} ฿</td>
                    <td className="py-2 pr-2 text-gray-400">{thaiDate(c.lastOrderDate)}</td>
                    <td className="py-2">
                      <div className="flex gap-1.5">
                        {c.phone && <a className="text-[11px] text-cyan-400 hover:underline" href={`tel:${c.phone}`}>โทร</a>}
                        {c.line && <span className="text-[11px] text-slate-500">@{c.line}</span>}
                      </div>
                    </td>
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
                <h3 className="font-semibold text-gray-100">{open}</h3>
                <p className="text-xs text-gray-500">ประวัติซื้อ {history.length} รายการ</p>
              </div>
              <button type="button" className="ml-auto text-gray-500 hover:text-gray-200" onClick={() => setOpen(null)} aria-label="ปิด">✕</button>
            </div>

            {history.length === 0 ? <Empty>ไม่พบประวัติ</Empty> : (
              <div className="space-y-2">
                {history.map((o) => (
                  <div key={o.id} className="rounded-lg border border-slate-700 p-2.5 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="mono text-gray-400">{o.no}</span>
                      <span className="text-gray-200">{thaiDate(o.issueDate)}</span>
                      <span className="ml-auto mono text-emerald-300">{orderTotal(o).toLocaleString('th-TH')} ฿</span>
                      {o.status === 'VOID' && <span className="text-[10px] text-gray-500">(ยกเลิก)</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {o.serials.map((sn) => <span key={sn} className="mono text-[10px] px-1 py-0.5 rounded bg-slate-800">{sn}</span>)}
                    </div>
                    {o.note && <div className="text-[10px] text-gray-500">{o.note}</div>}
                  </div>
                ))}
              </div>
            )}
            <button type="button" className={btnGhost} onClick={() => setOpen(null)}>ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}