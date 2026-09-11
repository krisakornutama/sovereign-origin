"use client";
// ─────────────────────────────────────────────────────────────
// SOVEREIGN TREASURY — คลัง & ลงทุน (LIFE & FINANCE unified view)
//   View A: Net Worth & Cashflow   (id="net-worth")
//   View B: Survival Runway        (id="runway") — signature "เส้นเชื้อไฟ"
//   View C: Investment Strategies  (id="strategies") — 5 ตระกูล + catalyst + feeds
// ข้อมูลเดียวจาก GET /api/treasury/overview — ขาย/ปันผล/ปรับเงินสด อัปเดตเงินสดอัตโนมัติ
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { useIsSuperadmin } from '../lib/roles';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import SignalsCard from '../components/treasury/SignalsCard';

// ── โทเค็นห้องคลัง (เหล็กกล้า + หมึกสมุด + ไฟสีของตระกูล) — premium ──
const PANEL = 'bg-gray-900/70 border border-gray-800/80 rounded-2xl backdrop-blur-sm shadow-[0_8px_28px_rgba(0,0,0,0.35)]';
const TILE = 'bg-gray-950/70 border border-gray-800/80 rounded-xl backdrop-blur-sm transition-all hover:border-gray-700/80 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]';
const INPUT = 'bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-500/40 transition-colors';
const BTN = 'px-4 py-2 bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 hover:border-emerald-500/60 disabled:opacity-50 rounded-xl text-sm font-semibold transition-all shadow-[0_0_14px_rgba(52,211,153,0.12)] hover:shadow-[0_0_20px_rgba(52,211,153,0.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400';

// สีประจำ 5 Strategy Families
const FAMILY_COLORS: Record<string, string> = {
  FUNDAMENTAL: '#D4AF37',
  ASYMMETRIC: '#E87A60',
  MACRO: '#7FB3D9',
  QUANT: '#C084FC',
  PASSIVE_INCOME: '#7FB069',
};

const fmtUsd = (n: number) => '$' + (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtThb = (n: number) => '฿' + (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtNum = (n: number) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 });

// ═══════════ Section — ตัวยึด Section anchors (#net-worth / #runway / #strategies) ═══════════

function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`${PANEL} panel-glow scroll-mt-6 overflow-hidden`}>
      <div className="flex items-baseline justify-between px-6 py-4 border-b border-gray-800/80 bg-gradient-to-r from-gray-900/50 via-transparent to-transparent">
        <div>
          <h2 className="font-bold text-gray-100 glow-text tracking-tight flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-emerald-500/60 shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
            {title}
          </h2>
          <p className="text-[11px] text-gray-500 mt-1">{desc}</p>
        </div>
        <span className="mono text-[10px] text-gray-600 tracking-[0.2em] uppercase border border-gray-800 rounded-full px-2 py-1 bg-gray-950/50">▍treasury</span>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

// ═══════════ Signature: เส้นเชื้อไฟ (Burn Line) ═══════════
// เชื้อไฟ = เงินสดสภาพคล่อง (เส้นบาง = เงินสดล้วน, เส้นหนา = เงินสด + ปันผลรายปี)
// เอมเบอร์ = เดือนที่อยู่รอด ณ ตอนนี้ — ไหม้ลงเมื่อค่าใช้จ่ายเผาผลาญเงิน
function FuseLine({ months, cashMonths }: { months: number | null; cashMonths: number | null }) {
  const t = useLanguageStore((s) => s.t);
  const SCALE = 24; // 0–24 เดือน
  const tone = months == null ? 'ok' : months < 6 ? 'danger' : months < 24 ? 'warn' : 'ok';
  const colors = { ok: '#7FB069', warn: '#D4AF37', danger: '#E87A60' }[tone] as string;
  const pct = (m: number | null) => (m == null ? 100 : Math.min(100, (Math.max(0, m) / SCALE) * 100));

  return (
    <div className="select-none" role="img" aria-label={t('treasury.stat.runway', 'Survival Runway')}>
      <div className="flex items-center justify-between mb-2">
        <span className="mono text-[10px] text-gray-500 tracking-widest uppercase">{t('treasury.stat.runway', 'Survival Runway')}</span>
        <span className="mono text-xs text-gray-400">
          {t('treasury.stat.months', 'เดือน')} ·{' '}
          <span className="mono text-lg font-bold glow-text" style={{ color: colors }}>
            {months == null ? '∞' : months.toFixed(1)}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        {/* สเกล 0–24 เดือน */}
        <div className="flex-1 relative h-10">
          {[0, 6, 12, 18, 24].map((m) => (
            <div key={m} className="absolute top-0 bottom-4 w-px bg-gray-800" style={{ left: `${(m / SCALE) * 100}%` }}>
              <span className="absolute bottom-0 left-0 -translate-x-1/2 mono text-[9px] text-gray-600">{m}</span>
            </div>
          ))}
          {/* เชื้อไฟเงินสดล้วน — เส้นบาง */}
          <div className="absolute inset-x-0 top-1 h-1 rounded-full bg-gray-800/60">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct(cashMonths)}%`, background: 'repeating-linear-gradient(90deg, rgba(212,175,55,0.5) 0 6px, rgba(212,175,55,0.12) 6px 12px)' }}
            />
          </div>
          {/* เชื้อไฟเต็ม: เงินสด + ปันผล — เส้นหนา + เอมเบอร์ */}
          <div className="absolute inset-x-0 top-7 h-2 rounded-full bg-gray-800/60">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct(months)}%`, background: `linear-gradient(90deg, ${colors}66, ${colors})`, boxShadow: `0 0 10px ${colors}55` }}
            />
            {months != null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pulse-soft"
                style={{ left: `calc(${pct(months)}% - 5px)`, background: '#ffe9c9', boxShadow: `0 0 12px 3px ${colors}, 0 0 22px ${colors}88`, border: `1px solid ${colors}` }}
              />
            )}
          </div>
        </div>
        <div className="shrink-0 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="w-4 h-1 rounded-full" style={{ background: 'repeating-linear-gradient(90deg, rgba(212,175,55,0.5) 0 4px, rgba(212,175,55,0.12) 4px 8px)' }} />
            {t('treasury.stat.liquidity', 'เงินสดสภาพคล่อง')}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className="w-4 h-1.5 rounded-full" style={{ background: colors, boxShadow: `0 0 6px ${colors}66` }} />
            {t('treasury.stat.liquidityPlus', '+ ปันผลรายปี')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════ Stat tile เล็ก (หัวหน้า) ═══════════

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`${TILE} p-3 flex flex-col gap-0.5`}>
      <span className="text-[10px] text-gray-500 tracking-wide uppercase">{label}</span>
      <span className="mono text-xl font-bold text-gray-100 glow-text" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub && <span className="text-[10px] text-gray-600 truncate">{sub}</span>}
    </div>
  );
}

// ═══════════ แถวตระกูลใน Matrix ═══════════

function FamilyRow({ family, pct, valueUsd, positions, yieldPct }: { family: string; pct: number; valueUsd: number; positions: number; yieldPct: number }) {
  const t = useLanguageStore((s) => s.t);
  const color = FAMILY_COLORS[family] || '#9CA3AF';
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} />
          <span className="text-xs text-gray-300 truncate">{t('treasury.families.' + family, family)}</span>
        </div>
        <span className="text-[10px] text-gray-600 mono">{positions} {t('treasury.matrix.positions', 'ตำแหน่ง')}</span>
      </div>
      <div className="flex-1 h-4 rounded bg-gray-900 overflow-hidden border border-gray-800">
        <div className="h-full rounded-sm" style={{ width: `${Math.min(100, pct)}%`, background: `linear-gradient(90deg, ${color}33, ${color})`, boxShadow: `0 0 8px ${color}44` }} />
      </div>
      <div className="w-28 text-right shrink-0">
        <span className="mono text-sm text-gray-200">{fmtUsd(valueUsd)}</span>
        <span className="mono text-[10px] text-gray-500 ml-1.5">{pct.toFixed(1)}%</span>
      </div>
      <div className="w-24 text-right shrink-0 text-[10px] text-gray-600 mono">
        {yieldPct > 0 ? `yield ${yieldPct.toFixed(2)}%` : '—'}
      </div>
    </div>
  );
}

// ═══════════ Types (จาก GET /api/treasury/overview) ═══════════

