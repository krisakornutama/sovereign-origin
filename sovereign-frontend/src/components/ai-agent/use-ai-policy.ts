// ── นโยบาย AI + คำขออนุมัติ + สถานะระบบ: โหลด / poll 15 วิ / เปลี่ยน autonomy / ตัดสินอนุมัติ ──
// ย้ายจาก pages/ai-agent.tsx ตามเดิมทุกบรรทัด (FE-005) — ห้ามแก้พฤติกรรม
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { asArray } from '../../lib/fetchJson';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { AUTONOMY_META } from '../../lib/ai-agent-types';
import type { AiPolicy, AiStatus, Approval, AutonomyLevel } from '../../lib/ai-agent-types';

export function useAiPolicy(params: {
  isSuperadmin: boolean;
  isHydrated: boolean;
  isAuthenticated: boolean;
  setMessage: (v: string) => void;
  setError: (v: string) => void;
}) {
  const { isSuperadmin, isHydrated, isAuthenticated, setMessage, setError } = params;
  const t = useLanguageStore((s) => s.t);

  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // สถานะ + ทำงานกับ AI
  const [status, setStatus] = useState<AiStatus | null>(null);

  const loadPolicy = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/policy`);
      if (res.ok) setPolicy(await res.json());
      else setError(t('aiAgent.autonomy.policyLoadFailed', 'โหลดนโยบาย AI ไม่สำเร็จ'));
    } catch (err) {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadApprovals = useCallback(async () => {
    if (!isSuperadmin) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/approvals`);
      if (res.ok) setApprovals(asArray(await res.json()));
    } catch (err) {
      // เงียบๆ — หน้า policy ยังใช้งานได้
    }
  }, [isSuperadmin]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/status`);
      if (res.ok) setStatus(await res.json());
    } catch (err) {
      // เงียบ ๆ — แสดงเฉพาะตอนโหลดได้
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadPolicy();
    loadApprovals();
    loadStatus();
    const interval = setInterval(() => {
      loadPolicy();
      loadApprovals();
      loadStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [isHydrated, isAuthenticated, loadPolicy, loadApprovals, loadStatus]);

  const changeAutonomy = async (next: AutonomyLevel) => {
    if (!isSuperadmin) return;
    setMessage('');
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autonomy: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(t('aiAgent.autonomy.changed', 'เปลี่ยนระดับ autonomy เป็น "{label}" แล้ว', { label: t(`aiAgent.autonomy.${next}.label`, AUTONOMY_META[next].label) }));
        await loadPolicy();
      } else {
        setError(data?.error || t('aiAgent.autonomy.changeFailed', 'เปลี่ยน autonomy ไม่สำเร็จ'));
      }
    } catch (err) {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    }
  };

  const decideApproval = async (id: string, action: 'approve' | 'reject') => {
    if (action === 'approve') {
      const ok = window.confirm(t('aiAgent.approvals.approveConfirm', 'อนุมัติให้ AI ดำเนินการคำสั่งนี้ทันที?\n\nคำสั่งที่กำลังจะทำงานจริงบนระบบ — ตรวจสอบให้แน่ใจ'));
      if (!ok) return;
    } else {
      const ok = window.confirm(t('aiAgent.approvals.rejectConfirm', 'ปฏิเสธคำสั่งนี้?'));
      if (!ok) return;
    }
    setBusyId(id);
    setMessage('');
    setError('');
    try {
      const res = await authFetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/ai/approvals/${id}/${action}`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(action === 'approve'
          ? t('aiAgent.approvals.approvedResult', 'อนุมัติแล้ว: {result}', { result: data?.result || t('aiAgent.approvals.doneFallback', 'ดำเนินการสำเร็จ') })
          : t('aiAgent.approvals.rejected', 'ปฏิเสธคำสั่งแล้ว'));
        await loadApprovals();
      } else {
        setError(data?.reason || data?.error || t('aiAgent.approvals.cannotVerb', 'ไม่สามารถ{verb}ได้', { verb: action === 'approve' ? t('aiAgent.approvals.approveVerb', 'อนุมัติ') : t('aiAgent.approvals.rejectVerb', 'ปฏิเสธ') }));
        await loadApprovals();
      }
    } catch (err) {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    } finally {
      setBusyId(null);
    }
  };

  return {
    policy,
    approvals,
    loading,
    status,
    busyId,
    loadPolicy,
    loadApprovals,
    loadStatus,
    changeAutonomy,
    decideApproval,
  };
}
