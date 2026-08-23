"use client";

/**
 * สถานะว่าง — ชวนให้ลงมือทำ ไม่ใช่ปล่อยจอโล่ง
 * (ใช้แทน "ไม่มีข้อมูล" แบบแห้ง ๆ)
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 gap-3">
      {icon && (
        <div className="w-12 h-12 rounded-xl border border-gray-700 bg-gray-800/40 flex items-center justify-center text-gray-400 shadow-[0_0_16px_rgba(52,211,153,0.07)]">
          {icon}
        </div>
      )}
      <div className="text-sm font-bold text-gray-100 glow-text tracking-tight">{title}</div>
      {description && <div className="text-xs text-gray-500 max-w-sm leading-relaxed">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}