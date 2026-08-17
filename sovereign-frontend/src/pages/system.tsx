"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

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
  success: 'text-emerald-400',
  info: 'text-amber-300',
  error: 'text-rose-400',
};

export default function SystemHealthPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [health, setHealth] = useState<any>({});
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [actionMsg, setActionMsg] = useState<ActionMsg | null>(null);
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const t = useLanguageStore((s) => s.t);

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
    if (!window.confirm(t('system.killConfirm', 'Kill process {name} (pid {pid})?\n\nคำสั่งนี้จะผ่านระบบ guard + autonomy ของ AI agent', { name: proc.name, pid: proc.pid }))) return;
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
          text: t('system.killPending', 'คำขอ kill {name} (pid {pid}) ถูกส่งไปรออนุมัติแล้ว — Superadmin ต้องอนุมัติก่อนดำเนินการ', { name: proc.name, pid: proc.pid }),
          approvalId: data?.approval_id,
        });
      } else if (res.ok) {
        setActionMsg({ type: 'success', text: data?.result || t('system.killSuccess', 'Kill สำเร็จ') });
      } else {
        setActionMsg({ type: 'error', text: data?.reason || data?.error || t('system.killRejected', 'คำสั่งถูกปฏิเสธ') });
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: t('system.coreUnreachable', 'เชื่อมต่อ Core API ไม่ได้') });
    } finally {
      setBusyPid(null);
    }
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('system.unauthorized', 'Unauthorized')}</div>;
  }

  const q = filter.trim().toLowerCase();
  const visible = q ? processes.filter((p) => p.name.toLowerCase().includes(q)) : processes;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
