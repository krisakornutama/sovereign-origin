"use client";
import { useCallback, useEffect, useState } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { authFetch } from '../../lib/apiFetch';
import { getApiUrl } from '../../lib/config';

/**
 * แผง Client Health — สรุป error ที่เก็บจาก browser ของผู้ใช้จริง (7 วันล่าสุด)
 * ข้อมูลมาจาก GET /api/system/client-health (SecurityEvent event_type=CLIENT_ERROR)
 * - กราฟแนวโน้มรายวัน (SVG วาดเอง — ไม่เพิ่ม dependency)
 * - จัดกลุ่มตาม browser / หน้าเว็บ / ชนิด error + WebView highlight (เคส LINE in-app)
 * - top errors พร้อมนับถี่ + เวลาล่าสุดที่เจอ
 */
interface ClientHealthSummary {
  days: number;
  total: number;
  webviewCount: number;
  byBrowser: Array<{ key: string; count: number }>;
  byPage: Array<{ key: string; count: number }>;
  byKind: Array<{ key: string; count: number }>;
  topErrors: Array<{ message: string; count: number; lastAt: string }>;
  daily: Array<{ date: string; count: number }>;
}

const KIND_LABELS: Record<string, string> = {
  js: 'JS throw',
  promise: 'Promise reject',
  resource: 'Resource โหลดพัง',
  fetch: 'Fetch fail',
  capability: 'ขาด capability',
  synthetic: 'Synthetic check',
  unknown: 'ไม่ทราบชนิด',
};

/** กราฟแท่งรายวันแบบ SVG — ไม่มี dep, scale ตามค่าสูงสุด */
function DailyBars({ daily }: { daily: Array<{ date: string; count: number }> }) {
  const max = Math.max(...daily.map((d) => d.count), 1);
  const W = 560;
  const H = 120;
  const pad = 24;
  const bw = (W - pad * 2) / Math.max(daily.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="client errors per day">
      {daily.map((d, i) => {
        const h = d.count > 0 ? Math.max(((H - pad * 2) * d.count) / max, 3) : 2;
        const x = pad + i * bw + bw * 0.15;
        const y = H - pad - h;
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={bw * 0.7} height={h} rx={2}
              className={d.count > 0 ? 'fill-rose-500/80' : 'fill-gray-700/60'} />
            {d.count > 0 && (
              <text x={x + bw * 0.35} y={y - 4} textAnchor="middle" className="fill-rose-300" fontSize="9">
                {d.count}
              </text>
            )}
            <text x={x + bw * 0.35} y={H - 8} textAnchor="middle" className="fill-gray-500" fontSize="8">
              {d.date.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function TopList({ title, rows, empty }: { title: string; rows: Array<{ key: string; count: number }>; empty: string }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="min-w-0 flex-1">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-600">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="truncate text-gray-300" title={r.key}>{r.key}</span>
                <span className="text-gray-500 shrink-0">{r.count}</span>
              </div>
              <div className="h-1 mt-0.5 rounded bg-gray-800 overflow-hidden">
                <div className="h-full bg-amber-500/70" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ClientHealthPanel() {
  const t = useLanguageStore((s) => s.t);
  const [summary, setSummary] = useState<ClientHealthSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const base = getApiUrl().replace(/\/$/, '');
      const res = await authFetch(`${base}/api/system/client-health?days=7`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSummary(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000); // ข้อมูลชุดนี้ไม่ต้องเรียลไทม์ — นาทีละครั้งพอ
    return () => clearInterval(iv);
  }, [load]);

  return (
    <div className="panel panel-rose">
      <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text-rose">
          {t('system.clientHealth.title', 'Client Health — สิ่งที่ลูกค้าเจอ (7 วันล่าสุด)')}
        </h2>
        {summary && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
              {t('system.clientHealth.totalEvents', 'error {n} ครั้ง', { n: summary.total })}
            </span>
            {summary.webviewCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-900/60 text-amber-300" title="in-app browser (LINE/FB ฯลฯ)">
                📱 WebView {summary.webviewCount}
              </span>
            )}
          </div>
        )}
      </div>

      {failed ? (
        <div className="p-4 text-xs text-gray-500">{t('system.clientHealth.unreachable', 'ดึงสรุปไม่ได้ — API ยังไม่รองรับ endpoint นี้หรือเชื่อมต่อไม่ได้')}</div>
      ) : !summary ? (
        <div className="flex items-center justify-center py-10 gap-2 text-gray-500">
          <span className="w-4 h-4 border-2 border-gray-600 border-t-rose-500 rounded-full animate-spin" />
          <span className="text-sm">{t('common.loading', 'กำลังโหลด...')}</span>
        </div>
      ) : summary.total === 0 ? (
        <div className="p-4 text-sm text-emerald-400">
          ✅ {t('system.clientHealth.allClean', '7 วันล่าสุดไม่มี error จากฝั่งลูกค้าเลย — ทั้ง real user และ synthetic check ผ่านหมด')}
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <DailyBars daily={summary.daily} />

          <div className="flex flex-wrap gap-6">
            <TopList
              title={t('system.clientHealth.byBrowser', 'ตามเบราว์เซอร์')}
              rows={summary.byBrowser}
              empty={t('common.noData', 'ไม่มีข้อมูล')}
            />
            <TopList
              title={t('system.clientHealth.byPage', 'หน้าที่พังบ่อย')}
              rows={summary.byPage}
              empty={t('common.noData', 'ไม่มีข้อมูล')}
            />
            <TopList
              title={t('system.clientHealth.byKind', 'ตามชนิด error')}
              rows={summary.byKind.map((k) => ({ ...k, key: KIND_LABELS[k.key] || k.key }))}
              empty={t('common.noData', 'ไม่มีข้อมูล')}
            />
          </div>

          {summary.topErrors.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {t('system.clientHealth.topErrors', 'error ที่เจอบ่อยสุด')}
              </h4>
              <ul className="space-y-1 text-xs">
                {summary.topErrors.map((e, i) => (
                  <li key={i} className="flex justify-between gap-3 bg-gray-900/50 rounded px-2.5 py-1.5">
                    <span className="truncate text-gray-300" title={e.message}>{e.message}</span>
                    <span className="shrink-0 text-gray-500">
                      ×{e.count} · {new Date(e.lastAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
