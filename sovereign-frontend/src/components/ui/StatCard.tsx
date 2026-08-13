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
  icon?: string;
  /** ข้อความเดลต้า เช่น "+12%" — ถ้าไม่ส่งจะไม่แสดง */
  delta?: string;
  /** เดลต้าขึ้น = ดี (เขียว) หรือไม่ดี (แดง) */
  deltaUp?: boolean;
}) {
  return (
    <div className="bg-gray-950/50 border border-gray-800 rounded-xl p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{label}</span>
        {icon && <span className="text-base opacity-80">{icon}</span>}
      </div>
      <div className="text-2xl font-semibold text-gray-50 mono leading-none pt-0.5">{value}</div>
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
