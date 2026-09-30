"use client";
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { fetchJsonObject } from '../lib/fetchJson';
import { getApiUrl } from '../lib/config';

// ────────────────────────────────────────────────────────────────────────────
// /demo — สนามทดลองสาธารณะ (ไม่ต้อง login) — P: Publishing
//  ให้ผู้สนใจลองเล่นโมดูล ฟาร์ม · ปศุสัตว์ · การเงิน ด้วยข้อมูลตัวอย่างล้วน
//  ข้อมูลจริงของระบบแยกขาด (backend เสิร์ฟจาก sandbox คงตัวในโค้ด — ไม่แตะ DB จริงแม้แต่อ่าน)
//  ปุ่มฟีดแบ็กลอยทุกหน้า → POST /api/feedback (honeypot กันสแปม)
// ────────────────────────────────────────────────────────────────────────────

interface SensorPoint { at: string; soilMoisture: number; temperature: number; humidity: number; }
interface FarmData {
  plot: { name: string; crop: string; areaSqm: number; zone: string };
  series: SensorPoint[];
  summary: { soilTrend: string; lastIrrigationHoursAgo: number; harvestEstimate: string };
  note: string;
}
interface Animal { tag: string; name: string; species: string; breed: string; ageMonths: number; weightKg: number; status: string; note: string; }
interface LivestockData { herd: Animal[]; summary: { total: number; healthy: number; watch: number; nextVaccine: string }; note: string; }
interface FinanceLine { symbol: string; name: string; assetClass: string; quantity: number; avgPrice: number; price: number; value: number; pnl: number; pnlPct: string; }
interface FinanceData { lines: FinanceLine[]; summary: { totalValue: number; totalPnl: number; totalPnlPct: string; byClass: Record<string, number> }; note: string; }

