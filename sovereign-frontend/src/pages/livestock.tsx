"use client";
// pages/livestock.tsx — หน้าปศุสัตว์ (6 เสาหลัก)
// (FE-003: tab ทั้ง 6 + GroupSelect + constants ร่วมย้ายไป components/livestock/ และ lib/livestock-helpers.ts ตามเดิมทุกบรรทัด — ดูเทสต์ tools/test/livestock-page-budget-truth.test.mjs)
import { useState, useEffect, useCallback } from 'react';
import { useCanWriteModules } from '../lib/roles';
import { useAuthStore } from '../stores/useAuthStore';
import { useFeatureStore } from '../stores/useFeatureStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import GroupsTab from '../components/livestock/GroupsTab';
import MedicalTab from '../components/livestock/MedicalTab';
import ClimateTab from '../components/livestock/ClimateTab';
import ProductionTab from '../components/livestock/ProductionTab';
import BiosecurityTab from '../components/livestock/BiosecurityTab';
import FinanceTab from '../components/livestock/FinanceTab';
import { Group, TABS, TabId, fmtNum } from '../lib/livestock-helpers';

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
