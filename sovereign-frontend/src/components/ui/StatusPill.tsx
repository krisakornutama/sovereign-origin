"use client";

/**
 * ป้ายสถานะ — จุดสี + ข้อความ ใช้บอกสถานะแบบสม่ำเสมอทั้งแอป
 * variant: ok (เขียว) / warn (เหลือง) / err (แดง) / off (เทา)
 */
const VARIANTS = {
  ok: 'text-emerald-400 border-emerald-700/50 bg-emerald-900/30',
  warn: 'text-amber-400 border-amber-700/50 bg-amber-900/30',
  err: 'text-rose-400 border-rose-700/50 bg-rose-900/30',
  off: 'text-gray-400 border-gray-700/50 bg-gray-900/40',
} as const;

const DOTS = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  err: 'bg-rose-400',
  off: 'bg-gray-500',
} as const;

export default function StatusPill({
  variant = 'off',
  label,
  pulse = false,
}: {
  variant?: keyof typeof VARIANTS;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${VARIANTS[variant]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${DOTS[variant]} ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  );
}
