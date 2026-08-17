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
    <div className="card p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{label}</span>
        {icon && <span className="text-gray-500 flex items-center">{icon}</span>}
      </div>
      <div className="mono text-2xl font-semibold text-gray-50 leading-none pt-0.5 glow-text">{value}</div>
      {delta && (
        <span
          className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md w-fit ${
            deltaUp
              ? 'text-emerald-400 bg-emerald-500/10'
              : 'text-rose-400 bg-rose-500/10'
          }`}
        >
          {delta}
        </span>
      )}
    </div>
  );
}