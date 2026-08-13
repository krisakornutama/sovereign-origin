"use client";

/**
 * หัวหน้าเพจมาตรฐาน — ใช้แทนการเขียน header ซ้ำ ๆ กันทุกหน้า
 * eyebrow = กลุ่มของหน้า (เช่น "ชีวิต & การเงิน"), title = ชื่อหน้า
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.25em] text-emerald-400/80 font-semibold mb-1">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-50 tracking-tight flex items-center gap-2">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}
