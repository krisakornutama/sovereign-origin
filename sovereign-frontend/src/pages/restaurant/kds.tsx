"use client";
// ─────────────────────────────────────────────────────────────
//  KDS (Kitchen Display System) — จอครัว
//  คิวออเดอร์: PENDING (รอทำ) → PREPARING (กำลังทำ) → READY (เสิร์ฟได้)
//  อัปเดตอัตโนมัติทุก 10 วิ + ปุ่มเลื่อนสถานะ — จอใหญ่ตัวหนังสือใหญ่ อ่านได้จากข้ามครัว
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { authFetch } from "../../lib/apiFetch";
import { useAuthStore } from "../../stores/useAuthStore";
import Link from "next/link";

interface OrderLine { menuId: string; qty: number; priceAtOrder: number }
interface KdsOrder {
  id: string; orderNo: string; tableNo: string | null; type: string;
  status: string; totalTHB: number; createdAt: string; lines: OrderLine[];
}

const STATUS_META: Record<string, { label: string; border: string; bg: string; next: string | null; nextLabel: string }> = {
  PENDING: { label: "รอทำ", border: "border-amber-600", bg: "bg-amber-950/30", next: "PREPARING", nextLabel: "เริ่มทำ" },
  PREPARING: { label: "กำลังทำ", border: "border-sky-600", bg: "bg-sky-950/30", next: "READY", nextLabel: "ทำเสร็จ" },
  READY: { label: "เสิร์ฟได้", border: "border-emerald-600", bg: "bg-emerald-950/30", next: null, nextLabel: "" },
};

// แปลง menuId → ชื่อเมนู (โหลดเมนูครั้งเดียว)
export default function KdsPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [menuNames, setMenuNames] = useState<Record<string, string>>({});
  const [restaurants, setRestaurants] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = selected ? `?restaurantId=${selected}` : "";
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/orders${qs}`);
      if (res.ok) {
        const d = await res.json();
        setOrders((Array.isArray(d) ? d : []).filter((o: KdsOrder) => ["PENDING", "PREPARING", "READY"].includes(o.status)));
      }
    } catch { /* offline */ }
  }, [selected]);

  // โหลดชื่อเมนู + ร้านครั้งแรก
  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      const r1 = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant`);
      if (r1.ok) { const d = await r1.json(); setRestaurants(d); if (d[0]) setSelected(d[0].id); }
      const r2 = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/menus`);
      if (r2.ok) {
        const menus = await r2.json();
        const map: Record<string, string> = {};
        for (const m of menus) map[m.id] = m.name;
        setMenuNames(map);
      }
    })();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    load();
    const iv = setInterval(load, 10_000);
    return () => clearInterval(iv);
  }, [isAuthenticated, load]);

  const advance = async (o: KdsOrder) => {
    const meta = STATUS_META[o.status];
    if (!meta?.next) return;
    setBusy(true);
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/orders/${o.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: meta.next }),
      });
      await load();
    } finally { setBusy(false); }
  };

  const cancel = async (o: KdsOrder) => {
    if (!window.confirm(`ยกเลิกออเดอร์ ${o.orderNo}?`)) return;
    setBusy(true);
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/orders/${o.id}/cancel`, { method: "POST" });
      await load();
    } finally { setBusy(false); }
  };

  if (!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">กำลังโหลด...</div>;
  if (!isAuthenticated) return <div className="text-white p-8">Unauthorized</div>;

  const byStatus = (s: string) => orders.filter((o) => o.status === s);
  const elapsed = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    return mins >= 60 ? `${Math.floor(mins / 60)}ชม.` : `${mins}นาที`;
  };

  return (
    <div className="atmo-kitchen min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3">
          <PageHeader
            eyebrow="จักรวรรดิ" title="จอครัว (KDS)" icon={<Icon name="inventory" size={18} />}
            subtitle="คิวออเดอร์แบบเรียลไทม์ — อัปเดตทุก 10 วิ"
            actions={<div className="flex items-center gap-2">
              <select value={selected} onChange={(e) => setSelected(e.target.value)} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm">
                {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <Link href="/restaurant" className="text-sm text-sky-400 hover:underline">← POS</Link>
            </div>}
          />
        </header>
        <main className="p-4 lg:p-6 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
          {["PENDING", "PREPARING", "READY"].map((status) => {
            const meta = STATUS_META[status];
            const list = byStatus(status);
            return (
              <div key={status} className={`rounded-xl border-2 ${meta.border} ${meta.bg} p-3 space-y-3 min-h-[50vh]`}>
                <div className="flex items-center justify-between sticky top-0">
                  <h2 className="text-lg font-bold">{meta.label}</h2>
                  <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${status === "READY" ? "bg-emerald-600 text-white" : status === "PREPARING" ? "bg-sky-600 text-white" : "bg-amber-600 text-white"}`}>{list.length}</span>
                </div>
                {list.length === 0 && <div className="text-gray-600 text-sm text-center py-8">ว่าง</div>}
                {list.map((o) => (
                  <div key={o.id} className="bg-gray-900 rounded-xl p-4 space-y-2 border border-gray-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black tracking-wide">{o.tableNo || (o.type === "TAKEAWAY" ? "กลับบ้าน" : "โต๊ะ?")}</span>
                      <span className="text-xs text-gray-500">{elapsed(o.createdAt)} ⏱</span>
                    </div>
                    <div className="text-xs text-gray-500">{o.orderNo}</div>
                    <ul className="space-y-1">
                      {o.lines.map((l, i) => (
                        <li key={i} className="text-xl font-bold text-white flex justify-between">
                          <span>{menuNames[l.menuId] || "เมนู"}</span>
                          <span className="text-amber-400">×{l.qty}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2 pt-1">
                      {meta.next && (
                        <button onClick={() => advance(o)} disabled={busy} className={`flex-1 py-2.5 rounded-lg font-bold text-sm ${status === "PENDING" ? "bg-sky-600 hover:bg-sky-500" : "bg-emerald-600 hover:bg-emerald-500"} text-white disabled:opacity-50`}>
                          {meta.nextLabel} →
                        </button>
                      )}
                      {o.status === "PENDING" && (
                        <button onClick={() => cancel(o)} disabled={busy} className="px-3 py-2.5 bg-gray-800 hover:bg-rose-900 rounded-lg text-sm text-rose-300">ยกเลิก</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </main>
      </div>
    </div>
  );
}