const API = `${getApiUrl()}/api/demo`;
const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿`;
const STATUS_TH: Record<string, { label: string; cls: string }> = {
  HEALTHY: { label: 'ปกติ', cls: 'text-emerald-400 border-emerald-500/40' },
  WATCH: { label: 'เฝ้าดู', cls: 'text-amber-400 border-amber-500/40' },
  VACCINATING: { label: 'รอวัคซีน', cls: 'text-cyan-400 border-cyan-500/40' },
};
const CLASS_TH: Record<string, string> = { CASH: 'เงินสด', STOCK: 'หุ้น', GOLD: 'ทองคำ', CRYPTO: 'คริปโต' };

export default function DemoPage() {
  const [tab, setTab] = useState<'farm' | 'livestock' | 'finance'>('farm');
  const [farm, setFarm] = useState<FarmData | null>(null);
  const [stock, setStock] = useState<LivestockData | null>(null);
  const [fin, setFin] = useState<FinanceData | null>(null);

  useEffect(() => {
    fetchJsonObject<FarmData>(`${API}/farm`).then((d) => d && setFarm(d));
    fetchJsonObject<LivestockData>(`${API}/livestock`).then((d) => d && setStock(d));
    fetchJsonObject<FinanceData>(`${API}/finance`).then((d) => d && setFin(d));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Head><title>สนามทดลอง — Sovereign OS</title></Head>
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <header className="space-y-1 pt-2">
          <div className="mono text-[10px] tracking-[0.25em] uppercase text-cyan-400/80">สนามทดลองสาธารณะ</div>
          <h1 className="font-ledger text-2xl md:text-3xl font-bold glow-text">ลองใช้ Sovereign OS ฟรี</h1>
          <p className="text-xs text-gray-400">
            ข้อมูลตัวอย่างล้วน — ระบบจริงจะแสดงข้อมูลของคุณเอง (เซนเซอร์จริง ฝูงจริง พอร์ตจริง)
          </p>
        </header>

        <nav className="flex gap-2" role="tablist" aria-label="เลือกโมดูลเดโม่">
          {([['farm', '🌾 ฟาร์ม'], ['livestock', '🐄 ปศุสัตว์'], ['finance', '💰 การเงิน']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${tab === k ? 'border-cyan-500/60 text-cyan-300 bg-cyan-950/30' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
              {label}
            </button>
          ))}
        </nav>

        {tab === 'farm' && <FarmTab data={farm} />}
        {tab === 'livestock' && <LivestockTab data={stock} />}
        {tab === 'finance' && <FinanceTab data={fin} />}

        <footer className="pt-4 text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
          <span>Powered by <a href="https://github.com/krisakornutama/sovereign-dms" className="text-gray-400 hover:text-cyan-300 underline underline-offset-2">Sovereign OS</a> · open source</span>
          <span>·</span>
          <a href="/shop" className="text-gray-400 hover:text-emerald-300 underline underline-offset-2">ร้านอุปกรณ์</a>
        </footer>
      </main>
      <FeedbackButton />
    </div>
  );
}

function FarmTab({ data }: { data: FarmData | null }) {
  if (!data) return <Loading />;
  const pts = data.series;
  const w = 560, h = 140, pad = 8;
  const xs = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, pts.length - 1);
  const line = (vals: number[], min: number, max: number) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${(h - pad - ((v - min) / (max - min)) * (h - 2 * pad)).toFixed(1)}`).join(' ');
  return (
    <section className="card p-4 space-y-3" aria-label="เดโม่ฟาร์ม">
      <div className="flex items-baseline justify-between">
        <h2 className="font-ledger text-sm text-gray-300">{data.plot.name} · {data.plot.crop}</h2>
        <span className="mono text-[11px] text-gray-500">{data.plot.areaSqm} ตร.ม. · {data.plot.zone}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg bg-gray-900/60" role="img" aria-label="กราฟความชื้นดิน">
        <path d={line(pts.map((p) => p.soilMoisture), 30, 75)} fill="none" stroke="#34d399" strokeWidth="2.5" />
        <path d={line(pts.map((p) => p.humidity), 30, 75)} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="4 3" />
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span><span className="inline-block w-3 border-t-2 border-emerald-400 align-middle" /> ความชื้นดิน (%)</span>
        <span><span className="inline-block w-3 border-t-2 border-dashed border-cyan-400 align-middle" /> ความชื้นอากาศ (%)</span>
      </div>
      <ul className="text-xs text-gray-400 space-y-1">
        <li>• {data.summary.soilTrend}</li>
        <li>• รดน้ำอัตโนมัติครั้งล่าสุด {data.summary.lastIrrigationHoursAgo} ชม.ก่อน</li>
        <li>• {data.summary.harvestEstimate}</li>
      </ul>
      <p className="text-[10px] text-gray-600">{data.note}</p>
    </section>
  );
}

