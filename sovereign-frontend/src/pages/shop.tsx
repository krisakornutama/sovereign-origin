"use client";
import { useState, useEffect, useCallback } from 'react';
import SeoHead from '../components/public/SeoHead';
import { useRouter } from 'next/router';
import { fetchJsonObject } from '../lib/fetchJson';
import { getApiUrl } from '../lib/config';
import { FeedbackButton } from '../components/public/FeedbackButton';
import { FounderCredit } from '../components/public/FounderCredit';
import { trackPageView, trackCtaClick, trackQuestion } from '../lib/visitorTrack';
import ShopPublicLanding from '../components/public/ShopPublicLanding';
import { isPublicHostname, isLocalHostname } from '../lib/publicAccess';

// ────────────────────────────────────────────────────────────────────────────
// /shop — หน้าร้านสาธารณะ (ไม่ต้อง login) — ออกแบบตาม "สลิปบนเคาน์เตอร์ยามค่ำ"
//  - ?id=<businessId>  → หน้าร้าน: ดูสินค้า กรอกตะกร้า สั่งซื้อ
//  - ?order=<token>    → สถานะออเดอร์ผ่านลิงก์ลับ: ยอดค้าง + แจ้งชำระ PromptPay
//  URL อ่านใน useEffect เท่านั้น (กฎ hydration — NOTES.md)
//  ลิงก์สาธารณะจึงควรใช้ fetch ตรง ไม่ผ่าน authFetch (จะแนบ token ไปกับ request สาธารณะ)
//  ภาษาภาพ: font-ledger (สมุดบัญชีสลัก) สำหรับหัวข้อ/ยอดรวม, .mono สำหรับตัวเลขทุกบาท,
//  ขอบฉีก (shop-tear) เฉพาะแผงเงิน — อย่างเดียวพอ
// ────────────────────────────────────────────────────────────────────────────

