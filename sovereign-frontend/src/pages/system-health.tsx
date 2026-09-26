"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { roleIsSuperadmin } from '../lib/roles';
import { useLanguageStore } from '../stores/useLanguageStore';
import { authFetch } from '../lib/apiFetch';
import { getApiUrl } from '../lib/config';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';

// ────────────────────────────────────────────────────────────────────────────
// /system-health — ความจริง runtime ฉบับเดียว เห็นได้ทันที (Phase 1 arch-hardening)
// โชว์: build fingerprint ที่ prod โหลดจริง · migration head · ผลเกตล่าสุด (arch-gate +
// prod-truth รวม) · การเทียบ "โค้ดบนดิสก์ ↔ ที่ prod รันอยู่" — จบเคส prod รันของเก่าเงียบ ๆ
// ข้อมูลจาก GET /api/health/truth (public) + รอบ verify ที่เขียน data/system-truth.json
// ────────────────────────────────────────────────────────────────────────────

interface NightlyDay {
  day: string;
  ok: boolean;
  durationMin: number;
  lastGateOk: boolean | null;
  codeMatch: boolean | null;
  machineOk: boolean | null;
}

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
  nightlyHistory?: NightlyDay[] | null; // Phase 4: แนวโน้ม verify ย้อน 30 วัน
  // P0 ใช้งานง่าย (27/9): สายปฏิบัติการ — อายุ backup สด + task/nightly จาก snapshot ฝั่ง host
  ops?: OpsPayload | null;
}

interface OpsTask { name: string; label?: string; lastRun?: string; result: { ok: boolean; text: string } }
interface OpsPayload {
  checkedAt?: string;
  backup?: {
    dbLastAgeH: number | null;
    dbLastFile: string | null;
    offsiteLastAgeH: number | null;
    offsiteLastStatus: string | null;
    offsiteNote: string | null;
  };
  host?: {
    snapshotAt: string | null;
    watch: string[];
    tasks: OpsTask[] | null;
    nightly: { ok: boolean | null; finishedAt?: string; gateOk: boolean | null; codeMatch: boolean | null; failed: string[] } | null;
    note: string | null;
  };
}

const Fp = ({ value }: { value: string | null | undefined }) => (
  <code className="px-1.5 py-0.5 rounded bg-gray-800/80 border border-gray-700 text-emerald-300 text-xs font-mono">
    {value ?? '—'}
  </code>
);

// Phase 4: สี severity ของ alert (ใช้ร่วมกับ /alert-history)
const SEV_CLS: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

interface LatestAlert { id: string; severity: string; title: string; sent: boolean; suppressed: string | null; createdAt: string }

