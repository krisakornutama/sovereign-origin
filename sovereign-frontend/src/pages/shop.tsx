"use client";
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { fetchJsonObject } from '../lib/fetchJson';
import { getApiUrl } from '../lib/config';

// ────────────────────────────────────────────────────────────────────────────
// /shop — หน้าร้านสาธารณะ (ไม่ต้อง login) — ออกแบบตาม "สลิปบนเคาน์เตอร์ยามค่ำ"
//  - ?id=<businessId>  → หน้าร้าน: ดูสินค้า กรอกตะกร้า สั่งซื้อ
//  - ?order=<token>    → สถานะออเดอร์ผ่านลิงก์ลับ: ยอดค้าง + แจ้งชำระ PromptPay
//  URL อ่านใน useEffect เท่านั้น (กฎ hydration — NOTES.md)
//  ลิงก์สาธารณะจึงควรใช้ fetch ตรง ไม่ผ่าน authFetch (จะแนบ token ไปกับ request สาธารณะ)
//  ภาษาภาพ: font-ledger (สมุดบัญชีสลัก) สำหรับหัวข้อ/ยอดรวม, .mono สำหรับตัวเลขทุกบาท,
//  ขอบฉีก (shop-tear) เฉพาะแผงเงิน — อย่างเดียวพอ
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
const SEAL_CLS: Record<string, string> = { QUOTE: 'border-amber-400/60 text-amber-300', ORDERED: 'border-cyan-400/60 text-cyan-300', PAID: 'border-emerald-400/60 text-emerald-300', DELIVERED: 'border-emerald-400/60 text-emerald-300', CANCELLED: 'border-rose-400/60 text-rose-300' };

