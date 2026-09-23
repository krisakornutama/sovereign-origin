import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import { fetchJsonArray, fetchJsonObject } from '../../lib/fetchJson';
import { getApiUrl } from '../../lib/config';
import Icon from '../ui/Icon';
import EmptyState from '../ui/EmptyState';
import TaxInvoice from './TaxInvoice';

// ────────────────────────────────────────────────────────────────────────────
// BusinessWorkspace — พื้นที่ทำงานของธุรกิจเดียว (แท็บทั้งหมด)
// สิทธิ์จริงบังคับฝั่ง server — UI ใช้ position แค่ซ่อนปุ่ม (UX)
// ────────────────────────────────────────────────────────────────────────────
import { POSITION_LABELS, POSITION_RANK, TABS, baht, STATUS_TH, STATUS_CLS, StatusBadge, SHIPPING_TH, SHIPPING_CLS, ShippingBadge } from './shared';
import type { Tab, Business, Product, Customer, Order, Installation, LedgerEntry, Summary, Agent, ShopSettings } from './shared';
import { BusinessTaxTab } from './BusinessTaxTab';
import { BusinessShopTab } from './BusinessShopTab';
import { AgentsTab } from './BusinessAgentsTab';
import { LedgerRow, ProductsTab, CustomersTab, InstallationsTab, LedgerForm, AddMemberCard } from './BusinessTabs';

