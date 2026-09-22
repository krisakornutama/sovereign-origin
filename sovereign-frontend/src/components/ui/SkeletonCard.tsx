"use client";
// Skeleton การ์ดสำหรับสถานะ Loading — แทน "กำลังโหลด..." เฉย ๆ (C6)
// เข้าธีมเดิม: พื้นเข้ม + เส้นขอบจางเหมือนการ์ดจริง + แถบไล่ระดับเลื่อนผ่าน (shimmer)
import { useLanguageStore } from '../../stores/useLanguageStore';

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skele rounded-lg ${className}`} aria-hidden="true" />;
}

export default function SkeletonCard({
  lines = 3,
  className = '',
  label,
}: {
  lines?: number;
  className?: string;
  label?: string;
}) {
  const t = useLanguageStore((s) => s.t);
  const ariaLabel = label ?? t('common.loading', 'กำลังโหลด...');
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`rounded-2xl border border-gray-800/70 bg-gray-900/60 p-4 space-y-2.5 ${className}`}
    >
      <div className="flex items-center gap-2">
        <SkeletonBlock className="w-5 h-5 rounded-md" />
        <SkeletonBlock className="h-3 w-1/3" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} className={`h-2.5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** ตาราง skeleton หลายใบเรียงกัน — ใช้แทนหน้า/ส่วนที่เป็น grid การ์ด */
export function SkeletonGrid({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={2 + (i % 2)} />
      ))}
    </div>
  );
}
