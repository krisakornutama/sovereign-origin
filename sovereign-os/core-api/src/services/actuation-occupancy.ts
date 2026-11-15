// src/services/actuation-occupancy.ts
// ─────────────────────────────────────────────────────────────────────────────
// แปลงค่าที่ผู้ใช้ส่งมาให้ PUT /api/actuation/occupancy
//
// ทำไมต้องแยก: กฎ OCCUPANCY ใช้ `occupied` ตัดสินว่า AI จะปิดน้ำ/เน็ตได้หรือไม่
// เดิมใช้ `!!v` ⇒ "false" (สตริง) กลายเป็น true และ 0 กลายเป็น false เงียบ ๆ
// ⇒ ค่าที่พิมพ์ผิด/รูปแบบไม่ตรง เปลี่ยนผลการตัดสินความปลอดภัยโดยไม่มีใครรู้
//
// กติกา: แปลเฉพาะค่าที่ชัดเจน · "ไม่รู้" (null) ต้องตั้งใจส่ง · ค่าที่ไม่รู้จัก = ปฏิเสธ (ไม่เดา)
// ─────────────────────────────────────────────────────────────────────────────

export type OccupancyInput = { ok: true; value: boolean | null } | { ok: false };

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on', 'occupied', 'present']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off', 'empty', 'absent', 'unoccupied']);
const UNKNOWN_WORDS = new Set(['unknown', '']);

export function parseOccupancyInput(raw: unknown): OccupancyInput {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  if (typeof raw === 'boolean') return { ok: true, value: raw };

  if (typeof raw === 'number') {
    if (raw === 1) return { ok: true, value: true };
    if (raw === 0) return { ok: true, value: false };
    return { ok: false };
  }

  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(value)) return { ok: true, value: true };
    if (FALSE_WORDS.has(value)) return { ok: true, value: false };
    if (UNKNOWN_WORDS.has(value)) return { ok: true, value: null };
  }

  return { ok: false };
}
