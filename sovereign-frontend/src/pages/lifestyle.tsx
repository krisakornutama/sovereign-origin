"use client";
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';

// ═══ วิถีชีวิต — Phase 5 "Embracing Chaos" ═══
// ระบบออกแบบมาเพื่อ "ควบคุม" — หน้าที่ของหน้านี้คือออกแบบ "ช่องว่างแห่งความไม่ควบคุม"
// ภัยซ่อนเร้นระดับ Emergent:
//   1. ภูมิคุ้มกันถดถอย (Hygiene Hypothesis) → ต้องเปิดรับอากาศธรรมชาติทุกวัน
//   2. Goodhart's Law → ระบบห้ามลงโทษการใช้ชีวิต (Living Mode)
//   3. Circadian Drift → ตามจังหวะแสงจริงของโลก ไม่ปรับให้ "ราบรื่นเกินไป"
//   4. Sovereignty Tax → มองเห็นทุกงานบำรุงรักษา (Maintenance Radar)
//   5. Generational Concept Shift → วันไร้ระบบอัตโนมัติให้มือคนทำงานเอง

type ActionMsg = { type: 'success' | 'info' | 'error'; text: string };

const ACTION_STYLES: Record<ActionMsg['type'], string> = {
  success: 'bg-emerald-900/30 text-emerald-400 border-emerald-800',
  info: 'bg-amber-900/30 text-amber-300 border-amber-700',
  error: 'bg-red-900/30 text-red-400 border-red-800',
};

interface DayPlan {
  date: string;
  daylight: { sunrise: string; sunset: string; dayLengthMin: number };
  exposure: { recommendedMin: number; achievedMinToday: number; achievedMin7dAvg: number; status: string };
  temperature: { naturalIdealMinC: number; naturalIdealMaxC: number; driftC: number; note: string };
  light: { dimStart: string; blueCutoff: string; note: string };
  warnings: string[];
}

interface LivingModeState { active: boolean; by: string; at: number | null }
interface ManualDayState { active: boolean; by: string; at: number | null; note: string; endsAt: number | null; remainingMs: number | null }

type Tr = (path: string, fallback?: string, vars?: Record<string, string | number>) => string;

function fmtCountdown(ms: number, tr: Tr): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return tr('lifestyle.countdown', '{h} ชม. {m} นาที', { h, m });
}

