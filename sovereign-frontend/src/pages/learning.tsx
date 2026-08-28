"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import Icon from "../components/ui/Icon";
import { authFetch } from "../lib/apiFetch";
import { useAuthStore } from "../stores/useAuthStore";
import { useLanguageStore } from "../stores/useLanguageStore";

export default function LearningPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore(s=>s.t);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [preds, setPreds] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const load = useCallback(async()=>{
    try{
      const [s,p,m]=await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/snapshots?limit=20`).then(r=>r.ok?r.json():[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/predictions?limit=20`).then(r=>r.ok?r.json():[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/models`).then(r=>r.ok?r.json():[]),
      ]);
      setSnapshots(Array.isArray(s)?s:[]); setPreds(Array.isArray(p)?p:[]); setModels(Array.isArray(m)?m:[]);
    }catch{}
  },[]);
  useEffect(()=>{ if(isAuthenticated) load(); },[isAuthenticated, load]);

  const collect = async()=>{
    setErr(""); setMsg("");
    const r=await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/collect`,{method:"POST"});
    if(r.ok){ const j=await r.json(); setMsg(`เก็บ snapshot ${j.snapshots} รายการแล้ว`); load(); } else setErr("collect ไม่สำเร็จ");
  };
  const nightly = async()=>{
    setErr(""); setMsg("");
    const r=await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/nightly`,{method:"POST"});
    if(r.ok){ const j=await r.json(); setMsg(`nightly: snapshots ${j.snapshots} predictions ${j.predictions}`); load(); } else setErr("nightly ไม่สำเร็จ");
  };
  const predict = async(domain:string)=>{
    const featuresRaw = window.prompt(`features JSON สำหรับ ${domain} เช่น {"water_level_cm":{"avg":15}}`);
    if(!featuresRaw) return;
    try{
      const features=JSON.parse(featuresRaw);
      const r=await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/predict`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({domain, features})});
      const j=await r.json();
      if(r.ok){ setMsg(`ทำนาย ${domain} → ${JSON.stringify(j.output).slice(0,120)}`); load(); } else setErr(j.error||"predict ไม่สำเร็จ");
    }catch(e:any){ setErr(e.message); }
  };

  if(!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t("common.loading","กำลังโหลด...")}</div>;
  if(!isAuthenticated) return <div className="text-white p-8">Unauthorized</div>;
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar/>
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader eyebrow="เรียนรู้เอง" title="Learning Center — D ทั้งหมดเรียนรู้ต่อจากอดีต" subtitle="Data Lake → Feature → Ollama qwen3:8b → predict → actual → accuracy เรียนรู้ต่ออัตโนมัติ (cron 02:00 nightly)" icon={<Icon name="ai" size={18}/>} />
          {msg && <div className="inset p-3 text-sm text-emerald-300 border-emerald-700">{msg}</div>}
          {err && <div className="inset p-3 text-sm text-red-400 border-red-700">{err}</div>}
          <div className="flex flex-wrap gap-2">
            <button onClick={collect} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-bold">📸 เก็บ snapshot รายวันทันที</button>
            <button onClick={nightly} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-bold">🌙 รัน nightly learn</button>
            <button onClick={()=>predict('sensor')} className="px-3 py-2 bg-gray-800 rounded text-xs">ทำนาย sensor</button>
            <button onClick={()=>predict('farm')} className="px-3 py-2 bg-gray-800 rounded text-xs">ทำนาย farm</button>
            <button onClick={()=>predict('health')} className="px-3 py-2 bg-gray-800 rounded text-xs">ทำนาย health</button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-4 space-y-2">
              <h3 className="font-bold text-sm flex items-center gap-1"><Icon name="history" size={14}/> Snapshots ({snapshots.length})</h3>
              {snapshots.length===0? <div className="text-xs text-gray-500">ยังไม่มี — กดเก็บ snapshot</div> :
                <div className="space-y-2 max-h-96 overflow-auto">
                  {snapshots.map(s=>(
                    <div key={s.id} className="bg-gray-900 rounded-lg p-2 text-xs">
                      <div className="flex justify-between"><span className="font-bold">{s.domain}</span><span className="text-gray-500">{new Date(s.capturedAt).toLocaleString('th-TH')}</span></div>
                      <div className="text-gray-400 truncate">{JSON.stringify(s.features).slice(0,120)}</div>
                      <div className="text-gray-500">{s.source}</div>
                    </div>
                  ))}
                </div>
              }
            </div>
            <div className="card p-4 space-y-2">
              <h3 className="font-bold text-sm flex items-center gap-1"><Icon name="predictive" size={14}/> Predictions ({preds.length})</h3>
              {preds.length===0? <div className="text-xs text-gray-500">ยังไม่มี — ทำนายสักครั้ง</div> :
                <div className="space-y-2 max-h-96 overflow-auto">
                  {preds.map(p=>(
                    <div key={p.id} className="bg-gray-900 rounded-lg p-2 text-xs">
                      <div className="flex justify-between"><span className="font-bold">{p.domain} · {p.model}</span><span className={p.correct===true?"text-emerald-400":p.correct===false?"text-red-400":"text-gray-500"}>{p.correct===true?"✓":p.correct===false?"✗":p.confidence?.toFixed(2)}</span></div>
                      <div className="text-gray-300">{JSON.stringify(p.output).slice(0,120)}</div>
                      {p.actual && <div className="text-sky-400">actual: {JSON.stringify(p.actual).slice(0,80)}</div>}
                      <button onClick={async()=>{
                        const a=window.prompt('actual JSON เช่น {"risk":0.9}');
                        if(!a) return;
                        try{
                          const actual=JSON.parse(a);
                          await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/predictions/${p.id}/evaluate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({actual})});
                          setMsg("ประเมินแล้ว"); load();
                        }catch(e:any){ setErr(e.message); }
                      }} className="text-[11px] text-sky-400 underline">ประเมิน actual</button>
                    </div>
                  ))}
                </div>
              }
            </div>
            <div className="card p-4 space-y-2">
              <h3 className="font-bold text-sm flex items-center gap-1"><Icon name="ai" size={14}/> Models accuracy</h3>
              {models.length===0? <div className="text-xs text-gray-500">ยังไม่มี — รันทำนายแล้วประเมิน actual ก่อน</div> :
                <div className="space-y-2">
                  {models.map((m:any)=>(
                    <div key={m.domain} className="bg-gray-900 rounded-lg p-2 text-xs">
                      <div className="font-bold">{m.domain} · {m.model}</div>
                      <div className={m.accuracy!=null && m.accuracy>=0.7?"text-emerald-400":m.accuracy!=null?"text-amber-400":"text-gray-500"}>accuracy {m.accuracy!=null?(m.accuracy*100).toFixed(0)+"%":"—"} · {m.stats?`${m.stats.correct}/${m.stats.total}`:""}</div>
                      <div className="text-gray-500">{new Date(m.trainedAt).toLocaleString('th-TH')}</div>
                    </div>
                  ))}
                </div>
              }
              <div className="text-[11px] text-gray-500 mt-2">เรียนรู้ต่อ: ทุกครั้งที่ใส่ actual → accuracy อัปเดต → nightly จะใช้ model ที่แม่นสุด</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
