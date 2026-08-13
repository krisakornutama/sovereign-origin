"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

type AutonomyLevel = 'view' | 'suggest' | 'autonomous';
type ToolKind = 'read-only' | 'action';
type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface AiToolInfo {
  name: string;
  kind: ToolKind;
  description: string;
  available: boolean;
}

interface AiPolicy {
  autonomy: AutonomyLevel;
  approvalTtlMs: number;
  protectedIps: string[];
  protectedProcesses: string[];
  tools: AiToolInfo[];
}

interface Approval {
  id: string;
  tool: string;
  args: any;
  reason: string;
  createdAt: number;
  status: ApprovalStatus;
  result?: string;
  decidedAt?: number;
}

interface AiStatus {
  ollamaOnline: boolean;
  ollamaUrl: string;
  currentModel: string;
  models: Array<{ name: string; size: string }>;
  resources: {
    cpuCores: number;
    cpuUsagePercent: number | null;
    memoryTotalGb: number;
    memoryFreeGb: number;
    memoryUsedPercent: number | null;
  };
  uptimeSeconds: number;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

const AUTONOMY_META: Record<AutonomyLevel, { label: string; desc: string; color: string; active: string }> = {
  view: {
    label: '👁️ ดูอย่างเดียว',
    desc: 'AI อ่านข้อมูลได้อย่างเดียว — คำสั่ง action (blockIP / unblockIP / killProcess) ถูกปิดทั้งหมด',
    color: 'text-gray-400 border-gray-600',
    active: 'bg-gray-600 text-white',
  },
  suggest: {
    label: '🤝 แนะนำ + ขออนุมัติ',
    desc: 'AI เสนอคำสั่ง action แล้วรอ Superadmin อนุมัติก่อนดำเนินการ (ค่าเริ่มต้น)',
    color: 'text-amber-300 border-amber-600',
    active: 'bg-amber-600 text-white',
  },
  autonomous: {
    label: '⚡ ลงมือเอง',
    desc: 'AI ดำเนินการ action ทันที — ระบบยัง guard คำสั่งวิกฤตเสมอ (ห้าม block IP ตัวเอง / kill process ระบบ)',
    color: 'text-green-400 border-green-600',
    active: 'bg-green-600 text-white',
  },
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

export default function AiAgentPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const isSuperadmin = user?.role === 'SUPERADMIN';

  const [policy, setPolicy] = useState<AiPolicy | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // สถานะ + ทำงานกับ AI
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatLoaded, setChatLoaded] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // แท็บ: policy (เดิม) | team (ทีม Agent) | jobs (งานเบื้องหลัง) | coding (Coding Agent)
  const [tab, setTab] = useState<'policy' | 'team' | 'jobs' | 'coding'>('policy');

  // ── ทีม Agent + งานเบื้องหลัง ──
  const [roles, setRoles] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [roleForm, setRoleForm] = useState<Record<string, string>>({});
  const [runPrompt, setRunPrompt] = useState<Record<string, string>>({});
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [jobsLoading, setJobsLoading] = useState(false);

