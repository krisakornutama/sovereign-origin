// components/business/soverien/telegram-notify.ts
// ส่งแจ้งเตือนธุรกิจไปห้อง Telegram เฉพาะธุรกิจ (16/10/69)
//
// เจ้าของ: "ตัวเดียวกับส่งข้อมูลเรื่องบ้าง แต่อันนี้แยกเฉพาะห้อง เพราะเกี่ยวกับธุรกิจโดยตรง
//   → บอทตัวเดียวกันที่ระบบใช้อยู่แล้ว แต่ backend ส่งไปห้องที่ตั้งไว้ต่างหาก
//   → token อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น หน้าเว็บไม่เห็น (ส่งผ่าน API)
import type { Db, Order, Settings } from './types';

/**
 * สูตรคำนวณที่ต้องยืมมาจาก store.ts
 *
 * ⚠ ทำไมต้องส่งเข้ามาแทนที่จะ import (16/10/69): Node เรียก .ts ที่ import แบบไม่มีนามสกุล
 *   ไม่ได้ (`from './store'` → ERR_MODULE_NOT_FOUND) ทำให้เทสต์ Node เรียกไฟล์นี้ไม่ได้เลย
 *   และเคยเสียเวลาไปแก้ชื่อไฟล์แล้วยังไม่หาย — การส่งเข้ามาทำให้ logic ทดสอบได้จริงโดยยังใช้ของจริง
 *
 * ⚠ ไฟล์นี้ต้อง **ไม่ import อะไรที่ต้องใช้เบราว์เซอร์** เลยแม้แต่ตัวเดียว
 *   (getApiUrl / authFetch) เพราะจะทำให้ Node โหลดไฟล์นี้ไม่ขึ้นตั้งแต่ต้น
 *   → ส่วนที่ต้องยิงเครือข่ายแยกไว้ใน createBizNotifier() แล้วให้ฝั่ง component ประกอบปิด
 */
export type WarrantyDeps = {
  warrantyState: (o: Order, s: Settings, today: string) => { state: string; daysLeft: number };
  thaiDate: (iso: string) => string;
};

export type BizKind = 'order' | 'shipping' | 'warranty' | 'stock' | 'info';

export type BizStatus = {
  hasBotToken: boolean;
  tokenMask: string;
  bizChatIdMasked: string;
  bizChatIdSet: boolean;
  ready: boolean;
};

/**
 * ตรวจหมายเลขห้องก่อนส่งจากหน้าเว็บ — ให้ผลเร็วกว่ารอเซิร์ฟเวอร์ตอบ
 * ต้องตรงกับ validateTelegramChatId ฝั่ง backend (ทั้งสองฝั่งตรวจ กันกรณีเขียนทับข้าม)
 */
export function validateChatId(raw: string): string {
  const v = (raw ?? '').trim();
  if (!v) return 'ยังไม่ได้ใส่หมายเลขห้อง';
  if (!/^-?\d+$/.test(v)) return 'ต้องเป็นตัวเลขล้วน';
  if (v.replace('-', '').length > 20) return 'หมายเลขห้องยาวผิดปกติ';
  return '';
}

/**
 * สร้างชุดฟังก์ชันที่ยิง API — รับตัวเรียก fetch เข้ามาเอง
 *
 * ทำแบบนี้เพราะไฟล์นี้ต้อง import ได้ใน Node (เทสต์) ซึ่ง resolve `lib/apiFetch` ไม่ได้
 *   ฝั่ง component จึงประกอบด้วยของจริง (authFetch + getApiUrl) ตอน render
 */
export function createBizNotifier(deps: {
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  apiUrl: string;
}) {
  const api = (path: string, init?: RequestInit) => deps.authFetch(`${deps.apiUrl}${path}`, init);
  const json = async (p: string, init?: RequestInit) => {
    const r = await api(p, init);
    const b = await r.json().catch(() => ({}));
    return { ok: r.ok && b?.success !== false, error: b?.error as string | undefined };
  };

  return {
    async fetchBizStatus(): Promise<BizStatus | null> {
      try {
        const res = await api('/api/telegram/biz');
        if (!res.ok) return null;
        return (await res.json()) as BizStatus;
      } catch { return null; }
    },

    saveBizChatId(chatId: string) {
      return json('/api/telegram/biz', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
    },

    testBizNotify(chatId?: string) {
      return json('/api/telegram/biz/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
    },

    /** ส่งเหตุการณ์ธุรกิจ 1 เหตุการณ์ — fire-and-forget ไม่ block หน้าจอ */
    async notifyBiz(kind: BizKind, title: string, detail = '', eventKey?: string): Promise<boolean> {
      try {
        const res = await api('/api/telegram/biz/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, title, detail, eventKey }),
        });
        const body = await res.json().catch(() => ({}));
        return res.ok && body.success === true;
      } catch { return false; }
    },
  };
}

/**
 * สรุปรายการที่ "ต้องติดตาม" เป็นข้อความสั้น ๆ สำหรับส่งเข้าห้อง (pure — เทสต์ได้)
 *
 * เจ้าของดูหน้าจออยู่แล้วว่าอะไรหมดอายุ แต่เวลาอยู่ร้าน/ขับรถ ก็ต้องการให้โทรศัพท์เตือน
 *   → ปุ่มเดียวส่งรายการที่ค้างอยู่ทั้งหมด ไม่ต้องเปิดแอปดู
 */
export function buildTrackingDigest(db: Db, deps: WarrantyDeps, today = new Date().toISOString().slice(0, 10)): {
  title: string;
  detail: string;
  isEmpty: boolean;
} {
  const out: string[] = [];      // หมดอายุแล้ว
  const near: string[] = [];     // ใกล้หมด

  for (const o of db.orders) {
    if (o.status === 'VOID') continue;
    const { state, daysLeft } = deps.warrantyState(o, db.settings, today);
    const head = `${o.customerName || 'ไม่ระบุชื่อ'} · ${o.serials[0] ?? '-'}`;
    if (state === 'OUT') out.push(`${head} (หมด ${Math.abs(daysLeft)} วัน)`);
    else if (state === 'NEAR') near.push(`${head} (อีก ${daysLeft} วัน)`);
  }

  const soldSerials = new Set(db.orders.filter((o) => o.status !== 'VOID').flatMap((o) => o.serials));
  const unsold = db.serials.filter((s) => s.status === 'SOLD' && !soldSerials.has(s.sn)).length;

  const MAX_ROWS = 15;   // Telegram ตัดข้อความที่ 4096 ตัว — ส่งจำนวนรวมพร้อมรายการย่อย
  const parts: string[] = [];
  if (out.length) parts.push(`🔴 หมดประกันแล้ว ${out.length} รายการ\n${out.slice(0, MAX_ROWS).map((s) => `• ${s}`).join('\n')}`);
  if (near.length) parts.push(`⚠️ ใกล้หมดประกัน ${near.length} รายการ\n${near.slice(0, MAX_ROWS).map((s) => `• ${s}`).join('\n')}`);
  if (unsold) parts.push(`📦 ออก S/N แล้วยังไม่ผูกออเดอร์ ${unsold} ใบ`);

  const isEmpty = parts.length === 0;
  return {
    title: isEmpty ? 'ยังไม่มีรายการที่ต้องติดตาม' : `สรุปงานที่ต้องติดตาม · ${deps.thaiDate(today)}`,
    detail: isEmpty ? 'ทุกออเดอร์อยู่ในระยะประกัน และ S/N ผูกออเดอร์ครบแล้ว 👍' : parts.join('\n\n'),
    isEmpty,
  };
}
