"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface EnergySummary {
  battery_soc: number | null;
  power_kw_avg_24h: number | null;
  power_kw_latest: number | null;
  kwh_net_24h: number | null;
  hours_remaining: number | null;
  capacity_kwh: number;
  status: 'no_data' | 'discharging' | 'charging' | 'balanced';
}

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 300;
const PADDING = { top: 20, right: 30, bottom: 40, left: 60 };

const statusLabels: Record<EnergySummary['status'], string> = {
  discharging: '🔴 ใช้แบตเตอรี่ (discharge)',
  charging: '🟢 กำลังชาร์จ / ผลิตไฟเกิน',
  balanced: '⚪ สมดุล',
  no_data: '⚪ ไม่มีข้อมูล',
};

export default function EnergyPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [summary, setSummary] = useState<EnergySummary | null>(null);
  const [points, setPoints] = useState<{ time: number; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const load = async () => {
      try {
        const [sumRes, histRes] = await Promise.all([
          authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/energy/summary`),
          authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/timescale/history?metric=power_kw&range=7d`),
        ]);
        if (!sumRes.ok) throw new Error(`HTTP ${sumRes.status}`);
        setSummary(await sumRes.json());
        const hist = await histRes.json();
        setPoints(
          hist.map((r: any) => ({
            time: new Date(r.bucket).getTime(),
            value: r.avg_value,
          }))
        );
      } catch (err) {
        console.error(err);
        setError('โหลดข้อมูลพลังงานไม่สำเร็จ — ตรวจว่า backend เปิดอยู่และมีข้อมูลเซ็นเซอร์');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthenticated, user]);

  const drawChart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    if (points.length === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ยังไม่มีข้อมูล power_kw', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      return;
    }

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const xMin = points[0].time;
    const xMax = points[points.length - 1].time;
    const values = points.map((p) => p.value);
    const yMin = Math.min(0, ...values);
    const yMax = Math.max(0, ...values);
    const yRange = yMax - yMin || 1;

    const scaleX = (t: number) => PADDING.left + ((t - xMin) / (xMax - xMin || 1)) * (CANVAS_WIDTH - PADDING.left - PADDING.right);
    const scaleY = (v: number) => CANVAS_HEIGHT - PADDING.bottom - ((v - yMin) / yRange) * (CANVAS_HEIGHT - PADDING.top - PADDING.bottom);

    // Grid + เส้นศูนย์
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
    // เส้นศูนย์เข้มขึ้น
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;
    const y0 = scaleY(0);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y0);
    ctx.lineTo(CANVAS_WIDTH - PADDING.right, y0);
    ctx.stroke();

    // เส้นกำลังไฟ
    ctx.beginPath();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    points.forEach((p, i) => {
      const x = scaleX(p.time);
      const y = scaleY(p.value);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // X labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      const t = xMin + (i / 5) * (xMax - xMin);
      const x = scaleX(t);
      ctx.fillText(new Date(t).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' }), x, CANVAS_HEIGHT - PADDING.bottom + 15);
    }
  }, [points]);

  useEffect(() => {
    drawChart();
  }, [drawChart]);

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="อุปกรณ์ &amp; พลังงาน"
          title="⚡ Energy Management" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {error && <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-4 py-3">{error}</div>}

        {loading ? (
          <div className="text-gray-500">⏳ กำลังโหลด…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                <div className="text-xs text-gray-400 mb-1">🔋 แบตเตอรี่</div>
                <div className="text-3xl font-bold text-green-400">
                  {summary?.battery_soc != null ? summary.battery_soc + '%' : 'N/A'}
                </div>
                <div className="w-full bg-gray-700 h-2 rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-green-400 to-emerald-600"
                    style={{ width: `${Math.min(100, summary?.battery_soc ?? 0)}%` }}
                  />
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                <div className="text-xs text-gray-400 mb-1">⚡ กำลังไฟเฉลี่ย 24 ชม.</div>
                <div className="text-3xl font-bold text-amber-400">
                  {summary?.power_kw_avg_24h != null ? summary.power_kw_avg_24h + ' kW' : 'N/A'}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  ล่าสุด: {summary?.power_kw_latest != null ? summary.power_kw_latest + ' kW' : 'N/A'}
                  {' '}(− = ใช้ไฟ, + = ชาร์จ)
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                <div className="text-xs text-gray-400 mb-1">🔌 ใช้ไป 24 ชม. (สุทธิ)</div>
                <div className="text-3xl font-bold text-blue-400">
                  {summary?.kwh_net_24h != null ? Math.abs(summary.kwh_net_24h) + ' kWh' : 'N/A'}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  {summary?.kwh_net_24h != null && summary.kwh_net_24h < 0 ? 'ใช้จากแบตเตอรี่' : 'ผลิต/ชาร์จเข้าสะสม'}
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
                <div className="text-xs text-gray-400 mb-1">⏱️ ประมาณเวลาที่เหลือ</div>
                <div className="text-3xl font-bold text-purple-400">
                  {summary?.hours_remaining != null ? summary.hours_remaining + ' ชม.' : '—'}
                </div>
                <div className="text-xs text-gray-500 mt-2">{summary ? statusLabels[summary.status] : ''}</div>
              </div>
            </div>

            <div className="text-xs text-gray-600">
              ℹ️ คำนวณจากความจุแบตเตอรี่ {summary?.capacity_kwh ?? 5} kWh (ตั้งได้ผ่าน env ENERGY_CAPACITY_KWH) และค่า power_kw เฉลี่ย 24 ชม. — ตัวเลขเป็นค่าประมาณ
            </div>

            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-gray-200">📈 กำลังไฟ 7 วัน (kW)</h2>
                <span className="text-xs text-gray-500">🟠 เส้น = power_kw | เส้นกลาง = ศูนย์</span>
              </div>
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                style={{ width: '100%', height: 'auto' }}
              />
            </div>
          </>
        )}
      </main>
    </div>
      </div>
  );
}
