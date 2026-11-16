"use client";

import { useId } from 'react';

/**
 * Field — ฟอร์ม 1 ช่องแบบมาตรฐาน (label + hint + error + a11y ครบ)
 *
 * ทำไมต้องมี: แต่ละหน้าเขียน <label> + <input> เอง ทำให้บางช่องไม่มี label,
 * ไม่ผูก htmlFor, และ error ไม่ถูกอ่านโดย screen reader
 *
 * ใช้แบบ render prop เพื่อให้ id/aria ถูกผูกอัตโนมัติ:
 *
 *   <Field label={t('x.name', 'ชื่อ')} hint="เช่น block-unknown" required error={err}>
 *     {(p) => <input {...p} value={v} onChange={...} className="input" />}
 *   </Field>
 */
export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
};

export default function Field({
  label,
  hint,
  error,
  required = false,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: FieldControlProps) => React.ReactNode;
}) {
  const autoId = useId();
  const id = `f-${autoId.replace(/[:]/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control: FieldControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  };

  return (
    <div className={`space-y-1 ${className}`}>
      <label htmlFor={id} className="block text-[11px] font-semibold tracking-wide text-gray-400">
        {label}
        {required && (
          <span className="ml-0.5 text-rose-400" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children(control)}
      {hint && (
        <p id={hintId} className="text-[11px] leading-relaxed text-gray-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[11px] leading-relaxed text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
