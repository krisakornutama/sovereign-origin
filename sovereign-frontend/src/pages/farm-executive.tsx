"use client";

// ─────────────────────────────────────────────────────────────
//  ภาพรวมฟาร์มสำหรับผู้บริหาร — ตอบคำถาม "วันนี้ต้องตัดสินใจอะไร"
//  รวม KPI ฟาร์ม + ปศุสัตว์ + ความเสี่ยงจาก /api/farm/executive
//  ทุกความเสี่ยงมี "สิ่งที่ต้องทำ" และลิงก์ไปหน้าที่แก้ได้
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import { authFetch } from '../lib/apiFetch';
import { useAuthStore } from '../stores/useAuthStore';

type Severity = 'critical' | 'warning' | 'info';

interface Risk {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  action: string;
  link: string;
}

interface Kpis {
  plots: number;
  growing: number;
  upcomingHarvests7d: number;
  overdueHarvests: number;
  animals: number;
  groups: number;
  quarantineGroups: number;
  animalsInWithdrawal: number;
  vaccineOverdue: number;
  silosLow: number;
  latestThi: number | null;
  thiStatus: string | null;
  mortality7d: number;
  criticalRisks: number;
}

interface Executive {
  generatedAt: string;
  kpis: Kpis;
  risks: Risk[];
}

const SEVERITY_STYLE: Record<Severity, { label: string; box: string; dot: string }> = {
  critical: { label: 'วิกฤต', box: 'border-rose-500/40 bg-rose-500/[0.07]', dot: 'bg-rose-400' },
  warning: { label: 'เฝ้าระวัง', box: 'border-amber-500/40 bg-amber-500/[0.07]', dot: 'bg-amber-400' },
  info: { label: 'ข้อมูล', box: 'border-sky-500/30 bg-sky-500/[0.05]', dot: 'bg-sky-400' },
};