function LivestockTab({ data }: { data: LivestockData | null }) {
  if (!data) return <Loading />;
  return (
    <section className="card p-4 space-y-3" aria-label="เดโม่ปศุสัตว์">
      <div className="flex items-baseline justify-between">
        <h2 className="font-ledger text-sm text-gray-300">ฝูงตัวอย่าง</h2>
        <span className="mono text-[11px] text-gray-500">{data.summary.healthy}/{data.summary.total} ปกติ · วัคซีนถัดไป: {data.summary.nextVaccine}</span>
      </div>
      <div className="space-y-2">
        {data.herd.map((a) => {
          const st = STATUS_TH[a.status] ?? STATUS_TH.HEALTHY;
          return (
            <div key={a.tag} className="flex items-baseline gap-2 border-b border-dashed border-gray-800/80 pb-2 last:border-0">
              <span className="mono text-[11px] text-gray-500">{a.tag}</span>
              <span className="text-sm text-gray-200">{a.name}</span>
              <span className="text-[11px] text-gray-500">{a.species} · {a.breed} · {a.ageMonths} ด. · {a.weightKg} กก.</span>
              <span className={`ml-auto text-[10px] border rounded px-1.5 py-0.5 ${st.cls}`}>{st.label}</span>
              <span className="basis-full text-[11px] text-gray-500">{a.note}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-600">{data.note}</p>
    </section>
  );
}

function FinanceTab({ data }: { data: FinanceData | null }) {
  if (!data) return <Loading />;
  return (
    <section className="card p-4 space-y-3" aria-label="เดโม่การเงิน">
      <div className="flex items-baseline justify-between">
        <h2 className="font-ledger text-sm text-gray-300">พอร์ตจำลอง</h2>
        <span className="mono text-sm text-gray-200">{baht(data.summary.totalValue)} · <span className={data.summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{data.summary.totalPnl >= 0 ? '+' : ''}{baht(data.summary.totalPnl)} ({data.summary.totalPnlPct})</span></span>
      </div>
      <div className="space-y-1.5">
        {data.lines.map((l) => (
          <div key={l.symbol} className="flex items-baseline gap-2 border-b border-dashed border-gray-800/80 pb-1.5 last:border-0">
            <span className="text-xs text-gray-300 w-40 truncate">{l.name}</span>
            <span className="mono text-[10px] text-gray-600">{CLASS_TH[l.assetClass] ?? l.assetClass}</span>
            <span className="ml-auto mono text-xs text-gray-400">{baht(l.value)}</span>
            <span className={`mono text-xs w-24 text-right ${l.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{l.pnl >= 0 ? '+' : ''}{baht(l.pnl)} ({l.pnlPct})</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600">{data.note}</p>
    </section>
  );
}

function Loading() {
  return <div className="card p-6 text-sm text-gray-500">กำลังโหลดข้อมูลตัวอย่าง…</div>;
}

// ── ปุ่มฟีดแบ็กลอย — ใช้ซ้ำได้ (export ให้หน้าอื่นเอาไปครอบได้ภายหลัง) ──
export function FeedbackButton({ page = '/demo' }: { page?: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('general');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — ซ่อนจากมนุษย์
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const submit = useCallback(async () => {
    if (message.trim().length < 3) return;
    setState('sending');
    try {
      const res = await fetch(`${getApiUrl()}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, topic, message, senderEmail: email || undefined, website }),
      });
      if (!res.ok && res.status !== 202) throw new Error('send failed');
      setState('done');
      setMessage('');
      setEmail('');
      setTimeout(() => { setOpen(false); setState('idle'); }, 2200);
    } catch {
      setState('error');
    }
  }, [message, topic, email, website, page]);

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 px-4 py-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-sm shadow-lg shadow-cyan-950/50">
          💬 ส่งความคิดเห็น
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[min(92vw,22rem)] card p-4 space-y-2 border-cyan-500/40" role="dialog" aria-label="ส่งความคิดเห็น">
          <div className="flex items-center justify-between">
            <span className="font-ledger text-sm text-cyan-300">ความคิดเห็นของคุณ</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="ปิด" className="text-gray-500 hover:text-gray-300">✕</button>
          </div>
          {state === 'done' ? (
            <p className="text-sm text-emerald-400 py-2">ส่งแล้ว — ขอบคุณครับ 🙏</p>
          ) : (
            <>
              <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="หัวข้อ"
                className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-sm">
                <option value="general">ความเห็นทั่วไป</option>
                <option value="bug">พบปัญหา</option>
                <option value="feature">อยากได้ฟีเจอร์</option>
                <option value="question">สอบถาม</option>
              </select>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000}
                placeholder="เล่าให้ฟังหน่อยว่าอะไรดี อะไรควรแก้…" aria-label="ข้อความ"
                className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120}
                placeholder="อีเมล (ถ้าอยากให้ติดต่อกลับ — ไม่บังคับ)" aria-label="อีเมลผู้ส่ง"
                className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-xs" />
              {/* honeypot — ซ่อนจากมนุษย์ (bot ที่กรอกอัตโนมัติจะโดนทิ้งเงียบ ๆ) */}
              <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1}
                autoComplete="off" aria-hidden="true"
                className="absolute -left-[9999px] h-0 w-0 opacity-0" />
              <div className="flex items-center justify-between">
                {state === 'error' ? <span className="text-[11px] text-rose-400">ส่งไม่สำเร็จ — ลองใหม่</span> : <span />}
                <button type="button" onClick={submit} disabled={state === 'sending' || message.trim().length < 3}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm">
                  {state === 'sending' ? 'กำลังส่ง…' : 'ส่ง'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
