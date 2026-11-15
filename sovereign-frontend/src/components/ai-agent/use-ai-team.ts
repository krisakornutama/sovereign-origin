// ── ทีม Agent + งานเบื้องหลัง: บทบาท / ฟอร์ม / รันงาน / poll สถานะ ──
// ย้ายจาก pages/ai-agent.tsx ตามเดิมทุกบรรทัด (FE-005) — ห้ามแก้พฤติกรรม
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';

type Tab = 'policy' | 'team' | 'jobs' | 'coding';

export function useAiTeam(params: {
  isSuperadmin: boolean;
  tab: Tab;
  setTab: (tab: Tab) => void;
  setMessage: (v: string) => void;
  setError: (v: string) => void;
}) {
  const { isSuperadmin, tab, setTab, setMessage, setError } = params;
  const t = useLanguageStore((s) => s.t);

  const [roles, setRoles] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [roleForm, setRoleForm] = useState<Record<string, string>>({});
  const [runPrompt, setRunPrompt] = useState<Record<string, string>>({});
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);

  const loadRoles = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles || []);
      }
    } catch {
      // เงียบ
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch {
      // เงียบ
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const createRole = async () => {
    if (!isSuperadmin) return;
    setError('');
    setMessage('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roleForm.name || '',
          emoji: roleForm.emoji || '🤖',
          description: roleForm.description || '',
          system_prompt: roleForm.system_prompt || '',
          capability: roleForm.capability || 'general',
          count: Number(roleForm.count) || 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(t('aiAgent.team.roleAdded', 'เพิ่มบทบาทแล้ว'));
        setRoleForm({});
        await loadRoles();
      } else {
        setError(data?.error || t('aiAgent.team.roleAddFailed', 'เพิ่มบทบาทไม่สำเร็จ'));
      }
    } catch {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    }
  };

  const updateRole = async (id: string, patch: Record<string, unknown>) => {
    if (!isSuperadmin) return;
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setMessage(t('aiAgent.team.roleSaved', 'บันทึกบทบาทแล้ว'));
        await loadRoles();
      }
    } catch {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    }
  };

  const deleteRole = async (id: string, name: string) => {
    if (!isSuperadmin) return;
    if (!window.confirm(t('aiAgent.team.deleteRoleConfirm', 'ลบบทบาท "{name}"? (งานที่รันอยู่จะถูกยกเลิกด้วย)', { name }))) return;
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMessage(t('aiAgent.team.roleDeleted', 'ลบบทบาทแล้ว'));
        await loadRoles();
      }
    } catch {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    }
  };

  const runRole = async (id: string) => {
    if (!isSuperadmin) return;
    const prompt = (runPrompt[id] || '').trim();
    if (!prompt) {
      setError(t('aiAgent.team.promptRequired', 'พิมพ์ภารกิจให้ agent ก่อนกดรัน'));
      return;
    }
    setError('');
    setMessage('');
    setTeamBusy(id);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(t('aiAgent.team.runSent', 'ส่งงานให้ AI แล้ว — รันเบื้องหลัง ไปดูหน้าอื่นได้เลย (ป้ายมุมขวาล่างจะแจ้ง)') + (data?.job?.id ? ` · ID: ${data.job.id.slice(0, 8)}` : ''));
        setRunPrompt((prev) => ({ ...prev, [id]: '' }));
        setTab('jobs');
        await loadJobs();
      } else {
        setError(data?.error || t('aiAgent.team.runFailed', 'สั่งงานไม่สำเร็จ'));
      }
    } catch {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    } finally {
      setTeamBusy(null);
    }
  };

  const cancelJob = async (id: string) => {
    if (!isSuperadmin) return;
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/jobs/${id}/cancel`, { method: 'POST' });
      if (res.ok) {
        setMessage(t('aiAgent.jobs.cancelledMsg', 'ยกเลิกงานแล้ว'));
        await loadJobs();
      }
    } catch {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    }
  };

  const deleteJob = async (id: string) => {
    if (!isSuperadmin) return;
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/jobs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadJobs();
      }
    } catch {
      setError(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    }
  };

  // ── Coding Agent: state + แฮนเดลทั้งหมดย้ายไปอยู่ใน CodingIde.tsx ──

  // Poll งานเบื้องหลังทุก 3 วิ (เฉพาะหน้า jobs — ป้าย global ดูแลใน _app)
  useEffect(() => {
    if (tab !== 'jobs') return;
    setJobsLoading(true);
    loadJobs();
    const interval = setInterval(loadJobs, 3000);
    return () => clearInterval(interval);
  }, [tab, loadJobs]);

  // โหลดบทบาทครั้งแรกเมื่อเข้าแท็บ team
  useEffect(() => {
    if (tab === 'team') loadRoles();
  }, [tab, loadRoles]);

  return {
    roles,
    jobs,
    roleForm,
    setRoleForm,
    runPrompt,
    setRunPrompt,
    teamBusy,
    jobsLoading,
    loadRoles,
    loadJobs,
    createRole,
    updateRole,
    deleteRole,
    runRole,
    cancelJob,
    deleteJob,
  };
}