export default function ShopPage() {
  // mode ตัดสินจาก URL ใน useEffect (กัน hydration mismatch) — ก่อน mount แสดง skeleton เฉย ๆ
  // (ห้ามโชว์ "ไม่พบหน้าร้าน" ตอนยังไม่อ่าน URL = แวบผิดทุกครั้งที่เปิดลิงก์)
  const router = useRouter();
  const [route, setRoute] = useState<{ mode: 'store' | 'order'; key: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  // อ่าน URL ใหม่ทุกครั้งที่ asPath เปลี่ยน (ไม่ใช่แค่ mount) — _app.tsx แปลงคลิก <a> ภายใน
  // เป็น router.push หน้าเดียวกัน ทำให้ลิงก์ "ดูสถานะ/ชำระเงิน" หลังสั่งซื้อไม่ reload หน้า;
  // ถ้าอ่าน URL ครั้งเดียว ลูกค้าจะติดหน้าร้านทั้งที่ URL เปลี่ยนเป็นลิงก์ลับแล้ว (ต้องรีเฟรชเอง)
  useEffect(() => {
    const query = router.asPath.split('?')[1]?.split('#')[0] ?? '';
    const params = new URLSearchParams(query);
    const orderToken = params.get('order');
    const shopId = params.get('id');
    if (orderToken) setRoute({ mode: 'order', key: orderToken });
    else if (shopId) setRoute({ mode: 'store', key: shopId });
    else setRoute(null);
    setMounted(true);
  }, [router.asPath]);

  if (!route) return <ShopShell>{mounted ? <Empty title="ไม่พบหน้าร้าน" text="กรุณาใช้ลิงก์จากร้านค้า — ลิงก์จะมีรหัสร้านหรือรหัสออเดอร์ต่อท้าย" /> : <Loading label="กำลังเปิดหน้าร้าน…" />}</ShopShell>;
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
  const priceOf = (pid: string) => shop?.products.find((p) => p.id === pid)?.salePrice ?? 0;
  const subtotal = items.reduce((s, [pid, q]) => s + priceOf(pid) * q, 0);
  const vat = Math.round(subtotal * vatRate * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;
  const vatPct = (vatRate * 100).toFixed(1).replace(/\.0$/, '');

  function setQty(pid: string, q: number) {
    setCart((s) => ({ ...s, [pid]: Math.max(0, Math.min(99, Math.floor(q) || 0)) }));
  }

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
    return <ShopShell><Empty title="ร้านปิดรับออเดอร์แล้ว" text="ร้านอาจปิดให้บริการ — ติดต่อร้านผ่านช่องทางเดิมที่คุณใช้อยู่" /></ShopShell>;
  }
  if (!shop) {
    return <ShopShell><Loading label="กำลังเปิดสมุดร้าน…" /></ShopShell>;
  }

  return (
    <ShopShell>
      <div className="space-y-6">
        <header className="space-y-1 pt-2">
          <div className="mono text-[10px] tracking-[0.25em] uppercase text-emerald-400/80">หน้าร้านสาธารณะ</div>
          <h1 className="font-ledger text-2xl md:text-3xl font-bold text-gray-50 glow-text">{shop.name}</h1>
          <p className="text-xs text-gray-400">
            ราคารวม VAT {vatPct}% · สั่งซื้อออนไลน์ ร้านจะติดต่อกลับทางเบอร์ที่กรอก
          </p>
        </header>

        {ordered && (
          <div className="card p-4 space-y-2 border-emerald-500/30">
            <div className="flex items-baseline gap-2">
              <span className="font-ledger text-sm text-emerald-300">สั่งซื้อสำเร็จ</span>
              <span className="shop-leader" aria-hidden />
              <span className="mono text-sm text-emerald-300">{ordered.orderNo}</span>
            </div>
            <a href={`/shop?order=${ordered.token}`} className="inline-block px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">
              ดูสถานะ / ชำระเงิน →
            </a>
            <div className="text-[11px] text-gray-500 break-all">
              เก็บลิงก์นี้ไว้เช็คสถานะได้โดยไม่ต้อง login: {`${typeof window !== 'undefined' ? window.location.origin : ''}/shop?order=${ordered.token}`}
            </div>
          </div>
        )}
        {error && <div className="card p-3 text-sm text-rose-300 border-rose-500/40">{error}</div>}

        {/* สินค้า — รายการแบบสมุดบัญชี (เส้นประจัดบรรทัดราคา) */}
        <section className="card px-5 py-3">
          <h2 className="font-ledger text-sm text-gray-300 py-2 border-b border-gray-800">สินค้าของร้าน</h2>
          {shop.products.length === 0 && <div className="py-6 text-sm text-gray-500">ร้านยังไม่มีสินค้า — สินค้าจะแสดงที่นี่เมื่อร้านเพิ่ม</div>}
          {shop.products.map((p) => (
            <div key={p.id} className={`py-3 border-b border-dashed border-gray-800/80 last:border-0 ${p.inStock ? '' : 'opacity-50'}`}>
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-[15px] text-gray-100">{p.name}</span>
                <span className="shop-leader" aria-hidden />
                <span className="mono text-emerald-300 font-semibold">{baht(p.salePrice)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500 mt-0.5">
                <span>{p.category}</span>
                {p.warrantyMonths > 0 && <span>· รับประกัน {p.warrantyMonths} เดือน</span>}
                {p.specs && <span className="truncate max-w-[16rem]">· {p.specs}</span>}
                <span className="ml-auto">{p.inStock ? <span className="text-emerald-400">มีสินค้า</span> : <span className="text-rose-400">สินค้าหมด</span>}</span>
              </div>
              {p.inStock && (
                <div className="flex items-center justify-end gap-1 mt-1.5">
                  <button type="button" aria-label={`ลดจำนวน ${p.name}`} disabled={(cart[p.id] ?? 0) === 0}
                    onClick={() => setQty(p.id, (cart[p.id] ?? 0) - 1)}
                    className="h-7 w-7 rounded-md border border-gray-700 text-gray-300 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-30">−</button>
                  <input type="number" min={0} max={99} value={cart[p.id] ?? 0}
                    onChange={(e) => setQty(p.id, Number(e.target.value))}
                    className="w-14 bg-gray-800/60 border border-gray-700 rounded-md px-1 py-1 text-center mono text-sm" aria-label={`จำนวน ${p.name}`} />
                  <button type="button" aria-label={`เพิ่มจำนวน ${p.name}`} disabled={(cart[p.id] ?? 0) >= 99}
                    onClick={() => setQty(p.id, (cart[p.id] ?? 0) + 1)}
                    className="h-7 w-7 rounded-md border border-gray-700 text-gray-300 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-30">+</button>
                </div>
              )}
            </div>
          ))}
        </section>

        {/* สรุปคำสั่งซื้อ — สลิปขอบฉีก (signature) */}
        <section className="shop-tear shop-paper px-5 py-4 space-y-3">
          <h2 className="font-ledger text-sm text-gray-300">สรุปคำสั่งซื้อ</h2>
          {items.length === 0 ? (
            <div className="text-sm text-gray-500">ยังไม่ได้เลือกสินค้า — กด + ในรายการด้านบนเพื่อเริ่ม</div>
          ) : (
            <div className="space-y-1 text-sm">
              {items.map(([pid, q]) => {
                const p = shop.products.find((x) => x.id === pid)!;
                return (
                  <div key={pid} className="flex items-baseline">
                    <span className="text-gray-300">{p.name} × {q}</span>
                    <span className="shop-leader" aria-hidden />
                    <span className="mono">{baht(priceOf(pid) * q)}</span>
                  </div>
                );
              })}
              <div className="flex items-baseline text-xs text-gray-400 pt-1">
                <span>ยอดรวมก่อน VAT</span><span className="shop-leader" aria-hidden /><span className="mono">{baht(subtotal)}</span>
              </div>
              <div className="flex items-baseline text-xs text-gray-400">
                <span>VAT {vatPct}%</span><span className="shop-leader" aria-hidden /><span className="mono">{baht(vat)}</span>
              </div>
              <div className="flex items-baseline font-ledger font-semibold text-emerald-300 pt-1 border-t border-dashed border-gray-700/70">
                <span>รวมทั้งสิ้น</span><span className="shop-leader" aria-hidden /><span className="mono text-base">{baht(total)}</span>
              </div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-2 pt-1">
            <input placeholder="ชื่อผู้ซื้อ *" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" aria-label="ชื่อผู้ซื้อ" />
            <input placeholder="เบอร์โทรศัพท์ *" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" aria-label="เบอร์โทรศัพท์" />
            <input placeholder="หมายเหตุ (ที่อยู่/เวลาสะดวก)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm sm:col-span-2" aria-label="หมายเหตุ" />
          </div>
          <button onClick={placeOrder} disabled={busy || items.length === 0}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-sm text-white disabled:opacity-40">
            {busy ? 'กำลังส่งคำสั่งซื้อ…' : 'ยืนยันคำสั่งซื้อ'}
          </button>
        </section>

        <footer className="text-center text-[10px] text-gray-600 pt-2">ร้านค้านี้ดำเนินการผ่านระบบ Sovereign OS</footer>
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
    return <ShopShell><Empty title="ไม่พบออเดอร์นี้" text="ลิงก์อาจไม่ถูกต้อง — ลองตรวจลิงก์จากข้อความของร้านอีกครั้ง" /></ShopShell>;
  }
  if (!order) {
    return <ShopShell><Loading label="กำลังเปิดใบสรุป…" /></ShopShell>;
  }

  const payable = order.remaining > 0 && (order.status === 'QUOTE' || order.status === 'ORDERED');
  const fullyPaid = order.remaining <= 0.001 && order.status !== 'CANCELLED';

  return (
    <ShopShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center gap-3 pt-2">
          <div>
            <div className="mono text-[10px] tracking-[0.25em] uppercase text-cyan-400/80">ลิงก์ลับ · ใบสรุปคำสั่งซื้อ</div>
            <h1 className="font-ledger text-xl md:text-2xl font-bold text-gray-50">{order.orderNo}</h1>
          </div>
          <span className={`shop-seal ml-auto text-center leading-tight max-w-[10rem] ${SEAL_CLS[order.status] ?? 'border-gray-500/60 text-gray-300'}`}>
            {STATUS_TH[order.status] ?? order.status}
          </span>
        </header>

        {/* ใบสรุปยอด — สลิปขอบฉีก (signature) */}
        <section className="shop-tear shop-paper px-5 py-4 space-y-1 text-sm">
          {order.lines.map((l, i) => (
            <div key={i} className="flex items-baseline">
              <span className="text-gray-300">{l.name} × {l.qty}</span>
              <span className="shop-leader" aria-hidden />
              <span className="mono">{baht(l.unitPrice * l.qty)}</span>
            </div>
          ))}
          <div className="flex items-baseline text-xs text-gray-400 pt-1">
            <span>ยอดรวมก่อน VAT</span><span className="shop-leader" aria-hidden /><span className="mono">{baht(order.subtotal)}</span>
          </div>
          <div className="flex items-baseline text-xs text-gray-400">
            <span>VAT</span><span className="shop-leader" aria-hidden /><span className="mono">{baht(order.vat)}</span>
          </div>
          <div className="flex items-baseline font-ledger font-semibold pt-1 border-t border-dashed border-gray-700/70">
            <span className="text-gray-200">รวมทั้งสิ้น</span><span className="shop-leader" aria-hidden /><span className="mono text-base text-gray-50">{baht(order.total)}</span>
          </div>
          {order.paidAmount > 0 && (
            <div className="flex items-baseline text-xs text-emerald-300">
              <span>แจ้งชำระแล้ว ({order.payments.length} ครั้ง)</span><span className="shop-leader" aria-hidden /><span className="mono">−{baht(order.paidAmount)}</span>
            </div>
          )}
          <div className="flex items-baseline font-ledger font-semibold text-amber-300 pt-1 border-t border-dashed border-gray-700/70">
            <span>ค้างชำระ</span><span className="shop-leader" aria-hidden /><span className="mono text-base">{baht(order.remaining)}</span>
          </div>
        </section>

        {notice && (
          <div className={`card p-3 text-sm ${notice.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-rose-500/40 text-rose-300'}`}>
            {notice.text}
          </div>
        )}

        {payable && (
          <section className="card panel-glow p-4 space-y-3">
            <h2 className="font-ledger text-sm text-gray-300">ชำระเงิน{order.shop ? ` — ${order.shop.name}` : ''}</h2>
            {qr?.configured && qr.qrDataUrl ? (
              <div className="flex flex-wrap items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.qrDataUrl} alt="QR PromptPay" width={160} height={160} className="rounded-lg bg-white p-1" />
                <div className="text-xs text-gray-400 space-y-1">
                  <div>สแกนด้วยแอปธนาคาร — QR นี้ฝังยอด <span className="mono text-amber-300 font-semibold">{baht(qr.amountThb ?? order.remaining)}</span> ไว้แล้ว</div>
                  {qr.maskedTarget && <div>รับด้วย PromptPay <span className="mono">{qr.maskedTarget}</span></div>}
                  <div>โอนแล้วกด “แจ้งชำระเงิน” ด้านล่างเพื่อบอกร้าน</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">ร้านยังไม่ได้ตั้ง QR PromptPay — โอนผ่านแอปธนาคารตามช่องทางที่ร้านแจ้ง แล้วกด “แจ้งชำระเงิน” เพื่อบอกยอดที่โอน</p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-[11px] text-gray-500 mb-1" htmlFor="shop-pay-amount">จำนวนเงินที่โอน (บาท)</label>
                <input id="shop-pay-amount" type="number" min="0" step="0.01" value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={String(order.remaining)}
                  className="w-40 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm mono" />
              </div>
              <button type="button" onClick={() => setPayAmount(String(order.remaining))} className="px-3 py-2 rounded-lg border border-gray-600 text-xs hover:bg-gray-700/40">เต็มยอด</button>
              <button type="button" onClick={reportPayment} disabled={busy}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white disabled:opacity-40">
                {busy ? 'กำลังแจ้ง…' : 'แจ้งชำระเงิน'}
              </button>
            </div>
          </section>
        )}

        {fullyPaid && (
          <div className="card p-4 text-sm text-emerald-300 border-emerald-500/40">
            ชำระครบแล้ว — ร้านจะจัดส่งตามนัดหมาย
          </div>
        )}

        <footer className="text-center text-[10px] text-gray-600 pt-2">ร้านค้านี้ดำเนินการผ่านระบบ Sovereign OS</footer>
      </div>
    </ShopShell>
  );
}

// ── shared shell (ไม่มี Sidebar — หน้าสาธารณะนอกระบบ login) ──
function ShopShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-gray-100">
      <Head>
        <title>หน้าร้าน — Sovereign</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="max-w-3xl mx-auto p-4 md:p-6">{children}</div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="py-16 space-y-3 animate-pulse" role="status" aria-live="polite">
      <div className="h-3 w-28 bg-gray-800/80 rounded" />
      <div className="h-6 w-52 bg-gray-800/80 rounded" />
      <div className="h-3 w-72 bg-gray-800/60 rounded" />
      <div className="text-xs text-gray-500 mono pt-2">{label}</div>
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="text-center py-20 space-y-2">
      <div className="mono text-[10px] tracking-[0.25em] uppercase text-gray-500">sovereign · shop</div>
      <h1 className="font-ledger text-xl font-bold text-gray-300">{title}</h1>
      <div className="text-sm text-gray-500">{text}</div>
      <a href="/" className="inline-block text-xs text-cyan-400 hover:underline pt-1">กลับหน้าแรก</a>
    </div>
  );
}
