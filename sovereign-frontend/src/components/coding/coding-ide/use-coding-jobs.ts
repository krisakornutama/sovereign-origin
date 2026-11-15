// ── Coding Agent: งานเขียนโค้ด + พรอมป์ + โมเดล/effort/autonomy (ย้ายจาก CodingIde.tsx verbatim — FE-007) ──
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../../lib/apiFetch';
import { useLanguageStore } from '../../../stores/useLanguageStore';
import { API } from '../coding-ide-shared';

export function useCodingJobs(params: {
  isSuperadmin: boolean;
  setDrawerTab: (tab: 'files' | 'jobs' | 'notes') => void;
}) {
  const { isSuperadmin, setDrawerTab } = params;
  const t = useLanguageStore((s) => s.t);

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

  // โหลดครั้งแรก + poll งานเขียนโค้ดทุก 4 วิ (ส่วน workspace/โน้ตโหลดใน hook ของตัวเอง)
  useEffect(() => {
    loadModels();
    loadCodingJobs();
    const interval = setInterval(loadCodingJobs, 4000);
    return () => clearInterval(interval);
  }, [loadModels, loadCodingJobs]);

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

  return {
    models, codingJobs, selectedId, setSelectedId, activeFile, setActiveFile, previewFile, setPreviewFile,
    codingTask, setCodingTask, codingModel, setCodingModel, codingEffort, setCodingEffort,
    codingAutonomy, setCodingAutonomy, codingImage, setCodingImage, codingBusy, codingSuggestions,
    setCodingSuggestions, codingDoneTask, applyBusy, msg, setMsg, err, setErr,
    startCoding, applyCodingJob, deleteCodingJob, fetchSuggestions, fileToBase64,
  };
}
