"use client";
import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';

// ขนาด viewBox (อัตราส่วน 2:1 ของแผนที่โลก)
const W = 800;
const H = 400;

// equirectangular projection: lon -180..180 → x, lat 90..-90 → y
function project(lat: number, lng: number) {
  return { x: ((lng + 180) / 360) * W, y: ((90 - lat) / 180) * H };
}

const GRATICULE = Array.from({ length: 7 }, (_, i) => -90 + i * 30); // ละติจูด
const MERIDIANS = Array.from({ length: 7 }, (_, i) => -180 + i * 60); // ลองจิจูด

function isOnline(d: any): boolean {
  if (!d.last_heartbeat) return false;
  return Date.now() - new Date(d.last_heartbeat).getTime() < 120000;
}

export default function GlobalMap() {
  const t = useLanguageStore((s) => s.t);
  const [devices, setDevices] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/devices`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled) setDevices(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (!cancelled) {
          setDevices([]);
          setError(t('dashboard.map.loadError', 'ไม่สามารถโหลดข้อมูลอุปกรณ์ได้'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const located = (devices || []).filter((d) => d.latitude != null && d.longitude != null);

  return (
    <div className="h-full w-full flex flex-col">
      {devices === null ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">{t('dashboard.map.loadingCoordinates', 'กำลังโหลดพิกัดอุปกรณ์...')}</div>
      ) : located.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
          <div className="flex items-center gap-1.5"><Icon name="map-pin" size={14} /> {t('dashboard.map.noCoordinates', 'ยังไม่มีพิกัดอุปกรณ์')}</div>
          <div className="text-xs text-gray-600">
            {t('dashboard.map.hint', 'ตั้งพิกัดได้ในหน้า Device Manager (ปุ่มตั้งพิกัด) — แผนที่จะแสดงตำแหน่งจริงจาก ')}<code>/api/devices</code>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
            <span className="flex items-center gap-1.5"><Icon name="map-pin" size={12} /> {t('dashboard.map.locationsSummary', '{n} ตำแหน่ง จาก {total} อุปกรณ์', { n: located.length, total: devices!.length })}</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> {t('common.online', 'ออนไลน์')}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> {t('common.offline', 'ออฟไลน์')}</span>
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full bg-gray-900/60 rounded-lg border border-gray-700 panel-cyan">
            <rect x="0" y="0" width={W} height={H} fill="#0b1220" />
            {/* graticule */}
            {GRATICULE.map((lat) => {
              const { y } = project(lat, 0);
              return <line key={`lat${lat}`} x1="0" y1={y} x2={W} y2={y} stroke="#1e293b" strokeWidth="1" />;
            })}
            {MERIDIANS.map((lng) => {
              const { x } = project(0, lng);
              return <line key={`lng${lng}`} x1={x} y1="0" x2={x} y2={H} stroke="#1e293b" strokeWidth="1" />;
            })}
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#334155" strokeWidth="1.5" />
            {/* เส้นศูนย์สูตร label */}
            <text x={W - 6} y={H / 2 - 4} textAnchor="end" fill="#475569" fontSize="11">{t('dashboard.map.equator', 'เส้นศูนย์สูตร')}</text>
            {/* pins */}
            {located.map((d) => {
              const { x, y } = project(d.latitude, d.longitude);
              const online = isOnline(d);
              const color = online ? '#10b981' : '#ef4444';
              return (
                <g key={d.id}>
                  <circle cx={x} cy={y} r="10" fill={color} opacity="0.25" />
                  <circle cx={x} cy={y} r="5" fill={color} stroke="#0b1220" strokeWidth="1.5">
                    <title>{`${d.type} (${d.mqtt_topic})${d.node ? ` · node: ${d.node}` : ''}\n${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}\n${online ? t('common.online', 'ออนไลน์') : t('common.offline', 'ออฟไลน์')}`}</title>
                  </circle>
                </g>
              );
            })}
          </svg>
          {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
        </>
      )}
    </div>
  );
}
