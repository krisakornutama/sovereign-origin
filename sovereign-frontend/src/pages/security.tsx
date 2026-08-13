"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusPill from '../components/ui/StatusPill';

interface Connection {
  protocol: string;
  local_address: string;
  foreign_address: string;
  state: string;
  pid: string;
}

interface SecurityEvent {
  id: string;
  timestamp: string;
  event_type: string;
  severity: string;
  source_ip: string | null;
  dest_ip: string | null;
  description: string;
}

type ActionMsgType = 'success' | 'info' | 'error';
interface ActionMsg {
  type: ActionMsgType;
  text: string;
}

interface Approval {
  id: string;
  tool: string;
  args: any;
  reason: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected';
  result?: string;
  decidedAt?: number;
}

// แยก IP ออกจาก address ที่อาจมี port ต่อท้าย ([::1]:80, 1.2.3.4:5432, ...)
function extractIp(addr: string): string {
  const t = (addr || '').trim();
  const bracket = t.match(/^\[([^\]]+)\]/);
  if (bracket) return bracket[1];
  const parts = t.split(':');
  if (parts.length === 2 && parts[0].includes('.')) return parts[0];
  return t;
}

const ACTION_STYLES: Record<ActionMsgType, string> = {
  success: 'bg-green-900/30 text-green-400 border-green-800',
  info: 'bg-amber-900/30 text-amber-300 border-amber-700',
  error: 'bg-red-900/30 text-red-400 border-red-800',
};

function fmtTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('th-TH');
}

