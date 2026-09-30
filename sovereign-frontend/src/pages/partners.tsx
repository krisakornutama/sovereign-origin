import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { getApiUrl } from '../lib/config';
import { FeedbackButton } from '../components/public/FeedbackButton';
import { trackPageView, trackCtaClick } from '../lib/visitorTrack';

// P16 — Partner Network: แผนที่คู่ค้า (ร้านค้า SME · ช่าง · ผู้ให้บริการ)
//  สมัครสาธารณะ → รออนุมัติ → ขึ้นแผนที่ · ของที่ได้: หมุดบนแผนที่ร่วม + ช่องทาง IoT/ระบบช่วยร้าน
//  แผนที่: OpenStreetMap ผ่าน Leaflet CDN — ไม่เพิ่ม dependency ใน repo

type Partner = {
  id: string;
  name: string;
  category: string;
  detail?: string | null;
  address?: string | null;
  phone?: string | null;
  lat: number;
  lng: number;
};

const CATEGORY_LABEL: Record<string, string> = {
  SHOP: '🏪 ร้านค้า',
  TECHNICIAN: '🔧 ช่าง',
  OTHER: '🤝 พันธมิตรอื่น',
};

const THAILAND_CENTER = { lat: 15.1, lng: 101.0 };

declare global {
  interface Window {
    L?: any;
  }
}

