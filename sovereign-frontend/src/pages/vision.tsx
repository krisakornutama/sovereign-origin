"use client";
// P3 — Vision AI: วิเคราะห์ภาพจากกล้อง/อัปโหลด ด้วย qwen3-vl (Ollama ท้องถิ่น)
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { authFetch } from '../lib/apiFetch';
import { useAuthStore } from '../stores/useAuthStore';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

interface VisionLabel {
  object_type: string;
  confidence: number | null;
  bbox: [number, number, number, number] | null;
  note: string | null;
}

interface VisionResult {
  summary: string;
  labels: VisionLabel[];
  model: string;
  saved: number;
  savedEvents: Array<{ id: string; object_type: string; confidence: number | null; detected_at: string }>;
  raw: string;
}

interface Camera { id: string; name: string; location: string | null; }
interface HistoryRow { id: string; object_type: string; confidence: number | null; detected_at: string; camera: { name: string } | null; }

const OBJECT_LABEL: Record<string, string> = {
  person: 'คน',
  vehicle: 'ยานพาหนะ',
  animal: 'สัตว์',
  venomous: 'สัตว์มีพิษ',
  other: 'อื่น ๆ',
};

function confColor(conf: number | null): string {
  if (conf == null) return 'bg-gray-800 border-gray-600 text-gray-400';
  if (conf >= 0.8) return 'bg-emerald-900/40 border-emerald-600 text-emerald-300';
  if (conf >= 0.5) return 'bg-amber-900/40 border-amber-600 text-amber-300';
  return 'bg-gray-800 border-gray-600 text-gray-300';
}

