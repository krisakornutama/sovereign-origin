// tools/ops-task-state.mjs — แปลผล Task Scheduler ของ Windows เป็นสถานะที่หน้า ops อ่านได้
//
// ทำไมต้องแยก: LastTaskResult ยังค้างค่าล้มของรอบสุดท้ายแม้ task ถูก disable ตั้งใจ
// (เคสจริง: ShipShop3000 ถูกปิดตาม QUEUE แต่ยังโชว์ 0x00000001 ตลอดไป)
// ⇒ "ปิดอยู่" ต้องไม่ถูกนับเป็น "ล้ม" ไม่งั้น STATUS.md จะแดงตลอดกาลและซ่อนปัญหาจริง

/** แปลรหัสผล + สถานะ task → { ok, disabled?, text } · ok = null คือ "ไม่ใช่ทั้งผ่านและล้ม" */
export function decodeTaskResult(code, state = '') {
  if (String(state ?? '').trim().toLowerCase() === 'disabled') {
    return { ok: null, disabled: true, text: 'ปิดอยู่ (ตั้งใจ)' };
  }
  const n = Number(code);
  if (n === 0) return { ok: true, text: 'OK' };
  // 0x41303 = 267011 (ยังไม่เคยรัน) · 0x41301 = 267009 (กำลังรัน) — คนละรหัสกัน
  if (n === 267011) return { ok: true, text: 'ยังไม่เคยรัน (0x41303)' };
  if (n === 267009) return { ok: true, text: 'กำลังรัน (0x41301)' };
  if (n === 2147946720) return { ok: false, text: 'ถูกบล็อกเงื่อนไข (0x800710E0 — แบต/หลับ)' };
  return { ok: false, text: `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}` };
}
