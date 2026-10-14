"use client";
// components/business/soverien/SummaryCards.tsx
// ส่วนที่ 7 — ภาพรวม (14/10/69) + กราฟรายเดือนวาดเองด้วย Canvas
// ไม่ใช้ lib กราฟ (package.json ห้ามแตะ) — วาดเส้น/แท่งด้วย 2D context ตรง ๆ
import { useEffect, useRef } from 'react';
import { Db } from './types';
import { buildSummary, todayIso } from './store';
import { Card, Stat } from './ui';

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${TH_MONTH[(m ?? 1) - 1]} ${String(y).slice(2)}`;
}

function BarChart({ data }: { data: Array<{ month: string; count: number; value: number }> }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth || 640, H = 220;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const max = Math.max(1, ...data.map((d) => d.count));
    const padL = 30, padB = 26, padT = 12;
    const plotW = W - padL - 8, plotH = H - padB - padT;
    const bw = plotW / Math.max(1, data.length);

    // เส้นกริด + ตัวเลขแกน Y
    ctx.font = '10px Sarabun, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH / 4) * i;
      ctx.strokeStyle = 'rgba(148,163,184,.14)';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - 8, y); ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,.6)';
      ctx.fillText(String(Math.round(max - (max / 4) * i)), padL - 6, y);
    }

    data.forEach((d, i) => {
      const h = (d.count / max) * plotH;
      const x = padL + i * bw + bw * 0.18;
      const y = padT + plotH - h;
      const w = bw * 0.64;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(52,211,153,.95)');
      g.addColorStop(1, 'rgba(16,185,129,.35)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, Math.max(d.count > 0 ? 2 : 0, h));
      if (d.count > 0) {
        ctx.fillStyle = 'rgba(209,250,229,.95)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(d.count), x + w / 2, y - 2);
      }
      ctx.fillStyle = 'rgba(148,163,184,.65)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(monthLabel(d.month), x + w / 2, padT + plotH + 6);
    });
  }, [data]);

  return <canvas ref={ref} className="w-full" style={{ height: 220 }} aria-label="กราฟจำนวนออเดอร์รายเดือน" role="img" />;
}

export default function SummaryCards({ db }: { db: Db }) {
  const sum = buildSummary(db, todayIso());
  const recent = sum.byMonth.slice(-3).reduce((s, m) => s + m.value, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Serial ที่ออกแล้ว" value={sum.totalSerials} hint={`ค้างในคลัง ${sum.stockSerials}`} />
        <Stat label="ออเดอร์" value={sum.totalOrders} />
        <Stat label="อยู่ในประกัน" value={sum.inWarranty} tone="good" />
        <Stat label="ใกล้หมดประกัน" value={sum.nearExpiry} tone="warn" hint={`≤ ${db.settings.nearExpiryDays} วัน`} />
        <Stat label="หมดประกัน" value={sum.expired} tone="bad" />
        <Stat label="รายได้รวม" value={`${sum.revenue.toLocaleString('th-TH')} ฿`} tone="good" hint={`3 เดือนล่าสุด ${recent.toLocaleString('th-TH')} ฿`} />
      </div>

      {sum.nearExpiry > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          มี {sum.nearExpiry} ออเดอร์ที่จะหมดประกันภายใน {db.settings.nearExpiryDays} วัน — ควรติดต่อลูกค้าไปเตรียมซ่อม/เปลี่ยนเครื่อง
        </div>
      )}

      <Card title="จำนวนออเดอร์รายเดือน" sub="12 เดือนล่าสุด">
        <BarChart data={sum.byMonth} />
      </Card>
    </div>
  );
}