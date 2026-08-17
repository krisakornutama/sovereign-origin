"use client";

import Icon from './Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';

/**
 * ปุ่มสลับภาษาไทย/อังกฤษ — compact แสดงแค่ EN/ไทย (สำหรับ header/mobile)
 */
export default function LanguageToggle({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const { lang, setLang } = useLanguageStore();
  const next = lang === 'th' ? 'en' : 'th';
  return (
    <button
      onClick={() => setLang(next)}
      title={lang === 'th' ? 'English' : 'ไทย'}
      aria-label={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/70 text-gray-300 hover:border-cyan-800/60 hover:text-cyan-300 transition-colors px-2.5 py-1.5 text-xs font-medium cursor-pointer ${className}`}
    >
      <Icon name="globe" size={14} className={lang === 'en' ? 'text-cyan-400' : 'text-emerald-400'} />
      {compact ? (
        <span className="font-semibold">{lang === 'th' ? 'EN' : 'ไทย'}</span>
      ) : (
        <span>{lang === 'th' ? 'ไทย / EN' : 'EN / ไทย'}</span>
      )}
    </button>
  );
}