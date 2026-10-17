"use client";
// components/business/soverien/OrderCreate.tsx
// ส่วนที่ 4 — ออกออเดอร์ + ผูก S/N + คำนวณประกันแบบ real-time (14/10/69)
// ประกัน: เริ่ม = วันออกใบ + ขนส่ง(14) · สิ้น = เริ่ม + ระยะเวลาประกัน(365)
import { useState } from 'react';
import { Db, Order } from './types';
import { issueSerials, modelById, nextOrderNo, todayIso, warrantyDates, thaiDate } from './store';
import { Card, Field, inputCls, btnPrimary, btnGhost, Notice, Stat } from './ui';

const PHONE_RE = /^[0-9]{9,10}$/;

export default function OrderCreate({ db, setDb, onDone }: {
  db: Db; setDb: (d: Db) => void; onDone: (serials: string[]) => void;
}) {
  const s = db.settings;
  const [modelId, setModelId] = useState(db.models.find((m) => m.active)?.id ?? '');
  const [qty, setQty] = useState('1');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [form, setForm] = useState({ customerName: '', phone: '', address: '', line: '', note: '' });
  const [unitPrice, setUnitPrice] = useState(String(db.models.find((m) => m.active)?.price ?? 0));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const model = modelById(db, modelId);
  const count = Math.max(1, Math.min(99, Number(qty) || 1));
  const price = Number(unitPrice) || 0;
  const w = warrantyDates(issueDate, s);

  const phoneOk = PHONE_RE.test(form.phone.replace(/[^0-9]/g, ''));
  const stockLeft = db.serials.filter((x) => x.modelId === modelId && x.status === 'STOCK').length;
  const canSubmit = !!model && form.customerName.trim().length > 0 && phoneOk && stockLeft >= count;

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  function submit() {
    if (!canSubmit || !model) return;
    const made = issueSerials(db, model.id, count);
    const serials = [...db.serials, ...made];

    const o: Order = {
      id: `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      no: nextOrderNo(db),
      issueDate,
      customerName: form.customerName.trim(),
      phone: form.phone.trim(),
      address: form.address.trim() || undefined,
      line: form.line.trim() || undefined,
      note: form.note.trim() || undefined,
      serials: made.map((x) => x.sn),
      unitPrice: price,
      total: price * made.length,
      warrantyStart: w.start,
      warrantyEnd: w.end,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    // ผูก serial → ออเดอร์ (เปลี่ยนสถานะเป็นขายแล้ว)
    // ⚠ 14/10/69: ต้องสร้าง serial object ใหม่ทุกตัวที่แตะ
    //   ถ้าแก้ในตัว (mutate) แล้วส่ง array เดิม → React เทียบ Object.is เห็นเหมือนกัน
    //   → หน้าจอไม่รีเฟรช ต้องไปกดอะไรสักอย่างก่อนถึงจะเห็นผล
    const soldSet = new Set(o.serials);
    const linked = serials.map((x) => (soldSet.has(x.sn) ? { ...x, status: 'SOLD' as const, orderId: o.id } : x));
    setDb({ ...db, serials: linked, orders: [o, ...db.orders], orderSeq: db.orderSeq + 1 });

    setMsg({ ok: true, text: `ออกออเดอร์ ${o.no} แล้ว · ${o.serials.length} ชิ้น · ประกันถึง ${thaiDate(w.end)}` });
    setForm({ customerName: '', phone: '', address: '', line: '', note: '' });
    setQty('1');
    onDone(o.serials);
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="S/N ในคลังของรุ่นนี้" value={stockLeft} tone={stockLeft > 0 ? 'good' : 'bad'} />
        <Stat label="วันที่ออกใบ" value={thaiDate(issueDate)} />
        <Stat label="เริ่มประกัน" value={thaiDate(w.start)} hint={`+ ขนส่ง ${s.shippingDays} วัน`} />
        <Stat label="สิ้นสุดประกัน" value={thaiDate(w.end)} tone="good" hint={`+ ประกัน ${s.warrantyDays} วัน`} />
      </div>

      <Card title="สินค้า" sub="เลือกรุ่น + จำนวน — S/N จะถูกออกให้อัตโนมัติแล้ว">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="รุ่น">
            <select className={inputCls} value={modelId} onChange={(e) => {
              setModelId(e.target.value);
              const m = db.models.find((x) => x.id === e.target.value);
              if (m) setUnitPrice(String(m.price));
            }} aria-label="รุ่น">
              {db.models.filter((m) => m.active).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          <Field label="จำนวน" hint={`เหลือในคลัง ${stockLeft}`}>
            <input type="number" min={1} max={99} className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="ราคาต่อหน่วย (บาท)">
            <input type="number" min={0} max={1000000} step={1} className={inputCls} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </Field>
        </div>
        <div className="text-right text-sm text-gray-300">
          ยอดรวม <span className="mono text-emerald-300">{((price * count) || 0).toLocaleString('th-TH')} ฿</span>
        </div>
      </Card>

      <Card title="ข้อมูลลูกค้า">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ชื่อ-นามสกุล *">
            <input className={inputCls} value={form.customerName} onChange={(e) => set('customerName', e.target.value)}
              placeholder="เช่น สมชาย ใจดี" aria-label="ชื่อ-นามสกุล" />
          </Field>
          <Field label="เบอร์โทร *" hint={form.phone && !phoneOk ? 'ต้องเป็นตัวเลข 9–10 หลัก' : 'ใช้เป็นตัวระบุลูกค้าด้วย (dedupe)'}>
            <input className={inputCls} value={form.phone} inputMode="numeric"
              onChange={(e) => set('phone', e.target.value.replace(/[^0-9+\-\s]/g, ''))} placeholder="08xxxxxxxx" aria-label="เบอร์โทร" />
          </Field>
          <Field label="LINE ID">
            <input className={inputCls} value={form.line} onChange={(e) => set('line', e.target.value)} placeholder="เช่น krisakorn" aria-label="LINE ID" />
          </Field>
          <Field label="ที่อยู่จัดส่ง">
            <textarea className={`${inputCls} min-h-16`} value={form.address} onChange={(e) => set('address', e.target.value)} aria-label="ที่อยู่จัดส่ง" />
          </Field>
        </div>
        <Field label="หมายเหตุ">
          <textarea className={`${inputCls} min-h-16`} value={form.note} onChange={(e) => set('note', e.target.value)}
            placeholder="เช่น ขอส่งวันจันทร์ / ติดตั้งที่ร้าน" aria-label="หมายเหตุ" />
        </Field>

        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className={btnPrimary} onClick={submit} disabled={!canSubmit}>
            ออกออเดอร์ + สร้างภาพ
          </button>
          <button type="button" className={btnGhost} onClick={() => { setForm({ customerName: '', phone: '', address: '', line: '', note: '' }); setQty('1'); }}>
            ล้างฟอร์ม
          </button>
          {!canSubmit && (
            <span className="text-xs text-amber-300/80">
              {!model ? 'เลือกรุ่น' : !form.customerName.trim() ? 'ใส่ชื่อลูกค้า' : !phoneOk ? 'เบอร์โทรยังไม่ครบ' : `S/N ในคลังไม่พอ (เหลือ ${stockLeft})`}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}