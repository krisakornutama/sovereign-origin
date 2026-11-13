"use client";
// ── Tab 5: ชีวนิรภัย ──
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003)
import { useState, useEffect } from 'react';
import Icon from '../ui/Icon';

export default function BiosecurityTab({ canWrite, api, setMsg, setErr, t }: any) {
  const [form, setForm] = useState({ visitorName: '', vehiclePlate: '', sanitizedSec: '' });
  const [logs, setLogs] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [gate, setGate] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const r = await api('/biosecurity');
      const d = await r.json();
      if (r.ok) { setLogs(d.logs ?? []); setSummary(d.summary ?? null); }
    } catch { /* ignore */ }
  };

  const save = async () => {
    if (!form.visitorName.trim()) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      const body: Record<string, unknown> = { visitorName: form.visitorName.trim(), sanitizedSec: Number(form.sanitizedSec) || 0 };
      if (form.vehiclePlate) body.vehiclePlate = form.vehiclePlate;
      const r = await api('/biosecurity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setGate(d.gate);
      setForm({ visitorName: '', vehiclePlate: '', sanitizedSec: '' });
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card panel-glow p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="shield" size={14} className="text-gray-400" />{t('livestock.bio.title', 'ประตูชีวนิรภัย (ฉีดพ่น ≥180 วินาที)')}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input value={form.visitorName} onChange={(e) => setForm({ ...form, visitorName: e.target.value })} placeholder={t('livestock.bio.visitorPlaceholder', 'ชื่อผู้เข้าฟาร์ม *')} className="input" />
            <input value={form.vehiclePlate} onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })} placeholder={t('livestock.bio.platePlaceholder', 'ทะเบียนรถ')} className="input" />
            <input value={form.sanitizedSec} onChange={(e) => setForm({ ...form, sanitizedSec: e.target.value })} type="number" min="0" placeholder={t('livestock.bio.secPlaceholder', 'เวลาฉีดพ่น (วินาที)')} className="input" />
          </div>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? '…' : t('livestock.bio.save', 'บันทึก + ตรวจประตู')}</button>
          {gate && (
            <div className={`rounded border px-3 py-2 text-sm ${gate.passed ? 'bg-emerald-950/40 border-emerald-700 text-emerald-200' : 'bg-red-950/40 border-red-700 text-red-200'}`}>
              {gate.passed ? t('livestock.bio.passed', 'ผ่าน — เข้าฟาร์มได้') : t('livestock.bio.denied', 'ไม่อนุญาต! ฉีดพ่นไม่ครบ {n} วิ', { n: 180 })}
            </div>
          )}
        </div>
      )}

      <div className="card p-4 space-y-2">
        <div className="text-sm font-semibold text-gray-200 flex items-center justify-between">
          <span>{t('livestock.bio.history', 'ประวัติเข้าฟาร์ม')}</span>
          <span className="text-xs text-gray-400">{t('livestock.bio.total', 'ทั้งหมด {n} ครั้ง', { n: summary?.total ?? 0 })} · {t('livestock.bio.deniedCount', 'ถูกปฏิเสธ {n} ครั้ง', { n: summary?.denied ?? 0 })}</span>
        </div>
        {logs.length === 0 && <div className="text-xs text-gray-500">—</div>}
        {logs.map((l) => (
          <div key={l.id} className="flex justify-between items-center text-xs border-b border-gray-800 pb-1.5">
            <div><span className="text-gray-100">{l.visitorName}</span><span className="text-gray-500 ml-2">{l.vehiclePlate || '—'} · {t('livestock.bio.sec', 'ฉีดพ่น')}: {l.sanitizedSec}s</span></div>
            <span className={`px-2 py-0.5 rounded-full border ${l.passedGate ? 'bg-emerald-900/40 border-emerald-600/40 text-emerald-300' : 'bg-red-900/40 border-red-600/40 text-red-300'}`}>{l.passedGate ? t('livestock.bio.yes', 'ผ่าน') : t('livestock.bio.no', 'ไม่อนุญาต')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