function exposureBadge(status: string, tr: Tr): { label: string; cls: string } {
  switch (status) {
    case 'excellent': return { label: tr('lifestyle.exposure.excellent', 'เยี่ยม — ได้รับอากาศธรรมชาติครบ'), cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700' };
    case 'ok': return { label: tr('lifestyle.exposure.ok', 'พอใช้ — ถึงขั้นต่ำแล้ว'), cls: 'bg-blue-900/50 text-blue-300 border-blue-700' };
    case 'low': return { label: tr('lifestyle.exposure.low', 'น้อย — ยังไม่พอต่อภูมิคุ้มกัน'), cls: 'bg-amber-900/50 text-amber-300 border-amber-700' };
    default: return { label: tr('lifestyle.exposure.none', 'ยังไม่ได้เปิดรับเลย'), cls: 'bg-red-900/50 text-red-300 border-red-700' };
  }
}

export default function LifestylePage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const canToggle = user?.role === 'SUPERADMIN' || user?.role === 'NODE_ADMIN' || user?.role === 'OPERATOR';
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [living, setLiving] = useState<LivingModeState | null>(null);
  const [manual, setManual] = useState<ManualDayState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<ActionMsg | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [planRes, livingRes, manualRes] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/chaos-windows`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/living-mode`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/manual-day`),
      ]);
      const [planData, livingData, manualData] = await Promise.all([
        planRes.ok ? planRes.json() : null,
        livingRes.ok ? livingRes.json() : null,
        manualRes.ok ? manualRes.json() : null,
      ]);
      if (planData) setPlan(planData);
      if (livingData) setLiving(livingData);
      if (manualData) setManual(manualData);
    } catch {
      // เงียบ — ถ้า grant ยังไม่เปิด ปล่อยว่าง
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated) return;
    loadData();
    const iv = setInterval(loadData, 60000);
    return () => clearInterval(iv);
  }, [isHydrated, isAuthenticated, loadData]);

  const put = async (path: string, body: any, okMsg: string, errMsg: string) => {
    setBusy(path);
    setActionMsg(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/lifestyle/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || errMsg);
      if (path === 'living-mode') setLiving(data);
      if (path === 'manual-day') setManual(data);
      setActionMsg({ type: 'success', text: okMsg });
    } catch (e: any) {
      setActionMsg({ type: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  if (!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">{t('common.loading', 'กำลังโหลด...')}</div>;
  if (!isAuthenticated || !user) return <div className="text-white p-8">{t('lifestyle.unauthorized', 'Unauthorized')}</div>;

  const badge = plan ? exposureBadge(plan.exposure.status, t) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
            eyebrow={t('lifestyle.page.eyebrow', 'วิถีชีวิต · Phase 5 — Embracing Chaos')}
            title={t('lifestyle.page.title', 'วิถีชีวิต')}
            icon={<Icon name="lifestyle" size={18} />}
            subtitle={t('lifestyle.page.subtitle', 'ออกแบบช่องว่างแห่งความไม่ควบคุมโดยตั้งใจ — ระบบเกิดมาเพื่อรับใช้ชีวิต ไม่ใช่ชีวิตเพื่อรับใช้กราฟ')}
            actions={<Link href="/dashboard" scroll={false} className="text-sm text-sky-400 hover:underline">{t('lifestyle.page.backDashboard', '← กลับ Dashboard')}</Link>}
          />

        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-5xl mx-auto w-full">
          <div className="card panel-cyan p-4 text-xs text-gray-400 leading-relaxed">
            <b className="text-gray-200">{t('lifestyle.principles.title', 'หลักการ 5 ภัยซ่อนเร้น (Emergent Tier):')}</b>
            <br />{t('lifestyle.principles.p1Prefix', '① ')}<b>{t('lifestyle.principles.p1Bold', 'ภูมิคุ้มกันถดถอย')}</b>{t('lifestyle.principles.p1Rest', ' — บ้านสะอาดเกินไป ร่างกายไม่ได้ฝึก → ต้องเปิดรับธรรมชาติทุกวัน')}
            <br />{t('lifestyle.principles.p2Prefix', '② ')}<b>{t('lifestyle.principles.p2Bold', 'Goodhart\'s Law')}</b>{t('lifestyle.principles.p2Rest', ' — ชีวิตอย่าไปรับใช้ตัวชี้วัด → ระบบห้ามลงโทษการใช้ชีวิต')}
            <br />{t('lifestyle.principles.p3Prefix', '③ ')}<b>{t('lifestyle.principles.p3Bold', 'Circadian Drift')}</b>{t('lifestyle.principles.p3Rest', ' — ร่างกายผูกกับแสงจริง ไม่ใช่ "แสงที่ราบรื่นที่สุด"')}
            <br />{t('lifestyle.principles.p4Prefix', '④ ')}<b>{t('lifestyle.principles.p4Bold', 'Sovereignty Tax')}</b>{t('lifestyle.principles.p4Rest', ' — ทุกงานบำรุงต้องมองเห็นและกำหนดวันครบ')}
            <br />{t('lifestyle.principles.p5Prefix', '⑤ ')}<b>{t('lifestyle.principles.p5Bold', 'Generational Shift')}</b>{t('lifestyle.principles.p5Rest', ' — ต้องมีวันให้มือคนทำงานเอง')}
          </div>

          {actionMsg && <div className={`p-3 rounded text-sm border ${ACTION_STYLES[actionMsg.type]}`}>{actionMsg.text}</div>}

          {/* ① + ③ — Chaos Windows: จังหวะธรรมชาติของวันนี้ */}
          <div className="card panel-cyan p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5 glow-text-cyan"><Icon name="clock" size={14} className="text-gray-400" />{t('lifestyle.chaos.title', 'จังหวะธรรมชาติวันนี้')} <span className="text-xs text-gray-500 font-normal">{t('lifestyle.chaos.engine', '— Chaos Windows Engine')}</span></h2>
              {badge && <span className={`text-[10px] px-2 py-1 rounded border ${badge.cls}`}>{badge.label}</span>}
            </div>
            {plan ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center text-xs">
                  <div className="inset p-2"><div className="text-lg font-bold text-amber-300">{plan.daylight.sunrise}</div><div className="text-gray-500">{t('lifestyle.chaos.sunrise', 'พระอาทิตย์ขึ้น')}</div></div>
                  <div className="inset p-2"><div className="text-lg font-bold text-orange-300">{plan.daylight.sunset}</div><div className="text-gray-500">{t('lifestyle.chaos.sunset', 'พระอาทิตย์ตก')}</div></div>
                  <div className="inset p-2"><div className="text-lg font-bold text-blue-300">{t('lifestyle.chaos.dayLengthValue', '{n} นาที', { n: plan.daylight.dayLengthMin })}</div><div className="text-gray-500">{t('lifestyle.chaos.dayLength', 'กลางวันยาว')}</div></div>
                  <div className="inset p-2"><div className="text-lg font-bold text-emerald-300 glow-text">{plan.exposure.achievedMinToday}/{plan.exposure.recommendedMin}</div><div className="text-gray-500">{t('lifestyle.chaos.exposure', 'เปิดรับอากาศวันนี้ (นาที)')}</div></div>
                </div>
                <div className="inset p-3 space-y-2 text-xs">
                  <div><span className="text-gray-500">{t('lifestyle.chaos.light', 'แสง:')}</span>{t('lifestyle.chaos.lightDetail', ' เริ่มหรี่ {dim} · ตัดแสงสีฟ้า {cut} — ', { dim: plan.light.dimStart, cut: plan.light.blueCutoff })}<span className="text-gray-400">{plan.light.note}</span></div>
                  <div><span className="text-gray-500 flex items-center gap-1"><Icon name="thermometer" size={12} className="text-gray-400" />{t('lifestyle.chaos.temp', 'อุณหภูมิ:')}</span> <span className="text-gray-400">{plan.temperature.note}</span></div>
                  <div><span className="text-gray-500">{t('lifestyle.chaos.weekAvg', 'เฉลี่ย 7 วัน:')}</span>{t('lifestyle.chaos.weekAvgValue', ' {n} นาที/วัน (เป้า {target})', { n: plan.exposure.achievedMin7dAvg, target: plan.exposure.recommendedMin })}</div>
                </div>
                {plan.warnings.length > 0 && (
                  <div className="space-y-1.5">
                    {plan.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-amber-300 border border-amber-800/60 bg-amber-950/30 rounded px-3 py-2"><Icon name="alert-triangle" size={12} className="shrink-0 mt-0.5" />{w}</div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-600">{t('lifestyle.chaos.loadFailed', 'โหลดแผนจังหวะธรรมชาติไม่ได้ — ถ้าเพิ่งอัปเดต system ให้ลอง refresh')}</p>
            )}
          </div>

          {/* ② — Living Mode (Anti-Goodhart) */}
          <div className="card panel-glow p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('lifestyle.living.title', 'Living Mode')} <span className="text-xs text-gray-500 font-normal">{t('lifestyle.living.subtitle', '— ระบบห้ามลงโทษการใช้ชีวิต')}</span></h2>
              {living?.active && <span className="text-[10px] px-2 py-1 rounded bg-emerald-900/50 border border-emerald-700 text-emerald-300">{t('lifestyle.living.active', 'เปิดอยู่ (โดย {by})', { by: living.by?.slice(0, 8) ?? '' })}</span>}
            </div>
            <p className="text-xs text-gray-400">
              {t('lifestyle.living.intro', 'เมื่อเปิด: ระบบ')}<b className="text-gray-200">{t('lifestyle.living.silent', 'จะไม่เตือน ไม่ alert ไม่ส่ง Telegram')}</b>{t('lifestyle.living.silentRest', ' เรื่องร่องรอยการมีชีวิต — ควันจากการทำอาหาร ค่าไฟ เสียงเพลง อุณหภูมิความสบายของแต่ละคน เพราะ ')}
              <b className="text-emerald-300">{t('lifestyle.living.goodhart', 'คุณไม่ได้เกิดมาเพื่อทำกราฟให้สวย')}</b>{t('lifestyle.living.goodhartRest', ' (Goodhart\'s Law — ดัชนีเป็นเพียงภาพสะท้อน ไม่ใช่เป้าหมายของชีวิต)')}
            </p>
            {canToggle ? (
              <button
                onClick={() => put('living-mode', { active: !living?.active }, living?.active ? t('lifestyle.living.offMsg', 'Living Mode ปิด — ระบบกลับมาเฝ้าระวังเต็มที่') : t('lifestyle.living.onMsg', 'Living Mode เปิด — ระบบเงียบเรื่องการใช้ชีวิตแล้ว'), t('lifestyle.living.toggleFailed', 'เปลี่ยนสถานะไม่สำเร็จ'))}
                disabled={busy === 'living-mode'}
                className={living?.active ? 'btn-secondary' : 'btn-primary'}
              >
                {busy === 'living-mode' ? t('common.loading', 'กำลังโหลด...') : living?.active ? t('lifestyle.living.off', 'ปิด Living Mode') : t('lifestyle.living.on', 'เปิด Living Mode')}
              </button>
            ) : (
              <p className="text-[10px] text-gray-600">{t('lifestyle.living.adminOnly', 'เฉพาะ SUPERADMIN / NODE_ADMIN / OPERATOR เท่านั้น')}</p>
            )}
          </div>

          {/* ⑤ — Manual Day (Cognitive Grounding) */}
          <div className={`card panel-glow p-4 space-y-3 ${manual?.active ? 'border-amber-600' : ''}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-200 glow-text">
                {t('lifestyle.manual.title', 'Manual Day — วันไร้ระบบอัตโนมัติ')}
                {manual?.active && <span className="ml-2 inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />}
              </h2>
              {manual?.active && manual.remainingMs != null && (
                <span className="text-[10px] px-2 py-1 rounded bg-amber-900/60 border border-amber-700 text-amber-200">
                  {t('lifestyle.manual.activeBadge', 'ระบบอัตโนมัติพัก เหลือ {time} · เปิดโดย {by}', { time: fmtCountdown(manual.remainingMs, t), by: manual.by?.slice(0, 8) ?? '' })}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              <b className="text-gray-200">{t('lifestyle.manual.intro', 'วันนี้ ไฟฟ้า น้ำ ความปลอดภัย = งานของมือคน ไม่ใช่วิทยาศาสตร์')}</b>{t('lifestyle.manual.introRest', ' — พัก automation ทั้งบ้าน ให้เด็ก (และเราเอง) ได้กดสวิตช์จริง เปิดน้ำจริง เห็นว่าโลกกายภาพไม่ได้ตอบสนองเราอย่างมหัศจรรย์ (Generational Concept Shift — ลูกที่โตในบ้านอัตโนมัติจะเข้าใจว่าไฟฟ้ามีเองตลอด ถ้าไม่เคยเห็นมือคนทำงาน)')}
            </p>
            {canToggle && (
              <div className="flex flex-wrap gap-2 items-center">
                {!manual?.active && (
                  <button
                    onClick={() => {
                      if (!window.confirm(t('lifestyle.manual.confirm', 'เริ่ม Manual Day?\n\nระบบอัตโนมัติทั้งบ้านจะพัก 24 ชม. — เปิดไฟ/น้ำด้วยมือเองวันนี้ (หมดอายุอัตโนมัติ)'))) return;
                      put('manual-day', { active: true, note: 'วันไร้ระบบ' }, t('lifestyle.manual.started', 'Manual Day เริ่มแล้ว — เปิดไฟ เปิดน้ำด้วยมือเองนะ'), t('lifestyle.manual.startFailed', 'เริ่มไม่ได้'));
                    }}
                    disabled={busy === 'manual-day'}
                    className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-700 hover:bg-amber-600 text-white transition disabled:opacity-40"
                  >
                    {busy === 'manual-day' ? t('common.loading', 'กำลังโหลด...') : t('lifestyle.manual.start', 'เริ่ม Manual Day (24 ชม.)')}
                  </button>
                )}
                {manual?.active && (
                  <button
                    onClick={() => put('manual-day', { active: false, note: '' }, t('lifestyle.manual.restored', 'ระบบอัตโนมัติกลับมาทำงานแล้ว'), t('lifestyle.manual.restoreFailed', 'คืนระบบไม่ได้'))}
                    disabled={busy === 'manual-day'}
                    className="btn-secondary"
                  >
                    {busy === 'manual-day' ? t('common.loading', 'กำลังโหลด...') : t('lifestyle.manual.restore', 'คืนระบบอัตโนมัติ')}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ⑤ — Cognitive Grounding: บ้านทำงานยังไง (ให้เด็กเห็นเหตุผลจริง) */}
          <div className="card panel-cyan p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5 glow-text-cyan"><Icon name="home" size={14} className="text-gray-400" />{t('lifestyle.home.title', 'บ้านของเราทำงานยังไง')} <span className="text-xs text-gray-500 font-normal">{t('lifestyle.home.subtitle', '— ความโปร่งใสของโครงสร้างพื้นฐาน (สอนลูก)')}</span></h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="inset p-3 space-y-1">
                <div className="text-gray-500 flex items-center gap-1.5"><Icon name="zap" size={12} className="text-gray-400" />{t('lifestyle.home.electricity', 'ไฟฟ้ามาจากไหน?')}</div>
                <div className="text-gray-300">{t('lifestyle.home.electricityDesc', 'จากแผงโซลาร์ + แบตเตอรี่ + กริด (เมื่อจำเป็น) — ใช้แล้วหมด เห็นได้ที่หน้า Energy')}</div>
                <div className="text-gray-600">{t('lifestyle.home.electricityNote', 'ไม่ใช่วิทยาศาสตร์ล่องหน: เมื่อไฟติด = พลังงานถูกเปลี่ยนเป็นแสงจริง ๆ')}</div>
              </div>
              <div className="inset p-3 space-y-1">
                <div className="text-gray-500 flex items-center gap-1.5"><Icon name="droplet" size={12} className="text-gray-400" />{t('lifestyle.home.water', 'น้ำมาจากไหน?')}</div>
                <div className="text-gray-300">{t('lifestyle.home.waterDesc', 'จากถังเก็บ + น้ำฝน + บ่อ — เห็นระดับน้ำได้ที่หน้า Infrastructure → Water')}</div>
                <div className="text-gray-600">{t('lifestyle.home.waterNote', 'ฝึกคิด: เปิดทิ้งไว้ทั้งวัน = ถังว่างพรุ่งนี้')}</div>
              </div>
              <div className="inset p-3 space-y-1">
                <div className="text-gray-500 flex items-center gap-1.5"><Icon name="wind" size={12} className="text-gray-400" />{t('lifestyle.home.air', 'อากาศสะอาดจริงหรือ?')}</div>
                <div className="text-gray-300">{t('lifestyle.home.airDesc', 'เซ็นเซอร์วัด PM2.5/CO2 — แต่')}<b className="text-amber-300">{t('lifestyle.home.airDescBold', 'อากาศธรรมชาติก็สำคัญ')}</b>{t('lifestyle.home.airDescRest', ': เห็นช่องเปิดรับอากาศด้านบน')}</div>
                <div className="text-gray-600">{t('lifestyle.home.airNote', 'ความปลอดภัย = ฝึกกับโลกจริง ไม่ใช่กักอยู่ในฟองสบู่')}</div>
              </div>
            </div>
            <p className="text-[10px] text-gray-600">
              <span className="inline-flex items-center gap-1"><Icon name="star" size={11} className="text-amber-400" /></span>
              {t('lifestyle.home.tip', 'คำแนะนำ: เริ่ม Manual Day ในวันหยุด + ให้ลูกเปิดปิดไฟ/ประตูด้วยมือ แล้วชวนดูหน้าปัดพลังงาน ว่าการกดสวิตช์หนึ่งครั้ง = แบตเตอรี่ลดเท่าไหร่ — นี่คือบทเรียน "โครงสร้างทางความคิด" ที่ไม่มี dashboard ไหนสอนได้')}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}