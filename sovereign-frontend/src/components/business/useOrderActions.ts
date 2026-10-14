// components/business/useOrderActions.ts
// ฟังก์ชันจัดการออเดอร์ที่ย้ายออกจาก BusinessWorkspace (14/10/69)
// เหตุผล: BusinessWorkspace ชนเพดาน 400 บรรทัดแล้ว ตอนเพิ่มแท็บ "Soverien"
// ย้ายเฉพาะ "เปิดออเดอร์จากตะกร้า" ออกมา เพราะเป็นก้อนที่จบในตัวเอง
import { useState } from 'react';
import { Order } from './shared';

type Cart = Record<string, number>;
type Notice = { ok: boolean; text: string } | null;

/**
 * สร้างออเดอร์จากตะกร้าสินค้า
 * - แยกเป็น hook เพราะต้องถือ state ของตะกร้า + notice
 * - ไม่แตะพฤติกรรมเดิม: ยังคงเรียก POST /orders และ reload หลังสำเร็จเหมือนเดิม
 */
export function useCreateOrderFromCart({
  base, cart, setCart, post, reload, setNotice,
}: {
  base: string;
  cart: Cart;
  setCart: (c: Cart) => void;
  post: (url: string, body?: any) => Promise<any>;
  reload: () => Promise<void>;
  setNotice: (n: Notice) => void;
}) {
  const [creating, setCreating] = useState(false);

  async function createOrder(customerId?: string) {
    const items = Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty }));
    if (items.length === 0) { setNotice({ ok: false, text: 'เลือกสินค้าก่อนเปิดออเดอร์' }); return; }
    setCreating(true);
    try {
      const o = await post(`${base}/orders`, { items, customerId: customerId || undefined });
      setNotice({ ok: true, text: `เปิดออเดอร์ ${o.orderNo} แล้ว — ยืนยันที่แท็บออเดอร์` });
      setCart({});
      await reload();
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setCreating(false);
    }
  }

  return { createOrder, creating };
}

/** เปลี่ยนสถานะออเดอร์ (PENDING → CONFIRMED → …) */
export async function transitionOrder(
  post: (url: string, body?: any) => Promise<any>,
  base: string,
  order: Order,
  action: string,
  label: string,
  setNotice: (n: Notice) => void,
  reload: () => Promise<void>,
): Promise<void> {
  try {
    await post(`${base}/orders/${order.id}/transition`, { action });
    setNotice({ ok: true, text: `${order.orderNo} → ${label}` });
    await reload();
  } catch (e: any) {
    setNotice({ ok: false, text: e.message });
    await reload();
  }
}

/** เฟส 4: สถานะจัดส่งแบบเบา — เดินหน้าอย่างเดียว (backend กันย้อนกลับ) */
export async function updateShipping(
  post: (url: string, body?: any) => Promise<any>,
  base: string,
  order: Order,
  status: 'PREPARING' | 'SHIPPED',
  setNotice: (n: Notice) => void,
  reload: () => Promise<void>,
): Promise<void> {
  try {
    await post(`${base}/orders/${order.id}/shipping`, {
      shippingStatus: status,
      shippingCarrier: status === 'SHIPPED' ? 'เจ้าของร้านส่งเอง' : undefined,
    });
    setNotice({ ok: true, text: status === 'SHIPPED' ? `${order.orderNo} → จัดส่งแล้ว` : `${order.orderNo} → กำลังเตรียมส่ง` });
    await reload();
  } catch (e: any) {
    setNotice({ ok: false, text: e.message });
    await reload();
  }
}