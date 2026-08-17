"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

interface DataPoint {
  time: number; // Unix ms
  value: number; // ค่าเฉลี่ยใน bucket
  min: number;
  max: number;
}

interface MetricSeries {
  metric: string;
  points: DataPoint[];
}

type Range = '24h' | '7d' | '30d' | 'custom';

const RANGES: { key: Range; label: string }[] = [
  { key: '24h', label: '24 ชม' },
  { key: '7d', label: '7 วัน' },
  { key: '30d', label: '30 วัน' },
  { key: 'custom', label: 'กำหนดเอง' },
];

// สีของเส้น/แถบ ไล่ตามลำดับ metric ที่เลือก
const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 400;
const PADDING = { top: 20, right: 30, bottom: 40, left: 60 };

export default function HistoryPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);
  const [range, setRange] = useState<Range>(() => {
    // เปิดจาก sparkline ใน dashboard (?range=7d/30d) -> ใช้ช่วงนั้นเลย
    if (typeof window === 'undefined') return '24h';
    const r = new URLSearchParams(window.location.search).get('range');
    return r === '7d' || r === '30d' || r === 'custom' ? r : '24h';
  });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // โหลดรายชื่อ metric ที่มีข้อมูลจริงใน TimescaleDB
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/timescale/metrics`)
      .then((res) => res.json())
      .then((list: string[]) => {
        setMetrics(list);
        setSelectedMetrics((prev) => {
          // มี metric ที่เลือกอยู่แล้ว -> เก็บเฉพาะตัวที่ยังมีข้อมูล
          if (prev.length > 0) {
            const stillExist = prev.filter((m) => list.includes(m));
            return stillExist.length > 0 ? stillExist : list[0] ? [list[0]] : [];
          }
          // ครั้งแรก: ใช้ metric จาก URL (?metric=xxx จาก sparkline ใน dashboard)
          const initial =
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search).get('metric')
              : null;
          if (initial && list.includes(initial)) return [initial];
          return list[0] ? [list[0]] : [];
        });
      })
      .catch(console.error);
  }, [isAuthenticated, user]);

  const fetchHistory = useCallback(async () => {
    if (selectedMetrics.length === 0) return;
    setLoading(true);
    setError('');
    try {
      // ดึงข้อมูลทุก metric ที่เลือกพร้อมกัน
      const results = await Promise.all(
        selectedMetrics.map(async (metric) => {
          const params = new URLSearchParams({ metric });
          if (range === 'custom') {
            if (from) params.append('from', from);
            if (to) params.append('to', to);
          } else {
            params.append('range', range);
          }
          const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/timescale/history?${params}`);
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${metric}`);
          const result = await res.json();
          return {
            metric,
            points: result.map((r: any) => ({
              time: new Date(r.bucket).getTime(),
              value: r.avg_value,
              min: r.min_value,
              max: r.max_value,
            })),
          };
        })
      );
      setSeries(results);
    } catch (err) {
      console.error(err);
      setError(t('history.loadError', 'โหลดข้อมูลไม่สำเร็จ — ตรวจว่า backend เปิดอยู่และมีข้อมูลใน TimescaleDB'));
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }, [selectedMetrics, range, from, to]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const toggleMetric = (m: string) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(m)) {
        if (prev.length === 1) return prev; // ต้องเหลืออย่างน้อย 1 metric
        return prev.filter((x) => x !== m);
      }
      return [...prev, m];
    });
  };

  // สีของ metric อิงจากลำดับใน selectedMetrics -> ตรงกับสีเส้นในกราฟ
  const colorOf = (m: string) => COLORS[selectedMetrics.indexOf(m) % COLORS.length];

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (loading) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t('history.loadingChart', 'กำลังโหลดข้อมูล…'), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      return;
    }

    const allPoints = series.flatMap((s) => s.points);
    if (allPoints.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(error || t('history.noDataInRange', 'ยังไม่มีข้อมูลเซ็นเซอร์ในช่วงเวลานี้'), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      return;
    }

    // Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // ขอบเขต x/y จากทุก series
    const xMin = Math.min(...allPoints.map((p) => p.time));
    const xMax = Math.max(...allPoints.map((p) => p.time));
    const allValues = allPoints.flatMap((p) => [p.min, p.max]);
    const yMin = Math.min(...allValues);
    const yMax = Math.max(...allValues);
    const yRange = yMax - yMin || 1;

    const scaleX = (t: number) => PADDING.left + ((t - xMin) / (xMax - xMin || 1)) * (CANVAS_WIDTH - PADDING.left - PADDING.right);
    const scaleY = (v: number) => CANVAS_HEIGHT - PADDING.bottom - ((v - yMin) / yRange) * (CANVAS_HEIGHT - PADDING.top - PADDING.bottom);

    // Grid แนวนอน
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = PADDING.top + (i / 4) * (CANVAS_HEIGHT - PADDING.top - PADDING.bottom);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(CANVAS_WIDTH - PADDING.right, y);
      ctx.stroke();

      const val = yMax - (i / 4) * yRange;
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), PADDING.left - 5, y + 3);
    }

    // วาดทีละ series: แถบ min–max + เส้นค่าเฉลี่ย + จุด
    series.forEach((s, i) => {
      if (s.points.length === 0) return;
      const color = COLORS[i % COLORS.length];

      // แถบ min–max
      ctx.beginPath();
      s.points.forEach((p, j) => {
        const x = scaleX(p.time);
        const y = scaleY(p.max);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      s.points.slice().reverse().forEach((p) => {
        const x = scaleX(p.time);
        const y = scaleY(p.min);
        ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = color + '1f'; // hex + alpha ~12%
      ctx.fill();

      // เส้นค่าเฉลี่ย
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      s.points.forEach((p, j) => {
        const x = scaleX(p.time);
        const y = scaleY(p.value);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // จุดข้อมูล (ข้ามถ้าจำนวนมากเกินไป)
      if (s.points.length <= 200) {
        ctx.fillStyle = color;
        s.points.forEach((p) => {
          const x = scaleX(p.time);
          const y = scaleY(p.value);
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    // Label แกนเวลา: ช่วงสั้นแสดงเวลา ช่วงยาว (>=2 วัน) แสดงวันที่
    const spanMs = xMax - xMin;
    const fmt = (t: number) =>
      spanMs > 2 * 86400000
        ? new Date(t).toLocaleDateString(fmtLocale(), { day: '2-digit', month: '2-digit' })
        : new Date(t).toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' });
    const timeLabels = 6;
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i <= timeLabels; i++) {
      const t = xMin + (i / timeLabels) * (xMax - xMin);
      const x = scaleX(t);
      ctx.fillText(fmt(t), x, CANVAS_HEIGHT - PADDING.bottom + 15);
    }
  }, [series, loading, error, t]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('history.unauthorized', 'Unauthorized')}</div>;

  const allPoints = series.flatMap((s) => s.points);
  const spanText = allPoints.length > 0
    ? `${new Date(Math.min(...allPoints.map((p) => p.time))).toLocaleString(fmtLocale())} → ${new Date(Math.max(...allPoints.map((p) => p.time))).toLocaleString(fmtLocale())}`
    : '—';

  const fileBase = `${(selectedMetrics.join('_') || 'metric').slice(0, 40)}_${range}_${new Date().toISOString().slice(0, 10)}`;

  const downloadCSV = () => {
    if (series.length === 0) return;
    const rows: string[] = [];
    if (series.length === 1) {
      // metric เดียว -> แบบ wide (เข้ากันได้กับไฟล์เดิม)
      const s = series[0];
      rows.push('time,value,min,max');
      s.points.forEach((p) => rows.push(`${new Date(p.time).toISOString()},${p.value},${p.min},${p.max}`));
    } else {
      // หลาย metric -> แบบ long (มีคอลัมน์ metric)
      rows.push('time,metric,value,min,max');
      series.forEach((s) =>
        s.points.forEach((p) =>
          rows.push(`${new Date(p.time).toISOString()},${s.metric},${p.value},${p.min},${p.max}`)
        )
      );
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas || allPoints.length === 0) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${fileBase}.png`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow={t('history.eyebrow', 'ข้อมูล & รายงาน')}
          title="Sensor History" icon={<Icon name="history" size={18} />} actions={<a href="/dashboard" className="text-sm text-sky-400 hover:underline">{t('history.backDashboard', '← กลับ Dashboard')}</a>}
        />
      </header>
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex gap-2 flex-wrap items-center">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={
                range === r.key
                  ? 'btn-primary px-3 py-1.5 text-sm'
                  : 'btn-ghost px-3 py-1.5 text-sm'
              }
            >
              {t(`history.range.${r.key}`, r.label)}
            </button>
          ))}
          {range === 'custom' && (
            <>
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              />
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </>
          )}
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            {loading ? t('history.reloading', 'กำลังโหลด…') : <><Icon name="refresh" size={14} /> {t('history.reload', 'โหลดใหม่')}</>}
          </button>
          <span className="mx-1 text-gray-600">|</span>
          <button
            onClick={downloadCSV}
            disabled={series.length === 0}
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            <Icon name="download" size={14} /> CSV
          </button>
          <button
            onClick={downloadPNG}
            disabled={allPoints.length === 0}
            className="btn-secondary px-3 py-1.5 text-sm"
          >
            <Icon name="image" size={14} /> PNG
          </button>
        </div>

        {/* เลือก metric: กดเพื่อเปิด/ปิด เปรียบเทียบได้หลายตัวพร้อมกัน */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-gray-400">{t('history.metricLabel', 'Metric:')}</span>
          {metrics.map((m) => {
            const active = selectedMetrics.includes(m);
            return (
              <button
                key={m}
                onClick={() => toggleMetric(m)}
                title={active ? t('history.toggleRemove', 'กดเพื่อเอากราฟออก') : t('history.toggleAdd', 'กดเพื่อเพิ่มกราฟ')}
                className={
                  active
                    ? 'px-3 py-1 rounded text-sm font-bold text-white shadow-neon-green'
                    : 'px-3 py-1 rounded text-sm bg-gray-800 border border-gray-600 text-gray-400 hover:bg-gray-700'
                }
                style={active ? { backgroundColor: colorOf(m) } : undefined}
              >
                {m}
              </button>
            );
          })}
        </div>

        {metrics.length === 0 && (
          <div className="flex items-start gap-2 text-sm text-amber-400 bg-gray-900 border border-amber-700/60 rounded-lg px-4 py-3">
            <Icon name="alert-triangle" size={15} className="shrink-0 mt-0.5" />
            <span>{t('history.noDataHint', 'ยังไม่มีข้อมูลเซ็นเซอร์ในฐานข้อมูล — รอข้อมูลจาก MQTT หรือเพิ่มข้อมูลด้วยมือที่หน้า Sensors')}</span>
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
          <span>{t('history.seriesCount', 'series: ')}<b className="text-emerald-400 glow-text">{series.length}</b></span>
          <span>{t('history.pointsCount', 'จุดข้อมูล: ')}<b className="text-emerald-400 glow-text">{allPoints.length}</b></span>
          <span>{t('history.rangeLabel', 'ช่วงเวลา: ')}{spanText}</span>
          <span className="ml-auto flex gap-3 flex-wrap">
            {series.map((s, i) => (
              <span key={s.metric} className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                {s.metric} <span className="text-gray-500">({s.points.length})</span>
              </span>
            ))}
            <span className="text-gray-600">{t('history.legend', '| เส้น = ค่าเฉลี่ย | แถบจาง = min–max')}</span>
          </span>
        </div>

        <div className="card panel-cyan p-2">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{ width: '100%', height: 'auto' }}
          />
        </div>
      </main>
    </div>
      </div>
  );
}
