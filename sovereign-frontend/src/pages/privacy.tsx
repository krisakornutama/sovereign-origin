"use client";
import { useEffect, useState } from 'react';
import { useLanguageStore } from '../stores/useLanguageStore';
import { getApiUrl } from '../lib/config';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

// ────────────────────────────────────────────────────────────────────────────
// /privacy — นโยบายความเป็นส่วนตัว (PDPA)
// ต้องอ่านได้ก่อนสมัคร/ก่อนให้ความยินยอม ⇒ endpoint นี้สาธารณะ (ไม่มีข้อมูลส่วนบุคคล)
// เวอร์ชันที่แสดงคือเวอร์ชันเดียวกับที่บันทึกในหลักฐานความยินยอม
// ────────────────────────────────────────────────────────────────────────────

interface PolicySection {
  id: string;
  title: string;
  paragraphs: string[];
  titleEn: string;
  paragraphsEn: string[];
}

interface PolicyPayload {
  version: string;
  effectiveDate: string;
  controller: { name: string | null; email: string | null; address: string | null };
  sections: PolicySection[];
}

export default function PrivacyPage() {
  const t = useLanguageStore((s) => s.t);
  const lang = useLanguageStore((s) => s.lang);
  const [data, setData] = useState<PolicyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/consent/policy`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (alive) setData(body);
      } catch (e: any) {
        if (alive) setError(e?.message ?? 'load failed');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isEn = lang === 'en';
  const missingController = data ? !data.controller.name || !data.controller.email : false;

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-200">
      <Sidebar />
      <main className="flex-1 p-6">
        <PageHeader title={t('privacy.title')} subtitle={t('privacy.subtitle')} />

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {data && (
          <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span>
                {t('privacy.version')}: <strong>{data.version}</strong>
              </span>
              <span>
                {t('privacy.effective')}: {data.effectiveDate}
              </span>
              <a href="/consent" className="text-sky-300 underline">
                {t('privacy.backToConsent')}
              </a>
            </div>
            {missingController && (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {t('privacy.controllerMissing')}
              </p>
            )}
          </div>
        )}

        <article className="max-w-3xl space-y-6">
          {(data?.sections ?? []).map((section) => (
            <section key={section.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <h2 className="mb-2 text-base font-semibold">{isEn ? section.titleEn : section.title}</h2>
              <ul className="space-y-2 text-sm leading-relaxed text-slate-300">
                {(isEn ? section.paragraphsEn : section.paragraphs).map((p, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-slate-600">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!data && !error && <p className="text-sm text-slate-500">{t('privacy.loading')}</p>}
        </article>
      </main>
    </div>
  );
}
