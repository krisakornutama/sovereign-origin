// ────────────────────────────────────────────────────────────────────────────
// nightly-history.mjs — เก็บ/ตรวจประวัติ nightly 30 วัน (ใช้โดย nightly-verify)
//
// ทำไมต้องแยกโมดูล: logic นี้เคยอยู่ inline ใน nightly-verify.mjs ซึ่งรันทันทีตอน
// import ⇒ เทสต์ไม่ได้ · เคสจริง: entry ของ 7/9/13/14/17 ต.ค. หายไปเงียบ ๆ
// แล้วกราฟบน /system-health ก็แค่มีจุดขาดโดยไม่มีใครรู้
//
// กติกา:
//   · 1 entry ต่อวัน (วันตาม UTC ให้ตรงกับ finishedAt.slice(0,10) เดิม)
//   · รันซ้ำวันเดิม = แทนที่ ไม่เพิ่มแถวซ้ำ
//   · เก็บไม่เกิน 30 วันล่าสุด ตัดของเก่าออกเท่านั้น
//   · findHistoryGaps() ไม่นับ "วันนี้" (รอบ 02:00 เขียนวันนี้เอง) — เริ่มจากเมื่อวาน
// ────────────────────────────────────────────────────────────────────────────

export const HISTORY_KEEP_DAYS = 30;
export const GAP_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' ตาม UTC — คืน '' ถ้าอ่านวันที่ไม่ได้ */
export function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * วันที่ขาดหายในช่วง `windowDays` วันก่อนหน้า (ไม่นับวันนี้) — เรียงเก่า → ใหม่
 * @param history array ของ entry (รูป { day: 'YYYY-MM-DD', ... })
 * @param today   วันที่ของรอบนี้ ('YYYY-MM-DD' หรือ Date)
 */
export function findHistoryGaps(history, { today = new Date(), windowDays = GAP_WINDOW_DAYS } = {}) {
  const todayKey = dayKey(today);
  if (!todayKey) return [];
  const span = Math.max(1, Math.floor(Number(windowDays) || GAP_WINDOW_DAYS));
  const have = new Set(
    (Array.isArray(history) ? history : [])
      .map((e) => String(e?.day ?? '').slice(0, 10))
      .filter(Boolean),
  );
  const base = Date.parse(`${todayKey}T00:00:00.000Z`);
  const gaps = [];
  for (let i = span; i >= 1; i -= 1) {
    const key = new Date(base - i * DAY_MS).toISOString().slice(0, 10);
    if (!have.has(key)) gaps.push(key);
  }
  return gaps;
}

/**
 * เพิ่ม/แทน entry ของวันนี้ แล้วเก็บไว้ไม่เกิน `keep` วัน (เรียงเก่า → ใหม่)
 * ข้อมูลเสีย (null/ไม่มี day/ไม่ใช่ array) ถูกข้าม — ไม่ทำให้ประวัติทั้งก้อนหาย
 */
export function mergeHistoryEntry(history, entry, { keep = HISTORY_KEEP_DAYS } = {}) {
  const list = (Array.isArray(history) ? history : []).filter(
    (e) => e && typeof e === 'object' && typeof e.day === 'string' && e.day,
  );
  const day = String(entry?.day ?? '').slice(0, 10);
  const rest = day ? list.filter((e) => e.day !== day) : list;
  const next = day ? [...rest, { ...entry, day }] : rest;
  next.sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const limit = Math.max(1, Math.floor(Number(keep) || HISTORY_KEEP_DAYS));
  return next.slice(-limit);
}
