"use client";
// components/business/soverien/WarrantyCheck.tsx
// ส่วนที่ 6 — ตรวจประกันด้วย S/N (14/10/69)
// รองรับ ?sn=... ใน URL เพื่อให้ QR บนสติกเกอร์สแกนแล้วเปิดหน้านี้พร้อมกรอกให้
import { useEffect, useMemo, useState } from 'react';
import { Db } from './types';
import { thaiDate, thaiShort, daysBetween, lookupWarranty, todayIso } from './store';
import { Card, inputCls, btnPrimary, Stat, Empty } from './ui';

type Result = { kind: 'IN' | 'NEAR' | 'OUT' | 'VOID' | 'UNKNOWN' | 'UNSOLD'; sn: string; orderId?: string };

export default function WarrantyCheck({ db }: { db: Db }) {
  const [q, setQ] = useState('');

  // อ่าน ?sn= จาก URL เพื่อรองรับ QR (ครั้งเดียวตอน mount)
  useEffect(() => {
    try {
      const sn = new URLSearchParams(window.location.search).get('sn');
      if (sn) setQ(sn.trim());
    } catch { /* ไม่มี window/URLSearchParams */ }
  }, []);

  // ตรรกะการค้นอยู่ใน store.lookupWarranty (มีเทสต์คุม) ไม่ฝังใน JSX
  // EMPTY แปลงเป็น UNKNOWN + sn ว่าง เพราะ UI ตัดสินด้วย res.sn === '' อยู่แล้ว
  const res: Result = useMemo(() => {
    const hit = lookupWarranty(db, q);
    return { kind: hit.kind === 'EMPTY' ? 'UNKNOWN' : hit.kind, sn: hit.sn, orderId: hit.order?.id };
  }, [q, db]);

  const order = res.orderId ? db.orders.find((o) => o.id === res.orderId) : undefined;
  const model = db.serials.find((s) => s.sn === res.sn);

  const style = {
    IN: { box: 'border-emerald-500/40 bg-emerald-500/10', text: 'text-emerald-300', icon: '✅', label: 'อยู่ในประกัน' },
    NEAR: { box: 'border-amber-500/40 bg-amber-500/10', text: 'text-amber-300', icon: '⚠️', label: 'ใกล้หมดประกัน' },
    OUT: { box: 'border-rose-500/40 bg-rose-500/10', text: 'text-rose-300', icon: '❌', label: 'หมดประกันแล้ว' },
    VOID: { box: 'border-slate-600 bg-slate-800/60', text: 'text-gray-400', icon: '⚫', label: 'ออเดอร์ถูกยกเลิก' },
    // ต่างจาก UNKNOWN: serial มีจริง เพียงยังไม่ได้ผูกกับออเดอร์ (14/10/69)
    UNSOLD: { box: 'border-sky-500/40 bg-sky-500/10', text: 'text-sky-300', icon: '🕓', label: 'ออก serial แล้ว แต่ยังไม่ผูกกับออเดอร์' },
    UNKNOWN: { box: 'border-slate-700 bg-slate-900/50', text: 'text-gray-300', icon: '🔍', label: 'ไม่พบ Serial นี้' },
  }[res.kind];

  // ⚠ ต้องนับวัน "ตามเวลาเครื่อง" ไม่ใช่ UTC (17/10/69)
  //   เดิมใช้ toISOString().slice(0,10) → ระหว่าง 00:00–07:00 ของไทย (UTC+7)
  //   วันที่ที่ได้ยังเป็นของเมื่อวาน → ลูกค้าเห็น "เหลืออีก 1 วัน" เกินจริง
  const daysLeft = order && order.status === 'ACTIVE' ? daysBetween(todayIso(), order.warrantyEnd) : 0;

  return (
    <div className="space-y-4">
      <Card title="ตรวจประกัน" sub="พิมพ์รหัสที่ติดบนป้าย — เช่น Soverign-Temp-001">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setQ(q.trim().toUpperCase()); }}>
          <input
            className={`${inputCls} flex-1 min-w-[16rem] mono uppercase`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Soverign-Temp-000"
            aria-label="กรอกหมายเลขประจำเครื่อง"
          />
          {/* เดิมปุ่มนี้เป็น onClick ว่าง ๆ และมี onKeyDown ดัก Enter ทิ้ง → กดปุ่มกับ Enter ไม่ได้อะไรเลย
              ตอนนี้รวมเป็น <form> เดียวกัน Enter จึงทำงานเท่ากับกดปุ่ม (ลูกค้าที่สแกนแล้วพิมพ์ต่อมักกด Enter) */}
          <button type="submit" className={btnPrimary}>ตรวจสอบ</button>
        </form>
      </Card>

      {res.sn === '' ? (
        <Empty>กรอกหมายเลขประจำเครื่องเพื่อตรวจสอบ</Empty>
      ) : (
        <div className={`rounded-xl border p-5 space-y-3 ${style.box}`}>
          <div className={`text-xl font-semibold ${style.text}`}>{style.icon} {style.label}</div>
          <div className="mono text-lg text-gray-100">{res.sn}</div>

          {model && <div className="text-xs text-gray-400">รุ่น: {db.models.find((m) => m.id === model.modelId)?.name ?? '—'}</div>}

          {order ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="ลูกค้า" value={<span className="text-sm">{order.customerName}</span>} />
                <Stat label="วันที่ออกใบ" value={thaiShort(order.issueDate)} />
                <Stat label="เริ่มประกัน" value={thaiShort(order.warrantyStart)} hint={`ออเดอร์ ${order.no}`} />
                <Stat
                  label="สิ้นสุดประกัน"
                  value={thaiShort(order.warrantyEnd)}
                  tone={daysLeft > db.settings.nearExpiryDays ? 'good' : daysLeft >= 0 ? 'warn' : 'bad'}
                />
              </div>
              {order.status === 'ACTIVE' ? (
                <div className={`text-sm ${style.text}`}>
                  {daysLeft > 0
                    ? `เหลืออีก ${daysLeft} วัน`
                    : `หมดประกันเมื่อ ${thaiDate(order.warrantyEnd)} (${Math.abs(daysLeft)} วันที่แล้ว)`}
                </div>
              ) : (
                /* ออเดอร์ยกเลิกแล้วห้ามขึ้น "หมดประกันเมื่อ … วันที่แล้ว" เพราะขัดกับป้าย⚫ ด้านบน (17/10/69) */
                <div className="text-sm text-gray-400">ออเดอร์นี้ถูกยกเลิกแล้ว — ประกันหยุดนับ</div>
              )}
              {order.phone && (
                <div className="text-xs text-gray-400">
                  โทรติดตาม: <a className="text-cyan-400 hover:underline" href={`tel:${order.phone}`}>{order.phone}</a>
                </div>
              )}
              {order.line && (
                <div className="text-xs text-gray-400">LINE: {order.line}</div>
              )}
            </>
          ) : res.kind === 'UNSOLD' ? (
            <p className="text-sm text-sky-200">
              Serial นี้อยู่ในคลังแล้ว แต่ยังไม่ได้ผูกกับออเดอร์ — ประกันจะเริ่มนับเมื่อมีการออกออเดอร์
              (ไปที่ 🧾 ออกออเดอร์ แล้วใส่ชื่อลูกค้า — ระบบจะผูก serial ในคลังให้เอง)
            </p>
          ) : null}
        </div>
      )}

      <Card title="เกณฑ์ที่ใช้" sub="ปรับได้ที่แท็บ “สำรอง/ความปลอดภัย”">
        <ul className="text-xs text-gray-400 space-y-1 list-disc pl-4">
          <li>เริ่มประกัน = วันที่ออกใบ + {db.settings.shippingDays} วัน (รวมระยะเวลาขนส่ง)</li>
          <li>สิ้นสุดประกัน = เริ่มประกัน + {db.settings.warrantyDays} วัน (ประมาณ 1 ปี)</li>
          <li>เหลือ ≤ {db.settings.nearExpiryDays} วัน = สถานะ “ใกล้หมดประกัน” (สีเหลือง)</li>
          <li>ยกเลิกออเดอร์ (void) = ประกันหยุดนับ แต่ประวัติยังอยู่ในคลัง</li>
        </ul>
      </Card>
    </div>
  );
}