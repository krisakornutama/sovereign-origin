"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusPill from '../components/ui/StatusPill';
import NextGenPanel from '../components/security/NextGenPanel';
import FirewallEnginePanel from '../components/security/FirewallEnginePanel';
import KillSwitchCard, { type KillSwitchState } from '../components/security/KillSwitchCard';
import LiveEventStreamPanel from '../components/security/LiveEventStreamPanel';
import FirstResponderCard, { type FirstResponderState } from '../components/security/FirstResponderCard';
import RealityCard, { type RealityStats, type RealityCorrection } from '../components/security/RealityCard';
import { extractIp, fmtTime, fmtArgs, ACTION_STYLES } from '../components/security/security-ui';
import type { ActionMsg } from '../components/security/security-ui';

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
  const [killSwitch, setKillSwitch] = useState<KillSwitchState | null>(null);
  const [busyKillSwitch, setBusyKillSwitch] = useState(false);
  const [firstResponder, setFirstResponder] = useState<FirstResponderState | null>(null);
  const [busyFirstResponder, setBusyFirstResponder] = useState(false);
  const [realityStats, setRealityStats] = useState<RealityStats | null>(null);
  const [busyReality, setBusyReality] = useState(false);
  const [busyCorrectId, setBusyCorrectId] = useState<string | null>(null);

  // ── 2 แท็บ: ภาพรวม (default) | ตั้งค่าขั้นสูง (Firewall Engine ซ่อนอยู่หลังปุ่ม Advanced) ──
  const [secTab, setSecTab] = useState<'overview' | 'advanced' | 'nextgen'>('overview');

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
      const [connRes, eventRes, fwRes, blocksRes, ksRes, frRes, realityRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/connections`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/events`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/firewall/blocks`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/kill-switch`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/first-responder`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/reality`),
      ]);
      const [connData, eventData, fwData, blocksData, ksData, frData, realityData] = await Promise.all([
        connRes.json(),
        eventRes.json(),
        fwRes.json(),
        blocksRes.ok ? blocksRes.json() : { blockedIps: [], pendingApprovals: 0 },
        ksRes.ok ? ksRes.json() : null,
        frRes.ok ? frRes.json() : null,
        realityRes.ok ? realityRes.json() : null,
      ]);
      setConnections(connData);
      setEvents(eventData);
      setFirewallStatus(fwData.status || 'unknown');
      setBlockedIps(blocksData.blockedIps || []);
      setPendingApprovals(blocksData.pendingApprovals || 0);
      if (ksData) setKillSwitch(ksData);
      if (frData) setFirstResponder(frData);
      if (realityData) setRealityStats(realityData);
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

  // Emergency Kill-Switch — SUPERADMIN เท่านั้น (guard อีกชั้นจาก backend)
  const toggleKillSwitch = async (active: boolean, reason: string) => {
    setBusyKillSwitch(true);
    setActionMsg(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/kill-switch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เปลี่ยนสถานะไม่สำเร็จ');
      setKillSwitch(data);
      setActionMsg(
        active
          ? { type: 'error', text: `⛔ Kill-Switch เปิดแล้ว — AI Agent ทุกตัวหยุดทำงานทันที (เหตุผล: ${data.reason})` }
          : { type: 'success', text: '🟢 Kill-Switch ปลดล็อกแล้ว — AI Agent ทำงานได้ตามปกติ' }
      );
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message });
    } finally {
      setBusyKillSwitch(false);
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

  // First-Responder Mode (SOS) — SUPERADMIN เท่านั้น
  const toggleFirstResponder = async (active: boolean, note: string) => {
    setBusyFirstResponder(true);
    setActionMsg(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/first-responder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เปลี่ยนสถานะไม่สำเร็จ');
      setFirstResponder(data);
      setActionMsg(
        active
          ? { type: 'error', text: '🚨 First-Responder Mode เปิดแล้ว — Vision AI หยุดแจ้งเตือนคนแปลกหน้า หมดอายุอัตโนมัติใน 2 ชม.' }
          : { type: 'success', text: '🟢 First-Responder Mode ปิดแล้ว — ระบบกลับสู่การเฝ้าระวังปกติ' }
      );
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message });
    } finally {
      setBusyFirstResponder(false);
    }
  };

  // Reality-Check — ครอบครัวยืนยันว่า AI เตือนผิด / เพิ่มบริบท (reality anchor)
  const submitCorrection = async (kind: RealityCorrection['kind'], note: string, sourceType?: string) => {
    setBusyReality(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/nextgen/reality/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, note, source_type: sourceType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      setRealityStats(data);
      setActionMsg({ type: 'success', text: '🧠 บันทึก reality anchor แล้ว — AI จะไม่อ้างเหตุการณ์นี้ซ้ำในการตัดสินใจ' });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message });
    } finally {
      setBusyReality(false);
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
        {/* ⛔ แบนเนอร์ฉุกเฉิน — ทุก role เห็น เมื่อ Kill-Switch เปิดอยู่ */}
        {killSwitch?.active && (
          <div className="p-4 rounded-xl border-2 border-red-600 bg-red-950/60 space-y-1.5 animate-pulse">
            <div className="text-red-300 font-bold">⛔ EMERGENCY — AI KILL-SWITCH เปิดอยู่: AI Agent ถูกหยุดทั่วทั้งระบบ</div>
            <div className="text-xs text-red-200">
              เหตุผล: {killSwitch.reason || 'ไม่ระบุ'} · เปิดโดย: {killSwitch.by || '-'} · เวลา: {killSwitch.at ? new Date(killSwitch.at).toLocaleString('th-TH') : '-'}
              {!isSuperadmin && <span className="ml-2 text-red-300/70">เฉพาะ SUPERADMIN เท่านั้นที่ปลดล็อกได้</span>}
            </div>
          </div>
        )}

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
          <button
            onClick={() => setSecTab('nextgen')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${secTab === 'nextgen' ? 'bg-green-600 text-white shadow-lg' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          >
            🧬 Next-Gen Security
          </button>
          <span className="self-center text-[10px] text-gray-500 ml-1">
            ภาพรวม = สถานะ/การอนุมัติ/การเชื่อมต่อ · ขั้นสูง = กฎไฟร์วอลล์ + จำแนก unknown + สคริปต์ติดตั้ง · Next-Gen = Threat DB + Pi-hole + IDS + App Control
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

        {/* Kill-Switch — ปุ่มหยุดฉุกเฉิน AI Agent ทั้งระบบ */}
        <KillSwitchCard
          state={killSwitch}
          isSuperadmin={isSuperadmin}
          busy={busyKillSwitch}
          onToggle={toggleKillSwitch}
        />

        {/* First-Responder Mode (SOS) — รับมือเหตุฉุกเฉิน/หน่วยกู้ภัย */}
        <FirstResponderCard
          state={firstResponder}
          isSuperadmin={isSuperadmin}
          busy={busyFirstResponder}
          onToggle={toggleFirstResponder}
        />

        {/* Reality-Check / Paranoia Index — ป้องกัน AI เตือนผิดซ้ำ ๆ */}
        <RealityCard
          stats={realityStats}
          busy={busyReality}
          onCorrect={submitCorrection}
        />

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
                <th className="px-4 py-3">AI <span className="normal-case text-gray-600">(เข้าใจผิด?)</span></th>
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
                  <td className="px-4 py-2">
                    <button
                      onClick={async () => {
                        const note = window.prompt('AI เตือนผิด — บอกครอบครัว/ระบบว่าเกิดอะไรขึ้นจริง (เช่น "นี่คือช่างที่เราจ้าง")', '');
                        if (note === null) return;
                        if (!note.trim()) return alert('ต้องใส่รายละเอียด');
                        setBusyCorrectId(e.id);
                        await submitCorrection('false_positive', note.trim(), e.event_type);
                        setBusyCorrectId(null);
                      }}
                      disabled={busyCorrectId === e.id}
                      title="ยืนยันว่าเหตุการณ์นี้ AI เตือนผิด — จะกลายเป็น reality anchor ให้ AI เรียนรู้"
                      className="text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition disabled:opacity-50"
                    >
                      {busyCorrectId === e.id ? '⏳' : '🧠 เตือนผิด'}
                    </button>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">ยังไม่มีเหตุการณ์ด้านความปลอดภัย</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Live Real-time Stream — เหตุการณ์สดจากทุก service */}
        <LiveEventStreamPanel
          apiBase={process.env.NEXT_PUBLIC_API_URL || ''}
          token={token}
          onKillSwitch={(s) => setKillSwitch(s)}
          onFirstResponder={(s) => setFirstResponder(s)}
        />
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

        {secTab === 'nextgen' && (
          <NextGenPanel />
        )}

        </main>
    </div>
      </div>
  );
}
