// components/coding/SkillQueuePanel.tsx
// คิวทักษะ — เพิ่มทักษะ/งานที่อยากให้ AI ทำซ้ำ + เลือกโมเดล/เหตุผล/ระดับอัตโนมัติ
import { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const EFFORTS = [
  { key: '', label: 'ตามค่าเริ่มต้น' },
  { key: 'low', label: 'น้อย' },
  { key: 'medium', label: 'ปานกลาง' },
  { key: 'high', label: 'มาก' },
  { key: 'full', label: 'เต็ม' },
];
const AUTONOMIES = [
  { key: 'manual', label: 'ทำตามสั่งเท่านั้น', desc: 'ทำเฉพาะที่สั่ง' },
  { key: 'semi', label: 'กึ่งอัตโนมัติ', desc: 'งานประจำทำเอง งานเสี่ยงถามก่อน' },
  { key: 'auto', label: 'คิดเอง ทำเอง', desc: 'ตัดสินใจเอง ทำเองให้เสร็จ' },
];

export default function SkillQueuePanel({ models, compact }: { models?: string[]; compact?: boolean }) {
  const t = useLanguageStore((s) => s.t);
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', autonomy: 'manual', model: '', reasoningEffort: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/api/coding/skills`);
      const data = await res.json();
      if (res.ok) setSkills(data.skills || []);
    } catch {
      /* เงียบ */
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const addSkill = async () => {
    setError('');
    if (!form.title.trim() || !form.content.trim()) {
      setError(t('aiAgent.skillQueue.fillBoth', 'กรอกชื่อและเนื้อหาทักษะก่อน'));
      return;
    }
    try {
      const res = await authFetch(`${API}/api/coding/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('aiAgent.skillQueue.addFailed', 'เพิ่มไม่สำเร็จ'));
      setForm({ title: '', content: '', autonomy: form.autonomy, model: form.model, reasoningEffort: form.reasoningEffort });
      await load();
    } catch (err: any) {
      setError(String(err.message || err));
    }
  };

  const runSkill = async (id: string) => {
    setBusy(id);
    try {
      await authFetch(`${API}/api/coding/skills/${id}/run`, { method: 'POST' });
    } catch {
      /* เงียบ */
    }
    setBusy(null);
    await load();
  };

  const runQueue = async () => {
    setBusy('*');
    try {
      await authFetch(`${API}/api/coding/skills/run-queue`, { method: 'POST' });
    } catch {
      /* เงียบ */
    }
    setBusy(null);
    await load();
  };

  const deleteSkill = async (id: string) => {
    if (!window.confirm(t('aiAgent.skillQueue.deleteConfirm', 'ลบทักษะนี้ออกจากคิว?'))) return;
    try {
      await authFetch(`${API}/api/coding/skills/${id}`, { method: 'DELETE' });
      await load();
    } catch {
      /* เงียบ */
    }
  };

  const running = skills.some((s) => s.status === 'running');

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {error && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400 border border-red-800">{error}</div>}

      {/* ── เพิ่มทักษะ ── */}
      <section className={compact ? 'space-y-2 panel-glow' : 'card panel-glow p-5 space-y-3'}>
        <h3 className="text-sm font-semibold text-gray-200 glow-text flex items-center gap-2">
          <Icon name="ai" size={14} className="text-gray-400" />
          {t('aiAgent.skillQueue.title', 'เพิ่มทักษะ/งานเข้าคิว')}
        </h3>
        <input
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          placeholder={t('aiAgent.skillQueue.phTitle', 'ชื่อทักษะ เช่น สร้างหน้า login ด้วย Next.js')}
          className="input w-full"
        />
        <textarea
          value={form.content}
          onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
          placeholder={t('aiAgent.skillQueue.phContent', 'คำสั่งเต็ม (AI จะวางแผน + เขียนโค้ดตามนี้)')}
          rows={compact ? 2 : 3}
          className="input w-full"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="text-gray-400">{t('aiAgent.skillQueue.modelLabel', 'โมเดล')}</label>
          <select
            value={form.model}
            onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            <option value="">{t('aiAgent.skillQueue.default', 'ค่าเริ่มต้น')}</option>
            {(models || []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <label className="text-gray-400 ml-2">{t('aiAgent.skillQueue.effortLabel', 'เหตุผล')}</label>
          <select
            value={form.reasoningEffort}
            onChange={(e) => setForm((p) => ({ ...p, reasoningEffort: e.target.value }))}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            {EFFORTS.map((e) => (
              <option key={e.key} value={e.key}>{e.key ? t(`aiAgent.effort.${e.key}`, e.label) : t('aiAgent.skillQueue.effortDefault', e.label)}</option>
            ))}
          </select>
          <span className="ml-2 text-gray-400">{t('aiAgent.skillQueue.autonomyLabel', 'อัตโนมัติ:')}</span>
          {AUTONOMIES.map((a) => (
            <button
              key={a.key}
              onClick={() => setForm((p) => ({ ...p, autonomy: a.key }))}
              title={t(`aiAgent.skillQueue.autonomy.${a.key}.desc`, a.desc)}
              className={`px-2.5 py-1.5 rounded text-xs font-bold transition ${
                form.autonomy === a.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300'
              }`}
            >
              {t(`aiAgent.skillQueue.autonomy.${a.key}.label`, a.label)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={addSkill}
            className="btn-primary"
          >
            <Icon name="plus" size={13} />
            {t('aiAgent.skillQueue.add', 'เพิ่มเข้าคิว')}
          </button>
          <button
            onClick={runQueue}
            disabled={busy !== null || !skills.some((s) => s.status === 'queued')}
            className="btn-secondary"
          >
            {busy === '*' ? t('aiAgent.skillQueue.runQueueBusy', 'รันคิว...') : (
              <>
                <Icon name="play" size={13} />
                {t('aiAgent.skillQueue.runQueue', 'รันคิวทั้งหมด')}
              </>
            )}
          </button>
        </div>
      </section>

      {/* ── รายการคิว ── */}
      <section className={compact ? 'space-y-2 panel-cyan' : 'card panel-cyan p-5 space-y-3'}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan flex items-center gap-2">
            <Icon name="menu" size={14} className="text-gray-400" />
            {t('aiAgent.skillQueue.queueTitle', 'คิวทักษะ ({n})', { n: skills.length })}
          </h3>
          {running && <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-950/40 text-emerald-400 animate-pulse">{t('aiAgent.skillQueue.runningBadge', 'มีงานกำลังรัน...')}</span>}
        </div>
        {skills.length === 0 && (
          <div className="text-gray-500 text-sm text-center py-4 border border-dashed border-gray-700 rounded-lg">
            {t('aiAgent.skillQueue.emptyQueue', 'ยังไม่มีทักษะในคิว — เพิ่มข้างบนก่อน แล้วกดรันคิว')}
          </div>
        )}
        <div className="space-y-2">
          {skills.map((s) => (
            <div
              key={s.id}
              className={`border rounded-lg p-3 space-y-1.5 ${
                s.status === 'done' ? 'border-emerald-700/50 bg-gray-800/40' : s.status === 'error' ? 'border-red-800/60 bg-gray-800/40' : 'border-gray-700 bg-gray-800/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-xs truncate max-w-[260px]">{s.title}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold inline-flex items-center gap-1 ${
                    s.status === 'done' ? 'bg-emerald-950/40 text-emerald-400' : s.status === 'error' ? 'bg-red-950/40 text-red-400' : 'bg-emerald-950/40 text-emerald-400 animate-pulse'
                  }`}>
                    {s.status === 'queued' ? (<><Icon name="clock" size={10} />{t('aiAgent.skillQueue.statusQueued', 'ในคิว')}</>) : s.status === 'running' ? (<><Icon name="settings" size={10} />{t('aiAgent.skillQueue.statusRunning', 'กำลังรัน')}</>) : s.status === 'done' ? (<><Icon name="check" size={10} />{t('aiAgent.skillQueue.statusDone', 'เสร็จ')}</>) : (<><Icon name="x-circle" size={10} />{t('aiAgent.skillQueue.statusFailed', 'พลาด')}</>)}
                  </span>
                  <span className="text-[9px] text-gray-500">{s.autonomy === 'auto' ? t('aiAgent.skillQueue.autonomyStatus.auto', 'คิดเอง') : s.autonomy === 'semi' ? t('aiAgent.skillQueue.autonomyStatus.semi', 'กึ่ง') : t('aiAgent.skillQueue.autonomyStatus.manual', 'ตามสั่ง')}{s.model ? ` · ${s.model}` : ''}</span>
                  <button onClick={() => runSkill(s.id)} disabled={busy !== null || s.status === 'running'} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-300 disabled:opacity-40"><Icon name="play" size={10} /></button>
                  <button onClick={() => deleteSkill(s.id)} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 border border-gray-600 text-gray-500"><Icon name="trash" size={10} /></button>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 inset px-2 py-1.5 line-clamp-2">{s.content}</p>
              {s.status === 'error' && <p className="text-[10px] text-red-400 flex items-center gap-1"><Icon name="x-circle" size={10} />{s.error}</p>}
              {s.status === 'done' && <p className="text-[10px] text-emerald-400 flex items-center gap-1"><Icon name="check" size={10} />{s.result}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}