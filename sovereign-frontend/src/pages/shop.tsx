"use client";
import { useState, useEffect, useCallback } from 'react';
import { fetchJsonObject } from '../lib/fetchJson';
import { getApiUrl } from '../lib/config';

// ────────────────────────────────────────────────────────────────────────────
// /shop — หน้าร้านสาธารณะ (ไม่ต้อง login)
//  - ?id=<businessId>  → หน้าร้าน: ดูสินค้า กรอกตะกร้า สั่งซื้อ
//  - ?order=<token>    → สถานะออเดอร์ผ่านลิงก์ลับ: ยอดค้าง + แจ้งชำระ PromptPay
//  URL อ่านใน useEffect เท่านั้น (กฎ hydration — NOTES.md)
//  ลิงก์สาธารณะจึงควรใช้ fetch ตรง ไม่ผ่าน authFetch (จะแนบ token ไปกับ request สาธารณะ)
// ────────────────────────────────────────────────────────────────────────────

interface ShopProduct { id: string; name: string; category: string; specs?: string | null; salePrice: number; warrantyMonths: number; inStock: boolean; }
interface Shop { id: string; name: string; vatRate: number; products: ShopProduct[]; }
interface OrderStatus {
  orderNo: string; status: string; subtotal: number; vat: number; total: number;
  paidAmount: number; remaining: number;
  shop?: { id: string; name: string };
  lines: Array<{ name: string; qty: number; unitPrice: number }>;
  payments: Array<{ amount: number; method: string; paidAt: string }>;
}
interface PromptPayInfo { configured: boolean; qrDataUrl?: string; maskedTarget?: string; amountThb?: number; }

const API = `${getApiUrl()}/api/shop`;
const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;
const STATUS_TH: Record<string, string> = { QUOTE: 'รอร้านยืนยัน', ORDERED: 'รอชำระเงิน', PAID: 'ชำระแล้ว — ร้านกำลังเตรียมส่ง', DELIVERED: 'จัดส่งแล้ว', CANCELLED: 'ยกเลิกแล้ว' };

export default function ShopPage() {
  // mode ตัดสินจาก URL ใน useEffect (กัน hydration mismatch)
  const [route, setRoute] = useState<{ mode: 'store' | 'order'; key: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderToken = params.get('order');
    const shopId = params.get('id');
    if (orderToken) setRoute({ mode: 'order', key: orderToken });
    else if (shopId) setRoute({ mode: 'store', key: shopId });
  }, []);

  if (!route) return <ShopShell><Empty text="ไม่พบหน้าร้าน — กรุณาใช้ลิงก์จากร้านค้า" /></ShopShell>;
  if (route.mode === 'order') return <OrderView key={route.key} token={route.key} />;
  return <Storefront key={route.key} businessId={route.key} />;
}

