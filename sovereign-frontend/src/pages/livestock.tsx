"use client";
import { useState, useEffect, useCallback } from 'react';
import { useCanWriteModules } from '../lib/roles';
import { useAuthStore } from '../stores/useAuthStore';
import { useFeatureStore } from '../stores/useFeatureStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import { useLanguageStore } from '../stores/useLanguageStore';
import { fmtLocale } from '../lib/formatDate';

type Group = {
  id: string;
  code: string;
  name: string | null;
  species: string;
  quantity: number;
  birthDate: string;
  houseCode: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  _count?: { records?: number; dailyLogs?: number };
};

const SPECIES_ORDER = ['POULTRY_BROILER', 'POULTRY_LAYER', 'DUCK', 'SWINE', 'CATTLE'];
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  QUARANTINE: 'bg-red-500/15 text-red-300 border-red-500/30',
  HARVESTED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  LOCKED_WITHDRAWAL: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};
const speciesLabel = (s: string) =>
  ({ POULTRY_BROILER: 'speciesBroiler', POULTRY_LAYER: 'speciesLayer', DUCK: 'speciesDuck', SWINE: 'speciesSwine', CATTLE: 'speciesCattle' })[s] ?? s;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString(fmtLocale()) : '—');
const fmtNum = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toLocaleString(fmtLocale(), { maximumFractionDigits: digits }));

const TABS = ['groups', 'medical', 'climate', 'production', 'biosecurity', 'finance'] as const;
type TabId = (typeof TABS)[number];