export default function BusinessWorkspace({ biz, onExit, refreshBiz }: { biz: Business; onExit: () => void; refreshBiz?: () => void }) {
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
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);

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
  // หัก ณ ที่จ่ายต่อออเดอร์ (ท.ป.4 ที่ลูกค้า B2B หัก) — ค่าว่าง = ไม่มี WHT
  const [whtInput, setWhtInput] = useState<Record<string, string>>({});
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
  // เฟส 4: สถานะจัดส่งแบบเบา — เดินหน้าอย่างเดียว (backend กันย้อนกลับ)
  async function updateShipping(order: Order, status: 'PREPARING' | 'SHIPPED') {
    try {
      await post(`${base}/orders/${order.id}/shipping`, { shippingStatus: status, shippingCarrier: status === 'SHIPPED' ? 'เจ้าของร้านส่งเอง' : undefined });
      setNotice({ ok: true, text: status === 'SHIPPED' ? `${order.orderNo} → จัดส่งแล้ว` : `${order.orderNo} → กำลังเตรียมส่ง` });
      await load();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); await load(); }
  }
  async function markPaid(order: Order) {
    const remain = Math.max(0, order.total - order.paidAmount);
    const wht = Math.max(0, Number(whtInput[order.id]) || 0);
    if (wht >= remain) { setNotice({ ok: false, text: 'ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดค้างชำระ (เงินโอนเข้าจริง = ค้าง − WHT)' }); return; }
    try {
      await post(`${base}/orders/${order.id}/payments`, { amount: remain, method: 'CASH', ...(wht > 0 ? { whtAmount: wht, method: 'TRANSFER' } : {}) });
      setNotice({ ok: true, text: wht > 0
        ? `รับชำระ ${order.orderNo} ครบ ${baht(order.total)} (โอนเข้า ${baht(remain - wht)} — WHT ${baht(wht)})`
        : `รับชำระ ${order.orderNo} ครบ ${baht(order.total)}` });
      setWhtInput((s) => ({ ...s, [order.id]: '' }));
      await load();
    } catch (e: any) { setNotice({ ok: false, text: e.message }); await load(); }
  }

  // ── TRACEABILITY — ล็อตผลผลิตของสินค้าแต่ละบรรทัด (orderLines) สำหรับโชว์ประวัติตามรอย ──
  const [traceOrder, setTraceOrder] = useState<Order | null>(null);
  const [traceLines, setTraceLines] = useState<Array<{ productId: string; qty: number; lots: any[] }> | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  async function openTrace(order: Order) {
    setTraceOrder(order);
    setTraceLines(null);
    setTraceLoading(true);
    try {
      const data = await fetchJsonObject<{ orderNo: string; lines: Array<{ productId: string; qty: number; lots: any[] }> }>(`${base}/orders/${order.id}/lots`);
      setTraceLines(data?.lines ?? []);
    } finally {
      setTraceLoading(false);
    }
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
                {can('SALES') && o.status === 'ORDERED' && (
                  <>
                    <input type="number" min={0} step="0.01" value={whtInput[o.id] ?? ''} onChange={(e) => setWhtInput((s) => ({ ...s, [o.id]: e.target.value }))}
                      placeholder="WHT ฿" aria-label={`ภาษีหัก ณ ที่จ่าย ออเดอร์ ${o.orderNo}`}
                      title="ภาษีหัก ณ ที่จ่ายที่ลูกค้าหัก (ท.ป.4) — เงินโอนเข้า = ยอดค้าง − WHT; ว่าง = ไม่มี · อัตราร่วม: ค่าจ้างทั่วไป 3% · เช่า 5% · ขนส่ง 1%"
                      className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-right text-xs" />
                    <button onClick={() => markPaid(o)} className="px-3 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 text-xs">รับชำระ {baht(Math.max(0, o.total - o.paidAmount))}</button>
                  </>
                )}
                {can('MANAGER') && o.status === 'PAID' && <button onClick={() => transition(o, 'deliver', 'ส่งแล้ว')} className="px-3 py-1 rounded bg-sky-600/80 hover:bg-sky-500 text-xs">ส่งของ</button>}
                {/* เฟส 4: สถานะจัดส่งแบบเบา — ร้านส่งเอง */}
                {can('MANAGER') && o.status !== 'CANCELLED' && o.status !== 'QUOTE' && (o as any).shippingStatus !== 'DELIVERED' && (
                  <button onClick={() => updateShipping(o, (o as any).shippingStatus === 'PREPARING' ? 'SHIPPED' : 'PREPARING')}
                    className="px-3 py-1 rounded border border-sky-500/40 text-sky-300 text-xs hover:bg-sky-500/10">
                    {(o as any).shippingStatus === 'PREPARING' ? 'จัดส่งแล้ว' : 'กำลังเตรียมส่ง'}
                  </button>
                )}
                {(o as any).shippingStatus && <ShippingBadge status={(o as any).shippingStatus} />}
                {(o.status === 'PAID' || o.status === 'DELIVERED') && <button onClick={() => setInvoiceOrder(o)} className="px-3 py-1 rounded border border-slate-500/50 text-slate-200 text-xs hover:bg-slate-500/10">ใบกำกับภาษี</button>}
                <button onClick={() => openTrace(o)} className="px-3 py-1 rounded border border-emerald-600/40 text-emerald-300 text-xs hover:bg-emerald-500/10" title="ประวัติผลผลิตของสินค้าในออเดอร์นี้">ตามรอย</button>
                {can('MANAGER') && (o.status === 'QUOTE' || o.status === 'ORDERED') && <button onClick={() => transition(o, 'cancel', 'ยกเลิก')} className="px-3 py-1 rounded border border-rose-500/40 text-rose-300 text-xs hover:bg-rose-500/10">ยกเลิก</button>}
              </div>
            ))}

            {/* ── TRACEABILITY — แผงล็อตผลผลิตของออเดอร์ที่เลือก ── */}
            {traceOrder && (
              <div className="card p-4 space-y-3 border-emerald-600/30">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-emerald-300">🌾 ประวัติตามรอย — {traceOrder.orderNo}</span>
                  <button onClick={() => { setTraceOrder(null); setTraceLines(null); }} className="ml-auto text-slate-400 hover:text-slate-200 text-xs">ปิด</button>
                </div>
                {traceLoading && <div className="text-xs text-slate-500">กำลังโหลดล็อต…</div>}
                {!traceLoading && traceLines && traceLines.every((l) => l.lots.length === 0) && (
                  <div className="text-xs text-slate-500">สินค้าในออเดอร์นี้ยังไม่มีล็อตผลผลิต (ไม่ได้ผูกคลัง/ไม่ได้เก็บเกี่ยวผ่านระบบ)</div>
                )}
                {!traceLoading && (traceLines ?? []).map((line) => (
                  <div key={line.productId} className="border border-slate-800 rounded-lg p-3 space-y-2">
                    <div className="text-xs text-slate-400">สินค้า {line.productId} × {line.qty}</div>
                    {line.lots.map((lot: any) => (
                      <div key={lot.lotCode} className="bg-slate-900/60 border border-slate-800 rounded p-2 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="mono font-bold text-emerald-300">{lot.lotCode}</span>
                          {lot.crop && <span className="text-slate-400">{lot.crop}</span>}
                          {lot.plotName && <span className="text-slate-500">· {lot.plotName}</span>}
                          <span className="text-slate-500">· {lot.quantityKg} กก.</span>
                          <a href={lot.traceUrl} target="_blank" rel="noreferrer" className="ml-auto text-cyan-300 hover:text-cyan-200">ลิงก์ตามรอย ↗</a>
                        </div>
                        {lot.events.length > 0 && (
                          <div className="text-[11px] text-slate-400">
                            {lot.events.map((ev: any, i: number) => (
                              <span key={i} className="inline-flex items-center gap-1 mr-3">
                                <span className="text-emerald-400/80">•</span>{ev.type}{ev.detail ? ` — ${ev.detail}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
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
                <LedgerRow key={l.id} entry={l} canManage={can('MANAGER')} base={base} reload={load} setNotice={setNotice} />
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

      {/* ── ภาษี ── */}
      {tab === 'tax' && <BusinessTaxTab base={base} bizName={biz.name} />}

      {/* ── ผู้ช่วย AI ── */}
      {tab === 'agents' && <AgentsTab agents={agents} agentPrompt={agentPrompt} setAgentPrompt={setAgentPrompt} runAgent={runAgent} runningAgent={runningAgent} />}

      {/* ── หน้าร้าน (settings ร้านสาธารณะ) ── */}
      {tab === 'shop' && (
        <BusinessShopTab bizId={biz.id} bizName={biz.name} canManage={can('MANAGER')} base={base} setNotice={setNotice} refreshBiz={refreshBiz} />
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

      {/* ── ใบกำกับภาษี/ใบเสร็จ (พิมพ์/บันทึก PDF) ── */}
      {invoiceOrder && <TaxInvoice order={invoiceOrder} business={biz} onClose={() => setInvoiceOrder(null)} />}
    </div>
);
}
