"use client";

/**
 * StatusDot — จุดสถานะ + ข้อความ (แบบบาง ไม่มีกรอบ)
 *
 * ต่างจาก StatusPill (ป้ายมีกรอบ) ตรงที่ตัวนี้ใช้ในตาราง/รายการที่ต้องประหยัดที่
 * variant ชุดเดียวกับ StatusPill: ok / warn / err / off / info
 */
const DOTS = {
  ok: 'bg-emerald-400 glow-dot',
  warn: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]',
  err: 'bg-rose-400 glow-dot-red',
  off: 'bg-gray-500',
  info: 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]',
} as const;

const TEXT = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  err: 'text-rose-300',
  off: 'text-gray-400',
  info: 'text-cyan-300',
} as const;

const SIZE = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
} as const;

export type StatusVariant = keyof typeof DOTS;

export default function StatusDot({
  variant = 'off',
  label,
  pulse = false,
  size = 'md',
  className = '',
}: {
  variant?: StatusVariant;
  label: string;
  pulse?: boolean;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${TEXT[variant]} ${className}`}>
      <span className={`shrink-0 rounded-full ${SIZE[size]} ${DOTS[variant]} ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
