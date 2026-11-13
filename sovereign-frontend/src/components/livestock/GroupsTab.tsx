"use client";
// ── Tab 1: กลุ่มปศุสัตว์ ──
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003)
import { useState } from 'react';
import Icon from '../ui/Icon';
import EmptyState from '../ui/EmptyState';
import { Group, SPECIES_ORDER, STATUS_COLOR, fmtDate, speciesLabel } from '../../lib/livestock-helpers';

export default function GroupsTab({ groups, canWrite, api, loadAll, setMsg, setErr, t, setSel }: any) {
  const [form, setForm] = useState({ code: '', name: '', species: 'POULTRY_BROILER', quantity: '', birthDate: '', houseCode: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const create = async () => {
    if (!form.code.trim()) return setErr('livestock.page.error' + '' || 'code required');
    setSaving(true); setErr(''); setMsg('');
    try {
      const body: Record<string, unknown> = { code: form.code.trim(), species: form.species, quantity: Number(form.quantity) };
      if (form.name) body.name = form.name;
      if (form.birthDate) body.birthDate = form.birthDate;
      if (form.houseCode) body.houseCode = form.houseCode;
      if (form.notes) body.notes = form.notes;
      const r = await api('/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setMsg(t('livestock.page.added', 'เพิ่มกลุ่ม "{name}" แล้ว', { name: form.code }));
      setForm({ code: '', name: '', species: 'POULTRY_BROILER', quantity: '', birthDate: '', houseCode: '', notes: '' });
      loadAll();
    } catch (e: any) {
      setErr(e.message || t('livestock.page.error', 'เกิดข้อผิดพลาด'));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (g: Group, status: string) => {
    try {
      const r = await api(`/groups/${g.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'update failed');
      setMsg(t('livestock.page.updated', 'อัปเดตสำเร็จ'));
      loadAll();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const r = await api(`/groups/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'load failed');
      setDetail(d);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const remove = async (g: Group) => {
    if (!window.confirm(t('livestock.page.deleteConfirm', 'ลบกลุ่ม "{name}"? (ข้อมูลย้อนหลังจะหายด้วย)', { name: g.code }))) return;
    try {
      const r = await api(`/groups/${g.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      setMsg(t('livestock.page.deleted', 'ลบ "{name}" แล้ว', { name: g.code }));
      loadAll();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card panel-glow p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="plus" size={14} className="text-gray-400" />{t('livestock.group.addTitle', 'เพิ่มกลุ่มปศุสัตว์ใหม่')}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t('livestock.group.codePlaceholder', 'รหัสกลุ่ม *')} className="input" />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('livestock.group.namePlaceholder', 'ชื่อกลุ่ม')} className="input" />
            <select value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} className="input">
              {SPECIES_ORDER.map((s) => <option key={s} value={s}>{t('livestock.group.' + speciesLabel(s), s)}</option>)}
            </select>
            <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} type="number" min="1" placeholder={t('livestock.group.quantityPlaceholder', 'จำนวนตัว *')} className="input" />
            <input value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} type="date" className="input" />
            <input value={form.houseCode} onChange={(e) => setForm({ ...form, houseCode: e.target.value })} placeholder={t('livestock.group.housePlaceholder', 'เล้า/คอก')} className="input" />
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('livestock.group.notesPlaceholder', 'หมายเหตุ')} className="input col-span-2" />
          </div>
          <button onClick={create} disabled={saving} className="btn-primary">{saving ? t('livestock.group.saving', 'กำลังบันทึก…') : t('livestock.group.save', 'บันทึกกลุ่ม')}</button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="card"><EmptyState icon={<Icon name="farm" size={20} />} title={t('livestock.page.noGroups', 'ยังไม่มีกลุ่มปศุสัตว์')} description={t('livestock.page.noGroupsDesc', 'เริ่มสร้างกลุ่มแรกจากประเภทและจำนวน')} /></div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map((g: Group) => (
            <div key={g.id} className="card p-4 space-y-2 card-hover">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-white">{g.code}</div>
                  {g.name && <div className="text-xs text-gray-400">{g.name}</div>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs border whitespace-nowrap ${STATUS_COLOR[g.status] ?? STATUS_COLOR.ACTIVE}`}>
                  {t('livestock.group.status' + g.status[0] + g.status.slice(1).toLowerCase(), g.status)}
                </span>
              </div>
              <div className="text-xs text-emerald-300">{t('livestock.group.' + speciesLabel(g.species), g.species)}</div>
              <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                <div>{t('livestock.group.quantity', 'จำนวน')}: <span className="text-gray-200">{g.quantity}</span></div>
                <div>{t('livestock.group.born', 'เริ่มเลี้ยง')}: <span className="text-gray-200">{fmtDate(g.birthDate)}</span></div>
                <div>{t('livestock.group.house', 'เล้า')}: <span className="text-gray-200">{g.houseCode || '—'}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
                <div>{t('livestock.group.records', 'ยารักษา')}: {g._count?.records ?? 0}</div>
                <div>{t('livestock.group.metrics', 'ค่าสุขภาพ')}</div>
                <div>{t('livestock.group.schedules', 'วัคซีน')}</div>
              </div>
              {g.notes && <div className="text-xs text-gray-500 italic">{g.notes}</div>}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-800">
                <button onClick={() => openDetail(g.id)} className="text-xs bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-600/40 rounded px-3 py-1">{t('common.open', 'เปิด')}</button>
                {canWrite && (
                  <>
                    {g.status !== 'QUARANTINE' && (
                      <button onClick={() => changeStatus(g, 'QUARANTINE')} className="text-xs bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-600/40 rounded px-3 py-1">{t('livestock.group.toQuarantine', 'กักกัน')}</button>
                    )}
                    {g.status === 'QUARANTINE' && (
                      <button onClick={() => changeStatus(g, 'ACTIVE')} className="text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-600/40 rounded px-3 py-1">{t('livestock.group.toActive', 'ปลดกักกัน')}</button>
                    )}
                    {g.status !== 'HARVESTED' && g.status !== 'QUARANTINE' && (
                      <button onClick={() => changeStatus(g, 'HARVESTED')} className="text-xs bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-600/40 rounded px-3 py-1">{t('livestock.group.toHarvested', 'จำหน่ายแล้ว')}</button>
                    )}
                    {g.status === 'LOCKED_WITHDRAWAL' && (
                      <button onClick={() => changeStatus(g, 'ACTIVE')} className="text-xs bg-orange-600/20 hover:bg-orange-600/40 text-orange-300 border border-orange-600/40 rounded px-3 py-1">{t('livestock.group.unlockBtn', 'ปลดล็อกขาย')}</button>
                    )}
                    <button onClick={() => remove(g)} className="ml-auto text-red-400 hover:text-red-300 text-xs"><Icon name="trash" size={14} /></button>
                  </>
                )}
              </div>
              {detail && detail.group?.id === g.id && (
                <div className="bg-gray-950/70 border border-sky-900 rounded-lg p-2 text-[11px] space-y-1 max-h-40 overflow-y-auto">
                  {detail.records?.length > 0 && <div className="text-sky-300 font-bold">{t('livestock.medical.history', 'ประวัติการใช้ยา')}</div>}
                  {detail.records?.map((r: any) => <div key={r.id} className="text-gray-300">{r.drugName} · {r.dosageMgKg} มก./กก. · ครบ {fmtDate(r.safeHarvestDate)}</div>)}
                  {detail.schedules?.map((s: any) => (
                    <div key={s.id} className="text-gray-400">{s.vaccineName} @ {s.targetAgeDays} วัน {s.isCompleted ? `✓ ${fmtDate(s.completedAt)}` : '…'}</div>
                  ))}
                  {(!detail.records?.length && !detail.schedules?.length) && <div className="text-gray-600">—</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
