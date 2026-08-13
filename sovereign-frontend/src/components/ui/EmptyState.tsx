"use client";

/**
 * สถานะว่าง — ชวนให้ลงมือทำ ไม่ใช่ปล่อยจอโล่ง
 * (ใช้แทน "ไม่มีข้อมูล" แบบแห้ง ๆ)
 */
export default function EmptyState({
  icon = '🗂️',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2">
      <div className="text-3xl opacity-80">{icon}</div>
      <div className="text-sm font-semibold text-gray-200">{title}</div>
      {description && <div className="text-xs text-gray-500 max-w-sm">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
