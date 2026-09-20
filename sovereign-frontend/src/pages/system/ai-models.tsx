"use client";
// ────────────────────────────────────────────────────────────────────────────
// AI Model Manager — Ollama Control System (เฉพาะ SUPERADMIN)
// VRAM/Storage gauge · Task Assignment Matrix · Model Repository · Pull/GGUF Hub
// ต่อ /api/v1/ai/* — pull ใช้ fetch stream (NDJSON) เพื่อส่ง Bearer header ได้
// ────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsSuperadmin } from '../../lib/roles';
import { useAuthStore } from '../../stores/useAuthStore';
import { authFetch } from '../../lib/apiFetch';
import Sidebar from '../../components/layout/Sidebar';
import PageHeader from '../../components/ui/PageHeader';
import Icon from '../../components/ui/Icon';
import EmptyState from '../../components/ui/EmptyState';
import { useLanguageStore } from '../../stores/useLanguageStore';

interface OllamaModel {
  name: string; size: number; digest?: string; modified_at?: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}
interface LoadedModel { name: string; size_vram: number; expires_at?: string }
interface Routes { CODING_AGENT: string; VISION_AI: string; REASONING_GOVERNOR: string; GENERAL_ASSISTANT: string }
interface InventoryResp {
  models: OllamaModel[]; loaded: LoadedModel[];
  storage: { totalBytes: number; modelCount: number }; vramBytes: number;
  routes: Routes | null; taskTypes: string[]; engineUp: boolean; engineUrl: string;
  error?: string;
}

const TASK_LABEL: Record<string, { th: string; icon: string; desc: string }> = {
  CODING_AGENT: { th: 'Coding Agent', icon: 'code', desc: 'เขียนโค้ด / แก้ไฟล์' },
  VISION_AI: { th: 'Vision AI', icon: 'vision', desc: 'ตรวจภาพ / ใบหน้า' },
  REASONING_GOVERNOR: { th: 'Reasoning Governor', icon: 'governance', desc: 'วิเคราะห์ / ตัดสินใจ' },
  GENERAL_ASSISTANT: { th: 'General Assistant', icon: 'ai', desc: 'แชท / สรุปทั่วไป' },
};

const PRESETS = [
  { model: 'qwen2.5-coder:7b', label: 'Qwen2.5 Coder 7B', size: '~4.7 GB', task: 'Coding' },
  { model: 'qwen2.5-vl:7b', label: 'Qwen2.5 VL 7B', size: '~6 GB', task: 'Vision' },
  { model: 'deepseek-r1:14b', label: 'DeepSeek-R1 14B', size: '~9 GB', task: 'Reasoning' },
  { model: 'qwen2.5:7b', label: 'Qwen2.5 7B', size: '~4.7 GB', task: 'General' },
];

const GB = 1024 ** 3;
const fmtGb = (b: number) => `${(b / GB).toFixed(1)} GB`;
const API = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/ai`;

function Gauge({ label, used, total, unit, color }: { label: string; used: number; total: number; unit: string; color: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] tracking-widest font-mono text-gray-500 uppercase">{label}</span>
        <span className="mono text-xs font-bold" style={{ color }}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}66` }} />
      </div>
      <div className="mono text-[10px] text-gray-500 mt-1.5">{used.toFixed(1)} / {total.toFixed(1)} {unit}</div>
    </div>
  );
}

