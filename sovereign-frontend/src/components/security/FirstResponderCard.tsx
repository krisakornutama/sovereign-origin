"use client";
import { useState } from 'react';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';

export interface FirstResponderState {
  active: boolean;
  by: string;
  at: number | null;
  note: string;
  expiresAt: number | null;
  remainingMs: number | null;
}

function fmtCountdown(ms: number, t: (path: string, fallback?: string, vars?: Record<string, string | number>) => string): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return t('securityComponents.firstResponder.countdown', '{m} นาที {s} วินาที', { m, s });
}

export default function FirstResponderCard({
  state,
  isSuperadmin,
  busy,
  onToggle,
}: {
  state: FirstResponderState | null;
  isSuperadmin: boolean;
  busy: boolean;
  onToggle: (active: boolean, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const t = useLanguageStore((s) => s.t);
  const active = !!state?.active;

  const engage = async () => {
    if (!window.confirm(t('securityComponents.firstResponder.confirmEngage', 'เปิด First-Responder Mode?\n\nปลดล็อกประตู (relay), หยุดการแจ้งเตือนคนแปลกหน้าจาก Vision AI — สำหรับรับหน่วยกู้ภัย/เจ้าหน้าที่เข้าบ้าน · หมดอายุอัตโนมัติใน 2 ชั่วโมง'))) return;
    await onToggle(true, note);
    setNote('');
  };

  const release = async () => {
    await onToggle(false, '');
  };

  return (
    <div className={`panel panel-glow p-4 space-y-3 ${active ? 'border-red-700/70' : ''}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">
          {active ? t('securityComponents.firstResponder.titleActive', 'FIRST-RESPONDER MODE — เปิดอยู่') : t('securityComponents.firstResponder.titleIdle', 'First-Responder Mode (SOS)')}
          {active && <span className="ml-2 inline-block w-3 h-3 rounded-full bg-red-500 animate-pulse" />}
        </h2>
        {active && (
          <span className="text-[10px] px-2 py-1 rounded bg-red-900/60 border border-red-700 text-red-200">
            {t('securityComponents.firstResponder.expiresBy', 'หมดอายุใน {time} · เปิดโดย {by}', {
              time: state?.remainingMs != null ? fmtCountdown(state.remainingMs, t) : '-',
              by: state?.by || '-',
            })}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        {t('securityComponents.firstResponder.desc1', 'โหมดรับมือเหตุฉุกเฉิน: ')}
        <b className="text-red-300 glow-text-red">{t('securityComponents.firstResponder.descBold', 'Vision AI หยุดแจ้งเตือน "คนแปลกหน้า" ทันที')}</b>
        {t('securityComponents.firstResponder.desc2', ' (หน่วยกู้ภัย/ตำรวจ/เจ้าหน้าที่จะไม่ถูกมองเป็นผู้บุกรุก)')}
        {' '}{t('securityComponents.firstResponder.desc3', '— เหมาะกับกรณีเรียก 1669/191/ดับเพลิง ระบบจะหมดอายุอัตโนมัติไม่ให้ลืมปิด')}
        {active && state?.note && <span className="text-red-300">{t('securityComponents.firstResponder.notePrefix', ' — หมายเหตุ: {note}', { note: state.note })}</span>}
      </p>
      {isSuperadmin && !active && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('securityComponents.firstResponder.placeholder', 'หมายเหตุ เช่น เรียกหน่วยกู้ภัย — อุบัติเหตุในบ้าน (ไม่บังคับ)')}
            className="flex-1 min-w-52 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
          />
          <button
            onClick={engage}
            disabled={busy}
            className="btn-danger text-xs px-3 py-1.5"
          >
            {busy ? t('common.loading', 'กำลังโหลด...') : <><Icon name="alert-triangle" size={12} /> {t('securityComponents.firstResponder.engage', 'เปิดโหมดฉุกเฉิน')}</>}
          </button>
        </div>
      )}
      {isSuperadmin && active && (
        <button
          onClick={release}
          disabled={busy}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          {busy ? t('common.loading', 'กำลังโหลด...') : <><Icon name="check" size={12} /> {t('securityComponents.firstResponder.release', 'ปิดโหมด (กลับสู่ปกติ)')}</>}
        </button>
      )}
      {!isSuperadmin && (
        <p className="text-[10px] text-gray-600">{t('securityComponents.firstResponder.superadminOnly', 'เฉพาะ SUPERADMIN เท่านั้นที่เปิด/ปิดโหมดนี้ได้')}</p>
      )}
    </div>
  );
}