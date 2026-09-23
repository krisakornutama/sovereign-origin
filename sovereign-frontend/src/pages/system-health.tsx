"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { roleIsSuperadmin } from '../lib/roles';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

// ────────────────────────────────────────────────────────────────────────────
// /system-health — ความจริง runtime ฉบับเดียว เห็นได้ทันที (Phase 1 arch-hardening)
// โชว์: build fingerprint ที่ prod โหลดจริง · migration head · ผลเกตล่าสุด (arch-gate +
// prod-truth รวม) · การเทียบ "โค้ดบนดิสก์ ↔ ที่ prod รันอยู่" — จบเคส prod รันของเก่าเงียบ ๆ
// ข้อมูลจาก GET /api/health/truth (public) + รอบ verify ที่เขียน data/system-truth.json
// ────────────────────────────────────────────────────────────────────────────

interface TruthPayload {
  runtime: { fingerprint: string; files: number; loadedDir: string } | null;
  db: { migrationHead: string | null };
  lastGateRun: {
    writtenAt: string | null;
    ok: boolean;
    steps: Array<{ name: string; ok: boolean; skipped: boolean }>;
  } | null;
  disk: { fingerprint: string | null; files: number | null; dir: string | null } | null;
  codeMatch: boolean | null;
}

const Fp = ({ value }: { value: string | null | undefined }) => (
  <code className="px-1.5 py-0.5 rounded bg-gray-800/80 border border-gray-700 text-emerald-300 text-xs font-mono">
    {value ?? '—'}
  </code>
);

export default function SystemHealthPage() {
  const user = useAuthStore((s) => s.user);
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<TruthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/health/truth');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000); // รีเฟรชเบา ๆ ทุก 30 วิ
    return () => clearInterval(iv);
  }, [load]);

  if (!roleIsSuperadmin(user?.role)) {
    return (
      <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 p-8">
        {t('systemHealth.superadminOnly', 'หน้านี้ใช้ได้เฉพาะ SUPERADMIN')}
      </div>
    );
  }

  const matchBadge = () => {
    if (data?.codeMatch === null || data?.codeMatch === undefined) {
      return <span className="text-xs px-2 py-1 rounded-full bg-gray-700/40 text-gray-300 border border-gray-600">{t('systemHealth.noData', 'ยังไม่มีข้อมูลเทียบ — รัน npm run verify:full สักรอบ')}</span>;
    }
    return data.codeMatch ? (
      <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">✓ {t('systemHealth.match', 'prod รันโค้ดชุดเดียวกับดิสก์')}</span>
    ) : (
      <span className="text-xs px-2 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">✗ {t('systemHealth.mismatch', 'prod รันโค้ดเก่า! — rebuild + restart ก่อน deploy ต่อ')}</span>
    );
  };

  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }) : '—');

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow={t('systemHealth.eyebrow', 'ระบบ')}
          title={t('systemHealth.title', 'ความจริงระบบ')}
          icon={<Icon name="system" size={18} />}
          subtitle={t('systemHealth.subtitle', 'prod รันโค้ดชุดไหน · DB อยู่ migration ไหน · เกตล่าสุดผ่านไหม')}
          actions={matchBadge()}
        />
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-7xl mx-auto w-full">
          {loading && <div className="text-gray-400">{t('systemHealth.loading', 'กำลังโหลด…')}</div>}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300 text-sm">
              {t('systemHealth.loadError', 'โหลดข้อมูลไม่ได้')}: {error}
            </div>
          )}
          {data && !loading && (
            <>
              {/* แถว 1: การเทียบหลัก — runtime ↔ disk */}
              <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-3">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{t('systemHealth.codeSection', 'โค้ดที่รันอยู่ vs โค้ดบนดิสก์')}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg bg-gray-950/60 border border-gray-800 p-4 space-y-1">
                    <div className="text-xs text-gray-400">{t('systemHealth.runtime', 'Prod โหลดจาก')} {data.runtime?.loadedDir ?? '—'} ({data.runtime?.files ?? '—'} {t('systemHealth.files', 'ไฟล์')})</div>
                    <div className="flex items-center gap-2"><Fp value={data.runtime?.fingerprint} /><span className="text-[10px] text-gray-500">{t('systemHealth.runtimeFp', 'runtime')}</span></div>
                  </div>
                  <div className="rounded-lg bg-gray-950/60 border border-gray-800 p-4 space-y-1">
                    <div className="text-xs text-gray-400">{t('systemHealth.disk', 'ดิสก์')} · {data.disk?.dir ?? '—'} ({data.disk?.files ?? '—'} {t('systemHealth.files', 'ไฟล์')})</div>
                    <div className="flex items-center gap-2"><Fp value={data.disk?.fingerprint} /><span className="text-[10px] text-gray-500">{t('systemHealth.diskFp', 'verify ล่าสุด')}</span></div>
                  </div>
                </div>
                {data.codeMatch === false && (
                  <div className="text-xs text-red-300/90">{t('systemHealth.fixHint', '→ แก้ด้วย: npm run verify:full (verify จะ rebuild + restart prod ให้เอง)')}</div>
                )}
              </section>

              {/* แถว 2: DB + เกตล่าสุด */}
              <div className="grid gap-5 lg:grid-cols-2">
                <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-2">
                  <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{t('systemHealth.dbSection', 'ฐานข้อมูล')}</h2>
                  <div className="text-sm text-gray-300">
                    {t('systemHealth.migrationHead', 'Migration head')}:{' '}
                    <code className="px-1.5 py-0.5 rounded bg-gray-800/80 border border-gray-700 text-sky-300 text-xs font-mono">{data.db?.migrationHead ?? '—'}</code>
                  </div>
                  <div className="text-xs text-gray-500">{t('systemHealth.migrationHint', 'ถ้า head ไม่ตรงกับ migration ล่าสุดใน repo = ยังมี migration ไม่ได้ลงจริง')}</div>
                </section>

                <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{t('systemHealth.gateSection', 'เกตล่าสุด')}</h2>
                    {data.lastGateRun && (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${data.lastGateRun.ok ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>
                        {data.lastGateRun.ok ? t('systemHealth.gateOk', 'ผ่านทั้งหมด') : t('systemHealth.gateFail', 'มีขั้นพัง')}
                      </span>
                    )}
                  </div>
                  {data.lastGateRun ? (
                    <>
                      <div className="text-xs text-gray-500">{t('systemHealth.gateAt', 'รันเมื่อ')} {fmtTime(data.lastGateRun.writtenAt)}</div>
                      <ul className="space-y-1 mt-1">
                        {data.lastGateRun.steps.map((s) => (
                          <li key={s.name} className="flex items-center gap-2 text-sm">
                            <span className={s.skipped ? 'text-gray-500' : s.ok ? 'text-emerald-400' : 'text-red-400'}>{s.skipped ? '○' : s.ok ? '✓' : '✗'}</span>
                            <span className={s.skipped ? 'text-gray-500' : 'text-gray-300'}>{s.name}</span>
                            {s.skipped && <span className="text-[10px] text-gray-500">({t('systemHealth.skipped', 'ข้าม')})</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div className="text-sm text-gray-500">{t('systemHealth.noGateYet', 'ยังไม่เคยรัน verify บนเครื่องนี้ — รัน npm run verify แล้วกลับมาดูใหม่')}</div>
                  )}
                </section>
              </div>

              <div className="text-[11px] text-gray-600">
                {t('systemHealth.source', 'ที่มา')}: GET /api/health/truth ← data/system-truth.json (เขียนโดย tools/verify.mjs ทุกรอบ) · รีเฟรชอัตโนมัติ 30 วิ
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