export default function AiModelsPage() {
  const { user, isAuthenticated, isHydrated, token } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [inv, setInv] = useState<InventoryResp | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pullModelName, setPullModelName] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ status: string; percent: number }>({ status: '', percent: 0 });
  const [ggufName, setGgufName] = useState('');
  const [ggufUrl, setGgufUrl] = useState('');
  const [ggufPrompt, setGgufPrompt] = useState('');
  const [ggufJob, setGgufJob] = useState<{ id: string; status: string; phase: string; percent: number; error?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isSuper = useIsSuperadmin();

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/models`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setInv(data); setLoadErr('');
    } catch (e: any) {
      setLoadErr(e.message || 'โหลดข้อมูลไม่สำเร็จ');
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated && isSuper) load();
  }, [isHydrated, isAuthenticated, isSuper, load]);

  // poll import job ระหว่างรัน
  useEffect(() => {
    if (!ggufJob || ggufJob.status === 'done' || ggufJob.status === 'error') return;
    const iv = setInterval(async () => {
      try {
        const res = await authFetch(`${API}/jobs/${ggufJob.id}`);
        if (!res.ok) return;
        const j = await res.json();
        setGgufJob({ id: j.id, status: j.status, phase: j.phase, percent: j.progress?.percent ?? 0, error: j.error });
        if (j.status === 'done' || j.status === 'error') load();
      } catch { /* poll ต่อไป */ }
    }, 1200);
    return () => clearInterval(iv);
  }, [ggufJob, load]);

  const flash = (type: 'ok' | 'err', text: string) => { setMsg({ type, text }); window.setTimeout(() => setMsg(null), 5000); };

  // ── pull: อ่าน NDJSON stream ด้วย fetch reader (EventSource ส่ง Bearer ไม่ได้) ──
  const startPull = async (model: string) => {
    if (pullModelName) return;
    setPullModelName(model);
    setPullProgress({ status: 'เริ่มต้น…', percent: 0 });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`${API}/models/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = ''; let lastErr = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const o = JSON.parse(line);
            if (o.error) lastErr = o.error;
            setPullProgress({ status: o.status || '', percent: o.percent ?? 0 });
          } catch { /* ข้ามบรรทัดเสีย */ }
        }
      }
      if (lastErr) flash('err', lastErr);
      else flash('ok', `ดาวน์โหลด ${model} เสร็จแล้ว`);
      load();
    } catch (e: any) {
      if (e.name !== 'AbortError') flash('err', e.message);
    } finally {
      setPullModelName(null); abortRef.current = null;
    }
  };

  const setRoute = async (taskType: string, model: string) => {
    setBusy(`route:${taskType}`);
    try {
      const res = await authFetch(`${API}/models/route`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskType, model }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setInv((p) => (p ? { ...p, routes: { ...p.routes!, [taskType]: model } } : p));
      flash('ok', `${TASK_LABEL[taskType]?.th || taskType} → ${model}`);
    } catch (e: any) { flash('err', e.message); }
    finally { setBusy(''); }
  };

  const unload = async (name: string) => {
    setBusy(`unload:${name}`);
    try {
      const res = await authFetch(`${API}/models/${encodeURIComponent(name)}/unload`, { method: 'POST' });
      if (!res.ok) throw new Error('unload ไม่สำเร็จ');
      flash('ok', `ปล่อย VRAM ของ ${name} แล้ว`);
      load();
    } catch (e: any) { flash('err', e.message); }
    finally { setBusy(''); }
  };

  const remove = async (name: string) => {
    if (!window.confirm(t('aiModels.confirmDelete', 'ลบโมเดล "{name}" ถาวร? (น้ำหนักหลาย GB จะหาย)', { name }))) return;
    setBusy(`del:${name}`);
    try {
      const res = await authFetch(`${API}/models/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('ลบไม่สำเร็จ');
      flash('ok', `ลบ ${name} แล้ว`);
      load();
    } catch (e: any) { flash('err', e.message); }
    finally { setBusy(''); }
  };

  const startGgufImport = async () => {
    if (!ggufName.trim() || !ggufUrl.trim()) return flash('err', 'กรอกชื่อโมเดลและ URL ให้ครบ');
    try {
      const res = await authFetch(`${API}/models/import-gguf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName: ggufName.trim(), ggufUrl: ggufUrl.trim(), systemPrompt: ggufPrompt.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'เริ่ม job ไม่สำเร็จ');
      setGgufJob({ id: d.jobId, status: 'queued', phase: '-', percent: 0 });
    } catch (e: any) { flash('err', e.message); }
  };

  if (!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500 text-sm">{t('common.loading', 'กำลังโหลด...')}</div>;
  if (!isAuthenticated || !user) return <div className="text-white p-8">Unauthorized</div>;

  const loadedMap = new Map((inv?.loaded ?? []).map((l) => [l.name, l]));
  const diskUsed = inv?.storage.totalBytes ?? 0;
  const vramUsed = inv?.vramBytes ?? 0;
  const diskBudget = 100; // GB โชว์เทียบงบดิสก์โดยประมาณ
  const vramBudget = 24;  // GB — ปรับได้ตามการ์ดจอ

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-6xl mx-auto w-full">
          <PageHeader
            eyebrow={t('aiModels.eyebrow', 'ระบบ')}
            title={t('aiModels.title', 'AI Model Manager')}
            subtitle={t('aiModels.subtitle', 'Ollama Control System — ดาวน์โหลด / import GGUF / จัดสรรโมเดลต่องาน / ปล่อย VRAM')}
            icon={<Icon name="cpu" size={18} />}
          />

          {msg && (
            <div className={`text-sm rounded-lg px-4 py-2.5 border ${msg.type === 'ok' ? 'text-emerald-300 bg-emerald-950/40 border-emerald-800/50' : 'text-rose-300 bg-rose-950/40 border-rose-800/50'}`}>{msg.text}</div>
          )}
          {!isSuper && <div className="text-sm text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-2.5">{t('aiModels.superOnly', 'หน้านี้ใช้ได้เฉพาะ SUPERADMIN')}</div>}

          {loadErr && (
            <div className="text-sm text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded-lg px-4 py-3 flex items-center gap-2">
              <Icon name="alert-triangle" size={14} className="shrink-0" /> {loadErr}
              <button onClick={load} className="btn-secondary ml-auto text-xs px-3 py-1">{t('common.refresh', 'รีเฟรช')}</button>
            </div>
          )}

          {/* ── VRAM & Storage Gauge ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="card p-3 flex flex-col gap-1.5">
              <span className="text-[10px] tracking-widest font-mono text-gray-500 uppercase flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${inv?.engineUp ? 'bg-emerald-400 glow-dot' : 'bg-rose-400 glow-dot-red'}`} /> ENGINE
              </span>
              <span className="mono text-lg font-bold text-gray-50">{inv?.engineUp ? 'ONLINE' : 'OFFLINE'}</span>
              <span className="mono text-[10px] text-gray-600 truncate">{inv?.engineUrl || '—'}</span>
            </div>
            <div className="card p-3 flex flex-col gap-1.5">
              <span className="text-[10px] tracking-widest font-mono text-gray-500 uppercase">MODELS</span>
              <span className="mono text-lg font-bold text-emerald-400 glow-text">{inv?.storage.modelCount ?? '—'}</span>
              <span className="text-[10px] text-gray-600">installed</span>
            </div>
            <Gauge label="Disk (models)" used={diskUsed / GB} total={diskBudget} unit="GB" color="#22d3ee" />
            <Gauge label="VRAM (loaded)" used={vramUsed / GB} total={vramBudget} unit="GB" color="#34d399" />
          </div>

          {/* ── Task Assignment Matrix ── */}
          <div className="card panel-glow p-4">
            <h2 className="text-[13px] font-bold text-gray-100 glow-text flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full bg-emerald-500/60" /> {t('aiModels.matrixTitle', 'Task Assignment Matrix')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(inv?.taskTypes ?? Object.keys(TASK_LABEL)).map((task) => {
                const meta = TASK_LABEL[task] || { th: task, icon: 'ai', desc: '' };
                const current = inv?.routes?.[task as keyof Routes] ?? '';
                return (
                  <div key={task} className="bg-gray-800/40 border border-gray-700/40 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon name={meta.icon} size={13} className="text-emerald-400" />
                      <span className="text-xs font-bold text-gray-200">{meta.th}</span>
                      {current && loadedMap.has(current) && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono">IN VRAM</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 mb-2">{meta.desc}</div>
                    <select
                      value={current}
                      disabled={!isSuper || busy === `route:${task}`}
                      onChange={(e) => setRoute(task, e.target.value)}
                      className="input w-full text-xs"
                    >
                      <option value="">{t('aiModels.defaultRoute', 'default (ตามระบบ)')}</option>
                      {(inv?.models ?? []).map((m) => (
                        <option key={m.name} value={m.name}>{m.name} · {fmtGb(m.size)}</option>
                      ))}
                      {current && !(inv?.models ?? []).some((m) => m.name === current) && (
                        <option value={current}>{current} (ไม่พบในเครื่อง)</option>
                      )}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Model Repository ── */}
          <div className="card panel-cyan p-4">
            <h2 className="text-[13px] font-bold text-gray-100 glow-text-cyan flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full bg-cyan-500/60" /> {t('aiModels.repoTitle', 'Model Repository')}
              <span className="text-[10px] font-normal text-gray-500">{inv?.storage.modelCount ?? 0} models · {fmtGb(diskUsed)}</span>
            </h2>
            {!inv || inv.models.length === 0 ? (
              <EmptyState icon={<Icon name="database" size={20} />} title={t('aiModels.noModels', 'ยังไม่มีโมเดลในเครื่อง')} description={t('aiModels.noModelsDesc', 'ดาวน์โหลดจาก preset ด้านล่าง หรือ import ไฟล์ GGUF เอง')} />
            ) : (
              <div className="space-y-2">
                {inv.models.map((m) => {
                  const loaded = loadedMap.get(m.name);
                  const isRouteTarget = Object.values(inv.routes ?? {}).includes(m.name);
                  return (
                    <div key={m.name} className="bg-gray-950/50 border border-gray-800 rounded-xl px-3 py-2.5 flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="mono text-xs font-bold text-gray-100">{m.name}</span>
                          {loaded && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono glow-dot-emerald">● ACTIVE IN VRAM {fmtGb(loaded.size_vram)}</span>}
                          {isRouteTarget && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono">ROUTED</span>}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5 font-mono">
                          {fmtGb(m.size)} · {m.details?.parameter_size || '?'} · {m.details?.family || '?'} {m.details?.quantization_level ? `· ${m.details.quantization_level}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {loaded && (
                          <button onClick={() => unload(m.name)} disabled={busy === `unload:${m.name}`} className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-800/50 text-amber-300 hover:bg-amber-900/50 disabled:opacity-40">
                            {t('aiModels.unload', 'Unload')}
                          </button>
                        )}
                        <button
                          onClick={() => remove(m.name)}
                          disabled={busy === `del:${m.name}` || isRouteTarget}
                          title={isRouteTarget ? t('aiModels.routedLocked', 'ถูกใช้งานใน Task Matrix — เปลี่ยน route ก่อนลบ') : ''}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-300 hover:bg-rose-900/50 disabled:opacity-40"
                        >
                          {t('common.delete', 'ลบ')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Download Hub ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card panel-glow p-4">
              <h2 className="text-[13px] font-bold text-gray-100 glow-text flex items-center gap-2 mb-3">
                <span className="w-1 h-4 rounded-full bg-emerald-500/60" /> {t('aiModels.presetsTitle', 'ดาวน์โหลดโมเดลแนะนำ')}
              </h2>
              <div className="space-y-2">
                {PRESETS.map((p) => {
                  const installed = (inv?.models ?? []).some((m) => m.name === p.model);
                  const pulling = pullModelName === p.model;
                  return (
                    <div key={p.model} className="bg-gray-950/50 border border-gray-800 rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-gray-200">{p.label} <span className="text-gray-500 font-normal font-mono">{p.model}</span></div>
                          <div className="text-[10px] text-gray-500 font-mono">{p.size} · {p.task}</div>
                        </div>
                        {installed ? (
                          <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono">INSTALLED</span>
                        ) : (
                          <button onClick={() => startPull(p.model)} disabled={!!pullModelName} className="btn-primary text-[11px] px-3 py-1.5 disabled:opacity-40">
                            {pulling ? '…' : <><Icon name="download" size={12} /> Download</>}
                          </button>
                        )}
                      </div>
                      {pulling && (
                        <div className="mt-2">
                          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500" style={{ width: `${pullProgress.percent}%` }} />
                          </div>
                          <div className="flex justify-between text-[9px] font-mono text-gray-500 mt-1">
                            <span className="truncate">{pullProgress.status}</span><span>{pullProgress.percent.toFixed(0)}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {pullModelName && (
                  <button onClick={() => abortRef.current?.abort()} className="btn-ghost text-[10px] w-full">{t('aiModels.cancelPull', 'ยกเลิกการดาวน์โหลด (หยุดที่หน้านี้ — Ollama ทำต่อเบื้องหลัง)')}</button>
                )}
              </div>
            </div>

            {/* ── Advanced GGUF Import ── */}
            <div className="card panel-cyan p-4">
              <h2 className="text-[13px] font-bold text-gray-100 glow-text-cyan flex items-center gap-2 mb-1">
                <span className="w-1 h-4 rounded-full bg-cyan-500/60" /> {t('aiModels.ggufTitle', 'Import GGUF (Advanced)')}
              </h2>
              <p className="text-[10px] text-gray-500 mb-3">{t('aiModels.ggufDesc', 'วาง URL ไฟล์ .gguf จาก HuggingFace — ระบบดาวน์โหลด เขียน Modelfile แล้ว register เข้า Ollama ให้เอง')}</p>
              <div className="space-y-2">
                <input value={ggufName} onChange={(e) => setGgufName(e.target.value)} placeholder={t('aiModels.ggufNamePlaceholder', 'ชื่อโมเดลใหม่ เช่น kimi-k2:custom')} className="input w-full text-xs" />
                <input value={ggufUrl} onChange={(e) => setGgufUrl(e.target.value)} placeholder="https://huggingface.co/.../model.gguf" className="input w-full text-xs" />
                <textarea value={ggufPrompt} onChange={(e) => setGgufPrompt(e.target.value)} rows={2} placeholder={t('aiModels.ggufPromptPlaceholder', 'System prompt (ถ้าต้องการ — เช่นบุคลิกของโมเดล)')} className="input w-full text-xs resize-none" />
                <button onClick={startGgufImport} disabled={!isSuper || ggufJob?.status === 'downloading' || ggufJob?.status === 'creating' || !ggufName.trim() || !ggufUrl.trim()} className="btn-primary w-full text-xs disabled:opacity-40">
                  <Icon name="upload" size={13} /> {t('aiModels.ggufStart', 'เริ่ม Import')}
                </button>
                {ggufJob && (
                  <div className="bg-gray-950/60 border border-gray-800 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono tracking-widest text-gray-500">{ggufJob.phase.toUpperCase()} · {ggufJob.status}</span>
                      <span className={`mono text-[10px] font-bold ${ggufJob.status === 'error' ? 'text-rose-400' : ggufJob.status === 'done' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                        {ggufJob.status === 'done' ? 'OK' : ggufJob.status === 'error' ? 'FAILED' : `${ggufJob.percent.toFixed(0)}%`}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${ggufJob.status === 'error' ? 'bg-rose-500' : 'bg-gradient-to-r from-cyan-500 to-emerald-500'}`} style={{ width: `${ggufJob.status === 'done' ? 100 : ggufJob.percent}%` }} />
                    </div>
                    {ggufJob.error && <div className="text-[10px] text-rose-300 mt-1.5">{ggufJob.error}</div>}
                    {ggufJob.status === 'done' && <div className="text-[10px] text-emerald-300 mt-1.5">{t('aiModels.ggufDone', 'register สำเร็จ — โมเดลพร้อมใช้ใน Repository ด้านบน')}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