export default function SystemHealthPage() {
  const user = useAuthStore((s) => s.user);
  const t = useLanguageStore((s) => s.t);
  const [data, setData] = useState<TruthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Phase 4: alert ล่าสุด (โหลดเงียบ ๆ — 401/พัง = แสดง placeholder ไม่โชว์ error แดง)
  const [latestAlerts, setLatestAlerts] = useState<{ events: LatestAlert[]; error: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/health/truth`);
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

  // alert ล่าสุด 5 รายการ (soft-fail: ยังไม่ล็อกอิน/401 = ซ่อน)
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${getApiUrl()}/api/telegram/alerts?limit=5`);
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        setLatestAlerts({ events: j.events ?? [], error: false });
      } catch {
        setLatestAlerts({ events: [], error: true });
      }
    })();
  }, []);

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

              {/* P0 ใช้งานง่าย 27/9: สายปฏิบัติการครบจุดเดียว — backup สด + task scheduler + nightly ฝั่ง host */}
              {data.ops && (
                <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{t('systemHealth.opsSection', 'สายปฏิบัติการ — backup · task · nightly')}</h2>
                    <span className="text-xs text-gray-500">{t('systemHealth.opsAt', 'ตรวจเมื่อ')} {fmtTime(data.ops.checkedAt ?? null)}</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-lg bg-gray-950/60 border border-gray-800 p-3 space-y-1">
                      <div className="text-xs text-gray-400">{t('systemHealth.dbBackupLine', 'DB backup (เป้า 03:00 ทุกคืน)')}</div>
                      {(() => {
                        const age = data.ops?.backup?.dbLastAgeH;
                        const ok = age != null && age <= 26;
                        return (
                          <>
                            <div className={`text-sm ${age == null ? 'text-gray-400' : ok ? 'text-emerald-300' : 'text-red-300'}`}>
                              {age == null ? t('systemHealth.noBackup', 'ไม่พบไฟล์ backup') : `${t('systemHealth.agoH', 'ล่าสุด')} ${age} ${t('systemHealth.hours', 'ชม.')}`}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">{data.ops?.backup?.dbLastFile ?? '—'}</div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="rounded-lg bg-gray-950/60 border border-gray-800 p-3 space-y-1">
                      <div className="text-xs text-gray-400">{t('systemHealth.offsiteLine', 'Offsite → Telegram (เข้ารหัส AES-GCM)')}</div>
                      {(() => {
                        const age = data.ops?.backup?.offsiteLastAgeH;
                        const status = data.ops?.backup?.offsiteLastStatus;
                        const ok = age != null && age <= 26 && status !== 'failed';
                        return (
                          <>
                            <div className={`text-sm ${age == null ? 'text-gray-400' : ok ? 'text-emerald-300' : 'text-red-300'}`}>
                              {age == null ? (data.ops?.backup?.offsiteNote ?? '—') : `${t('systemHealth.agoH', 'ล่าสุด')} ${age} ${t('systemHealth.hours', 'ชม.')} · ${status ?? '—'}`}
                            </div>
                            {data.ops?.backup?.offsiteNote && <div className="text-[10px] text-amber-300/80 truncate">{data.ops.backup.offsiteNote}</div>}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {data.ops.host?.tasks && data.ops.host.tasks.length > 0 && (
                    <div className="rounded-lg bg-gray-950/60 border border-gray-800 p-3">
                      <div className="text-xs text-gray-400 mb-1">{t('systemHealth.tasksLine', 'Task Scheduler (ฝั่ง Windows — อัปเดตผ่าน snapshot)')}</div>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {data.ops.host.tasks.map((task) => (
                          <div key={task.name} className="flex items-center gap-2 text-xs" title={`${task.result.text}${task.lastRun ? ` · ${task.lastRun}` : ''}`}>
                            <span className={task.result.ok ? 'text-emerald-400' : 'text-red-400'}>{task.result.ok ? '✓' : '✗'}</span>
                            <span className="text-gray-300">{task.label ?? task.name}</span>
                            {!task.result.ok && <span className="text-[10px] text-red-300/80 truncate">{task.result.text}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {data.ops.host?.nightly && (
                    <div className="text-xs text-gray-400">
                      {t('systemHealth.nightlyLine', 'Nightly ล่าสุด')}:{' '}
                      <span className={data.ops.host.nightly.ok === true ? 'text-emerald-300' : 'text-red-300'}>
                        {data.ops.host.nightly.ok === true ? '✓ ผ่าน' : data.ops.host.nightly.ok === false ? '✗ พัง' : '—'}
                      </span>
                      {data.ops.host.nightly.failed.length > 0 && <span className="text-red-300/80"> · {data.ops.host.nightly.failed.join(', ')}</span>}
                    </div>
                  )}
                  {data.ops.host?.watch && data.ops.host.watch.length > 0 && (
                    <ul className="space-y-1">
                      {data.ops.host.watch.map((w, i) => (
                        <li key={i} className="text-xs text-amber-300/90">• {w}</li>
                      ))}
                    </ul>
                  )}
                  {data.ops.host?.note && <div className="text-[10px] text-gray-500">{data.ops.host.note}</div>}
                </section>
              )}

              {/* Phase 4: แนวโน้ม verify ย้อน 30 วัน — เห็นความเสถียรของระบบในหน้าเดียว */}
              {data.nightlyHistory && data.nightlyHistory.length > 0 && (
                <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{t('systemHealth.trendSection', 'แนวโน้ม verify ย้อน 30 วัน')}</h2>
                    <span className="text-xs text-gray-500">{data.nightlyHistory.filter((d) => d.ok).length}/{data.nightlyHistory.length} {t('systemHealth.trendOk', 'คืนที่ผ่าน')}</span>
                  </div>
                  {/* แถบวันต่อวัน: เขียว = verify ผ่าน · แดง = พัง · เทา = machine warn (ok แต่สภาพแวดล้อมเสี่ยง) · ช่องว่าง = ไม่มีข้อมูล */}
                  <div className="flex gap-1 flex-wrap">
                    {data.nightlyHistory.map((d) => (
                      <div key={d.day} title={`${d.day} · ${d.ok ? 'ผ่าน' : 'พัง'} · ${d.durationMin} นาที${d.machineOk === false ? ' · เครื่องมีปัญหา' : ''}`}
                        className={`w-5 h-8 rounded-sm border ${d.ok ? 'bg-emerald-500/40 border-emerald-500/50' : 'bg-red-500/50 border-red-500/60'} ${d.machineOk === false ? 'opacity-40' : ''}`} />
                    ))}
                  </div>
                  <div className="flex gap-4 text-[11px] text-gray-500">
                    <span>■ {t('systemHealth.trendOk', 'ผ่าน')}</span>
                    <span>■ {t('systemHealth.trendFail', 'พัง')}</span>
                    <span>{t('systemHealth.trendMachine', 'โปร่งใส = ผ่านแต่เครื่องมีปัญหา (ดิสก์/แรม)')}</span>
                  </div>
                </section>
              )}

              {/* Phase 4: alert ล่าสุด — สรุปจากตาราง alert_events (รายละเอียดเต็มที่ /alert-history) */}
              {latestAlerts && (
                <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">{t('systemHealth.alertsSection', 'แจ้งเตือนล่าสุด')}</h2>
                    <a href="/alert-history" className="text-xs text-cyan-300 hover:underline">{t('systemHealth.seeAllAlerts', 'ดูทั้งหมด →')}</a>
                  </div>
                  {latestAlerts.error ? (
                    <div className="text-xs text-gray-500">{t('systemHealth.alertsNeedLogin', 'ล็อกอิน SUPERADMIN เพื่อดูประวัติแจ้งเตือน')}</div>
                  ) : latestAlerts.events.length === 0 ? (
                    <div className="text-xs text-gray-500">{t('systemHealth.noAlerts', 'ไม่มี alert — ระบบเงียบสงบ')}</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {latestAlerts.events.slice(0, 5).map((ev) => (
                        <li key={ev.id} className="flex items-center gap-2 text-sm">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${SEV_CLS[ev.severity] ?? SEV_CLS.info}`}>{ev.severity}</span>
                          <span className="text-gray-300 truncate max-w-md">{ev.title}</span>
                          {!ev.sent && <span className="text-[10px] text-gray-500">({t('systemHealth.alertSuppressed', 'ยับ')}: {ev.suppressed ?? '—'})</span>}
                          <span className="ml-auto text-[10px] text-gray-500 whitespace-nowrap">{new Date(ev.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <div className="text-[11px] text-gray-600">
                {t('systemHealth.source', 'ที่มา')}: GET /api/health/truth ← data/system-truth.json + nightly-history.json (เขียนโดย tools/verify.mjs และ nightly runner) · รีเฟรชอัตโนมัติ 30 วิ
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