// ── หน้าร้าน: สินค้า + ตะกร้า + สั่งซื้อ ──
function Storefront({ businessId }: { businessId: string }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ customerName: '', customerPhone: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [ordered, setOrdered] = useState<{ orderNo: string; token: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchJsonObject<Shop>(`${API}/${businessId}`).then((data) => {
      if (!data) setNotFound(true);
      else setShop(data);
    });
  }, [businessId]);

  const items = Object.entries(cart).filter(([, q]) => q > 0);
  const vatRate = shop?.vatRate ?? 0;
  const subtotal = items.reduce((s, [pid, q]) => s + (shop?.products.find((p) => p.id === pid)?.salePrice ?? 0) * q, 0);
  const vat = Math.round(subtotal * vatRate * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;

  async function placeOrder() {
    if (!form.customerName.trim() || !form.customerPhone.trim()) {
      setError('กรอกชื่อและเบอร์โทรก่อนสั่งซื้อ');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/${businessId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, items: items.map(([productId, qty]) => ({ productId, qty })) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'สั่งซื้อไม่สำเร็จ');
      setOrdered({ orderNo: data.orderNo, token: data.publicToken });
      setCart({});
      setForm({ customerName: '', customerPhone: '', note: '' });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return <ShopShell><Empty text="ไม่พบร้านนี้ — ร้านอาจปิดให้บริการแล้ว" /></ShopShell>;
  }
  if (!shop) {
    return <ShopShell><div className="text-sm text-slate-500">กำลังโหลดร้าน…</div></ShopShell>;
  }

  return (
    <ShopShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">🛍️ {shop.name}</h1>
          <p className="text-xs text-slate-500">ราคารวม VAT {(vatRate * 100).toFixed(1).replace(/\.0$/, '')}% — สั่งซื้อออนไลน์ ร้านจะติดต่อกลับทางเบอร์ที่กรอก</p>
        </div>

        {ordered && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300 space-y-2">
            <div>สั่งซื้อสำเร็จ เลขที่ {ordered.orderNo}</div>
            <div>
              <a href={`/shop?order=${ordered.token}`} className="inline-block px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">
                ดูสถานะ / ชำระเงิน →
              </a>
            </div>
            <div className="text-[11px] text-slate-400 break-all">ลิงก์ของคุณ: {`${typeof window !== 'undefined' ? window.location.origin : ''}/shop?order=${ordered.token}`} — เก็บไว้เช็คสถานะได้โดยไม่ต้อง login</div>
          </div>
        )}
        {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

        {/* สินค้า */}
        <div className="grid sm:grid-cols-2 gap-2">
          {shop.products.map((p) => (
            <div key={p.id} className={`card p-3 space-y-1 ${p.inStock ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{p.name}</span>
                <span className="ml-auto font-bold text-emerald-300">{baht(p.salePrice)}</span>
              </div>
              {p.specs && <div className="text-[11px] text-slate-400">{p.specs}</div>}
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span>{p.category}</span>
                {p.warrantyMonths > 0 && <span>· รับประกัน {p.warrantyMonths} เดือน</span>}
                <span className="ml-auto">{p.inStock ? <span className="text-emerald-400">มีสินค้า</span> : <span className="text-rose-400">สินค้าหมด</span>}</span>
              </div>
              {p.inStock && (
                <input type="number" min={0} max={99} value={cart[p.id] ?? 0}
                  onChange={(e) => setCart((s) => ({ ...s, [p.id]: Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0))) }))}
                  className="w-20 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-right" aria-label={`จำนวน ${p.name}`} placeholder="จำนวน" />
              )}
            </div>
          ))}
          {shop.products.length === 0 && <div className="text-sm text-slate-500">ร้านยังไม่มีสินค้า</div>}
        </div>

        {/* ตะกร้า + ข้อมูลผู้ซื้อ */}
        <div className="card p-4 space-y-3">
          <div className="text-sm font-semibold">🧺 สรุปคำสั่งซื้อ</div>
          {items.length === 0 ? (
            <div className="text-sm text-slate-500">ยังไม่ได้เลือกสินค้า</div>
          ) : (
            <div className="space-y-1 text-sm">
              {items.map(([pid, q]) => {
                const p = shop.products.find((x) => x.id === pid)!;
                return (
                  <div key={pid} className="flex justify-between">
                    <span className="text-slate-300">{p.name} × {q}</span>
                    <span>{baht(p.salePrice * q)}</span>
                  </div>
                );
              })}
              <div className="border-t border-slate-800 pt-1 flex justify-between text-slate-400 text-xs">
                <span>ยอดรวมก่อน VAT</span><span>{baht(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-400 text-xs">
                <span>VAT {(vatRate * 100).toFixed(1).replace(/\.0$/, '')}%</span><span>{baht(vat)}</span>
              </div>
              <div className="flex justify-between font-bold text-emerald-300">
                <span>รวมทั้งสิ้น</span><span>{baht(total)}</span>
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-2">
            <input placeholder="ชื่อผู้ซื้อ *" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" aria-label="ชื่อผู้ซื้อ" />
            <input placeholder="เบอร์โทรศัพท์ *" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" aria-label="เบอร์โทรศัพท์" />
            <input placeholder="หมายเหตุ (ที่อยู่/เวลาสะดวก)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm sm:col-span-2" aria-label="หมายเหตุ" />
          </div>
          <button onClick={placeOrder} disabled={busy || items.length === 0}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-sm disabled:opacity-40">
            {busy ? 'กำลังสั่ง…' : 'สั่งซื้อ'}
          </button>
        </div>
      </div>
    </ShopShell>
  );
}

// ── สถานะออเดอร์ผ่านลิงก์ลับ + แจ้งชำระ ──
function OrderView({ token }: { token: string }) {
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [qr, setQr] = useState<PromptPayInfo | null>(null);

  const load = useCallback(async () => {
    const data = await fetchJsonObject<OrderStatus>(`${API}/orders/${token}`);
    if (data) setOrder(data);
    else setNotFound(true);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  // QR PromptPay — ดึงเมื่อรู้ร้าน + มียอดค้าง (payload QR ฝังยอดค้างให้โอนถูกตัว)
  useEffect(() => {
    if (!order?.shop?.id || order.remaining <= 0) { setQr(null); return; }
    fetchJsonObject<PromptPayInfo>(`${API}/${order.shop.id}/promptpay?amount=${order.remaining}`).then(setQr);
  }, [order?.shop?.id, order?.remaining]);

  // รีเฟรชเองทุก 15 วิขณายังค้างชำระ (ออเดอร์จบ = หยุด poll)
  const unpaid = Boolean(order && order.remaining > 0);
  useEffect(() => {
    if (!unpaid) return;
    const t = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(t);
  }, [unpaid, load]);

  async function reportPayment() {
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setNotice({ ok: false, text: 'กรอกจำนวนเงินที่โอน' }); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API}/orders/${token}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'แจ้งชำระไม่สำเร็จ');
      setNotice({ ok: true, text: 'แจ้งชำระแล้ว — ร้านจะตรวจสอบเงินเข้าและยืนยันอีกครั้ง' });
      setPayAmount('');
      await load();
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return <ShopShell><Empty text="ไม่พบออเดอร์นี้ — ลิงก์อาจไม่ถูกต้อง" /></ShopShell>;
  }
  if (!order) {
    return <ShopShell><div className="text-sm text-slate-500">กำลังโหลดสถานะ…</div></ShopShell>;
  }

  return (
    <ShopShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold">🧾 ออเดอร์ {order.orderNo}</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">{STATUS_TH[order.status] ?? order.status}</span>
        </div>

        <div className="card p-4 space-y-1 text-sm">
          {order.lines.map((l, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-slate-300">{l.name} × {l.qty}</span>
              <span>{baht(l.unitPrice * l.qty)}</span>
            </div>
          ))}
          <div className="border-t border-slate-800 pt-1 flex justify-between text-slate-400 text-xs">
            <span>ยอดรวมก่อน VAT</span><span>{baht(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-400 text-xs"><span>VAT</span><span>{baht(order.vat)}</span></div>
          <div className="flex justify-between font-bold"><span>รวมทั้งสิ้น</span><span>{baht(order.total)}</span></div>
          {order.paidAmount > 0 && (
            <div className="flex justify-between text-emerald-300 text-xs">
              <span>แจ้งชำระแล้ว ({order.payments.length} ครั้ง)</span><span>−{baht(order.paidAmount)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-amber-300 border-t border-slate-800 pt-1">
            <span>ค้างชำระ</span><span>{baht(order.remaining)}</span>
          </div>
        </div>

        {notice && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
            {notice.text}
          </div>
        )}

        {order.remaining > 0 && (order.status === 'QUOTE' || order.status === 'ORDERED') && (
          <div className="card p-4 space-y-3">
            <div className="text-sm font-semibold">💳 ชำระเงิน{order.shop ? ` — ${order.shop.name}` : ''}</div>
            {qr?.configured && qr.qrDataUrl ? (
              <div className="flex flex-wrap items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.qrDataUrl} alt="QR PromptPay" width={160} height={160} className="rounded-lg bg-white p-1" />
                <div className="text-xs text-slate-400 space-y-1">
                  <div>📱 สแกนด้วยแอปธนาคาร — QR นี้ฝังยอด <span className="text-amber-300 font-semibold">{baht(qr.amountThb ?? order.remaining)}</span> ไว้แล้ว</div>
                  {qr.maskedTarget && <div>รับด้วย PromptPay {qr.maskedTarget}</div>}
                  <div>โอนแล้วกด “แจ้งชำระเงิน” ด้านล่างเพื่อบอกร้าน</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">ร้านยังไม่ได้ตั้ง QR PromptPay — โอนผ่านแอปธนาคารตามช่องทางที่ร้านแจ้ง แล้วกด “แจ้งชำระเงิน” เพื่อบอกยอดที่โอน</p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1" htmlFor="shop-pay-amount">จำนวนเงินที่โอน (บาท)</label>
                <input id="shop-pay-amount" type="number" min="0" step="0.01" value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={String(order.remaining)}
                  className="w-40 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
              <button onClick={() => setPayAmount(String(order.remaining))} className="px-3 py-2 rounded-lg border border-slate-600 text-xs hover:bg-slate-700/40">เต็มยอด</button>
              <button onClick={reportPayment} disabled={busy}
                className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-medium disabled:opacity-40">
                {busy ? 'กำลังแจ้ง…' : 'แจ้งชำระเงิน'}
              </button>
            </div>
          </div>
        )}

        {order.remaining <= 0.001 && order.status !== 'CANCELLED' && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            ✅ ชำระครบแล้ว — ขอบคุณครับ/ค่ะ ร้านจะจัดส่งตามนัดหมาย
          </div>
        )}
      </div>
    </ShopShell>
  );
}

// ── shared shell (ไม่มี Sidebar — หน้าสาธารณะนอกระบบ login) ──
function ShopShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto p-4 md:p-6">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-center py-16 space-y-2">
      <div className="text-4xl">🏪</div>
      <div className="text-sm text-slate-400">{text}</div>
      <a href="/" className="inline-block text-xs text-cyan-400 hover:underline">กลับหน้าแรก</a>
    </div>
  );
}
