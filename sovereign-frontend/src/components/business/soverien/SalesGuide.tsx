"use client";
// components/business/soverien/SalesGuide.tsx
// ส่วนที่ 1 — "คู่มือขาย" (14/10/69)
// เนื้อหานำไปใช้จริงได้ทันที + เครื่องคำนวณ ROI ให้ลูกค้าคำนวณเอง
import { useState } from 'react';
import { Card, Field, inputCls, btnGhost } from './ui';
import { breakEvenDays } from './roi';

const PRINCIPLES = [
  {
    n: 1,
    t: 'ขาย "ความสบายใจ" ไม่ใช่ "อุปกรณ์"',
    d: 'ลูกค้าไม่อยากซื้อเซ็นเซอร์ — เขาอยากรู้ว่า "ของเสียในตู้แช่จะไม่มีวันหายไปเงียบๆ"',
    say: '"ถ้าตู้แช่คุณเปิดตอนตี 3 แล้วไม่มีไฟ คุณรู้ทันทีไหมครับ?"',
  },
  {
    n: 2,
    t: 'อย่าพูด "ESP8266 + DS18B20"',
    d: 'ชื่อชิ้นส่วนทางเทคนิคทำให้คิดราคาแพง แต่ไม่ได้บอกว่าช่วยอะไร',
    say: '"ตัวนี้วัดอุณหภูมิแม่นยำ ±0.5 องศา ส่งแจ้งเตือนเข้า LINE ได้เลยครับ"',
  },
  {
    n: 3,
    t: 'ให้ลูกค้าคำนวณเองว่าคุ้มในกี่วัน',
    d: 'คนที่คิดเองได้จะตัดสินใจเร็วกว่าคนที่ถูกโน้มน้าว — ใช้เครื่องคำนวณข้างล่าง',
    say: '"ลองใส่มูลค่าของที่คุณเสียต่อปีดูครับ ค่อยๆ ดูว่าคุ้มในกี่เดือน"',
  },
  {
    n: 4,
    t: 'ขายเป็น Package ไม่ขายเป็นชิ้น',
    d: 'ราคาเดียวแต่ได้ความคุ้มที่ลูกค้าเข้าใจง่ายกว่า — เปลี่ยนจาก "เท่าไหร่" เป็น "ได้อะไร"',
    say: '"แพ็กเกจ Standard คุ้มกว่าซื้อเดี่ยว และไม่ต้องเดาเรื่องการต่อสายครับ"',
  },
  {
    n: 5,
    t: 'Live Demo หน้าร้าน — พกกล่อง + น้ำแข็ง + น้ำร้อน',
    d: 'คนที่เห็นของจริงเปลี่ยนใจเร็วกว่าคนที่ฟังคำอธิบาย — ลูกค้าเห็นอุณหภูมิเปลี่ยนใน 3 วินาที',
    say: '"อยากดูไหมครับ? ใส่น้ำแข็งลงไปเลยครับ ดูจอครับ"',
  },
  {
    n: 6,
    t: 'รับประกัน 2 ชั้น + ติดตามหลังขาย',
    d: 'Hardware 1 ปี + Service ตลอดชีพ — และโทรหลังขายวันที่ 7 / 30 / 90 เพื่อเปิดโอกาสขายเพิ่ม',
    say: '"ถ้าเครื่องมีปัญหาใน 1 ปี ส่งมาเปลี่ยนให้ครับ ไม่มีค่าใช้จ่าย ส่วนซ่อมตลอดชีพผมดูแลให้"',
  },
];

export const PACKAGES = [
  { id: 'standard', name: 'Standard', items: ['อุปกรณ์ 1 ชุด', 'ป้ายสติกเกอร์ + รหัสประจำเครื่อง', 'แอป LINE แจ้งเตือน', 'รับประกัน 1 ปี'], price: 990 },
  { id: 'pro', name: 'Pro', items: ['อุปกรณ์ 2 ชุด (ตู้แช่ + ห้องเย็น)', 'ป้ายสติกเกอร์ครบ', 'ประวัติอุณหภูมิย้อนหลัง 30 วัน', 'รับประกัน 1 ปี + ซ่อมตลอดชีพ'], price: 1790 },
  { id: 'business', name: 'Business', items: ['อุปกรณ์ 4 ชุด', 'แดชบอร์ดหลายจุด', 'ส่งออก CSV ได้', 'ปรับแต่งเตือนตามจุดใช้งาน', 'รับประกัน 1 ปี + ซ่อมตลอดชีพ + ปรับตั้งค่าฟรี'], price: 3390 },
];

