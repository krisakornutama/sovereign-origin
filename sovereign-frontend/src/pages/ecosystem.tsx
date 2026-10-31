"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import AccountCard from '../components/ecosystem/AccountCard';
import AccountForm from '../components/ecosystem/AccountForm';
import {
  EMPTY_FORM,
  type AccountFormValues,
  type EcosystemAccount,
  type EcosystemCategory,
  type EcosystemPlatform,
  type EcosystemSummary,
} from '../components/ecosystem/types';
import { authFetch } from '../lib/apiFetch';
import { getApiUrl } from '../lib/config';
import { openExternal } from '../lib/openExternal';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';

const EMPTY_SUMMARY: EcosystemSummary = {
  total: 0,
  active: 0,
  withPassword: 0,
  missingPassword: 0,
  platforms: 0,
  stalePasswords: 0,
  linked: 0,
  unlinked: 0,
  byPlatform: {},
};

type ModalState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; account: EcosystemAccount };

export default function EcosystemPage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  // ใช้ getApiUrl() (ไม่ใช่ NEXT_PUBLIC_API_URL ตรง ๆ) — รองรับ API URL ที่ผู้ใช้ตั้งในหน้า Settings
  // และโหมดเปิดผ่านโดเมนสาธารณะ (same-origin → tunnel /api/*)
  const API = getApiUrl();

  const [accounts, setAccounts] = useState<EcosystemAccount[]>([]);
  const [summary, setSummary] = useState<EcosystemSummary>(EMPTY_SUMMARY);
  const [platforms, setPlatforms] = useState<EcosystemPlatform[]>([]);
  const [categories, setCategories] = useState<EcosystemCategory[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const [modal, setModal] = useState<ModalState>({ open: false });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');

  const revealTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  const hideReveal = useCallback((id: string) => {
    setRevealed((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const timer = revealTimers.current[id];
    if (timer) clearTimeout(timer);
    delete revealTimers.current[id];
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [accRes, catRes] = await Promise.all([
        authFetch(`${API}/api/ecosystem/accounts`),
        authFetch(`${API}/api/ecosystem/catalog`),
      ]);
      if (!accRes.ok) throw new Error(`accounts HTTP ${accRes.status}`);
      if (!catRes.ok) throw new Error(`catalog HTTP ${catRes.status}`);
      const accData = await accRes.json();
      const catData = await catRes.json();
      setAccounts(Array.isArray(accData.accounts) ? accData.accounts : []);
      setSummary(accData.summary || EMPTY_SUMMARY);
      setPlatforms(Array.isArray(catData.platforms) ? catData.platforms : []);
      setCategories(Array.isArray(catData.categories) ? catData.categories : []);
    } catch (err: any) {
      setError(`${err?.message || t('ecosystem.loadError', 'โหลดข้อมูล Ecosystem ไม่ได้')}`);
      setAccounts([]);
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [t, API]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    load();
  }, [isHydrated, isAuthenticated, load]);

  useEffect(
    () => () => {
      Object.values(revealTimers.current).forEach((timer) => clearTimeout(timer));
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const platformById = useMemo(() => new Map(platforms.map((p) => [p.id, p])), [platforms]);
  // Gmail = บัญชีหลัก: เลือกได้ในฟอร์ม + ใช้แสดงป้ายบนการ์ดลูก
  const primaries = useMemo(() => accounts.filter((a) => a.platform === 'gmail'), [accounts]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const primaryLabelOf = useCallback(
    (account: EcosystemAccount) => {
      const primary = account.primaryAccountId ? accountById.get(account.primaryAccountId) : null;
      if (!primary) return null;
      return primary.loginId ? primary.label + ' · ' + primary.loginId : primary.label;
    },
    [accountById],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = accounts.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (status !== 'all' && a.status !== status) return false;
      if (onlyMissing && a.hasPassword) return false;
      if (!q) return true;
      return [a.label, a.platformName, a.loginId, a.notes]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    // Gmail หลักขึ้นก่อนเสมอ แล้วเรียงบัญชีที่มีลูกมาก → น้อย
    return list.sort((a, b) => {
      const ga = a.platform === 'gmail' ? 1 : 0;
      const gb = b.platform === 'gmail' ? 1 : 0;
      if (ga !== gb) return gb - ga;
      return b.linkedCount - a.linkedCount;
    });
  }, [accounts, query, category, status, onlyMissing]);

  const reveal = useCallback(
    async (account: EcosystemAccount) => {
      if (revealed[account.id]) {
        hideReveal(account.id);
        return;
      }
      setBusyId(account.id);
      try {
        const res = await authFetch(`${API}/api/ecosystem/accounts/${account.id}/reveal`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setRevealed((prev) => ({ ...prev, [account.id]: String(data.password || '') }));
        revealTimers.current[account.id] = setTimeout(() => hideReveal(account.id), 30_000);
      } catch (err: any) {
        notify(err?.message || t('ecosystem.revealError', 'ขอรหัสผ่านไม่สำเร็จ'));
      } finally {
        setBusyId('');
      }
    },
    [revealed, hideReveal, notify, t, API],
  );

  const copyPassword = useCallback(
    async (account: EcosystemAccount) => {
      setBusyId(account.id);
      try {
        let password = revealed[account.id];
        if (!password) {
          const res = await authFetch(`${API}/api/ecosystem/accounts/${account.id}/reveal`, { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          password = String(data.password || '');
        }
        await navigator.clipboard.writeText(password);
        notify(t('ecosystem.copied', 'คัดลอกรหัสแล้ว — วางได้เลย'));
      } catch (err: any) {
        notify(err?.message || t('ecosystem.copyError', 'คัดลอกไม่สำเร็จ'));
      } finally {
        setBusyId('');
      }
    },
    [revealed, notify, t, API],
  );

  const openSite = useCallback(
    async (account: EcosystemAccount) => {
      setBusyId(account.id);
      try {
        const res = await authFetch(`${API}/api/ecosystem/accounts/${account.id}/open`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!openExternal(String(data.url || ''))) {
          throw new Error(t('ecosystem.badUrl', 'URL ไม่ถูกต้อง — ต้องเป็น http/https'));
        }
      } catch (err: any) {
        notify(err?.message || t('ecosystem.openError', 'เปิดเว็บไม่สำเร็จ'));
      } finally {
        setBusyId('');
      }
    },
    [notify, t, API],
  );

  const remove = useCallback(
    async (account: EcosystemAccount) => {
      const ok = window.confirm(
        t('ecosystem.confirmDelete', 'ลบบัญชี “{label}” ถาวร?').replace('{label}', account.label),
      );
      if (!ok) return;
      setBusyId(account.id);
      try {
        const res = await authFetch(`${API}/api/ecosystem/accounts/${account.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        hideReveal(account.id);
        notify(t('ecosystem.deleted', 'ลบบัญชีแล้ว'));
        await load();
      } catch (err: any) {
        notify(err?.message || t('ecosystem.deleteError', 'ลบไม่สำเร็จ'));
      } finally {
        setBusyId('');
      }
    },
    [hideReveal, load, notify, t, API],
  );

  const save = useCallback(
    async (values: AccountFormValues, removePassword: boolean) => {
      if (!modal.open) return;
      setSaving(true);
      setFormError('');
      try {
        const body: Record<string, unknown> = {
          platform: values.platform,
          label: values.label,
          url: values.url,
          loginId: values.loginId,
          notes: values.notes,
          status: values.status,
        };
        // Gmail เป็นหลักเสมอ — ไม่ส่ง primaryAccountId ของตัวมันเอง
        if (values.platform !== 'gmail') body.primaryAccountId = values.primaryAccountId || null;
        if (values.password) body.password = values.password;
        if (modal.mode === 'edit' && removePassword) body.removePassword = true;

        const res =
          modal.mode === 'create'
            ? await authFetch(`${API}/api/ecosystem/accounts`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              })
            : await authFetch(`${API}/api/ecosystem/accounts/${modal.account.id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setModal({ open: false });
        notify(modal.mode === 'create' ? t('ecosystem.created', 'เพิ่มบัญชีแล้ว') : t('ecosystem.saved', 'บันทึกแล้ว'));
        await load();
      } catch (err: any) {
        setFormError(err?.message || t('ecosystem.saveError', 'บันทึกไม่สำเร็จ'));
      } finally {
        setSaving(false);
      }
    },
    [modal, load, notify, t, API],
  );

  // ผูกบัญชีที่เพิ่มไว้ก่อนมีฟีเจอร์นี้ ให้เข้ากับ Gmail ที่อีเมลตรงกัน (กดครั้งเดียว)
  const autoLink = useCallback(async () => {
    setBusyId('auto-link');
    try {
      const res = await authFetch(`${API}/api/ecosystem/accounts/auto-link`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const linked = Number(data.linked) || 0;
      notify(
        linked > 0
          ? t('ecosystem.autoLinked', 'ผูกกับ Gmail ให้แล้ว {n} บัญชี').replace('{n}', String(linked))
          : t('ecosystem.autoLinkedNone', 'ไม่มีบัญชีใหม่ที่อีเมลตรงกับ Gmail'),
      );
      await load();
    } catch (err: any) {
      notify(err?.message || t('ecosystem.autoLinkError', 'ผูกอัตโนมัติไม่สำเร็จ'));
    } finally {
      setBusyId('');
    }
  }, [API, load, notify, t]);

  if (!isHydrated) {
    return <div className="p-8 text-white">{t('common.loading', 'กำลังโหลด...')}</div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-gray-950 p-8 text-gray-100">
        <p>{t('ecosystem.unauthorized', 'กรุณาเข้าสู่ระบบก่อนใช้งาน Ecosystem')}</p>
        <Link href="/" className="mt-3 inline-block text-sky-400 hover:underline">
          {t('common.backToLogin', 'กลับหน้าเข้าสู่ระบบ')}
        </Link>
      </div>
    );
  }

  const initialForm: AccountFormValues = modal.open && modal.mode === 'edit'
    ? {
        platform: modal.account.platform,
        label: modal.account.label,
        url: modal.account.url || '',
        loginId: modal.account.loginId,
        password: '',
        notes: modal.account.notes,
        status: modal.account.status,
        primaryAccountId: modal.account.primaryAccountId || '',
      }
    : EMPTY_FORM;

  return (
    <div className="atmo-system flex min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          eyebrow={t('ecosystem.eyebrow', 'ส่วนของผู้ใช้')}
          title={t('ecosystem.title', 'Ecosystem ของฉัน')}
          icon={<Icon name="globe" size={18} />}
          subtitle={t(
            'ecosystem.subtitle',
            'ทุก platform ที่คุณมี — กดเข้าเว็บได้ทันที และเก็บรหัสผ่านไว้อย่างปลอดภัย',
          )}
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={autoLink}
                disabled={loading || busyId === 'auto-link'}
                title={t('ecosystem.autoLinkHint', 'ผูกบัญชีที่อีเมลตรงกับ Gmail ให้อัตโนมัติ')}
              >
                <Icon name="key" size={14} />
                {t('ecosystem.autoLink', 'ผูกกับ Gmail')}
              </button>
              <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
                <Icon name="refresh" size={14} />
                {t('common.refresh', 'รีเฟรช')}
              </button>
              <button type="button" className="btn-primary" onClick={() => setModal({ open: true, mode: 'create' })}>
                <Icon name="plus" size={14} />
                {t('ecosystem.add', 'เพิ่มบัญชี')}
              </button>
            </div>
          }
        />

        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 p-4 lg:p-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="card p-4">
              <p className="text-[11px] text-gray-500">{t('ecosystem.summary.total', 'บัญชีทั้งหมด')}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-100">{summary.total}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {t('ecosystem.summary.active', 'ใช้งานอยู่')} {summary.active}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-[11px] text-gray-500">{t('ecosystem.summary.platforms', 'platform ที่เชื่อมแล้ว')}</p>
              <p className="mt-1 text-2xl font-semibold text-sky-300">{summary.platforms}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {t('ecosystem.summary.withPassword', 'มีรหัสแล้ว')} {summary.withPassword}
                {' · '}
                {t('ecosystem.summary.linked', 'ผูก Gmail แล้ว')} {summary.linked}
              </p>
            </div>
            <button
              type="button"
              className={'card p-4 text-left transition-colors ' + (onlyMissing ? 'border-amber-500/70' : '')}
              onClick={() => setOnlyMissing((v) => !v)}
              title={t('ecosystem.summary.missingHint', 'กดเพื่อดูเฉพาะบัญชีที่ยังไม่มีรหัส')}
            >
              <p className="text-[11px] text-gray-500">{t('ecosystem.summary.missing', 'ยังไม่มีรหัสผ่าน')}</p>
              <p className="mt-1 text-2xl font-semibold text-amber-300">{summary.missingPassword}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {onlyMissing ? t('ecosystem.summary.filterOn', 'กำลังกรองอยู่ — กดอีกครั้งเพื่อดูทั้งหมด') : t('ecosystem.summary.missingHint', 'กดเพื่อดูเฉพาะบัญชีที่ยังไม่มีรหัส')}
              </p>
            </button>
            <div className="card p-4">
              <p className="text-[11px] text-gray-500">{t('ecosystem.summary.stale', 'รหัสเก่าเกิน 180 วัน')}</p>
              <p className={'mt-1 text-2xl font-semibold ' + (summary.stalePasswords > 0 ? 'text-rose-300' : 'text-gray-100')}>
                {summary.stalePasswords}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {t('ecosystem.summary.staleHint', 'ควรเปลี่ยนเพื่อความปลอดภัย')}
              </p>
            </div>
          </section>

          <section className="card flex flex-wrap items-center gap-3 p-3">
            <div className="flex min-w-[220px] flex-1 items-center gap-2">
              <Icon name="search" size={15} />
              <input
                className="input w-full"
                value={query}
                placeholder={t('ecosystem.search', 'ค้นชื่อบัญชี / อีเมล / platform')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">{t('ecosystem.allCategories', 'ทุกหมวด')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">{t('ecosystem.allStatuses', 'ทุกสถานะ')}</option>
              <option value="active">{t('ecosystem.status.active', 'ใช้งาน')}</option>
              <option value="paused">{t('ecosystem.status.paused', 'พักไว้')}</option>
              <option value="archived">{t('ecosystem.status.archived', 'เก็บถาวร')}</option>
            </select>
            <span className="text-xs text-gray-500">
              {t('ecosystem.showing', 'แสดง')} {filtered.length}/{accounts.length}
            </span>
          </section>

          {error ? (
            <div className="rounded-xl border border-red-800/70 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error}
              <button type="button" className="ml-3 underline" onClick={load}>
                {t('common.retry', 'ลองอีกครั้ง')}
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card h-44 animate-pulse p-4" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-950/50 text-emerald-300">
                <Icon name="globe" size={26} />
              </span>
              <h2 className="text-base font-semibold text-gray-100">
                {accounts.length === 0
                  ? t('ecosystem.empty.title', 'ยังไม่มีบัญชีใน Ecosystem')
                  : t('ecosystem.emptyFilter.title', 'ไม่พบบัญชีที่ตรงกับตัวกรอง')}
              </h2>
              <p className="max-w-md text-sm text-gray-500">
                {accounts.length === 0
                  ? t('ecosystem.empty.body', 'เริ่มจากเพิ่ม Fiverr, Fastwork, YouTube, Gmail, Facebook หรือ LinkedIn — แล้วกดปุ่ม “เปิดเว็บ” ได้ทันทีจากที่นี่')
                  : t('ecosystem.emptyFilter.body', 'ลองล้างคำค้นหรือเปลี่ยนตัวกรอง')}
              </p>
              {accounts.length === 0 ? (
                <button type="button" className="btn-primary mt-1" onClick={() => setModal({ open: true, mode: 'create' })}>
                  <Icon name="plus" size={14} />
                  {t('ecosystem.addFirst', 'เพิ่มบัญชีแรก')}
                </button>
              ) : null}
            </div>
          ) : (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  platform={platformById.get(account.platform)}
                  primaryLabel={primaryLabelOf(account)}
                  revealed={revealed[account.id] || null}
                  busy={busyId === account.id}
                  onOpen={() => openSite(account)}
                  onReveal={() => (account.hasPassword ? reveal(account) : setModal({ open: true, mode: 'edit', account }))}
                  onCopy={() => copyPassword(account)}
                  onEdit={() => setModal({ open: true, mode: 'edit', account })}
                  onDelete={() => remove(account)}
                />
              ))}
            </section>
          )}

          <p className="text-center text-[11px] text-gray-600">
            {t(
              'ecosystem.footer',
              'รหัสผ่านถูกเข้ารหัส AES-256-GCM · แสดงได้ครั้งละ 30 วินาที · ทุกครั้งที่ขอดูถูกบันทึกใน Audit Log',
            )}
          </p>
        </main>
      </div>

      {modal.open ? (
        <AccountForm
          key={modal.mode === 'edit' ? modal.account.id : 'new'}
          mode={modal.mode}
          initial={initialForm}
          platforms={platforms}
          primaries={primaries}
          saving={saving}
          error={formError}
          onSubmit={save}
          onClose={() => {
            if (saving) return;
            setModal({ open: false });
            setFormError('');
          }}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-emerald-700/70 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-200 shadow-xl"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