<PageHeader
          eyebrow={t('system.page.eyebrow', 'ระบบ')}
          title="SOVEREIGN OS"
          subtitle={t('system.page.subtitle', 'System Health')} icon={<Icon name="system" size={18} />} actions={<div className="flex items-center gap-3">
          <a href="/ai-agent" className="text-sm text-sky-400 hover:underline">{t('system.page.aiAgent', 'AI Agent')}</a>
          <a href="/dashboard" className="text-sm text-sky-400 hover:underline">{t('system.page.backDashboard', '← กลับ Dashboard')}</a>
        </div>}
        />
      </header>
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {actionMsg && (
          <div className={`card p-3 text-sm ${ACTION_STYLES[actionMsg.type]}`}>
            {actionMsg.text}
            {actionMsg.approvalId && (
              <a href="/ai-agent" className="block mt-1 text-xs underline hover:opacity-80">
                {t('system.approveLink', '→ ไปอนุมัติที่หน้า AI Agent (รหัสคำขอ: {id}…)', { id: actionMsg.approvalId.slice(0, 8) })}
              </a>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
{[ 
            { label: t('system.statUptime', 'Uptime'), value: health.uptime || t('common.na', 'N/A') },
            { label: t('system.statCpu', 'CPU Usage'), value: health.cpuUsage || t('common.na', 'N/A') },
            { label: t('system.statMemory', 'Memory'), value: health.memory || t('common.na', 'N/A') },
            { label: t('system.statDisk', 'Disk'), value: health.disk || t('common.na', 'N/A') },
          ].map((item, i) => (
            <div key={i} className="panel panel-glow p-4">
              <div className="text-xs text-gray-400">{item.label}</div>
              <div className="text-2xl font-bold text-white glow-text">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="panel panel-cyan p-4">
          <h3 className="text-sm text-gray-400 mb-2 glow-text-cyan">{t('system.runningServices', 'Running Services')}</h3>
          <div className="space-y-2">
            {['TimescaleDB', 'EMQX', 'Backend API', 'Frontend'].map((service) => (
              <div key={service} className="flex justify-between">
                <span>{service}</span>
                <span className="text-emerald-400 glow-text">{t('system.runningDot', '● Running')}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Chaos Drill — ซ้อมรับวิกฤต: ตรวจ self-check โครงสร้างพื้นฐานสำคัญ */}
        {user.role === 'SUPERADMIN' && (
        <div className="panel panel-glow p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-200 glow-text">Chaos Drill</h2>
              <p className="text-xs text-gray-500">
                {t('system.drillDesc', 'ซ้อมรับวิกฤต (Antifragility): ตรวจว่าโครงสร้างพื้นฐานสำคัญพร้อมรับแรงกระแทกหรือไม่ — DB, MQTT, backup ล่าสุด, Threat Intel, IDS, AI Analyst')}
              </p>
            </div>
            <button
              onClick={async () => {
                if (!window.confirm(t('system.drillConfirm', 'เริ่ม Chaos Drill?\n\nจะตรวจสถานะระบบทันที (ใช้เวลาไม่กี่วินาที)'))) return;
                setBusyPid(0);
                setActionMsg(null);
                try {
                  const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/drill`, { method: 'POST' });
                  const report = await res.json();
                  if (!res.ok) throw new Error(report.error || t('system.drillFailed', 'drill ล้มเหลว'));
                  setActionMsg({
                    type: report.verdict === 'PASS' ? 'success' : report.verdict === 'DEGRADED' ? 'info' : 'error',
                    text: `Chaos Drill: ${report.verdict} (${report.passed}/${report.total})` + (report.checks.filter((c: any) => !c.ok).length ? t('system.drillAbnormal', ' — ผิดปกติ: {names}', { names: report.checks.filter((c: any) => !c.ok).map((c: any) => c.name).join(', ') }) : t('system.drillOk', ' — ทุกอย่างพร้อม')),
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
              {busyPid === 0 ? t('system.drillChecking', 'กำลังตรวจ...') : <><Icon name="alerts" size={14} /> {t('system.drillStart', 'เริ่ม Drill')}</>}
            </button>
          </div>
        </div>
        )}

        {/* Maintenance Radar — Sovereignty Tax: ทุกงานบำรุงต้องมองเห็น */}
        {user.role === 'SUPERADMIN' && (
        <div className="panel panel-cyan p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('system.radarTitle', 'Maintenance Radar ')}<span className="text-xs text-gray-500 font-normal">{t('system.radarSub', '— ภาษีอธิปไตย: งานบำรุงรักษา (Sovereignty Tax)')}</span></h2>
              <p className="text-xs text-gray-500">
                {t('system.radarDesc', 'ระบบ 40+ modules = 780 จุดเชื่อมต่อ — ถ้าไม่มองเห็นงานซ่อมบำรุง ภาษีนี้จะกัดกินเวลาชีวิตเงียบ ๆ')}
              </p>
            </div>
            <button
              onClick={async () => {
                setBusyPid(-1);
                setActionMsg(null);
                try {
                  const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/maintenance/drift-check`, { method: 'POST' });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || t('system.driftFailed', 'drift check ล้มเหลว'));
                  setActionMsg({
                    type: data.driftFlags?.length ? 'error' : 'success',
                    text: `Sensor drift check: ${data.driftFlags?.length ? t('system.driftFound', 'พบความผิดปกติ {details}', { details: data.driftFlags.map((f: any) => f.message).join(' · ') }) : t('system.driftOk', 'เซ็นเซอร์ทุกตัวเทียบกันสอดคล้อง')} — ${t('system.taxEstimate', 'ภาษีเดือนนี้ประมาณ {hours} ชม.', { hours: data.taxHoursEstimate })}`,
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
              {busyPid === -1 ? t('system.driftChecking', 'ตรวจ drift...') : t('system.driftCheckBtn', 'ตรวจ sensor drift')}
            </button>
          </div>
          <RadarTaskTable />
        </div>
        )}

        {/* กระบวนการที่รันอยู่ + killProcess */}
        <div className="panel panel-cyan overflow-x-auto">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('system.processesTitle', 'กระบวนการ ({n})', { n: visible.length })}{q ? t('system.processesOfTotal', '/{total}', { total: processes.length }) : ''}</h2>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('system.filterPlaceholder', 'กรองชื่อ process...')}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">{t('system.loadingProcesses', 'กำลังโหลดรายการ process...')}</div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">{t('system.thPid', 'PID')}</th>
                  <th className="px-4 py-3">{t('system.thName', 'Name')}</th>
                  <th className="px-4 py-3">{t('system.thMemory', 'Memory')}</th>
                  <th className="px-4 py-3">{t('system.thAction', 'Action')}</th>
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
                        title={t('system.killTitle', 'Kill {name} (pid {pid})', { name: p.name, pid: p.pid })}
                        className="text-[10px] px-2 py-1 rounded bg-red-900/40 border border-red-700 text-red-300 hover:bg-red-900/60 transition disabled:opacity-50"
                      >
                        {busyPid === p.pid ? t('system.killing', 'กำลัง...') : t('system.kill', 'Kill')}
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      {q ? t('system.noMatch', 'ไม่พบ process ที่ตรงกับคำค้นหา') : t('system.noProcesses', 'ไม่มีข้อมูล process')}
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
  const t = useLanguageStore((s) => s.t);

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
          <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">{t('system.taxThisMonth', 'ภาษีเดือนนี้ (ทำจริง): {hours} ชม.', { hours: tax.taxHoursThisMonth })}</span>
          <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">{t('system.taxDueEstimate', 'ประมาณการครบกำหนดเดือนนี้: {hours} ชม.', { hours: tax.taxHoursEstimate })}</span>
          {tax.driftFlags.map((f, i) => (
            <span key={i} className="px-2 py-1 rounded bg-red-900/40 border border-red-700 text-red-300">{f.message}</span>
          ))}
        </div>
      )}
      <table className="w-full text-xs text-left">
        <thead className="text-gray-500 uppercase text-[10px]">
          <tr>
            <th className="py-2 pr-3">{t('system.radarThTask', 'งาน')}</th>
            <th className="py-2 pr-3">{t('system.radarThInterval', 'รอบ')}</th>
            <th className="py-2 pr-3">{t('system.radarThEffort', 'เวลาที่ใช้')}</th>
            <th className="py-2 pr-3">{t('system.radarThDue', 'ครบกำหนด')}</th>
            <th className="py-2">{t('common.actions', 'จัดการ')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {tasks.map((task) => (
            <tr key={task.id} className={task.overdue ? 'text-red-300' : 'text-gray-300'}>
              <td className="py-2 pr-3">
                {task.label}
                {task.auto && <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-blue-900/40 text-blue-300">{t('system.autoHelp', 'ระบบช่วยได้')}</span>}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">{task.intervalDays} {t('system.daysUnit', 'วัน')}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{task.effortH} {t('system.hoursUnit', 'ชม.')}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {task.overdue ? t('system.overdueBy', 'เกินกำหนด {n} วัน', { n: -task.dueInDays }) : task.dueInDays <= 7 ? t('system.dueSoon', 'อีก {n} วัน', { n: task.dueInDays }) : t('system.dueLater', 'อีก {n} วัน', { n: task.dueInDays })}
                {task.lastDoneAt && <span className="block text-[9px] text-gray-600">{t('system.lastDone', 'ทำล่าสุด {date} โดย {by}', { date: new Date(task.lastDoneAt).toLocaleDateString(fmtLocale()), by: (task.lastDoneBy || 'system').slice(0, 8) })}</span>}
              </td>
              <td className="py-2">
                <button
                  onClick={() => done(task.id)}
                  disabled={busyId === task.id}
                  className="text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-400 hover:bg-gray-700 transition disabled:opacity-50"
                >
                  {busyId === task.id ? '...' : <><Icon name="check" size={12} /> {t('system.doneBtn', 'ทำแล้ว')}</>}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}