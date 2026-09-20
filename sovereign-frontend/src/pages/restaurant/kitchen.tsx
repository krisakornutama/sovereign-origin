"use client";
import { useState, useEffect } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { authFetch } from "../../lib/apiFetch";
import { useAuthStore } from "../../stores/useAuthStore";
import { useLanguageStore } from "../../stores/useLanguageStore";
import Link from "next/link";

export default function KitchenIOTPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
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
    if(!selectedInv || !weight) return setErr(t('restaurant.kitchen.needInvWeight', 'เลือกวัตถุดิบและใส่น้ำหนัก'));
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/restaurant/iot/weight`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({inventoryItemId:selectedInv, weightKg:Number(weight), deviceId:"hx711-kitchen"})});
    const d=await res.json();
    if(res.ok){ setMsg(t('restaurant.kitchen.syncOk', 'อัปเดต {name} → {w}kg สำเร็จ (HX711)', { name: d.item.name, w: weight })); setWeight(""); load(); } else setErr(d.error);
  };

  if(!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('restaurant.loading', 'กำลังโหลด...')}</div>;
  if(!isAuthenticated) return <div className="text-white p-8">{t('restaurant.unauthorized', 'Unauthorized')}</div>;

  const card = (label:string, key:string, unit:string, icon:string) => {
    const v = sensors[key];
    return (
      <div className="card p-4 text-center">
        <div className="text-xs text-gray-400 flex items-center justify-center gap-1"><Icon name={icon} size={12}/>{label}</div>
        <div className="text-2xl font-bold mt-1">{v? `${v.value} ${unit}` : "—"}</div>
        <div className="text-xs text-gray-500">{v? new Date(v.time).toLocaleTimeString('th-TH') : t('restaurant.kitchen.noData', 'ไม่มีข้อมูล')}</div>
      </div>
    );
  };

  return (
    <div className="atmo-kitchen min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader eyebrow={t('restaurant.eyebrow', 'จักรวรรดิ')} title={t('restaurant.kitchen.title', 'ครัว IOT — น้ำหนัก + ตู้เย็น')} icon={<Icon name="sensors" size={18} />} subtitle={t('restaurant.kitchen.subtitle', 'HX711 น้ำหนัก → Inventory อัตโนมัติ • DS18B20 ตู้เย็น → เตือนของเสีย')} actions={<Link href="/restaurant" className="text-sm text-sky-400 hover:underline">{t('restaurant.backToPos', '← POS')}</Link>} />
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full space-y-4 w-full">
          {msg && <div className="inset p-3 text-sm text-emerald-300">{msg}</div>}
          {err && <div className="inset p-3 text-sm text-red-400">{err}</div>}
          {alerts.length>0 && <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-sm text-red-300 space-y-1">{alerts.map((a,i)=><div key={i}>⚠️ {a}</div>)}</div>}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {card(t('restaurant.kitchen.weightCard', 'น้ำหนักครัว'), "kitchen_weight", "kg", "inventory")}
            {card(t('restaurant.kitchen.fridgeCard', 'ตู้เย็น'), "fridge_temp", "°C", "thermometer")}
            {card(t('restaurant.kitchen.kitchenTemp', 'ครัว temp'), "kitchen_temp", "°C", "thermometer")}
            {card(t('restaurant.kitchen.kitchenHumidity', 'ครัว humidity'), "kitchen_humidity", "%", "droplet")}
          </div>

          <div className="card p-4">
            <h3 className="font-bold text-sm mb-2">{t('restaurant.kitchen.syncTitle', 'ซิงค์น้ำหนัก HX711 → Inventory')}</h3>
            <p className="text-xs text-gray-500 mb-3">{t('restaurant.kitchen.syncDesc', 'วางวัตถุดิบบนตาชั่ง HX711 → mqtt `sovereign/+/sensor/kitchen_weight` → หรือกรอกมือที่นี่ (จะอัปเดต `InventoryItem.quantity` ทันที)')}</p>
            <div className="flex flex-wrap gap-2">
              <select value={selectedInv} onChange={e=>setSelectedInv(e.target.value)} className="input text-sm flex-1">
                <option value="">{t('restaurant.kitchen.selectInvPlaceholder', '— เลือกวัตถุดิบ —')}</option>
                {inventory.map((it:any)=><option key={it.id} value={it.id}>{it.name} ({it.quantity}{it.unit})</option>)}
              </select>
              <input value={weight} onChange={e=>setWeight(e.target.value)} placeholder={t('restaurant.kitchen.weightPlaceholder', 'น้ำหนัก kg (เช่น 2.5)')} type="number" step="0.01" className="input text-sm" />
              <button onClick={syncWeight} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-bold">{t('restaurant.kitchen.syncButton', 'ซิงค์')}</button>
            </div>
            <p className="text-xs text-gray-500 mt-2">{t('restaurant.kitchen.iotNote', 'IOT จริง: ESP32 + HX711 ส่ง `sovereign/kitchen/sensor/kitchen_weight` ทุก 5s → `mqttIngest` → `sensor_telemetry` → หน้านี้ poll ทุก 10s')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card p-4">
              <h3 className="font-bold text-sm mb-2">{t('restaurant.kitchen.howtoTitle', 'วิธีต่อ IOT ครัว')}</h3>
              <ol className="list-decimal ml-4 text-sm space-y-1 text-gray-300">
                <li>{t('restaurant.kitchen.howtoStep1Prefix', 'ไปที่')} <Link href="/sensors" className="text-sky-400 underline">/sensors</Link> {t('restaurant.kitchen.howtoStep1Suffix', '→ Generate Code เลือก `HX711` + `DS18B20`')}</li>
                <li>{t('restaurant.kitchen.howtoStep2', 'แฟลช ESP32 ครัว → จะส่ง `kitchen_weight` และ `fridge_temp` อัตโนมัติ')}</li>
                <li>{t('restaurant.kitchen.howtoStep3', 'ตั้ง Automation: `fridge_temp > 8` → Alert (มีแล้วใน Automation)')}</li>
              </ol>
            </div>
            <div className="card p-4">
              <h3 className="font-bold text-sm mb-2">{t('restaurant.kitchen.statusTitle', 'สถานะ')}</h3>
              <div className="text-xs space-y-1 text-gray-400">
                <div>{t('restaurant.kitchen.mqttStatus', 'MQTT: connected (via mqttIngest)')}</div>
                <div>{t('restaurant.kitchen.inventoryCount', 'Inventory: {n} รายการ', { n: inventory.length })}</div>
                <div>{t('restaurant.kitchen.alertsCount', 'Alerts: {n} รายการ', { n: alerts.length })}</div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
