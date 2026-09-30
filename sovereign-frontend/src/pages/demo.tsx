"use client";
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { fetchJsonObject } from '../lib/fetchJson';
import { getApiUrl } from '../lib/config';
import { FeedbackButton } from '../components/public/FeedbackButton';
import { trackPageView, trackDemoTab, trackSurvey, trackQuestion } from '../lib/visitorTrack';

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
// P12: แคตตาล็อกโมดูลทั้งหมดที่อาจขายจริง (metadata จาก scanner)
interface CatalogModule { key: string; name: string; note: string; endpoints: number; loc: number; testRefs: number; }
interface CatalogData { modules: CatalogModule[]; total: number; note: string; }
// P12: ล็อตตามรอย + สินค้าร้าน (sandbox)
interface DemoLotEvent { type: string; detail: string; }
interface DemoLot { lotCode: string; crop: string; plot: string; quantity: number; harvestedAt: string; events: DemoLotEvent[]; note: string; }
interface DemoProduct { sku: string; name: string; price: number; warrantyMonths: number; lotCode: string | null; inStock: boolean; note: string; }

const API = `${getApiUrl()}/api/demo`;
const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })} ฿`;
const STATUS_TH: Record<string, { label: string; cls: string }> = {
  HEALTHY: { label: 'ปกติ', cls: 'text-emerald-400 border-emerald-500/40' },
  WATCH: { label: 'เฝ้าดู', cls: 'text-amber-400 border-amber-500/40' },
  VACCINATING: { label: 'รอวัคซีน', cls: 'text-cyan-400 border-cyan-500/40' },
};
const CLASS_TH: Record<string, string> = { CASH: 'เงินสด', STOCK: 'หุ้น', GOLD: 'ทองคำ', CRYPTO: 'คริปโต' };

export default function DemoPage() {
  const [tab, setTab] = useState<'farm' | 'livestock' | 'finance' | 'catalog' | 'trace' | 'shop'>('farm');
  const [farm, setFarm] = useState<FarmData | null>(null);
  const [stock, setStock] = useState<LivestockData | null>(null);
  const [fin, setFin] = useState<FinanceData | null>(null);
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [lotCode, setLotCode] = useState('LOT-D3M9C4');
  const [lot, setLot] = useState<DemoLot | null>(null);
  const [lotLoading, setLotLoading] = useState(false);
  const [lotErr, setLotErr] = useState('');
  const [products, setProducts] = useState<DemoProduct[] | null>(null);

  useEffect(() => {
    trackPageView('/demo'); // P10: เก็บสถิติการเยือน (cookieless · ไม่มี PII)
    fetchJsonObject<FarmData>(`${API}/farm`).then((d) => d && setFarm(d));
    fetchJsonObject<LivestockData>(`${API}/livestock`).then((d) => d && setStock(d));
    fetchJsonObject<FinanceData>(`${API}/finance`).then((d) => d && setFin(d));
    fetchJsonObject<CatalogData>(`${API}/catalog`).then((d) => d && setCatalog(d));
    fetchJsonObject<DemoProduct[]>(`${API}/shop`).then((d) => Array.isArray(d) && setProducts(d));
  }, []);

  const loadLot = useCallback(async (code: string) => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLotLoading(true); setLotErr('');
    try {
      const d = await fetchJsonObject<DemoLot>(`${API}/trace/${encodeURIComponent(c)}`);
      if (d && 'lotCode' in d) setLot(d);
      else setLotErr('ไม่พบล็อตนี้ — ลอง LOT-D3M9C4 หรือ LOT-DMS01A');
    } catch {
      setLotErr('ไม่พบล็อตนี้ — ลอง LOT-D3M9C4 หรือ LOT-DMS01A');
    } finally {
      setLotLoading(false);
    }
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

        <nav className="flex flex-wrap gap-2" role="tablist" aria-label="เลือกโมดูลเดโม่">
          {([['farm', '🌾 ฟาร์ม'], ['livestock', '🐄 ปศุสัตว์'], ['finance', '💰 การเงิน'], ['catalog', '🧩 โมดูลทั้งหมด'], ['trace', '🔎 ตามรอย'], ['shop', '🛒 ร้าน']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); trackDemoTab('/demo', k); }}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${tab === k ? 'border-cyan-500/60 text-cyan-300 bg-cyan-950/30' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
              {label}
            </button>
          ))}
        </nav>

        {tab === 'farm' && <FarmTab data={farm} />}
        {tab === 'livestock' && <LivestockTab data={stock} />}
        {tab === 'finance' && <FinanceTab data={fin} />}
        {tab === 'catalog' && <CatalogTab data={catalog} />}
        {tab === 'trace' && <TraceTab code={lotCode} setCode={setLotCode} lot={lot} loading={lotLoading} err={lotErr} onSearch={loadLot} />}
        {tab === 'shop' && <ShopTab products={products} />}

        <VisitorSurvey />

        <footer className="pt-4 text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
          <span>Powered by Sovereign OS</span>
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

// ── แท็บ 🧩 โมดูลทั้งหมด (P12+P14): ครบทุกโมดูล + ปุ่มสนใจโมดูลนี้ (ฟอร์มจองเล็ก — เก็บสถิติว่าโมดูลไหนถูกขอมากสุด) ──
function CatalogTab({ data }: { data: CatalogData | null }) {
  const [interestKey, setInterestKey] = useState<string | null>(null); // โมดูลที่กำลังเปิดฟอร์ม
  const [msg, setMsg] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!data) return <Loading />;
  const soldHint = ['trace', 'business', 'farm', 'livestock', 'inventory', 'finance'];

  const submitInterest = async () => {
    if (!interestKey || msg.trim().length < 3) return;
    setBusy(true);
    try {
      await fetch(`${getApiUrl()}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: '/demo', topic: 'feature', message: `[สนใจโมดูล ${interestKey}] ${msg.trim()}`, senderEmail: contact || undefined, website }),
      });
      trackQuestion('/demo', `สนใจโมดูล ${interestKey}`, msg.trim().slice(0, 200)); // สถิติโมดูลไหนถูกขอมากสุด
      setSent(true);
      setTimeout(() => { setInterestKey(null); setSent(false); setMsg(''); setContact(''); }, 2500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4 space-y-3" aria-label="แคตตาล็อกโมดูลทั้งหมด">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-ledger text-sm text-gray-300">🧩 ทั้งหมด {data.total} โมดูล — ความสามารถครบระบบ</h2>
        <span className="text-[10px] text-cyan-400/80">เปิดขายแยกชิ้นได้ที่หน้าร้าน</span>
      </div>
      <div className="grid gap-1.5 max-h-[26rem] overflow-y-auto pr-1">
        {data.modules.map((m) => (
          <div key={m.key} className="border-b border-dashed border-gray-800/80 pb-1.5 last:border-0">
            <div className="flex items-baseline gap-2">
              <span className={`text-xs w-28 shrink-0 truncate ${soldHint.includes(m.key) ? 'text-emerald-300' : 'text-gray-300'}`}>{m.name}</span>
              <span className="text-[11px] text-gray-500 flex-1 truncate">{m.note || '—'}</span>
              <span className="mono text-[10px] text-gray-600 shrink-0" title="endpoints · บรรทัดโค้ด · ชุดทดสอบ">
                {m.endpoints} ep · {m.loc.toLocaleString('th-TH')} LOC · ✅{m.testRefs}
              </span>
              <button type="button" onClick={() => { setInterestKey(interestKey === m.key ? null : m.key); setSent(false); }}
                className={`shrink-0 text-[10px] px-2 py-0.5 rounded border transition ${interestKey === m.key ? 'border-cyan-500/60 text-cyan-300 bg-cyan-950/30' : 'border-gray-700 text-gray-400 hover:border-cyan-500/60 hover:text-cyan-300'}`}>
                สนใจโมดูลนี้
              </button>
            </div>
            {interestKey === m.key && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-cyan-900/60 bg-cyan-950/10 p-2.5">
                {sent ? (
                  <p className="text-xs text-emerald-400">บันทึกความสนใจ {m.name} แล้ว — เจ้าของร้านจะติดต่อกลับครับ 🙏</p>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-400">สนใจใช้ <b className="text-cyan-300">{m.name}</b> — บอกการใช้งานที่ต้องการได้เลย (จะถูกส่งถึงผู้พัฒนาโดยตรง)</p>
                    <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} maxLength={500}
                      placeholder="เช่น อยากใช้กับไร่ผม มีแปลง 3 แปลง อยากเห็นความชื้นดินรายแปลง…"
                      className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-xs" />
                    <div className="flex gap-2 items-center">
                      <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120}
                        placeholder="อีเมล/เบอร์ (ถ้าอยากให้ติดต่อกลับ — ไม่บังคับ)"
                        className="flex-1 bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1 text-xs" />
                      {/* honeypot */}
                      <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
                      <button type="button" onClick={submitInterest} disabled={busy || msg.trim().length < 3}
                        className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs">
                        {busy ? 'กำลังส่ง…' : 'ส่งความสนใจ'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600">{data.note}</p>
    </section>
  );
}

// ── แท็บ 🔎 ตามรอย (P12): ลองค้นล็อตแบบเดียวกับที่ลูกค้าใช้จริง ──
const LOT_EVENT_TH: Record<string, string> = { HARVESTED: 'เก็บเกี่ยว', PROCESSED: 'แปรรูป', TESTED: 'ตรวจคุณภาพ', SOLD: 'ขายแล้ว', DELIVERED: 'ส่งมอบ', NOTE: 'บันทึก', ASSEMBLED: 'ประกอบ', FLASHED: 'แฟลชเฟิร์มแวร์', PACKAGED: 'แพ็กส่ง', BUILT: 'สร้างบิลด์', PUBLISHED: 'ปล่อยเวอร์ชัน' };
function TraceTab({ code, setCode, lot, loading, err, onSearch }: {
  code: string; setCode: (v: string) => void; lot: DemoLot | null; loading: boolean; err: string; onSearch: (c: string) => void;
}) {
  return (
    <section className="card p-4 space-y-3" aria-label="เดโม่ตามรอย">
      <h2 className="font-ledger text-sm text-gray-300">🔎 ตามรอยล็อต — เหมือนที่ลูกค้าสแกนจากฉลากจริง</h2>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearch(code)}
          placeholder="LOT-D3M9C4" aria-label="รหัสล็อต" maxLength={30}
          className="flex-1 bg-gray-800/70 border border-gray-700 rounded-lg px-3 py-1.5 text-sm mono" />
        <button type="button" onClick={() => onSearch(code)} disabled={loading}
          className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm">
          {loading ? 'กำลังค้น…' : 'ค้นหา'}
        </button>
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      {lot && (
        <div className="space-y-2 pt-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="mono text-sm text-cyan-300">{lot.lotCode}</span>
            <span className="text-xs text-gray-300">{lot.crop}</span>
            <span className="text-[11px] text-gray-500">{lot.plot} · {lot.quantity} กก. · เก็บ {new Date(lot.harvestedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
          </div>
          <ol className="space-y-1.5 border-l-2 border-cyan-900/60 pl-3">
            {lot.events.map((ev, i) => (
              <li key={i} className="text-xs">
                <span className="text-cyan-400/90 font-medium">{LOT_EVENT_TH[ev.type] ?? ev.type}</span>
                <span className="text-gray-400"> — {ev.detail}</span>
              </li>
            ))}
          </ol>
          <p className="text-[10px] text-gray-600">{lot.note}</p>
        </div>
      )}
      {!lot && !err && <p className="text-[11px] text-gray-500">ลองกดค้นหาเลย — รหัสตัวอย่าง: LOT-D3M9C4 (ผลผลิต) · LOT-DMS01A (อุปกรณ์) · LOT-SWV040 (ซอฟต์แวร์)</p>}
    </section>
  );
}

// ── แท็บ 🛒 ร้าน (P12): สินค้าที่ขายจริงตอนนี้ (จาก API สาธารณะเดียวกับหน้าร้าน) ──
function ShopTab({ products }: { products: DemoProduct[] | null }) {
  if (!products) return <Loading />;
  return (
    <section className="card p-4 space-y-3" aria-label="เดโม่ร้านค้า">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-ledger text-sm text-gray-300">🛒 สินค้าที่ขายจริงตอนนี้</h2>
        <a href="/shop" className="text-[11px] text-emerald-300 underline underline-offset-2">ไปหน้าร้านเต็ม →</a>
      </div>
      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.sku} className="flex items-baseline gap-2 border-b border-dashed border-gray-800/80 pb-2 last:border-0">
            <span className="text-xs text-gray-200 w-56 truncate">{p.name}</span>
            <span className="mono text-sm text-emerald-300">{Number(p.price).toLocaleString('th-TH')} ฿</span>
            <span className="text-[10px] text-gray-500">รับประกัน {p.warrantyMonths} เดือน</span>
            {p.lotCode && <span className="mono text-[10px] text-cyan-400/80" title="ล็อตการผลิต — กดแท็บตามรอยเพื่อดูประวัติ">ล็อต {p.lotCode}</span>}
            <span className={`ml-auto text-[10px] border rounded px-1.5 py-0.5 ${p.inStock ? 'border-emerald-500/40 text-emerald-400' : 'border-gray-700 text-gray-500'}`}>{p.inStock ? 'มีสินค้า' : 'สินค้าหมด'}</span>
            <span className="basis-full text-[11px] text-gray-500">{p.note}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600">ข้อมูลจริงจากหน้าร้าน — สั่งซื้อจริงที่แท็บร้าน หรือโทร/แจ้งผ่านปุ่มความคิดเห็น</p>
    </section>
  );
}

// ── แบบสอบถามสั้น (P10) — เก็บความต้องการผู้ใช้จริง: โมดูลไหนอยากใช้ก่อน ──
const SURVEY_MODULES = ['farm', 'livestock', 'finance', 'trace', 'shop', 'อื่น ๆ'] as const;
function VisitorSurvey() {
  const [picked, setPicked] = useState<string | null>(null);
  const [want, setWant] = useState('');
  const [sent, setSent] = useState(false);
  const [website, setWebsite] = useState(''); // honeypot

  if (sent) {
    return (
      <section className="card p-4 text-sm text-emerald-400" aria-label="แบบสอบถาม">
        บันทึกคำตอบแล้ว — ขอบคุณครับ 🙏 เราจะนำไปพัฒนาสิ่งที่คนใช้จริงต้องการก่อน
      </section>
    );
  }

  const submit = () => {
    if (!picked) return;
    trackSurvey('/demo', picked); // ทางเลือกหลัก → kind:survey
    if (want.trim().length >= 3) trackQuestion('/demo', `อยากได้เพิ่มใน ${picked}`, want.trim().slice(0, 300)); // อิสระ → kind:question
    setSent(true);
  };

  return (
    <section className="card p-4 space-y-3" aria-label="แบบสอบถามผู้ใช้">
      <div>
        <h2 className="font-ledger text-sm text-gray-300">ช่วยหน่อย — ส่วนไหนที่คุณอยากใช้จริงก่อน?</h2>
        <p className="text-[11px] text-gray-500">ตอบ 1 ข้อ 5 วินาที — ผลจะถูกนำไปจัดลำดับการพัฒนา (ไม่เก็บข้อมูลตัวตน)</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SURVEY_MODULES.map((m) => (
          <button key={m} type="button" onClick={() => setPicked(m)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition ${picked === m ? 'border-emerald-500/60 text-emerald-300 bg-emerald-950/30' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
            {m}
          </button>
        ))}
      </div>
      {picked && (
        <>
          <textarea value={want} onChange={(e) => setWant(e.target.value)} rows={2} maxLength={300}
            placeholder="อยากได้อะไรเพิ่มในส่วนนี้ (ถ้ามี — ไม่บังคับ)" aria-label="ความต้องการเพิ่มเติม"
            className="w-full bg-gray-800/70 border border-gray-700 rounded-lg px-2 py-1.5 text-sm" />
          {/* honeypot — ซ่อนจากมนุษย์ */}
          <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1}
            autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
          <button type="button" onClick={submit}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm">
            ส่งคำตอบ
          </button>
        </>
      )}
    </section>
  );
}


