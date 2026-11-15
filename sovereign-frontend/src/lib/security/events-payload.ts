// แปลง payload ของ GET /api/security/events ให้หน้า /security อ่านได้ทั้งสองรูปแบบ
//
// รูปแบบใหม่ (ตั้งแต่ SEC-024): { events, degraded, reason }
//   — degraded: true แปลว่า "อ่าน DB ไม่ได้" ซึ่ง **ไม่ใช่** "ไม่มีเหตุการณ์"
// รูปแบบเก่า: array ล้วน (ยังใช้โดย tools/mock-api-preview.mjs)
//
// ไฟล์นี้แยกออกมาเพื่อให้เทสต์จับได้ว่าหน้าเว็บไม่ crash เมื่อ payload ผิดรูป
// และไม่เอา 0 ที่แปลว่า "ไม่รู้" ไปแสดงเป็น 0 ที่แปลว่า "ไม่มี"

export interface SecurityEventRow {
  id?: string;
  timestamp?: string;
  event_type?: string;
  severity?: string;
  description?: string;
  [key: string]: unknown;
}

export interface SecurityEventsView {
  events: SecurityEventRow[];
  /** true = อ่านไม่ได้ (ตารางว่างเพราะไม่รู้ ไม่ใช่เพราะไม่มี) */
  degraded: boolean;
  reason: string;
}

export function parseEventsPayload(payload: unknown): SecurityEventsView {
  if (Array.isArray(payload)) {
    return { events: payload as SecurityEventRow[], degraded: false, reason: '' };
  }
  const obj = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const events = Array.isArray(obj.events) ? (obj.events as SecurityEventRow[]) : [];
  return {
    events,
    degraded: Boolean(obj.degraded),
    reason: typeof obj.reason === 'string' ? obj.reason : '',
  };
}