export default function VisionPage() {
  const { isAuthenticated, isHydrated, token } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  // ── คนแปลกหน้า: ใบหน้าคุ้นเคย + กฎ + ตรวจ + ประวัติแจ้งเตือน ──
  const [faces, setFaces] = useState<any[]>([]);
  const [faceForm, setFaceForm] = useState<{ name: string; photoUrl: string; note: string; photoData: string; dhash: string; photoPreview: string }>({ name: '', photoUrl: '', note: '', photoData: '', dhash: '', photoPreview: '' });
  const [faceEmbedding, setFaceEmbedding] = useState<'loading' | 'ready' | 'waiting' | 'none'>('waiting');
  const [rule, setRule] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [checkResult, setCheckResult] = useState<string>('');
  const [checking, setChecking] = useState(false);

  const loadFaces = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/known-faces`);
      if (res.ok) { const d = await res.json(); setFaces(d.faces || []); }
    } catch { /* ไม่บังคับ */ }
  };
  const loadRule = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/rule`);
      if (res.ok) { const d = await res.json(); setRule(d.rule); }
    } catch { /* ไม่บังคับ */ }
  };
  const loadAlerts = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/alerts`);
      if (res.ok) { const d = await res.json(); setAlerts(d.alerts || []); }
    } catch { /* ไม่บังคับ */ }
  };

  // dHash (perceptual hash) — คำนวณในเบราว์เซอร์ ไม่ต้องพึ่งเซิร์ฟเวอร์ decode ภาพ
  const computeDhash = (img: HTMLImageElement): string => {
    const w = 9, h = 8;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const grays: number[] = [];
    for (let i = 0; i < data.length; i += 4) grays.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
    let hex = '';
    for (let y = 0; y < h; y++) {
      let byte = 0;
      for (let x = 0; x < w - 1; x++) {
        byte = (byte << 1) | (grays[y * w + x] > grays[y * w + x + 1] ? 1 : 0);
      }
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  };

  // ลดขนาดภาพ (สูงสุด ~512px) → dataURL + dhash — ใช้ทั้งตอนอัปโหลดและถ่ายจากกล้อง
  const processFaceImage = (dataUrl: string, maxSize = 512): Promise<{ dataUrl: string; dhash: string }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          const ctx = c.getContext('2d')!;
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const dhash = computeDhash(img);
          resolve({ dataUrl: c.toDataURL('image/jpeg', 0.85), dhash });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error(t('vision.imgReadFail', 'อ่านรูปไม่ได้')));
      img.src = dataUrl;
    });

  // ── อัปโหลดรูปจากเครื่อง ──
  const onFaceFile = async (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { dataUrl, dhash } = await processFaceImage(String(reader.result));
        setFaceForm((p) => ({ ...p, photoData: dataUrl, dhash, photoPreview: dataUrl }));
        setFaceEmbedding('waiting');
        setError(null);
      } catch {
        setError(t('vision.errReadImage', 'อ่านรูปไม่ได้ — ลองไฟล์ jpg/png'));
      }
    };
    reader.readAsDataURL(f);
  };

  // ── ถ่ายจากกล้อง (ใช้ URL snapshot เช่น http://กล้อง/snapshot.jpg) ──
  const captureFaceFromCamera = async () => {
    const src = (url || '').trim();
    if (!src) { setError(t('vision.errUrlSnapshot', 'ใส่ URL snapshot กล้องก่อน (ในช่อง "หรือ URL snapshot กล้อง")')); return; }
    setError(null);
    setFaceEmbedding('loading');
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error(t('vision.imgCamReadFail', 'อ่านภาพกล้องไม่ได้')));
        r.readAsDataURL(blob);
      });
      const { dataUrl: small, dhash } = await processFaceImage(dataUrl);
      setFaceForm((p) => ({ ...p, photoData: small, dhash, photoPreview: small }));
      setFaceEmbedding('waiting');
    } catch {
      setError(t('vision.errFetchCamera', 'ไม่สามารถดึงภาพจากกล้องได้ — ตรวจ URL snapshot'));
    } finally {
      setFaceEmbedding('waiting');
    }
  };

  const addFace = async () => {
    if (!faceForm.name.trim()) { setError(t('vision.errNameRequired', 'ใส่ชื่อคนก่อน (เช่น พ่อ, แม่, ลุงสมชาย)')); return; }
    setError(null);
    setFaceEmbedding('loading');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/known-faces`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: faceForm.name,
          photoUrl: faceForm.photoUrl,
          photoData: faceForm.photoData || undefined,
          dhash: faceForm.dhash || undefined,
          note: faceForm.note,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t('vision.errAddFace', 'เพิ่มใบหน้าไม่สำเร็จ'));
      setFaceEmbedding(d.embedding_ready ? 'ready' : 'none');
      setFaceForm({ name: '', photoUrl: '', note: '', photoData: '', dhash: '', photoPreview: '' });
      await loadFaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vision.errGeneric', 'เกิดข้อผิดพลาด'));
      setFaceEmbedding('waiting');
    }
  };

  const removeFace = async (id: string) => {
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/known-faces/${id}`, { method: 'DELETE' });
      await loadFaces();
    } catch { /* ไม่บังคับ */ }
  };

  const saveRule = async (patch: Record<string, unknown>) => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/rule`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t('vision.errSetRule', 'ตั้งกฎไม่สำเร็จ'));
      setRule(d.rule);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vision.errGeneric', 'เกิดข้อผิดพลาด'));
    }
  };

  const runCheck = async () => {
    setChecking(true);
    setCheckResult('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t('vision.errCheck', 'ตรวจไม่สำเร็จ'));
if (d.skipped === 'disabled') setCheckResult(t('vision.checkDisabled', 'กฎปิดอยู่ — เปิดก่อน'));
      else if (d.skipped === 'not_due') setCheckResult(t('vision.checkNotDue', 'ยังไม่ถึงรอบตรวจถัดไป'));
      else if (d.skipped === 'no_image') setCheckResult(t('vision.checkNoImage', 'ไม่มีภาพล่าสุด — อัปโหลดภาพหรือรอ DetectionEvent ที่มีภาพ'));
      else if (d.alerted) setCheckResult(`${d.message || t('vision.checkAlerted', 'พบคนแปลกหน้า! แจ้งเตือนแล้ว')}`);
      else setCheckResult(t('vision.checkDone', 'ตรวจแล้ว — คนในภาพ {persons}, คนแปลกหน้า {strangers}', { persons: d.persons ?? 0, strangers: d.strangers ?? 0 }));
      await loadAlerts();
    } catch (err) {
      setCheckResult(`${err instanceof Error ? err.message : t('vision.errCheck', 'ตรวจไม่สำเร็จ')}`);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    loadCameras();
    loadHistory();
    loadFaces();
    loadRule();
    loadAlerts();
  }, []);

  const loadCameras = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/infrastructure/cameras`);
      if (res.ok) setCameras(await res.json());
    } catch { /* ไม่บังคับ */ }
  };

  const loadHistory = async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/history?limit=30`);
      if (res.ok) setHistory(await res.json());
    } catch { /* ไม่บังคับ */ }
  };

  useEffect(() => {
    loadCameras();
    loadHistory();
  }, []);

  const onPickFile = (f: File | null) => {
    setFile(f);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };

  const analyze = async () => {
    if (loading) return;
    if (!file && !url.trim()) { setError(t('vision.errSelectFile', 'เลือกไฟล์ภาพหรือป้อน URL กล้องก่อน')); return; }
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};

      if (file) {
        const form = new FormData();
        form.append('image', file as Blob);
        if (cameraId) form.append('camera_id', cameraId);
        const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/analyze`, { method: 'POST', body: form });
        headers['Content-Type'] = 'application/json';
        if (!res.ok) {
          const b = await res.json().catch(() => null);
          throw new Error(b?.detail || b?.error || `API error ${res.status}`);
        }
        setResult(await res.json());
      } else {
        headers['Content-Type'] = 'application/json';
        const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/analyze-url`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: url.trim(), camera_id: cameraId || null }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => null);
          throw new Error(b?.detail || b?.error || `API error ${res.status}`);
        }
        setResult(await res.json());
      }
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vision.errGeneric', 'เกิดข้อผิดพลาด'));
    } finally {
      setLoading(false);
    }
  };

  if (!isHydrated || !isAuthenticated || !token) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
        <div className="text-sm text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow={t('vision.eyebrow', 'ความปลอดภัย')}
          title={t('vision.title', 'Vision AI')}
          icon={<Icon name="vision" size={18} />}
          subtitle={t('vision.subtitle', 'Computer Vision — qwen3-vl ท้องถิ่น (ภาพไม่ขึ้น cloud)')} actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('vision.backDashboard', '← กลับ Dashboard')}</Link>}
        />
      </header>

        <main className="max-w-5xl mx-auto p-6 space-y-6 w-full">
          {/* ── วิเคราะห์ภาพ ── */}
          <section className="card panel-glow p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('vision.analyzeTitle', 'วิเคราะห์ภาพ')}</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div className="space-y-2">
                <label className="text-xs text-gray-400 block">{t('vision.uploadLabel', 'อัปโหลดภาพ (สูงสุด 10MB, jpg/png/webp)')}</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600"
                />
                {previewUrl && (
                  <img src={previewUrl} alt={t('vision.altPreview', 'preview')} className="max-h-56 rounded-lg border border-gray-700 object-contain bg-black" />
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-400 block">{t('vision.orUrlLabel', 'หรือ URL snapshot กล้อง (http://กล้อง/snapshot.jpg)')}</label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://192.168.1.50/snapshot.jpg"
                  className="w-full bg-gray-800 border border-gray-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                />
                <div className="space-y-1">
                  <label className="text-xs text-gray-400 block">{t('vision.cameraLabel', 'กล้อง (ไม่บังคับ — บันทึกเหตุการณ์ได้)')}</label>
                  <select
                    value={cameraId}
                    onChange={(e) => setCameraId(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
                  >
                    <option value="">{t('vision.noRecord', '— ไม่บันทึก —')}</option>
                    {cameras.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.location ? ` (${c.location})` : ''}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={analyze}
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? t('vision.analyzing', 'AI กำลังดูภาพ...') : t('vision.analyze', 'วิเคราะห์')}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded p-3">{error}</p>}
          </section>

          {/* ── ผลลัพธ์ ── */}
          {result && (
            <section className="card panel-cyan p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">
                {t('vision.resultTitle', 'ผลการวิเคราะห์')}
                <span className="text-xs text-gray-500 ml-2">{t('vision.modelLabel', 'model: {model}', { model: result.model })}</span>
                {result.savedEvents.length > 0 && (
                  <span className="text-xs text-blue-400 ml-2">{t('vision.savedEvents', 'บันทึกเหตุการณ์แล้ว {n} รายการ', { n: result.savedEvents.length })}</span>
                )}
              </h2>
              {result.summary && (
                <div className="p-4 rounded-xl bg-cyan-900/15 border border-cyan-800 text-cyan-200 whitespace-pre-line text-sm leading-relaxed">
                  {result.summary}
                </div>
              )}
              {result.labels.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {result.labels.map((l, i) => (
                    <span key={i} className={`px-3 py-1.5 rounded-lg border text-sm font-bold ${confColor(l.confidence)}`}>
                      {t(`vision.obj.${l.object_type}`, OBJECT_LABEL[l.object_type] || l.object_type)}
                      {l.confidence != null ? ` ${(l.confidence * 100).toFixed(0)}%` : ''}
                      {l.note ? <span className="font-normal opacity-70 ml-1">({l.note})</span> : null}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">{t('vision.noObjects', 'ไม่พบวัตถุที่ตรวจจับได้ — ตรวจสอบภาพว่าชัดพอไหม')}</p>
              )}
            </section>
          )}

          {/* ── ประวัติ ── */}
          <section className="card panel-cyan p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('vision.historyTitle', 'ประวัติการตรวจจับ')}</h2>
            {history.length === 0 ? (
              <p className="text-sm text-gray-500">{t('vision.noHistory', 'ยังไม่มีเหตุการณ์ — วิเคราะห์ภาพโดยเลือกกล้องเพื่อบันทึก')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-700">
                    <th className="py-2 pr-3">{t('common.time', 'เวลา')}</th>
                    <th className="py-2 pr-3">{t('vision.colCamera', 'กล้อง')}</th>
                    <th className="py-2 pr-3">{t('vision.colType', 'ประเภท')}</th>
                    <th className="py-2">{t('vision.colConfidence', 'ความเชื่อมั่น')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-gray-800">
                      <td className="py-2 pr-3 text-gray-400">{new Date(h.detected_at).toLocaleString(fmtLocale())}</td>
                      <td className="py-2 pr-3">{h.camera?.name ?? '—'}</td>
                      <td className="py-2 pr-3">{t(`vision.obj.${h.object_type}`, OBJECT_LABEL[h.object_type] || h.object_type)}</td>
                      <td className="py-2">{h.confidence != null ? `${(h.confidence * 100).toFixed(0)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ── คนแปลกหน้า: ใบหน้าคุ้นเคย + กฎ + ตรวจ + แจ้งเตือน ── */}
          <section className="card p-5 space-y-4 !border-amber-800/70 shadow-neon-red">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('vision.strangerTitle', 'ระบบคนแปลกหน้า (Vision Guard)')}</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {t('vision.strangerDesc', 'ลงทะเบียนใบหน้าที่คุ้นเคย → โมเดลจำภาพ (qwen3-vl) เทียบทุกครั้งที่เจอคน → แจ้งเตือน Telegram เมื่อเจอคนแปลกหน้า')}
                </p>
              </div>
              <button onClick={runCheck} disabled={checking} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded text-sm font-bold">
                {checking ? t('vision.checking', 'กำลังตรวจ...') : t('vision.checkNow', 'ตรวจทันที')}
              </button>
            </div>
            {checkResult && <div className="text-xs text-gray-200 bg-gray-950/60 border border-cyan-800/50 rounded px-3 py-2 whitespace-pre-wrap">{checkResult}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* ใบหน้าที่คุ้นเคย */}
              <div className="inset panel-cyan p-3 space-y-2">
                <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('vision.familiarFaces', 'ใบหน้าที่คุ้นเคย ({n})', { n: faces.length })}</h3>
                <p className="text-[10px] text-gray-500">{t('vision.faceDesc1', 'ลงทะเบียนด้วยรูปจริง (อัปโหลด/ถ่ายจากกล้อง) — ระบบสร้าง')} <b>{t('vision.faceDescBold', 'embedding ลายเซ็นใบหน้า')}</b> {t('vision.faceDesc2', 'ครั้งเดียว แล้วเทียบความคล้ายเชิงตัวเลขโดยไม่ต้องพึ่ง AI ทุกครั้ง')}</p>
                <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                  {faces.length === 0 && <div className="text-[11px] text-gray-600">{t('vision.noFaces', 'ยังไม่มี — เพิ่มคนในครอบครัว/คนรู้จัก เพื่อให้ระบบจำใบหน้าได้')}</div>}
                  {faces.map((f) => {
                    const hasEmbed = Array.isArray(f.embedding) && f.embedding.length > 0;
                    const thumb = f.photo_data || f.photo_url;
                    return (
                      <div key={f.id} className="flex items-center gap-2 text-[11px] bg-gray-800/50 border border-gray-700 rounded px-2 py-1">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt={f.name} className="w-7 h-7 rounded object-cover shrink-0" />
                        ) : (
                          <span className="shrink-0 flex items-center"><Icon name="users" size={14} className="text-gray-500" /></span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-gray-200">{f.name}{f.note ? ` — ${f.note}` : ''}</div>
                          <div className="text-[9px]">
                            {hasEmbed ? <span className="text-emerald-400">{t('vision.embedReady', 'embedding พร้อม ({method})', { method: f.embed_method === 'image-embed' ? 'CLIP' : t('vision.signature', 'ลายเซ็น') })}</span>
                              : f.dhash ? <span className="text-cyan-400">{t('vision.dhashReady', 'dhash พร้อม')}</span>
                              : <span className="text-amber-500">{t('vision.noSignature', 'ยังไม่มีลายเซ็น')}</span>}
                            {f.dhash && <span className="text-gray-600 ml-1" title={t('vision.dhashTitle', 'dhash {dhash}', { dhash: f.dhash })}>· {f.dhash.slice(0, 6)}…</span>}
                          </div>
                        </div>
                        <button onClick={() => removeFace(f.id)} className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  <input value={faceForm.name} onChange={(e) => setFaceForm((p) => ({ ...p, name: e.target.value }))} placeholder={t('vision.namePlaceholder', 'ชื่อ เช่น พ่อ, แม่, ลุงสมชาย')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs" />
                  <div className="flex items-center gap-2">
                    <label className="flex-1 cursor-pointer bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-center hover:bg-gray-700 inline-flex items-center justify-center gap-1">
                      <Icon name="upload" size={12} />
                      {t('vision.uploadPhoto', 'อัปโหลดรูป')}
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFaceFile(e.target.files?.[0] ?? null)} />
                    </label>
                    <button onClick={captureFaceFromCamera} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-center hover:bg-gray-700 inline-flex items-center justify-center gap-1"><Icon name="camera" size={12} /> {t('vision.captureFromCamera', 'ถ่ายจากกล้อง')}</button>
                  </div>
                  {faceForm.photoPreview && (
                    <div className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={faceForm.photoPreview} alt={t('vision.altSample', 'ตัวอย่าง')} className="w-14 h-14 rounded object-cover" />
                      <span className="text-[10px] text-gray-400">
                        {t('vision.photoReady', 'ได้รูปแล้ว · dhash {dhash}…{extra}', { dhash: faceForm.dhash.slice(0, 8), extra: faceEmbedding === 'loading' ? t('vision.embeddingLoading', ' · กำลังสร้าง embedding (Ollama อุ่นเครื่อง อาจนานครั้งแรก)') : '' })}
                      </span>
                    </div>
                  )}
                  <input value={faceForm.note} onChange={(e) => setFaceForm((p) => ({ ...p, note: e.target.value }))} placeholder={t('vision.notePlaceholder', 'หมายเหตุ (ไม่บังคับ)')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs" />
                  <button onClick={addFace} disabled={faceEmbedding === 'loading'} className="btn-primary">
                    {faceEmbedding === 'loading' ? t('vision.creatingEmbedding', 'กำลังสร้าง embedding...') : t('vision.addFamiliar', 'เพิ่มคนคุ้นเคย')}
                  </button>
                </div>
              </div>

              {/* กฎการเฝ้าระวัง */}
              <div className="inset p-3 space-y-2">
                <h3 className="text-sm font-semibold text-gray-200">{t('vision.surveillanceRule', 'กฎการเฝ้าระวัง')}</h3>
                {rule && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => saveRule({ enabled: e.target.checked })} className="accent-amber-500" />
                      {t('vision.autoWatch', 'เปิดเฝ้าระวังอัตโนมัติ (ตรวจทุก {n} นาที)', { n: rule.interval_min })}
                    </label>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="shrink-0">{t('vision.every', 'ตรวจทุก')}</span>
                      <select value={rule.interval_min} onChange={(e) => saveRule({ interval_min: Number(e.target.value) })} className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs">
                        {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{t('vision.minutes', '{n} นาที', { n: m })}</option>)}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={rule.only_strangers} onChange={(e) => saveRule({ only_strangers: e.target.checked })} className="accent-amber-500" />
                      {t('vision.onlyStrangers', 'แจ้งเฉพาะคนแปลกหน้า (ปิด = แจ้งทุกครั้งที่เจอคน)')}
                    </label>
                    <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={rule.notify_telegram} onChange={(e) => saveRule({ notify_telegram: e.target.checked })} className="accent-amber-500" />
                      {t('vision.notifyTelegram', 'ส่งแจ้งเตือนไปยัง Telegram')}
                    </label>
                  </>
                )}
              </div>
            </div>

            {/* ประวัติแจ้งเตือน */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-200 glow-text-red">{t('vision.alertHistory', 'ประวัติแจ้งเตือน ({n})', { n: alerts.length })}</h3>
              {alerts.length === 0 ? (
                <div className="text-[11px] text-gray-600 border border-dashed border-gray-800 rounded p-3">
                  {t('vision.noAlerts', 'ยังไม่มีแจ้งเตือน — เมื่อเจอคนที่เข้าเงื่อนไข ระบบจะจับภาพ ส่ง Telegram และบันทึกไว้ที่นี่')}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 log-stream">
                  {alerts.map((a) => (
                    <div key={a.id} className={`flex items-start gap-2 text-[11px] rounded px-2 py-1.5 border ${a.cleared ? 'bg-gray-900 border-gray-800 text-gray-500' : 'bg-red-950/40 border-red-800 text-red-200'}`}>
                      <span className="shrink-0 flex items-center"><Icon name="alerts" size={12} /></span>
                      <div className="flex-1 min-w-0">
                        <div className="whitespace-pre-wrap">{a.message}</div>
                        <div className="text-[9px] text-gray-500">{new Date(a.created_at).toLocaleString(fmtLocale())}{a.cleared ? t('vision.handledSuffix', ' · จัดการแล้ว') : ''}</div>
                      </div>
                      {!a.cleared && (
                        <button
                          onClick={async () => { await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vision/alerts/${a.id}/clear`, { method: 'POST' }); loadAlerts(); }}
                          className="shrink-0 px-2 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-300 text-[10px]"
                        >
{t('vision.handled', 'จัดการแล้ว')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}