// tools/lib/audit-size-gate.mjs — เกณฑ์ขนาด audit_logs (I3d)
// เหตุผล: audit_logs โตเงียบได้แม้ INSERT ไม่ตก default partition (เช่น ไม่มีใครลบตาม retention)
// → machine-health ต้องเห็นตัวเลขจริงและเตือนก่อนดิสก์เต็ม ซึ่งเป็นสาเหตุ build พังที่เจอมาแล้ว
export const DEFAULT_AUDIT_WARN_MB = Number(process.env.MH_AUDIT_WARN_MB ?? 1024); // 1 GB
export const DEFAULT_AUDIT_WARN_ROWS = Number(process.env.MH_AUDIT_WARN_ROWS ?? 5_000_000);

/** คืน { level, message } เมื่อเกินเกณฑ์, null เมื่อปกติหรืออ่านค่าไม่ได้ */
export function auditSizeVerdict({ totalMb, rows, warnMb = DEFAULT_AUDIT_WARN_MB, warnRows = DEFAULT_AUDIT_WARN_ROWS } = {}) {
  if (!Number.isFinite(totalMb) || !Number.isFinite(rows)) return null;
  const parts = [];
  if (Number.isFinite(warnMb) && totalMb >= warnMb) parts.push(`ขนาด ${Math.round(totalMb * 10) / 10} MB ≥ ${warnMb} MB`);
  if (Number.isFinite(warnRows) && rows >= warnRows) parts.push(`${rows.toLocaleString('en-US')} แถว ≥ ${warnRows.toLocaleString('en-US')}`);
  if (parts.length === 0) return null;
  return {
    level: 'warn',
    message: `audit_logs ใหญ่ผิดปกติ (${parts.join(' · ')}) — ตรวจ retention/partition ก่อนดิสก์เต็ม`,
  };
}
