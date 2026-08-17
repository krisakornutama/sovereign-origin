"use client";
import { useState } from 'react';
import Icon from '../ui/Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { fmtLocale } from '../../lib/formatDate';

export interface KillSwitchState {
  active: boolean;
  reason: string;
  by: string;
  at: number | null;
}

export default function KillSwitchCard({
  state,
  isSuperadmin,
  busy,
  onToggle,
}: {
  state: KillSwitchState | null;
  isSuperadmin: boolean;
  busy: boolean;
  onToggle: (active: boolean, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const t = useLanguageStore((s) => s.t);
  const active = !!state?.active;

  const engage = async () => {
    if (!window.confirm(t('securityComponents.killSwitch.confirmEngage', 'เปิด Kill-Switch?\n\nAI Agent ทุกตัว (chat, action tools, approvals) จะถูกหยุดทันทีทั่วทั้งระบบ โดยไม่ต้องรออนุมัติรายคำสั่ง'))) return;
    await onToggle(true, reason);
    setReason('');
  };

  const release = async () => {
    if (!window.confirm(t('securityComponents.killSwitch.confirmRelease', 'ปิด Kill-Switch?\n\nปลดล็อกให้ AI Agent ทำงานได้ตามปกติ'))) return;
    await onToggle(false, '');
  };

  return (
    <div className={`panel panel-glow p-4 space-y-3 ${active ? 'border-red-700/70' : ''}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-200 glow-text">
          {active ? t('securityComponents.killSwitch.titleActive', 'AI KILL-SWITCH — เปิดอยู่') : t('securityComponents.killSwitch.titleIdle', 'Emergency Kill-Switch')}
          <span className={`ml-2 inline-block w-3 h-3 rounded-full ${active ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
        </h2>
        {active && (
          <span className="text-[10px] px-2 py-1 rounded bg-red-900/60 border border-red-700 text-red-200">
            {t('securityComponents.killSwitch.enabledBy', 'โดย {by} · {time}', {
              by: state?.by || t('securityComponents.killSwitch.unknownBy', 'ไม่ทราบ'),
              time: state?.at ? new Date(state.at).toLocaleString(fmtLocale()) : '',
            })}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">
        {t('securityComponents.killSwitch.desc1', 'ปุ่มหยุดฉุกเฉิน (Global Override) — กดแล้ว AI Agent ทุกตัวหยุดทำงานทันที:')}
        {' '}{t('securityComponents.killSwitch.desc2', 'ปฏิเสธ action tool ทุกชนิด, ระงับการอนุมัติคำสั่งทั้งหมด, และ AI chat ตอบกลับด้วยข้อความแจ้งหยุด')}
        {active && state?.reason && <span className="text-red-300 glow-text-red">{t('securityComponents.killSwitch.reasonPrefix', ' — เหตุผล: {reason}', { reason: state.reason })}</span>}
      </p>
      {isSuperadmin && !active && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('securityComponents.killSwitch.placeholder', 'เหตุผล (เช่น พบ loop ผิดปกติ / เจอ prompt injection) — บังคับใส่')}
            className="flex-1 min-w-52 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs"
          />
          <button
            onClick={engage}
            disabled={busy || !reason.trim()}
            className="btn-danger text-xs px-3 py-1.5"
          >
            {busy ? t('common.loading', 'กำลังโหลด...') : <><Icon name="x-circle" size={12} /> {t('securityComponents.killSwitch.engage', 'เปิด Kill-Switch')}</>}
          </button>
        </div>
      )}
      {isSuperadmin && active && (
        <button
          onClick={release}
          disabled={busy}
          className="btn-primary text-xs px-3 py-1.5"
        >
          {busy ? t('common.loading', 'กำลังโหลด...') : <><Icon name="unlock" size={12} /> {t('securityComponents.killSwitch.release', 'ปลดล็อก (ปิด Kill-Switch)')}</>}
        </button>
      )}
      {!isSuperadmin && (
        <p className="text-[10px] text-gray-600">{t('securityComponents.killSwitch.superadminOnly', 'เฉพาะ SUPERADMIN เท่านั้นที่เปิด/ปิดสวิตช์นี้ได้')}</p>
      )}
    </div>
  );
}