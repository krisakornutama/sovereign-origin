"use client";

/**
 * หัวหน้าเพจมาตรฐาน — ใช้แทนการเขียน header ซ้ำ ๆ กันทุกหน้า
 * eyebrow = กลุ่มของหน้า (เช่น "ชีวิต & การเงิน"), title = ชื่อหน้า
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-xl font-semibold text-gray-50 tracking-tight flex items-center gap-2.5 glow-text">
          {icon && <span className="text-emerald-400/90 flex items-center">{icon}</span>}
          {title}
        </h1>
        {subtitle && <p className="text-[13px] text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}