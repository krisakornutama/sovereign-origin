// src/modules/ota/ota.legacy.ts
// ─────────────────────────────────────────────────────────────
// ตัวนับ "ใครยังดาวน์โหลด OTA ด้วย ?token="
//
// ทำไมต้องมี: หลังปิดรับ token ทาง query เป็นค่าเริ่มต้น ผู้ดูแลต้องรู้ว่าเครื่องไหน
// ยังพยายามใช้ ?token= อยู่ จะได้ไม่ปิดสวิตช์เร็วเกินจนอุปกรณ์ค้างรออัปเดต
//
// ข้อจำกัดโดยเจตนา: เก็บในหน่วยความจำ (รีสตาร์ท = เริ่มนับใหม่), จำกัดจำนวนรายการ
// เพื่อไม่ให้ใครยิงถล่มจนหน่วยความจำบวม และไม่บันทึก token ลงไปเลย (ห้ามเก็บความลับ)
// ─────────────────────────────────────────────────────────────

/** เพดานจำนวนอุปกรณ์ที่ติดตาม — เกินแล้วตัดตัวที่เห็นล่าสุดเก่าสุดออก */
const MAX_CLIENTS = 200;

export interface LegacyClientHit {
  ip: string;
  userAgent: string | null;
  /** จำนวนครั้งที่ใช้ query token แล้วผ่าน (เกิดขึ้นเมื่อเปิด OTA_ALLOW_QUERY_TOKEN) */
  accepted: number;
  /** จำนวนครั้งที่ใช้ query token แล้วถูกปฏิเสธ */
  rejected: number;
  firstSeen: number;
  lastSeen: number;
}

const clients = new Map<string, LegacyClientHit>();

/** ล้างตัวนับ — ใช้ในเทสต์ */
export function resetLegacyClients(): void {
  clients.clear();
}

function keyOf(ip: string, userAgent: string | null): string {
  return `${ip}\u0000${userAgent ?? ''}`;
}

/** บันทึกคำขอดาวน์โหลดที่ "ใช้ token ทาง query" (ไม่ว่า результатจะผ่านหรือไม่) */
export function recordLegacyTokenUse(input: {
  ip: string;
  userAgent: string | null;
  accepted: boolean;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  const ip = String(input.ip || 'unknown');
  const userAgent = input.userAgent ? String(input.userAgent).slice(0, 200) : null;
  const key = keyOf(ip, userAgent);

  const existing = clients.get(key);
  if (existing) {
    existing.lastSeen = now;
    if (input.accepted) existing.accepted += 1;
    else existing.rejected += 1;
    return;
  }

  if (clients.size >= MAX_CLIENTS) {
    let oldestKey = '';
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [candidate, hit] of clients) {
      if (hit.lastSeen < oldestAt) {
        oldestAt = hit.lastSeen;
        oldestKey = candidate;
      }
    }
    if (oldestKey) clients.delete(oldestKey);
  }

  clients.set(key, {
    ip,
    userAgent,
    accepted: input.accepted ? 1 : 0,
    rejected: input.accepted ? 0 : 1,
    firstSeen: now,
    lastSeen: now,
  });
}

export interface LegacyClientReport {
  clients: Array<LegacyClientHit & { firstSeenIso: string; lastSeenIso: string }>;
  totalHits: number;
  recentHits: number;
  /** true = ไม่มีการใช้ query token ในหน้าต่างที่กำหนด ⇒ ลบ OTA_ALLOW_QUERY_TOKEN ได้ */
  readyToDisable: boolean;
  windowHours: number;
}

/**
 * สรุปรายงานสำหรับผู้ดูแล
 *
 * readyToDisable อิง "การใช้งานล่าสุด" ไม่ใช่ยอดรวม เพราะอุปกรณ์ที่เคยใช้เมื่อวาน
 * อาจอัปเดตไปแล้วก็ได้ — ค่าเริ่มต้นจึงดูหน้าต่าง 24 ชั่วโมง
 */
export function legacyClientReport(input: { now?: number; windowMs?: number } = {}): LegacyClientReport {
  const now = input.now ?? Date.now();
  const windowMs = input.windowMs ?? 24 * 60 * 60 * 1000;

  const list = [...clients.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((hit) => ({
      ...hit,
      firstSeenIso: new Date(hit.firstSeen).toISOString(),
      lastSeenIso: new Date(hit.lastSeen).toISOString(),
    }));

  const totalHits = list.reduce((sum, hit) => sum + hit.accepted + hit.rejected, 0);
  const recentHits = list
    .filter((hit) => now - hit.lastSeen <= windowMs)
    .reduce((sum, hit) => sum + hit.accepted + hit.rejected, 0);

  return {
    clients: list,
    totalHits,
    recentHits,
    readyToDisable: recentHits === 0,
    windowHours: Math.round(windowMs / 3_600_000),
  };
}