interface Allocation { family: string; valueUsd: number; pct: number; positions: number; dividendYieldPct: number }
interface Catalyst { id: string; symbol: string; note: string; family: string; valueUsd: number }
interface EventRow { id: string; type: string; symbol: string | null; amount_usd: number; note: string | null; created_at: string }
interface DividendStream { id: string; symbol: string; family: string; quantity: number; yieldPct: number; annualEstimateUsd: number; lastDividendUsd: number | null; lastDividendAt: string | null }
interface Position {
  id: string; symbol: string; type: string; quantity: number; wallet_address: string | null; notes: string | null;
  strategyFamily: string; avgCostUsd: number | null; expectedDividendYieldPct: number; catalystNote: string | null;
  lastDividendUsd: number | null; lastDividendAt: string | null; realizedGainUsd: number; soldQty: number;
  companyName: string | null; allocationPct: number | null; totalReturnPct: number | null; totalReturnUsd: number | null;
  priceUsd: number | null; valueUsd: number;
}
interface DimeSector { name: string; value_usd: number; pct: number }
interface DimeStatement {
  statementPeriod: string; parsedAt: string; accountNo: string | null; fxRate: number | null;
  totalBalanceUsd: number | null; totalBalanceThb: number | null;
  cashBalanceUsd: number | null; cashBalanceThb: number | null;
  totalReturnPct: number | null; totalReturnUsd: number | null;
  sectors: DimeSector[] | null; assetCount: number;
}
interface Overview {
  generatedAt: string;
  dime: DimeStatement | null;
  netWorth: { usd: number; liquidCashUsd: number; assetsUsd: number; inventoryUsd: number; liabilitiesUsd: number };
  cashflow: { monthlyBurnUsd: number; energyCostUsd: number; coreBurnUsd: number; monthlyIncomeUsd: number; annualizedDividendUsd: number };
  runway: { months: number | null; formula: { liquidCashUsd: number; annualizedDividendUsd: number; monthlyBurnUsd: number } };
  strategies: { families: string[]; allocation: Allocation[]; totalUsd: number };
  catalysts: Catalyst[];
  income: { dividendStreams: DividendStream[]; events: EventRow[]; totalRealizedGainUsd: number };
  positions: Position[];
}

interface RunwaySnapshot { snapshotAt: string; months: number; liquidCashUsd: number; annualizedDividendUsd: number; monthlyBurnUsd: number }

interface TransferOrder {
  id: string;
  direction: 'IN' | 'OUT';
  status: 'PENDING' | 'VERIFIED' | 'CANCELLED';
  category: string;
  amountUsd: number;
  amountThb: number | null;
  payee: string | null;
  bank: string | null;
  accountNumber: string | null;
  note: string | null;
  refCode: string;
  qrPayload: string | null;
  txid: string | null;
  evidenceUrl: string | null;
  requestedBy: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface Member { id: string; username: string; role: string }

// ═══════════ หน้า SOVEREIGN TREASURY ═══════════

export default function TreasuryPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = useIsSuperadmin();

