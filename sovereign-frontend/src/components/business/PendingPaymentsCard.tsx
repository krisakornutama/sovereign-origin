import { useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { baht, Order } from './shared';

// P18 — การ์ดรวม "แจ้งชำระแล้วรอยืนยัน": ออเดอร์ที่มีแจ้งชำระ (PROMPTPAY) แต่ยอดรับจริงยังไม่ครบ
// กด "ยืนยันรับเงิน" จากการ์ดนี้ที่เดียว = บันทึกบิลที่ 2 ยอดเท่าที่แจ้ง (วิธีเดียวกับ markPaid ปกติ)
// ออเดอร์ไหนแจ้งครบทั้งยอด → ปุ่มเดียวยืนยันครบ · แจ้งบางส่วน → แสดงคงเหลือให้รับเพิ่มทีหลังได้

export interface PendingReport {
  order: Order;
  reported: number; // ยอดที่ลูกค้าแจ้งมาแล้ว (ยังไม่ยืนยัน)
  remaining: number; // ยอดค้างชำระจริงของออเดอร์ (total - paidAmount)
}

export function PendingPaymentsCard({ reports, onConfirm, busy }: { reports: PendingReport[]; onConfirm: (o: Order, amount: number) => void; busy?: string | null }) {
  if (reports.length === 0) return null;
  const totalReported = reports.reduce((s, r) => s + r.reported, 0);
  return (
    <div className="card p-4 space-y-2 border-amber-500/40 bg-amber-500/5" data-testid="pending-payments-card">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-amber-300">💰 แจ้งชำระแล้วรอยืนยัน</span>
        <span className="text-[11px] text-slate-400">{reports.length} ออเดอร์ · รวมแจ้ง {baht(totalReported)}</span>
      </div>
      {reports.map((r) => {
        const after = Math.max(0, r.remaining - r.reported);
        const confirmText = after <= 0.001 ? `ยืนยันรับเงิน ${baht(r.reported)} (ปิดออเดอร์)` : `ยืนยันรับเงิน ${baht(r.reported)} (คงเหลือ ${baht(after)})`;
        return (
          <div key={r.order.id} className="flex flex-wrap items-center gap-2 border border-amber-500/20 rounded-lg px-3 py-2 text-sm bg-slate-900/40">
            <span className="font-mono text-xs text-slate-400">{r.order.orderNo}</span>
            <span className="text-slate-300">{r.order.customer?.name ?? 'ลูกค้าทั่วไป'}</span>
            <span className="text-amber-300 font-medium">แจ้งมา {baht(r.reported)}</span>
            <span className="text-slate-500 text-xs">/ ค้าง {baht(r.remaining)}</span>
            <button
              onClick={() => onConfirm(r.order, r.reported)}
              disabled={busy === r.order.id}
              data-testid={`confirm-payment-${r.order.orderNo}`}
              className="ml-auto px-3 py-1 rounded bg-emerald-600/90 hover:bg-emerald-500 text-xs font-medium disabled:opacity-50"
            >
              {busy === r.order.id ? 'กำลังยืนยัน…' : confirmText}
            </button>
          </div>
        );
      })}
      <div className="text-[11px] text-slate-500">ตรวจยอดเงินเข้าจริงที่บัญชีก่อนกด — การยืนยันบันทึกการรับเงินถาวร</div>
    </div>
  );
}

/** คำนวณรายการรอยืนยันจาก orders: แจ้งชำระ (PROMPTPAY) แล้วแต่ยอดรับจริง (paidAmount) ยังไม่ครบ */
export function computePendingReports(orders: Order[]): PendingReport[] {
  return orders
    .filter((o) => {
      if (o.status !== 'QUOTE' && o.status !== 'ORDERED' && o.status !== 'PAID') return false;
      const remaining = o.total - (o.paidAmount ?? 0);
      if (remaining <= 0.001) return false;
      const reported = (o.payments ?? []).filter((p) => p.method === 'PROMPTPAY').reduce((s, p) => s + (p.amount ?? 0), 0);
      return reported > 0.001;
    })
    .map((o) => {
      const reported = (o.payments ?? []).filter((p) => p.method === 'PROMPTPAY').reduce((s, p) => s + (p.amount ?? 0), 0);
      return { order: o, reported, remaining: Math.max(0, o.total - (o.paidAmount ?? 0)) };
    });
}

/** Hook ยืนยันรับเงินจากการ์ดรวม: บันทึกบิลยอดเท่าที่ลูกค้าแจ้ง (method CASH = เงินเข้าจริงยืนยันแล้ว) */
export function useConfirmReportedPayment(base: string, load: () => Promise<void>, setNotice: (n: { ok: boolean; text: string }) => void) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  async function confirm(order: Order, amount: number) {
    setConfirmingId(order.id);
    try {
      const r = await authFetch(`${base}/orders/${order.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, method: 'CASH' }) });
      const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
      if (!r.ok) throw new Error(data?.error ?? 'ล้มเหลว');
      const remain = Math.max(0, order.total - (order.paidAmount ?? 0) - amount);
      setNotice({ ok: true, text: remain <= 0.001 ? `ยืนยันรับเงิน ${order.orderNo} ครบ ${baht(order.total)} — ปิดออเดอร์แล้ว` : `ยืนยันรับเงิน ${order.orderNo} ${baht(amount)} — คงเหลือ ${baht(remain)}` });
      await load();
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
      await load();
    } finally {
      setConfirmingId(null);
    }
  }
  return { confirmingId, confirm };
}
