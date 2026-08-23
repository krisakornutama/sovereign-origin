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
    <header className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-6 h-px bg-gradient-to-r from-emerald-500/60 to-transparent" />
            <span className="eyebrow">{eyebrow}</span>
          </div>
        )}
        <h1 className="text-[22px] md:text-2xl font-bold text-gray-50 tracking-tight flex items-center gap-3 glow-text leading-none">
          {icon && (
            <span className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.15)]">
              {icon}
            </span>
          )}
          {title}
        </h1>
        {subtitle && <p className="text-[13px] text-gray-400 mt-1.5 leading-relaxed max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </header>
  );
}