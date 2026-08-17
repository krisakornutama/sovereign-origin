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
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 gap-2">
      {icon && (
        <div className="w-10 h-10 rounded-lg border border-gray-800 bg-gray-800/50 flex items-center justify-center text-gray-500">
          {icon}
        </div>
      )}
      <div className="text-sm font-semibold text-gray-200 glow-text">{title}</div>
      {description && <div className="text-xs text-gray-500 max-w-sm">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}