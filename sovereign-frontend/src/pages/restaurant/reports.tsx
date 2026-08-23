"use client";
import { useState, useEffect } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { authFetch } from "../../lib/apiFetch";
import { useAuthStore } from "../../stores/useAuthStore";
import { useLanguageStore } from "../../stores/useLanguageStore";
import Link from "next/link";

export default function RestaurantReportsPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/reports/summary?days=${days}`);
    if(res.ok) setData(await res.json());
    setLoading(false);
  };
  useEffect(()=>{ if(isAuthenticated) load(); },[isAuthenticated, days]);

  if(!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('restaurant.loading', 'กำลังโหลด...')}</div>;
  if(!isAuthenticated) return <div className="text-white p-8">{t('restaurant.unauthorized', 'Unauthorized')}</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader eyebrow={t('restaurant.eyebrow', 'จักรวรรดิ')} title={t('restaurant.reports.title', 'รายงานร้านอาหาร')} icon={<Icon name="reports" size={18} />} subtitle={t('restaurant.reports.subtitle', 'รายรับ • รายจ่าย • กำไร — แยกกระเป๋าร้าน superadmin เห็นหมด')} actions={<Link href="/restaurant" className="text-sm text-sky-400 hover:underline">{t('restaurant.backToPos', '← POS')}</Link>} />
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full space-y-4 w-full">
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-400">{t('restaurant.reports.range', 'ช่วง')}</span>
            <select value={days} onChange={e=>setDays(Number(e.target.value))} className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm">
              <option value={7}>{t('restaurant.reports.days7', '7 วัน')}</option><option value={30}>{t('restaurant.reports.days30', '30 วัน')}</option><option value={90}>{t('restaurant.reports.days90', '90 วัน')}</option>
            </select>
            <button onClick={load} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm">{t('restaurant.refresh', 'รีเฟรช')}</button>
          </div>
          {loading ? <div className="text-gray-500">{t('restaurant.loading', 'กำลังโหลด...')}</div> : !data ? <div className="text-gray-500">{t('restaurant.reports.noData', 'ไม่มีข้อมูล')}</div> : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="card p-4 text-center"><div className="text-xs text-gray-400">{t('restaurant.reports.totalRevenue', 'รายรับรวม')}</div><div className="text-2xl font-bold text-emerald-400">{data.totalRevenue?.toLocaleString()} ฿</div><div className="text-xs text-gray-500">{data.totalOrders} {t('restaurant.orderUnit', 'ออเดอร์')} • {t('restaurant.reports.avgPerOrder', 'เฉลี่ย {n} ฿', { n: Math.round(data.avgPerOrder||0) })}</div></div>
                <div className="card p-4 text-center"><div className="text-xs text-gray-400">{t('restaurant.reports.restaurantCount', 'จำนวนร้าน')}</div><div className="text-2xl font-bold">{data.byRestaurant?.length||0}</div></div>
                <div className="card p-4 text-center"><div className="text-xs text-gray-400">{t('restaurant.reports.range', 'ช่วง')}</div><div className="text-sm font-bold">{t('restaurant.reports.daysN', '{n} วัน', { n: days })}</div><div className="text-xs text-gray-500">{t('restaurant.reports.since', 'ตั้งแต่ {date}', { date: data.since ? new Date(data.since).toLocaleDateString('th-TH') : '' })}</div></div>
              </div>
              <div className="card p-4">
                <h3 className="font-bold mb-2 text-sm">{t('restaurant.reports.byRestaurant', 'รายรับต่อร้าน')}</h3>
                {data.byRestaurant?.length? data.byRestaurant.map((r:any)=><div key={r.restaurantId} className="flex justify-between py-2 border-b border-gray-800 text-sm"><span>{r.name}</span><span>{r.count} {t('restaurant.orderUnit', 'ออเดอร์')} • {r.revenue.toLocaleString()} ฿</span></div>) : <div className="text-sm text-gray-500">{t('restaurant.reports.noOrders', 'ยังไม่มีออเดอร์')}</div>}
              </div>
              <div className="card p-4">
                <h3 className="font-bold mb-2 text-sm">{t('restaurant.reports.daily', 'รายวัน')}</h3>
                <div className="space-y-1 max-h-60 overflow-auto">
                  {Object.entries(data.daily||{}).sort().map(([d,v]:any)=><div key={d} className="flex justify-between text-xs"><span>{d}</span><span>{Number(v).toLocaleString()} ฿</span></div>)}
                  {Object.keys(data.daily||{}).length===0 && <div className="text-xs text-gray-500">{t('restaurant.reports.noDaily', 'ไม่มีข้อมูลรายวัน')}</div>}
                </div>
              </div>
              <p className="text-xs text-gray-500">{t('restaurant.reports.note', 'กระเป๋าร้านแยกจากครัวเรือน — superadmin ดูได้ทุกร้าน เจ้าของร้านดูได้เฉพาะร้านตัวเอง')}</p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
