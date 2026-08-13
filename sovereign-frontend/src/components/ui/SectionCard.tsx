"use client";

/**
 * การ์ดหัวข้อย่อย — กล่องเนื้อหามาตรฐานของทุกหน้า
 * (แทนการเขียน <div className="bg-gray-950/50 border..."> ซ้ำ)
 */
export default function SectionCard({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string;
  icon?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-gray-950/50 border border-gray-800 rounded-xl p-4 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && (
            <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              {icon && <span className="text-base">{icon}</span>}
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
