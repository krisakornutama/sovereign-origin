"use client";
// ── Tab 2: สุขภาพ & ยา ──
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003)
import { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import EmptyState from '../ui/EmptyState';
import GroupSelect from './GroupSelect';
import { Group, fmtDate } from '../../lib/livestock-helpers';

export default function MedicalTab({ groups, canWrite, api, loadAll, setMsg, setErr, t, sel, setSel }: any) {
  const [form, setForm] = useState({ drugName: '', dosageMgKg: '', withdrawalDays: '', administeredAt: '', avgWeightKg: '', drugConcentrationMgPerL: '' });
  const [detail, setDetail] = useState<any>(null);
  const [vaccineForm, setVaccineForm] = useState({ vaccineName: '', targetAgeDays: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (sel) loadDetail(sel.id); }, [sel?.id]);

  const loadDetail = async (id: string) => {
    try {
      const r = await api(`/groups/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'load failed');
      setDetail(d);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const saveMed = async () => {
    if (!sel) return;
    if (!form.drugName.trim()) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      const body: Record<string, unknown> = {
        drugName: form.drugName.trim(),
        dosageMgKg: Number(form.dosageMgKg) || 0,
        withdrawalDays: Number(form.withdrawalDays) || 0,
      };
      if (form.administeredAt) body.administeredAt = new Date(form.administeredAt).toISOString();
      if (form.avgWeightKg) body.avgWeightKg = Number(form.avgWeightKg);
      if (form.drugConcentrationMgPerL) body.drugConcentrationMgPerL = Number(form.drugConcentrationMgPerL);
      const r = await api(`/groups/${sel.id}/medical`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setMsg(t('livestock.page.updated', 'อัปเดตสำเร็จ'));
      setForm({ drugName: '', dosageMgKg: '', withdrawalDays: '', administeredAt: '', avgWeightKg: '', drugConcentrationMgPerL: '' });
      loadDetail(sel.id); loadAll();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const saveVaccine = async () => {
    if (!sel) return;
    if (!vaccineForm.vaccineName.trim()) return;
    setErr(''); setMsg('');
    try {
      const r = await api(`/groups/${sel.id}/vaccines`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vaccineName: vaccineForm.vaccineName.trim(), targetAgeDays: Number(vaccineForm.targetAgeDays) || 0 }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setVaccineForm({ vaccineName: '', targetAgeDays: '' });
      loadDetail(sel.id);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const completeVaccine = async (id: string) => {
    try {
      const r = await api(`/vaccines/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isCompleted: true }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'update failed');
      loadDetail(sel.id);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const lock = detail?.withdrawalLock;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="text-sm font-semibold text-gray-200 mb-2">{t('livestock.page.tabMedical', 'สุขภาพ & ยา')}</div>
        <GroupSelect groups={groups} selId={sel?.id ?? ''} onChange={setSel} t={t} />
      </div>
      {!sel ? (
        <div className="card"><EmptyState icon={<Icon name="farm" size={20} />} title={t('livestock.page.noGroups', 'ยังไม่มีกลุ่มปศุสัตว์')} description={t('livestock.page.selectGroup', 'เลือกกลุ่มด้านบนเพื่อดูข้อมูล')} /></div>
      ) : (
        <>
          {canWrite && (
            <div className="card panel-glow p-4 space-y-3">
              <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="plus" size={14} className="text-gray-400" />{t('livestock.medical.title', 'บันทึกการรักษา (ยา)')}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <input value={form.drugName} onChange={(e) => setForm({ ...form, drugName: e.target.value })} placeholder={t('livestock.medical.drugPlaceholder', 'ชื่อยา *')} className="input" />
                <input value={form.dosageMgKg} onChange={(e) => setForm({ ...form, dosageMgKg: e.target.value })} type="number" min="0" step="0.01" placeholder={t('livestock.medical.dosePlaceholder', 'ขนาดยา (มก./กก.)')} className="input" />
                <input value={form.withdrawalDays} onChange={(e) => setForm({ ...form, withdrawalDays: e.target.value })} type="number" min="0" placeholder={t('livestock.medical.withdrawalPlaceholder', 'ระยะหยุดยา (วัน)')} className="input" />
                <input value={form.administeredAt} onChange={(e) => setForm({ ...form, administeredAt: e.target.value })} type="date" className="input" />
                <input value={form.avgWeightKg} onChange={(e) => setForm({ ...form, avgWeightKg: e.target.value })} type="number" min="0" step="0.01" placeholder={t('livestock.medical.avgWeightPlaceholder', 'น้ำหนักเฉลี่ย (กก.)')} className="input" />
                <input value={form.drugConcentrationMgPerL} onChange={(e) => setForm({ ...form, drugConcentrationMgPerL: e.target.value })} type="number" min="0" step="0.01" placeholder={t('livestock.medical.concPlaceholder', 'ความเข้มข้นยา (มก./ล.)')} className="input" />
              </div>
              <button onClick={saveMed} disabled={saving} className="btn-primary">{saving ? '…' : t('livestock.medical.save', 'บันทึกยา')}</button>
            </div>
          )}

          {lock && (lock.locked ? (
            <div className="bg-orange-500/10 border border-orange-500/40 text-orange-300 rounded px-4 py-2 text-sm">
              {t('livestock.medical.lockedMsg', 'ล็อกขายอัตโนมัติ {n} วัน (หยุดยา)', { n: lock.daysLeft })} — {t('livestock.medical.safeHarvest', 'ขายได้หลัง {date}', { date: fmtDate(sel.id && lock.safeHarvestDate) })}
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded px-4 py-2 text-sm">{t('livestock.medical.unlockedMsg', 'พ้นระยะหยุดยาแล้ว — ขายได้')}</div>
          ))}

          <div className="card p-4 space-y-2">
            <div className="text-sm font-semibold text-gray-200">{t('livestock.medical.history', 'ประวัติการใช้ยา')}</div>
            {detail?.group?.records?.length === 0 && <div className="text-xs text-gray-500">{t('livestock.medical.noRecords', 'ยังไม่มีประวัติยา')}</div>}
            {detail?.group?.records?.map((r: any) => (
              <div key={r.id} className="flex justify-between items-center text-xs border-b border-gray-800 pb-1.5">
                <div>
                  <span className="text-gray-100 font-semibold">{r.drugName}</span>
                  <span className="text-gray-500 ml-2">{r.dosageMgKg} มก./กก. · {fmtDate(r.administeredAt)}</span>
                </div>
                <div className={new Date(r.safeHarvestDate).getTime() > Date.now() ? 'text-orange-300' : 'text-emerald-300'}>
                  {t('livestock.medical.safeHarvest', 'ขายได้หลัง {date}', { date: fmtDate(r.safeHarvestDate) })}
                </div>
              </div>
            ))}
          </div>

          <div className="card p-4 space-y-2">
            <div className="text-sm font-semibold text-gray-200">{t('livestock.medical.vaccineTitle', 'ตารางวัคซีน')}</div>
            {canWrite && (
              <div className="flex gap-2">
                <input value={vaccineForm.vaccineName} onChange={(e) => setVaccineForm({ ...vaccineForm, vaccineName: e.target.value })} placeholder={t('livestock.medical.vaccinePlaceholder', 'ชื่อวัคซีน')} className="input flex-1" />
                <input value={vaccineForm.targetAgeDays} onChange={(e) => setVaccineForm({ ...vaccineForm, targetAgeDays: e.target.value })} type="number" min="0" placeholder={t('livestock.medical.vaccineAge', 'อายุ (วัน)')} className="input w-24" />
                <button onClick={saveVaccine} className="btn-secondary"><Icon name="plus" size={13} /></button>
              </div>
            )}
            {detail?.group?.schedules?.map((s: any) => (
              <div key={s.id} className="flex justify-between items-center text-xs border-b border-gray-800 pb-1.5">
                <div><span className="text-gray-100">{s.vaccineName}</span><span className="text-gray-500 ml-2">@{s.targetAgeDays} วัน</span></div>
                {s.isCompleted ? (
                  <span className="text-emerald-300 inline-flex items-center gap-1"><Icon name="check" size={12} />{fmtDate(s.completedAt)}</span>
                ) : canWrite ? (
                  <button onClick={() => completeVaccine(s.id)} className="text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-600/40 rounded px-2 py-0.5">{t('livestock.medical.done', 'ฉีดแล้ว')}</button>
                ) : (
                  <span className="text-amber-300">{t('livestock.medical.pending', 'ยังไม่ครบ')}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
