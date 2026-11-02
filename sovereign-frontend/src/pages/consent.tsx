"use client";
import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import { getApiUrl } from '../lib/config';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

// ────────────────────────────────────────────────────────────────────────────
// /consent — ศูนย์ความยินยอม (PDPA) + สิทธิ์ลบข้อมูล
// ต้องมีก่อนเก็บข้อมูลลูกค้าจริง: ผู้ใช้ต้องเห็นว่าเก็บอะไร ใช้ทำอะไร และถอนได้
// ข้อมูลจาก GET/PUT /api/consent + GET /api/consent/history
// ────────────────────────────────────────────────────────────────────────────

interface ConsentPurpose {
  key: string;
  required: boolean;
  granted: boolean;
  updatedAt: string | null;
  labelTh: string;
  labelEn: string;
  detailTh: string;
}

interface ConsentPayload {
  policyVersion: string;
  purposes: ConsentPurpose[];
}

interface ConsentEventRow {
  purpose: string;
  action: string;
  policyVersion: string;
  source: string;
  at: string;
}

export default function ConsentPage() {
  const user = useAuthStore((s) => s.user);
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<ConsentPayload | null>(null);
  const [events, setEvents] = useState<ConsentEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [consentRes, historyRes] = await Promise.all([
        authFetch(`${getApiUrl()}/api/consent`),
        authFetch(`${getApiUrl()}/api/consent/history?limit=50`),
      ]);
      if (!consentRes.ok) throw new Error(`HTTP ${consentRes.status}`);
      setData(await consentRes.json());
      if (historyRes.ok) {
        const history = await historyRes.json();
        setEvents(Array.isArray(history.events) ? history.events : []);
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'load failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (purpose: ConsentPurpose) => {
      setBusy(purpose.key);
      setError(null);
      try {
        const res = await authFetch(`${getApiUrl()}/api/consent`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ purpose: purpose.key, granted: !purpose.granted }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        await load();
      } catch (e: any) {
        setError(e?.message ?? 'save failed');
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const deleteAccount = useCallback(async () => {
    setBusy('delete');
    setDeleteMsg(null);
    try {
      const res = await authFetch(`${getApiUrl()}/api/consent/account`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, confirm: confirmText }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setDeleteMsg(t('consent.deleteDone'));
      setPassword('');
      setConfirmText('');
    } catch (e: any) {
      setDeleteMsg(e?.message ?? 'delete failed');
    } finally {
      setBusy(null);
    }
  }, [password, confirmText, t]);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-200">
      <Sidebar />
      <main className="flex-1 p-6">
        <PageHeader title={t('consent.title')} subtitle={t('consent.subtitle')} />

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t('consent.purposesTitle')}</h2>
            {data && (
              <span className="text-xs text-slate-400">
                {t('consent.policyVersion')}: {data.policyVersion}
              </span>
            )}
          </div>
          <p className="mb-4 text-sm text-slate-400">{t('consent.purposesHint')}</p>

          <ul className="space-y-3">
            {(data?.purposes ?? []).map((purpose) => (
              <li
                key={purpose.key}
                className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">
                    {purpose.labelTh}
                    {purpose.required && (
                      <span className="ml-2 rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                        {t('consent.required')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{purpose.detailTh}</p>
                </div>
                <button
                  type="button"
                  disabled={purpose.required || busy === purpose.key}
                  onClick={() => void toggle(purpose)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    purpose.granted
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  } ${purpose.required ? 'cursor-not-allowed opacity-60' : 'hover:opacity-90'}`}
                >
                  {purpose.granted ? t('consent.granted') : t('consent.revoked')}
                </button>
              </li>
            ))}
          </ul>
          {!data && <p className="mt-3 text-sm text-slate-500">{t('consent.loading')}</p>}
        </section>

        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-3 text-base font-semibold">{t('consent.historyTitle')}</h2>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">{t('consent.historyEmpty')}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {events.map((event, idx) => (
                <li key={`${event.at}-${idx}`} className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0">
                  <span>
                    {event.purpose} ·{' '}
                    <span className={event.action === 'granted' ? 'text-emerald-300' : 'text-amber-300'}>
                      {event.action}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(event.at).toLocaleString()} · {event.policyVersion}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="mb-2 text-base font-semibold text-red-300">{t('consent.deleteTitle')}</h2>
          <p className="mb-4 text-sm text-slate-400">{t('consent.deleteHint')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('consent.passwordPlaceholder')}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={t('consent.confirmPlaceholder')}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm sm:w-48"
            />
            <button
              type="button"
              disabled={busy === 'delete' || !password || confirmText.trim().toUpperCase() !== 'DELETE'}
              onClick={() => void deleteAccount()}
              className="rounded-lg border border-red-500/40 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-200 disabled:opacity-50"
            >
              {t('consent.deleteButton')}
            </button>
          </div>
          {deleteMsg && <p className="mt-3 text-sm text-slate-300">{deleteMsg}</p>}
          <p className="mt-3 text-xs text-slate-500">
            {t('consent.signedInAs')}: {user?.username ?? '-'}
          </p>
        </section>
      </main>
    </div>
  );
}
