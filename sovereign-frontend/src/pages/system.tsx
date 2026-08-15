"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

interface ProcessInfo {
  pid: number;
  name: string;
  mem?: string;
}

type ActionMsgType = 'success' | 'info' | 'error';
interface ActionMsg {
  type: ActionMsgType;
  text: string;
  approvalId?: string;
}

const ACTION_STYLES: Record<ActionMsgType, string> = {
  success: 'bg-green-900/30 text-green-400 border-green-800',
  info: 'bg-amber-900/30 text-amber-300 border-amber-700',
  error: 'bg-red-900/30 text-red-400 border-red-800',
};

export default function SystemHealthPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [health, setHealth] = useState<any>({});
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [actionMsg, setActionMsg] = useState<ActionMsg | null>(null);
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [healthRes, procsRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/health`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/processes`),
      ]);
      const [healthData, procsData] = await Promise.all([
        healthRes.json(),
        procsRes.ok ? procsRes.json() : [],
      ]);
      setHealth(healthData);
      setProcesses(procsData);
    } catch (err) {
      console.error('System data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !user) return;
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [isHydrated, isAuthenticated, user, loadData]);

  // kill ผ่าน tool killProcess ของ AI agent (guard + autonomy เดียวกับ chat)
  const killProcess = async (proc: ProcessInfo) => {
    if (!window.confirm(`Kill process ${proc.name} (pid ${proc.pid})?\n\nคำสั่งนี้จะผ่านระบบ guard + autonomy ของ AI agent`)) return;
    setBusyPid(proc.pid);
    setActionMsg(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/system/processes/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: proc.pid }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 202) {
        setActionMsg({
          type: 'info',
          text: `🛡️ คำขอ kill ${proc.name} (pid ${proc.pid}) ถูกส่งไปรออนุมัติแล้ว — Superadmin ต้องอนุมัติก่อนดำเนินการ`,
          approvalId: data?.approval_id,
        });
      } else if (res.ok) {
        setActionMsg({ type: 'success', text: data?.result || `✅ Kill สำเร็จ` });
      } else {
        setActionMsg({ type: 'error', text: data?.reason || data?.error || 'คำสั่งถูกปฏิเสธ' });
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: 'เชื่อมต่อ Core API ไม่ได้' });
    } finally {
      setBusyPid(null);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  const q = filter.trim().toLowerCase();
  const visible = q ? processes.filter((p) => p.name.toLowerCase().includes(q)) : processes;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ระบบ"
          title="🔧 SOVEREIGN OS"
          subtitle="System Health" actions={<div className="flex items-center gap-3">
          <a href="/ai-agent" className="text-sm text-blue-400 hover:underline">🤖 AI Agent</a>
          <a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>
        </div>}
        />
      </header>
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {actionMsg && (
          <div className={`p-3 rounded text-sm border ${ACTION_STYLES[actionMsg.type]}`}>
            {actionMsg.text}
            {actionMsg.approvalId && (
              <a href="/ai-agent" className="block mt-1 text-xs underline hover:opacity-80">
                → ไปอนุมัติที่หน้า AI Agent (รหัสคำขอ: {actionMsg.approvalId.slice(0, 8)}…)
              </a>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Uptime', value: health.uptime || 'N/A' },
            { label: 'CPU Usage', value: health.cpuUsage || 'N/A' },
            { label: 'Memory', value: health.memory || 'N/A' },
            { label: 'Disk', value: health.disk || 'N/A' },
          ].map((item, i) => (
            <div key={i} className="bg-gray-900 p-4 rounded-xl border border-gray-700">
              <div className="text-xs text-gray-400">{item.label}</div>
              <div className="text-2xl font-bold text-white">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="bg-gray-900 p-4 rounded-xl border border-gray-700">
          <h3 className="text-sm text-gray-400 mb-2">Running Services</h3>
          <div className="space-y-2">
            {['TimescaleDB', 'EMQX', 'Backend API', 'Frontend'].map((service) => (
              <div key={service} className="flex justify-between">
                <span>{service}</span>
                <span className="text-green-400">● Running</span>
              </div>
            ))}
          </div>
        </div>

        {/* Chaos Drill — ซ้อมรับวิกฤต: ตรวจ self-check โครงสร้างพื้นฐานสำคัญ */}
        {user.role === 'SUPERADMIN' && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-bold">🧯 Chaos Drill</h2>
              <p className="text-xs text-gray-500">
                ซ้อมรับวิกฤต (Antifragility): ตรวจว่าโครงสร้างพื้นฐานสำคัญพร้อมรับแรงกระแทกหรือไม่ — DB, MQTT, backup ล่าสุด, Threat Intel, IDS, AI Analyst
              </p>
            </div>
            <button
              onClick={async () => {
                if (!window.confirm('🧯 เริ่ม Chaos Drill?\n\nจะตรวจสถานะระบบทันที (ใช้เวลาไม่กี่วินาที)')) return;
                setBusyPid(0);
                setActionMsg(null);
                try {
                  const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/drill`, { method: 'POST' });
                  const report = await res.json();
                  if (!res.ok) throw new Error(report.error || 'drill ล้มเหลว');
                  setActionMsg({
                    type: report.verdict === 'PASS' ? 'success' : report.verdict === 'DEGRADED' ? 'info' : 'error',
                    text: `🧯 Chaos Drill: ${report.verdict} (${report.passed}/${report.total})${report.checks.filter((c: any) => !c.ok).length ? ' — ผิดปกติ: ' + report.checks.filter((c: any) => !c.ok).map((c: any) => c.name).join(', ') : ' — ทุกอย่างพร้อม'}`,
                  });
                } catch (e: any) {
                  setActionMsg({ type: 'error', text: e.message });
                } finally {
                  setBusyPid(null);
                }
              }}
              disabled={busyPid === 0}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-700 hover:bg-amber-600 text-white transition disabled:opacity-40"
            >
              {busyPid === 0 ? '⏳ กำลังตรวจ...' : '🚨 เริ่ม Drill'}
            </button>
          </div>
        </div>
        )}

        {/* Maintenance Radar — Sovereignty Tax: ทุกงานบำรุงต้องมองเห็น */}
        {user.role === 'SUPERADMIN' && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-bold">🧰 Maintenance Radar <span className="text-xs text-gray-500 font-normal">— ภาษีอธิปไตย: งานบำรุงรักษา (Sovereignty Tax)</span></h2>
              <p className="text-xs text-gray-500">
                ระบบ 40+ modules = 780 จุดเชื่อมต่อ — ถ้าไม่มองเห็นงานซ่อมบำรุง ภาษีนี้จะกัดกินเวลาชีวิตเงียบ ๆ
              </p>
            </div>
            <button
              onClick={async () => {
                setBusyPid(-1);
                setActionMsg(null);
                try {
                  const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/maintenance/drift-check`, { method: 'POST' });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'drift check ล้มเหลว');
                  setActionMsg({
                    type: data.driftFlags?.length ? 'error' : 'success',
                    text: `🔧 Sensor drift check: ${data.driftFlags?.length ? 'พบความผิดปกติ ' + data.driftFlags.map((f: any) => f.message).join(' · ') : 'เซ็นเซอร์ทุกตัวเทียบกันสอดคล้อง'} — ภาษีเดือนนี้ประมาณ ${data.taxHoursEstimate} ชม.`,
                  });
                } catch (e: any) {
                  setActionMsg({ type: 'error', text: e.message });
                } finally {
                  setBusyPid(null);
                }
              }}
              disabled={busyPid === -1}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-700 hover:bg-blue-600 text-white transition disabled:opacity-40"
            >
              {busyPid === -1 ? '⏳ ตรวจ drift...' : '🔬 ตรวจ sensor drift'}
            </button>
          </div>
          <RadarTaskTable />
        </div>
        )}

        {/* กระบวนการที่รันอยู่ + killProcess */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold">🗂️ กระบวนการ ({visible.length}{q ? `/${processes.length}` : ''})</h2>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="🔍 กรองชื่อ process..."
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">⏳ กำลังโหลดรายการ process...</div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">PID</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Memory</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {visible.map((p) => (
                  <tr key={p.pid} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-xs text-gray-400">{p.pid}</td>
                    <td className="px-4 py-2 text-gray-200">{p.name}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{p.mem || '-'}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => killProcess(p)}
                        disabled={busyPid === p.pid}
                        title={`Kill ${p.name} (pid ${p.pid})`}
                        className="text-[10px] px-2 py-1 rounded bg-red-900/40 border border-red-700 text-red-300 hover:bg-red-900/60 transition disabled:opacity-50"
                      >
                        {busyPid === p.pid ? '⏳...' : '🗡️ Kill'}
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      {q ? 'ไม่พบ process ที่ตรงกับคำค้นหา' : 'ไม่มีข้อมูล process'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
</div>
      </main>
    </div>
      </div>
  );
}

// ── Maintenance Radar table (Sovereignty Tax — ภัย 4) ──
interface RadarTask {
  id: string;
  label: string;
  intervalDays: number;
  effortH: number;
  auto: boolean;
  lastDoneAt: number | null;
  lastDoneBy: string;
  dueInDays: number;
  overdue: boolean;
}

function RadarTaskTable() {
  const [tasks, setTasks] = useState<RadarTask[]>([]);
  const [tax, setTax] = useState<{ taxHoursThisMonth: number; taxHoursEstimate: number; driftFlags: any[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/maintenance`);
      if (!res.ok) return;
      const data = await res.json();
      setTasks(data.tasks || []);
      setTax({ taxHoursThisMonth: data.taxHoursThisMonth, taxHoursEstimate: data.taxHoursEstimate, driftFlags: data.driftFlags || [] });
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const done = async (id: string) => {
    setBusyId(id);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/maintenance/${id}/done`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
        setTax({ taxHoursThisMonth: data.taxHoursThisMonth, taxHoursEstimate: data.taxHoursEstimate, driftFlags: data.driftFlags || [] });
      }
    } catch {}
    setBusyId(null);
  };

  return (
    <div className="space-y-3">
      {tax && (
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">⏱️ ภาษีเดือนนี้ (ทำจริง): {tax.taxHoursThisMonth} ชม.</span>
          <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">📅 ประมาณการครบกำหนดเดือนนี้: {tax.taxHoursEstimate} ชม.</span>
          {tax.driftFlags.map((f, i) => (
            <span key={i} className="px-2 py-1 rounded bg-red-900/40 border border-red-700 text-red-300">{f.message}</span>
          ))}
        </div>
      )}
      <table className="w-full text-xs text-left">
        <thead className="text-gray-500 uppercase text-[10px]">
          <tr>
            <th className="py-2 pr-3">งาน</th>
            <th className="py-2 pr-3">รอบ</th>
            <th className="py-2 pr-3">เวลาที่ใช้</th>
            <th className="py-2 pr-3">ครบกำหนด</th>
            <th className="py-2">จัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {tasks.map((t) => (
            <tr key={t.id} className={t.overdue ? 'text-red-300' : 'text-gray-300'}>
              <td className="py-2 pr-3">
                {t.label}
                {t.auto && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-blue-900/40 text-blue-300">ระบบช่วยได้</span>}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">{t.intervalDays} วัน</td>
              <td className="py-2 pr-3 whitespace-nowrap">{t.effortH} ชม.</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {t.overdue ? `เกินกำหนด ${-t.dueInDays} วัน 🚨` : t.dueInDays <= 7 ? `อีก ${t.dueInDays} วัน` : `อีก ${t.dueInDays} วัน`}
                {t.lastDoneAt && <span className="block text-[9px] text-gray-600">ทำล่าสุด {new Date(t.lastDoneAt).toLocaleDateString('th-TH')} โดย {(t.lastDoneBy || 'system').slice(0, 8)}</span>}
              </td>
              <td className="py-2">
                <button
                  onClick={() => done(t.id)}
                  disabled={busyId === t.id}
                  className="text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-400 hover:bg-gray-700 transition disabled:opacity-50"
                >
                  {busyId === t.id ? '⏳' : '✅ ทำแล้ว'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}