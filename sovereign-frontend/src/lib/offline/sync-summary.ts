// ข้อความสรุปหลังกด "Sync ทั้งหมด" — ต้องตรงกับสภาพคิวจริง
//
// รายการที่ server ปฏิเสธถาวร (4xx) จะถูก "พักไว้ ไม่ลบ" (นโยบาย OFFLINE-001:
// ข้อมูลผู้ใช้ห้ามหาย) และไม่ถูกส่งซ้ำเอง ⇒ จำนวนที่ flush สำเร็จ ไม่เท่ากับ "คิวว่าง"
// ถ้าประกาศ "สำเร็จทั้งหมด" ตามจำนวนที่ส่งได้ ผู้ใช้จะเลิกดูคิวทั้งที่ยังมีของค้าง
//
// ไฟล์นี้แยกตรรกะออกมาเพื่อให้เทสต์จับได้ (ดู sync-summary.test.ts)

export type SyncTone = 'ok' | 'warn';

export interface SyncOutcomeMessage {
  /** คีย์ i18n — ต้องมีครบทั้ง th/en (มีเทสต์คุม) */
  key: string;
  /** ตัวแปรสำหรับแทนในข้อความ */
  vars: Record<string, number>;
  /** ok = แบนเนอร์สำเร็จ · warn = ยังไม่จบ ต้องให้ผู้ใช้เห็น */
  tone: SyncTone;
}

function count(value: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : 0;
  return n > 0 ? n : 0;
}

/**
 * @param flushed จำนวนรายการที่ส่งสำเร็จรอบนี้
 * @param remaining จำนวนรายการที่ยังอยู่ในคิวหลัง sync (รวมที่ถูกพักไว้)
 */
export function syncOutcomeMessage(flushed: number, remaining: number): SyncOutcomeMessage {
  const sent = count(flushed);
  const kept = count(remaining);

  if (kept === 0) {
    return { key: 'settings.queue.syncAllDone', vars: { n: sent }, tone: 'ok' };
  }
  // ส่งไม่ได้เลยสักรายการ — บอกตรง ๆ ไม่ใช่ "สำเร็จ 0 รายการ"
  if (sent === 0) {
    return { key: 'settings.queue.syncAllNone', vars: { kept }, tone: 'warn' };
  }
  return { key: 'settings.queue.syncAllPartial', vars: { n: sent, kept }, tone: 'warn' };
}
