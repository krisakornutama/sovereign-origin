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
    <section className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-800/60">
          {title && (
            <h2 className="text-[13px] font-bold text-gray-100 flex items-center gap-2.5 tracking-wide">
              {icon && (
                <span className="w-7 h-7 rounded-lg bg-gray-800/60 border border-gray-700/60 flex items-center justify-center text-gray-400">
                  {icon}
                </span>
              )}
              <span className="glow-text">{title}</span>
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}