  const [members, setMembers] = useState<Member[]>([]);
  const [viewOwnerId, setViewOwnerId] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [runwayHistory, setRunwayHistory] = useState<RunwaySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<null | 'sheet' | 'add' | 'edit' | 'sell' | 'dividend' | 'transfer' | 'qr' | 'confirmTransfer' | 'slip'>(null);
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Transfer Orders (โอนเงิน & ยืนยัน) ──
  const [transfers, setTransfers] = useState<TransferOrder[]>([]);
  const [promptpayConfigured, setPromptpayConfigured] = useState(false);
  const [qrOrder, setQrOrder] = useState<TransferOrder | null>(null);
  const [transferForm, setTransferForm] = useState({ direction: 'OUT', category: 'BILL', amountUsd: '', amountThb: '', payee: '', bank: '', accountNumber: '', note: '' });
  const [confirmForm, setConfirmForm] = useState({ txid: '' });
  const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);
  const [slipTarget, setSlipTarget] = useState<TransferOrder | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);

  const ownerQuery = viewOwnerId ? `?userId=${encodeURIComponent(viewOwnerId)}` : '';

  // SUPERADMIN: รายชื่อสมาชิกเพื่อสลับดู
  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !user || !isSuperadmin) return;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Member[]) => setMembers(list))
      .catch(() => setMembers([]));
    setViewOwnerId(user.id);
  }, [isHydrated, isAuthenticated, user, isSuperadmin]);

  // เปิดไปที่ sub-view โดยตรง (#runway / #net-worth / #strategies)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }, []);

  const load = async () => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/overview${ownerQuery}`);
    if (!res.ok) throw new Error(t('treasury.page.loadFailed', 'โหลดข้อมูลไม่สำเร็จ'));
    setData(await res.json());
    const histRes = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/runway/history${ownerQuery}`).catch(() => null);
    if (histRes?.ok) {
      const hist = await histRes.json();
      setRunwayHistory(Array.isArray(hist.history) ? hist.history : []);
    }
    const trRes = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/transfers?limit=50${ownerQuery}`).catch(() => null);
    if (trRes?.ok) {
      const tr = await trRes.json();
      setTransfers(Array.isArray(tr.transfers) ? tr.transfers : []);
      setPromptpayConfigured(Boolean(tr.promptpayConfigured));
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (isSuperadmin && !viewOwnerId) return;
    setLoading(true);
    load()
      .catch((e) => { console.error(e); setError(t('treasury.page.loadFailed', 'โหลดข้อมูลไม่สำเร็จ — ตรวจว่า backend เปิดอยู่')); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, viewOwnerId]);

  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(''), 4000); };

  const post = async (path: string, body?: unknown): Promise<any> => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}${path}${ownerQuery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const dataRes = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(dataRes?.error || 'Failed');
    return dataRes;
  };

  const weakPost = async (path: string, body?: unknown): Promise<Response> => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}${path}${ownerQuery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); setError(''); } catch (e: any) { console.error(e); setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  // ── กล่องผลลัพธ์ของฟอร์ม (open/close + submit) ──
  const modalFrame = (title: string, onSubmit: () => Promise<void>, children: React.ReactNode) => (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => setModal(null)}>
      <div className={`${PANEL} w-full max-w-lg p-5 panel-glow`} onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-100 mb-4 glow-text">{title}</h3>
        {children}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setModal(null)} disabled={busy} className="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50">{t('common.cancel', 'ยกเลิก')}</button>
          <button onClick={() => run(onSubmit)} disabled={busy} className={BTN}>{busy ? t('common.saving', 'กำลังบันทึก…') : t('common.save', 'บันทึก')}</button>
        </div>
      </div>
    </div>
  );

  // ── ฟอร์มย่อย: งบดุล / เพิ่ม-แก้ไขตำแหน่ง / ขาย / ปันผล ──
  const [sheetForm, setSheetForm] = useState({ liquidCashUsd: '', liabilitiesUsd: '', monthlyBurnUsd: '', monthlyIncomeUsd: '', adjustCashUsd: '', adjustNote: '' });
  const [posForm, setPosForm] = useState({ symbol: '', type: 'CRYPTO', quantity: '', wallet_address: '', avgCostUsd: '', expectedDividendYieldPct: '', strategyFamily: 'FUNDAMENTAL', catalystNote: '', notes: '' });
  const [sellForm, setSellForm] = useState({ quantity: '', priceUsd: '', note: '' });
  const [divForm, setDivForm] = useState({ amountUsd: '', note: '' });

  const openSheet = () => {
    setSheetForm({
      liquidCashUsd: String(data?.netWorth.liquidCashUsd ?? ''),
      liabilitiesUsd: String(data?.netWorth.liabilitiesUsd ?? ''),
      monthlyBurnUsd: String(data?.cashflow.coreBurnUsd ?? ''),
      monthlyIncomeUsd: String(data?.cashflow.monthlyIncomeUsd ?? ''),
      adjustCashUsd: '', adjustNote: '',
    });
    setModal('sheet');
  };

  const openEdit = (p: Position) => {
    setEditingPos(p);
    setPosForm({
      symbol: p.symbol, type: p.type, quantity: String(p.quantity), wallet_address: p.wallet_address || '',
      avgCostUsd: p.avgCostUsd != null ? String(p.avgCostUsd) : '', expectedDividendYieldPct: String(p.expectedDividendYieldPct),
      strategyFamily: p.strategyFamily, catalystNote: p.catalystNote || '', notes: p.notes || '',
    });
    setModal('edit');
  };

  const saveSheet = async () => {
    const body: Record<string, number | string> = {};
    const put = (k: string, v: string) => { if (v !== '') body[k] = Number(v); };
    put('liquidCashUsd', sheetForm.liquidCashUsd);
    put('liabilitiesUsd', sheetForm.liabilitiesUsd);
    put('monthlyBurnUsd', sheetForm.monthlyBurnUsd);
    put('monthlyIncomeUsd', sheetForm.monthlyIncomeUsd);
    if (sheetForm.adjustCashUsd !== '') { body.adjustCashUsd = Number(sheetForm.adjustCashUsd); body.adjustNote = sheetForm.adjustNote; }
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/balance-sheet${ownerQuery}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || 'Failed');
    setModal(null); await load(); flash(t('treasury.sheet.saved', 'บันทึกงบดุลแล้ว'));
  };

  const savePosition = async () => {
    if (editingPos) {
      await post('/api/treasury/positions/' + editingPos.id, posForm);
      flash(t('treasury.positions.updated', 'อัปเดตสำเร็จ'));
    } else {
      await post('/api/treasury/positions', { ...posForm, quantity: Number(posForm.quantity), avgCostUsd: posForm.avgCostUsd !== '' ? Number(posForm.avgCostUsd) : undefined });
      flash(t('treasury.positions.added', 'เพิ่มตำแหน่ง {symbol} แล้ว', { symbol: posForm.symbol.toUpperCase() }));
    }
    setModal(null); setEditingPos(null); setPosForm({ symbol: '', type: 'CRYPTO', quantity: '', wallet_address: '', avgCostUsd: '', expectedDividendYieldPct: '', strategyFamily: 'FUNDAMENTAL', catalystNote: '', notes: '' });
    await load();
  };

  const deletePosition = async (p: Position) => {
    if (!confirm(t('treasury.positions.del', 'ลบตำแหน่ง {symbol}?'))) return;
    await run(async () => {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/positions/${p.id}${ownerQuery}`, {
        method: 'DELETE',
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || 'Failed');
      await load();
      flash(t('treasury.positions.deleted', 'ลบตำแหน่งแล้ว'));
    });
  };

  const doSell = async () => {
    const res = await weakPost(`/api/treasury/positions/${editingPos!.id}/sell`, sellForm);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || 'Failed');
    setModal(null); await load();
    flash(t('treasury.positions.sold', 'ขาย {qty} {symbol} @{price} → กำไร {gain} เข้าเงินสด', {
      qty: sellForm.quantity, symbol: editingPos!.symbol, price: fmtUsd(Number(sellForm.priceUsd)), gain: fmtUsd(d?.sale?.realizedGainUsd ?? 0),
    }));
  };

  const doDividend = async () => {
    const res = await weakPost(`/api/treasury/positions/${editingPos!.id}/dividend`, divForm);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || 'Failed');
    setModal(null); await load();
    flash(t('treasury.positions.dividendPaid', 'ปันผล {amount} เข้าเงินสดแล้ว', { amount: fmtUsd(Number(divForm.amountUsd)) }));
  };

  const saveRunwaySnapshot = async () => {
    await run(async () => {
      const d = await post('/api/treasury/runway/snapshot');
      flash(t('treasury.runway.snapshotSaved', 'บันทึกสแนปชอตแล้ว: {months} เดือน', { months: d.months?.toFixed(1) ?? '∞' }));
    });
  };

  // ── Transfer Orders: สร้าง / ยืนยัน / ยกเลิก ──
  const TRANSFER_CATEGORIES = ['BILL', 'FOOD', 'UTILITY', 'SALARY', 'INVESTMENT', 'LOAN', 'MEDICAL', 'EDUCATION', 'OTHER'];

  const doCreateTransfer = async () => {
    const body: Record<string, unknown> = {
      direction: transferForm.direction,
      category: transferForm.category,
      amountUsd: Number(transferForm.amountUsd),
    };
    if (transferForm.amountThb !== '') body.amountThb = Number(transferForm.amountThb);
    if (transferForm.payee.trim()) body.payee = transferForm.payee.trim();
    if (transferForm.bank.trim()) body.bank = transferForm.bank.trim();
    if (transferForm.accountNumber.trim()) body.accountNumber = transferForm.accountNumber.trim();
    if (transferForm.note.trim()) body.note = transferForm.note.trim();
    const d = await post('/api/treasury/transfers', body);
    const created: TransferOrder = {
      id: d.order.id, direction: d.order.direction, status: d.order.status,
      category: transferForm.category, amountUsd: d.order.amountUsd, amountThb: d.order.amountThb,
      payee: transferForm.payee || null, bank: transferForm.bank || null, accountNumber: transferForm.accountNumber || null,
      note: transferForm.note || null, refCode: d.order.refCode, qrPayload: d.order.qrPayload,
      txid: null, evidenceUrl: null, requestedBy: '', verifiedBy: null, verifiedAt: null, createdAt: new Date().toISOString(),
    };
    await load();
    setQrOrder(created);
    setModal('qr');
    flash(t('treasury.transfers.created', 'สร้างคำสั่ง {ref} แล้ว — โอนจริงผ่านแอปธนาคาร แล้วกด "ยืนยัน"', { ref: d.order.refCode }));
  };

  const doConfirmTransfer = async () => {
    if (!confirmTransferId) return;
    const tr = transfers.find((x) => x.id === confirmTransferId);
    if (!tr) return;
    const res = await weakPost(`/api/treasury/transfers/${tr.id}/confirm`, { txid: confirmForm.txid.trim() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || 'Failed');
    setModal(null);
    await load();
    const isOut = tr.direction === 'OUT';
    flash(isOut
      ? (t('treasury.transfers.confirmedShort', 'โอน {amount} เข้าบัญชีจริง (หัก {debited} จาก ledger)', { amount: fmtUsd(tr.amountUsd), debited: fmtUsd(d?.actualDebitedUsd ?? 0) }))
      : t('treasury.transfers.confirmedIn', 'ยืนยันแล้ว — เครดิต {amount} เข้าเงินสด', { amount: fmtUsd(d?.amountUsd ?? tr.amountUsd) }));
  };

  const doCancelTransfer = async (tr: TransferOrder) => {
    const res = await weakPost(`/api/treasury/transfers/${tr.id}/cancel`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || 'Failed');
    await load();
    flash(t('treasury.transfers.cancelled', 'ยกเลิกคำสั่งแล้ว'));
  };

  const openConfirmTransfer = (tr: TransferOrder) => {
    setConfirmForm({ txid: '' });
    setConfirmTransferId(tr.id);
    setModal('confirmTransfer');
  };

  // ── สลิป: อัปโหลดภาพหลักฐาน ──
  const doUploadSlip = async () => {
    if (!slipTarget || !slipFile) throw new Error(t('treasury.transfers.required', 'จำเป็น'));
    const fd = new FormData();
    fd.append('file', slipFile);
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/treasury/transfers/${slipTarget.id}/evidence${ownerQuery}`, {
      method: 'POST',
      body: fd,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || 'Failed');
    setModal(null);
    setSlipFile(null);
    await load();
    flash(t('treasury.transfers.slipUploaded', 'อัปโหลดสลิปแล้ว'));
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }
  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('treasury.page.unauthorized', 'Unauthorized')}</div>;

  const runway = data?.runway;
  const cashMonths = runway && runway.formula.monthlyBurnUsd > 0 ? runway.formula.liquidCashUsd / runway.formula.monthlyBurnUsd : null;
  const months = runway?.months ?? null;
  const runwayTone = months == null ? '#7FB069' : months < 6 ? '#E87A60' : months < 24 ? '#D4AF37' : '#7FB069';

  const eventLabels: Record<string, string> = {
    REALIZED_GAIN: t('treasury.income.eventRealizedGain', 'กำไรรับรู้'),
    DIVIDEND: t('treasury.income.eventDividend', 'ปันผล'),
    CASH_ADJUST: t('treasury.income.eventCashAdjust', 'ปรับเงินสด'),
    TRANSFER_IN: t('treasury.transfers.eventIn', 'โอนเข้า'),
    TRANSFER_OUT: t('treasury.transfers.eventOut', 'โอนออก'),
  };

  const runwayWarnText = months == null
    ? t('treasury.runway.ok', 'มั่นคง — มากกว่า 24 เดือน')
    : months < 6 ? t('treasury.runway.danger', 'วิกฤต — น้อยกว่า 6 เดือน')
    : months < 24 ? t('treasury.runway.warn', 'เฝ้าระวัง — 6–24 เดือน')
    : t('treasury.runway.ok', 'มั่นคง — มากกว่า 24 เดือน');

  // สรุปยอดโอนเดือนนี้ + รอการยืนยัน (คำนวณจากรายการที่โหลดมา)
  const nowYmd = new Date().toISOString().slice(0, 7);
  const isThisMonth = (iso: string | null) => (iso || '').startsWith(nowYmd);
  const outMonth = transfers.filter((x) => x.direction === 'OUT' && x.status === 'VERIFIED' && isThisMonth(x.verifiedAt || x.createdAt)).reduce((s, x) => s + x.amountUsd, 0);
  const inMonth = transfers.filter((x) => x.direction === 'IN' && x.status === 'VERIFIED' && isThisMonth(x.verifiedAt || x.createdAt)).reduce((s, x) => s + x.amountUsd, 0);
  const pendingCount = transfers.filter((x) => x.status === 'PENDING').length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader
            eyebrow={t('treasury.page.eyebrow', 'ชีวิต & การเงิน')}
            title={t('treasury.page.title', 'SOVEREIGN TREASURY')}
            subtitle={t('treasury.page.subtitle', 'คลัง & ลงทุน — ทรัพย์สิน / Survival Runway / กลยุทธ์ 5 ตระกูล')}
            icon={<Icon name="portfolio" size={18} />}
            actions={
              <>
                {isSuperadmin && members.length > 0 && (
                  <select value={viewOwnerId} onChange={(e) => setViewOwnerId(e.target.value)} className={INPUT}>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.username}{m.id === user?.id ? ' (คุณ)' : ''}</option>
                    ))}
                  </select>
                )}
                <button onClick={() => run(load)} disabled={loading} className={BTN}>
                  <Icon name="refresh" size={14} /> {t('treasury.page.refresh', 'รีเฟรช')}
                </button>
              </>
            }
          />
          {error && (
            <div className="text-sm text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-4 py-3 flex items-center gap-2">
              <Icon name="alert-triangle" size={14} className="shrink-0" />{error}
            </div>
          )}
          {toast && (
            <div className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-4 py-3">
              {toast}
            </div>
          )}

          {loading ? (
            <div className="text-gray-500">{t('treasury.page.loading', 'กำลังโหลด…')}</div>
          ) : !data ? (
            <div className="text-gray-500">{t('treasury.page.noData', 'ยังไม่มีข้อมูล')}</div>
          ) : (
            <>
              {/* ── Stat หัวบ้าน: Net Worth / เงินสด / Runway / Burn ── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label={t('treasury.stat.netWorth', 'มูลค่าสุทธิ')} value={fmtUsd(data.netWorth.usd)} sub={`${fmtUsd(data.netWorth.assetsUsd)} ${t('treasury.stat.assets', 'สินทรัพย์')} + ${fmtUsd(data.netWorth.inventoryUsd)} ${t('treasury.stat.inventory', 'เสบียง')}`} tone="#D4AF37" />
                <Stat label={t('treasury.stat.liquidity', 'เงินสดสภาพคล่อง')} value={fmtUsd(data.netWorth.liquidCashUsd)} sub={`− ${fmtUsd(data.netWorth.liabilitiesUsd)} ${t('treasury.stat.liabilities', 'หนี้สิน')}`} />
                <Stat label={t('treasury.stat.runway', 'Survival Runway')} value={months == null ? '∞' : `${months.toFixed(1)} ${t('treasury.stat.months', 'เดือน')}`} sub={runwayWarnText} tone={runwayTone} />
                <Stat label={t('treasury.stat.monthlyBurn', 'ค่าใช้จ่ายต่อเดือน')} value={fmtUsd(data.cashflow.monthlyBurnUsd)} sub={`${t('treasury.stat.yield', 'รายได้ปันผลต่อปี')} ${fmtUsd(data.cashflow.annualizedDividendUsd)}`} />
              </div>

              {/* ── AI Portfolio Manager — Small-Cap signals ── */}
              <SignalsCard />

              {/* ── View A: Net Worth & Cashflow ── */}
              <Section id="net-worth" title={t('treasury.view.netWorthTitle', 'ทรัพย์สิน & กระแสเงินสด')} desc={t('treasury.view.netWorthDesc', 'เงินสด + สินทรัพย์ + เสบียง − หนี้สิน')}>
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={openSheet} className={BTN}><Icon name="edit" size={13} /> {t('treasury.sheet.title', 'แก้ไขงบดุล')}</button>
                  <button onClick={saveRunwaySnapshot} disabled={busy} className={BTN}><Icon name="save" size={13} /> {t('treasury.runway.snapshot', 'บันทึกสแนปชอต')}</button>
                  <span className="text-[10px] text-gray-600">{data.generatedAt ? t('treasury.page.generatedAt', 'อัปเดตล่าสุด {time}', { time: new Date(data.generatedAt).toLocaleString() }) : ''}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
                  <div className={`${TILE} p-3`}>
                    <div className="text-[10px] text-gray-500">{t('treasury.stat.liquidity', 'เงินสด')}</div>
                    <div className="mono text-base font-bold text-gray-100">{fmtUsd(data.netWorth.liquidCashUsd)}</div>
                  </div>
                  <div className={`${TILE} p-3`}>
                    <div className="text-[10px] text-gray-500">{t('treasury.stat.assets', 'สินทรัพย์')}</div>
                    <div className="mono text-base font-bold text-gray-100">{fmtUsd(data.netWorth.assetsUsd)}</div>
                  </div>
                  <div className={`${TILE} p-3`}>
                    <div className="text-[10px] text-gray-500">{t('treasury.stat.inventory', 'เสบียง')}</div>
                    <div className="mono text-base font-bold text-gray-100">{fmtUsd(data.netWorth.inventoryUsd)}</div>
                  </div>
                  <div className={`${TILE} p-3`}>
                    <div className="text-[10px] text-gray-500">{t('treasury.stat.liabilities', 'หนี้สิน')}</div>
                    <div className="mono text-base font-bold text-rose-300">−{fmtUsd(data.netWorth.liabilitiesUsd)}</div>
                  </div>
                  <div className={`${TILE} p-3 border-emerald-800/40`}>
                    <div className="text-[10px] text-emerald-500">{t('treasury.stat.netWorth', 'มูลค่าสุทธิ')}</div>
                    <div className="mono text-base font-bold text-emerald-300 glow-text">{fmtUsd(data.netWorth.usd)}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-[11px] text-gray-500 mono">
                  <span>{t('treasury.runway.burnCore', 'ค่าใช้จ่ายหลัก')} {fmtUsd(data.cashflow.coreBurnUsd)}</span>
                  <span>{t('treasury.runway.energyCost', 'ค่าไฟ')} {fmtUsd(data.cashflow.energyCostUsd)}</span>
                  <span>{t('treasury.runway.monthlyIncome', 'รายได้ประจำ')} {fmtUsd(data.cashflow.monthlyIncomeUsd)}</span>
                </div>
              </Section>

              {/* ── View B: Survival Runway — signature เส้นเชื้อไฟ ── */}
              <Section id="runway" title={t('treasury.view.runwayTitle', 'Survival Runway')} desc={t('treasury.view.runwayDesc', '(เงินสด + รายได้ปันผลรายปี) ÷ ค่าใช้จ่ายต่อเดือน')}>
                {runway && (
                  <FuseLine months={months} cashMonths={cashMonths} />
                )}
                <div className="mt-5 pt-3 border-t border-gray-800">
                  <div className="text-[10px] text-gray-500 tracking-wide uppercase mb-2">{t('treasury.runway.history', 'ประวัติเส้น Runway')}</div>
                  {runwayHistory.length === 0 ? (
                    <div className="text-xs text-gray-600">{t('treasury.runway.historyEmpty', 'ยังไม่มีสแนปชอต — กด "บันทึกสแนปชอต" ด้านบน')}</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {runwayHistory.slice(-10).map((s, i) => {
                        const tone = s.months < 6 ? '#E87A60' : s.months < 24 ? '#D4AF37' : '#7FB069';
                        return (
                          <span key={i} className={`${TILE} px-2.5 py-1 text-[11px] mono`} style={{ boxShadow: i === runwayHistory.length - 1 ? `0 0 10px ${tone}33` : undefined }}>
                            <span style={{ color: tone }}>{s.months.toFixed(1)}</span>
                            <span className="text-gray-600"> เดือน · {new Date(s.snapshotAt).toLocaleDateString()}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Section>

              {/* ── View C: กลยุทธ์ 5 ตระกูล + Matrix — Sankey แน่นแบบภาพ 1 ── */}
              <Section id="strategies" title={t('treasury.view.strategiesTitle', 'กลยุทธ์ลงทุน — 5 ตระกูล')} desc={t('treasury.view.strategiesDesc', 'จัดสรรพอร์ตตามตระกูลกลยุทธ์ — เส้นไหล Alluvial เขียว→แดง')}>
                <div className="bg-gray-950/40 border border-gray-800 rounded-xl p-2 mb-4 overflow-hidden">
                  <svg viewBox="0 0 520 92" className="w-full h-[92px]">
                    <text x="8" y="10" fill="#6b7889" fontSize="6" fontFamily="JetBrains Mono" letterSpacing="1">SOURCE · 5 FAMILIES</text>
                    <text x="256" y="10" textAnchor="middle" fill="#6b7889" fontSize="6" fontFamily="JetBrains Mono" letterSpacing="1">SOVEREIGN HUB</text>
                    <text x="512" y="10" textAnchor="end" fill="#6b7889" fontSize="6" fontFamily="JetBrains Mono" letterSpacing="1">ALLOCATION</text>
                    {data.strategies.allocation.map((a, i) => {
                      const h = Math.max(9, (a.pct / 100) * 52);
                      const y = 16 + i * 14;
                      const midY = 22 + i * 12;
                      const col = FAMILY_COLORS[a.family] || '#9CA3AF';
                      const midTop = 18 + i * 11;
                      const midBot = midTop + 7;
                      return (
                        <g key={a.family}>
                          <rect x="8" y={y} width="86" height={h} rx="3" fill={col} opacity="0.92" />
                          <text x="14" y={y + h / 2 + 2} fill="#0b0f16" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">{a.family.slice(0, 4)}</text>
                          <path d={`M 94 ${y + 2} C 150 ${y + 2}, 180 ${midTop}, 238 ${midTop} L 238 ${midBot} C 180 ${midBot}, 150 ${y + h - 2}, 94 ${y + h - 2} Z`} fill={col} opacity="0.22" />
                          <path d={`M 282 ${midTop} C 340 ${midTop}, 380 ${18 + (i % 3) * 22}, 408 ${18 + (i % 3) * 22} L 408 ${22 + (i % 3) * 22} C 380 ${22 + (i % 3) * 22}, 340 ${midBot}, 282 ${midBot} Z`} fill={col} opacity="0.14" />
                        </g>
                      );
                    })}
                    <rect x="238" y="16" width="44" height="52" rx="6" fill="rgba(52,211,153,0.12)" stroke="rgba(52,211,153,0.35)" strokeWidth="0.9" />
                    <text x="260" y="32" textAnchor="middle" fill="#34d399" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">HUB</text>
                    <text x="260" y="40" textAnchor="middle" fill="#9ca3af" fontSize="5.5" fontFamily="JetBrains Mono">{data.strategies.totalUsd > 60000 ? 'STABLE' : 'BUILD'}</text>
                    <text x="260" y="48" textAnchor="middle" fill="#6b7889" fontSize="5" fontFamily="JetBrains Mono">{data.positions.length} POS</text>
                    <rect x="408" y="14" width="68" height="22" rx="4" fill="rgba(52,211,153,0.12)" stroke="rgba(52,211,153,0.35)" strokeWidth="0.7" />
                    <text x="442" y="24" textAnchor="middle" fill="#34d399" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">GROWTH</text>
                    <rect x="408" y="46" width="68" height="22" rx="4" fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.35)" strokeWidth="0.7" />
                    <text x="442" y="56" textAnchor="middle" fill="#f59e0b" fontSize="6" fontWeight="700" fontFamily="JetBrains Mono">INCOME</text>
                    <rect x="408" y="78" width="68" height="10" rx="3" fill="rgba(239,68,68,0.10)" stroke="rgba(239,68,68,0.30)" strokeWidth="0.7" />
                    <text x="442" y="85" textAnchor="middle" fill="#f87171" fontSize="5" fontFamily="JetBrains Mono">5 FAMS</text>
                  </svg>
                </div>
                <div className="space-y-2">
                  {data.strategies.allocation.map((a) => (
                    <FamilyRow key={a.family} family={a.family} pct={a.pct} valueUsd={a.valueUsd} positions={a.positions} yieldPct={a.dividendYieldPct} />
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800 text-xs">
                  <span className="text-gray-500">{t('treasury.matrix.total', 'รวม')} {data.strategies.families.length} {t('treasury.matrix.positions', 'ตระกูล')}</span>
                  <span className="mono text-lg font-bold text-gray-100">{fmtUsd(data.strategies.totalUsd)}</span>
                </div>
              </Section>

              {/* ── สเตตเมนต์ Dime! ล่าสุด (ดึงอัตโนมัติจากอีเมล) ── */}
              {data.dime && (
                <Section id="dime" title={t('treasury.dime.title', 'สเตตเมนต์ Dime! ล่าสุด')} desc={t('treasury.dime.desc', 'ดึงจากอีเมลรายเดือนอัตโนมัติ — ยอดรวม / เงินสด / FX / ผลตอบแทน / สัดส่วน sector')}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className={`${TILE} p-3`}>
                      <div className="text-[10px] text-gray-500">{t('treasury.dime.totalBalance', 'มูลค่าลงทุนรวม')} · {data.dime.statementPeriod}</div>
                      <div className="mono text-base font-bold text-gray-100 glow-text">{fmtUsd(data.dime.totalBalanceUsd ?? 0)}</div>
                      <div className="text-[10px] text-gray-600 mono">≈ {fmtThb(data.dime.totalBalanceThb ?? 0)}</div>
                    </div>
                    <div className={`${TILE} p-3`}>
                      <div className="text-[10px] text-gray-500">{t('treasury.dime.cashBalance', 'ยอดเงินคงเหลือ')}</div>
                      <div className="mono text-base font-bold text-gray-100">{fmtUsd(data.dime.cashBalanceUsd ?? 0)}</div>
                      <div className="text-[10px] text-gray-600 mono">≈ {fmtThb(data.dime.cashBalanceThb ?? 0)}</div>
                    </div>
                    <div className={`${TILE} p-3`}>
                      <div className="text-[10px] text-gray-500">{t('treasury.dime.investmentReturn', 'ผลตอบแทนจากการลงทุน')}</div>
                      <div className="mono text-base font-bold" style={{ color: (data.dime.totalReturnPct ?? 0) < 0 ? '#F87171' : '#34D399' }}>
                        {(data.dime.totalReturnPct ?? 0) > 0 ? '+' : ''}{(data.dime.totalReturnPct ?? 0).toFixed(2)}%
                      </div>
                      <div className="text-[10px] text-gray-600 mono">{fmtUsd(data.dime.totalReturnUsd ?? 0)}</div>
                    </div>
                    <div className={`${TILE} p-3`}>
                      <div className="text-[10px] text-gray-500">{t('treasury.dime.fx', 'อัตราแลกเปลี่ยน')}</div>
                      <div className="mono text-base font-bold text-gray-100">1 USD = {(data.dime.fxRate ?? 0).toFixed(2)} THB</div>
                      <div className="text-[10px] text-gray-600 mono">{t('treasury.dime.account', 'บัญชี')} {data.dime.accountNo ?? '—'}</div>
                    </div>
                  </div>

                  {Array.isArray(data.dime.sectors) && data.dime.sectors.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] text-gray-500 tracking-wide uppercase">{t('treasury.dime.sectors', 'สัดส่วนการลงทุนจัดกลุ่มโดยกลุ่มอุตสาหกรรม')}</div>
                      {data.dime.sectors.map((s) => (
                        <div key={s.name} className="flex items-center gap-3">
                          <div className="w-36 shrink-0 text-xs text-gray-300 truncate">{s.name}</div>
                          <div className="flex-1 h-4 rounded bg-gray-900 overflow-hidden border border-gray-800">
                            <div className="h-full rounded-sm" style={{ width: `${Math.min(100, s.pct)}%`, background: 'linear-gradient(90deg, #D4AF3744, #D4AF37)', boxShadow: '0 0 8px #D4AF3744' }} />
                          </div>
                          <div className="w-24 text-right shrink-0">
                            <span className="mono text-sm text-gray-200">{fmtUsd(s.value_usd)}</span>
                            <span className="mono text-[10px] text-gray-500 ml-1.5">{s.pct.toFixed(2)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* ── Catalyst Watchlist + Income Feeds ── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Section id="catalysts" title={t('treasury.catalysts.title', 'Catalyst Watchlist')} desc={t('treasury.catalysts.desc', 'ตำแหน่งที่รอจุดเปลี่ยน')}>
                  {data.catalysts.length === 0 ? (
                    <div className="text-sm text-gray-600">{t('treasury.catalysts.empty', 'ยังไม่มี catalyst ในรายการเฝ้ารอ — เพิ่มตอนเปิดตำแหน่ง')}</div>
                  ) : (
                    <div className="space-y-2">
                      {data.catalysts.map((c) => (
                        <div key={c.id} className={`${TILE} p-3 flex items-start gap-2`}>
                          <span className="w-2 h-2 rounded-sm mt-1.5 shrink-0" style={{ background: FAMILY_COLORS[c.family] || '#9CA3AF' }} />
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-gray-200 mono">{c.symbol} <span className="text-[10px] font-normal text-gray-500">{t('treasury.families.' + c.family, c.family)}</span></div>
                            <div className="text-xs text-gray-400">{c.note}</div>
                          </div>
                          <span className="ml-auto text-xs text-gray-500 mono shrink-0">{fmtUsd(c.valueUsd)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <Section id="income" title={t('treasury.income.title', 'ฟีดรายได้ & กำไรรับรู้')} desc={t('treasury.income.dividend', 'ปันผล') + ' · ' + t('treasury.income.realized', 'กำไรรับรู้สะสม') + ': ' + fmtUsd(data.income.totalRealizedGainUsd)}>
                  {data.income.dividendStreams.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {data.income.dividendStreams.map((d) => (
                        <span key={d.id} className={`${TILE} px-3 py-1.5 text-xs`}>
                          <b className="mono text-emerald-300">{d.symbol}</b>
                          <span className="text-gray-500 ml-1.5">yield {d.yieldPct.toFixed(2)}% · {fmtUsd(d.annualEstimateUsd)}/ปี</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {data.income.events.length === 0 ? (
                    <div className="text-sm text-gray-600">{t('treasury.income.noEvents', 'ยังไม่มีรายการรายได้ — เริ่มจากขายทำกำไรหรือรับปันผล')}</div>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {data.income.events.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                            e.type === 'DIVIDEND' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50' :
                            e.type === 'REALIZED_GAIN' ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50' :
                            'bg-gray-900 text-gray-400 border border-gray-800'
                          }`}>{eventLabels[e.type] || e.type}</span>
                          <span className="mono text-gray-300 font-bold">{e.amount_usd > 0 ? '+' : ''}{fmtUsd(e.amount_usd)}</span>
                          <span className="text-gray-500 truncate flex-1">{e.note || (e.symbol ? e.symbol : '')}</span>
                          <span className="text-gray-600 ml-auto shrink-0">{new Date(e.created_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>

              {/* ── ตารางตำแหน่ง (Asset Positions) + CRUD ── */}
              <Section id="positions" title={t('treasury.positions.title', 'พอร์ตตำแหน่ง (Asset Positions)')} desc={t('treasury.positions.addNote', 'ระบุตระกูลกลยุทธ์ + ต้นทุน + yield + catalyst')}>
                <div className="mb-3">
                  <button onClick={() => { setEditingPos(null); setPosForm({ symbol: '', type: 'CRYPTO', quantity: '', wallet_address: '', avgCostUsd: '', expectedDividendYieldPct: '', strategyFamily: 'FUNDAMENTAL', catalystNote: '', notes: '' }); setModal('add'); }} className={BTN}>
                    <Icon name="plus" size={13} /> {t('treasury.positions.add', 'เพิ่มตำแหน่ง')}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wide">
                        <th className="pb-2">{t('treasury.positions.symbol', 'สัญลักษณ์')}</th>
                        <th className="pb-2">{t('treasury.positions.qty', 'จำนวน')}</th>
                        <th className="pb-2">{t('treasury.positions.avgCost', 'ต้นทุนเฉลี่ย')}</th>
                        <th className="pb-2">{t('treasury.positions.price', 'ราคา')}</th>
                        <th className="pb-2">{t('treasury.positions.value', 'มูลค่า')}</th>
                        <th className="pb-2">{t('treasury.positions.allocation', 'สัดส่วน')}</th>
                        <th className="pb-2">{t('treasury.positions.return', 'ผลตอบแทน')}</th>
                        <th className="pb-2">{t('treasury.positions.yield', 'Yield')}</th>
                        <th className="pb-2">{t('treasury.positions.family', 'ตระกูล')}</th>
                        <th className="pb-2">{t('treasury.positions.catalyst', 'Catalyst')}</th>
                        <th className="pb-2 text-right">{t('common.actions', 'จัดการ')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {data.positions.map((p) => (
                        <tr key={p.id} className="border-t border-gray-800/60">
                          <td className="py-2 font-bold mono text-gray-100">
                            {p.symbol} <span className="text-[9px] text-gray-600 font-normal">{p.type}</span>
                            {p.companyName && <div className="text-[9px] font-normal text-gray-500 truncate max-w-[140px]">{p.companyName}</div>}
                          </td>
                          <td className="py-2 mono text-gray-300">{fmtNum(p.quantity)}</td>
                          <td className="py-2 mono text-gray-400">{p.avgCostUsd != null ? fmtUsd(p.avgCostUsd) : '—'}</td>
                          <td className="py-2 mono text-gray-300">{p.priceUsd != null ? fmtUsd(p.priceUsd) : '—'}</td>
                          <td className="py-2 mono text-emerald-300">{fmtUsd(p.valueUsd)}</td>
                          <td className="py-2 mono text-gray-300">{p.allocationPct != null ? p.allocationPct.toFixed(2) + '%' : '—'}</td>
                          <td className="py-2 mono">
                            {p.totalReturnPct != null ? (
                              <span style={{ color: p.totalReturnPct < 0 ? '#F87171' : '#34D399' }}>
                                {p.totalReturnPct > 0 ? '+' : ''}{p.totalReturnPct.toFixed(2)}%
                                <span className="text-[9px] text-gray-600 ml-1">{fmtUsd(p.totalReturnUsd ?? 0)}</span>
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-2 mono text-amber-300/90">{p.expectedDividendYieldPct > 0 ? p.expectedDividendYieldPct.toFixed(2) + '%' : '—'}</td>
                          <td className="py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-sm" style={{ background: FAMILY_COLORS[p.strategyFamily] || '#9CA3AF' }} />
                              <span className="text-xs text-gray-400">{t('treasury.families.' + p.strategyFamily, p.strategyFamily)}</span>
                            </span>
                          </td>
                          <td className="py-2 text-xs text-gray-500 max-w-[180px] truncate">{p.catalystNote || '—'}</td>
                          <td className="py-2">
                            <div className="flex justify-end gap-1.5 text-[11px]">
                              <button onClick={() => { setEditingPos(p); setSellForm({ quantity: '', priceUsd: '', note: '' }); setModal('sell'); }} className="px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50">{t('treasury.positions.sell', 'ขาย')}</button>
                              <button onClick={() => { setEditingPos(p); setDivForm({ amountUsd: '', note: '' }); setModal('dividend'); }} className="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800/60 text-amber-300 hover:bg-amber-900/50">{t('treasury.positions.dividend', 'ปันผล')}</button>
                              <button onClick={() => openEdit(p)} className="px-2 py-0.5 rounded bg-gray-900 border border-gray-700 text-gray-400 hover:text-gray-200">{t('treasury.positions.edit', 'แก้ไข')}</button>
                              <button onClick={() => deletePosition(p)} className="px-2 py-0.5 rounded bg-rose-950/50 border border-rose-900/60 text-rose-300 hover:bg-rose-900/50">{t('common.delete', 'ลบ')}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {data.positions.length === 0 && (
                        <tr><td colSpan={11} className="py-4 text-gray-600 text-center text-sm">{t('treasury.positions.addNote', 'ยังไม่มีตำแหน่งในพอร์ต — กด "เพิ่มตำแหน่ง"')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* ── View D: โอนเงิน & ยืนยันการโอน (Ledger + bank verification) ── */}
              <Section id="transfers" title={t('treasury.transfers.title', 'โอนเงิน & ยืนยันการโอน')} desc={t('treasury.transfers.desc', 'สั่งโอน/รับเงินจริง → QR PromptPay → ยืนยันด้วย txid จากแอปธนาคาร → ledger อัปเดต')}>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <button onClick={() => { setTransferForm({ direction: 'OUT', category: 'BILL', amountUsd: '', amountThb: '', payee: '', bank: '', accountNumber: '', note: '' }); setModal('transfer'); }} className={BTN}>
                    <Icon name="plus" size={13} /> {t('treasury.transfers.create', 'สั่งโอน / บันทึกรายรับ')}
                  </button>
                  {!promptpayConfigured && (
                    <span className="text-[11px] text-amber-300/80 bg-amber-950/30 border border-amber-800/40 rounded px-2.5 py-1">
                      {t('treasury.transfers.qrDisabled', 'ยังไม่ตั้ง PROMPTPAY_TARGET บน server — สร้างคำสั่งได้ แต่ไม่มี QR')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className={`${TILE} p-3`}>
                    <div className="text-[10px] text-rose-400/80">{t('treasury.transfers.summaryOut', 'โอนออกเดือนนี้')}</div>
                    <div className="mono text-base font-bold text-rose-300 mt-0.5">{fmtUsd(outMonth)}</div>
                  </div>
                  <div className={`${TILE} p-3`}>
                    <div className="text-[10px] text-emerald-400/80">{t('treasury.transfers.summaryIn', 'โอนเข้าเดือนนี้')}</div>
                    <div className="mono text-base font-bold text-emerald-300 mt-0.5">{fmtUsd(inMonth)}</div>
                  </div>
                  <div className={`${TILE} p-3`}>
                    <div className="text-[10px] text-amber-300/80">{t('treasury.transfers.summaryPending', 'รอโอนจริง')}</div>
                    <div className="mono text-base font-bold text-amber-300 mt-0.5">{pendingCount} {t('treasury.stat.months', 'รายการ')}</div>
                  </div>
                </div>

                {transfers.length === 0 ? (
                  <div className="text-sm text-gray-600">{t('treasury.transfers.empty', 'ยังไม่มีคำสั่งโอน')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wide">
                          <th className="pb-2">{t('treasury.transfers.direction', 'ทิศทาง')}</th>
                          <th className="pb-2">{t('treasury.transfers.ref', 'เลขที่')}</th>
                          <th className="pb-2">{t('common.actions', 'หมวด')}</th>
                          <th className="pb-2">{t('treasury.stat.months', 'ยอด')}</th>
                          <th className="pb-2">{t('treasury.positions.note', 'ผู้รับ/บันทึก')}</th>
                          <th className="pb-2">txid</th>
                          <th className="pb-2">{t('treasury.positions.type', 'สถานะ')}</th>
                          <th className="pb-2 text-right">{t('common.actions', 'จัดการ')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/50">
                        {transfers.map((tr) => (
                          <tr key={tr.id} className="border-t border-gray-800/60">
                            <td className="py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                tr.direction === 'IN' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50' : 'bg-rose-950/50 text-rose-300 border border-rose-900/50'
                              }`}>{t(tr.direction === 'IN' ? 'treasury.transfers.in' : 'treasury.transfers.out', tr.direction === 'IN' ? 'โอนเข้า' : 'โอนออก')}</span>
                            </td>
                            <td className="py-2 mono text-[11px] text-gray-300">{tr.refCode}</td>
                            <td className="py-2 text-xs text-gray-400">{tr.category}</td>
                            <td className="py-2 mono text-gray-200">
                              {fmtUsd(tr.amountUsd)}
                              {tr.amountThb != null && <span className="text-gray-600 text-[10px] ml-1">· {fmtNum(tr.amountThb)}฿</span>}
                            </td>
                            <td className="py-2 text-xs text-gray-500 max-w-[200px] truncate">
                              <span className="flex items-center gap-2">
                                <span className="truncate">{tr.payee || tr.note || '—'}</span>
                                {tr.evidenceUrl && (
                                  <img
                                    src={tr.evidenceUrl}
                                    alt={t('treasury.transfers.slip', 'สลิป')}
                                    title={t('treasury.transfers.slipOpen', 'เปิดภาพ')}
                                    className="w-7 h-7 rounded object-cover border border-gray-700 cursor-pointer hover:opacity-80 shrink-0"
                                    onClick={() => window.open(tr.evidenceUrl!, '_blank')}
                                  />
                                )}
                              </span>
                            </td>
                            <td className="py-2 mono text-[11px] text-gray-500">{tr.txid || '—'}</td>
                            <td className="py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                tr.status === 'VERIFIED' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50' :
                                tr.status === 'PENDING' ? 'bg-amber-950/50 text-amber-300 border border-amber-800/50' :
                                'bg-gray-900 text-gray-500 border border-gray-800'
                              }`}>{t('treasury.transfers.status' + tr.status, tr.status)}</span>
                            </td>
                            <td className="py-2">
                              <div className="flex justify-end gap-1.5 text-[11px]">
                                {tr.status === 'PENDING' && (
                                  <>
                                    <button onClick={() => openConfirmTransfer(tr)} className="px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50">{t('treasury.transfers.confirmAction', 'ยืนยัน')}</button>
                                    <button onClick={() => { setSlipTarget(tr); setSlipFile(null); setModal('slip'); }} className="px-2 py-0.5 rounded bg-sky-950/50 border border-sky-800/60 text-sky-300 hover:bg-sky-900/50">{t('treasury.transfers.slip', 'สลิป')}</button>
                                    <button onClick={() => doCancelTransfer(tr)} className="px-2 py-0.5 rounded bg-gray-900 border border-gray-700 text-gray-400 hover:text-gray-200">{t('treasury.transfers.cancel', 'ยกเลิก')}</button>
                                  </>
                                )}
                                {tr.qrPayload && tr.status === 'PENDING' && (
                                  <button onClick={() => setQrOrder(tr)} className="px-2 py-0.5 rounded bg-sky-950/50 border border-sky-800/60 text-sky-300 hover:bg-sky-900/50">QR</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}
        </main>
      </div>

      {/* ═══════ Modal: แก้ไขงบดุล ═══════ */}
      {modal === 'sheet' && modalFrame(t('treasury.sheet.title', 'แก้ไขงบดุล'), saveSheet, (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">{t('treasury.sheet.liquidCash', 'เงินสด (USD)')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={sheetForm.liquidCashUsd} onChange={(e) => setSheetForm({ ...sheetForm, liquidCashUsd: e.target.value })} />
          </label>
          <label className="text-xs text-gray-400">{t('treasury.stat.liabilities', 'หนี้สิน')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={sheetForm.liabilitiesUsd} onChange={(e) => setSheetForm({ ...sheetForm, liabilitiesUsd: e.target.value })} />
          </label>
          <label className="text-xs text-gray-400">{t('treasury.runway.burnCore', 'ค่าใช้จ่ายหลัก/เดือน')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={sheetForm.monthlyBurnUsd} onChange={(e) => setSheetForm({ ...sheetForm, monthlyBurnUsd: e.target.value })} />
          </label>
          <label className="text-xs text-gray-400">{t('treasury.runway.monthlyIncome', 'รายได้ประจำ/เดือน')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={sheetForm.monthlyIncomeUsd} onChange={(e) => setSheetForm({ ...sheetForm, monthlyIncomeUsd: e.target.value })} />
          </label>
          <label className="col-span-2 text-xs text-gray-400">{t('treasury.sheet.adjustCash', 'ฝาก/ถอนเงินสด (+/−)')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={sheetForm.adjustCashUsd} onChange={(e) => setSheetForm({ ...sheetForm, adjustCashUsd: e.target.value })} placeholder={t('treasury.sheet.adjustHint', 'ใช้ฝาก/ถอนบัญชีจริง')} />
          </label>
          <label className="col-span-2 text-xs text-gray-400">{t('treasury.sheet.adjustNote', 'หมายเหตุปรับเงินสด')}
            <input className={`${INPUT} w-full mt-1`} value={sheetForm.adjustNote} onChange={(e) => setSheetForm({ ...sheetForm, adjustNote: e.target.value })} />
          </label>
        </div>
      ))}

      {/* ═══════ Modal: เพิ่ม / แก้ไขตำแหน่ง ═══════ */}
      {(modal === 'add' || modal === 'edit') && modalFrame(
        editingPos ? t('treasury.positions.editTitle', 'แก้ไขตำแหน่ง') : t('treasury.positions.addTitle', 'เปิดตำแหน่งลงทุนใหม่'),
        savePosition,
        (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-400 col-span-1">{t('treasury.positions.symbol', 'สัญลักษณ์')}
              <input className={`${INPUT} w-full mt-1`} value={posForm.symbol} onChange={(e) => setPosForm({ ...posForm, symbol: e.target.value })} placeholder="BTC / AAPL / XAUUSD" disabled={!!editingPos} />
            </label>
            <label className="text-xs text-gray-400">{t('treasury.positions.type', 'ชนิด')}
              <select className={`${INPUT} w-full mt-1`} value={posForm.type} onChange={(e) => setPosForm({ ...posForm, type: e.target.value })} disabled={!!editingPos}>
                <option>CRYPTO</option><option>STOCK</option><option>COMMODITY</option>
              </select>
            </label>
            <label className="text-xs text-gray-400">{t('treasury.positions.qty', 'จำนวน')}
              <input className={`${INPUT} w-full mt-1`} type="number" value={posForm.quantity} onChange={(e) => setPosForm({ ...posForm, quantity: e.target.value })} />
            </label>
            <label className="text-xs text-gray-400">{t('treasury.positions.avgCost', 'ต้นทุนเฉลี่ย (USD)')}
              <input className={`${INPUT} w-full mt-1`} type="number" value={posForm.avgCostUsd} onChange={(e) => setPosForm({ ...posForm, avgCostUsd: e.target.value })} />
            </label>
            <label className="text-xs text-gray-400">{t('treasury.positions.yield', 'Yield (%)')}
              <input className={`${INPUT} w-full mt-1`} type="number" value={posForm.expectedDividendYieldPct} onChange={(e) => setPosForm({ ...posForm, expectedDividendYieldPct: e.target.value })} />
            </label>
            <label className="text-xs text-gray-400">{t('treasury.positions.family', 'ตระกูล')}
              <select className={`${INPUT} w-full mt-1`} value={posForm.strategyFamily} onChange={(e) => setPosForm({ ...posForm, strategyFamily: e.target.value })}>
                {data?.strategies.families.map((f) => <option key={f} value={f}>{t('treasury.families.' + f, f)}</option>)}
              </select>
            </label>
            <label className="col-span-2 text-xs text-gray-400">{t('treasury.positions.catalyst', 'Catalyst (จุดเปลี่ยนที่รอ)')}
              <input className={`${INPUT} w-full mt-1`} value={posForm.catalystNote} onChange={(e) => setPosForm({ ...posForm, catalystNote: e.target.value })} placeholder="เช่น ETF approval, earnings beat, halving" />
            </label>
            <label className="col-span-2 text-xs text-gray-400">{t('treasury.positions.note', 'บันทึก')}
              <input className={`${INPUT} w-full mt-1`} value={posForm.notes} onChange={(e) => setPosForm({ ...posForm, notes: e.target.value })} />
            </label>
          </div>
        )
      )}

      {/* ═══════ Modal: ขาย ═══════ */}
      {modal === 'sell' && editingPos && modalFrame(`${t('treasury.positions.sell', 'ขาย')} ${editingPos.symbol}`, doSell, (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">{t('treasury.positions.sellQty', 'จำนวนที่ขาย')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={sellForm.quantity} onChange={(e) => setSellForm({ ...sellForm, quantity: e.target.value })} placeholder={`${fmtNum(editingPos.quantity)} ${t('treasury.positions.qty', 'จำนวน')}`} />
          </label>
          <label className="text-xs text-gray-400">{t('treasury.positions.salePrice', 'ราคาขาย (USD)')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={sellForm.priceUsd} onChange={(e) => setSellForm({ ...sellForm, priceUsd: e.target.value })} />
          </label>
          <label className="col-span-2 text-xs text-gray-400">{t('treasury.positions.note', 'บันทึก')}
            <input className={`${INPUT} w-full mt-1`} value={sellForm.note} onChange={(e) => setSellForm({ ...sellForm, note: e.target.value })} />
          </label>
        </div>
      ))}

      {/* ═══════ Modal: ปันผล ═══════ */}
      {modal === 'dividend' && editingPos && modalFrame(`${t('treasury.positions.dividend', 'ปันผล')} ${editingPos.symbol}`, doDividend, (
        <div className="grid grid-cols-1 gap-3">
          <label className="text-xs text-gray-400">{t('treasury.positions.divAmount', 'จำนวนปันผล (USD)')}
            <input className={`${INPUT} w-full mt-1`} type="number" value={divForm.amountUsd} onChange={(e) => setDivForm({ ...divForm, amountUsd: e.target.value })} />
          </label>
          <label className="text-xs text-gray-400">{t('treasury.positions.note', 'บันทึก')}
            <input className={`${INPUT} w-full mt-1`} value={divForm.note} onChange={(e) => setDivForm({ ...divForm, note: e.target.value })} />
          </label>
        </div>
      ))}

      {/* ═══════ Modal: สร้างคำสั่งโอน ═══════ */}
      {modal === 'transfer' && modalFrame(t('treasury.transfers.createTitle', 'สร้างคำสั่งโอน'), doCreateTransfer, (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400 col-span-2">{t('treasury.transfers.direction', 'ทิศทาง')}
            <div className="flex gap-2 mt-1">
              {(['OUT', 'IN'] as const).map((d) => (
                <button key={d} onClick={() => setTransferForm({ ...transferForm, direction: d })} className={`flex-1 px-3 py-1.5 rounded-lg text-sm border transition-all ${
                  transferForm.direction === d
                    ? (d === 'OUT' ? 'bg-rose-950/40 border-rose-700/70 text-rose-200' : 'bg-emerald-950/40 border-emerald-700/70 text-emerald-200')
                    : 'bg-gray-950 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}>
                  {t(d === 'OUT' ? 'treasury.transfers.out' : 'treasury.transfers.in', d === 'OUT' ? 'โอนออก (จ่าย)' : 'โอนเข้า (รับ)')}
                </button>
              ))}
            </div>
          </label>
          <label className="text-xs text-gray-400">{t('treasury.transfers.category', 'หมวด')}
            <select className={`${INPUT} w-full mt-1`} value={transferForm.category} onChange={(e) => setTransferForm({ ...transferForm, category: e.target.value })}>
              {TRANSFER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-400">{t('treasury.transfers.amountUsd', 'ยอด (USD)')} *
            <input className={`${INPUT} w-full mt-1`} type="number" min="0" value={transferForm.amountUsd} onChange={(e) => setTransferForm({ ...transferForm, amountUsd: e.target.value })} />
          </label>
          <label className="col-span-2 text-xs text-gray-400">{t('treasury.transfers.amountThb', 'ยอด (บาท — สำหรับ QR)')}
            <input className={`${INPUT} w-full mt-1`} type="number" min="0" value={transferForm.amountThb} onChange={(e) => setTransferForm({ ...transferForm, amountThb: e.target.value })} placeholder={t('treasury.transfers.amountThbHint', 'ไม่ระบุ → ใช้แปลงอัตโนมัติ')} />
          </label>
          <label className="col-span-2 text-xs text-gray-400">{t('treasury.transfers.payee', 'ผู้รับ (จ่ายออก) / ผู้จ่าย (รับเข้า)')}
            <input className={`${INPUT} w-full mt-1`} value={transferForm.payee} onChange={(e) => setTransferForm({ ...transferForm, payee: e.target.value })} />
          </label>
          <label className="text-xs text-gray-400">{t('treasury.transfers.bank', 'ธนาคาร')}
            <input className={`${INPUT} w-full mt-1`} value={transferForm.bank} onChange={(e) => setTransferForm({ ...transferForm, bank: e.target.value })} />
          </label>
          <label className="text-xs text-gray-400">{t('treasury.transfers.accountNumber', 'เลขบัญชี')}
            <input className={`${INPUT} w-full mt-1`} value={transferForm.accountNumber} onChange={(e) => setTransferForm({ ...transferForm, accountNumber: e.target.value })} />
          </label>
          <label className="col-span-2 text-xs text-gray-400">{t('treasury.positions.note', 'บันทึก')}
            <input className={`${INPUT} w-full mt-1`} value={transferForm.note} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} />
          </label>
        </div>
      ))}

      {/* ═══════ Modal: QR PromptPay ═══════ */}
      {modal === 'qr' && qrOrder && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => setModal(null)}>
          <div className={`${PANEL} w-full max-w-sm p-5 panel-glow text-center`} onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-100 mb-1">{t('treasury.transfers.qrTitle', 'QR PromptPay — {ref}', { ref: qrOrder.refCode })}</h3>
            {qrOrder.amountThb != null && <p className="text-[11px] text-gray-500 mb-3">{t('treasury.transfers.qrAmount', 'ยอด {thb} บาท', { thb: fmtNum(qrOrder.amountThb) })}</p>}
            {qrOrder.qrPayload ? (
              <>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrOrder.qrPayload)}`}
                  alt="PromptPay QR"
                  width={240} height={240}
                  className="mx-auto rounded-lg border border-gray-800"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                />
                <p className="text-[11px] text-gray-500 mt-3">{t('treasury.transfers.qrScan', 'สแกนด้วยแอปธนาคาร แล้วโอนตามยอดนี้')}</p>
                <button
                  onClick={() => { navigator.clipboard?.writeText(qrOrder.qrPayload!); flash(t('treasury.transfers.qrCopied', 'คัดลอกแล้ว')); }}
                  className="mt-2 px-3 py-1.5 rounded-lg text-xs bg-gray-900 border border-gray-700 text-gray-300 hover:text-gray-100"
                >{t('treasury.transfers.qrCopy', 'คัดลอก payload')}</button>
                <details className="mt-3 text-left">
                  <summary className="text-[11px] text-gray-500 cursor-pointer">{t('treasury.transfers.qrFallback', 'เปิดสแกนเนอร์ QR ในแอปธนาคารไม่ได้?')}</summary>
                  <p className="text-[10px] text-gray-600 break-all mono font-sans mt-2">{qrOrder.qrPayload}</p>
                </details>
              </>
            ) : (
              <p className="text-sm text-amber-300/90 bg-amber-950/30 border border-amber-800/40 rounded px-3 py-2">
                {t('treasury.transfers.qrDisabled', 'ยังไม่ตั้ง PROMPTPAY_TARGET บน server — สร้างคำสั่งได้ แต่ไม่มี QR (โอนด้วยวิธีปกติ แล้วยืนยันด้วย txid)')}
              </p>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModal(null)} className="px-4 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200">{t('common.close', 'ปิด')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ Modal: อัปโหลดสลิป ═══════ */}
      {modal === 'slip' && slipTarget && modalFrame(t('treasury.transfers.slipTitle', 'สลิปหลักฐาน — {ref}', { ref: slipTarget.refCode }), doUploadSlip, (
        <div className="grid grid-cols-1 gap-3">
          {slipTarget.evidenceUrl && (
            <img src={slipTarget.evidenceUrl} alt={t('treasury.transfers.slip', 'สลิป')} className="max-h-56 rounded-lg border border-gray-800 object-contain mx-auto" />
          )}
          <p className="text-[11px] text-gray-500">{t('treasury.transfers.slipUploadHint', 'ภาพจากแอปธนาคาร (jpg/png ≤ 2MB) — แนบก่อนกดยืนยัน')}</p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff"
            onChange={(e) => setSlipFile(e.target.files?.[0] || null)}
            className="text-xs text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-gray-700 file:bg-gray-900 file:text-gray-300 file:cursor-pointer"
          />
          {slipFile && <p className="text-[11px] text-emerald-400 mono">{slipFile.name} · {(slipFile.size / 1024).toFixed(0)} KB</p>}
        </div>
      ))}

      {/* ═══════ Modal: ยืนยันการโอน ═══════ */}
      {modal === 'confirmTransfer' && confirmTransferId && (() => {
        const tr = transfers.find((x) => x.id === confirmTransferId);
        if (!tr) return null;
        return modalFrame(t('treasury.transfers.confirmTitle', 'ยืนยัน {ref}', { ref: tr.refCode }), doConfirmTransfer, (
          <div className="grid grid-cols-1 gap-3">
            <div className={`${TILE} p-3 text-xs text-gray-300`}>
              <span className="mono font-bold text-gray-100">{fmtUsd(tr.amountUsd)}</span>
              {' · '}
              <span className={tr.direction === 'IN' ? 'text-emerald-300' : 'text-rose-300'}>
                {t(tr.direction === 'IN' ? 'treasury.transfers.in' : 'treasury.transfers.out', tr.direction === 'IN' ? 'โอนเข้า' : 'โอนออก')}
              </span>
              {tr.payee && <span className="text-gray-500"> · {tr.payee}</span>}
              {tr.amountThb != null && <span className="text-gray-500"> · {fmtNum(tr.amountThb)}฿</span>}
            </div>
            <p className="text-[11px] text-gray-500">{t('treasury.transfers.confirmHint', 'เช็คในแอปธนาคารว่าโอนสำเร็จแล้ว — แล้วกรอกเลขสลิปเพื่อปิดคำสั่ง')}</p>
            <label className="text-xs text-gray-400">{t('treasury.transfers.txid', 'เลขอ้างอิงธนาคาร (txid)')} *
              <input className={`${INPUT} w-full mt-1`} value={confirmForm.txid} onChange={(e) => setConfirmForm({ ...confirmForm, txid: e.target.value })} placeholder={t('treasury.transfers.txidHint', 'จากสลิป/แอปธนาคาร')} />
            </label>
          </div>
        ));
      })()}
    </div>
  );
}