function fmtArgs(args: any): string {
  if (!args || Object.keys(args).length === 0) return '{}';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export default function SecurityPage() {
  const { user, isAuthenticated, token, isHydrated } = useAuthStore();
  const isSuperadmin = user?.role === 'SUPERADMIN';
  const [connections, setConnections] = useState<Connection[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [firewallStatus, setFirewallStatus] = useState<string>('unknown');
  const [blockedIps, setBlockedIps] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<ActionMsg | null>(null);
  const [busyIp, setBusyIp] = useState<string | null>(null);
  const [busyApproval, setBusyApproval] = useState<string | null>(null);

  // ── 2 แท็บ: ภาพรวม (default) | ตั้งค่าขั้นสูง (Firewall Engine ซ่อนอยู่หลังปุ่ม Advanced) ──
  const [secTab, setSecTab] = useState<'overview' | 'advanced'>('overview');

  const loadApprovals = useCallback(async () => {
    if (!isSuperadmin) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/approvals`);
      if (res.ok) setApprovals(await res.json());
    } catch (err) {
      // เงียบ ๆ — หน้า firewall ยังใช้งานได้
    }
  }, [isSuperadmin]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    loadData();
    loadApprovals();
    const interval = setInterval(() => {
      loadData();
      loadApprovals();
    }, 10000);
    return () => clearInterval(interval);
  }, [isHydrated, isAuthenticated, token, loadApprovals]);

  const loadData = async () => {
    try {
      const [connRes, eventRes, fwRes, blocksRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/connections`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/events`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/blocks`),
      ]);
      const [connData, eventData, fwData, blocksData] = await Promise.all([
        connRes.json(),
        eventRes.json(),
        fwRes.json(),
        blocksRes.ok ? blocksRes.json() : { blockedIps: [], pendingApprovals: 0 },
      ]);
      setConnections(connData);
      setEvents(eventData);
      setFirewallStatus(fwData.status || 'unknown');
      setBlockedIps(blocksData.blockedIps || []);
      setPendingApprovals(blocksData.pendingApprovals || 0);
    } catch (err) {
      console.error('Security data fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const reloadBlocks = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/blocks`);
      if (!res.ok) return;
      const data = await res.json();
      setBlockedIps(data.blockedIps || []);
      setPendingApprovals(data.pendingApprovals || 0);
    } catch (err) {
      // เงียบๆ
    }
  };

  // เรียกใช้ tool blockIP/unblockIP ของ AI agent (guard + autonomy เดียวกับ chat)
  const sendBlockAction = async (action: 'block' | 'unblock', ip: string) => {
    if (!ip) return;
    const label = action === 'block' ? 'block' : 'unblock';
    const confirmText =
      action === 'block'
        ? `Block IP ${ip} ที่ไฟร์วอลล์?\n\nคำสั่งนี้จะผ่านระบบ guard + autonomy ของ AI agent`
        : `ยกเลิกการ block IP ${ip}?`;
    if (!window.confirm(confirmText)) return;

    setBusyIp(ip);
    setActionMsg(null);
    try {
      const res = await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/${label}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip }),
        }
      );
      const data = await res.json().catch(() => ({}));

      if (res.status === 202) {
        // โหมด suggest → ต้องรออนุมัติ (จัดการได้ที่หน้านี้เลย)
        setActionMsg({
          type: 'info',
          text: `🛡️ คำขอ${action === 'block' ? ' block' : ' unblock'} IP ${ip} ถูกส่งไปรออนุมัติแล้ว — อนุมัติได้ในส่วน "คำขออนุมัติ" ด้านล่าง`,
        });
      } else if (res.ok) {
        setActionMsg({ type: 'success', text: data?.result || `✅ ${action === 'block' ? 'Block' : 'Unblock'} สำเร็จ` });
      } else {
        setActionMsg({ type: 'error', text: data?.reason || data?.error || 'คำสั่งถูกปฏิเสธ' });
      }
      await reloadBlocks();
      await loadApprovals();
    } catch (err) {
      setActionMsg({ type: 'error', text: 'เชื่อมต่อ Core API ไม่ได้' });
    } finally {
      setBusyIp(null);
    }
  };

  // อนุมัติ / ปฏิเสธ คำขอ action ของ AI โดยตรงที่หน้านี้ (ไม่ต้องไปหน้า AI Agent)
  const decideApproval = async (id: string, action: 'approve' | 'reject') => {
    const ok = window.confirm(
      action === 'approve'
        ? 'อนุมัติให้ดำเนินการคำสั่งนี้ทันที?\n\nคำสั่งจะทำงานจริงบนระบบ — ตรวจสอบให้แน่ใจ'
        : 'ปฏิเสธคำสั่งนี้?'
    );
    if (!ok) return;
    setBusyApproval(id);
    setActionMsg(null);
    try {
      const res = await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/ai/approvals/${id}/${action}`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setActionMsg(action === 'approve'
          ? { type: 'success', text: `✅ อนุมัติแล้ว: ${data?.result || 'ดำเนินการสำเร็จ'}` }
          : { type: 'success', text: '🚫 ปฏิเสธคำสั่งแล้ว' });
      } else {
        setActionMsg({ type: 'error', text: data?.reason || data?.error || `ไม่สามารถ${action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}ได้` });
      }
      await loadApprovals();
      await reloadBlocks();
    } catch (err) {
      setActionMsg({ type: 'error', text: 'เชื่อมต่อ Core API ไม่ได้' });
    } finally {
      setBusyApproval(null);
    }
  };

  const severityColor = (s: string) =>
    s === 'critical' ? 'text-red-400' : s === 'warning' ? 'text-amber-400' : 'text-blue-400';

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  const pending = approvals.filter((a) => a.status === 'pending');
  const history = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900 border-b border-gray-700 px-6 py-3">
        <PageHeader
          eyebrow="ความปลอดภัย"
          title="🛡️ Cyber Security"
          subtitle="Firewall + ระบบตรวจจับภัยคุกคาม"
          actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* ── แท็บ: ภาพรวม / ตั้งค่าขั้นสูง ── */}
        <div className="flex gap-2">
          <button
            onClick={() => setSecTab('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${secTab === 'overview' ? 'bg-green-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          >
            📊 ภาพรวม
          </button>
          <button
            onClick={() => setSecTab('advanced')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${secTab === 'advanced' ? 'bg-green-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          >
            ⚙️ ตั้งค่าขั้นสูง (Firewall Engine)
          </button>
          <span className="self-center text-[10px] text-gray-500 ml-1">
            ภาพรวม = สถานะ/การอนุมัติ/การเชื่อมต่อ · ขั้นสูง = กฎไฟร์วอลล์ + จำแนก unknown + สคริปต์ติดตั้ง
          </span>
        </div>

        {secTab === 'overview' && (
        <>
        {/* ผลลัพธ์ block/unblock/อนุมัติ */}
        {actionMsg && (
          <div className={`p-3 rounded text-sm border ${ACTION_STYLES[actionMsg.type]}`}>
            {actionMsg.text}
          </div>
        )}

        {/* Status Cards — ภาพรวมสถานะ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900 p-4 rounded-xl border border-gray-700">
            <div className="text-sm text-gray-400">🛡️ Firewall <span className="text-gray-600">(ไฟร์วอลล์)</span></div>
            <div className="mt-2"><StatusPill variant={firewallStatus === 'active' ? 'ok' : 'err'} label={firewallStatus.toUpperCase()} pulse={firewallStatus === 'active'} /></div>
          </div>
          <StatCard label="🔗 Active Connections" value={connections.length} />
          <StatCard label="🚨 Security Events" value={events.length} />
        </div>

        {/* คำขออนุมัติ action (block/unblock) — จัดการที่นี่ ครบในหน้าเดียว */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold">
              🛡️ คำขออนุมัติ Action ({pending.length})
              {pending.length > 0 && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-amber-900/50 text-amber-300 font-bold">รอตัดสินใจ {pending.length} รายการ</span>}
            </h2>
            {!isSuperadmin && (
              <span className="text-[10px] text-gray-500">🔒 เฉพาะ SUPERADMIN เท่านั้น</span>
            )}
          </div>

          {isSuperadmin ? (
            <>
              {pending.length === 0 ? (
                <div className="text-gray-500 text-sm text-center py-4 border border-dashed border-gray-700 rounded-lg">
                  ไม่มีคำขอรออนุมัติ — เมื่อ AI หรือผู้ใช้ขอ block/unblock IP ในโหมด suggest คำขอจะขึ้นที่นี่
                </div>
              ) : (
                <div className="space-y-3">
                  {pending.map((a) => (
                    <div key={a.id} className="border border-amber-700 bg-amber-900/10 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 font-bold">ACTION</span>
                          <span className="font-bold text-amber-300">{a.tool}</span>
                          <span className="text-xs text-gray-500">{fmtTime(a.createdAt)}</span>
                        </div>
                        <span className="text-[10px] text-gray-600 break-all">ID: {a.id}</span>
                      </div>
                      <pre className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                        {fmtArgs(a.args)}
                      </pre>
                      {a.reason && <div className="text-xs text-gray-400">เหตุผล: {a.reason}</div>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => decideApproval(a.id, 'approve')}
                          disabled={busyApproval === a.id}
                          className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold transition disabled:opacity-50"
                        >
                          {busyApproval === a.id ? '⏳...' : '✅ อนุมัติ'}
                        </button>
                        <button
                          onClick={() => decideApproval(a.id, 'reject')}
                          disabled={busyApproval === a.id}
                          className="px-4 py-1.5 bg-red-600/80 hover:bg-red-600 rounded text-sm transition disabled:opacity-50"
                        >
                          🚫 ปฏิเสธ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ประวัติ */}
              {history.length > 0 && (
                <div className="pt-2 border-t border-gray-800">
                  <h3 className="text-sm font-bold text-gray-400 mb-2">📜 ประวัติการตัดสินใจ ({history.length})</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="text-gray-500 uppercase">
                        <tr>
                          <th className="py-2 pr-3">เวลา</th>
                          <th className="py-2 pr-3">Tool</th>
                          <th className="py-2 pr-3">Args</th>
                          <th className="py-2 pr-3">ผล</th>
                          <th className="py-2">รายละเอียด</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {history.slice(0, 10).map((a) => (
                          <tr key={a.id} className="text-gray-400">
                            <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(a.decidedAt)}</td>
                            <td className="py-2 pr-3 text-gray-300">{a.tool}</td>
                            <td className="py-2 pr-3 font-mono text-gray-500">{fmtArgs(a.args).replace(/\s+/g, ' ')}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${a.status === 'approved' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                                {a.status === 'approved' ? 'APPROVED' : 'REJECTED'}
                              </span>
                            </td>
                            <td className="py-2 text-gray-500 break-all">{a.result || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-500">
              🔒 เฉพาะ SUPERADMIN เท่านั้นที่เห็นและตัดสินใจคำขอ block/unblock — ติดต่อผู้ดูแลระบบ
            </div>
          )}
        </div>

        {/* Blocked IPs */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold">🚫 IP ที่ถูก Block ({blockedIps.length}) <span className="text-xs text-gray-500 font-normal">— รายการที่ระบบสั่ง block ไว้</span></h2>
            <span className="text-[10px] text-gray-600">รายการจำในหน่วยความจำของระบบ — กด ✕ เพื่อ unblock</span>
          </div>
          {blockedIps.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-4 border border-dashed border-gray-700 rounded-lg mt-3">
              ยังไม่มี IP ถูก block ผ่านระบบ — กด 🛡️ Block ในตาราง Connections ด้านล่าง
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 mt-3">
              {blockedIps.map((ip) => (
                <span
                  key={ip}
                  className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-red-900/40 border border-red-800 text-red-300 text-sm"
                >
                  {ip}
                  <button
                    onClick={() => sendBlockAction('unblock', ip)}
                    disabled={busyIp === ip}
                    title={`ยกเลิกการ block ${ip}`}
                    className="text-xs hover:text-white disabled:opacity-50"
                  >
                    {busyIp === ip ? '⏳' : '✕'}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Network Connections Table — ตารางการเชื่อมต่อเครือข่าย */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
          <h2 className="text-lg font-bold p-4 border-b border-gray-700">🔗 Active Connections <span className="text-xs text-gray-500 font-normal">— การเชื่อมต่อเครือข่ายที่กำลังใช้งาน (ตรวจสอบ + block IP แปลกปลอม)</span></h2>
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Protocol <span className="normal-case text-gray-600">(โปรโตคอล)</span></th>
                <th className="px-4 py-3">Local Address <span className="normal-case text-gray-600">(ที่อยู่เครื่องเรา)</span></th>
                <th className="px-4 py-3">Foreign Address <span className="normal-case text-gray-600">(ปลายทาง)</span></th>
                <th className="px-4 py-3">State <span className="normal-case text-gray-600">(สถานะ)</span></th>
                <th className="px-4 py-3">PID <span className="normal-case text-gray-600">(โปรเซส)</span></th>
                <th className="px-4 py-3">Action <span className="normal-case text-gray-600">(จัดการ)</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {connections.map((c, i) => {
                const ip = extractIp(c.foreign_address);
                const isBlocked = blockedIps.includes(ip.toLowerCase());
                return (
                  <tr key={i} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2">{c.protocol}</td>
                    <td className="px-4 py-2 text-xs">{c.local_address}</td>
                    <td className="px-4 py-2 text-xs text-yellow-300">{c.foreign_address}</td>
                    <td className="px-4 py-2">{c.state}</td>
                    <td className="px-4 py-2">{c.pid}</td>
                    <td className="px-4 py-2">
                      {isBlocked ? (
                        <span className="text-[10px] px-2 py-1 rounded bg-red-900/40 border border-red-800 text-red-300">
                          🚫 Blocked
                        </span>
                      ) : (
                        <button
                          onClick={() => sendBlockAction('block', ip)}
                          disabled={busyIp === ip || !ip}
                          title={`Block ${ip} ที่ไฟร์วอลล์`}
                          className="text-[10px] px-2 py-1 rounded bg-amber-900/40 border border-amber-700 text-amber-300 hover:bg-amber-900/60 transition disabled:opacity-50"
                        >
                          {busyIp === ip ? '⏳...' : '🛡️ Block'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {connections.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">ยังไม่มีการเชื่อมต่อที่ใช้งานอยู่</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Security Events — ตารางเหตุการณ์ความปลอดภัย */}
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
          <h2 className="text-lg font-bold p-4 border-b border-gray-700">🚨 Security Events <span className="text-xs text-gray-500 font-normal">— ประวัติเหตุการณ์ความปลอดภัยของระบบ</span></h2>
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Time <span className="normal-case text-gray-600">(เวลา)</span></th>
                <th className="px-4 py-3">Type <span className="normal-case text-gray-600">(ประเภท)</span></th>
                <th className="px-4 py-3">Severity <span className="normal-case text-gray-600">(ความรุนแรง)</span></th>
                <th className="px-4 py-3">Source IP <span className="normal-case text-gray-600">(ต้นทาง)</span></th>
                <th className="px-4 py-3">Description <span className="normal-case text-gray-600">(รายละเอียด)</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2 text-xs text-gray-400">{new Date(e.timestamp).toLocaleString('th-TH')}</td>
                  <td className="px-4 py-2">{e.event_type}</td>
                  <td className={`px-4 py-2 font-bold ${severityColor(e.severity)}`}>{e.severity}</td>
                  <td className="px-4 py-2 text-xs">{e.source_ip || '-'}</td>
                  <td className="px-4 py-2 text-xs">{e.description}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">ยังไม่มีเหตุการณ์ด้านความปลอดภัย</td></tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}

        {secTab === 'advanced' && (
          <>
            <div className="bg-amber-900/20 border border-amber-700/60 rounded-xl p-3 text-xs text-amber-200">
              ⚙️ <span className="font-bold">โหมดตั้งค่าขั้นสูง</span> — ต่อไปนี้คือ Firewall Engine: กฎ allow/deny, การจำแนก IP unknown, การสแกนการเชื่อมต่อ และการสร้างสคริปต์ติดตั้งสำหรับ Windows
            </div>
            <FirewallEnginePanel />
          </>
        )}

        </main>
    </div>
      </div>
  );
}

// ─────────────────────────────────────────────
// Firewall Engine Panel — กฎ + สแกนการเชื่อมต่อ + จำแนก unknown + สร้างสคริปต์ Windows
// ─────────────────────────────────────────────
interface FwRule {
  id: string; name: string; action: string; direction: string; protocol: string;
  remote_ip: string | null; remote_port: string | null; local_port: string | null;
  priority: number; description?: string | null; enabled: boolean;
}

function FirewallEnginePanel() {
  const [rules, setRules] = useState<FwRule[]>([]);
  const [defaultPolicy, setDefaultPolicy] = useState('ALLOW');
  const [conns, setConns] = useState<any[]>([]);
  const [ruleForm, setRuleForm] = useState({ name: '', action: 'DENY', direction: 'IN', protocol: 'TCP', remote_ip: '', remote_port: '', local_port: '', priority: '10', description: '' });
  const [testIp, setTestIp] = useState('');
  const [testPort, setTestPort] = useState('80');
  const [evalResult, setEvalResult] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/rules`);
      const d = await r.json();
      if (r.ok) { setRules(d.rules || []); setDefaultPolicy(d.defaultPolicy || 'ALLOW'); }
    } catch { /* เงียบ */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveRule = async (patch: Partial<FwRule>, id?: string) => {
    setErr(''); setMsg('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/rules${id ? '/' + id : ''}`, {
        method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'บันทึกกฎไม่สำเร็จ');
      setMsg(id ? '✅ อัปเดตกฎแล้ว' : `✅ เพิ่มกฎ "${patch.name}" แล้ว`);
      if (!id) setRuleForm({ name: '', action: 'DENY', direction: 'IN', protocol: 'TCP', remote_ip: '', remote_port: '', local_port: '', priority: '10', description: '' });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const deleteRule = async (r: FwRule) => {
    if (!window.confirm(`ลบกฎ "${r.name}"?`)) return;
    await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/rules/${r.id}`, { method: 'DELETE' });
    load();
  };

  const setPolicy = async (p: string) => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/policy`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_policy: p }),
    });
    if (r.ok) { setDefaultPolicy(p); setMsg(`นโยบายเริ่มต้น = ${p === 'DENY' ? 'บล็อกทั้งหมด' : 'อนุญาต'}`); }
  };

  const scan = async () => {
    setScanning(true); setErr('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/scan`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'สแกนไม่สำเร็จ');
      setConns(d.connections || []);
      setMsg(`🔍 สแกนพบ ${d.total ?? 0} การเชื่อมต่อ`);
    } catch (e: any) { setErr(e.message); } finally { setScanning(false); }
  };

  const evaluate = async () => {
    if (!testIp.trim()) { setErr('ใส่ IP ที่ต้องการทดสอบ'); return; }
    setErr('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/evaluate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocol: 'TCP', remote: `${testIp.trim()}:${testPort || '80'}`, local: '192.168.1.100:3001' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'evaluate ไม่สำเร็จ');
      setEvalResult(`การเชื่อมต่อไปยัง ${testIp.trim()}:${testPort} → ${d.action} (${d.rule ? 'กฎ: ' + d.rule.name : 'ไม่ตรงกฎ → นโยบายเริ่มต้น ' + (d.defaultPolicy || 'ALLOW')})`);
    } catch (e: any) { setErr(e.message); }
  };

  const downloadScript = async () => {
    const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/host-script`);
    const text = await r.text();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sovereign-firewall.bat';
    a.click();
    setMsg('📜 ดาวน์โหลดสคริปต์แล้ว — รันบนเครื่องจริงด้วยสิทธิ์ Administrator เพื่อบังคับใช้กับ Windows Firewall');
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold">🧱 Firewall Engine <span className="text-[10px] text-gray-500 font-normal">— จำแนก unknown + กฎ allow/deny + บังคับใช้จริงผ่าน Windows Firewall (สคริปต์ netsh)</span></h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">นโยบายเริ่มต้น:</span>
          <button onClick={() => setPolicy('ALLOW')} className={`px-2 py-1 rounded border ${defaultPolicy === 'ALLOW' ? 'bg-emerald-900/60 border-emerald-600 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>อนุญาต</button>
          <button onClick={() => setPolicy('DENY')} className={`px-2 py-1 rounded border ${defaultPolicy === 'DENY' ? 'bg-red-900/60 border-red-600 text-red-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>บล็อกทั้งหมด</button>
          <button onClick={scan} disabled={scanning} className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded font-bold disabled:opacity-50">{scanning ? '⏳...' : '🔍 สแกนการเชื่อมต่อ'}</button>
          <button onClick={downloadScript} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded font-bold">📜 สคริปต์ Windows Firewall</button>
        </div>
      </div>
      {msg && <div className="text-xs text-emerald-400">{msg}</div>}
      {err && <div className="text-xs text-red-400">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* กฎ */}
        <div className="space-y-2">
          <div className="text-sm font-bold text-gray-300">📏 กฎไฟร์วอลล์ ({rules.length}) — เลข priority สูงตรวจก่อน</div>
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {rules.length === 0 && <div className="text-xs text-gray-600">ยังไม่มีกฎ — เพิ่มกฎด้านล่าง (เช่น block IP ที่ไม่รู้จัก, allow เฉพาะ Telegram)</div>}
            {rules.map((r) => (
              <div key={r.id} className={`flex items-center gap-2 text-xs bg-gray-950/60 border rounded px-2 py-1.5 ${r.enabled ? 'border-gray-700' : 'border-gray-800 opacity-50'}`}>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.action === 'DENY' ? 'bg-red-900/60 text-red-300' : 'bg-emerald-900/60 text-emerald-300'}`}>{r.action}</span>
                <span className="font-bold flex-1 truncate">{r.name}</span>
                <span className="text-gray-500">{r.protocol} {r.direction} {r.remote_ip || ''} {r.remote_port ? ':' + r.remote_port : ''}{r.local_port ? ' ←:' + r.local_port : ''}</span>
                <button onClick={() => saveRule({ enabled: !r.enabled }, r.id)} title="เปิด/ปิด">{r.enabled ? '🟢' : '⚪'}</button>
                <button onClick={() => deleteRule(r)} className="text-red-400 hover:text-red-300">🗑️</button>
              </div>
            ))}
          </div>
          <div className="space-y-1.5 border-t border-gray-800 pt-2">
            <div className="flex gap-1.5">
              <input value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="ชื่อกฎ เช่น block-unknown-scanner" className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <select value={ruleForm.action} onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-xs">
                <option value="ALLOW">อนุญาต</option><option value="DENY">บล็อก</option>
              </select>
              <select value={ruleForm.direction} onChange={(e) => setRuleForm({ ...ruleForm, direction: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-xs">
                <option value="IN">IN</option><option value="OUT">OUT</option><option value="BOTH">BOTH</option>
              </select>
              <select value={ruleForm.protocol} onChange={(e) => setRuleForm({ ...ruleForm, protocol: e.target.value })} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-1.5 text-xs">
                <option value="ANY">ANY</option><option value="TCP">TCP</option><option value="UDP">UDP</option><option value="ICMP">ICMP</option>
              </select>
            </div>
            <div className="flex gap-1.5">
              <input value={ruleForm.remote_ip} onChange={(e) => setRuleForm({ ...ruleForm, remote_ip: e.target.value })} placeholder="IP/CIDR เช่น 10.12.55.0/24 (เว้น = ทั้งหมด)" className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={ruleForm.remote_port} onChange={(e) => setRuleForm({ ...ruleForm, remote_port: e.target.value })} placeholder="พอร์ต (เช่น 443, 8000-8100)" className="w-28 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} placeholder="pri" className="w-14 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
            </div>
            <button onClick={() => saveRule({ name: ruleForm.name, action: ruleForm.action, direction: ruleForm.direction, protocol: ruleForm.protocol, remote_ip: ruleForm.remote_ip || null, remote_port: ruleForm.remote_port || null, local_port: ruleForm.local_port || null, priority: Number(ruleForm.priority) || 10, description: ruleForm.description })} className="w-full py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs font-bold">➕ เพิ่มกฎ</button>
          </div>
        </div>

        {/* สแกน + ทดสอบ */}
        <div className="space-y-3">
          <div className="text-sm font-bold text-gray-300">🌐 การเชื่อมต่อที่สแกน ({conns.length})</div>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {conns.length === 0 && <div className="text-xs text-gray-600">กด "สแกนการเชื่อมต่อ" เพื่อจำแนก known/unknown ตามกฎ</div>}
            {conns.map((c, i) => (
              <div key={i} className={`flex items-center gap-2 text-[11px] rounded px-2 py-1 border ${c.label === 'BLOCKED' ? 'bg-red-950/40 border-red-800 text-red-200' : c.label === 'UNKNOWN' ? 'bg-amber-950/30 border-amber-800 text-amber-200' : 'bg-emerald-950/30 border-emerald-800 text-emerald-200'}`}>
                <span>{c.label === 'BLOCKED' ? '🚫' : c.label === 'UNKNOWN' ? '⚠️' : '✅'}</span>
                <span className="flex-1 truncate">{c.protocol} {c.local} → {c.remote}</span>
                <span className="text-gray-500">PID {c.pid}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-800 pt-2 space-y-1.5">
            <div className="text-xs font-bold text-gray-300">🧪 ทดสอบกฎกับ IP ใด ๆ</div>
            <div className="flex gap-1.5">
              <input value={testIp} onChange={(e) => setTestIp(e.target.value)} placeholder="IP เช่น 45.33.1.2" className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <input value={testPort} onChange={(e) => setTestPort(e.target.value)} placeholder="พอร์ต" className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs" />
              <button onClick={evaluate} className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 rounded text-xs font-bold">ทดสอบ</button>
            </div>
            {evalResult && <div className="text-xs text-gray-200 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5">{evalResult}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
