import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import { fetchJsonArray, fetchJsonObject } from '../../lib/fetchJson';
import { getApiUrl } from '../../lib/config';
import Icon from '../ui/Icon';
import EmptyState from '../ui/EmptyState';

// ────────────────────────────────────────────────────────────────────────────
// BusinessWorkspace — พื้นที่ทำงานของธุรกิจเดียว (แท็บทั้งหมด)
// สิทธิ์จริงบังคับฝั่ง server — UI ใช้ position แค่ซ่อนปุ่ม (UX)
// ────────────────────────────────────────────────────────────────────────────

export const POSITION_LABELS: Record<string, string> = {
  OWNER: 'เจ้าของ',
  MANAGER: 'ผู้จัดการ',
  SALES: 'ฝ่ายขาย',
  TECHNICIAN: 'ช่างติดตั้ง',
  STOCK_KEEPER: 'ฝ่ายคลัง',
  ACCOUNTANT: 'ฝ่ายบัญชี',
  VIEWER: 'ผู้ดู',
};

const POSITION_RANK: Record<string, number> = { OWNER: 0, MANAGER: 1, SALES: 2, TECHNICIAN: 3, STOCK_KEEPER: 3, ACCOUNTANT: 3, VIEWER: 6 };

type Tab = 'overview' | 'products' | 'customers' | 'orders' | 'installations' | 'finance' | 'agents' | 'team' | 'shop';

const TABS: Array<{ key: Tab; label: string; minRank: number }> = [
  { key: 'overview', label: 'ภาพรวม', minRank: 6 },
  { key: 'products', label: 'สินค้า', minRank: 6 },
  { key: 'customers', label: 'ลูกค้า', minRank: 6 },
  { key: 'orders', label: 'ออเดอร์', minRank: 6 },
  { key: 'installations', label: 'ติดตั้ง', minRank: 6 },
  { key: 'finance', label: 'การเงิน', minRank: 3 },
  { key: 'agents', label: 'ผู้ช่วย AI', minRank: 6 },
  { key: 'team', label: 'ทีม', minRank: 6 },
  { key: 'shop', label: 'หน้าร้าน', minRank: 1 },
];

interface Business {
  id: string;
  name: string;
  bizType: string;
  vatRate: number;
  members: Array<{ id: string; userId: string; position: string; user?: { username: string } }>;
}
interface Product { id: string; sku: string; name: string; category: string; specs?: string; costPrice: number; salePrice: number; stockQty: number; reorderPoint: number; warrantyMonths: number; isActive: boolean; }
interface Customer { id: string; name: string; phone?: string; lineId?: string; address?: string; channel: string; }
interface OrderLine { id: string; productId: string; qty: number; unitPrice: number; unitCost: number; product?: { name: string; sku: string }; }
interface Order { id: string; orderNo: string; status: string; channel: string; subtotal: number; vat: number; total: number; paidAmount: number; customer?: { name: string } | null; lines: OrderLine[]; createdAt: string; }
interface Installation { id: string; title: string; status: string; scheduledAt?: string; note?: string; order?: { orderNo: string } | null; }
interface LedgerEntry { id: string; type: string; category: string; amount: number; note?: string; createdAt: string; }
interface Summary { income: number; expense: number; profit: number; revenue: number; cost: number; grossProfit: number; topProducts: Array<{ name: string; qty: number; profit: number }>; lowStock: Product[]; openOrders: number; todayInstallations: number; }
interface Agent { id: string; key: string; name: string; emoji: string; enabled: boolean; latestJob?: { id: string; status: string; prompt: string; result?: string; error?: string } | null; }
interface ShopSettings { shopOpen: boolean; shopName: string; promptPayMasked: string; promptPaySet: boolean; }

const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;
const STATUS_TH: Record<string, string> = { QUOTE: 'ใบเสนอราคา', ORDERED: 'รอชำระ', PAID: 'ชำระแล้ว', DELIVERED: 'ส่งแล้ว', CANCELLED: 'ยกเลิก', TODO: 'รอทำ', IN_PROGRESS: 'กำลังทำ', DONE: 'เสร็จ' };
const STATUS_CLS: Record<string, string> = { QUOTE: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', ORDERED: 'bg-amber-500/15 text-amber-300 border-amber-500/30', PAID: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', DELIVERED: 'bg-sky-500/15 text-sky-300 border-sky-500/30', CANCELLED: 'bg-rose-500/15 text-rose-300 border-rose-500/30', TODO: 'bg-slate-500/15 text-slate-300 border-slate-500/30', IN_PROGRESS: 'bg-amber-500/15 text-amber-300 border-amber-500/30', DONE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };

