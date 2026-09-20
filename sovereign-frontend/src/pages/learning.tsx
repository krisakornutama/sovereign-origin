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
  const [sensorTrends, setSensorTrends] = useState<any[]>([]);
  const [farmTrends, setFarmTrends] = useState<any[]>([]);
  const [healthTrends, setHealthTrends] = useState<any[]>([]);
  const [unified, setUnified] = useState<any>(null);
  const [unifiedHistory, setUnifiedHistory] = useState<number[]>(()=>{
    try{ if(typeof window==='undefined') return []; const v=JSON.parse(localStorage.getItem('unified_history')||'[]'); return Array.isArray(v)?v:[]; }catch{ return []; }
  });
  const [unifiedHistDates, setUnifiedHistDates] = useState<string[]>([]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const load = useCallback(async()=>{
    try{
      const [s,p,m,tr,f,h,u]=await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/snapshots?limit=20`).then(r=>r.ok?r.json():[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/predictions?limit=20`).then(r=>r.ok?r.json():[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/models`).then(r=>r.ok?r.json():[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/predict/sensor`).then(r=>r.ok?r.json():[]).catch(()=>[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/predict/farm`).then(r=>r.ok?r.json():[]).catch(()=>[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/predict/health`).then(r=>r.ok?r.json():[]).catch(()=>[]),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/unified`).then(r=>r.ok?r.json():null).catch(()=>null),
      ]);
      setSnapshots(Array.isArray(s)?s:[]); setPreds(Array.isArray(p)?p:[]); setModels(Array.isArray(m)?m:[]); setSensorTrends(Array.isArray(tr)?tr:[]); setFarmTrends(Array.isArray(f)?f:[]); setHealthTrends(Array.isArray(h)?h:[]); setUnified(u);
      if(u && typeof u.score==='number'){ setUnifiedHistory(his=>{ const nh=[...his, Math.round(u.score*100)].slice(-14); try{ localStorage.setItem('unified_history', JSON.stringify(nh)); }catch{} return nh; }); }
      try{ const uh=await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/learning/unified/history?days=7`).then(r=>r.ok?r.json():null).catch(()=>null); if(uh?.history?.length){ setUnifiedHistory(uh.history.map((x:any)=>Math.round(x.score*100))); setUnifiedHistDates(uh.history.map((x:any)=>x.date.slice(5))); setUnified(uh.current); } }catch{}
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
    <div className="atmo-power min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar/>
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader eyebrow="เรียนรู้เอง" title="Learning Center — D ทั้งหมดเรียนรู้ต่อจากอดีต" subtitle="Data Lake → Feature → Ollama qwen3:8b → predict → actual → accuracy เรียนรู้ต่ออัตโนมัติ (cron 02:00 nightly)" icon={<Icon name="ai" size={18}/>} theme="power" />
          {msg && <div className="inset p-3 text-sm text-emerald-300 border-emerald-700">{msg}</div>}
          {err && <div className="inset p-3 text-sm text-red-400 border-red-700">{err}</div>}
          <div className="flex flex-wrap gap-2">
            <button onClick={collect} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-bold">📸 เก็บ snapshot รายวันทันที</button>
            <button onClick={nightly} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-bold">🌙 รัน nightly learn</button>
            <button onClick={()=>predict('sensor')} className="px-3 py-2 bg-gray-800 rounded text-xs">ทำนาย sensor</button>
            <button onClick={()=>predict('farm')} className="px-3 py-2 bg-gray-800 rounded text-xs">ทำนาย farm</button>
            <button onClick={()=>predict('health')} className="px-3 py-2 bg-gray-800 rounded text-xs">ทำนาย health</button>
            <button onClick={load} className="px-3 py-2 bg-gray-700 rounded text-xs">รีเฟรช trend</button>
          </div>
          {unified && (
            <div className={`card p-4 flex items-center justify-between border-2 ${unified.score>=0.7?'border-red-700 bg-red-950/30':unified.score>=0.4?'border-amber-700 bg-amber-950/20':'border-emerald-700 bg-emerald-950/20'}`}>
              <div className="flex-1">
                <div className="text-xs text-gray-400">Unified Risk D — เฉลี่ย 3 โดเมน</div>
                <div className={`text-2xl font-bold ${unified.score>=0.7?'text-red-400':unified.score>=0.4?'text-amber-400':'text-emerald-400'}`}>{(unified.score*100).toFixed(0)}% — {unified.advice}</div>
                <div className="text-[11px] text-gray-500">sensor {(unified.breakdown.sensor*100).toFixed(0)}% · farm {(unified.breakdown.farm*100).toFixed(0)}% · health {(unified.breakdown.health*100).toFixed(0)}%</div>
                {unifiedHistory.length>1 && (
                  <svg width="200" height="36" className="mt-2">
                    <polyline fill="none" stroke={unified.score>=0.7?'#ef4444':unified.score>=0.4?'#f59e0b':'#10b981'} strokeWidth="2" points={unifiedHistory.map((v,i)=>`${(i/(unifiedHistory.length-1))*190+5},${34-(v/100)*28}`).join(' ')} />
                    {unifiedHistory.map((v,i)=><circle key={i} cx={(i/(unifiedHistory.length-1))*190+5} cy={34-(v/100)*28} r="2" fill={v>=70?'#ef4444':v>=40?'#f59e0b':'#10b981'} />)}
                  </svg>
                )}
                {unifiedHistory.length>1 && <div className="text-[10px] text-gray-500 flex gap-1">{unifiedHistDates.length? unifiedHistDates.join(' → ') : `${unifiedHistory.length} จุดล่าสุด`} · สูงสุด {Math.max(...unifiedHistory)}% ต่ำสุด {Math.min(...unifiedHistory)}%</div>}
              </div>
              <div className="w-16 h-16 rounded-full border-4 flex items-center justify-center text-sm font-bold ml-4" style={{borderColor: unified.score>=0.7?'#b91c1c':unified.score>=0.4?'#b45309':'#065f46'}}>{(unified.score*100).toFixed(0)}</div>
            </div>
          )}
          {sensorTrends.length>0 && (
            <div className="card p-4 space-y-2 border-sky-800/40 bg-sky-950/10">
              <h3 className="font-bold text-sm flex items-center gap-1"><Icon name="predictive" size={14} className="text-sky-400"/> Engine A — เซ็นเซอร์พยากรณ์พัง (trend 7วัน → 7วันข้างหน้า)</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                {sensorTrends.map((tr:any)=>(
                  <div key={tr.metric} className={`rounded-lg p-2 border ${tr.risk>=0.7?"border-red-700 bg-red-950/30":tr.risk>=0.4?"border-amber-700 bg-amber-950/20":"border-gray-700 bg-gray-900"}`}>
                    <div className="font-bold">{tr.label} ({tr.metric}) <span className={tr.trend==="down"?"text-amber-400":tr.trend==="up"?"text-sky-400":"text-gray-500"}>{tr.trend}</span></div>
                    <div className="text-gray-300">ตอนนี้ {tr.last}{tr.unit} → อีก7วัน {tr.forecast}{tr.unit} (slope {tr.slope}{tr.unit}/วัน)</div>
                    <div className={tr.risk>=0.7?"text-red-400":tr.risk>=0.4?"text-amber-400":"text-emerald-400"}>risk {(tr.risk*100).toFixed(0)}% — {tr.advice}</div>
                    <div className="flex gap-2 mt-1">
                      <a href="/sensors" className="text-[11px] text-sky-400 hover:underline">→ ดูเซ็นเซอร์</a>
                      <a href="/inventory" className="text-[11px] text-sky-400 hover:underline">→ เติมน้ำ/แบต</a>
                    </div>
                    <div className="text-gray-500">{tr.samples} samples 7วัน</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-gray-500">คำนวณจาก linear regression 7วันล่าสุดใน sensor_telemetry — ถ้าทำนายพังใกล้ threshold จะ risk สูงและขึ้น Telegram อัตโนมัติเมื่อ nightly</div>
            </div>
          )}
          {farmTrends.length>0 && (
            <div className="card p-4 space-y-2 border-emerald-800/40 bg-emerald-950/10">
              <h3 className="font-bold text-sm flex items-center gap-1"><Icon name="farm" size={14} className="text-emerald-400"/> Engine B — ฟาร์มพยากรณ์ (ดิน/เก็บเกี่ยว)</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                {farmTrends.map((tr:any)=>(
                  <div key={tr.plotId} className={`rounded-lg p-2 border ${tr.risk>=0.7?"border-red-700 bg-red-950/30":tr.risk>=0.4?"border-amber-700 bg-amber-950/20":"border-gray-700 bg-gray-900"}`}>
                    <div className="font-bold">{tr.name} {tr.crop?`· ${tr.crop}`:""} <span className="text-gray-500">[{tr.status}]</span></div>
                    <div className={tr.risk>=0.7?"text-red-400":tr.risk>=0.4?"text-amber-400":"text-emerald-400"}>risk {(tr.risk*100).toFixed(0)}% — {tr.advice}</div>
                    {tr.soil && <div className="text-gray-500">pH {tr.soil.ph} · ชื้น {tr.soil.moisture}% {tr.soil.n!=null?`· N ${tr.soil.n}`:""}</div>}
                    <div className="flex gap-2 mt-1"><a href="/farm" className="text-[11px] text-emerald-400 hover:underline">→ จัดการแปลง</a><a href="/inventory" className="text-[11px] text-sky-400 hover:underline">→ ปุ๋ย/เมล็ด</a></div>
                    <div className="text-gray-500">beds {tr.herbBeds}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {healthTrends.length>0 && (
            <div className="card p-4 space-y-2 border-rose-800/40 bg-rose-950/10">
              <h3 className="font-bold text-sm flex items-center gap-1"><Icon name="health" size={14} className="text-rose-400"/> Engine C — สุขภาพพยากรณ์ (BP/น้ำตาล/32Q)</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                {healthTrends.map((tr:any)=>(
                  <div key={tr.metric} className={`rounded-lg p-2 border ${tr.risk>=0.7?"border-red-700 bg-red-950/30":tr.risk>=0.4?"border-amber-700 bg-amber-950/20":"border-gray-700 bg-gray-900"}`}>
                    <div className="font-bold">{tr.label} ({tr.metric}) <span className={tr.trend==="up"?"text-amber-400":"text-gray-500"}>{tr.trend}</span></div>
                    <div className="text-gray-300">ล่าสุด {tr.last}{tr.unit} · เฉลี่ย {tr.avg}{tr.unit}</div>
                    <div className={tr.risk>=0.7?"text-red-400":tr.risk>=0.4?"text-amber-400":"text-emerald-400"}>risk {(tr.risk*100).toFixed(0)}% — {tr.advice}</div>
                    <div className="flex gap-2 mt-1"><a href="/health" className="text-[11px] text-rose-400 hover:underline">→ ตรวจสุขภาพ</a><a href="/health/self-check" className="text-[11px] text-sky-400 hover:underline">→ 32Q</a></div>
                    <div className="text-gray-500">{tr.samples} samples</div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                      <div className="font-bold flex justify-between"><span>{m.domain} · {m.model}</span><span className={m.accuracy!=null && m.accuracy>=0.7?"text-emerald-400":m.accuracy!=null?"text-amber-400":"text-gray-500"}>{m.accuracy!=null?(m.accuracy*100).toFixed(0)+"%":"—"}</span></div>
                      <div className="w-full h-2 bg-gray-800 rounded mt-1"><div className={`h-2 rounded ${m.accuracy!=null && m.accuracy>=0.7?'bg-emerald-500':m.accuracy!=null && m.accuracy>=0.5?'bg-amber-500':'bg-gray-600'}`} style={{width: `${m.accuracy!=null?Math.round(m.accuracy*100):0}%`}} /></div>
                      <div className="text-gray-500">{m.stats?`${m.stats.correct}/${m.stats.total} correct`:""} · {new Date(m.trainedAt).toLocaleString('th-TH')}</div>
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
