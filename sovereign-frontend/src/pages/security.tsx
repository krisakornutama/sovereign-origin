"use client";
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import StatCard from '../components/ui/StatCard';
import StatusPill from '../components/ui/StatusPill';
import NextGenPanel from '../components/security/NextGenPanel';
import FirewallEnginePanel from '../components/security/FirewallEnginePanel';
import KillSwitchCard, { type KillSwitchState } from '../components/security/KillSwitchCard';
import LiveEventStreamPanel from '../components/security/LiveEventStreamPanel';
import FirstResponderCard, { type FirstResponderState } from '../components/security/FirstResponderCard';
import RealityCard, { type RealityStats, type RealityCorrection } from '../components/security/RealityCard';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';
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
  const t = useLanguageStore((s) => s.t);
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
      if (!res.ok) throw new Error(data.error || t('security.changeStatusFailed', 'เปลี่ยนสถานะไม่สำเร็จ'));
      setKillSwitch(data);
      setActionMsg(
        active
          ? { type: 'error', text: t('security.killSwitchOn', 'Kill-Switch เปิดแล้ว — AI Agent ทุกตัวหยุดทำงานทันที (เหตุผล: {reason})', { reason: data.reason }) }
          : { type: 'success', text: t('security.killSwitchOff', 'Kill-Switch ปลดล็อกแล้ว — AI Agent ทำงานได้ตามปกติ') }
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
        ? t('security.confirmBlock', 'Block IP {ip} ที่ไฟร์วอลล์?\n\nคำสั่งนี้จะผ่านระบบ guard + autonomy ของ AI agent', { ip })
        : t('security.confirmUnblock', 'ยกเลิกการ block IP {ip}?', { ip });
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
          text: t('security.blockRequested', 'คำขอ {action} IP {ip} ถูกส่งไปรออนุมัติแล้ว — อนุมัติได้ในส่วน "คำขออนุมัติ" ด้านล่าง', { action: action === 'block' ? 'block' : 'unblock', ip }),
        });
      } else if (res.ok) {
        setActionMsg({ type: 'success', text: data?.result || t('security.actionSuccess', '{verb} สำเร็จ', { verb: action === 'block' ? 'Block' : 'Unblock' }) });
      } else {
        setActionMsg({ type: 'error', text: data?.reason || data?.error || t('security.actionRejected', 'คำสั่งถูกปฏิเสธ') });
      }
      await reloadBlocks();
      await loadApprovals();
    } catch (err) {
      setActionMsg({ type: 'error', text: t('security.apiConnectFailed', 'เชื่อมต่อ Core API ไม่ได้') });
    } finally {
      setBusyIp(null);
    }
  };

  // อนุมัติ / ปฏิเสธ คำขอ action ของ AI โดยตรงที่หน้านี้ (ไม่ต้องไปหน้า AI Agent)
  const decideApproval = async (id: string, action: 'approve' | 'reject') => {
    const ok = window.confirm(
      action === 'approve'
        ? t('security.confirmApprove', 'อนุมัติให้ดำเนินการคำสั่งนี้ทันที?\n\nคำสั่งจะทำงานจริงบนระบบ — ตรวจสอบให้แน่ใจ')
        : t('security.confirmReject', 'ปฏิเสธคำสั่งนี้?')
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
          ? { type: 'success', text: t('security.approvedMsg', 'อนุมัติแล้ว: {result}', { result: data?.result || t('security.approvedDefault', 'ดำเนินการสำเร็จ') }) }
          : { type: 'success', text: t('security.rejectedMsg', 'ปฏิเสธคำสั่งแล้ว') });
      } else {
        setActionMsg({ type: 'error', text: data?.reason || data?.error || t('security.decideFailed', 'ไม่สามารถ{verb}ได้', { verb: action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ' }) });
      }
      await loadApprovals();
      await reloadBlocks();
    } catch (err) {
      setActionMsg({ type: 'error', text: t('security.apiConnectFailed', 'เชื่อมต่อ Core API ไม่ได้') });
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
      if (!res.ok) throw new Error(data.error || t('security.changeStatusFailed', 'เปลี่ยนสถานะไม่สำเร็จ'));
      setFirstResponder(data);
      setActionMsg(
        active
          ? { type: 'error', text: t('security.frOn', 'First-Responder Mode เปิดแล้ว — Vision AI หยุดแจ้งเตือนคนแปลกหน้า หมดอายุอัตโนมัติใน 2 ชม.') }
          : { type: 'success', text: t('security.frOff', 'First-Responder Mode ปิดแล้ว — ระบบกลับสู่การเฝ้าระวังปกติ') }
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
      if (!res.ok) throw new Error(data.error || t('security.saveFailed', 'บันทึกไม่สำเร็จ'));
      setRealityStats(data);
      setActionMsg({ type: 'success', text: t('security.realitySaved', 'บันทึก reality anchor แล้ว — AI จะไม่อ้างเหตุการณ์นี้ซ้ำในการตัดสินใจ') });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message });
    } finally {
      setBusyReality(false);
    }
  };

  const severityColor = (s: string) =>
    s === 'critical' ? 'text-red-400' : s === 'warning' ? 'text-amber-400' : 'text-blue-400';

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('security.unauthorized', 'Unauthorized')}</div>;
  }

  const pending = approvals.filter((a) => a.status === 'pending');
  const history = approvals.filter((a) => a.status !== 'pending');

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
      <header className="bg-gray-900/80 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow={t('security.eyebrow', 'ความปลอดภัย')}
          title={t('security.title', 'Cyber Security')}
          icon={<Icon name="shield" size={18} />}
          subtitle={t('security.subtitle', 'Firewall + ระบบตรวจจับภัยคุกคาม')}
          actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('security.backDashboard', '← กลับ Dashboard')}</Link>}
        />
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* ⛔ แบนเนอร์ฉุกเฉิน — ทุก role เห็น เมื่อ Kill-Switch เปิดอยู่ */}
        {killSwitch?.active && (
          <div className="p-4 rounded-xl border-2 border-red-600 bg-red-950/60 space-y-1.5 animate-pulse">
            <div className="text-red-300 font-bold">{t('security.killBanner', 'EMERGENCY — AI KILL-SWITCH เปิดอยู่: AI Agent ถูกหยุดทั่วทั้งระบบ')}</div>
            <div className="text-xs text-red-200">
              {t('security.killBannerReason', 'เหตุผล: {reason} · เปิดโดย: {by} · เวลา: {time}', { reason: killSwitch.reason || t('security.unspecified', 'ไม่ระบุ'), by: killSwitch.by || '-', time: killSwitch.at ? new Date(killSwitch.at).toLocaleString(fmtLocale()) : '-' })}
              {!isSuperadmin && <span className="ml-2 text-red-300/70">{t('security.superadminOnlyUnlock', 'เฉพาะ SUPERADMIN เท่านั้นที่ปลดล็อกได้')}</span>}
            </div>
          </div>
        )}

        {/* ── แท็บ: ภาพรวม / ตั้งค่าขั้นสูง ── */}
        <div className="flex gap-2">
          <button
            onClick={() => setSecTab('overview')}
            className={secTab === 'overview' ? 'btn-primary' : 'btn-ghost'}
          >
            {t('common.nav.group.overview', 'ภาพรวม')}
          </button>
          <button
            onClick={() => setSecTab('advanced')}
            className={secTab === 'advanced' ? 'btn-primary' : 'btn-ghost'}
          >
            {t('security.tabAdvanced', 'ตั้งค่าขั้นสูง (Firewall Engine)')}
          </button>
          <button
            onClick={() => setSecTab('nextgen')}
            className={secTab === 'nextgen' ? 'btn-primary' : 'btn-ghost'}
          >
            {t('security.tabNextGen', 'Next-Gen Security')}
          </button>
          <span className="self-center text-[10px] text-gray-500 ml-1">
            {t('security.tabHint', 'ภาพรวม = สถานะ/การอนุมัติ/การเชื่อมต่อ · ขั้นสูง = กฎไฟร์วอลล์ + จำแนก unknown + สคริปต์ติดตั้ง · Next-Gen = Threat DB + Pi-hole + IDS + App Control')}
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
          <div className="card panel-glow p-4">
            <div className="text-sm text-gray-400 flex items-center gap-1.5"><Icon name="shield" size={14} className="text-emerald-400" /> {t('security.firewall', 'Firewall')} <span className="text-gray-600">{t('security.firewallHint', '(ไฟร์วอลล์)')}</span></div>
            <div className="mt-2"><StatusPill variant={firewallStatus === 'active' ? 'ok' : 'err'} label={firewallStatus.toUpperCase()} pulse={firewallStatus === 'active'} /></div>
          </div>
          <StatCard label={t('security.activeConnections', 'Active Connections')} value={connections.length} icon={<Icon name="relay" size={14} />} />
          <StatCard label={t('security.securityEvents', 'Security Events')} value={events.length} icon={<Icon name="alerts" size={14} />} />
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
        <div className="card panel-cyan p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">
              {t('security.approvalTitle', 'คำขออนุมัติ Action ({n})', { n: pending.length })}
              {pending.length > 0 && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-amber-900/50 text-amber-300 font-bold">{t('security.pendingCount', 'รอตัดสินใจ {n} รายการ', { n: pending.length })}</span>}
            </h2>
            {!isSuperadmin && (
              <span className="text-[10px] text-gray-500 flex items-center gap-1"><Icon name="lock" size={11} /> {t('security.superadminOnly', 'เฉพาะ SUPERADMIN เท่านั้น')}</span>
            )}
          </div>

          {isSuperadmin ? (
            <>
              {pending.length === 0 ? (
                <div className="text-gray-500 text-sm text-center py-4 border border-dashed border-gray-700 rounded-lg">
                  {t('security.noApprovals', 'ไม่มีคำขอรออนุมัติ — เมื่อ AI หรือผู้ใช้ขอ block/unblock IP ในโหมด suggest คำขอจะขึ้นที่นี่')}
                </div>
              ) : (
                <div className="space-y-3">
                  {pending.map((a) => (
                    <div key={a.id} className="border border-amber-700 bg-amber-900/10 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 font-bold">{t('security.actionBadge', 'ACTION')}</span>
                          <span className="font-bold text-amber-300">{a.tool}</span>
                          <span className="text-xs text-gray-500">{fmtTime(a.createdAt)}</span>
                        </div>
                        <span className="text-[10px] text-gray-600 break-all">ID: {a.id}</span>
                      </div>
                      <pre className="text-xs text-gray-300 bg-gray-950/60 border border-cyan-800/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                        {fmtArgs(a.args)}
                      </pre>
                      {a.reason && <div className="text-xs text-gray-400">{t('security.reason', 'เหตุผล: {reason}', { reason: a.reason })}</div>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => decideApproval(a.id, 'approve')}
                          disabled={busyApproval === a.id}
                          className="btn-primary"
                        >
                          <Icon name="check" size={14} />
                          {busyApproval === a.id ? t('security.approving', 'กำลังอนุมัติ...') : t('common.approve', 'อนุมัติ')}
                        </button>
                        <button
                          onClick={() => decideApproval(a.id, 'reject')}
                          disabled={busyApproval === a.id}
                          className="btn-danger"
                        >
                          <Icon name="x" size={14} />
                          {t('common.reject', 'ปฏิเสธ')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ประวัติ */}
              {history.length > 0 && (
                <div className="pt-2 border-t border-gray-800">
                  <h3 className="text-sm font-semibold text-gray-200 glow-text mb-2">{t('security.decisionHistory', 'ประวัติการตัดสินใจ ({n})', { n: history.length })}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="text-gray-500 uppercase">
                        <tr>
                          <th className="py-2 pr-3">{t('common.time', 'เวลา')}</th>
                          <th className="py-2 pr-3">{t('security.tool', 'Tool')}</th>
                          <th className="py-2 pr-3">{t('security.args', 'Args')}</th>
                          <th className="py-2 pr-3">{t('security.result', 'ผล')}</th>
                          <th className="py-2">{t('common.details', 'รายละเอียด')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {history.slice(0, 10).map((a) => (
                          <tr key={a.id} className="text-gray-400">
                            <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(a.decidedAt)}</td>
                            <td className="py-2 pr-3 text-gray-300">{a.tool}</td>
                            <td className="py-2 pr-3 font-mono text-gray-500">{fmtArgs(a.args).replace(/\s+/g, ' ')}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${a.status === 'approved' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-red-900/50 text-red-300'}`}>
                                {a.status === 'approved' ? t('security.approvedBadge', 'APPROVED') : t('security.rejectedBadge', 'REJECTED')}
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
              {t('security.nonSuperadminNote', 'เฉพาะ SUPERADMIN เท่านั้นที่เห็นและตัดสินใจคำขอ block/unblock — ติดต่อผู้ดูแลระบบ')}
            </div>
          )}
        </div>

        {/* Blocked IPs */}
        <div className="card panel-cyan p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('security.blockedIps', 'IP ที่ถูก Block ({n})', { n: blockedIps.length })} <span className="text-xs text-gray-500 font-normal">{t('security.blockedIpsNote', '— รายการที่ระบบสั่ง block ไว้')}</span></h2>
            <span className="text-[10px] text-gray-600">{t('security.memoryNote', 'รายการจำในหน่วยความจำของระบบ — กด ✕ เพื่อ unblock')}</span>
          </div>
          {blockedIps.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-4 border border-dashed border-gray-700 rounded-lg mt-3">
              {t('security.noBlockedIps', 'ยังไม่มี IP ถูก block ผ่านระบบ — กด Block ในตาราง Connections ด้านล่าง')}
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
                    title={t('security.unblockTitle', 'ยกเลิกการ block {ip}', { ip })}
                    className="text-xs hover:text-white disabled:opacity-50 flex items-center"
                  >
                    {busyIp === ip ? '...' : <Icon name="x" size={10} />}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Network Connections Table — ตารางการเชื่อมต่อเครือข่าย */}
        <div className="card panel-cyan overflow-x-auto">
          <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan p-4 border-b border-gray-800">{t('security.activeConnections', 'Active Connections')} <span className="text-xs text-gray-500 font-normal">{t('security.connectionsNote', '— การเชื่อมต่อเครือข่ายที่กำลังใช้งาน (ตรวจสอบ + block IP แปลกปลอม)')}</span></h2>
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">{t('security.colProtocol', 'Protocol')} <span className="normal-case text-gray-600">{t('security.colProtocolHint', '(โปรโตคอล)')}</span></th>
                <th className="px-4 py-3">{t('security.colLocal', 'Local Address')} <span className="normal-case text-gray-600">{t('security.colLocalHint', '(ที่อยู่เครื่องเรา)')}</span></th>
                <th className="px-4 py-3">{t('security.colForeign', 'Foreign Address')} <span className="normal-case text-gray-600">{t('security.colForeignHint', '(ปลายทาง)')}</span></th>
                <th className="px-4 py-3">{t('security.colState', 'State')} <span className="normal-case text-gray-600">{t('security.colStateHint', '(สถานะ)')}</span></th>
                <th className="px-4 py-3">{t('security.colPid', 'PID')} <span className="normal-case text-gray-600">{t('security.colPidHint', '(โปรเซส)')}</span></th>
                <th className="px-4 py-3">{t('security.colAction', 'Action')} <span className="normal-case text-gray-600">{t('security.colActionHint', '(จัดการ)')}</span></th>
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
                          {t('security.blocked', 'Blocked')}
                        </span>
                      ) : (
                        <button
                          onClick={() => sendBlockAction('block', ip)}
                          disabled={busyIp === ip || !ip}
                          title={t('security.blockTitle', 'Block {ip} ที่ไฟร์วอลล์', { ip })}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-amber-900/40 border border-amber-700 text-amber-300 hover:bg-amber-900/60 transition disabled:opacity-50"
                        >
                          {busyIp === ip ? t('security.working', 'กำลัง...') : (<><Icon name="shield" size={10} /> {t('security.block', 'Block')}</>)}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {connections.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">{t('security.noConnections', 'ยังไม่มีการเชื่อมต่อที่ใช้งานอยู่')}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Security Events — ตารางเหตุการณ์ความปลอดภัย */}
        <div className="card panel-cyan overflow-x-auto">
          <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan p-4 border-b border-gray-800">{t('security.securityEvents', 'Security Events')} <span className="text-xs text-gray-500 font-normal">{t('security.securityEventsNote', '— ประวัติเหตุการณ์ความปลอดภัยของระบบ')}</span></h2>
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">{t('security.colTime', 'Time')} <span className="normal-case text-gray-600">{t('security.colTimeHint', '(เวลา)')}</span></th>
                <th className="px-4 py-3">{t('security.colType', 'Type')} <span className="normal-case text-gray-600">{t('security.colTypeHint', '(ประเภท)')}</span></th>
                <th className="px-4 py-3">{t('security.colSeverity', 'Severity')} <span className="normal-case text-gray-600">{t('security.colSeverityHint', '(ความรุนแรง)')}</span></th>
                <th className="px-4 py-3">{t('security.colSourceIp', 'Source IP')} <span className="normal-case text-gray-600">{t('security.colSourceIpHint', '(ต้นทาง)')}</span></th>
                <th className="px-4 py-3">{t('security.colDescription', 'Description')} <span className="normal-case text-gray-600">{t('security.colDescriptionHint', '(รายละเอียด)')}</span></th>
                <th className="px-4 py-3">{t('security.colAi', 'AI')} <span className="normal-case text-gray-600">{t('security.colAiHint', '(เข้าใจผิด?)')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2 text-xs text-gray-400">{new Date(e.timestamp).toLocaleString(fmtLocale())}</td>
                  <td className="px-4 py-2">{e.event_type}</td>
                  <td className={`px-4 py-2 font-bold ${severityColor(e.severity)}`}>{e.severity}</td>
                  <td className="px-4 py-2 text-xs">{e.source_ip || '-'}</td>
                  <td className="px-4 py-2 text-xs">{e.description}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={async () => {
                        const note = window.prompt(t('security.falsePositivePrompt', 'AI เตือนผิด — บอกครอบครัว/ระบบว่าเกิดอะไรขึ้นจริง (เช่น "นี่คือช่างที่เราจ้าง")'), '');
                        if (note === null) return;
                        if (!note.trim()) return alert(t('security.detailRequired', 'ต้องใส่รายละเอียด'));
                        setBusyCorrectId(e.id);
                        await submitCorrection('false_positive', note.trim(), e.event_type);
                        setBusyCorrectId(null);
                      }}
                      disabled={busyCorrectId === e.id}
                      title={t('security.falsePositiveTitle', 'ยืนยันว่าเหตุการณ์นี้ AI เตือนผิด — จะกลายเป็น reality anchor ให้ AI เรียนรู้')}
                      className="text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition disabled:opacity-50"
                    >
                      {busyCorrectId === e.id ? t('security.working', 'กำลัง...') : t('security.falsePositive', 'เตือนผิด')}
                    </button>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">{t('security.noEvents', 'ยังไม่มีเหตุการณ์ด้านความปลอดภัย')}</td></tr>
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
            <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-xs text-amber-200 flex items-start gap-1.5">
              <Icon name="settings" size={13} className="mt-0.5 shrink-0" />
              <span><span className="font-bold">{t('security.advancedModeBold', 'โหมดตั้งค่าขั้นสูง')}</span>{t('security.advancedModeNote', ' — ต่อไปนี้คือ Firewall Engine: กฎ allow/deny, การจำแนก IP unknown, การสแกนการเชื่อมต่อ และการสร้างสคริปต์ติดตั้งสำหรับ Windows')}</span>
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
