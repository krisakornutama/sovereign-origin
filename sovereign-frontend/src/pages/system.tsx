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