function StatusBadge({ status }: { status: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-[11px] border ${STATUS_CLS[status] ?? 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>{STATUS_TH[status] ?? status}</span>;
}

export default function BusinessWorkspace({ biz, onExit }: { biz: Business; onExit: () => void }) {
  const user = useAuthStore((s) => s.user);
  const myPosition = biz.members.find((m) => m.userId === user?.id)?.position ?? 'VIEWER';
  const can = (min: string) => (POSITION_RANK[myPosition] ?? 6) <= (POSITION_RANK[min] ?? 6);

  const [tab, setTab] = useState<Tab>('overview');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [members, setMembers] = useState<any[]>([]);

  // absolute URL ตาม house convention — relative จะตกไปที่ Next server ไม่ใช่ API :3001
  const base = `${getApiUrl()}/api/business/${biz.id}`;

  const load = useCallback(async () => {
    setProducts(await fetchJsonArray(`${base}/products`));
    setCustomers(await fetchJsonArray(`${base}/customers`));
    setOrders(await fetchJsonArray(`${base}/orders`));
    setInstallations(await fetchJsonArray(`${base}/installations`));
    setAgents(await fetchJsonArray(`${base}/agents`));
    setMembers(await fetchJsonArray(`${base}/members`));
    if (can('ACCOUNTANT')) {
      setSummary(await fetchJsonObject(`${base}/summary`));
      setLedger(await fetchJsonArray(`${base}/ledger`));
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  // งาน agent รันบน Ollama ~1-3 นาที — ขณะเปิดแท็บผู้ช่วย AI ดึงสถานะใหม่เองทุก 20 วิ
  useEffect(() => {
    if (tab !== 'agents') return;
    const t = setInterval(() => { void fetchJsonArray(`${base}/agents`).then(setAgents); }, 20000);
    return () => clearInterval(t);
  }, [tab, base]);

  useEffect(() => {
    if (!notice || !notice.ok) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const post = async (url: string, body?: any): Promise<any> => {
    const r = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
    if (!r.ok) throw new Error(data?.error ?? 'ล้มเหลว');
    return data;
  };

  // ── ผู้ช่วย AI: สั่งงาน ──
  const [agentPrompt, setAgentPrompt] = useState<Record<string, string>>({});
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const runningRef = useRef(false); // sync guard — rapid same-tick clicks bypass disabled-state renders
  async function runAgent(agent: Agent) {
    const prompt = (agentPrompt[agent.key] ?? '').trim();
    if (!prompt) { setNotice({ ok: false, text: 'พิมพ์ภารกิจก่อนสั่งงาน' }); return; }
    if (runningRef.current) return;
    runningRef.current = true;
    setRunningAgent(agent.id);
    try {
      await post(`${base}/agents/${agent.id}/run`, { prompt });
      setNotice({ ok: true, text: `${agent.emoji} ${agent.name} กำลังทำงาน — รอสักครู่แล้วกดรีเฟรช` });
      setAgentPrompt((s) => ({ ...s, [agent.key]: '' }));
    } catch (e: any) { setNotice({ ok: false, text: e.message }); }
    finally { runningRef.current = null; setRunningAgent(null); }
  }

  // ── ออเดอร์: สร้าง + transition ──
  const [cart, setCart] = useState<Record<string, number>>({});
  async function createOrder(customerId?: string) {
    const items = Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty }));
    if (items.length === 0) { setNotice({ ok: false, text: 'เลือกสินค้าก่อนเปิดออเดอร์' }); return; }
    try {
      const o = await post(`${base}/orders`, { items, customerId: customerId || undefined });
      setNotice({ ok: true, text: `เปิดออเดอร์ ${o.orderNo} แล้ว (${baht(o.total)}) — ยืนยันที่แท็บออเดอร์` });
      setCart({});
      await load();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); }
  }
  async function transition(order: Order, action: string, label: string) {
    try {
      await post(`${base}/orders/${order.id}/transition`, { action });
      setNotice({ ok: true, text: `${order.orderNo} → ${label}` });
      await load();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); await load(); }
  }
  async function markPaid(order: Order) {
    const remain = Math.max(0, order.total - order.paidAmount);
    try {
      await post(`${base}/orders/${order.id}/payments`, { amount: remain, method: 'CASH' });
      setNotice({ ok: true, text: `รับชำระ ${order.orderNo} ครบ ${baht(order.total)}` });
      await load();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); await load(); }
  }

  const tabOk = (t: Tab) => (TABS.find((x) => x.key === t)?.minRank ?? 6) >= (POSITION_RANK[myPosition] ?? 6);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onExit} className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-700/40" aria-label="กลับหน้ารวมธุรกิจ">← ธุรกิจทั้งหมด</button>
        <h2 className="text-xl font-bold">{biz.name}</h2>
        <span className="px-2 py-0.5 rounded-full text-[11px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">คุณคือ {POSITION_LABELS[myPosition] ?? myPosition}</span>
      </div>

      {notice && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>{notice.text}</div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="แท็บธุรกิจ">
        {TABS.filter((t) => t.minRank >= (POSITION_RANK[myPosition] ?? 6)).map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => tabOk(t.key) && setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${tab === t.key ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200' : 'border-slate-700 hover:bg-slate-700/30'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ภาพรวม ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {summary ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'ยอดขายที่เก็บเงินแล้ว', value: baht(summary.revenue), cls: 'text-emerald-300' },
                { label: 'กำไรขั้นต้น', value: baht(summary.grossProfit), cls: 'text-cyan-300' },
                { label: 'ออเดอร์ค้าง', value: String(summary.openOrders), cls: 'text-amber-300' },
                { label: 'งานติดตั้งค้าง', value: String(summary.todayInstallations), cls: 'text-sky-300' },
              ].map((k) => (
                <div key={k.label} className="card p-3">
                  <div className="text-[11px] text-slate-400">{k.label}</div>
                  <div className={`text-lg font-bold ${k.cls}`}>{k.value}</div>
                </div>
              ))}
              <div className="card p-3 col-span-2 md:col-span-4">
                <div className="text-xs text-slate-400 mb-1">📦 สต็อกใกล้หมด (ต่ำกว่าจุดสั่งเติม)</div>
                {summary.lowStock.length === 0 ? <div className="text-sm text-slate-500">ทุกสินค้าสต็อกปกติ</div> : (
                  <div className="flex flex-wrap gap-2">{summary.lowStock.map((p) => <span key={p.id} className="text-xs px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">{p.name} เหลือ {p.stockQty}</span>)}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="card p-4 text-sm text-slate-400">ตัวเลขการเงินเห็นได้เฉพาะฝ่ายบัญชีขึ้นไป — ติดต่อผู้จัดการของธุรกิจ</div>
          )}
        </div>
      )}

      {/* ── สินค้า ── */}
      {tab === 'products' && (
        <ProductsTab products={products} canWrite={can('STOCK_KEEPER')} onAdded={() => { setNotice({ ok: true, text: 'เพิ่มสินค้าแล้ว' }); void load(); }} onError={(m) => setNotice({ ok: false, text: m })} base={base} post={post} />
      )}

      {/* ── ลูกค้า ── */}
      {tab === 'customers' && (
        <CustomersTab customers={customers} canWrite={can('SALES')} onAdded={() => { setNotice({ ok: true, text: 'เพิ่มลูกค้าแล้ว' }); void load(); }} onError={(m) => setNotice({ ok: false, text: m })} post={post} base={base} />
      )}

      {/* ── ออเดอร์ ── */}
      {tab === 'orders' && (
        <div className="space-y-4">
          {can('SALES') && (
            <div className="card p-4 space-y-3">
              <div className="text-sm font-semibold">🧾 เปิดออเดอร์ใหม่</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {products.map((p) => (
                  <label key={p.id} className={`flex items-center justify-between gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer ${cart[p.id] ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-700'}`}>
                    <span>{p.name} <span className="text-slate-400">({baht(p.salePrice)})</span></span>
                    <input type="number" min={0} max={p.stockQty} value={cart[p.id] ?? 0} onChange={(e) => setCart((s) => ({ ...s, [p.id]: Math.max(0, Math.min(p.stockQty, Number(e.target.value) || 0)) }))}
                      className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-right" aria-label={`จำนวน ${p.name}`} />
                  </label>
                ))}
                {products.length === 0 && <div className="text-sm text-slate-500">ยังไม่มีสินค้า — เพิ่มที่แท็บสินค้าก่อน</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select id="biz-order-customer" className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" defaultValue="">
                  <option value="">— ลูกค้าทั่วไป —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={() => createOrder((document.getElementById('biz-order-customer') as HTMLSelectElement)?.value)}
                  className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">เปิดออเดอร์</button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {orders.length === 0 && <EmptyState title="ยังไม่มีออเดอร์" description="เปิดออเดอร์แรกจากแบบฟอร์มด้านบน" />}
            {orders.map((o) => (
              <div key={o.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs text-slate-400">{o.orderNo}</span>
                <StatusBadge status={o.status} />
                <span className="text-slate-300">{o.customer?.name ?? 'ลูกค้าทั่วไป'}</span>
                <span className="ml-auto font-semibold">{baht(o.total)}{o.paidAmount > 0 && o.paidAmount < o.total ? <span className="text-xs text-amber-300"> (จ่ายแล้ว {baht(o.paidAmount)})</span> : null}</span>
                <span className="text-[11px] text-slate-500 w-full sm:w-auto">{o.lines.map((l) => `${l.product?.name ?? '?'}×${l.qty}`).join(', ')}</span>
                {can('MANAGER') && o.status === 'QUOTE' && <button onClick={() => transition(o, 'confirm', 'รอชำระ')} className="px-3 py-1 rounded bg-cyan-600/80 hover:bg-cyan-500 text-xs">ยืนยัน (หักสต็อก)</button>}
                {can('SALES') && o.status === 'ORDERED' && <button onClick={() => markPaid(o)} className="px-3 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-xs">รับชำระ {baht(Math.max(0, o.total - o.paidAmount))}</button>}
                {can('MANAGER') && o.status === 'PAID' && <button onClick={() => transition(o, 'deliver', 'ส่งแล้ว')} className="px-3 py-1 rounded bg-sky-600/80 hover:bg-sky-500 text-xs">ส่งของ</button>}
                {can('MANAGER') && (o.status === 'QUOTE' || o.status === 'ORDERED') && <button onClick={() => transition(o, 'cancel', 'ยกเลิก')} className="px-3 py-1 rounded border border-rose-500/40 text-rose-300 text-xs hover:bg-rose-500/10">ยกเลิก</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ติดตั้ง ── */}
      {tab === 'installations' && (
        <InstallationsTab installations={installations} canCreate={can('MANAGER')} canWork={can('TECHNICIAN')} post={post} base={base} reload={load} setNotice={setNotice} />
      )}

      {/* ── การเงิน ── */}
      {tab === 'finance' && (
        <div className="space-y-4">
          {summary ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="card p-3"><div className="text-[11px] text-slate-400">รายรับรวม</div><div className="text-lg font-bold text-emerald-300">{baht(summary.income)}</div></div>
              <div className="card p-3"><div className="text-[11px] text-slate-400">รายจ่ายรวม</div><div className="text-lg font-bold text-rose-300">{baht(summary.expense)}</div></div>
              <div className="card p-3"><div className="text-[11px] text-slate-400">กำไรสุทธิ</div><div className={`text-lg font-bold ${summary.profit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{baht(summary.profit)}</div></div>
              <div className="card p-3"><div className="text-[11px] text-slate-400">ต้นทุนสินค้า (ขายแล้ว)</div><div className="text-lg font-bold text-slate-300">{baht(summary.cost)}</div></div>
            </div>
          ) : <div className="card p-4 text-sm text-slate-400">ต้องเป็นฝ่ายบัญชีขึ้นไป</div>}
          {can('MANAGER') && <LedgerForm post={post} base={base} reload={load} setNotice={setNotice} />}
          <div className="card p-3">
            <div className="text-sm font-semibold mb-2">สมุดบัญชีล่าสุด</div>
            <div className="space-y-1 max-h-72 overflow-auto">
              {ledger.length === 0 && <div className="text-sm text-slate-500">ยังไม่มีรายการ</div>}
              {ledger.map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-sm border-b border-slate-800 pb-1">
                  <span className={`px-1.5 rounded text-[10px] ${l.type === 'INCOME' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{l.type === 'INCOME' ? 'รับ' : 'จ่าย'}</span>
                  <span className="text-slate-400 text-xs">{l.category}</span>
                  <span className="text-slate-300 flex-1 truncate">{l.note ?? ''}</span>
                  <span className={l.type === 'INCOME' ? 'text-emerald-300' : 'text-rose-300'}>{l.type === 'INCOME' ? '+' : '−'}{baht(l.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          {summary && summary.topProducts.length > 0 && (
            <div className="card p-3">
              <div className="text-sm font-semibold mb-2">🏆 สินค้าทำกำไรสูงสุด</div>
              <div className="space-y-1">{summary.topProducts.map((p) => (
                <div key={p.name} className="flex justify-between text-sm"><span className="text-slate-300">{p.name} <span className="text-slate-500 text-xs">×{p.qty}</span></span><span className="text-emerald-300">{baht(p.profit)}</span></div>
              ))}</div>
            </div>
          )}
        </div>
      )}

      {/* ── ผู้ช่วย AI ── */}
      {tab === 'agents' && (
        <div className="grid md:grid-cols-2 gap-3">
          {agents.length === 0 && <EmptyState title="ยังไม่มีผู้ช่วย AI" description="เจ้าของธุรกิจกด seed ได้จากแท็บทีม" />}
          {agents.map((a) => (
            <div key={a.id} className={`card p-3 space-y-2 ${a.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2">
                <span className="text-xl">{a.emoji}</span>
                <span className="font-semibold">{a.name}</span>
                <span className="ml-auto text-[10px] text-slate-500">{a.enabled ? 'พร้อมทำงาน' : 'ปิดอยู่'}</span>
              </div>
              <div className="flex gap-1">
                <input value={agentPrompt[a.key] ?? ''} onChange={(e) => setAgentPrompt((s) => ({ ...s, [a.key]: e.target.value }))}
                  placeholder={`สั่งงาน ${a.name}…`} className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label={`ภารกิจของ ${a.name}`} />
                <button onClick={() => runAgent(a)} disabled={runningAgent === a.id}
                  className="px-3 py-1.5 rounded bg-cyan-600/80 hover:bg-cyan-500 text-sm disabled:opacity-40">▶</button>
              </div>
              {a.latestJob && (
                <div className="text-xs text-slate-400 border-t border-slate-800 pt-2">
                  <div>งานล่าสุด: {a.latestJob.status === 'done' ? '✅ เสร็จ' : a.latestJob.status === 'running' ? '⏳ กำลังทำ' : a.latestJob.status === 'error' ? `❌ ${a.latestJob.error ?? 'ผิดพลาด'}` : '… รอคิว'}</div>
                  {a.latestJob.result && <div className="mt-1 whitespace-pre-wrap text-slate-300 max-h-40 overflow-auto">{a.latestJob.result}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── หน้าร้าน (settings ร้านสาธารณะ) ── */}
      {tab === 'shop' && (
        <ShopTab bizId={biz.id} bizName={biz.name} canManage={can('MANAGER')} base={base} setNotice={setNotice} />
      )}

      {/* ── ทีม ── */}
      {tab === 'team' && (
        <div className="space-y-3">
          <div className="card p-3">
            <div className="text-sm font-semibold mb-2">สมาชิกธุรกิจ</div>
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-sm border-b border-slate-800 pb-1">
                  <span className="text-slate-200">{m.user?.username ?? m.userId}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] border border-slate-600 text-slate-300">{POSITION_LABELS[m.position] ?? m.position}</span>
                  {can('OWNER') && m.position !== 'OWNER' && (
                    <button onClick={async () => { try { await authFetch(`${base}/members/${m.id}`, { method: 'DELETE' }); setNotice({ ok: true, text: 'ถอดสมาชิกแล้ว' }); await load(); } catch { setNotice({ ok: false, text: 'ถอดไม่สำเร็จ' }); } }}
                      className="ml-auto text-rose-300 text-xs hover:underline">ถอดออก</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {can('OWNER') && <AddMemberCard base={base} reload={load} setNotice={setNotice} />}
          {!can('OWNER') && <div className="text-sm text-slate-500">เฉพาะเจ้าของธุรกิจจึงจัดการทีมได้</div>}
        </div>
      )}
    </div>
  );
}

function ShopTab({ bizId, bizName, canManage, base, setNotice }: { bizId: string; bizName: string; canManage: boolean; base: string; setNotice: (n: { ok: boolean; text: string } | null) => void }) {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [shopName, setShopName] = useState('');
  const [promptPay, setPromptPay] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await fetchJsonObject<ShopSettings>(`${base}/shop`);
    if (s) {
      setSettings(s);
      setShopName(s.shopName ?? '');
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function save(payload: any, okText: string) {
    setBusy(true);
    try {
      const data = await (await fetch(`${base}/shop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useAuthStore.getState().token}` },
        body: JSON.stringify(payload),
      })).json();
      if (data?.error) throw new Error(data.error);
      setSettings(data);
      setShopName(data.shopName ?? '');
      setPromptPay('');
      setNotice({ ok: true, text: okText });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/shop?id=${bizId}` : '';

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold">🏪 หน้าร้านสาธารณะ</div>
        <p className="text-xs text-slate-400">
          เปิดร้านแล้วลูกค้าทั่วไปเข้า /shop ดูสินค้าและสั่งซื้อได้โดยไม่ต้อง login — ออเดอร์จะโผล่ที่แท็บออเดอร์ (สถานะ “ใบเสนอราคา” เลข S…)
          กด “ยืนยัน (หักสต็อก)” ตามปกติ ลูกค้าเช็คสถานะ/แจ้งชำระเงินผ่านลิงก์ลับของออเดอร์
        </p>
        {!canManage ? (
          <div className="text-sm text-slate-500">ต้องเป็นผู้จัดการขึ้นไปจึงตั้งค่าหน้าร้านได้</div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={settings?.shopOpen ?? false} disabled={busy}
                  onChange={(e) => save({ shopOpen: e.target.checked }, e.target.checked ? 'เปิดร้านแล้ว — ลูกค้าเข้า /shop ได้' : 'ปิดร้านแล้ว — /shop จะขึ้นว่าไม่พบร้าน')}
                  className="w-4 h-4" />
                <span>เปิดร้านให้ลูกค้าเข้าชม/สั่งซื้อ</span>
              </label>
              {settings?.shopOpen && (
                <a href={`/shop?id=${bizId}`} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:underline">เปิดหน้าร้านดู →</a>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1" htmlFor="shop-name-input">ชื่อร้านบนหน้าเว็บ (ว่าง = ใช้ชื่อธุรกิจ)</label>
                <input id="shop-name-input" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={bizName}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1" htmlFor="shop-pp-input">
                  PromptPay (เบอร์ 10 หลัก หรือเลขบัตร 13 หลัก){settings?.promptPaySet ? ` — ตั้งแล้ว ${settings.promptPayMasked}` : ''}
                </label>
                <input id="shop-pp-input" value={promptPay} onChange={(e) => setPromptPay(e.target.value)} placeholder="08XXXXXXXX"
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => save({ shopName: shopName.trim(), ...(promptPay.trim() ? { shopPromptPay: promptPay.trim() } : {}) }, 'บันทึกการตั้งค่าร้านแล้ว')}
                disabled={busy} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium disabled:opacity-40">บันทึก</button>
              {settings?.promptPaySet && (
                <button onClick={() => save({ shopPromptPay: '' }, 'ลบ PromptPay แล้ว — QR จะถูกปิด')}
                  disabled={busy} className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-300 text-xs hover:bg-rose-500/10">ลบ PromptPay</button>
              )}
            </div>
            {settings?.shopOpen && (
              <div className="text-[11px] text-slate-500 break-all">ลิงก์ร้าน: {publicUrl} — ส่งให้ลูกค้าผ่าน LINE/Facebook ได้เลย</div>
            )}
          </>
        )}
      </div>
      {settings?.shopOpen && (
        <div className="card p-3 text-xs text-slate-400">
          <div className="font-semibold text-slate-300 mb-1">วงจรออเดอร์จากหน้าร้าน</div>
          ลูกค้าสั่ง → ได้เลขที่ S… + ลิงก์ลับเช็คสถานะ (แสดงให้ลูกค้าทันที) → คุณกด “ยืนยัน (หักสต็อก)” ที่แท็บออเดอร์ →
          ลูกค้าแจ้งชำระ (บันทึกเป็น PROMPTPAY/รอตรวจ) → คุณตรวจเงินเข้าแล้วกด “รับชำระ” → PAID → ส่งของตามปกติ
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──
function ProductsTab({ products, canWrite, onAdded, onError, base, post }: any) {
  const [form, setForm] = useState({ sku: '', name: '', category: 'SENSOR', costPrice: '', salePrice: '', stockQty: '', reorderPoint: '3', warrantyMonths: '12', specs: '' });
  if (!canWrite) {
    return <div className="space-y-2">{products.map((p: Product) => (
      <div key={p.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm"><span className="font-mono text-xs text-slate-400">{p.sku}</span><span>{p.name}</span><span className="ml-auto">{baht(p.salePrice)} · สต็อก {p.stockQty}</span></div>
    ))}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold">📦 เพิ่มสินค้า IoT</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <input placeholder="SKU เช่น ESP32-01" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="SKU" />
          <input placeholder="ชื่อสินค้า" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm sm:col-span-2" aria-label="ชื่อสินค้า" />
          <input placeholder="หมวด" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="หมวด" />
          <input type="number" placeholder="ราคาทุน" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ราคาทุน" />
          <input type="number" placeholder="ราคาขาย" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ราคาขาย" />
          <input type="number" placeholder="สต็อกเริ่ม" value={form.stockQty} onChange={(e) => setForm({ ...form, stockQty: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="สต็อก" />
          <input type="number" placeholder="จุดสั่งเติม" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="จุดสั่งเติม" />
          <input type="number" placeholder="รับประกัน (เดือน)" value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="รับประกัน" />
          <input placeholder="สเปคย่อ" value={form.specs} onChange={(e) => setForm({ ...form, specs: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="สเปค" />
        </div>
        <button onClick={async () => {
          if (!form.sku.trim()) { onError('กรอก SKU ก่อน'); return; }
          if (!form.name.trim()) { onError('กรอกชื่อสินค้าก่อน'); return; }
          if (Number(form.costPrice) < 0 || Number(form.salePrice) < 0) { onError('ราคาติดลบไม่ได้'); return; }
          try {
            const payload = { ...form, costPrice: Number(form.costPrice) || 0, salePrice: Number(form.salePrice) || 0, stockQty: Number(form.stockQty) || 0, reorderPoint: Number(form.reorderPoint) || 0, warrantyMonths: Number(form.warrantyMonths) || 0 };
            await post(`${base}/products`, payload);
            setForm({ sku: '', name: '', category: 'SENSOR', costPrice: '', salePrice: '', stockQty: '', reorderPoint: '3', warrantyMonths: '12', specs: '' });
            onAdded();
          } catch (e: any) { onError(/Unique constraint/i.test(e.message) ? 'SKU นี้มีอยู่แล้ว' : e.message); }
        }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">เพิ่มสินค้า</button>
      </div>
      <div className="space-y-2">
        {products.map((p: Product) => (
          <div key={p.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-xs text-slate-400">{p.sku}</span>
            <span className="font-medium">{p.name}</span>
            {p.stockQty <= p.reorderPoint && <span className="text-[10px] px-1.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">ใกล้หมด</span>}
            <span className="ml-auto text-slate-300">ทุน {baht(p.costPrice)} → ขาย {baht(p.salePrice)}</span>
            <span className="text-slate-400">สต็อก {p.stockQty}</span>
            <span className="text-slate-500 text-xs">รับประกัน {p.warrantyMonths} เดือน</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomersTab({ customers, canWrite, onAdded, onError, post, base }: any) {
  const [form, setForm] = useState({ name: '', phone: '', lineId: '', channel: 'ONLINE' });
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card p-4 space-y-3">
          <div className="text-sm font-semibold">👤 เพิ่มลูกค้า</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <input placeholder="ชื่อ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ชื่อลูกค้า" />
            <input placeholder="เบอร์โทร" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="เบอร์โทร" />
            <input placeholder="LINE ID" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="LINE ID" />
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ช่องทาง">
              <option value="ONLINE">ออนไลน์</option><option value="SHOP">หน้าร้าน</option><option value="B2B">B2B</option>
            </select>
          </div>
          <button onClick={async () => {
            if (!form.name.trim()) { onError('กรอกชื่อลูกค้า'); return; }
            try { await post(`${base}/customers`, form); setForm({ name: '', phone: '', lineId: '', channel: 'ONLINE' }); onAdded(); }
            catch (e: any) { onError(e.message); }
          }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">เพิ่มลูกค้า</button>
        </div>
      )}
      <div className="space-y-2">
        {customers.length === 0 && <EmptyState title="ยังไม่มีลูกค้า" description="เพิ่มลูกค้าเพื่อผูกออเดอร์และประวัติการซื้อ" />}
        {customers.map((c: Customer) => (
          <div key={c.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{c.name}</span>
            <span className="text-slate-400">{c.phone ?? ''}</span>
            <span className="ml-auto text-[10px] px-1.5 rounded bg-slate-700/50 text-slate-300">{c.channel}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InstallationsTab({ installations, canCreate, canWork, post, base, reload, setNotice }: any) {
  const [form, setForm] = useState({ title: '', scheduledAt: '' });
  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="card p-4 space-y-3">
          <div className="text-sm font-semibold">🔧 เปิดงานติดตั้ง</div>
          <div className="grid sm:grid-cols-2 gap-2">
            <input placeholder="ชื่องาน เช่น ติดตั้งเซ็นเซอร์โรงงาน A" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ชื่องานติดตั้ง" />
            <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="วันนัดหมาย" />
          </div>
          <button onClick={async () => {
            if (!form.title.trim()) { setNotice({ ok: false, text: 'กรอกชื่องาน' }); return; }
            try { await post(`${base}/installations`, { title: form.title, scheduledAt: form.scheduledAt || undefined }); setForm({ title: '', scheduledAt: '' }); setNotice({ ok: true, text: 'เปิดงานติดตั้งแล้ว' }); await reload(); }
            catch (e: any) { setNotice({ ok: false, text: e.message }); }
          }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">เปิดงาน</button>
        </div>
      )}
      <div className="space-y-2">
        {installations.length === 0 && <EmptyState title="ยังไม่มีงานติดตั้ง" description="งานติดตั้งหน้างานจะช่วยติดตามช่างและวันนัด" />}
        {installations.map((inst: Installation) => (
          <div key={inst.id} className="card p-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{inst.title}</span>
            <StatusBadge status={inst.status} />
            {inst.scheduledAt && <span className="text-xs text-slate-400">📅 {new Date(inst.scheduledAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            <div className="ml-auto flex gap-1">
              {canWork && inst.status === 'TODO' && <button onClick={async () => { try { await post(`${base}/installations/${inst.id}/transition`, { action: 'start' }); await reload(); } catch (e: any) { setNotice({ ok: false, text: e.message }); } }} className="px-3 py-1 rounded bg-amber-600/80 hover:bg-amber-500 text-xs">เริ่มงาน</button>}
              {canWork && inst.status === 'IN_PROGRESS' && <button onClick={async () => { try { await post(`${base}/installations/${inst.id}/transition`, { action: 'complete' }); await reload(); } catch (e: any) { setNotice({ ok: false, text: e.message }); } }} className="px-3 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-xs">ปิดงาน</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerForm({ post, base, reload, setNotice }: any) {
  const [form, setForm] = useState({ type: 'EXPENSE', category: 'RESTOCK', amount: '', note: '' });
  return (
    <div className="card p-4 space-y-3">
      <div className="text-sm font-semibold">✍️ บันทึกรายรับ-รายจ่าย</div>
      <div className="grid sm:grid-cols-4 gap-2">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, category: e.target.value === 'INCOME' ? 'SALES' : 'RESTOCK' })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ประเภท">
          <option value="EXPENSE">รายจ่าย</option><option value="INCOME">รายรับ</option>
        </select>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="หมวด">
          {form.type === 'EXPENSE'
            ? [['RESTOCK', 'ของเข้า'], ['TRANSPORT', 'ขนส่ง'], ['ADS', 'โฆษณา'], ['OTHER', 'อื่น ๆ']].map(([v, l]) => <option key={v} value={v}>{l}</option>)
            : [['SALES', 'ขาย'], ['OTHER', 'อื่น ๆ']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="number" placeholder="จำนวนเงิน (บาท)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="จำนวนเงิน" />
        <input placeholder="หมายเหตุ" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="หมายเหตุ" />
      </div>
      <button onClick={async () => {
        const amount = Number(form.amount);
        if (!amount || amount <= 0) { setNotice({ ok: false, text: 'กรอกจำนวนเงิน' }); return; }
        try { await post(`${base}/ledger`, { ...form, amount }); setForm({ ...form, amount: '', note: '' }); setNotice({ ok: true, text: 'บันทึกบัญชีแล้ว' }); await reload(); }
        catch (e: any) { setNotice({ ok: false, text: e.message }); }
      }} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium">บันทึก</button>
    </div>
  );
}

function AddMemberCard({ base, reload, setNotice }: any) {
  const [username, setUsername] = useState('');
  const [position, setPosition] = useState('SALES');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!username.trim()) { setNotice({ ok: false, text: 'กรอกชื่อผู้ใช้' }); return; }
    setBusy(true);
    try {
      // หา userId จาก username ผ่าน user-lookup (SUPERADMIN) — ถ้าไม่ใช่ SUPERADMIN ให้ใส่ userId ตรง
      const r = await authFetch(`${getApiUrl()}/api/business/user-lookup`);
      let userId = username.trim();
      if (r.ok) {
        const users = await r.json();
        const hit = users.find((u: any) => u.username === username.trim());
        if (!hit) { setNotice({ ok: false, text: `ไม่พบผู้ใช้ "${username}"` }); setBusy(false); return; }
        userId = hit.id;
      }
      const res = await authFetch(`${base}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, position }) });
      const data = res.ok ? null : await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'เพิ่มไม่สำเร็จ');
      setNotice({ ok: true, text: `เพิ่มสมาชิก (${POSITION_LABELS[position] ?? position}) แล้ว` });
      setUsername('');
      await reload();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }
  return (
    <div className="card p-4 space-y-3">
      <div className="text-sm font-semibold">➕ เพิ่มสมาชิก</div>
      <div className="grid sm:grid-cols-3 gap-2">
        <input placeholder="ชื่อผู้ใช้ในระบบ" value={username} onChange={(e) => setUsername(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ชื่อผู้ใช้" />
        <select value={position} onChange={(e) => setPosition(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm" aria-label="ตำแหน่ง">
          {Object.entries(POSITION_LABELS).filter(([k]) => k !== 'OWNER').map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button onClick={add} disabled={busy} className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium disabled:opacity-40">เพิ่มเข้าธุรกิจ</button>
      </div>
    </div>
  );
}
