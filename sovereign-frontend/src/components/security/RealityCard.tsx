"use client";
import { useState } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';

export interface RealityCorrection {
  id: string;
  kind: 'false_positive' | 'false_negative' | 'context';
  note: string;
  by: string;
  ts: number;
  source_type?: string;
  source_event_id?: string;
}

export interface RealityStats {
  corrections30d: number;
  falsePositives30d: number;
  falseNegatives30d: number;
  alerts30d: number;
  paranoiaIndex: number;
  calibration: 'calibrated' | 'watch' | 'unstable';
  latest: RealityCorrection[];
}

const CALIB: Record<RealityStats['calibration'], { label: string; cls: string }> = {
  calibrated: { label: 'Calibrated — AI ยังเชื่อถือได้', cls: 'text-emerald-400 border-emerald-600 bg-emerald-950/40' },
  watch: { label: 'Watch — AI เตือนผิดบ่อยขึ้น ควรสังเกต', cls: 'text-amber-400 border-amber-600 bg-amber-950/40' },
  unstable: { label: 'UNSTABLE — AI เตือนผิดเกินเกณฑ์ ลด sensitivity', cls: 'text-red-400 border-red-600 bg-red-950/40' },
};

const KIND_LABEL: Record<RealityCorrection['kind'], string> = {
  false_positive: 'AI เตือนผิด (ไม่ใช่ภัย)',
  false_negative: 'AI พลาด (ควรเตือน)',
  context: 'ข้อมูลบริบทเพิ่มเติม',
};

export default function RealityCard({
  stats,
  busy,
  onCorrect,
}: {
  stats: RealityStats | null;
  busy: boolean;
  onCorrect: (kind: RealityCorrection['kind'], note: string, sourceType?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<RealityCorrection['kind']>('false_positive');
  const [note, setNote] = useState('');
  const t = useLanguageStore((s) => s.t);

  if (!stats) return null;
  const c = CALIB[stats.calibration];

  return (
    <div className="panel panel-cyan p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">Reality-Check · Paranoia Index</h2>
        <span className={`text-[10px] px-2 py-1 rounded border ${c.cls}`}>{t(`securityComponents.reality.calib.${stats.calibration}`, c.label)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-amber-400 glow-text">{stats.paranoiaIndex.toFixed(3)}</div>
          <div className="text-[10px] text-gray-500">{t('securityComponents.reality.paranoiaIndexLabel', 'Paranoia Index (เตือนผิด/alert)')}</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-red-400 glow-text-red">{stats.falsePositives30d}</div>
          <div className="text-[10px] text-gray-500">{t('securityComponents.reality.falsePositives30d', 'เตือนผิด 30 วัน')}</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-blue-400 glow-text-cyan">{stats.alerts30d}</div>
          <div className="text-[10px] text-gray-500">{t('securityComponents.reality.alerts30d', 'Alert ทั้งหมด 30 วัน')}</div>
        </div>
        <div className="rounded bg-gray-800 p-2">
          <div className="text-xl font-bold text-gray-200 glow-text">{stats.corrections30d}</div>
          <div className="text-[10px] text-gray-500">{t('securityComponents.reality.corrections30d', 'คำยืนยันจากครอบครัว')}</div>
        </div>
      </div>
      <p className="text-[10px] text-gray-500">
        {t('securityComponents.reality.explain', 'Paranoia Index = สัดส่วนที่ AI เตือนผิดเมื่อเทียบกับ alert ทั้งหมดใน 30 วัน')}
        {stats.paranoiaIndex > 0.4 && (
          <span className="text-red-400">{t('securityComponents.reality.overThreshold', ' — เกิน 0.4 แล้ว! แนะนำให้ SUPERADMIN ลดความไวของระบบ (เช่น raise confidence_min ใน Vision/Firewall rules)')}</span>
        )}
        {t('securityComponents.reality.anchorNote', 'ข้อมูลนี้ยังถูกส่งให้ AI อ่านก่อนตอบคำถามทุกครั้ง (reality anchor) เพื่อกันไม่ให้ AI ติดหลงเชื่อการเตือนที่ผิดซ้ำ ๆ')}
      </p>
      <div className="log-stream space-y-1.5 max-h-32 overflow-y-auto">
        {stats.latest.length === 0 && <p className="text-[10px] text-gray-600">{t('securityComponents.reality.empty', 'ยังไม่มีการยืนยัน — เมื่อเห็น alert ที่ "AI เข้าใจผิด" ให้กดปุ่มในตารางเหตุการณ์ หรือแจ้งที่นี่')}</p>}
        {stats.latest.map((l) => (
          <div key={l.id} className="flex items-start gap-2 text-[11px]">
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] ${l.kind === 'false_positive' ? 'bg-red-900/60 text-red-300' : l.kind === 'false_negative' ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>
              {t(`securityComponents.reality.kind.${l.kind}`, KIND_LABEL[l.kind])}
            </span>
            <span className="text-gray-300 break-all">{l.note}</span>
            <span className="shrink-0 text-gray-600 ml-auto">{(l.by || 'system').slice(0, 8)} · {new Date(l.ts).toLocaleTimeString(fmtLocale())}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as RealityCorrection['kind'])}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
        >
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{t(`securityComponents.reality.kind.${k}`, v)}</option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('securityComponents.reality.placeholder', 'เช่น นี่คือช่างที่เราจ้างมาซ่อมกล้อง ไม่ใช่ผู้บุกรุก')}
          className="flex-1 min-w-52 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
        />
        <button
          onClick={async () => {
            if (!note.trim()) return alert(t('securityComponents.reality.alertNote', 'ใส่รายละเอียดก่อน'));
            await onCorrect(kind, note.trim());
            setNote('');
          }}
          disabled={busy}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          {busy ? t('common.loading', 'กำลังโหลด...') : t('securityComponents.reality.confirm', 'ยืนยัน (reality anchor)')}
        </button>
      </div>
    </div>
  );
}