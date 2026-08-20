"use client";
// components/coding/CodingIde.tsx
// Coding Agent ในแบบ IDE: toolbar บน → กลาง 70% (สั่งงาน + ดูงาน/โค้ด) → ขวา 30% (แท็บ ไฟล์/งาน&คิว/โน้ต) → เทอร์มินัลล่าง (ย่อได้)
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { fmtLocale } from '../../lib/formatDate';
import Icon from '../ui/Icon';
import SkillQueuePanel from './SkillQueuePanel';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const EFFORT_LEVELS = [
  { key: '', label: 'อัตโนมัติ' },
  { key: 'low', label: 'น้อย' },
  { key: 'medium', label: 'ปานกลาง' },
  { key: 'high', label: 'มาก' },
  { key: 'full', label: 'เต็ม' },
];
const AUTONOMY_LEVELS = [
  { key: '', label: 'ตามค่าเริ่มต้น' },
  { key: 'manual', label: 'ทำตามสั่ง' },
  { key: 'semi', label: 'กึ่งอัตโนมัติ' },
  { key: 'auto', label: 'คิดเอง/ทำเอง' },
];

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  mtime: string;
}

// มุมมองโค้ดแบบมีเลขบรรทัด
function CodeView({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="flex font-mono text-[11px] leading-relaxed overflow-x-auto bg-gray-950/60 border border-gray-800 rounded-lg">
      <div className="text-right select-none text-gray-600 border-r border-gray-800 py-2 shrink-0 bg-gray-950/60">
        {lines.map((_, i) => (
          <div key={i} className="px-2 leading-relaxed">{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 px-3 py-2 text-gray-300 whitespace-pre min-w-0 leading-relaxed">{content}</pre>
    </div>
  );
}

export default function CodingIde() {
  const t = useLanguageStore((s) => s.t);
  const user = useAuthStore((s) => s.user);
  const isSuperadmin = user?.role === 'SUPERADMIN';

  // ── สถานะงานเขียนโค้ด ──
  const [models, setModels] = useState<string[]>([]);
  const [codingJobs, setCodingJobs] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string } | null>(null);
  const [codingTask, setCodingTask] = useState('');
  const [codingModel, setCodingModel] = useState(''); // '' = ค่าเริ่มต้นจาก env
  const [codingEffort, setCodingEffort] = useState(''); // low | medium | high | full
  const [codingAutonomy, setCodingAutonomy] = useState(''); // manual | semi | auto
  const [codingImage, setCodingImage] = useState<string | null>(null); // base64 รูปที่แนบ (ถ้ามี)
  const [codingBusy, setCodingBusy] = useState(false);
  const [codingSuggestions, setCodingSuggestions] = useState<string[]>([]);
  const [codingDoneTask, setCodingDoneTask] = useState('');
  const [applyBusy, setApplyBusy] = useState<string | null>(null); // job id ที่กำลัง apply ลงโปรเจ็ก
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // ── สถานะแท็บขวา + ไฟล์โปรเจ็ก ──
  const [drawerTab, setDrawerTab] = useState<'files' | 'jobs' | 'notes'>('files');
  const [projectPath, setProjectPath] = useState('');
  const [savingPath, setSavingPath] = useState(false);
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [browseError, setBrowseError] = useState('');

  // ── เทอร์มินัลล่าง ──
  const [termOpen, setTermOpen] = useState(false);
  const [termCmd, setTermCmd] = useState('');
  const [termOut, setTermOut] = useState<string[]>([]);
  const [termBusy, setTermBusy] = useState(false);
  const termEndRef = useRef<HTMLDivElement>(null);

  // ── โน้ต ──
  const [notes, setNotes] = useState<any[]>([]);
  const [noteInput, setNoteInput] = useState('');

  const loadModels = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/ai/status`);
      const data = await res.json();
      if (res.ok) setModels((data.models || []).map((m: any) => m.name));
    } catch {
      // เงียบ
    }
  }, []);

  const loadCodingJobs = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/coding/jobs`);
      if (res.ok) {
        const data = await res.json();
        setCodingJobs(data.jobs || []);
      }
    } catch {
      // เงียบ
    }
  }, []);

  const fileToBase64 = (file: File, cb: (b64: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const startCoding = async () => {
    if (!isSuperadmin) return;
    const task = codingTask.trim();
    if (!task) {
      setErr(t('aiAgent.coding.taskRequired', 'พิมพ์ภาพรวมที่อยากให้ AI เขียนโค้ดก่อน'));
      return;
    }
    setErr('');
    setMsg('');
    setCodingBusy(true);
    setCodingSuggestions([]);
    try {
      const res = await authFetch(`${API}/api/coding/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          model: codingModel,
          reasoningEffort: codingEffort,
          autonomy: codingAutonomy,
          imageBase64: codingImage || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(t('aiAgent.coding.sent', 'ส่งงานเขียนโค้ดให้ AI แล้ว — รันเบื้องหลัง ไปดูหน้าอื่นได้เลย (อาจใช้เวลาหลายนาทีในเครื่อง CPU)'));
        setCodingTask('');
        setCodingImage(null);
        setDrawerTab('jobs');
        await loadCodingJobs();
      } else {
        setErr(data?.error || t('aiAgent.coding.sendFailed', 'สั่งงานเขียนโค้ดไม่สำเร็จ'));
      }
    } catch {
      setErr(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    } finally {
      setCodingBusy(false);
    }
  };

  const applyCodingJob = async (id: string) => {
    if (!isSuperadmin) return;
    setApplyBusy(id);
    setErr('');
    setMsg('');
    try {
      const res = await authFetch(`${API}/api/coding/jobs/${id}/apply`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(t('aiAgent.coding.applyDone', 'เขียนไฟล์ลงโปรเจ็กแล้ว: {count} ไฟล์', { count: data.applied?.length ?? 0 }) + (data.skipped?.length ? t('aiAgent.coding.applySkipped', ' (ข้าม {n} — {names})', { n: data.skipped.length, names: data.skipped.join(', ') }) : ''));
        await loadCodingJobs();
      } else {
        setErr(data?.error || t('aiAgent.coding.applyFailed', 'เขียนไฟล์ลงโปรเจ็กไม่สำเร็จ'));
      }
    } catch {
      setErr(t('aiAgent.coreApiError', 'เชื่อมต่อ Core API ไม่ได้'));
    } finally {
      setApplyBusy(null);
    }
  };

  const deleteCodingJob = async (id: string) => {
    if (!isSuperadmin) return;
    try {
      const res = await authFetch(`${API}/api/coding/jobs/${id}`, { method: 'DELETE' });
      if (res.ok) await loadCodingJobs();
    } catch {
      // เงียบ
    }
  };

  const fetchSuggestions = async (job: any) => {
    if (!job?.task) return;
    setCodingBusy(true);
    try {
      const res = await authFetch(`${API}/api/coding/suggest`, {
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
      setErr(t('aiAgent.coding.suggestFailed', 'สร้างข้อเสนอไม่สำเร็จ'));
    } finally {
      setCodingBusy(false);
    }
  };

  // ── ไฟล์โปรเจ็ก ──
  const loadSettings = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/coding/workspace`);
      const data = await res.json();
      if (res.ok) setProjectPath(data.projectPath || '');
    } catch {
      /* เงียบ */
    }
  }, []);

  const listDir = useCallback(async (dir: string) => {
    setBrowseError('');
    try {
      const res = await authFetch(`${API}/api/coding/files?path=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.openDirFailed', 'เปิดโฟลเดอร์ไม่สำเร็จ'));
      setEntries(data.entries || []);
      setCwd(dir);
    } catch (errr: any) {
      setBrowseError(String(errr.message || errr));
    }
  }, [t]);

  const loadNotes = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/notes`);
      const data = await res.json();
      if (res.ok) setNotes(data.notes || []);
    } catch {
      /* เงียบ */
    }
  }, []);

  const savePath = async () => {
    setSavingPath(true);
    try {
      const res = await authFetch(`${API}/api/coding/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.changeFailed', 'เปลี่ยนไม่สำเร็จ'));
      await listDir('');
    } catch (errr: any) {
      setBrowseError(String(errr.message || errr));
    }
    setSavingPath(false);
  };

  const openFile = async (path: string) => {
    try {
      const res = await authFetch(`${API}/api/coding/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.readFileFailed', 'อ่านไฟล์ไม่สำเร็จ'));
      setPreviewFile({ path, content: data.content });
    } catch (errr: any) {
      setBrowseError(String(errr.message || errr));
    }
  };

  const runTerm = async () => {
    const cmd = termCmd.trim();
    if (!cmd || termBusy) return;
    setTermBusy(true);
    setTermOut((p) => [...p, `> ${cmd}`]);
    try {
      const res = await authFetch(`${API}/api/coding/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('aiAgent.coding.termFailed', 'รันคำสั่งไม่สำเร็จ'));
      setTermOut((p) => [...p, data.output]);
    } catch (errr: any) {
      setTermOut((p) => [...p, String(errr.message || errr)]);
    }
    setTermBusy(false);
    setTermCmd('');
  };

  const addNote = async () => {
    const text = noteInput.trim();
    if (!text) return;
    try {
      const res = await authFetch(`${API}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setNoteInput('');
        await loadNotes();
      }
    } catch {
      /* เงียบ */
    }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm(t('aiAgent.coding.deleteNoteConfirm', 'ลบโน้ตนี้?'))) return;
    try {
      await authFetch(`${API}/api/notes/${id}`, { method: 'DELETE' });
      await loadNotes();
    } catch {
      /* เงียบ */
    }
  };

  // โหลดครั้งแรก + poll งานเขียนโค้ดทุก 4 วิ
  useEffect(() => {
    loadModels();
    loadCodingJobs();
    loadSettings();
    listDir('');
    loadNotes();
    const interval = setInterval(loadCodingJobs, 4000);
    return () => clearInterval(interval);
  }, [loadModels, loadCodingJobs, loadSettings, listDir, loadNotes]);

  // เลือกงานล่าสุดอัตโนมัติถ้ายังไม่ได้เลือก (และกัน id ที่ถูกลบไปแล้ว)
  useEffect(() => {
    if (codingJobs.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !codingJobs.some((j) => j.id === selectedId)) {
      setSelectedId(codingJobs[0].id);
    }
  }, [codingJobs, selectedId]);

  // เปลี่ยนงาน → รีเซ็ตไฟล์ที่กำลังดู
  useEffect(() => {
    setActiveFile(null);
    setPreviewFile(null);
  }, [selectedId]);

  // เลื่อนเทอร์มินัลล่างสุดทุกครั้งที่มี output ใหม่
  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [termOut]);

  const selectedJob = codingJobs.find((j) => j.id === selectedId) || null;
  let plan: any = null;
  let files: Array<{ path: string; content: string }> = [];
  let review: Array<{ severity: string; message: string }> = [];
  if (selectedJob) {
    try { plan = typeof selectedJob.plan_json === 'string' ? JSON.parse(selectedJob.plan_json) : selectedJob.plan_json; } catch { /* noop */ }
    try {
      const parsed = typeof selectedJob.files_json === 'string' ? JSON.parse(selectedJob.files_json) : selectedJob.files_json;
      if (Array.isArray(parsed)) files = parsed;
    } catch { /* noop */ }
    try {
      const res = typeof selectedJob.result === 'string' ? JSON.parse(selectedJob.result) : selectedJob.result;
      if (res?.review) review = res.review;
    } catch { /* noop */ }
  }
  const active = selectedJob ? selectedJob.status === 'queued' || selectedJob.status === 'running' : false;
  const currentFile = activeFile && files.some((f) => f.path === activeFile) ? activeFile : files[0]?.path || null;

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* ── 1. Toolbar: โมเดล + เหตุผล + อัตโนมัติ + รูปภาพ ── */}
      <section className="card panel-glow px-4 py-2.5 flex-none">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <label className="text-gray-400">{t('aiAgent.coding.modelLabel', 'โมเดล')}</label>
          <select
            value={codingModel}
            onChange={(e) => setCodingModel(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            <option value="">{t('aiAgent.coding.defaultEnv', 'ค่าเริ่มต้น (env)')}</option>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <label className="text-gray-400 ml-1">{t('aiAgent.coding.effortLabel', 'เหตุผล')}</label>
          <div className="flex gap-1">
            {EFFORT_LEVELS.map((e) => (
              <button
                key={e.key}
                onClick={() => setCodingEffort(e.key)}
                title={e.key ? t('aiAgent.coding.effortTitle', 'ระดับการให้เหตุผล: {label}', { label: t(`aiAgent.effort.${e.key}`, e.label) }) : t('aiAgent.coding.defaultEffortTitle', 'ใช้ค่าของโมเดลเอง')}
                className={`px-2.5 py-1.5 rounded text-xs font-bold transition ${
                  codingEffort === e.key ? 'bg-emerald-600 text-white' : 'bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300'
                }`}
              >
                {e.key ? t(`aiAgent.effort.${e.key}`, e.label) : t('aiAgent.effort.auto', e.label)}
              </button>
            ))}
          </div>
          <label className="text-gray-400 ml-1">{t('aiAgent.coding.autonomyLabel', 'อัตโนมัติ')}</label>
          <select
            value={codingAutonomy}
            onChange={(e) => setCodingAutonomy(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            {AUTONOMY_LEVELS.map((a) => (
              <option key={a.key} value={a.key}>{t(a.key ? `aiAgent.autonomyLevel.${a.key}` : 'aiAgent.autonomyLevel.default', a.label)}</option>
            ))}
          </select>
          <label className="text-gray-400 ml-1">{t('aiAgent.coding.imageLabel', 'รูปภาพ')}</label>
          <button
            onClick={() => document.getElementById('coding-ide-image-input')?.click()}
            className={`px-2.5 py-1.5 rounded text-xs font-bold transition ${
              codingImage ? 'bg-emerald-600 text-white' : 'bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300'
            }`}
          >
            {codingImage ? t('aiAgent.coding.hasImage', 'มีรูปแล้ว') : t('aiAgent.coding.attachImage', 'แนบรูป')}
          </button>
          <input
            id="coding-ide-image-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) fileToBase64(f, (b64) => setCodingImage(b64));
              e.target.value = '';
            }}
          />
          {codingImage && (
            <button onClick={() => setCodingImage(null)} className="text-[10px] px-2 py-1 rounded bg-red-900/40 border border-red-800 text-red-300">{t('aiAgent.chat.removeImage', 'ลบรูป')}</button>
          )}
        </div>
        {codingImage && (
          <div className="flex items-center gap-2 mt-2">
            <img src={codingImage} alt={t('aiAgent.chat.imageAlt', 'แนบ')} className="h-12 w-12 object-cover rounded border border-gray-700" />
            <span className="text-[10px] text-gray-500">{t('aiAgent.coding.imagePlanNote', 'รูปนี้จะส่งให้ AI ดูตอนวางแผน (ต้องใช้โมเดลที่รองรับภาพ)')}</span>
          </div>
        )}
      </section>

      {/* ── 2. กลาง: main 70% + drawer 30% ── */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-3">
        {/* main workspace */}
        <main className="flex-[7] min-w-0 flex flex-col gap-3 min-h-0">
          {msg && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-800 text-xs flex-none">
              <span className="flex-1">{msg}</span>
              <button onClick={() => setMsg('')} className="text-gray-500"><Icon name="x" size={12} /></button>
            </div>
          )}
          {err && (
            <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-900/30 text-red-400 border border-red-800 text-xs flex-none">
              <span className="flex-1">{err}</span>
              <button onClick={() => setErr('')} className="text-gray-500"><Icon name="x" size={12} /></button>
            </div>
          )}

          {/* hero prompt */}
          <section className="card panel-glow p-4 space-y-3 flex-none">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('aiAgent.coding.title', 'สั่งงานเขียนโค้ด')}</h2>
              <button
                onClick={startCoding}
                disabled={codingBusy || !isSuperadmin}
                className="btn-primary"
              >
                <Icon name="sparkles" size={13} />
                {codingBusy ? t('aiAgent.coding.working', 'กำลังทำงาน...') : t('aiAgent.coding.writeCode', 'ให้ AI เขียนโค้ดเลย')}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">{t('aiAgent.coding.desc', 'ภาพรวมครั้งเดียว — AI วางแผน → เขียนโค้ดทุกไฟล์ → ตรวจงาน → เสนอทางต่อ (ทำงานเบื้องหลัง)')}</p>
            <textarea
              value={codingTask}
              onChange={(e) => setCodingTask(e.target.value)}
              rows={5}
              placeholder={t('aiAgent.coding.phTask', 'เช่น สร้าง REST API จัดการงานบ้านของลูกเป็นภาษา TypeScript พร้อม auth และทดสอบครบ ใช้ Express + Prisma')}
              className="input w-full font-mono"
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-gray-500">{t('aiAgent.coding.specHint', 'ระบุภาษา/เฟรมเวิร์ก/ไฟล์ที่ต้องการ')}</p>
              {codingJobs.length > 0 && (
                <span className="text-[10px] text-gray-600">{t('aiAgent.coding.ide.jobCount', '{n} งานในรายการ', { n: codingJobs.length })}</span>
              )}
            </div>
            {codingSuggestions.length > 0 && (
              <div className="space-y-2 border-t border-gray-800 pt-3">
                <p className="text-sm font-semibold text-emerald-300 glow-text">{t('aiAgent.coding.suggestionsTitle', 'อยากทำอะไรต่อ? (AI คิดให้แล้ว)')}</p>
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
          </section>

          {/* job detail / file viewer */}
          <section className="card panel-cyan flex-1 min-h-0 flex flex-col">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between gap-2 flex-none">
              {previewFile ? (
                <>
                  <span className="text-xs font-mono text-emerald-300 truncate flex items-center gap-1.5">
                    <Icon name="file" size={13} />
                    {previewFile.path}
                  </span>
                  <button onClick={() => setPreviewFile(null)} className="text-[10px] px-2 py-1 rounded bg-gray-800 border border-gray-600 text-gray-300">{t('common.close', 'ปิด')}</button>
                </>
              ) : selectedJob ? (
                <>
                  <span className="text-sm font-bold text-gray-200 truncate flex items-center gap-2">
                    <Icon name="code" size={15} className="text-gray-500 shrink-0" />
                    {selectedJob.title}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                      selectedJob.status === 'done' ? 'bg-emerald-900/50 text-emerald-300' :
                      selectedJob.status === 'error' ? 'bg-rose-900/50 text-rose-300' :
                      'bg-emerald-900/60 text-emerald-300 animate-pulse'
                    }`}>
                      {selectedJob.status === 'queued' ? t('aiAgent.coding.statusQueued', 'วางแผน...') : selectedJob.status === 'running' ? t('aiAgent.coding.statusRunning', 'กำลังเขียนโค้ด ({n}%)', { n: selectedJob.progress }) : selectedJob.status === 'done' ? t('aiAgent.coding.statusDone', 'เสร็จ') : t('aiAgent.coding.statusFailed', 'พลาด')}
                    </span>
                  </div>
                </>
              ) : (
                <span className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('aiAgent.coding.jobsTitle', 'งานเขียนโค้ด')}</span>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {previewFile ? (
                <CodeView content={previewFile.content} />
              ) : selectedJob ? (
                <>
                  <div className="text-xs text-gray-400 bg-gray-950/40 border border-gray-800 rounded px-2 py-1.5">{selectedJob.task}</div>
                  {(selectedJob.model || selectedJob.reasoning_effort || selectedJob.autonomy) && (
                    <div className="text-[10px] text-gray-500">
                      {selectedJob.model || t('aiAgent.coding.defaultLabel', 'ค่าเริ่มต้น')} · {selectedJob.reasoning_effort ? t(`aiAgent.effort.${selectedJob.reasoning_effort}`, selectedJob.reasoning_effort) : t('aiAgent.coding.defaultLabel', 'ค่าเริ่มต้น')} · {selectedJob.autonomy ? t(`aiAgent.autonomyLevel.${selectedJob.autonomy}`, selectedJob.autonomy) : t('aiAgent.coding.defaultLabel', 'ค่าเริ่มต้น')}
                    </div>
                  )}
                  {active && (
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.max(5, selectedJob.progress)}%` }} />
                    </div>
                  )}
                  {selectedJob.status === 'done' && plan && (
                    <div className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5">
                      <span className="font-bold">{plan.title}</span>{t('aiAgent.coding.planFiles', ' — {n} ไฟล์', { n: plan.files?.length ?? 0 })}
                    </div>
                  )}
                  {selectedJob.status === 'done' && files.length > 0 && (
                    <>
                      <div className="flex gap-1.5 flex-wrap">
                        {files.map((f) => (
                          <button
                            key={f.path}
                            onClick={() => setActiveFile(f.path)}
                            title={f.path}
                            className={`px-2.5 py-1 text-[10px] font-mono rounded border transition ${
                              currentFile === f.path ? 'bg-emerald-800/50 border-emerald-600 text-emerald-200' : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800'
                            }`}
                          >
                            {f.path.split('/').pop()}
                          </button>
                        ))}
                      </div>
                      <CodeView content={files.find((f) => f.path === currentFile)?.content || ''} />
                    </>
                  )}
                  {selectedJob.status === 'done' && review.length > 0 && (
                    <div className="bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2 space-y-1">
                      <p className="text-xs font-bold text-gray-300">{t('aiAgent.coding.reviewSummary', 'ผลตรวจงาน ({n} รายการ)', { n: review.length })}</p>
                      {review.map((r, i) => (
                        <p key={i} className={`text-[10px] ${r.severity === 'error' ? 'text-red-400' : r.severity === 'warning' ? 'text-amber-300' : 'text-gray-400'}`}>
                          {r.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {selectedJob.status === 'done' && (
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        onClick={() => fetchSuggestions(selectedJob)}
                        disabled={codingBusy}
                        className="px-3 py-1.5 bg-emerald-800/60 hover:bg-emerald-700/60 border border-emerald-700 rounded-lg text-xs font-semibold transition-all"
                      >
                        {codingBusy && codingDoneTask === selectedJob.id ? t('aiAgent.coding.thinking', 'กำลังคิดอยู่...') : t('aiAgent.coding.aiSuggest', 'AI คิดต่อให้ (2-4 ตัวเลือก)')}
                      </button>
                      <button
                        onClick={() => applyCodingJob(selectedJob.id)}
                        disabled={applyBusy === selectedJob.id}
                        className="px-3 py-1.5 bg-green-700/60 hover:bg-green-600/60 border border-green-700 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                      >
                        {applyBusy === selectedJob.id ? t('aiAgent.coding.applying', 'กำลังเขียนลงโปรเจ็ก...') : t('aiAgent.coding.applyToProject', 'Apply Diff — เขียนลงโปรเจ็ก')}
                      </button>
                      <button
                        onClick={() => { if (window.confirm(t('aiAgent.coding.ide.discardConfirm', 'Discard งานนี้? (ลบออกจากรายการ)'))) deleteCodingJob(selectedJob.id); }}
                        disabled={applyBusy === selectedJob.id}
                        className="px-3 py-1.5 bg-red-900/40 hover:bg-red-800/50 border border-red-800 rounded-lg text-xs font-semibold transition-all"
                      >
                        {t('aiAgent.coding.ide.discardJob', 'Discard')}
                      </button>
                    </div>
                  )}
                  {selectedJob.status === 'error' && (
                    <div className="text-xs text-red-300 bg-red-950/40 border border-red-800 rounded px-2 py-1.5">{selectedJob.error}</div>
                  )}
                </>
              ) : (
                <div className="text-gray-500 text-sm text-center py-10 border border-dashed border-gray-700 rounded-lg">
                  {t('aiAgent.coding.ide.viewHint', 'ยังไม่มีงานเขียนโค้ด — พิมพ์ภาพรวมด้านบนเพื่อให้ AI เขียนโค้ด, หรือเลือกงานจากแท็บ ⚡ ด้านขวา')}
                </div>
              )}
            </div>
          </section>
        </main>

        {/* drawer 30% */}
        <aside className="flex-[3] min-w-0 lg:max-w-[400px] card panel-cyan flex flex-col min-h-0">
          <div className="flex flex-none border-b border-gray-800">
            {([
              { key: 'files', emoji: '📁', label: t('aiAgent.coding.ide.tabFiles', 'ไฟล์') },
              { key: 'jobs', emoji: '⚡', label: t('aiAgent.coding.ide.tabJobs', 'งาน & คิว') },
              { key: 'notes', emoji: '📝', label: t('aiAgent.coding.ide.tabNotes', 'โน้ต') },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setDrawerTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition ${
                  drawerTab === tab.key ? 'bg-emerald-900/40 text-emerald-300 border-b-2 border-emerald-500' : 'text-gray-400 hover:bg-gray-800/50'
                }`}
              >
                <span>{tab.emoji}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {/* ── แท็บ: ไฟล์โปรเจ็ก ── */}
            {drawerTab === 'files' && (
              <div className="space-y-3">
                {browseError && <div className="p-2 rounded text-[11px] bg-red-900/30 text-red-400 border border-red-800">{browseError}</div>}
                <div className="flex gap-2">
                  <input
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder={t('aiAgent.workspace.phProjectPath', 'เช่น E:/My work/Project Sovereign Origin')}
                    className="input flex-1 font-mono"
                  />
                  <button
                    onClick={savePath}
                    disabled={savingPath || !projectPath.trim()}
                    className="btn-primary"
                  >
                    {savingPath ? t('common.saving', 'กำลังบันทึก...') : (
                      <>
                        <Icon name="save" size={13} />
                        {t('aiAgent.workspace.setPath', 'ตั้ง')}
                      </>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <button onClick={() => listDir('')} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded flex items-center gap-1"><Icon name="home" size={11} />root</button>
                  <span className="font-mono text-gray-300 truncate">/{cwd}</span>
                  <button onClick={() => listDir(cwd)} className="ml-auto px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded flex items-center gap-1"><Icon name="refresh" size={11} />{t('aiAgent.workspace.reload', 'โหลดใหม่')}</button>
                </div>
                <div className="inset p-2 max-h-[42vh] overflow-y-auto">
                  {entries.length === 0 && <p className="text-gray-500 text-xs text-center py-4">{t('aiAgent.workspace.emptyFolder', '(โฟลเดอร์ว่าง)')}</p>}
                  <div className="grid grid-cols-1 gap-0.5">
                    {entries.map((e) => (
                      <button
                        key={e.path}
                        onClick={() => (e.type === 'dir' ? listDir(e.path) : openFile(e.path))}
                        title={e.path}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 text-left"
                      >
                        <span className="text-gray-400 flex items-center shrink-0">
                          <Icon name={e.type === 'dir' ? 'folder' : 'file'} size={13} />
                        </span>
                        <span className="text-xs font-mono text-gray-200 truncate flex-1">{e.name}</span>
                        <span className="text-[9px] text-gray-500">{e.type === 'file' ? `${(e.size / 1024).toFixed(1)}KB` : ''}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── แท็บ: งาน & คิว ── */}
            {drawerTab === 'jobs' && (
              <div className="space-y-3">
                {codingJobs.length === 0 ? (
                  <div className="text-gray-500 text-xs text-center py-6 border border-dashed border-gray-700 rounded-lg">
                    {t('aiAgent.coding.noJobs', 'ยังไม่มีงานเขียนโค้ด — พิมพ์ภาพรวมด้านบนแล้วกด "ให้ AI เขียนโค้ดเลย"')}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {codingJobs.map((j) => {
                      const jActive = j.status === 'queued' || j.status === 'running';
                      return (
                        <div
                          key={j.id}
                          onClick={() => setSelectedId(j.id)}
                          className={`flex items-center gap-2 px-2.5 py-2 rounded cursor-pointer border transition ${
                            selectedId === j.id ? 'bg-emerald-900/30 border-emerald-700/70' : 'bg-gray-900/50 border-gray-800 hover:bg-gray-800/60'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full shrink-0 ${j.status === 'done' ? 'bg-emerald-500' : j.status === 'error' ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`} />
                          <span className="text-xs font-bold text-gray-200 truncate flex-1">{j.title}</span>
                          <span className="text-[9px] text-gray-500 shrink-0">{new Date(j.created_at).toLocaleString(fmtLocale())}</span>
                          {isSuperadmin && !jActive && (
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteCodingJob(j.id); }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-500 shrink-0"
                            >
                              <Icon name="trash" size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="border-t border-gray-800 pt-3">
                  <SkillQueuePanel models={models} compact />
                </div>
              </div>
            )}

            {/* ── แท็บ: โน้ต ── */}
            {drawerTab === 'notes' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addNote()}
                    placeholder={t('aiAgent.workspace.phNote', 'จดอะไรก็ได้ เช่น แนวคิด, งานค้าง, ลิงก์...')}
                    className="input flex-1"
                  />
                  <button onClick={addNote} disabled={!noteInput.trim()} className="btn-primary">
                    <Icon name="plus" size={13} />
                    {t('common.save', 'บันทึก')}
                  </button>
                </div>
                <div className="space-y-1.5">
                  {notes.length === 0 && <p className="text-gray-500 text-xs text-center py-4">{t('aiAgent.workspace.noNotes', 'ยังไม่มีโน้ต')}</p>}
                  {notes.map((n) => (
                    <div key={n.id} className="flex items-start gap-2 inset px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-200 whitespace-pre-wrap break-all">{n.content}</p>
                        <p className="text-[9px] text-gray-500 mt-1">{new Date(n.created_at).toLocaleString(fmtLocale())}</p>
                      </div>
                      <button onClick={() => deleteNote(n.id)} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-500"><Icon name="trash" size={11} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── 3. เทอร์มินัลล่าง (ย่อ/ขยาย) ── */}
      <section className="card panel-cyan overflow-hidden flex-none">
        <button
          onClick={() => setTermOpen(!termOpen)}
          className="w-full flex items-center gap-2 px-3 h-10 text-xs font-semibold text-gray-300 hover:bg-gray-800/50 transition"
          title={t('aiAgent.workspace.terminalTitle', 'เทอร์มินัล (รันคำสั่งในเครื่อง — cwd = โปรเจ็ก, กันคำสั่งอันตราย)')}
        >
          <Icon name="terminal" size={13} className="text-gray-400 shrink-0" />
          <span className="shrink-0">{t('aiAgent.coding.ide.terminalBar', 'เทอร์มินัล')}</span>
          <span className="flex-1 text-left font-mono text-[10px] text-gray-500 truncate min-w-0">
            {termOut.length > 0 ? termOut[termOut.length - 1] : t('aiAgent.workspace.terminalHint', '— พิมพ์คำสั่งด้านบน (PowerShell) —')}
          </span>
          <Icon name="chevron-down" size={12} className={`transition-transform shrink-0 ${termOpen ? 'rotate-180' : ''}`} />
        </button>
        {termOpen && (
          <div className="px-3 pb-3 space-y-2">
            <div className="flex gap-2">
              <input
                value={termCmd}
                onChange={(e) => setTermCmd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runTerm()}
                placeholder={t('aiAgent.workspace.phCommand', 'เช่น git status หรือ dir')}
                className="input flex-1 font-mono"
              />
              <button
                onClick={runTerm}
                disabled={termBusy || !termCmd.trim()}
                className="btn-secondary"
              >
                {termBusy ? t('aiAgent.workspace.running', 'กำลังรัน...') : (
                  <>
                    <Icon name="play" size={13} />
                    {t('common.run', 'รัน')}
                  </>
                )}
              </button>
            </div>
            <div className="bg-black border border-gray-800 rounded-lg p-2 h-32 overflow-y-auto font-mono text-[11px] text-emerald-300 space-y-1 log-stream">
              {termOut.length === 0 && <p className="text-gray-600">{t('aiAgent.workspace.terminalHint', '— พิมพ์คำสั่งด้านบน (PowerShell) —')}</p>}
              {termOut.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))}
              <div ref={termEndRef} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