export default function LivestockPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const hasFeature = useFeatureStore((s) => s.has);
  const t = useLanguageStore((s) => s.t);
  const [tab, setTab] = useState<TabId>('groups');
  const [groups, setGroups] = useState<Group[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selId, setSelId] = useState<string>('');

  const canWrite = useCanWriteModules();

  const api = useCallback((path: string, init?: RequestInit) => authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/livestock${path}`, init), []);
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [gRes, dRes] = await Promise.all([api('/groups'), api('/dashboard')]);
      const g = await gRes.json();
      const d = await dRes.json();
      if (!gRes.ok || !dRes.ok) throw new Error(g.error || d.error || 'load failed');
      setGroups(g.groups ?? []);
      setSummary(d.summary ?? null);
    } catch (e: any) {
      setError(e.message || t('livestock.page.loadFailed', 'โหลดข้อมูลไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    if (isAuthenticated) loadAll();
  }, [isAuthenticated, loadAll]);

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  }
  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">{t('livestock.page.unauthorized', 'Unauthorized')}</div>;
  }

  const selected = groups.find((g) => g.id === selId) ?? null;

  return (
    <div className="atmo-nature min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-7xl mx-auto w-full">
          <PageHeader
            eyebrow={t('livestock.page.eyebrow', 'ชีวิต & การเงิน')}
            title={t('livestock.page.title', 'ปศุสัตว์')}
            subtitle={t('livestock.page.subtitle', '6 เสาหลัก ตั้งแต่เวชภัณฑ์ยันกำไรต่องวด')}
            icon={<Icon name="farm" size={18} />}
          />
          {/* Dashboard summary strip */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-center">
              <div className="card p-3"><div className="text-lg font-bold text-emerald-300">{summary.groups}</div><div className="text-[11px] text-gray-400">{t('livestock.dashboard.groups', 'กลุ่ม')}</div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${summary.quarantine > 0 ? 'text-red-400' : 'text-gray-300'}`}>{summary.quarantine}</div><div className="text-[11px] text-gray-400">{t('livestock.dashboard.quarantine', 'กักกัน')}</div></div>
              <div className="card p-3"><div className="text-lg font-bold text-amber-300">{summary.harvested}</div><div className="text-[11px] text-gray-400">{t('livestock.dashboard.harvested', 'จำหน่าย')}</div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${summary.lockedWithdrawal > 0 ? 'text-orange-400' : 'text-gray-300'}`}>{summary.lockedWithdrawal}</div><div className="text-[11px] text-gray-400">{t('livestock.dashboard.locked', 'ล็อกขาย')}</div></div>
              <div className="card p-3"><div className="text-lg font-bold text-gray-200">{summary.silos}</div><div className="text-[11px] text-gray-400">{t('livestock.dashboard.silos', 'ถังอาหาร')}</div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${summary.lowSilos > 0 ? 'text-amber-400' : 'text-gray-300'}`}>{summary.lowSilos}</div><div className="text-[11px] text-gray-400">{t('livestock.dashboard.lowSilos', 'ถังต่ำ <15%')}</div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${summary.latestThi != null && summary.latestThi > 84 ? 'text-red-400' : summary.latestThi != null && summary.latestThi > 74 ? 'text-amber-400' : 'text-gray-300'}`}>{fmtNum(summary.latestThi, 1)}</div><div className="text-[11px] text-gray-400">{t('livestock.dashboard.thiNow', 'THI ล่าสุด')}</div></div>
              <div className="card p-3"><div className={`text-lg font-bold ${(summary.netProfit ?? 0) < 0 ? 'text-red-400' : 'text-emerald-300'}`}>{fmtNum(summary.netProfit, 0)}</div><div className="text-[11px] text-gray-400">Net</div></div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex flex-wrap gap-2">
            {TABS.map((id) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${tab === id ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/50 glow-text' : 'bg-gray-900 text-gray-400 border-gray-700 hover:text-gray-200'}`}>
                {t('livestock.page.tab' + id[0].toUpperCase() + id.slice(1), id)}
              </button>
            ))}
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded px-4 py-2 text-sm">{error}</div>}
          {message && <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded px-4 py-2 text-sm">{message}</div>}

          {loading ? (
            <div className="text-gray-500 text-center py-12">{t('livestock.page.loading', 'กำลังโหลด…')}</div>
          ) : (
            <>
              {tab === 'groups' && <GroupsTab groups={groups} canWrite={canWrite} api={api} loadAll={loadAll} setMsg={setMessage} setErr={setError} t={t} setSel={setSelId} />}
              {tab === 'medical' && <MedicalTab groups={groups} canWrite={canWrite} api={api} loadAll={loadAll} setMsg={setMessage} setErr={setError} t={t} sel={selected} setSel={setSelId} />}
              {tab === 'climate' && <ClimateTab api={api} setMsg={setMessage} setErr={setError} t={t} />}
              {tab === 'production' && <ProductionTab groups={groups} canWrite={canWrite} api={api} loadAll={loadAll} setMsg={setMessage} setErr={setError} t={t} sel={selected} setSel={setSelId} />}
              {tab === 'biosecurity' && <BiosecurityTab canWrite={canWrite} api={api} setMsg={setMessage} setErr={setError} t={t} />}
              {tab === 'finance' && <FinanceTab groups={groups} canWrite={canWrite} api={api} loadAll={loadAll} setMsg={setMessage} setErr={setError} t={t} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function GroupSelect({ groups, selId, onChange, t }: any) {
  return (
    <select value={selId} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">{t('livestock.finance.noGroup', 'ไม่ผูกกลุ่ม')}</option>
      {groups.map((g: Group) => <option key={g.id} value={g.id}>{g.code}{g.name ? ` — ${g.name}` : ''}</option>)}
    </select>
  );
}

// ── Tab 1: กลุ่มปศุสัตว์ ──
function GroupsTab({ groups, canWrite, api, loadAll, setMsg, setErr, t, setSel }: any) {
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

// ── Tab 2: สุขภาพ & ยา ──
function MedicalTab({ groups, canWrite, api, loadAll, setMsg, setErr, t, sel, setSel }: any) {
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

// ── Tab 3: Climate & Fail-Safe ──
function ClimateTab({ api, setMsg, setErr, t }: any) {
  const [form, setForm] = useState({ tempC: '', rhPct: '', houseCode: '' });
  const [util, setUtil] = useState({ houseCode: '', gridPowerState: 'NORMAL', generatorState: 'OFF' });
  const [latest, setLatest] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [utilResult, setUtilResult] = useState<any>(null);

  const sendClimate = async () => {
    setErr(''); setMsg('');
    try {
      const body: Record<string, unknown> = { tempC: Number(form.tempC), rhPct: Number(form.rhPct) };
      if (form.houseCode) body.houseCode = form.houseCode;
      const r = await api('/climate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'send failed');
      setResult(d);
      setLatest(d.sample);
      setHistory((await (await api('/climate')).json()).history || []);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const sendUtility = async () => {
    setErr(''); setMsg('');
    try {
      const r = await api('/utility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(util) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'send failed');
      setUtilResult(d);
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const thiColor = (thi: number) => thi > 84 ? 'text-red-400' : thi > 74 ? 'text-amber-400' : 'text-emerald-300';

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="card panel-glow p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="thermometer" size={14} className="text-gray-400" />{t('livestock.climate.title', 'Microclimate & Ventilation Fail-Safe')}</div>
        <div className="grid grid-cols-3 gap-2">
          <input value={form.tempC} onChange={(e) => setForm({ ...form, tempC: e.target.value })} type="number" step="0.1" placeholder={t('livestock.climate.tempPlaceholder', 'อุณหภูมิ (°C)')} className="input" />
          <input value={form.rhPct} onChange={(e) => setForm({ ...form, rhPct: e.target.value })} type="number" step="0.1" placeholder={t('livestock.climate.rhPlaceholder', 'ความชื้น (%)')} className="input" />
          <input value={form.houseCode} onChange={(e) => setForm({ ...form, houseCode: e.target.value })} placeholder={t('livestock.climate.housePlaceholder', 'เล้า/คอก')} className="input" />
        </div>
        <button onClick={sendClimate} className="btn-primary">{t('livestock.climate.send', 'ส่งค่า → คำนวณ THI')}</button>

        {result && (
          <div className={`rounded-lg border p-3 text-sm ${result.level === 'critical' ? 'bg-red-950/40 border-red-700 text-red-200' : result.level === 'warn' ? 'bg-amber-950/40 border-amber-700 text-amber-200' : 'bg-emerald-950/40 border-emerald-700 text-emerald-200'}`}>
            <div className="flex items-center gap-2 font-bold">{t('livestock.climate.thi', 'THI')}: <span className={`text-xl glow-text ${thiColor(result.thi)}`}>{result.thi.toFixed(1)}</span></div>
            <div className="text-xs mt-1">
              {result.level === 'critical' ? t('livestock.climate.critical', 'วิกฤต! (THI > 84) — ระบายอากาศด่วน')
                : result.level === 'warn' ? t('livestock.climate.warn', 'เริ่มร้อน — เปิดพัดลม/พ่นหมอก')
                : t('livestock.climate.comfort', 'สบาย (COMFORT)')}
            </div>
            {result.actions?.length > 0 && <div className="text-[11px] mt-1 opacity-80">→ {result.actions.join(', ')}</div>}
          </div>
        )}

        {history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-sky-300 font-bold">{t('livestock.climate.history', 'ประวัติ THI (48 ตัวอย่างล่าสุด)')}</summary>
            <div className="flex flex-wrap gap-1.5 mt-2 max-h-40 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className={`text-[10px] px-1.5 py-0.5 rounded border ${h.thi > 84 ? 'bg-red-950/50 border-red-700 text-red-300' : h.thi > 74 ? 'bg-amber-950/50 border-amber-700 text-amber-300' : 'bg-gray-900 border-gray-700 text-gray-400'}`} title={`${h.tempC}°C ${h.rhPct}% ${h.at}`}>{h.thi.toFixed(1)}</div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="zap" size={14} className="text-gray-400" />{t('livestock.climate.utilityTitle', 'Utility Fail-Safe (ไฟ/เครื่องปั่น/ATS)')}</div>
        <div className="grid grid-cols-3 gap-2">
          <input value={util.houseCode} onChange={(e) => setUtil({ ...util, houseCode: e.target.value })} placeholder={t('livestock.climate.housePlaceholder', 'เล้า/คอก')} className="input" />
          <select value={util.gridPowerState} onChange={(e) => setUtil({ ...util, gridPowerState: e.target.value })} className="input">
            <option value="NORMAL">{t('livestock.climate.gridNormal', 'ปกติ (NORMAL)')}</option>
            <option value="BLACKOUT">{t('livestock.climate.gridBlackout', 'ไฟดับ (BLACKOUT)')}</option>
          </select>
          <select value={util.generatorState} onChange={(e) => setUtil({ ...util, generatorState: e.target.value })} className="input">
            <option value="OFF">{t('livestock.climate.genOff', 'ปิด (OFF)')}</option>
            <option value="RUNNING">{t('livestock.climate.genRunning', 'ทำงาน (RUNNING)')}</option>
            <option value="FAIL">{t('livestock.climate.genFail', 'เสีย (FAIL)')}</option>
          </select>
        </div>
        <button onClick={sendUtility} className="btn-primary">{t('livestock.climate.sendUtility', 'ส่งสถานะ')}</button>
        {utilResult && (
          <div className={`rounded-lg border p-3 text-sm ${utilResult.anomaly === 'CRITICAL' ? 'bg-red-950/40 border-red-700 text-red-200' : utilResult.anomaly === 'WARN' ? 'bg-amber-950/40 border-amber-700 text-amber-200' : 'bg-emerald-950/40 border-emerald-700 text-emerald-200'}`}>
            {utilResult.anomaly === 'CRITICAL' ? t('livestock.climate.anomalyCritical', 'วิกฤต! ไฟดับ + เครื่องปั่นไม่ทำงาน')
              : utilResult.anomaly === 'WARN' ? t('livestock.climate.anomalyWarn', 'ไฟดับ — เครื่องปั่นทำงาน')
              : t('livestock.climate.anomalyNone', 'ทุกอย่างปกติ')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 4: ผลผลิตประจำวัน ──
function ProductionTab({ groups, canWrite, api, loadAll, setMsg, setErr, t, sel, setSel }: any) {
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

// ── Tab 5: ชีวนิรภัย ──
function BiosecurityTab({ canWrite, api, setMsg, setErr, t }: any) {
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

// ── Tab 6: บัญชีงวด ──
function FinanceTab({ groups, canWrite, api, loadAll, setMsg, setErr, t }: any) {
  const [form, setForm] = useState({ batchCode: '', livestockGroupId: '', initialAnimalCost: '', totalFeedCost: '', totalMedCost: '', totalUtilityCost: '', totalRevenue: '' });
  const [batches, setBatches] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const r = await api('/batches');
      const d = await r.json();
      if (r.ok) setBatches(d.batches ?? []);
    } catch { /* ignore */ }
  };

  const save = async () => {
    if (!form.batchCode.trim()) return;
    setSaving(true); setErr(''); setMsg('');
    try {
      const num = (v: string) => (v === '' ? undefined : Number(v));
      const body: Record<string, unknown> = { batchCode: form.batchCode.trim() };
      if (form.livestockGroupId) body.livestockGroupId = form.livestockGroupId;
      for (const k of ['initialAnimalCost', 'totalFeedCost', 'totalMedCost', 'totalUtilityCost', 'totalRevenue'] as const) {
        const v = num(form[k]);
        if (v !== undefined) body[k] = v;
      }
      const r = await api('/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'save failed');
      setMsg(t('livestock.page.updated', 'อัปเดตสำเร็จ'));
      setForm({ batchCode: '', livestockGroupId: '', initialAnimalCost: '', totalFeedCost: '', totalMedCost: '', totalUtilityCost: '', totalRevenue: '' });
      load(); loadAll();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const closeBatch = async (id: string) => {
    try {
      const r = await api(`/batches/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ closedAt: new Date().toISOString() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'update failed');
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const totalRevenue = batches.reduce((s, b) => s + b.totalRevenue, 0);
  const totalCost = batches.reduce((s, b) => s + b.initialAnimalCost + b.totalFeedCost + b.totalMedCost + b.totalUtilityCost, 0);

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="card panel-glow p-4 space-y-3">
          <div className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="note" size={14} className="text-gray-400" />{t('livestock.finance.title', 'บัญชีงวด (Batch Financial Engine)')}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input value={form.batchCode} onChange={(e) => setForm({ ...form, batchCode: e.target.value })} placeholder={t('livestock.finance.batchCodePlaceholder', 'รหัสงวด *')} className="input" />
            <select value={form.livestockGroupId} onChange={(e) => setForm({ ...form, livestockGroupId: e.target.value })} className="input">
              <option value="">{t('livestock.finance.noGroup', 'ไม่ผูกกลุ่ม')}</option>
              {groups.map((g: Group) => <option key={g.id} value={g.id}>{g.code}</option>)}
            </select>
            <input value={form.initialAnimalCost} onChange={(e) => setForm({ ...form, initialAnimalCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costAnimal', 'ต้นทุนสัตว์')} className="input" />
            <input value={form.totalFeedCost} onChange={(e) => setForm({ ...form, totalFeedCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costFeed', 'ค่าอาหาร')} className="input" />
            <input value={form.totalMedCost} onChange={(e) => setForm({ ...form, totalMedCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costMed', 'ค่ายา')} className="input" />
            <input value={form.totalUtilityCost} onChange={(e) => setForm({ ...form, totalUtilityCost: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.costUtility', 'ค่าไฟ/น้ำ')} className="input" />
            <input value={form.totalRevenue} onChange={(e) => setForm({ ...form, totalRevenue: e.target.value })} type="number" min="0" placeholder={t('livestock.finance.revenue', 'รายได้')} className="input" />
          </div>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? '…' : t('livestock.finance.save', 'สร้างงวด')}</button>
        </div>
      )}

      <div className="card p-4 space-y-2">
        <div className="text-sm font-semibold text-gray-200">{t('livestock.finance.summary', 'สรุปบัญชี (ทุกงวด)')}</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-900 rounded p-3"><div className="text-lg font-bold text-emerald-300">{fmtNum(totalRevenue, 0)}</div><div className="text-[11px] text-gray-400">{t('livestock.finance.totalRevenue', 'รายได้รวม {n} บาท', { n: '' })}</div></div>
          <div className="bg-gray-900 rounded p-3"><div className="text-lg font-bold text-amber-300">{fmtNum(totalCost, 0)}</div><div className="text-[11px] text-gray-400">{t('livestock.finance.totalCost', 'ต้นทุนรวม {n} บาท', { n: '' })}</div></div>
          <div className="bg-gray-900 rounded p-3"><div className={`text-lg font-bold ${totalRevenue - totalCost < 0 ? 'text-red-400' : 'text-emerald-300'}`}>{fmtNum(totalRevenue - totalCost, 0)}</div><div className="text-[11px] text-gray-400">{t('livestock.finance.netProfit', 'กำไรสุทธิ')}</div></div>
        </div>
      </div>

      {batches.length === 0 && <div className="card"><div className="flex flex-col items-center justify-center text-center py-12 px-6 gap-3"><div className="w-12 h-12 rounded-xl border border-gray-700 bg-gray-800/40 flex items-center justify-center text-gray-400"><Icon name="farm" size={20} /></div><div className="text-sm font-bold text-gray-100">{t('livestock.finance.noBatches', 'ยังไม่มีงวดบัญชี')}</div></div></div>}
      {batches.map((b) => (
        <div key={b.id} className="card card-hover p-4 space-y-2">
          <div className="flex justify-between items-center">
            <div className="font-bold text-white">{b.batchCode}</div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${b.closedAt ? 'bg-gray-800 text-gray-400 border-gray-600' : 'bg-emerald-900/40 text-emerald-300 border-emerald-600/40'}`}>
                {b.closedAt ? t('livestock.finance.closed', 'ปิดงวด') : t('livestock.finance.open', 'ยังไม่ปิด')}
              </span>
              {!b.closedAt && canWrite && (
                <button onClick={() => closeBatch(b.id)} className="text-xs bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-600/40 rounded px-2 py-0.5">{t('livestock.finance.closeBtn', 'ปิดงวด')}</button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs text-gray-400">
            <div>{t('livestock.finance.costAnimal', 'ต้นทุนสัตว์')}: <span className="text-gray-200">{fmtNum(b.initialAnimalCost, 0)}</span></div>
            <div>{t('livestock.finance.costFeed', 'ค่าอาหาร')}: <span className="text-gray-200">{fmtNum(b.totalFeedCost, 0)}</span></div>
            <div>{t('livestock.finance.costMed', 'ค่ายา')}: <span className="text-gray-200">{fmtNum(b.totalMedCost, 0)}</span></div>
            <div>{t('livestock.finance.costUtility', 'ค่าไฟ/น้ำ')}: <span className="text-gray-200">{fmtNum(b.totalUtilityCost, 0)}</span></div>
            <div>{t('livestock.finance.revenue', 'รายได้')}: <span className="text-gray-200">{fmtNum(b.totalRevenue, 0)}</span></div>
          </div>
          <div className={`text-sm font-bold ${b.netProfit < 0 ? 'text-red-400' : 'text-emerald-300'}`}>
            {b.netProfit >= 0 ? t('livestock.finance.profit', 'กำไร {n} บาท', { n: fmtNum(b.netProfit, 0) }) : t('livestock.finance.loss', 'ขาดทุน {n} บาท', { n: fmtNum(-b.netProfit, 0) })}
          </div>
        </div>
      ))}
    </div>
  );
}
