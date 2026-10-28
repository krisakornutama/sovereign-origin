"use client";

import { useLanguageStore } from '../../stores/useLanguageStore';
import { explainError, retryLabel } from '../../lib/actionableError';
import Icon from './Icon';

/**
 * กล่อง error ที่ "บอกทางแก้" ไม่ใช่แค่บอกว่าพัง
 *
 * ทำไมต้องมี: เดิมแต่ละหน้าโชว์ error ดิบ ๆ ("Failed to fetch", "HTTP 500", "P2021")
 * แล้วจบ — คนในบ้านอ่านแล้วไม่รู้ว่าต้องไปทำอะไรต่อ
 * ตัวนี้แปลงผ่าน explainError() แล้วแสดงสองบรรทัด: เกิดอะไร + ต้องทำอะไร
 *
 * a11y: role="alert" ⇒ screen reader อ่านทันทีเมื่อเกิด error
 *       ปุ่ม "ลองอีกครั้ง" โผล่เฉพาะเมื่อการลองซ้ำมีโอกาสสำเร็จ (retryable) และมี onRetry จริง
 */
export default function ErrorNotice({
  error,
  onRetry,
  className = '',
}: {
  /** อะไรก็ได้ที่จับได้จาก fetch/try-catch — Error, Response, status number, string */
  error: unknown;
  /** ปุ่ม "ลองอีกครั้ง" — ไม่ส่งมา = ไม่แสดงปุ่ม */
  onRetry?: () => void;
  className?: string;
}) {
  const lang = useLanguageStore((s) => s.lang);
  const help = explainError(error, lang === 'en' ? 'en' : 'th');

  // ไม่มี error = ไม่ต้องกินพื้นที่จอ
  if (error === null || error === undefined || error === '') return null;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 ${className}`}
    >
      <span className="mt-0.5 shrink-0 text-red-400">
        <Icon name="alert-triangle" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-red-100">{help.what}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-red-200/80">{help.fix}</div>
      </div>
      {help.retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-red-400/40 bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-100 hover:bg-red-500/30"
        >
          {retryLabel(lang === 'en' ? 'en' : 'th')}
        </button>
      )}
    </div>
  );
}
