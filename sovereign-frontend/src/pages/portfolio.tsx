"use client";
// Sovereign Wealth — ห้องคลัง (Treasury Room): ห้องนิรภัยเย็น + ทองแท่งแข็ง
// Signature: กองแท่งทอง — ความสูง = มูลค่ารวม, เส้นประ = ยอดเดือนก่อน (ทองนิ่ง ไม่ริบหรี่ — ต่างจากเทียนของห้องเยียวยา)
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import Icon from '../components/ui/Icon';

// ── จานสีห้องคลัง (เหล็กกล้า + ทองแท่ง — เย็น ไม่ใช่เทียนอุ่นของห้องเยียวยา): พื้น #0D0F0E · เหล็ก #141718 · ทอง #D4AF37 · หมึกสมุด #E8E2D5 · กำไร #7FB069 · ขาดทุน #C2574A ──
const PANEL = 'bg-[#141718] border border-[#262B2C] rounded-xl';
const TILE = 'bg-[#0D0F0E]/80 border border-[#262B2C] rounded-lg';
const INPUT = 'bg-[#0D0F0E] border border-[#3A4042] rounded-lg px-3 py-1.5 text-sm text-[#E8E2D5] placeholder-[#6E7368] focus:outline-none focus:ring-1 focus:ring-[#D4AF37]';
const BTN = 'px-4 py-1.5 bg-[#D4AF37] text-[#14100A] hover:bg-[#F0D060] disabled:opacity-50 rounded-lg text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D4AF37]';

