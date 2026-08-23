"use client";
import { useState, useEffect } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { authFetch } from "../../lib/apiFetch";
import { useAuthStore } from "../../stores/useAuthStore";
import Link from "next/link";

export default function RiceResearchPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const [plots, setPlots] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots`);
    if(res.ok){ const d=await res.json(); setPlots(d.plots||[]); if(d.plots?.[0]) setSelected(d.plots[0].id); }
    setLoading(false);
  };
  const loadAnalysis = async (id:string) => {
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/plots/${id}/analysis?crop=ข้าว`);
    if(res.ok) setAnalysis(await res.json());
  };
  useEffect(()=>{ if(isAuthenticated) load(); },[isAuthenticated]);
  useEffect(()=>{ if(selected) loadAnalysis(selected); },[selected]);

  if(!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">กำลังโหลด...</div>;
  if(!isAuthenticated) return <div className="text-white p-8">Unauthorized</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader eyebrow="วิจัย" title="วิจัยพันธุ์ข้าว + ดิน (A)" icon={<Icon name="farm" size={18} />} subtitle="เทียบ yield/area + วิเคราะห์ดิน NPK — เก็บสูตรในคลังความรู้" actions={<Link href="/knowledge" className="text-sm text-sky-400 hover:underline">คลังความรู้</Link>} />
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full space-y-4 w-full">
          {loading ? <div className="text-gray-500">กำลังโหลด...</div> : (
            <>
              <div className="card p-4">
                <label className="text-xs text-gray-400">เลือกแปลงข้าว</label>
                <select value={selected} onChange={e=>setSelected(e.target.value)} className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                  {plots.map(p=><option key={p.id} value={p.id}>{p.name} — {p.crop||'ไม่ระบุ'} ({p.area_sqm||'-'} ตรม.) [{p.status}]</option>)}
                </select>
                {plots.length===0 && <div className="text-sm text-gray-500 mt-2">ยังไม่มีแปลง — ไปสร้างที่ <Link href="/farm" className="text-sky-400 underline">/farm</Link></div>}
              </div>

              {analysis && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="card p-4">
                    <h3 className="font-bold text-sm mb-2">วิเคราะห์ดินสำหรับข้าว</h3>
                    {analysis.analysis ? (
                      <div className="space-y-2 text-sm">
                        <div>คะแนน: <span className="font-bold text-emerald-400">{analysis.analysis.score}/100</span></div>
                        <ul className="list-disc ml-4 text-xs text-gray-400">
                          {(analysis.analysis.findings||[]).map((f:any,i:number)=><li key={i}>{f.field}: {f.status} — {f.hint}</li>)}
                        </ul>
                        <div className="text-xs text-gray-500">พืชเป้าหมาย: {analysis.crop}</div>
                      </div>
                    ) : <div className="text-sm text-gray-500">{analysis.message}</div>}
                    {analysis.reading && <div className="text-xs text-gray-500 mt-2">N:{analysis.reading.n} P:{analysis.reading.p} K:{analysis.reading.k} pH:{analysis.reading.ph} ชื้น:{analysis.reading.moisture_pct}%</div>}
                  </div>
                  <div className="card p-4">
                    <h3 className="font-bold text-sm mb-2">แผนปรับปรุงดิน 5 ขั้น</h3>
                    {analysis.plan ? <ol className="list-decimal ml-4 text-sm space-y-1">{analysis.plan.map((s:string,i:number)=><li key={i} className="text-gray-300">{s}</li>)}</ol> : <div className="text-sm text-gray-500">ไม่มีแผน</div>}
                  </div>
                </div>
              )}

              <div className="card p-4">
                <h3 className="font-bold text-sm mb-2">เปรียบเทียบ yield/area (ต้องเก็บเกี่ยวก่อน)</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {plots.map(p=>{
                    const yieldPerSqm = p.area_sqm ? (p as any).lastYield ? ((p as any).lastYield/p.area_sqm).toFixed(2) : '—' : '—';
                    return <div key={p.id} className="inset p-3 text-sm"><div className="font-bold">{p.name}</div><div className="text-xs text-gray-400">{p.crop} • {p.area_sqm||'-'} ตรม.</div><div className="text-xs">yield/area: {yieldPerSqm} kg/ตรม.</div></div>
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-2">เก็บเกี่ยวแล้วไปที่ <Link href="/inventory" className="text-sky-400 underline">Inventory</Link> จะเห็นวัตถุดิบ, สูตรร้านจะดึงจากตรงนี้</p>
              </div>

              <div className="card p-4 bg-amber-900/20 border-amber-800">
                <h3 className="font-bold text-sm text-amber-300">วิธีใช้วิจัย</h3>
                <ol className="list-decimal ml-4 text-sm text-gray-300 space-y-1">
                  <li>สร้างหลายแปลง ใส่พันธุ์ข้าวต่างกัน (เช่น ข้าวหอมมะลิ, กข43)</li>
                  <li>บันทึกค่าดิน NPK/ชื้น ทุกแปลง → ดูคะแนน + แผน 5 ขั้น</li>
                  <li>เก็บเกี่ยวใส่ yieldKg → เทียบ kg/ตรม. หาพันธุ์ที่เหมาะกับดินคุณ</li>
                  <li>บันทึกสูตรที่ได้ผลเป็น <Link href="/knowledge" className="text-sky-400 underline">Knowledge tag research/rice</Link></li>
                </ol>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
