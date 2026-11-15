"use client";
// ── Tab 4: ผลผลิตประจำวัน ──
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003)
import { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import EmptyState from '../ui/EmptyState';
import GroupSelect from './GroupSelect';
import { Group, fmtNum } from '../../lib/livestock-helpers';

export default function ProductionTab({ groups, canWrite, api, loadAll, setMsg, setErr, t, sel, setSel }: any) {
  const [form, setForm] = useState({ logDate: new Date().toISOString().slice(0, 10), mortalityCount: '', culledCount: '', feedConsumedKg: '', waterConsumedL: '', eggCount: '', avgWeightGram: '' });
  const [analysis, setAnalysis] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (sel) { setAnalysis(null); setMetrics(null); loadMetrics(); } }, [sel?.id]);

  const loadMetrics = async () => {
    try {
      const r = await api(`/groups/${sel.id}/metrics`);
      const d = await r.json();
      if (r.ok) setMetrics(d.metrics);
    } catch { /* ignore */ }
  };

  const save = async () => {
    if (!sel) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      const num = (v: string) => (v === '' ? undefined : Number(v));
      const body: Record<string, unknown> = {
        logDate: form.logDate,
        mortalityCount: num(form.mortalityCount) ?? 0,
        culledCount: num(form.culledCount) ?? 0,
        feedConsumedKg: num(form.feedConsumedKg) ?? 0,
      };
      if (form.waterConsumedL !== '') body.waterConsumedL = Number(form.waterConsumedL);
      if (form.eggCount !== '') body.eggCount = Number(form.eggCount);
      if (form.avgWeightGram !== '') body.avgWeightGram = Number(form.avgWeightGram);
      const r = await api(`/groups/${sel.id}/daily-logs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setAnalysis(d);
      loadMetrics(); loadAll();
      setMsg(t('livestock.page.updated', 'อัปเดตสำเร็จ'));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const actionColor = (a: any) => a.severity === 'critical' ? 'bg-red-950/40 border-red-700 text-red-200' : a.severity === 'warn' ? 'bg-amber-950/40 border-amber-700 text-amber-200' : 'bg-emerald-950/40 border-emerald-700 text-emerald-200';

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="text-sm font-semibold text-gray-200 mb-2">{t('livestock.page.tabProduction', 'ผลผลิตประจำวัน')}</div>
        <GroupSelect groups={groups} selId={sel?.id ?? ''} onChange={setSel} t={t} />
      </div>
      {!sel ? (
        <div className="card"><EmptyState icon={<Icon name="farm" size={20} />} title={t('livestock.page.noGroups', 'ยังไม่มีกลุ่มปศุสัตว์')} description={t('livestock.page.selectGroup', 'เลือกกลุ่มด้านบนเพื่อดูข้อมูล')} /></div>
      ) : (
        <>
          {canWrite && (
            <div className="card panel-glow p-4 space-y-3">
              <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="file" size={14} className="text-gray-400" />{t('livestock.production.title', 'บันทึกผลผลิตประจำวัน (Vet AI ตรวจอัตโนมัติ)')}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input value={form.logDate} onChange={(e) => setForm({ ...form, logDate: e.target.value })} type="date" className="input" />
                <input value={form.mortalityCount} onChange={(e) => setForm({ ...form, mortalityCount: e.target.value })} type="number" min="0" placeholder={t('livestock.production.mortality', 'ตาย (ตัว)')} className="input" />
                <input value={form.culledCount} onChange={(e) => setForm({ ...form, culledCount: e.target.value })} type="number" min="0" placeholder={t('livestock.production.culled', 'คัดทิ้ง (ตัว)')} className="input" />
                <input value={form.feedConsumedKg} onChange={(e) => setForm({ ...form, feedConsumedKg: e.target.value })} type="number" min="0" step="0.1" placeholder={t('livestock.production.feedKg', 'อาหารที่ให้ (กก.)')} className="input" />
                <input value={form.waterConsumedL} onChange={(e) => setForm({ ...form, waterConsumedL: e.target.value })} type="number" min="0" step="0.1" placeholder={t('livestock.production.waterL', 'น้ำ (ลิตร)')} className="input" />
                <input value={form.eggCount} onChange={(e) => setForm({ ...form, eggCount: e.target.value })} type="number" min="0" placeholder={t('livestock.production.eggCount', 'ไข่ (ฟอง)')} className="input" />
                <input value={form.avgWeightGram} onChange={(e) => setForm({ ...form, avgWeightGram: e.target.value })} type="number" min="0" step="0.1" placeholder={t('livestock.production.avgWeight', 'น้ำหนักเฉลี่ย (กรัม)')} className="input" />
              </div>
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? '…' : t('livestock.production.save', 'บันทึก + วิเคราะห์')}</button>
            </div>
          )}

          {metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              <div className="card p-3"><div className="text-lg font-bold text-sky-300">{fmtNum(metrics.fcr, 2)}</div><div className="text-[11px] text-gray-400">{t('livestock.production.fcr', 'FCR (อาหาร/น้ำหนัก)')} <span className="text-gray-600">/ {t('livestock.production.fcrStandard', 'Standard {n}', { n: metrics.standardFcr })}</span></div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${metrics.fcrDeviationPct != null && metrics.fcrDeviationPct >= 10 ? 'text-amber-400' : 'text-gray-300'}`}>{fmtNum(metrics.hdPct, 1)}%</div><div className="text-[11px] text-gray-400">{t('livestock.production.hdPct', 'HD% (อัตราการไข่)')}</div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${metrics.mortalityRatePct > 0.5 ? 'text-red-400' : 'text-gray-300'}`}>{fmtNum(metrics.mortalityRatePct, 2)}%</div><div className="text-[11px] text-gray-400">{t('livestock.production.mortalityRate', 'อัตราตาย {n}%', { n: '' })}</div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${metrics.waterDropPct <= -20 ? 'text-amber-400' : 'text-gray-300'}`}>{fmtNum(metrics.waterDropPct, 1)}%</div><div className="text-[11px] text-gray-400">{t('livestock.production.waterDrop', 'น้ำกินลด {n}% เทียบ 3 วัน', { n: '' })}</div></div>
            </div>
          )}

          {metrics?.withdrawalLock?.locked && (
            <div className="bg-orange-500/10 border border-orange-500/40 text-orange-300 rounded px-4 py-2 text-sm">
              {t('livestock.medical.lockedMsg', 'ล็อกขายอัตโนมัติ {n} วัน (หยุดยา)', { n: metrics.withdrawalLock.daysLeft })}
            </div>
          )}
          {metrics?.pendingVaccines > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded px-4 py-2 text-sm">
              {t('livestock.production.pendingVaccines', 'วัคซีนค้าง {n} รายการ', { n: metrics.pendingVaccines })}
            </div>
          )}

          {analysis && (
            <div className="card p-4 space-y-2">
              <div className="text-sm font-semibold text-gray-200">{t('livestock.production.save', 'บันทึก + วิเคราะห์')}</div>
              {analysis.actions?.length > 0 ? (
                <div className="space-y-1.5">
                  {analysis.actions.map((a: any, i: number) => (
                    <div key={i} className={`rounded border px-3 py-2 text-xs ${actionColor(a)}`}>{a.message}</div>
                  ))}
                  {analysis.statusChanged === 'QUARANTINE' && (
                    <div className="bg-red-950/50 border border-red-700 text-red-200 rounded px-3 py-2 text-xs font-bold">{t('livestock.production.quarantineLocked', 'QUARANTINE! เล้าถูกล็อกแล้ว — แจ้งสัตวบาล')}</div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-emerald-300 flex items-center gap-1"><Icon name="check" size={13} />{t('livestock.production.noAction', 'ค่าปกติ — ไม่มีสัญญาณเตือน')}</div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-400 pt-1 border-t border-gray-800">
                <div>{t('livestock.production.totalFeed', 'อาหารสะสม {n} กก.', { n: fmtNum(metrics?.totalFeedKg, 1) })}</div>
                <div>{t('livestock.production.totalMortality', 'ตายสะสม {n} ตัว', { n: metrics?.totalMortality ?? 0 })}</div>
                <div>{t('livestock.production.fcr', 'FCR (อาหาร/น้ำหนัก')}: {fmtNum(metrics?.fcr, 2)}</div>
                <div>HD%: {fmtNum(metrics?.hdPct, 1)}</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