function KpiCard({ label, value, hint, tone = 'default' }: { label: string; value: string | number; hint?: string; tone?: 'default' | 'alert' | 'ok' }) {
  const toneClass =
    tone === 'alert' ? 'text-rose-300 border-rose-500/30' : tone === 'ok' ? 'text-emerald-300 border-emerald-500/30' : 'text-gray-100 border-gray-700';
  return (
    <div className={`rounded-xl border ${toneClass} bg-gray-900/40 px-4 py-3`}>
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-xl font-bold tracking-tight">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function FarmExecutivePage() {
  const { user, isAuthenticated, isHydrated } = useAuthStore();
  const [data, setData] = useState<Executive | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/farm/executive`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setData(await res.json());
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    load()
      .catch((err) => {
        console.error(err);
        setError('โหลดภาพรวมฟาร์มไม่สำเร็จ — ตรวจว่า backend เปิดอยู่');
      })
      .finally(() => setLoading(false));
  }, [isAuthenticated, user, load]);

  if (!isHydrated) return null;

  const k = data?.kpis;
  const critical = data?.risks.filter((r) => r.severity === 'critical') ?? [];
  const rest = data?.risks.filter((r) => r.severity !== 'critical') ?? [];

  return (
    <div className="min-h-screen flex bg-[#05070a]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow="ฟาร์ม & ทรัพยากร"
          title="ภาพรวมฟาร์ม (ผู้บริหาร)"
          subtitle="รวมแปลงพืช ปศุสัตว์ อาหาร และภูมิอากาศไว้ที่เดียว — เรียงตามสิ่งที่ต้องตัดสินใจก่อน"
          icon={<Icon name="farm" size={18} />}
          actions={
            <button
              onClick={() => {
                setLoading(true);
                load().catch(() => setError('รีเฟรชไม่สำเร็จ')).finally(() => setLoading(false));
              }}
              className="btn-secondary"
            >
              <Icon name="refresh" size={14} /> รีเฟรช
            </button>
          }
        />

        <main className="p-4 md:p-8 pt-0 space-y-5">
          {loading && !data && <div className="text-sm text-gray-400">กำลังโหลด…</div>}
          {error && <div className="text-sm text-rose-300 border border-rose-500/30 rounded-lg px-4 py-3">{error}</div>}

          {k && (
            <>
              <div data-testid="farm-kpi-grid" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard label="แปลงที่ยังผลิต" value={k.growing} hint={`ทั้งหมด ${k.plots} แปลง`} />
                <KpiCard label="ใกล้เก็บเกี่ยว (7 วัน)" value={k.upcomingHarvests7d} hint={`เลยกำหนด ${k.overdueHarvests}`} tone={k.overdueHarvests > 0 ? 'alert' : 'default'} />
                <KpiCard label="สัตว์คงเหลือ" value={k.animals} hint={`${k.groups} กลุ่ม`} />
                <KpiCard label="ติดระยะหยุดยา" value={k.animalsInWithdrawal} hint="ห้ามขาย/แปรรูป" tone={k.animalsInWithdrawal > 0 ? 'alert' : 'ok'} />
                <KpiCard label="วัคซีนเกินกำหนด" value={k.vaccineOverdue} tone={k.vaccineOverdue > 0 ? 'alert' : 'ok'} hint={`กักกัน ${k.quarantineGroups} กลุ่ม`} />
                <KpiCard
                  label="THI ล่าสุด"
                  value={k.latestThi === null ? '—' : k.latestThi.toFixed(1)}
                  hint={k.thiStatus ?? 'ยังไม่มีข้อมูลภูมิอากาศ'}
                  tone={k.latestThi !== null && k.latestThi >= 78 ? 'alert' : 'default'}
                />
              </div>

              <div data-testid="farm-kpi-grid-secondary" className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <KpiCard label="ไซโลต่ำกว่าเกณฑ์" value={k.silosLow} tone={k.silosLow > 0 ? 'alert' : 'ok'} hint="ต่ำกว่า 15% = วิกฤต" />
                <KpiCard label="ตายใน 7 วัน" value={k.mortality7d} hint="รวมทุกกลุ่มที่ยังผลิต" tone={k.mortality7d > 0 ? 'alert' : 'ok'} />
                <KpiCard label="ความเสี่ยงวิกฤต" value={k.criticalRisks} tone={k.criticalRisks > 0 ? 'alert' : 'ok'} hint={`จากทั้งหมด ${data.risks.length} รายการ`} />
              </div>

              {data.risks.length === 0 ? (
                <EmptyState
                  icon={<Icon name="farm" size={20} />}
                  title="ยังไม่มีความเสี่ยงที่ต้องตัดสินใจ"
                  description="เมื่อมีแปลงใกล้เก็บเกี่ยว สัตว์ติดหยุดยา วัคซีนเกินกำหนด หรือไซโลใกล้หมด รายการจะขึ้นที่นี่"
                  action={
                    <Link href="/farm" className="btn-secondary">
                      ไปที่แปลงเกษตร
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {[...critical, ...rest].map((risk) => {
                    const style = SEVERITY_STYLE[risk.severity];
                    return (
                      <div
                        key={risk.id}
                        data-testid="risk-card"
                        data-severity={risk.severity}
                        className={`rounded-xl border ${style.box} px-4 py-3`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`mt-1.5 w-2 h-2 rounded-full ${style.dot} shrink-0`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] uppercase tracking-wider text-gray-400">{style.label}</span>
                              <h3 className="text-sm font-bold text-gray-100">{risk.title}</h3>
                            </div>
                            <p className="text-[12px] text-gray-400 mt-1">{risk.detail}</p>
                            <p className="text-[12px] text-emerald-300/90 mt-1.5">
                              <Icon name="check" size={12} className="inline mr-1" />
                              {risk.action}
                            </p>
                          </div>
                          <Link data-testid="risk-link" href={risk.link} className="text-[12px] text-gray-300 hover:text-emerald-300 whitespace-nowrap">
                            เปิดหน้า →
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