const fmtUsd = (n: number) => '$' + (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

interface Runway {
  months: number | null;
  monthlyBurnUsd: number;
  energyCostUsd: number;
}

interface Summary {
  portfolioUsd: number;
  inventoryUsd: number;
  grandTotalUsd: number;
  cashUsd: number;
  runway: Runway;
  missingPrices: string[];
  history: { timestamp: string; totalUsd: number }[];
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unit_price_usd: number;
  notes: string | null;
}

interface AssetRow {
  id: string;
  symbol: string;
  type: string;
  quantity: number;
  priceUsd: number | null;
  valueUsd: number;
  wallet_address: string | null;
}

// ── กองแท่งทอง — 1 แท่ง = $25,000, สูงสุด 10 แท่ง, เส้นประ = ยอดเดือนก่อน ──
function IngotStack({ value, baseline }: { value: number; baseline: number | null }) {
  const t = useLanguageStore((s) => s.t);
  const INGOT = 25000;
  const slots = 10;
  const pct = Math.min(1, value / (INGOT * slots));
  const full = Math.floor(pct * slots);
  const partial = Math.max(0, pct * slots - full);
  const bpct = baseline && baseline > 0 ? Math.min(1, baseline / (INGOT * slots)) : null;
  const slotH = 22;
  const gap = 4;
  const base = 262;
  const step = slotH + gap;
  const yOf = (i: number) => base - i * step - slotH;

  return (
    <svg viewBox="0 0 200 290" className="w-36 sm:w-44 drop-shadow-[0_0_20px_rgba(212,175,55,0.14)]" role="img" aria-label={value >= 1 ? t('portfolio.ingot.ariaFull', 'กองแท่งทอง {n} แท่งเต็ม', { n: full }) : t('portfolio.ingot.ariaEmpty', 'ตู้นิรภัยว่างเปล่า')}>
      <defs>
        <radialGradient id="vaultLight" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#D4AF37" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ingotGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F0D060" />
          <stop offset="45%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#9A7B26" />
        </linearGradient>
        <linearGradient id="ingotDim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3A4042" />
          <stop offset="100%" stopColor="#202425" />
        </linearGradient>
      </defs>
      <rect x="10" y="20" width="180" height="240" rx="14" fill="url(#vaultLight)" />
      {/* เส้นประ = ยอดเดือนก่อน */}
      {bpct !== null && (
        <g>
          <line x1="34" y1={yOf(bpct * slots) + slotH / 2} x2="166" y2={yOf(bpct * slots) + slotH / 2} stroke="#8C9188" strokeWidth="1.4" strokeDasharray="5 4" />
          <text x="168" y={yOf(bpct * slots) + slotH / 2 - 4} fontSize="8" fill="#8C9188" textAnchor="end">{t('portfolio.ingot.prevMonth', 'เดือนก่อน')}</text>
        </g>
      )}
      {/* ช่องแท่ง */}
      {Array.from({ length: slots }).map((_, i) => {
        const filled = i < full;
        const partialH = i === full ? slotH * partial : 0;
        const y = yOf(i);
        const h = filled ? slotH : partialH > 1 ? partialH : 0;
        if (h <= 0) return null;
        return (
          <g key={i}>
            <rect x="52" y={y + (slotH - h)} width="96" height={h} rx="4" fill={filled || partialH > 1 ? 'url(#ingotGold)' : 'url(#ingotDim)'} />
            {h > 6 && <rect x="66" y={y + (slotH - h) + 5} width="68" height="3" rx="1.5" fill="#FFF3C4" opacity="0.5" />}
            <rect x="56" y={y + (slotH - h)} width="88" height="2.5" rx="1.25" fill="#F0D060" opacity="0.8" />
          </g>
        );
      })}
      {full === 0 && partial <= 0.04 && (
        <text x="100" y="150" fontSize="11" fill="#6E7368" textAnchor="middle" className="font-ledger">{t('portfolio.ingot.empty', 'ตู้นิรภัยว่าง')}</text>
      )}
      {/* พื้นห้องนิรภัย */}
      <rect x="28" y={base + 6} width="144" height="5" rx="2" fill="#262B2C" />
    </svg>
  );
}

// ── พอร์ตแยกต่อคน — สมาชิกในครอบครัวแต่ละคนมีพอร์ตของตัวเอง ──
interface Member {
  id: string;
  username: string;
  role: string;
}

export default function PortfolioPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const isSuperadmin = user?.role === 'SUPERADMIN';
  const [members, setMembers] = useState<Member[]>([]);
  // พอร์ตที่กำลังดู: default = ตัวเอง; SUPERADMIN เปลี่ยนดูพอร์ตสมาชิกคนอื่นได้
  const [viewOwnerId, setViewOwnerId] = useState<string>('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({ symbol: '', type: 'CRYPTO', quantity: '0' });
  const [invForm, setInvForm] = useState({ name: '', category: 'OTHER', quantity: '', unit: 'ชิ้น', unit_price_usd: '', notes: '' });
  const [invSaving, setInvSaving] = useState(false);

  // ── Aladdin Risk Engine ──
  const [risk, setRisk] = useState<any>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState('');
  const loadRisk = async () => {
    setRiskLoading(true);
    setRiskError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/risk${ownerQuery}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || t('portfolio.riskError', 'คำนวณความเสี่ยงไม่สำเร็จ'));
      setRisk(d);
    } catch (e: any) {
      setRiskError(e.message);
    } finally {
      setRiskLoading(false);
    }
  };

  // ค่า ?userId= — สมาชิกทั่วไปจะถูก backend บังคับเป็นพอร์ตตัวเองเสมอ (ส่งไปด้วยก็ไม่เสียหาย)
  const ownerQuery = viewOwnerId ? `?userId=${encodeURIComponent(viewOwnerId)}` : '';

  // SUPERADMIN: โหลดรายชื่อสมาชิกเพื่อสลับดูพอร์ต
  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !user || !isSuperadmin) return;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/users`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Member[]) => setMembers(list))
      .catch(() => setMembers([]));
    // default ดูพอร์ตตัวเอง
    setViewOwnerId(user.id);
  }, [isHydrated, isAuthenticated, user, isSuperadmin]);

  const load = async () => {
    const [sumRes, invRes] = await Promise.all([
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/summary${ownerQuery}`),
      authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/inventory${ownerQuery}`),
    ]);
    setSummary(await sumRes.json());
    const inv = await invRes.json();
    setInventory(inv.items || []);
    const assetsRes = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/assets${ownerQuery}`);
    const assetsData = await assetsRes.json();
    setAssets(assetsData.assets || []);
  };

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (isSuperadmin && !viewOwnerId) return; // ยังไม่ได้เลือกพอร์ต
    setLoading(true);
    load()
      .catch((err) => {
        console.error(err);
        setError(t('portfolio.loadError', 'โหลดข้อมูลพอร์ตไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'));
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, user, viewOwnerId]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/refresh`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || t('portfolio.refreshError', 'รีเฟรชราคาไม่สำเร็จ'));
      } else {
        await load();
      }
    } catch (err) {
      console.error(err);
      setError(t('portfolio.refreshErrorNet', 'รีเฟรชราคาไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ต'));
    } finally {
      setRefreshing(false);
    }
  };

  const addAsset = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/assets${ownerQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, quantity: Number(form.quantity) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || t('portfolio.addAssetError', 'เพิ่ม asset ไม่สำเร็จ'));
        return;
      }
      setError('');
      setForm({ symbol: '', type: 'CRYPTO', quantity: '0' });
      await load();
    } catch (err) {
      console.error(err);
      setError(t('portfolio.addAssetErrorNet', 'เพิ่ม asset ไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'));
    }
  };

  const deleteAsset = async (id: string) => {
    if (!id) return;
    if (!confirm(t('portfolio.deleteAssetConfirm', 'ลบ asset นี้? (กระทบพอร์ตทันที)'))) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/assets/${id}${ownerQuery}`, { method: 'DELETE' });
    await load();
  };

  // ── เสบียงกายภาพ: เพิ่ม / ลบ (backend มี DELETE แล้ว) ──
  const addInventory = async () => {
    const quantity = Number(invForm.quantity);
    const unit_price_usd = Number(invForm.unit_price_usd);
    if (!invForm.name.trim() || !(quantity >= 0) || !(unit_price_usd >= 0)) {
      setError(t('portfolio.invFormError', 'กรอกชื่อ จำนวน และราคาต่อหน่วยให้ครบ'));
      return;
    }
    setInvSaving(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/inventory${ownerQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: invForm.name.trim(),
          category: invForm.category,
          quantity,
          unit: invForm.unit.trim() || 'ชิ้น',
          unit_price_usd,
          notes: invForm.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || t('portfolio.addInvError', 'เพิ่มเสบียงไม่สำเร็จ'));
        return;
      }
      setError('');
      setInvForm({ name: '', category: 'OTHER', quantity: '', unit: 'ชิ้น', unit_price_usd: '', notes: '' });
      await load();
    } catch (err) {
      console.error(err);
      setError(t('portfolio.addInvErrorNet', 'เพิ่มเสบียงไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'));
    } finally {
      setInvSaving(false);
    }
  };

  const deleteInventory = async (id: string) => {
    if (!id) return;
    if (!confirm(t('portfolio.deleteInvConfirm', 'ลบรายการเสบียงนี้? (ห้ามกู้คืน)'))) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/portfolio/inventory/${id}${ownerQuery}`, { method: 'DELETE' });
      setError('');
      await load();
    } catch (err) {
      console.error(err);
      setError(t('portfolio.deleteInvError', 'ลบเสบียงไม่สำเร็จ — ตรวจว่า backend เปิดอยู่'));
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('portfolio.unauthorized', 'Unauthorized')}</div>;

  const categoryIcons: Record<string, string> = {
    FUEL: 'zap', FOOD: 'package', MATERIAL: 'layers', PRECIOUS_METAL: 'coin', OTHER: 'package',
  };

  // ── กองทอง: มูลค่ารวม + เส้นประเดือนก่อน (จาก history จุดเก่าสุดของ 30 จุด) ──
  const value = summary?.grandTotalUsd ?? 0;
  const hist = summary?.history ?? [];
  const baseline = hist.length > 0 ? hist[hist.length - 1]?.totalUsd ?? null : null;
  const latestHis = hist.length > 0 ? hist[0]?.totalUsd ?? null : null;
  const growthPct = baseline && baseline > 0 && latestHis != null ? ((latestHis - baseline) / baseline) * 100 : null;
  const ingotFull = Math.floor(value / 25000);
  // กองทองสูงสุดที่วาดได้ 10 แท่ง — เกินกว่านั้น caption ต้องไม่บอกจำนวนเกินจริง
  const ingotLabel = ingotFull > 10 ? '10+' : String(ingotFull);
  const growthTail = growthPct != null ? t('portfolio.stack.growthTail', ' — {dir} {pct}% เทียบเดือนก่อน', { dir: growthPct >= 0 ? t('portfolio.stack.up', 'สูงขึ้น') : t('portfolio.stack.down', 'ลดลง'), pct: Math.abs(growthPct).toFixed(1) }) : '';
  const stackCaption = value < 1
    ? t('portfolio.stack.empty', 'ตู้นิรภัยว่างเปล่า — เริ่มสะสมทรัพย์สิน')
    : ingotFull === 0
      ? t('portfolio.stack.starting', 'กองทองเริ่มก่อ — {amount}{tail}', { amount: fmtUsd(value), tail: growthTail })
      : t('portfolio.stack.full', 'กองทอง {bars} แท่ง · {amount}{tail}', { bars: ingotLabel, amount: fmtUsd(value), tail: growthTail });

  const ledgerRows: Array<{ label: string; value: string; tone?: 'gold' | 'plain' }> = [
    { label: t('portfolio.ledger.portfolio', 'พอร์ตการลงทุน'), value: fmtUsd(summary?.portfolioUsd ?? 0) },
    { label: t('portfolio.ledger.inventory', 'เสบียงกายภาพ'), value: fmtUsd(summary?.inventoryUsd ?? 0) },
    { label: t('portfolio.ledger.cash', 'เงินสด'), value: fmtUsd(summary?.cashUsd ?? 0) },
    { label: t('portfolio.ledger.total', 'รวมสุทธิ'), value: fmtUsd(summary?.grandTotalUsd ?? 0), tone: 'gold' },
  ];

  return (
    <div className="min-h-screen text-[#E8E2D5] flex" style={{ background: 'radial-gradient(1000px 380px at 50% -6%, rgba(212,175,55,0.07), transparent 60%), #0D0F0E' }}>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-[#262B2C] px-6 py-3 flex justify-between items-center" style={{ background: '#0D0F0E' }}>
          <div>
            <p className="mono text-[9px] tracking-[0.3em] text-[#9A7B26] uppercase">Sovereign Wealth</p>
            <h1 className="font-ledger text-xl font-bold text-[#D4AF37]">{t('portfolio.title', 'ห้องคลัง')}</h1>
          </div>
          <div className="flex items-center gap-3">
            {isSuperadmin && members.length > 0 && (
              <select
                value={viewOwnerId}
                onChange={(e) => setViewOwnerId(e.target.value)}
                title={t('portfolio.switchPortfolioTitle', 'สลับดูพอร์ตของสมาชิกในครอบครัว')}
                className={`${INPUT} max-w-[220px]`}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.username}{m.id === user?.id ? t('portfolio.me', ' (คุณ)') : ''}
                  </option>
                ))}
              </select>
            )}
            <button onClick={refresh} disabled={refreshing} className={`${BTN} bg-[#262B2C] text-[#E8E2D5] hover:bg-[#33383A]`}>
              {refreshing ? t('portfolio.fetchingPrices', 'กำลังดึงราคา…') : <><Icon name="refresh" size={14} /> {t('portfolio.fetchPrices', 'ดึงราคาล่าสุด')}</>}
            </button>
            <a href="/dashboard" className="text-sm text-[#8C9188] hover:text-[#D4AF37]">{t('portfolio.backDashboard', '← กลับ Dashboard')}</a>
          </div>
        </header>
        <main className="max-w-6xl mx-auto p-6 space-y-6 w-full">
          {error && <div className="text-sm text-[#D98F85] bg-[#3A1D19]/60 border border-[#6E3026] rounded-lg px-4 py-3">{error}</div>}
          {loading ? (
            <div className="text-[#6E7368]">{t('portfolio.openingVault', 'กำลังเปิดตู้นิรภัย…')}</div>
          ) : (
            <>
              {/* ── กองแท่งทอง — signature ── */}
              <section className="flex flex-col items-center gap-2 pt-1">
                <IngotStack value={value} baseline={baseline} />
                <p className={`text-sm font-medium ${value >= 1 ? 'text-[#D4AF37] glow-text' : 'text-[#6E7368]'}`}>{stackCaption}</p>
                <p className="text-[10px] text-[#6E7368]">{t('portfolio.ingotCaption', 'แท่งละ $25,000 · เส้นประ = ยอดเมื่อเดือนก่อน')}</p>
              </section>

              {/* ── สมุดบัญชีรวม (แทนการ์ดตัวเลขใหญ่) ── */}
              <div className={`${PANEL} overflow-hidden panel-glow`}>
                <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#262B2C]">
                  <h2 className="font-ledger font-semibold text-[#E8E2D5] glow-text"><span className="text-[#D4AF37]">▍</span> {t('portfolio.ledger.title', 'สมุดบัญชีรวม')}</h2>
                  {summary?.runway?.months != null && (
                    <span className="mono text-xs text-[#8C9188]">{t('portfolio.ledger.runwayLabel', 'Runway ')}<span className="text-[#D4AF37]">{summary.runway.months.toFixed(1)} {t('portfolio.ledger.runwayMonths', '{n} เดือน', { n: summary.runway.months.toFixed(1) })}</span>{t('portfolio.ledger.runwayBurn', ' · ค่าใช้จ่าย {burn}/เดือน (ไฟ {energy})', { burn: fmtUsd(summary.runway.monthlyBurnUsd), energy: fmtUsd(summary.runway.energyCostUsd) })}</span>
                  )}
                </div>
                <div className="divide-y divide-[#1D2122]">
                  {ledgerRows.map((r) => (
                    <div key={r.label} className={`flex items-center justify-between px-5 py-2.5 ${r.tone === 'gold' ? 'bg-[#0D0F0E]' : ''}`}>
                      <span className={`text-sm ${r.tone === 'gold' ? 'font-semibold text-[#E8E2D5]' : 'text-[#8C9188]'}`}>{r.label}</span>
                      <span className={`mono text-lg font-bold ${r.tone === 'gold' ? 'text-[#D4AF37] glow-text border-t-2 border-[#9A7B26]/50 pt-0.5' : 'text-[#E8E2D5]'}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
                {summary && summary.missingPrices.length > 0 && (
                  <div className="px-5 py-2 text-xs text-[#C9A227] bg-[#3A2F0D]/40 border-t border-[#262B2C] flex items-center gap-1.5">
                    <Icon name="alert-triangle" size={13} className="shrink-0" />
                    <span>{t('portfolio.ledger.missingPrices', 'ยังไม่มีราคาสำหรับ: {prices} — กด "ดึงราคาล่าสุด" หรือรอ cron job', { prices: summary.missingPrices.join(', ') })}</span>
                  </div>
                )}
              </div>

              {/* ── หอคอยวิเคราะห์ Aladdin ── */}
              <div className={`${PANEL} p-5 panel-cyan`}>
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-ledger font-semibold text-[#E8E2D5] glow-text-cyan"><span className="text-[#D4AF37]">▍</span> {t('portfolio.aladdin.title', 'หอคอยวิเคราะห์ · Aladdin Risk Engine')} <span className="text-[10px] text-[#6E7368] font-normal">{t('portfolio.aladdin.subtitle', '— จำลองแนวคิด BlackRock Aladdin: ใช้ข้อมูลอดีตทำนายอนาคต + บอกสิ่งที่ต้องทำ')}</span></h2>
                  <button onClick={loadRisk} disabled={riskLoading} className={`${BTN} bg-[#262B2C] text-[#D4AF37] hover:bg-[#33383A]`}>
                    {riskLoading ? t('portfolio.risk.analyzing', 'กำลังวิเคราะห์...') : t('portfolio.risk.analyze', 'วิเคราะห์ความเสี่ยง')}
                  </button>
                </div>
                {riskError && <div className="text-xs text-[#D98F85] mt-2">{riskError}</div>}
                {!risk && !riskLoading && (
                  <div className="text-xs text-[#6E7368] mt-2">
                    {t('portfolio.risk.hint', 'กด "วิเคราะห์ความเสี่ยง" เพื่อให้ระบบคำนวณแนวโน้ม/โมเมนตัม/RSI จากราคาอดีต + จำลอง Monte Carlo 30 วัน + VaR95')}
                  </div>
                )}
                {risk && (
                  <div className="mt-4 space-y-4">
                    {risk.actions && risk.actions.length > 0 && (
                      <div className={`${TILE} p-3 border-[#3A3A2E]`}>
                        <div className="text-xs font-bold text-[#D4AF37] mb-2">{t('portfolio.risk.actionsTitle', 'สิ่งที่ต้องทำ (ทำตามลำดับ)')}</div>
                        <ul className="space-y-1">
                          {risk.actions.map((a: string, i: number) => (
                            <li key={i} className="text-xs text-[#C9C4B6] flex gap-2"><span className="text-[#D4AF37] shrink-0">{i + 1}.</span>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {risk.portfolio && (
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className={`${TILE} p-3`}>
                          <div className="text-[10px] text-[#6E7368]">{t('portfolio.risk.var95', 'VaR 95% (30 วัน)')}</div>
                          <div className="mono text-lg font-bold text-[#D98F85] glow-text-red">-{fmtUsd(risk.portfolio.var95)}</div>
                          <div className="text-[10px] text-[#6E7368]">{t('portfolio.risk.var95Desc', 'เสี่ยงขาดทุนสูงสุด {pct}% ของพอร์ต', { pct: risk.portfolio.var95Pct })}</div>
                        </div>
                        <div className={`${TILE} p-3`}>
                          <div className="text-[10px] text-[#6E7368]">{t('portfolio.risk.maxDrawdown', 'Drawdown สูงสุด')}</div>
                          <div className="mono text-lg font-bold text-[#D4AF37] glow-text">{(risk.portfolio.maxDrawdown * 100).toFixed(1)}%</div>
                        </div>
                        <div className={`${TILE} p-3`}>
                          <div className="text-[10px] text-[#6E7368]">{t('portfolio.risk.concentration', 'ความเข้มข้น (HHI)')}</div>
                          <div className="mono text-lg font-bold text-[#8FB3D9] glow-text-cyan">{risk.portfolio.concentration.toFixed(2)}</div>
                          <div className="text-[10px] text-[#6E7368]">{t('portfolio.risk.concentrationDesc', '{grade} · ตัวใหญ่สุด {top}', { grade: risk.portfolio.diversificationGrade, top: risk.portfolio.topHolding })}</div>
                        </div>
                        <div className={`${TILE} p-3`}>
                          <div className="text-[10px] text-[#6E7368]">{t('portfolio.risk.monteCarlo', 'Monte Carlo 30 วัน (P50)')}</div>
                          <div className="mono text-lg font-bold text-[#7FB069] glow-text">{fmtUsd(Math.round(risk.simulation?.p50 ?? 0))}</div>
                          <div className="text-[10px] text-[#6E7368]">{t('portfolio.risk.monteCarloDesc', 'P10 {p10} · P90 {p90} · โอกาสขาดทุน {p}%', { p10: fmtUsd(Math.round(risk.simulation?.p10 ?? 0)), p90: fmtUsd(Math.round(risk.simulation?.p90 ?? 0)), p: (risk.simulation?.probLoss * 100).toFixed(0) })}</div>
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      {risk.assets && risk.assets.map((a: any) => (
                        <div key={a.symbol} className={`${TILE} p-3`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-bold text-sm text-[#E8E2D5]">{a.symbol}</span>{' '}
                              <span className="text-[10px] text-[#6E7368]">{a.type} · {fmtUsd(a.current)} · 30d {a.return30dPct >= 0 ? '+' : ''}{a.return30dPct.toFixed(1)}%</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              a.signal === 'BUY' ? 'bg-[#2A3A22]/70 text-[#7FB069]' :
                              a.signal === 'SELL' ? 'bg-[#4A211A]/70 text-[#D98F85]' :
                              a.signal === 'REDUCE' ? 'bg-[#3A2F0D]/70 text-[#D4AF37]' : 'bg-[#262B2C] text-[#8C9188]'
                            }`}>
                              {a.signal === 'BUY' ? t('portfolio.signal.buy', 'ซื้อ') : a.signal === 'SELL' ? t('portfolio.signal.sell', 'ขาย') : a.signal === 'REDUCE' ? t('portfolio.signal.reduce', 'ลด') : t('portfolio.signal.hold', 'ถือ')}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-[#8C9188]">
                            <span>{t('portfolio.asset.trend', 'แนวโน้ม: ')}<b className={a.trend === 'rising' ? 'text-[#7FB069]' : a.trend === 'falling' ? 'text-[#D98F85]' : 'text-[#C9C4B6]'}>{a.trend === 'rising' ? t('portfolio.asset.trendUp', '↑ ขึ้น') : a.trend === 'falling' ? t('portfolio.asset.trendDown', '↓ ลง') : t('portfolio.asset.trendFlat', '→ นิ่ง')}</b></span>
                            <span>{t('portfolio.asset.momentum', 'โมเมนตัม: ')}{a.momentum === 'strong' ? t('portfolio.asset.momentumStrong', 'แรง') : a.momentum === 'weak' ? t('portfolio.asset.momentumWeak', 'อ่อน') : t('portfolio.asset.momentumNormal', 'ปกติ')}</span>
                            <span>RSI: {a.rsi}</span>
                            <span>{t('portfolio.asset.support', 'แนวรับ: ')}<b className="text-[#8FB3D9]">{a.support.toFixed(2)}</b></span>
                            <span>{t('portfolio.asset.resistance', 'แนวต้าน: ')}<b className="text-[#D4AF37]">{a.resistance.toFixed(2)}</b></span>
                            <span>{t('portfolio.asset.volatility', 'Volatility: {v}%/ปี', { v: (a.volatility * 100).toFixed(0) })}</span>
                          </div>
                          <div className="text-[11px] text-[#6E7368] mt-1">{a.reasoning}</div>
                          <ul className="text-[11px] text-[#C9C4B6] mt-1 space-y-0.5">
                            {a.actions.map((x: string, i: number) => <li key={i}>• {x}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── ตู้เซฟหลักทรัพย์ ── */}
              <div className={`${PANEL} p-5 panel-cyan`}>
                <h2 className="font-ledger font-semibold text-[#E8E2D5] mb-3 glow-text-cyan"><span className="text-[#D4AF37]">▍</span> {t('portfolio.vault.title', 'ตู้เซฟหลักทรัพย์ (หุ้น / คริปโต / ทองคำ)')}</h2>
                <div className="flex gap-2 mb-4">
                  <input
                    value={form.symbol}
                    onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                    placeholder={t('portfolio.vault.symbolPh', 'Symbol เช่น BTC, AAPL, XAUUSD')}
                    className={`flex-1 ${INPUT}`}
                  />
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className={INPUT}
                  >
                    <option value="CRYPTO">{t('portfolio.type.crypto', 'คริปโต')}</option>
                    <option value="STOCK">{t('portfolio.type.stock', 'หุ้น')}</option>
                    <option value="COMMODITY">{t('portfolio.type.commodity', 'สินค้าโภคภัณฑ์')}</option>
                  </select>
                  <input
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                    placeholder={t('portfolio.vault.qtyPh', 'จำนวน')}
                    className={`w-24 ${INPUT}`}
                  />
                  <button onClick={addAsset} className={BTN}>{t('common.add', 'เพิ่ม')}</button>
                </div>
                <div className="text-[11px] text-[#6E7368] mb-3 leading-relaxed">
                  <b>{t('portfolio.vault.qtyHintBold', 'จำนวน')}</b>{t('portfolio.vault.qtyHintA', '= หน่วยที่ถือ — หุ้น (STOCK): จำนวนหุ้น เช่น ')}<code className="text-[#C9C4B6]">AAPL 10</code>{t('portfolio.vault.qtyHintB', ' = 10 หุ้น · คริปโต: จำนวนเหรียญ เช่น ')}<code className="text-[#C9C4B6]">BTC 0.5</code>{t('portfolio.vault.qtyHintC', ' = 0.5 เหรียญ · ทอง/สินค้า: น้ำหนัก เช่น ')}<code className="text-[#C9C4B6]">XAUUSD 1</code>{t('portfolio.vault.qtyHintD', ' = 1 ออนซ์')}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[#9A7B26] text-xs">
                      <th className="pb-2">Symbol</th><th className="pb-2">{t('portfolio.vault.colType', 'ประเภท')}</th><th className="pb-2">{t('portfolio.vault.colQty', 'จำนวน')}</th>
                      <th className="pb-2">{t('portfolio.vault.colPrice', 'ราคา')}</th><th className="pb-2">{t('portfolio.vault.colValue', 'มูลค่า')}</th><th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id || a.symbol} className="border-t border-[#1D2122]">
                        <td className="py-2 font-bold text-[#E8E2D5]">{a.symbol}</td>
                        <td className="py-2 text-[#8C9188]">{a.type}</td>
                        <td className="py-2 mono">{a.quantity}</td>
                        <td className="py-2 mono">{a.priceUsd != null ? fmtUsd(a.priceUsd) : '—'}</td>
                        <td className="py-2 mono text-[#7FB069]">{fmtUsd(a.valueUsd)}</td>
                        <td className="py-2 text-right">
                          <button onClick={() => deleteAsset(a.id)} className="text-xs text-[#D98F85] hover:underline">{t('common.delete', 'ลบ')}</button>
                        </td>
                      </tr>
                    ))}
                    {assets.length === 0 && (
                      <tr><td colSpan={6} className="py-4 text-[#6E7368] text-center">{t('portfolio.vault.noAssets', 'ยังไม่มี asset — เพิ่มด้านบน')}</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="text-xs text-[#6E7368] mt-3">
                  {t('portfolio.vault.priceNote', 'ราคา: คริปโตจาก Binance, หุ้น/ทองคำจาก Yahoo Finance (ฟรี ไม่ต้อง API key) — cron job ดึงทุก 4 ชม. + cache กัน rate limit')}
                </div>
              </div>

              {/* ── โกดังเสบียง ── */}
              <div className={`${PANEL} p-5 panel-cyan`}>
                <h2 className="font-ledger font-semibold text-[#E8E2D5] mb-3 glow-text-cyan"><span className="text-[#D4AF37]">▍</span> {t('portfolio.inventory.title', 'โกดังเสบียง (ดีเซล / วัตถุดิบฟาร์ม / ทองคำแท่ง)')}</h2>

                <div className="flex flex-wrap gap-2 mb-4">
                  <input
                    value={invForm.name}
                    onChange={(e) => setInvForm({ ...invForm, name: e.target.value })}
                    placeholder={t('portfolio.inventory.namePh', 'ชื่อ เช่น ดีเซล B7, ข้าวสาร 5%')}
                    className={`flex-1 min-w-[180px] ${INPUT}`}
                  />
                  <select
                    value={invForm.category}
                    onChange={(e) => setInvForm({ ...invForm, category: e.target.value })}
                    className={INPUT}
                  >
                    <option value="FUEL">{t('portfolio.inventory.cat.fuel', 'เชื้อเพลิง')}</option>
                    <option value="FOOD">{t('portfolio.inventory.cat.food', 'อาหาร/วัตถุดิบ')}</option>
                    <option value="MATERIAL">{t('portfolio.inventory.cat.material', 'วัสดุ')}</option>
                    <option value="PRECIOUS_METAL">{t('portfolio.inventory.cat.precious', 'ทองคำแท่ง')}</option>
                    <option value="OTHER">{t('portfolio.inventory.cat.other', 'อื่น ๆ')}</option>
                  </select>
                  <input
                    value={invForm.quantity}
                    onChange={(e) => setInvForm({ ...invForm, quantity: e.target.value })}
                    placeholder={t('portfolio.inventory.qtyPh', 'จำนวน')}
                    className={`w-24 ${INPUT}`}
                  />
                  <input
                    value={invForm.unit}
                    onChange={(e) => setInvForm({ ...invForm, unit: e.target.value })}
                    placeholder={t('portfolio.inventory.unitPh', 'หน่วย (ลิตร/กก.)')}
                    className={`w-32 ${INPUT}`}
                  />
                  <input
                    value={invForm.unit_price_usd}
                    onChange={(e) => setInvForm({ ...invForm, unit_price_usd: e.target.value })}
                    placeholder={t('portfolio.inventory.pricePh', 'ราคา/หน่วย USD')}
                    className={`w-32 ${INPUT}`}
                  />
                  <button
                    onClick={addInventory}
                    disabled={invSaving}
                    className={BTN}
                  >
                    {invSaving ? t('portfolio.inventory.saving', 'กำลังบันทึก…') : t('portfolio.inventory.add', 'เพิ่มเสบียง')}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {inventory.map((item) => (
                    <div key={item.id} className={`${TILE} p-3 flex flex-col`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-sm text-[#E8E2D5] flex items-center gap-1.5"><Icon name={categoryIcons[item.category] ?? 'package'} size={14} className="text-[#8C9188]" />{item.name}</div>
                        <button
                          onClick={() => deleteInventory(item.id)}
                          title={t('portfolio.inventory.deleteTitle', 'ลบรายการนี้')}
                          className="text-xs text-[#D98F85] hover:text-[#E8A79D] hover:underline shrink-0 inline-flex items-center gap-1"
                        >
                          <Icon name="trash" size={12} />{t('common.delete', 'ลบ')}
                        </button>
                      </div>
                      <div className="text-xs text-[#8C9188] mt-1">
                        {item.quantity.toLocaleString()} {item.unit} × {fmtUsd(item.unit_price_usd)}
                      </div>
                      <div className="mono text-sm text-[#D4AF37] mt-1 font-bold">
                        {fmtUsd(item.quantity * item.unit_price_usd)}
                      </div>
                      {item.notes && <div className="text-[10px] text-[#6E7368] mt-1">{item.notes}</div>}
                    </div>
                  ))}
                  {inventory.length === 0 && (
                    <div className="text-[#6E7368] text-sm col-span-full">{t('portfolio.inventory.empty', 'ยังไม่มีรายการเสบียง — ใช้ฟอร์มด้านบนเพิ่ม (ดีเซล / ข้าวสาร / ทองคำแท่ง ฯลฯ)')}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