interface ShopProduct { id: string; name: string; category: string; specs?: string | null; salePrice: number; warrantyMonths: number; inStock: boolean; inventoryItemId?: string | null; }
interface LotEvent { type: string; detail: string | null; at: string; }
interface LotStory { lotCode: string; crop: string | null; quantityKg: number; harvestedAt: string; plotName: string | null; sold: boolean; traceUrl: string; events: LotEvent[]; }
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
const TRACE_API = `${getApiUrl()}/api/trace`;
const LOT_EVENT_TH: Record<string, string> = { HARVESTED: 'เก็บเกี่ยว', PROCESSED: 'แปรรูป', TESTED: 'ตรวจคุณภาพ', SOLD: 'ขายแล้ว', DELIVERED: 'ส่งมอบแล้ว', RESTOCKED: 'กลับเข้าคลัง', CONSUMED: 'ใช้ทำอาหาร', NOTE: 'บันทึก' };
const lotEventTh = (t: string) => LOT_EVENT_TH[t] ?? t;
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
  // P24 ต่อ 4 (3/10/69): แยก "นับ pageview + อ่านลิงก์ชัดเจน" ออกจาก "โหลดร้าน default"
  //   เดิมทั้งสองอย่างอยู่ effect เดียวที่ deps = [router.asPath] แต่มี guard `else if (mounted)`
  //   → รอบแรกบน mount mounted=false เสมอ = ไม่ fetch · และ asPath ไม่เปลี่ยน = effect ไม่รันซ้ำ
  //   ผล = เจตนา "โดเมนเปล่าเจอร้านอุปกรณ์ทันที" ไม่เคยเกิด (พิสูจน์จาก network log: ไม่มี request เลย)
  //   และการแก้แบบใส่ `mounted` ลง deps ตรง ๆ = trackPageView ยิงซ้ำ 2 ครั้ง (analytics เพี้ยน)
  //   → ตอนนี้แต่ละเรื่องมีเจ้าของ effect ของตัวเอง: A = pageview + ?id/?order · B = ร้าน default
  useEffect(() => {
    trackPageView('/shop'); // P10: สถิติการเยือน (cookieless) — ยิงครั้งเดียวต่อการเปลี่ยน URL
    const query = router.asPath.split('?')[1]?.split('#')[0] ?? '';
    const params = new URLSearchParams(query);
    const orderToken = params.get('order');
    const shopId = params.get('id');
    if (orderToken) setRoute({ mode: 'order', key: orderToken });
    else if (shopId) setRoute({ mode: 'store', key: shopId });
    setMounted(true);
  }, [router.asPath]);

  // ร้าน default — รันเมื่อ URL ไม่มี ?id/?order เท่านั้น (มีลิงก์ชัดเจน = effect A จัดการ)
  useEffect(() => {
    const query = router.asPath.split('?')[1]?.split('#')[0] ?? '';
    const params = new URLSearchParams(query);
    if (params.get('order') || params.get('id')) return;
    let cancelled = false; // unmount/เปลี่ยน URL ก่อนตอบ = อย่าเขียน state ทิ้งหลัง
    // P: Publishing — ไม่ใส่ ?id/?order = หน้าร้าน default (ร้านแรกใน catalog กลาง)
    // โดเมนเปล่าเจอร้านอุปกรณ์ทันที ไม่ต้องรู้ businessId
    fetchJsonObject<{ shops: Array<{ id: string }> }>(`${getApiUrl()}/api/shop/community`)
      .then((d) => {
        if (cancelled) return;
        const first = d?.shops?.[0]?.id;
        setRoute(first ? { mode: 'store', key: first } : null);
      })
      .catch(() => { if (!cancelled) setRoute(null); });
    return () => { cancelled = true; };
  }, [router.asPath]);

  // P24 (3/10/69): ยังไม่รู้รหัสร้าน (ตอน SSR หรือ fetch ไม่ได้ผล) ให้หน้าแนะนำที่มี h1 + เนื้อหาสำหรับผู้มาเยือน
  const showPublic = isPublicHostname() && !(mounted && isLocalHostname());
  if (!route) return showPublic ? <ShopPublicLanding /> : <ShopShell>{mounted ? <Empty title="ไม่พบหน้าร้าน" text="กรุณาใช้ลิงก์จากร้านค้า — ลิงก์จะมีรหัสร้านหรือรหัสออเดอร์ต่อท้าย" /> : <Loading label="กำลังเปิดหน้าร้าน…" />}</ShopShell>;
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
  const [lotStories, setLotStories] = useState<Record<string, LotStory[]>>({});

  useEffect(() => {
    fetchJsonObject<Shop>(`${API}/${businessId}`).then((data) => {
      if (!data) setNotFound(true);
      else setShop(data);
    });
  }, [businessId]);

  // I5a — สายผลผลิตสด Farm→Shop: ดึงล็อตของสินค้าที่ผูกวัตถุดิบ (best-effort — พัง = ไม่โชว์การ์ด)
  useEffect(() => {
    if (!shop) return;
    const ids = [...new Set(shop.products.map((p) => p.inventoryItemId).filter(Boolean))] as string[];
    if (ids.length === 0) return;
    fetch(`${TRACE_API}/products?ids=${encodeURIComponent(ids.join(','))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.products) setLotStories(data.products); })
      .catch(() => {});
  }, [shop]);

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
      setError('กรอกชื่อและเบอร์โทรผู้สนับสนุนก่อนยืนยัน');
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
      if (!res.ok) throw new Error(data?.error ?? 'ยืนยันไม่สำเร็จ ลองใหม่อีกครั้ง');
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
    return <ShopShell><Empty title="ปิดรับการสนับสนุนรอบนี้" text="ขณะนี้ยังไม่เปิดรับ — กดปุ่ม 💬 ความคิดเห็นเพื่อแจ้งความสนใจ แล้วทีมงานจะติดต่อกลับเมื่อเปิดรอบใหม่" /></ShopShell>;
  }
  if (!shop) {
    return <ShopShell><Loading label="กำลังเปิดสมุดร้าน…" /></ShopShell>;
  }

  return (
    <ShopShell>
      <div className="space-y-6">
        <header className="space-y-1 pt-2">
          <div className="mono text-[10px] tracking-[0.25em] uppercase text-emerald-400/80">สนับสนุนโครงการโดยตรง</div>
          <h1 className="font-ledger text-2xl md:text-3xl font-bold text-gray-50 glow-text">{shop.name}</h1>
          <p className="text-xs text-gray-400">
            เลือกชิ้นงานที่อยากสนับสนุน — ราคาสนับสนุน (รวม VAT {vatPct}%) · ทีมงานติดต่อกลับทางเบอร์ที่กรอกเพื่อจัดส่ง/ติดตั้ง
          </p>
        </header>

        {ordered && (
          <div className="card p-4 space-y-2 border-emerald-500/30">
            <div className="flex items-baseline gap-2">
              <span className="font-ledger text-sm text-emerald-300">ยืนยันการสนับสนุนแล้ว</span>
              <span className="shop-leader" aria-hidden />
              <span className="mono text-sm text-emerald-300">{ordered.orderNo}</span>
            </div>
            <a href={`/shop?order=${ordered.token}`} className="inline-block px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium">
              ติดตามสถานะ / โอนสนับสนุน →
            </a>
            <div className="text-[11px] text-gray-500 break-all">
              เก็บลิงก์นี้ไว้เช็คสถานะได้โดยไม่ต้อง login: {`${typeof window !== 'undefined' ? window.location.origin : ''}/shop?order=${ordered.token}`}
            </div>
          </div>
        )}
        {error && <div className="card p-3 text-sm text-rose-300 border-rose-500/40">{error}</div>}

        {/* ขั้นตอนสนับสนุน — เห็นก่อนกด (P14→P15 ภาษาองค์กรไม่แสวงหากำไร) */}
        <div className="card px-4 py-2.5 text-[11px] text-gray-400 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-ledger text-gray-300 text-xs mr-1">วิธีสนับสนุน</span>
          <span>① กด <b className="text-emerald-300">สนับสนุนชิ้นนี้</b> ที่ชิ้นงานที่สนใจ</span>
          <span>② กรอกชื่อ+เบอร์ติดต่อ</span>
          <span>③ ยืนยัน</span>
          <span>④ รับลิงก์โอน <b className="text-emerald-300">PromptPay</b> ทันที — ติดตามสถานะได้ตลอด</span>
        </div>

        {/* ชิ้นงานสนับสนุน — รายการแบบสมุดบัญชี (เส้นประจัดบรรทัดยอดสนับสนุน) */}
        <section className="card px-5 py-3">
          <h2 className="font-ledger text-sm text-gray-300 py-2 border-b border-gray-800">ชิ้นงานที่เปิดให้สนับสนุน</h2>
          {shop.products.filter((p) => p.category !== 'SUPPORT').length === 0 && <div className="py-6 text-sm text-gray-500">ยังไม่มีชิ้นงานที่เปิดให้สนับสนุน — จะแสดงที่นี่เมื่อเปิดรอบใหม่</div>}
          {shop.products.filter((p) => p.category !== 'SUPPORT').map((p) => (
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
              {(() => {
                const story = (p.inventoryItemId && lotStories[p.inventoryItemId]?.[0]) || null;
                if (!story) return null;
                const harvest = story.events.find((e) => e.type === 'HARVESTED');
                const soldEvt = story.events.find((e) => e.type === 'SOLD');
                return (
                  <div className="mt-2 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
                      <span className="text-emerald-400 font-medium">บัตรหลักฐานการผลิต</span>
                      {story.plotName && <span className="text-gray-500">· {story.plotName}</span>}
                      {story.quantityKg > 0 && <span className="mono text-gray-500">· {story.quantityKg.toLocaleString('th-TH')} กก.</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 leading-relaxed">
                      ล็อต <span className="mono text-gray-300">{story.lotCode}</span>
                      {harvest && <> — เก็บเมื่อ {new Date(harvest.at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</>}
                      {soldEvt ? <> · รอบนี้ผู้สนับสนุนรับครบแล้ว (รอบถัดไปเปิดเร็ว ๆ นี้)</> : story.sold ? <> · มอบหมายให้ผู้สนับสนุนแล้ว</> : null}
                    </div>
                    <a href={story.traceUrl} className="inline-block text-[11px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
                      ดูที่มาเต็มของล็อตนี้ →
                    </a>
                  </div>
                );
              })()}
              {p.inStock && (
                <div className="flex items-center mt-1.5">
                  <button type="button"
                    onClick={() => {
                      if ((cart[p.id] ?? 0) === 0) setQty(p.id, 1); // ยังไม่มีในตะกร้า = เริ่ม 1 ชิ้นทันที
                      trackCtaClick('/shop', 'support_now', p.category === 'GENERAL' ? p.name.slice(0, 20) : p.category);
                      document.getElementById('order-summary')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium shadow shadow-emerald-950/40">
                    🤝 สนับสนุนชิ้นนี้
                  </button>
                  <div className="ml-auto flex items-center gap-1">
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
                </div>
              )}
            </div>
          ))}
        </section>

        {/* สนับสนุนตามศรัทธา (P16) — สำหรับคนที่อยากสนับสนุนโดยไม่รับชิ้นงาน · กำหนดยอดเอง */}
        {(() => {
          const faith = shop.products.find((p) => p.category === 'SUPPORT');
          if (!faith) return null;
          const faithQty = cart[faith.id] ?? 0;
          return (
            <section className="card px-5 py-3" aria-label="สนับสนุนตามศรัทธา">
              <h2 className="font-ledger text-sm text-gray-300 py-2 border-b border-gray-800">สนับสนุนตามศรัทธา — ไม่รับชิ้นงาน</h2>
              <p className="text-xs text-gray-400 leading-relaxed py-2">
                สำหรับผู้ที่อยากสนับสนุนโครงการโดยไม่ต้องรับชิ้นงานกลับไป — กำหนดยอดเองตามกำลังใจ
                ทุกบาทเข้ากองทุนพัฒนาระบบและผลิตชิ้นงานชุดถัดไป (ดูการใช้เงินได้ที่หน้า{' '}
                <a href="/about" className="text-cyan-300 hover:underline underline-offset-2">เกี่ยวกับเรา</a>)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={0} max={100000} value={faithQty}
                  onChange={(e) => setQty(faith.id, Math.min(100000, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
                  placeholder="ยอดสนับสนุน" aria-label="ยอดสนับสนุน (บาท)"
                  className="w-28 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm mono" />
                <span className="text-xs text-gray-500">บาท</span>
                {[50, 100, 500].map((v) => (
                  <button key={v} type="button" onClick={() => { setQty(faith.id, faithQty + v); trackCtaClick('/shop', 'support_faith', `chip_${v}`); }}
                    className="px-2.5 py-1 rounded-md border border-gray-700 text-xs text-gray-300 hover:border-emerald-500/60 hover:text-emerald-300">+{v}</button>
                ))}
                <button type="button"
                  onClick={() => {
                    if (faithQty === 0) setQty(faith.id, 100);
                    trackCtaClick('/shop', 'support_faith', 'faith');
                    document.getElementById('order-summary')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className="px-4 py-1.5 rounded-lg border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 text-sm font-medium">
                  🙏 สนับสนุนตามศรัทธา
                </button>
              </div>
              {faithQty > 0 && <p className="text-[11px] text-emerald-400 mt-1.5">อยู่ในสรุปยอดแล้ว {baht(faithQty)} — แก้ยอดได้ที่ช่องด้านบน</p>}
            </section>
          );
        })()}

        {/* สรุปยอดสนับสนุน — สลิปขอบฉีก (signature) */}
        <section id="order-summary" className="shop-tear shop-paper px-5 py-4 space-y-3">
          <h2 className="font-ledger text-sm text-gray-300">สรุปยอดสนับสนุน</h2>
          {items.length === 0 ? (
            <div className="text-sm text-gray-500">ยังไม่ได้เลือกชิ้นงาน — กด 🤝 สนับสนุนชิ้นนี้ ในรายการด้านบนเพื่อเริ่ม</div>
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
            <input placeholder="ชื่อผู้สนับสนุน *" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" aria-label="ชื่อผู้สนับสนุน" />
            <input placeholder="เบอร์ติดต่อ *" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
              className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm" aria-label="เบอร์ติดต่อ" />
            <input placeholder="หมายเหตุ (ที่อยู่จัดส่ง/เวลาสะดวก)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2 text-sm sm:col-span-2" aria-label="หมายเหตุ" />
          </div>
          <button onClick={placeOrder} disabled={busy || items.length === 0}
            className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium text-sm text-white disabled:opacity-40">
            {busy ? 'กำลังยืนยัน…' : 'ยืนยันการสนับสนุน'}
          </button>
          <p className="text-[10px] text-gray-600 pt-1">
            การสนับสนุนทุกบาทนำไปพัฒนาระบบและผลิตชิ้นงานชุดถัดไป — หลังยืนยันจะได้ลิงก์ติดตามสถานะส่วนตัว โอนผ่าน PromptPay ได้ทันที
          </p>
        </section>

        <ShopFaq />

        <footer className="text-center text-[10px] text-gray-600 pt-2">
          ดำเนินการผ่านระบบ Sovereign OS · <a href="/demo" className="hover:text-gray-400 underline underline-offset-2">ลองเล่นเดโม่</a>
          <FounderCredit className="pt-1" />
        </footer>
        <FeedbackButton page="/shop" />
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

        {fullyPaid && <ThankYouCard orderNo={order.orderNo} />}

        <footer className="text-center text-[10px] text-gray-600 pt-2">
          ดำเนินการผ่านระบบ Sovereign OS · <a href="/demo" className="hover:text-gray-400 underline underline-offset-2">ลองเล่นเดโม่</a> · <a href="/about" className="hover:text-gray-400 underline underline-offset-2">เกี่ยวกับเรา</a>
          <FounderCredit className="pt-1" />
        </footer>
        <FeedbackButton page="/shop" />
      </div>
    </ShopShell>
  );
}

// ── คำถามที่พบบ่อย (P15) — ลดลังเลก่อนตัดสินใจสนับสนุน ──
// คำถามที่ยังไม่มีคำตอบ = สัญญาณพัฒนาต่อ: กด "ยังไม่มีคำตอบ ถามเพิ่ม" → track question (detail=faq:<คำถาม>)
const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  { q: 'สนับสนุนแล้วได้อะไร?', a: 'ได้ชิ้นงานที่เลือกตามที่ระบุในหน้านี้ พร้อมบัตรหลักฐานการผลิต (ตามรอยได้ทุกขั้นตอน) และลิงก์ติดตามสถานะส่วนตัวตลอดกระบวนการ' },
  { q: 'จ่ายอย่างไร?', a: 'ยืนยันแล้วระบบสร้างลิงก์ส่วนตัวให้ทันที — สแกน QR PromptPay โอนผ่านแอปธนาคารได้เลย (QR ฝังยอดไว้แล้ว) และกดแจ้งชำระในลิงก์เดียวกัน' },
  { q: 'รอนานไหม?', a: 'ชิ้นที่ระบุ "มีสินค้า" พร้อมส่ง/ติดตั้งตามนัดที่ติดต่อกลับ — ชิ้นที่รอบถัดไป ระบบจะบอกสถานะจริงบนลิงก์ติดตามของคุณ' },
  { q: 'ซอฟต์แวร์ได้มาอย่างไร ใช้กับเครื่องอื่นได้ไหม?', a: 'ได้เวอร์ชันที่ผ่านการทดสอบครบ (ดูล็อต release ได้) พร้อมสิทธิ์ใช้งานและช่วยตั้งค่าเชื่อมระบบของคุณ — รายละเอียดขอบเขตแจ้งตอนติดต่อกลับ' },
  { q: 'อยากสนับสนุนโดยไม่รับชิ้นงาน ทำได้ไหม?', a: 'ได้ — ใช้ "สนับสนุนตามศรัทธา (กำหนดยอดเอง)" ด้านล่างรายการชิ้นงาน ตั้งยอดเองตามกำลังใจ ได้บัตรขอบคุณดิจิทัลและลิงก์ตามรอยเหมือนกัน' },
  { q: 'เงินสนับสนุนไปไหน?', a: 'ค่าวัสดุชุดถัดไป · พัฒนาฟีเจอร์ที่ผู้ใช้ขอจริง (ดูได้จากความต้องการที่เก็บจากปุ่มความคิดเห็น) · คงระบบเซิร์ฟเวอร์และการสำรองข้อมูลให้เดินต่อ', },
];

// ── บัตรขอบคุณผู้สนับสนุนดิจิทัล (P16) — โชว์บนลิงก์ลับเมื่อชำระครบ ──
// ชื่อที่ลงบัตรเลือกเอง จำในเครื่องนี้ (localStorage) — ไม่ส่งขึ้น server (ไม่เก็บ PII เพิ่ม)
function ThankYouCard({ orderNo }: { orderNo: string }) {
  const [name, setName] = useState('');
  useEffect(() => {
    try { setName(localStorage.getItem('sovereign-support-name') ?? ''); } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('sovereign-support-name', name); } catch { /* private mode */ }
  }, [name]);
  return (
    <section className="card p-5 border-emerald-500/40 space-y-3 text-center" aria-label="บัตรขอบคุณผู้สนับสนุน">
      <div className="text-3xl" aria-hidden>🙏</div>
      <h2 className="font-ledger text-base text-emerald-300">ขอบคุณ{name ? `, ${name}` : ''} — จากผู้ร่วมงานทุกคน</h2>
      <p className="text-xs text-gray-400 leading-relaxed">
        การสนับสนุนของคุณถูกบันทึกในระบบตามรอย (ออเดอร์ <span className="mono">{orderNo}</span>) —
        ทุกบาทนำไปพัฒนาระบบและผลิตชิ้นงานชุดถัดไปเพื่อชุมชน
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
        <label htmlFor="thank-name" className="text-gray-500">ลงชื่อบนบัตรเป็น:</label>
        <input id="thank-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อที่ต้องการ (เว้นว่าง = ไม่ระบุ)"
          maxLength={60} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-1.5 text-sm w-56" />
      </div>
      <a href="/trace" className="inline-block text-[11px] text-cyan-300 hover:underline underline-offset-2">🔍 ลองตามรอยชิ้นงานที่ระบบผลิต</a>
      <p className="text-[10px] text-gray-600">เก็บลิงก์นี้ไว้ — เปิดใหม่ที่ไหนก็ได้จะเห็นบัตรขอบคุณนี้เสมอ</p>
    </section>
  );
}
function ShopFaq() {
  const [open, setOpen] = useState<number | null>(null);
  const [asked, setAsked] = useState<number | null>(null);
  return (
    <section className="card px-5 py-3" aria-label="คำถามที่พบบ่อย">
      <h2 className="font-ledger text-sm text-gray-300 py-2 border-b border-gray-800">คำถามที่พบบ่อย</h2>
      <div className="divide-y divide-dashed divide-gray-800/80">
        {FAQ_ITEMS.map((f, i) => (
          <div key={i} className="py-2">
            <button type="button" className="w-full text-left flex items-baseline gap-2" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span className="text-sm text-gray-200">{f.q}</span>
              <span className="ml-auto text-gray-500 text-xs">{open === i ? '−' : '+'}</span>
            </button>
            {open === i && (
              <div className="pt-1.5 space-y-1.5">
                <p className="text-xs text-gray-400 leading-relaxed">{f.a}</p>
                {asked === i ? (
                  <p className="text-[11px] text-emerald-400">ขอบคุณครับ — คำถามของคุณถูกส่งให้ทีมงานแล้ว คำตอบจะถูกเพิ่มเข้าหน้านี้</p>
                ) : (
                  <button type="button" className="text-[11px] text-gray-500 hover:text-cyan-300 underline underline-offset-2"
                    onClick={() => { trackQuestion('/shop', `faq:${f.q}`, 'ยังไม่มีคำตอบที่ใช่ — อยากรู้เพิ่ม'); setAsked(i); }}>
                    ยังไม่ใช่คำตอบที่ต้องการ — ถามเพิ่ม
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 pt-2">คำถามอื่น ๆ กดปุ่ม 💬 มุมขวาล่างได้ตลอด</p>
    </section>
  );
}

// ── shared shell (ไม่มี Sidebar — หน้าสาธารณะนอกระบบ login) ──
function ShopShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-gray-100">
      <SeoHead
        title="หน้าร้าน — Sovereign"
        description="หน้าร้านสาธารณะของ Sovereign Origin — ชุดอุปกรณ์และซอฟต์แวร์พร้อมบัตรตามรอยการผลิต รองรับการสั่งซื้อออนไลน์"
        path="/shop"
      />
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