function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const css = document.createElement('link');
      css.id = 'leaflet-css';
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }
    const existing = document.getElementById('leaflet-js') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L));
      existing.addEventListener('error', reject);
      if (window.L) resolve(window.L);
      return;
    }
    const s = document.createElement('script');
    s.id = 'leaflet-js';
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'SHOP', detail: '', address: '', phone: '', contactName: '', contactPhone: '' });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const pinMarkerRef = useRef<any>(null);
  const pickModeRef = useRef(false);

  useEffect(() => {
    trackPageView('/partners');
  }, []);

  const loadPartners = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/partners`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPartners(Array.isArray(data.partners) ? data.partners : []);
      setPendingCount(typeof data?.counts?.pending === 'number' ? data.counts.pending : null);
    } catch {
      // offline — แผนที่ว่างได้
    }
  }, []);

  useEffect(() => {
    loadPartners();
    loadLeaflet()
      .then((L) => {
        const map = L.map('partner-map', { scrollWheelZoom: false }).setView([THAILAND_CENTER.lat, THAILAND_CENTER.lng], 5);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        mapRef.current = map;
        map.on('click', (e: any) => {
          if (!pickModeRef.current) return;
          const pos = { lat: Number(e.latlng.lat.toFixed(5)), lng: Number(e.latlng.lng.toFixed(5)) };
          setPin(pos);
          setPicking(false);
          pickModeRef.current = false;
          if (pinMarkerRef.current) pinMarkerRef.current.remove();
          pinMarkerRef.current = L.marker([pos.lat, pos.lng], {
            icon: L.divIcon({ className: '', html: '<div style="font-size:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">📍</div>', iconSize: [26, 26], iconAnchor: [13, 24] }),
          }).addTo(map);
        });
        setMapReady(true);
      })
      .catch(() => setMapReady(false));
  }, [loadPartners]);

  // วาดหมุดคู่ค้าเมื่อข้อมูล/แผนที่พร้อม
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = partners.map((p) =>
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div title="${p.name.replace(/"/g, '')}" style="font-size:22px">${CATEGORY_LABEL[p.category]?.split(' ')[0] ?? '📍'}</div>`, iconSize: [22, 22], iconAnchor: [11, 20] }),
      })
        .addTo(map)
        .bindPopup(`<b>${p.name}</b><br/>${CATEGORY_LABEL[p.category] ?? ''}<br/>${(p.detail ?? '').slice(0, 120)}${p.address ? `<br/><small>${p.address}</small>` : ''}`)
    );
  }, [partners, mapReady]);

  function startPick() {
    setPicking(true);
    pickModeRef.current = true;
    mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending || !pin) return;
    setSending(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/partners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, lat: pin.lat, lng: pin.lng }),
      });
      if (res.ok) {
        setSent(true);
        trackCtaClick('/partners', 'partner_apply', 'form');
      }
    } catch {
      // เงียบตามธรรมเนียม honeypot — ฟอร์มปกติควรสำเร็จ
    } finally {
      setSending(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-emerald-500/60';
  const labelCls = 'block text-[11px] text-gray-400 mb-1';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Head>
        <title>แผนที่คู่ค้า — Sovereign Origin</title>
        <meta name="description" content="แผนที่ร้านค้า SME ช่าง และพันธมิตรในเครือข่าย Sovereign Origin — สมัครเข้าร่วมได้" />
      </Head>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">🗺️ แผนที่คู่ค้าเครือข่าย</h1>
          <p className="text-sm text-gray-400 max-w-2xl mx-auto">
            ร้านค้า SME รายย่อย ช่างทุกสาย และผู้ให้บริการ ที่ร่วมเครือข่ายกับเรา — สมัครเข้าร่วมฟรี
            ได้หมุดบนแผนที่ร่วม และช่องทางเข้าถึงระบบ/อุปกรณ์ IoT ที่ช่วยแก้ปัญหาหน้าร้านจริง
          </p>
          {pendingCount !== null && pendingCount > 0 && (
            <p className="text-[11px] text-gray-600 mt-2">รอตรวจสอบการสมัคร {pendingCount} รายการ</p>
          )}
        </header>

        <div id="partner-map" className="h-[420px] rounded-xl border border-white/10 mb-2 z-0" />
        <p className="text-[11px] text-gray-500 text-center mb-8">
          {picking ? '👇 คลิกตำแหน่งร้านบนแผนที่เพื่อปักหมุด' : 'แผนที่จาก OpenStreetMap — แสดงเฉพาะคู่ค้าที่อนุมัติแล้ว'}
        </p>

        {partners.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">คู่ค้าในเครือข่าย ({partners.length})</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {partners.map((p) => (
                <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                    <span className="text-[10px] rounded-full bg-emerald-500/10 text-emerald-400 px-2 py-0.5 whitespace-nowrap">
                      {CATEGORY_LABEL[p.category] ?? '🤝'}
                    </span>
                  </div>
                  {p.detail && <p className="text-xs text-gray-400 mb-2">{p.detail}</p>}
                  {p.address && <p className="text-[11px] text-gray-500">📍 {p.address}</p>}
                  {p.phone && (
                    <a href={`tel:${p.phone}`} className="text-[11px] text-emerald-400 hover:underline">
                      ☎ {p.phone}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          {sent ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">🎉</div>
              <h2 className="text-lg font-semibold mb-2">ส่งใบสมัครแล้ว</h2>
              <p className="text-sm text-gray-400">
                ทีมงานจะตรวจสอบและปักหมุดร้านคุณบนแผนที่เร็วที่สุด — ขอบคุณที่ร่วมเครือข่าย
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-1">สมัครเข้าร่วมเครือข่าย</h2>
              <p className="text-xs text-gray-500 mb-5">กรอกสั้น ๆ ปักหมุดร้านบนแผนที่ แล้วทีมงานจะตรวจและเพิ่มให้ (ฟรี ไม่มีค่าใช้จ่าย)</p>
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className={labelCls}>ชื่อร้าน / ชื่อช่าง *</label>
                  <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น ร้านถ่ายเสียงกลางอำเภอ" required maxLength={120} />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>ประเภท *</label>
                    <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                      <option value="SHOP">🏪 ร้านค้า</option>
                      <option value="TECHNICIAN">🔧 ช่าง</option>
                      <option value="OTHER">🤝 พันธมิตรอื่น</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>เบอร์ร้าน (แสดงบนแผนที่)</label>
                    <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0X-XXX-XXXX" maxLength={20} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>รายละเอียดสั้น ๆ (ทำอะไร ขายอะไร)</label>
                  <textarea className={inputCls} rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} placeholder="เช่น ติดตั้งกล้องวงจรปิด ระบบเสียงร้านค้า" maxLength={300} />
                </div>
                <div>
                  <label className={labelCls}>ที่อยู่</label>
                  <input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด" maxLength={200} />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>ชื่อผู้ติดต่อ * (ไม่แสดงสาธารณะ)</label>
                    <input className={inputCls} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} required maxLength={80} />
                  </div>
                  <div>
                    <label className={labelCls}>เบอร์ผู้ติดต่อ * (ไม่แสดงสาธารณะ)</label>
                    <input className={inputCls} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} required maxLength={20} />
                  </div>
                </div>
                <div className="rounded-lg border border-dashed border-white/15 p-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-400">
                    {pin ? (
                      <>📌 หมุดพร้อม: <span className="text-emerald-400">{pin.lat}, {pin.lng}</span></>
                    ) : (
                      'ตำแหน่งร้านบนแผนที่ *'
                    )}
                  </div>
                  <button type="button" onClick={startPick} className="text-xs rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 whitespace-nowrap">
                    {pin ? '📌 ปักหมุดใหม่' : '📌 ปักหมุดบนแผนที่'}
                  </button>
                </div>
                <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
                <button
                  type="submit"
                  disabled={!form.name || !pin || !form.contactName || !form.contactPhone || sending}
                  className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-gray-950 font-semibold py-3 text-sm transition"
                >
                  {sending ? 'กำลังส่ง…' : '🤝 ส่งใบสมัครเข้าร่วม'}
                </button>
                <p className="text-[10px] text-gray-600 text-center">
                  ข้อมูลผู้ติดต่อใช้เพื่อการตรวจสอบเท่านั้น — ไม่แสดงบนแผนที่สาธารณะ
                </p>
              </form>
            </>
          )}
        </section>

        <footer className="text-center text-[10px] text-gray-600 pt-8">
          เครือข่ายคู่ค้า Sovereign Origin · <a href="/demo" className="hover:text-gray-400 underline underline-offset-2">ลองเล่นเดโม่</a> · <a href="/shop" className="hover:text-gray-400 underline underline-offset-2">สนับสนุนโครงการ</a> · <a href="/about" className="hover:text-gray-400 underline underline-offset-2">เกี่ยวกับเรา</a>
        </footer>
      </main>
      <FeedbackButton page="/partners" />
    </div>
  );
}