  // ── Coding Agent: เขียนโค้ดจากภาพรวม ──
  const [codingJobs, setCodingJobs] = useState<any[]>([]);
  const [codingTask, setCodingTask] = useState('');
  const [codingBusy, setCodingBusy] = useState(false);
  const [codingSuggestions, setCodingSuggestions] = useState<string[]>([]);
  const [codingDoneTask, setCodingDoneTask] = useState('');

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
        setMessage('✅ เพิ่มบทบาทแล้ว');
        setRoleForm({});
        await loadRoles();
      } else {
        setError(data?.error || 'เพิ่มบทบาทไม่สำเร็จ');
      }
    } catch {
      setError('เชื่อมต่อ Core API ไม่ได้');
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
        setMessage('✅ บันทึกบทบาทแล้ว');
        await loadRoles();
      }
    } catch {
      setError('เชื่อมต่อ Core API ไม่ได้');
    }
  };

  const deleteRole = async (id: string, name: string) => {
    if (!isSuperadmin) return;
    if (!window.confirm(`ลบบทบาท "${name}"? (งานที่รันอยู่จะถูกยกเลิกด้วย)`)) return;
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMessage('🗑️ ลบบทบาทแล้ว');
        await loadRoles();
      }
    } catch {
      setError('เชื่อมต่อ Core API ไม่ได้');
    }
  };

  const runRole = async (id: string) => {
    if (!isSuperadmin) return;
    const prompt = (runPrompt[id] || '').trim();
    if (!prompt) {
      setError('พิมพ์ภารกิจให้ agent ก่อนกดรัน');
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
        setMessage('🚀 ส่งงานให้ AI แล้ว — รันเบื้องหลัง ไปดูหน้าอื่นได้เลย (ป้ายมุมขวาล่างจะแจ้ง)' + (data?.job?.id ? ` · ID: ${data.job.id.slice(0, 8)}` : ''));
        setRunPrompt((prev) => ({ ...prev, [id]: '' }));
        setTab('jobs');
        await loadJobs();
      } else {
        setError(data?.error || 'สั่งงานไม่สำเร็จ');
      }
    } catch {
      setError('เชื่อมต่อ Core API ไม่ได้');
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
        setMessage('🛑 ยกเลิกงานแล้ว');
        await loadJobs();
      }
    } catch {
      setError('เชื่อมต่อ Core API ไม่ได้');
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
      setError('เชื่อมต่อ Core API ไม่ได้');
    }
  };

  // ── Coding Agent ──
  const loadCodingJobs = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/coding/jobs`);
      if (res.ok) {
        const data = await res.json();
        setCodingJobs(data.jobs || []);
      }
    } catch {
      // เงียบ
    }
  }, []);

  const startCoding = async () => {
    if (!isSuperadmin) return;
    const task = codingTask.trim();
    if (!task) {
      setError('พิมพ์ภาพรวมที่อยากให้ AI เขียนโค้ดก่อน');
      return;
    }
    setError('');
    setMessage('');
    setCodingBusy(true);
    setCodingSuggestions([]);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/coding/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage('🚀 ส่งงานเขียนโค้ดให้ AI แล้ว — รันเบื้องหลัง ไปดูหน้าอื่นได้เลย (อาจใช้เวลาหลายนาทีในเครื่อง CPU)');
        setCodingTask('');
        setTab('coding');
        await loadCodingJobs();
      } else {
        setError(data?.error || 'สั่งงานเขียนโค้ดไม่สำเร็จ');
      }
    } catch {
      setError('เชื่อมต่อ Core API ไม่ได้');
    } finally {
      setCodingBusy(false);
    }
  };

  const deleteCodingJob = async (id: string) => {
    if (!isSuperadmin) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/coding/jobs/${id}`, { method: 'DELETE' });
      if (res.ok) await loadCodingJobs();
    } catch {
      // เงียบ
    }
  };

  const fetchSuggestions = async (job: any) => {
    if (!job?.task) return;
    setCodingBusy(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/coding/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: job.task, summary: job.result || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCodingSuggestions(data.suggestions || []);
        setCodingDoneTask(job.id);
      }
    } catch {
      setError('สร้างข้อเสนอไม่สำเร็จ');
    } finally {
      setCodingBusy(false);
    }
  };

  // Poll งานเขียนโค้ด (เฉพาะแท็บ coding)
  useEffect(() => {
    if (tab !== 'coding') return;
    loadCodingJobs();
    const interval = setInterval(loadCodingJobs, 4000);
    return () => clearInterval(interval);
  }, [tab, loadCodingJobs]);

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

  const loadPolicy = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/policy`);
      if (res.ok) setPolicy(await res.json());
      else setError('โหลดนโยบาย AI ไม่สำเร็จ');
    } catch (err) {
      setError('เชื่อมต่อ Core API ไม่ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadApprovals = useCallback(async () => {
    if (!isSuperadmin) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/approvals`);
      if (res.ok) setApprovals(await res.json());
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

  const loadChatHistory = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/history?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setChatMsgs(data.history || []);
      }
    } catch (err) {
      // ประวัติใช้ไม่ได้ → เริ่มสนทนาใหม่
    } finally {
      setChatLoaded(true);
    }
  }, []);

  // เลื่อนลงล่างสุดอัตโนมัติเมื่อมีข้อความใหม่
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chatMsgs.length, chatLoading]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');
    setChatError('');
    setChatMsgs((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() }]);
    setChatLoading(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setChatMsgs((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: data.reply || '(ไม่มีคำตอบ)', created_at: new Date().toISOString() }]);
      } else {
        setChatError(data.error || `API error ${res.status}`);
      }
    } catch (err) {
      setChatError('เชื่อมต่อ Core API ไม่ได้');
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadPolicy();
    loadApprovals();
    loadStatus();
    if (!chatLoaded) loadChatHistory();
    const interval = setInterval(() => {
      loadPolicy();
      loadApprovals();
      loadStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [isHydrated, isAuthenticated, loadPolicy, loadApprovals, loadStatus, loadChatHistory, chatLoaded]);

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
        setMessage(`✅ เปลี่ยนระดับ autonomy เป็น "${AUTONOMY_META[next].label}" แล้ว`);
        await loadPolicy();
      } else {
        setError(data?.error || 'เปลี่ยน autonomy ไม่สำเร็จ');
      }
    } catch (err) {
      setError('เชื่อมต่อ Core API ไม่ได้');
    }
  };

  const decideApproval = async (id: string, action: 'approve' | 'reject') => {
    if (action === 'approve') {
      const ok = window.confirm('อนุมัติให้ AI ดำเนินการคำสั่งนี้ทันที?\n\nคำสั่งที่กำลังจะทำงานจริงบนระบบ — ตรวจสอบให้แน่ใจ');
      if (!ok) return;
    } else {
      const ok = window.confirm('ปฏิเสธคำสั่งนี้?');
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
          ? `✅ อนุมัติแล้ว: ${data?.result || 'ดำเนินการสำเร็จ'}`
          : '🚫 ปฏิเสธคำสั่งแล้ว');
        await loadApprovals();
      } else {
        setError(data?.reason || data?.error || `ไม่สามารถ${action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}ได้`);
        await loadApprovals();
      }
    } catch (err) {
      setError('เชื่อมต่อ Core API ไม่ได้');
    } finally {
      setBusyId(null);
    }
  };

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
      <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ความปลอดภัย"
          title="🤖 SOVEREIGN OS"
          subtitle="AI Agent Control" actions={<a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>}
        />
      </header>

      {/* ── แท็บ: นโยบาย / ทีม Agent / งานเบื้องหลัง ── */}
      <div className="max-w-5xl mx-auto px-6 pt-4 flex gap-2 flex-wrap">
        {([
          ['policy', '🛡️ นโยบาย + อนุมัติ'],
          ['team', '🤖 ทีม Agent'],
          ['coding', '💻 Coding Agent'],
          ['jobs', '🔄 งานเบื้องหลัง'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-t-lg text-sm font-bold border-b-2 transition ${
              tab === key
                ? 'bg-gray-900 border-green-500 text-green-300'
                : 'bg-gray-800/40 border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <main className="max-w-5xl mx-auto p-6 pt-4 space-y-6">
        {message && <div className="p-3 rounded text-sm bg-green-900/30 text-green-400 border border-green-800">{message}</div>}
        {error && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400 border border-red-800">{error}</div>}

        {tab === 'policy' && (
          <>

        {/* ── สถานะ AI: โมเดล + ทรัพยากร ── */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold">⚙️ สถานะ AI Agent</h2>
            <span className={`text-xs px-2 py-1 rounded font-bold ${status?.ollamaOnline ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
              {status ? (status.ollamaOnline ? '🟢 Ollama ออนไลน์' : '🔴 Ollama ออฟไลน์') : '⏳ ตรวจสอบ...'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500">🧠 โมเดลที่ใช้</div>
              <div className="font-bold text-green-300 break-all">{status?.currentModel || '—'}</div>
              <div className="text-[10px] text-gray-600 break-all">{status?.ollamaUrl}</div>
            </div>
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500">📦 โมเดลในเครื่อง</div>
              <div className="font-bold text-white">{status?.models?.length ?? '—'} ตัว</div>
              <div className="text-[10px] text-gray-600">{(status?.models || []).slice(0, 3).map((m) => m.name).join(', ') || '—'}</div>
            </div>
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500">💻 CPU</div>
              <div className="font-bold text-cyan-300">{status?.resources.cpuUsagePercent != null ? `${status.resources.cpuUsagePercent}%` : '—'}</div>
              <div className="text-[10px] text-gray-600">{status?.resources.cpuCores ?? '—'} cores</div>
            </div>
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2">
              <div className="text-xs text-gray-500">🧮 RAM</div>
              <div className="font-bold text-amber-300">{status?.resources.memoryUsedPercent != null ? `${status.resources.memoryUsedPercent}%` : '—'}</div>
              <div className="text-[10px] text-gray-600">{status ? `${status.resources.memoryFreeGb} / ${status.resources.memoryTotalGb} GB ว่าง` : '—'}</div>
            </div>
          </div>
        </section>

        {/* ── ทำงานกับ AI: แชท ── */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold">💬 ทำงานกับ AI</h2>
          <p className="text-xs text-gray-500">
            ถามได้ทุกเรื่อง — ตรวจข้อมูลเซ็นเซอร์ / หาคู่มือจากคลังความรู้ / สั่ง block IP หรือ kill process (ขึ้นกับระดับ autonomy)
          </p>

          <div className="h-72 overflow-y-auto space-y-3 bg-gray-950/50 border border-gray-800 rounded-lg p-3">
            {chatMsgs.length === 0 && chatLoaded && (
              <div className="text-gray-600 text-sm text-center py-10">
                ยังไม่มีข้อความ — พิมพ์ด้านล่างเพื่อเริ่มคุยกับ AI
              </div>
            )}
            {chatMsgs.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-emerald-900/40 border border-emerald-800 text-emerald-100'
                      : 'bg-gray-800 border border-gray-700 text-gray-200'
                  }`}
                >
                  {m.content}
                  <div className="text-[9px] text-gray-500 mt-1">{new Date(m.created_at).toLocaleTimeString('th-TH')}</div>
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="text-gray-500 text-sm">🤔 AI กำลังคิด...</div>
            )}
            <div ref={chatEndRef} />
          </div>
          {chatError && <p className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded p-2">{chatError}</p>}
          <div className="flex flex-wrap gap-1.5">
            {['🔋 แบตเตอรี่เหลือเท่าไหร่', '💧 ระดับน้ำตอนนี้', '🛡️ ตรวจสอบการเชื่อมต่อ', '📚 หาคู่มือการปลูกผัก'].map((q) => (
              <button
                key={q}
                onClick={() => { setChatInput(q.split(' ').slice(1).join(' ')); }}
                className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full transition"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              placeholder="ถาม เช่น แบตเตอรี่เหลือเท่าไหร่? หรือ block IP 1.2.3.4"
              className="flex-1 bg-gray-800 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-500"
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-bold"
            >
              {chatLoading ? '⏳...' : 'ส่ง 🚀'}
            </button>
          </div>
        </section>

        {/* ── ระดับ Autonomy ── */}
        <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-bold">⚖️ ระดับ Autonomy</h2>
            {!isSuperadmin && (
              <span className="text-xs px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-400">
                🔒 เปลี่ยนได้เฉพาะ SUPERADMIN
              </span>
            )}
          </div>

          {!policy && loading ? (
            <div className="text-gray-500 text-sm">⏳ กำลังโหลดนโยบาย...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(Object.keys(AUTONOMY_META) as AutonomyLevel[]).map((level) => {
                const meta = AUTONOMY_META[level];
                const active = policy?.autonomy === level;
                return (
                  <button
                    key={level}
                    onClick={() => changeAutonomy(level)}
                    disabled={!isSuperadmin}
                    title={isSuperadmin ? `ตั้งเป็น ${meta.label}` : 'เฉพาะ SUPERADMIN เท่านั้น'}
                    className={`text-left p-4 rounded-xl border transition ${
                      active
                        ? `border-2 ${meta.active} shadow-lg`
                        : `bg-gray-800/50 border ${meta.color} opacity-90 hover:opacity-100`
                    } ${!isSuperadmin ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <div className="font-bold text-sm">{meta.label}</div>
                    <div className={`text-xs mt-1 leading-relaxed ${active ? 'opacity-90' : 'text-gray-400'}`}>
                      {meta.desc}
                    </div>
                    {active && <div className="text-[10px] mt-2 opacity-80">✓ กำลังใช้งานอยู่</div>}
                  </button>
                );
              })}
            </div>
          )}

          {/* ข้อมูล guard */}
          {policy && (
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400">🛡️ IP ที่ห้าม block:</span>
                {policy.protectedIps.length === 0 ? (
                  <span className="text-gray-600">(ไม่มีเพิ่มเติม — ระบบกัน loopback / IP ตัวเองให้อัตโนมัติ)</span>
                ) : (
                  policy.protectedIps.map((ip) => (
                    <span key={ip} className="px-2 py-0.5 rounded bg-red-900/40 border border-red-800 text-red-300">{ip}</span>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-400">🧩 Process ที่ห้าม kill:</span>
                {policy.protectedProcesses.length === 0 ? (
                  <span className="text-gray-600">(ระบบมีรายชื่อ process สำคัญให้อัตโนมัติ)</span>
                ) : (
                  policy.protectedProcesses.map((p) => (
                    <span key={p} className="px-2 py-0.5 rounded bg-red-900/40 border border-red-800 text-red-300">{p}</span>
                  ))
                )}
              </div>
              <div className="text-gray-500">
                ⏱️ คำขออนุมัติหมดอายุอัตโนมัติภายใน {(policy.approvalTtlMs / 60000).toFixed(0)} นาที
              </div>
            </div>
          )}
        </section>

        {/* ── สิทธิ์ของ Tool ── */}
        {policy && (
          <section className="bg-gray-900 border border-gray-700 rounded-xl overflow-x-auto">
            <h2 className="text-lg font-bold p-4 border-b border-gray-700">🧰 สิทธิ์ของ Tool</h2>
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Tool</th>
                  <th className="px-4 py-3">ประเภท</th>
                  <th className="px-4 py-3">คำอธิบาย</th>
                  <th className="px-4 py-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {policy.tools.map((t) => (
                  <tr key={t.name} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 font-bold text-green-300">{t.name}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          t.kind === 'action'
                            ? 'bg-amber-900/50 text-amber-300'
                            : 'bg-blue-900/50 text-blue-300'
                        }`}
                      >
                        {t.kind === 'action' ? 'ACTION' : 'READ-ONLY'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400">{t.description}</td>
                    <td className="px-4 py-2">
                      {t.available ? (
                        <span className="text-xs text-green-400">✓ ใช้ได้</span>
                      ) : (
                        <span className="text-xs text-red-400">✗ ถูกปิด (โหมด view)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── คำขออนุมัติ ── */}
        {isSuperadmin ? (
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">🛡️ คำขออนุมัติ Action ({pending.length})</h2>

            {pending.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-6 border border-dashed border-gray-700 rounded-lg">
                ไม่มีคำขอรออนุมัติ — AI จะแจ้งที่นี่เมื่อต้องการ blockIP / unblockIP / killProcess ในโหมด suggest
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => decideApproval(a.id, 'approve')}
                        disabled={busyId === a.id}
                        className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold transition disabled:opacity-50"
                      >
                        {busyId === a.id ? '⏳...' : '✅ อนุมัติ'}
                      </button>
                      <button
                        onClick={() => decideApproval(a.id, 'reject')}
                        disabled={busyId === a.id}
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
                      {history.slice(0, 20).map((a) => (
                        <tr key={a.id} className="text-gray-400">
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(a.decidedAt)}</td>
                          <td className="py-2 pr-3 text-gray-300">{a.tool}</td>
                          <td className="py-2 pr-3 font-mono text-gray-500">{fmtArgs(a.args).replace(/\s+/g, ' ')}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                a.status === 'approved'
                                  ? 'bg-green-900/50 text-green-300'
                                  : 'bg-red-900/50 text-red-300'
                              }`}
                            >
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
          </section>
        ) : (
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 className="text-lg font-bold">🛡️ คำขออนุมัติ Action</h2>
            <div className="text-sm text-gray-500 mt-2">
              🔒 เฉพาะ SUPERADMIN เท่านั้นที่เห็นและตัดสินใจคำขออนุมัติของ AI agent
            </div>
          </section>
        )}
          </>
        )}

        {/* ── แท็บ: ทีม Agent — กำหนดบทบาท กี่คน ทำงานอะไร ── */}
        {tab === 'team' && (
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold">🤖 ทีม Agent</h2>
                <p className="text-xs text-gray-500 mt-1">
                  กำหนดบทบาทให้ AI แบ่งเบาภาระ — แต่ละบทบาทอ่านข้อมูลของตัวเองและตอบกลับเป็นภาษาไทย
                </p>
              </div>
              {isSuperadmin && (
                <button
                  onClick={async () => {
                    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/agent/roles/seed`, { method: 'POST' });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok) {
                      setMessage(data.seeded > 0 ? `✅ ใส่บทบาทเริ่มต้น ${data.seeded} บทบาทแล้ว` : 'บทบาทเริ่มต้นมีอยู่แล้ว');
                      await loadRoles();
                    }
                  }}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs"
                >
                  ↩️ คืนค่าเริ่มต้น
                </button>
              )}
            </div>

            {/* ฟอร์มเพิ่มบทบาท */}
            {isSuperadmin && (
              <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                <div className="text-xs font-bold text-gray-300">➕ เพิ่มบทบาทใหม่</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input value={roleForm.name || ''} onChange={(e) => setRoleForm((p) => ({ ...p, name: e.target.value }))} placeholder="ชื่อบทบาท เช่น ผู้ดูแลระบบน้ำ" className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                  <input value={roleForm.emoji || ''} onChange={(e) => setRoleForm((p) => ({ ...p, emoji: e.target.value }))} placeholder="อีโมจิ 💧" className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                  <input value={roleForm.description || ''} onChange={(e) => setRoleForm((p) => ({ ...p, description: e.target.value }))} placeholder="ทำงานอะไร เช่น เฝ้าระวังคุณภาพน้ำ" className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm md:col-span-2" />
                  <select value={roleForm.capability || 'general'} onChange={(e) => setRoleForm((p) => ({ ...p, capability: e.target.value }))} className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm">
                    {[['inventory', '📦 เสบียง'], ['farm', '🌱 ฟาร์ม'], ['risk', '🛡️ ความเสี่ยง'], ['health', '🩺 สุขภาพ'], ['water', '💧 ระบบน้ำ'], ['knowledge', '📚 คลังความรู้'], ['kids', '🧒 สอนลูก'], ['general', '⚙️ ทั่วไป']].map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <input value={roleForm.count || ''} onChange={(e) => setRoleForm((p) => ({ ...p, count: e.target.value }))} type="number" min={1} placeholder="จำนวน agent" className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                </div>
                <textarea value={roleForm.system_prompt || ''} onChange={(e) => setRoleForm((p) => ({ ...p, system_prompt: e.target.value }))} placeholder="บุคลิก/วิธีทำงาน (system prompt) เช่น คุณคือผู้ดูแลระบบน้ำ อ่านข้อมูลแล้วสรุปความเสี่ยง" rows={2} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                <button onClick={createRole} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-bold">➕ เพิ่ม</button>
              </div>
            )}

            {/* รายการบทบาท */}
            {roles.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-8 border border-dashed border-gray-700 rounded-lg">
                ยังไม่มีบทบาท — กด "↩️ คืนค่าเริ่มต้น" หรือเพิ่มด้วยตัวเอง
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {roles.map((r) => (
                  <div key={r.id} className={`border rounded-xl p-3 space-y-2 ${r.enabled ? 'border-gray-700 bg-gray-800/40' : 'border-gray-800 bg-gray-900/40 opacity-60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0">{r.emoji || '🤖'}</span>
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate">{r.name}</div>
                          <div className="text-[10px] text-gray-500">capability: {r.capability} · {r.count} คน</div>
                        </div>
                      </div>
                      {isSuperadmin && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => updateRole(r.id, { enabled: !r.enabled })}
                            title={r.enabled ? 'ปิดบทบาท' : 'เปิดบทบาท'}
                            className={`text-xs px-2 py-1 rounded border ${r.enabled ? 'bg-green-900/40 border-green-700 text-green-300' : 'bg-gray-800 border-gray-600 text-gray-500'}`}
                          >
                            {r.enabled ? 'เปิด' : 'ปิด'}
                          </button>
                          <button
                            onClick={() => deleteRole(r.id, r.name)}
                            className="text-xs px-2 py-1 rounded bg-red-900/40 border border-red-800 text-red-300"
                          >
                            🗑️
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{r.description}</p>
                    {isSuperadmin && (
                      <>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span className="shrink-0">👥 จำนวน:</span>
                          <input
                            type="number"
                            min={1}
                            defaultValue={r.count}
                            onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 1); if (v !== r.count) updateRole(r.id, { count: v }); }}
                            className="w-16 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs"
                          />
                          <span className="text-gray-600">คน (แบ่งเบาภาระ)</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={r.daily_report !== false}
                              onChange={(e) => updateRole(r.id, { daily_report: e.target.checked })}
                              className="accent-emerald-500"
                            />
                            📨 สรุปรายวันส่ง Telegram
                          </label>
                          <select
                            value={r.report_hour ?? 7}
                            onChange={(e) => updateRole(r.id, { report_hour: Number(e.target.value) })}
                            title="เวลาที่ส่งสรุป (ทุกเช้า)"
                            className="bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-[10px]"
                          >
                            {Array.from({ length: 12 }, (_, i) => 6 + i).map((h) => (
                              <option key={h} value={h}>{h}:00</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    {/* รันงานตอนนี้ */}
                    <div className="flex gap-1.5 items-center pt-1">
                      <input
                        value={runPrompt[r.id] || ''}
                        onChange={(e) => setRunPrompt((p) => ({ ...p, [r.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && runRole(r.id)}
                        placeholder="ภารกิจ เช่น ตรวจเสบียงน้ำวันนี้..."
                        disabled={!isSuperadmin || !r.enabled}
                        className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs disabled:opacity-50"
                      />
                      <button
                        onClick={() => runRole(r.id)}
                        disabled={!isSuperadmin || !r.enabled || teamBusy === r.id}
                        className="shrink-0 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold disabled:opacity-40"
                      >
                        {teamBusy === r.id ? '⏳...' : '▶️ รันเบื้องหลัง'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── แท็บ: Coding Agent — พิมพ์ภาพรวมครั้งเดียว → AI เขียนโค้ดให้เสร็จ ── */}
        {tab === 'coding' && (
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-lg font-bold">💻 Coding Agent</h2>
              <p className="text-xs text-gray-500 mt-1">
                พิมพ์ภาพรวมครั้งเดียว — AI วางแผน → เขียนโค้ดทุกไฟล์ → ตรวจงาน → เสนอทางต่อ 2-4 ตัวเลือก ทำงานเบื้องหลัง (อาจใช้เวลาหลายนาทีในเครื่อง CPU)
              </p>
            </div>

            <div className="bg-gray-950/50 border border-gray-800 rounded-xl p-4 space-y-2">
              <textarea
                value={codingTask}
                onChange={(e) => setCodingTask(e.target.value)}
                rows={4}
                placeholder="เช่น สร้าง REST API จัดการงานบ้านของลูกเป็นภาษา TypeScript พร้อม auth และทดสอบครบ ใช้ Express + Prisma"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] text-gray-500">💡 ระบุภาษา/เฟรมเวิร์ก/ไฟล์ที่ต้องการ เพื่อผลลัพธ์ที่ตรงขึ้น</p>
                <button
                  onClick={startCoding}
                  disabled={codingBusy || !isSuperadmin}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm font-bold transition-all"
                >
                  {codingBusy ? '⏳...' : '🚀 ให้ AI เขียนโค้ดเลย'}
                </button>
              </div>
            </div>

            {codingSuggestions.length > 0 && (
              <div className="bg-emerald-900/20 border border-emerald-700 rounded-xl p-4 space-y-2">
                <p className="text-sm font-bold text-emerald-300">💡 อยากทำอะไรต่อ? (AI คิดให้แล้ว)</p>
                <div className="flex flex-wrap gap-2">
                  {codingSuggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setCodingTask(s); setCodingSuggestions([]); }}
                      className="px-3 py-1.5 bg-gray-900 border border-emerald-700 text-emerald-200 hover:bg-emerald-900/40 rounded-lg text-xs transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {codingJobs.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-8 border border-dashed border-gray-700 rounded-lg">
                ยังไม่มีงานเขียนโค้ด — พิมพ์ภาพรวมด้านบนแล้วกด "🚀 ให้ AI เขียนโค้ดเลย"
              </div>
            ) : (
              <div className="space-y-3">
                {codingJobs.map((j) => {
                  const active = j.status === 'queued' || j.status === 'running';
                  let plan: any = null;
                  let files: Array<{ path: string; content: string }> = [];
                  let review: Array<{ severity: string; message: string }> = [];
                  try { plan = typeof j.plan_json === 'string' ? JSON.parse(j.plan_json) : j.plan_json; } catch { /* noop */ }
                  try {
                    const parsed = typeof j.files_json === 'string' ? JSON.parse(j.files_json) : j.files_json;
                    if (Array.isArray(parsed)) files = parsed;
                  } catch { /* noop */ }
                  try {
                    const res = typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
                    if (res?.review) review = res.review;
                  } catch { /* noop */ }
                  return (
                    <div key={j.id} className={`border rounded-xl p-4 space-y-2 ${active ? 'border-emerald-700 bg-emerald-900/10' : j.status === 'error' ? 'border-red-800 bg-red-900/10' : 'border-gray-700 bg-gray-800/40'}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg">💻</span>
                          <span className="font-bold text-sm truncate max-w-[240px]">{j.title}</span>
                          <span className="text-[10px] text-gray-500">{new Date(j.created_at).toLocaleString('th-TH')}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            j.status === 'done' ? 'bg-green-900/50 text-green-300' :
                            j.status === 'error' ? 'bg-red-900/50 text-red-300' :
                            'bg-emerald-900/60 text-emerald-300 animate-pulse'
                          }`}>
                            {j.status === 'queued' ? '⏳ วางแผน...' : j.status === 'running' ? `⚙️ กำลังเขียนโค้ด (${j.progress}%)` : j.status === 'done' ? '✅ เสร็จ' : '❌ พลาด'}
                          </span>
                          {isSuperadmin && !active && (
                            <button onClick={() => deleteCodingJob(j.id)} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-500">🗑️</button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 bg-gray-950/40 border border-gray-800 rounded px-2 py-1.5">📋 {j.task}</div>
                      {(j.status === 'queued' || j.status === 'running') && (
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.max(5, j.progress)}%` }} />
                        </div>
                      )}
                      {j.status === 'done' && plan && (
                        <div className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5">
                          📐 <span className="font-bold">{plan.title}</span> — {plan.files?.length ?? 0} ไฟล์
                        </div>
                      )}
                      {j.status === 'done' && files.length > 0 && (
                        <div className="space-y-2">
                          <details className="bg-gray-950/60 border border-gray-800 rounded-lg">
                            <summary className="px-3 py-2 text-xs font-bold cursor-pointer hover:bg-gray-800/40">📄 โค้ดที่สร้าง ({files.length} ไฟล์)</summary>
                            <div className="px-3 pb-3 space-y-2">
                              {files.map((f) => (
                                <div key={f.path}>
                                  <p className="text-[10px] text-green-400 font-mono">{f.path}</p>
                                  <pre className="text-[10px] text-gray-300 bg-gray-950 rounded p-2 overflow-x-auto max-h-40">{f.content.slice(0, 2000)}</pre>
                                </div>
                              ))}
                            </div>
                          </details>
                          <details className="bg-gray-950/60 border border-gray-800 rounded-lg">
                            <summary className="px-3 py-2 text-xs font-bold cursor-pointer hover:bg-gray-800/40">🔍 ผลตรวจงาน ({review.length} รายการ)</summary>
                            <div className="px-3 pb-3 space-y-1">
                              {review.map((r, i) => (
                                <p key={i} className={`text-[10px] ${r.severity === 'error' ? 'text-red-400' : r.severity === 'warning' ? 'text-amber-300' : 'text-gray-400'}`}>
                                  {r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'} {r.message}
                                </p>
                              ))}
                            </div>
                          </details>
                        </div>
                      )}
                      {j.status === 'done' && (
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <button
                            onClick={() => fetchSuggestions(j)}
                            disabled={codingBusy}
                            className="px-3 py-1.5 bg-emerald-800/60 hover:bg-emerald-700/60 border border-emerald-700 rounded-lg text-xs font-semibold transition-all"
                          >
                            {codingBusy && codingDoneTask === j.id ? '⏳ คิดอยู่...' : '💡 AI คิดต่อให้ (2-4 ตัวเลือก)'}
                          </button>
                        </div>
                      )}
                      {j.status === 'error' && (
                        <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-2 py-1.5">❌ {j.error}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── แท็บ: งานเบื้องหลัง — poll สถานะอัตโนมัติ ── */}
        {tab === 'jobs' && (
          <section className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold">🔄 งานเบื้องหลัง</h2>
                <p className="text-xs text-gray-500 mt-1">
                  งาน AI รันต่อแม้คุณเปิดหน้าอื่น — อัปเดตอัตโนมัติทุก 3 วินาที และมีป้ายแจ้งเตือนมุมขวาล่างของทุกหน้า
                </p>
              </div>
              <button onClick={loadJobs} disabled={jobsLoading} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs">
                {jobsLoading ? '⏳...' : '🔄 รีเฟรช'}
              </button>
            </div>

            {jobs.length === 0 ? (
              <div className="text-gray-500 text-sm text-center py-8 border border-dashed border-gray-700 rounded-lg">
                ยังไม่มีงาน — ไปแท็บ "🤖 ทีม Agent" แล้วสั่งงานบทบาทแรกสิ
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((j) => {
                  const active = j.status === 'queued' || j.status === 'running';
                  return (
                    <div key={j.id} className={`border rounded-xl p-4 space-y-2 ${active ? 'border-emerald-700 bg-emerald-900/10' : j.status === 'error' ? 'border-red-800 bg-red-900/10' : 'border-gray-700 bg-gray-800/40'}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg">{j.emoji || '🤖'}</span>
                          <span className="font-bold text-sm">{j.role_name}</span>
                          <span className="text-[10px] text-gray-500">{new Date(j.created_at).toLocaleString('th-TH')}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            j.status === 'done' ? 'bg-green-900/50 text-green-300' :
                            j.status === 'error' ? 'bg-red-900/50 text-red-300' :
                            j.status === 'cancelled' ? 'bg-gray-700 text-gray-400' :
                            'bg-emerald-900/60 text-emerald-300 animate-pulse'
                          }`}>
                            {j.status === 'queued' ? '⏳ รอคิว' : j.status === 'running' ? '⚙️ กำลังทำงาน' : j.status === 'done' ? '✅ เสร็จ' : j.status === 'error' ? '❌ พลาด' : '🛑 ยกเลิก'}
                          </span>
                          {isSuperadmin && active && (
                            <button onClick={() => cancelJob(j.id)} className="text-[10px] px-2 py-0.5 rounded bg-red-900/50 border border-red-800 text-red-300">ยกเลิก</button>
                          )}
                          {isSuperadmin && !active && (
                            <button onClick={() => deleteJob(j.id)} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-500">🗑️</button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 bg-gray-950/40 border border-gray-800 rounded px-2 py-1.5 whitespace-pre-wrap">
                        📋 {j.prompt}
                      </div>
                      {(j.status === 'queued' || j.status === 'running') && (
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.max(5, j.progress)}%` }} />
                        </div>
                      )}
                      {j.status === 'done' && j.result && (
                        <div className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {j.result}
                        </div>
                      )}
                      {j.status === 'error' && (
                        <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-2 py-1.5">
                          ❌ {j.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
      </div>
  );
}