export default function SalesGuide() {
  const [lossPerYear, setLoss] = useState('');
  const [qty, setQty] = useState('1');

  const loss = Number(lossPerYear) || 0;
  const n = Math.max(1, Math.min(50, Number(qty) || 1));
  const pkg = PACKAGES[Math.min(n, 3) - 1];
  const price = pkg.price;
  // หน่วย = "วัน" มาตลอด (roi.breakEvenDays) — เดิมคำนวณออกมาเป็นเดือนแล้วไปแสดงในช่องที่เขียนว่า "วัน"
  const days = breakEvenDays(price, loss);

  return (
    <div className="space-y-4">
      <Card title="หลักการขาย 6 ข้อ" sub="คัดลอกประโยคในช่อง “พูดว่า…” ไปใช้ได้ทันที">
        <ol className="grid gap-3 md:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <li key={p.n} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="mono text-xs text-emerald-400">{String(p.n).padStart(2, '0')}</span>
                <span className="font-medium text-gray-100 text-sm">{p.t}</span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{p.d}</p>
              <p className="text-xs text-emerald-300/90 border-l-2 border-emerald-500/40 pl-2 italic">“{p.say}”</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="แพ็กเกจสินค้า" sub="ราคาตั้งต้นเริ่ม — ปรับตามต้นทุนจริงได้">
        <div className="grid gap-3 md:grid-cols-3">
          {PACKAGES.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-700 p-3 space-y-2 bg-slate-900/40">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-gray-100">{p.name}</span>
                <span className="mono text-emerald-300">{p.price.toLocaleString('th-TH')} ฿</span>
              </div>
              <ul className="text-xs text-gray-400 space-y-1">
                {p.items.map((i) => <li key={i}>· {i}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card title="เครื่องคำนวณ ROI" sub="ให้ลูกค้ากรอกเอง — ยิ่งคำนวณเอง ยิ่งตัดสินใจเร็ว">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="มูลค่าของที่เสียต่อปี (ของเสีย/ไฟฟ้าแพงที่แอบรั่ว)">
            <input type="number" min={0} className={inputCls} value={lossPerYear}
              onChange={(e) => setLoss(e.target.value)} placeholder="เช่น 12000" />
          </Field>
          <Field label="จำนวนเครื่องที่จะซื้อ" hint="1 = Standard · 2 = Pro · 4 = Business">
            <input type="number" min={1} max={50} className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1">
          {loss > 0 && days !== null ? (
            <>
              <div className="text-lg">
                คุ้มทุนภายใน <span className="mono text-emerald-300">
                  {days > 365 ? 'มากกว่า 1 ปี' : `ประมาณ ${days.toLocaleString('th-TH')} วัน`}
                </span>
                {days >= 60 && <> (≈ {Math.max(1, Math.round(days / 30.44)).toLocaleString('th-TH')} เดือน)</>}
              </div>
              <div className="text-xs text-gray-400">
                แพ็กเกจ {pkg.name} · ราคา {price.toLocaleString('th-TH')} บาท · ของเสียต่อปี {loss.toLocaleString('th-TH')} บาท
              </div>
              <div className="text-xs text-gray-500">
                เหลือคืนต่อปี ≈ {(loss - price).toLocaleString('th-TH')} บาท (ถ้าใช้งานเต็มปี)
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400">กรอก “มูลค่าของที่เสียต่อปี” เพื่อดูผล</div>
          )}
        </div>
        <p className="text-[11px] text-gray-500">
          หมายเหตุ: เครื่องคำนวณนี้เป็นตัวช่วยคิดให้ลูกค้า ไม่ใช่การรับประกันผลตอบแทน — ให้ลูกค้าใส่ตัวเลขของตัวเอง
        </p>
      </Card>

      <Card title="ติดตามหลังขาย" sub="ตารางนี้คือรายได้ซ้ำจากลูกค้าเดิม">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['วันที่ 7', 'ถามว่าใช้งานยังไง มีอะไรต้องปรับไหม'],
            ['วันที่ 30', 'เช็คอุณหภูมิที่ตั้งค่าไว้ยังเหมาะกับการใช้งานจริงไหม'],
            ['วันที่ 90', 'เสนอเพิ่มจุดติดตั้ง หรืออุปกรณ์รุ่นถัดไป'],
          ].map(([d, t]) => (
            <div key={d} className="rounded-lg border border-slate-700 p-3">
              <div className="mono text-xs text-cyan-300">{d}</div>
              <div className="text-xs text-gray-400 mt-1">{t}</div>
            </div>
          ))}
        </div>
        <button type="button" className={btnGhost} onClick={() => window.print()}>พิมพ์คู่มือนี้</button>
      </Card>
    </div>
  );
}