"use client";
// components/business/soverien/StickerSheetPrint.tsx
// เรียงสติกเกอร์หลายใบลงกระดาษ 1 แผ่น พร้อมเส้นตัด (14/10/69)
//
// เจ้าของต้องการ: "เรียงเป็นไฟล์ภาพในกระดาษ 1 แผ่น พิมพ์ได้ 8-16 ภาพ หรือมากกว่านั้น"
//   → ที่ป้าย 30×22.5 มม. บน A4 ได้ 6×11 = 66 ใบ (มากกว่าที่ขอมาก)
//
// วิธีพิมพ์: เปิดไฟล์ PNG → เครื่องพิมพ์ → ขนาด "ขนาดจริง / Actual size" (ไม่ย่อ/ไม่ขยาย)
//   เพราะไฟล์คือพิกเซลจริงของ A4 ที่ 300 dpi = 2480×3508
import { useMemo, useState } from 'react';
import type { StickerConfig } from './types';
import { planSheet, sheetCellXY } from './sticker-layout';
import { paintSticker } from './sticker-draw';
import { downloadBlob, canvasToPngBytes } from './zip';
import { Card, Notice, Empty } from './ui';

type Paper = { key: string; label: string; w: number; h: number };
const PAPERS: Paper[] = [
  { key: 'A4', label: 'A4 (210×297 มม.)', w: 210, h: 297 },
  { key: 'A5', label: 'A5 (148×210 มม.)', w: 148, h: 210 },
  { key: 'Letter', label: 'Letter (216×279 มม.)', w: 216, h: 279 },
];

export default function StickerSheetPrint({
  cfg, serials, warrantyOf,
}: {
  cfg: StickerConfig;
  serials: string[];
  warrantyOf: (sn: string) => string;
}) {
  const [paperKey, setPaperKey] = useState('A4');
  const [marginMm, setMarginMm] = useState(10);
  const [gapMm, setGapMm] = useState(2);
  const [cutLines, setCutLines] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const paper = PAPERS.find((p) => p.key === paperKey) ?? PAPERS[0];
  const plan = useMemo(() => planSheet({
    paperWMm: paper.w, paperHMm: paper.h, dpi: 300,
    marginMm, gapMm, stickerWMm: cfg.widthMm, stickerHMm: cfg.heightMm,
  }), [paper, marginMm, gapMm, cfg.widthMm, cfg.heightMm]);

  const gapPx = Math.round((gapMm / 25.4) * 300);
  const count = Math.min(serials.length, plan.capacity);
  const sheets = serials.length > 0 ? Math.ceil(serials.length / plan.capacity) : 0;
  // ⚠ เคยเขียน setOver(...) ตรงนี้ — React ไม่ควร setState ระหว่าง render (14/10/69)
  //   ค่านี้เป็นผลจากตัวแปรเดียวกัน จึงคำนวณตรง ๆ ได้เลย ไม่ต้องเก็บใน state
  const over = serials.length > plan.capacity;

  async function build() {
    if (!count) { setMsg({ ok: false, text: 'ยังไม่ได้เลือก serial' }); return; }
    setBusy(true); setMsg(null);
    try {
      const total = sheets;
      for (let s = 0; s < total; s++) {
        const c = document.createElement('canvas');
        c.width = plan.pageWpx; c.height = plan.pageHpx;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);

        const base = s * plan.capacity;
        const n = Math.min(plan.capacity, serials.length - base);
        for (let i = 0; i < n; i++) {
          const sn = serials[base + i];
          const cell = sheetCellXY(plan, i, gapPx);
          // วาดแต่ละใบลง canvas ย่อย แล้วย้ายลงแผ่น — ใช้ paint เดียวกับใบเดี่ยว
          const one = document.createElement('canvas');
          one.width = plan.cellWpx; one.height = plan.cellHpx;
          const octx = one.getContext('2d')!;
          await paintSticker(octx, one.width, one.height, cfg, sn, warrantyOf(sn), location.origin, false);
          ctx.drawImage(one, cell.x, cell.y);

          if (cutLines) {
            ctx.save();
            ctx.strokeStyle = 'rgba(0,0,0,.28)';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 6]);
            ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, plan.cellWpx - 1, plan.cellHpx - 1);
            ctx.restore();
          }
        }

        const bytes = await canvasToPngBytes(c);
        const name = sheets > 1 ? `soverien-sheet-${s + 1}-of-${sheets}.png` : 'soverien-sheet.png';
        downloadBlob(new Blob([bytes as BlobPart], { type: 'image/png' }), name);
      }
      setMsg({
        ok: true,
        text: sheets > 1
          ? `สร้าง ${sheets} แผ่น รวม ${serials.length} ใบ (${plan.cols}×${plan.rows} ต่อแผ่น)`
          : `สร้าง 1 แผ่น ${count} ใบ (${plan.cols}×${plan.rows}) · ${plan.pageWpx}×${plan.pageHpx} px`,
      });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'สร้างแผ่นพิมพ์ไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="พิมพ์หลายใบบนกระดาษ 1 แผ่น" sub={`เรียง ${plan.cols}×${plan.rows} = ${plan.capacity} ใบต่อแผ่น · ขนาดป้าย ${cfg.widthMm}×${cfg.heightMm} มม.`}>
      {msg && <Notice kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Notice>}

      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <label className="space-y-1">
            <span className="text-gray-400">กระดาษ</span>
            <select className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-gray-100"
              value={paperKey} onChange={(e) => setPaperKey(e.target.value)} aria-label="ขนาดกระดาษ">
              {PAPERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">ขอบ (มม.)</span>
            <input type="number" min={0} max={30} value={marginMm} onChange={(e) => setMarginMm(Number(e.target.value) || 0)} className="w-20 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-gray-100" />
          </label>
          <label className="space-y-1">
            <span className="text-gray-400">ระยะตัด (มม.)</span>
            <input type="number" min={0} max={10} step={0.5} value={gapMm} onChange={(e) => setGapMm(Number(e.target.value) || 0)} className="w-20 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-gray-100" />
          </label>
          <label className="flex items-end gap-2 pb-1 text-gray-400">
            <input type="checkbox" checked={cutLines} onChange={(e) => setCutLines(e.target.checked)} />
            วาดเส้นตัด
          </label>
        </div>

        <div className="rounded-lg border border-slate-700 p-2 text-xs text-gray-300 space-y-1">
          <div>ไฟล์ {plan.pageWpx}×{plan.pageHpx} px = A4 ที่ 300 dpi (พิมพ์ด้วยขนาดจริง)</div>
          <div>เลือกไว้ {serials.length} ใบ → ต้องใช้ {sheets || 0} แผ่น</div>
          {over && <div className="text-amber-400">เกินช่องต่อแผ่น ({plan.capacity}) — ระบบจะแบ่งให้หลายแผ่นอัตโนมัติ</div>}
        </div>

        {serials.length === 0 ? <Empty>ยังไม่ได้เลือก serial — เลือกด้านล่างก่อน</Empty> : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={build} disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-gray-950 hover:bg-emerald-500 disabled:opacity-50">
              {busy ? 'กำลังสร้าง…' : `ดาวน์โหลดแผ่นพิมพ์ (${count} ใบ${sheets > 1 ? ` ×${sheets} แผ่น` : ''})`}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}