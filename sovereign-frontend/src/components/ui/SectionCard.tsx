"use client";

/**
 * การ์ดหัวข้อย่อย — กล่องเนื้อหามาตรฐานของทุกหน้า
 * (แทนการเขียน <div className="bg-gray-950/50 border..."> ซ้ำ)
 * icon รับได้ทั้ง <Icon name="..." /> หรือข้อความ/emoji (กรณีข้อมูลจริง)
 */
export default function SectionCard({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && (
            <h2 className="text-[13px] font-semibold text-gray-200 flex items-center gap-2 glow-text">
              {icon && <span className="text-gray-400 flex items-center">{icon}</span>}
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