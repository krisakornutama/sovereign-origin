"use client";

/**
 * ป้ายสถานะ — จุดสี + ข้อความ ใช้บอกสถานะแบบสม่ำเสมอทั้งแอป
 * variant: ok (เขียว) / warn (เหลือง) / err (แดง) / off (เทา)
 */
const VARIANTS = {
  ok: 'text-emerald-400 border-emerald-700/40 bg-emerald-950/40',
  warn: 'text-amber-400 border-amber-700/40 bg-amber-950/40',
  err: 'text-rose-400 border-rose-700/40 bg-rose-950/40',
  off: 'text-gray-400 border-gray-700/40 bg-gray-900/40',
} as const;

const DOTS = {
  ok: 'bg-emerald-400 glow-dot',
  warn: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]',
  err: 'bg-rose-400 glow-dot-red',
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