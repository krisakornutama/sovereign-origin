"use client";
import { useState, useEffect } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { authFetch } from "../../lib/apiFetch";
import { useAuthStore } from "../../stores/useAuthStore";
import Link from "next/link";

export default function KitchenIOTPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const [sensors, setSensors] = useState<Record<string, any>>({});
  const [alerts, setAlerts] = useState<string[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [selectedInv, setSelectedInv] = useState("");
  const [weight, setWeight] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  const load = async () => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/kitchen-sensors`);
    if(r.ok){ const d=await r.json(); setSensors(d.sensors||{}); setAlerts(d.alerts||[]); }
    const inv = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/inventory?limit=100`);
    if(inv.ok){ const d=await inv.json(); setInventory(d.items||d||[]); }
  };
  useEffect(()=>{ if(isAuthenticated) { load(); const iv=setInterval(load,10000); return()=>clearInterval(iv); } },[isAuthenticated]);

  const syncWeight = async () => {
    if(!selectedInv || !weight) return setErr("เลือกวัตถุดิบและใส่น้ำหนัก");
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/iot/weight`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({inventoryItemId:selectedInv, weightKg:Number(weight), deviceId:"hx711-kitchen"})});
    const d=await res.json();
    if(res.ok){ setMsg(`อัปเดต ${d.item.name} → ${weight}kg สำเร็จ (HX711)`); setWeight(""); load(); } else setErr(d.error);
  };

  if(!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">กำลังโหลด...</div>;
  if(!isAuthenticated) return <div className="text-white p-8">Unauthorized</div>;

  const card = (label:string, key:string, unit:string, icon:string) => {
    const v = sensors[key];
    return (
      <div className="card p-4 text-center">
        <div className="text-xs text-gray-400 flex items-center justify-center gap-1"><Icon name={icon} size={12}/>{label}</div>
        <div className="text-2xl font-bold mt-1">{v? `${v.value} ${unit}` : "—"}</div>
        <div className="text-xs text-gray-500">{v? new Date(v.time).toLocaleTimeString('th-TH') : "ไม่มีข้อมูล"}</div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3">
          <PageHeader eyebrow="จักรวรรดิ" title="ครัว IOT — น้ำหนัก + ตู้เย็น" icon={<Icon name="sensors" size={18} />} subtitle="HX711 น้ำหนัก → Inventory อัตโนมัติ • DS18B20 ตู้เย็น → เตือนของเสีย" actions={<Link href="/restaurant" className="text-sm text-sky-400 hover:underline">← POS</Link>} />
        </header>
        <main className="max-w-6xl mx-auto p-6 space-y-4 w-full">
          {msg && <div className="inset p-3 text-sm text-emerald-300">{msg}</div>}
          {err && <div className="inset p-3 text-sm text-red-400">{err}</div>}
          {alerts.length>0 && <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-sm text-red-300 space-y-1">{alerts.map((a,i)=><div key={i}>⚠️ {a}</div>)}</div>}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {card("น้ำหนักครัว", "kitchen_weight", "kg", "inventory")}
            {card("ตู้เย็น", "fridge_temp", "°C", "thermometer")}
            {card("ครัว temp", "kitchen_temp", "°C", "thermometer")}
            {card("ครัว humidity", "kitchen_humidity", "%", "droplet")}
          </div>

          <div className="card p-4">
            <h3 className="font-bold text-sm mb-2">ซิงค์น้ำหนัก HX711 → Inventory</h3>
            <p className="text-xs text-gray-500 mb-3">วางวัตถุดิบบนตาชั่ง HX711 → mqtt `sovereign/+/sensor/kitchen_weight` → หรือกรอกมือที่นี่ (จะอัปเดต `InventoryItem.quantity` ทันที)</p>
            <div className="flex flex-wrap gap-2">
              <select value={selectedInv} onChange={e=>setSelectedInv(e.target.value)} className="flex-1 min-w-60 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm">
                <option value="">— เลือกวัตถุดิบ —</option>
                {inventory.map((it:any)=><option key={it.id} value={it.id}>{it.name} ({it.quantity}{it.unit})</option>)}
              </select>
              <input value={weight} onChange={e=>setWeight(e.target.value)} placeholder="น้ำหนัก kg (เช่น 2.5)" type="number" step="0.01" className="w-40 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm" />
              <button onClick={syncWeight} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-bold">ซิงค์</button>
            </div>
            <p className="text-xs text-gray-500 mt-2">IOT จริง: ESP32 + HX711 ส่ง `sovereign/kitchen/sensor/kitchen_weight` ทุก 5s → `mqttIngest` → `sensor_telemetry` → หน้านี้ poll ทุก 10s</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="font-bold text-sm mb-2">วิธีต่อ IOT ครัว</h3>
              <ol className="list-decimal ml-4 text-sm space-y-1 text-gray-300">
                <li>ไปที่ <Link href="/sensors" className="text-sky-400 underline">/sensors</Link> → Generate Code เลือก `HX711` + `DS18B20`</li>
                <li>แฟลช ESP32 ครัว → จะส่ง `kitchen_weight` และ `fridge_temp` อัตโนมัติ</li>
                <li>ตั้ง Automation: `fridge_temp &gt; 8` → Alert (มีแล้วใน Automation)</li>
              </ol>
            </div>
            <div className="card p-4">
              <h3 className="font-bold text-sm mb-2">สถานะ</h3>
              <div className="text-xs space-y-1 text-gray-400">
                <div>MQTT: <span className="text-emerald-400">connected (via mqttIngest)</span></div>
                <div>Inventory: {inventory.length} รายการ</div>
                <div>Alerts: {alerts.length} รายการ</div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
