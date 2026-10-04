"use client";
import { useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import { getApiUrl } from '../../lib/config';

// ────────────────────────────────────────────────────────────────────────────
// แผง "ชำระผ่านบัตร" — อีกทางเลือกหนึ่งของหน้าร้าน (ทางเดิมคือโอน PromptPay QR)
//
// ทำไมต้องมี: /api/payments/checkout-session คืน url ให้ไปจ่ายต่อที่ Stripe
// แต่เดิมยังไม่มีใครเรียกใช้ — หน้านี้คือผู้เรียกคนแรก
//
// ── กติกาที่ห้ามพลาด (อ่านก่อนแก้) ─────────────────────────────────────────
// 1) ยอดที่ส่งไปต้องเป็น `order.total` ที่ server คืนกลับมา "ตัวเดียวกัน"
//    ไม่ใช่คูณเองจากราคาสินค้าในเบราว์เซอร์ เพราะ webhook จะเอา
//    Stripe.amount_total ไปเทียบกับ BusinessOrder.total แบบตรงเป๊ะ
//    ต่างกันแม้แต่สตางค์เดียว = ไม่ apply = ลูกค้าจ่ายแล้วเงินไม่เข้าออเดอร์
// 2) refCode ต้องเป็น publicToken (UUID) ไม่ใช่ orderNo — orderNo ไม่ unique ข้ามร้าน
// 3) จุดนี้ต้องยิงผ่าน authFetch เพราะ checkout-session ต้องมี JWT
//    (หน้าร้านส่วนที่เหลือใช้ fetch ตรงโดยเจตนา เพราะเป็นของสาธารณะ)
// ────────────────────────────────────────────────────────────────────────────

export interface CheckoutPackage {
  id: string;
  name: string;
  category: string;
  specs?: string | null;
  salePrice: number;
  warrantyMonths: number;
  inStock: boolean;
}

interface Props {
  businessId: string;
  packages: CheckoutPackage[];
  customerName: string;
  customerPhone: string;
}

const baht = (n: number) => `${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

export default function ShopCheckoutPanel({ businessId, packages, customerName, customerPhone }: Props) {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const sellable = packages.filter((p) => p.category !== 'SUPPORT' && p.inStock);

  async function buy(p: CheckoutPackage) {
    setError('');
    if (!customerName.trim() || !customerPhone.trim()) {
      setError('กรอกชื่อและเบอร์โทรที่ช่อง "สรุปยอดสนับสนุน" ก่อน แล้วกดซื้ออีกครั้ง');
      return;
    }

    setBusyId(p.id);
    try {
      // ① สร้างออเดอร์จริงก่อน — public API เดิมของหน้าร้าน (ไม่แตะสัญญาใหม่)
      //    ตอบกลับ total คือยอดที่ระบบจะใช้ตรวจตอน Stripe ยืนยันกลับมา
      const res = await fetch(`${getApiUrl()}/api/shop/${businessId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          note: 'ชำระผ่านบัตร',
          items: [{ productId: p.id, qty: 1 }],
        }),
      });
      const order = await res.json().catch(() => null);
      if (!res.ok) throw new Error(order?.error ?? 'เปิดออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง');
      if (!order?.publicToken || typeof order?.total !== 'number') {
        throw new Error('เปิดออเดอร์ไม่สำเร็จ — ข้อมูลออเดอร์ไม่ครบ ลองใหม่อีกครั้ง');
      }

      // ② ขอหน้าชำระจาก Stripe ผูกกับออเดอร์นี้
      const pay = await authFetch(`${getApiUrl()}/api/payments/checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountBaht: order.total,
          productName: p.name,
          productDescription: p.specs ?? undefined,
          refCode: order.publicToken,
          successUrl: `${window.location.origin}/shop?order=${order.publicToken}&paid=1`,
          cancelUrl: `${window.location.origin}/shop?id=${businessId}&canceled=1`,
        }),
      });
      const session = await pay.json().catch(() => null);
      if (!pay.ok) throw new Error(session?.error ?? 'เปิดหน้าชำระเงินไม่สำเร็จ ลองใหม่อีกครั้ง');
      if (!session?.url) throw new Error('เปิดหน้าชำระเงินไม่สำเร็จ — ลองใหม่อีกครั้ง');

      window.location.href = session.url; // ไปหน้า Stripe — หน้านี้ถูกแทนที่ทั้งหน้า
    } catch (e: any) {
      setError(e?.message ?? 'ชำระเงินไม่สำเร็จ ลองใหม่อีกครั้ง');
      setBusyId(null); // กลับมากดใหม่ได้
    }
  }

  const busy = busyId !== null;

  return (
    <section className="card px-5 py-3 space-y-3" aria-label="ชำระผ่านบัตร">
      <h2 className="font-ledger text-sm text-gray-300 py-2 border-b border-gray-800">ชำระผ่านบัตร — ทางเลือกแทนโอน QR</h2>

      <p className="text-[11px] text-gray-400 leading-relaxed">
        กดซื้อที่แพ็กเกจที่ต้องการ — ระบบจะเปิดออเดอร์ให้ชิ้นนั้น 1 ชิ้น แล้วพาไปหน้าชำระของ Stripe
        ยอดชำระจริงอาจรวม VAT ตามที่ร้านตั้งไว้ และจะเป็นยอดของออเดอร์นั้นพอดี
      </p>

      {error && (
        <div className="card p-3 text-sm text-rose-300 border-rose-500/40" role="alert">{error}</div>
      )}

      {/* ยังไม่ login — checkout เป็น action ที่ต้องยืนยันตัวตน เลยบอกตรง ๆ ว่าทำอะไรต่อ */}
      {isHydrated && !isAuthenticated && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-2.5 space-y-2">
          <div className="text-xs text-amber-200 leading-relaxed">
            ชำระผ่านบัตรต้องเข้าสู่ระบบก่อน เพื่อให้ระบบผูกออเดอร์กับผู้ซื้อได้
            <br />
            ถ้ายังไม่อยากสมัคร — โอนผ่าน QR PromptPay ที่ลิงก์ลับได้เหมือนเดิม
          </div>
          <a href="/" className="inline-block px-3 py-1.5 rounded-lg border border-amber-500/50 text-amber-200 hover:bg-amber-500/10 text-xs font-medium">
            เข้าสู่ระบบเพื่อชำระ →
          </a>
        </div>
      )}

      {sellable.length === 0 ? (
        <div className="py-4 text-sm text-gray-500">ยังไม่มีแพ็กเกจที่เปิดให้ชำระผ่านบัตร</div>
      ) : (
        <ul className="divide-y divide-dashed divide-gray-800/80">
          {sellable.map((p) => {
            const submitting = busyId === p.id;
            return (
              <li key={p.id} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-[15px] text-gray-100">{p.name}</span>
                    <span className="shop-leader" aria-hidden />
                    <span className="mono text-cyan-300 font-semibold">เริ่มต้น {baht(p.salePrice)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500 mt-0.5">
                    <span>{p.category}</span>
                    {p.warrantyMonths > 0 && <span>· รับประกัน {p.warrantyMonths} เดือน</span>}
                    {p.specs && <span className="truncate max-w-[16rem]">· {p.specs}</span>}
                  </div>
                </div>

                {isHydrated && isAuthenticated ? (
                  <button
                    type="button"
                    onClick={() => buy(p)}
                    disabled={busy}
                    aria-busy={submitting}
                    aria-label={`ซื้อแพ็กเกจ ${p.name}`}
                    className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium shadow shadow-cyan-950/40 disabled:opacity-40"
                  >
                    {submitting ? 'กำลังเปิดหน้าชำระ…' : 'ชำระผ่านบัตร'}
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-600 px-2 py-1.5 border border-gray-800 rounded-lg">
                    ต้องเข้าสู่ระบบ
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] text-gray-600 pt-1">
        ยกเลิกกลางทางได้ — ออเดอร์จะยังอยู่ในระบบ ชำระต่อทีหลังผ่าน QR ได้จากลิงก์ลับ
      </p>
    </section>
  );
}
