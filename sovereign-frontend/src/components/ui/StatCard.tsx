"use client";

/**
 * การ์ดตัวเลขสถิติ — ตัวเลข mono ใหญ่ + label + เดลต้าขึ้น/ลง
 */
export default function StatCard({
  label,
  value,
  icon,
  delta,
  deltaUp = true,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  /** ข้อความเดลต้า เช่น "+12%" — ถ้าไม่ส่งจะไม่แสดง */
  delta?: string;
  /** เดลต้าขึ้น = ดี (เขียว) หรือไม่ดี (แดง) */
  deltaUp?: boolean;
}) {
  return (
    <div className="card p-4 flex flex-col gap-2 card-hover group">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500 tracking-wide">{label}</span>
        {icon && <span className="text-gray-500 group-hover:text-emerald-400/80 transition-colors flex items-center">{icon}</span>}
      </div>
      <div className="mono text-[26px] font-bold text-gray-50 leading-none pt-1 glow-text tracking-tight">{value}</div>
      {delta && (
        <span
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full w-fit border ${
            deltaUp
              ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
              : 'text-rose-300 bg-rose-500/10 border-rose-500/20'
          }`}
        >
          {delta}
        </span>
      )}
    </div>
  );
}