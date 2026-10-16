// components/business/soverien/store.ts
// คลังข้อมูลใน localStorage + การคำนวณประกัน + เครื่องมือเสริม
// ทุกอย่าง synchronous ตั้งใจ เพราะแอป desktop ทำงานคนเดียว และตามสเปกผู้ใช้สั่ง
// "เก็บ lastSerialNumber ใน localStorage" — ห้ามซ้ำเด็ดขาด (counter ไม่เคยถอยหลัง แม้ void)
// ใช้ `import type` เท่านั้น → Node ตัดบรรทัดนี้ทิ้งตอนรัน ทำให้ไฟล์นี้ import ได้
// โดยไม่ต้องใส่ extension ใน path (เทสต์ tools/test/soverien-tools.test.mjs เรียกตรง ๆ)
import type { Db, Model, Order, Serial, Settings, StickerConfig, StickerFit, StickerAlign } from './types';

export const KEY = 'soverien.tools.v1';

export const DEFAULT_STICKER: StickerConfig = {
  // ⚠ 16/10/69 — เจ้าของวัดกรอบอุปกรณ์เองได้ 8.1 × 5.5 ซม.
  //   "ขนาดความกว้างคือ 8.1 สูง 5.5 ต่อภาพ ผมลองแล้ว ตรงกับกรอบอุปกรณ์พอดี"
  //   = 81 × 55 มม. เดิมค่าเริ่มต้น 40×20 มม. คือขนาดที่ผมเดาขึ้นเอง ไม่ใช่ของจริง
  widthMm: 81,
  heightMm: 55,
  dpi: 300,
  serialX: 0.06,
  serialY: 0.38,
  serialSize: 26,
  serialColor: '#111827',
  // ⚠ 16/10/69 — ฟอนต์ Garuda ของเจ้าของ (C:\Windows\Fonts\GARA.TTF)
  //   เดิม hardcode JetBrains Mono ซึ่งเป็นฟอนต์เว็บ/โค้ด ไม่ใช่ฟอนต์ที่เขาพิมพ์ป้ายด้วย
  serialFont: 'Garuda',
  serialBold: true,
  // ⚠ QR ปิดไว้เป็นค่าเริ่มต้น 14/10/69
  //   เพราะเทมเพลตป้ายจริงของเจ้าของ "พิมพ์ QR มาให้แล้วในภาพอยู่แล้ว"
  //   ถ้าเปิดทับจะได้ QR ซ้ำสองอันบนป้ายเดียวกัน
  //   → ป้ายที่ไม่มี QR พิมพ์ไว้ เปิดเองได้ที่หัวข้อ QR
  showQr: false,
  qrX: 0.76,
  qrY: 0.18,
  qrSize: 64,
  // ── ค่าเริ่มต้นชุดใหม่ 14/10/69 ──
  // contain (ไม่ใช่ cover) เพราะเจ้าของบอกว่า "ย่อภาพให้เล็กไม่ได้"
  //   → cover ตัดขอบภาพทิ้งจนเห็นแต่ส่วนกลาง (ในภาพตัวอย่าง บรรทัดล่างโดนตัดครึ่ง)
  tplFit: 'contain',
  tplScale: 1,
  tplX: 0,
  tplY: 0,
  // 16/10/69 — 0 = ให้ระบบคำนวณจาก tplFit · เจ้าของกำหนดเองได้จากช่อง "ขนาดภาพ"
  tplWMm: 0,
  tplHMm: 0,
  serialAlign: 'left',
  serialPlate: true,
  serialPlateColor: '#ffffff',
  showWarranty: true,
  warrantyColor: '#111827',
};

// ── การจัดวางสติกเกอร์ ────────────────────────────────────────────────────
// ย้ายไปอยู่ที่ sticker-layout.ts แล้ว (14/10/69) เพราะไฟล์นี้ชิดเพดาน 400 บรรทัด
// ⚠ ไม่ re-export ผ่าน store เพื่อให้ Node ESM (ที่เทสต์ import ตรง) ไม่ติดเรื่องนามสกุลไฟล์
//   ใครต้องใช้สูตรจัดวางให้ import จาก './sticker-layout' ตรง ๆ

export const DEFAULT_SETTINGS: Settings = {
  models: [
    { id: 'temp-01', name: 'Soverien Temp v1 (ESP8266 + DS18B20)', prefix: 'Soverign-Temp', price: 990, active: true, lastNo: -1 },
  ],
  nearExpiryDays: 30,
  shippingDays: 14,
  warrantyDays: 365,
  sticker: DEFAULT_STICKER,
};

export function emptyDb(): Db {
  return {
    version: 1,
    models: DEFAULT_SETTINGS.models.map((m) => ({ ...m })),
    serials: [],
    orders: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    orderSeq: 0,
    stickerPresets: [],
  };
}

const canUse = () => typeof window !== 'undefined' && !!window.localStorage;

// ── โหลด/บันทึก ────────────────────────────────────────────────────────────
/**
 * อ่านไม่ได้ = เก็บของดิบไว้หนึ่งชุด แล้วคืนค่าว่างให้ใช้งานต่อได้ (14/10/69)
 *
 * เหตุผลที่ต้องมี: เดิมคืนค่าว่างเงียบๆ เมื่ออ่านไม่ขึ้น
 *   พอผู้ใช้แตะปุ่มสักอัน (เช่นเลื่อนสติกเกอร์) patch() จะ save() ค่าว่างนั้น
 *   ทับของจริงทิ้งทั้งก้อน → ภาพต้นแบบ + serial + ออเดอร์หายหมด
 *   โดยผู้ใช้ไม่ได้กดอะไรทั้งนั้น และกู้ไม่ได้
 */
function bailWithBackup(raw: string): Db {
  try {
    if (raw) window.localStorage.setItem(`${KEY}.damaged.${Date.now()}`, raw);
  } catch { /* โควตาเต็ม = เก็บไม่ได้ ยอมสละ */ }
  return emptyDb();
}

export function load(): Db {
  if (!canUse()) return emptyDb();
  let raw = '';
  try {
    raw = window.localStorage.getItem(KEY) || '';
    if (!raw) return emptyDb();
    const db = JSON.parse(raw) as Db;
    // กันข้อมูลเก่า/เสีย = คืนค่าเริ่มต้นใหม่ (ปลอดภัยกว่า crash ตอนใช้งาน)
    if (!db || db.version !== 1 || !Array.isArray(db.serials) || !Array.isArray(db.orders)) {
      // ⚠ เส้นทางนี้เดิม "ทิ้งของจริงทิ้ง" โดยไม่เก็บสำเนาไว้เลย (14/10/69)
      return bailWithBackup(raw);
    }
    db.settings = { ...emptyDb().settings, ...db.settings, sticker: { ...DEFAULT_STICKER, ...(db.settings?.sticker ?? {}) } };
    db.models = Array.isArray(db.models) && db.models.length ? db.models : emptyDb().models;
    db.orderSeq = Number(db.orderSeq) || 0;
    // แม่แบบป้ายที่บันทึกไว้ (ข้อมูลเก่ายังไม่มีฟิลด์นี้)
    db.stickerPresets = Array.isArray(db.stickerPresets)
      ? db.stickerPresets.filter((p) => p && typeof p.name === 'string' && p.cfg)
      : [];
    return db;
  } catch {
    return bailWithBackup(raw);
  }
}

export function save(db: Db): void {
  if (!canUse()) return;
  try { window.localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* เต็ม/quota — ข้าม ไม่ทำให้แอปพัง */ }
}

export function wipeAll(): void {
  if (!canUse()) return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// ── วันที่ ──────────────────────────────────────────────────────────────────
/** วันที่วันนี้เป็น ISO (YYYY-MM-DD) ตามเวลาเครื่อง — ไม่ใช้ toISOString() เพราะเพี้ยนเป็น UTC */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const p = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, (m ?? 1) - 1, d ?? 1).getTime(); };
  return Math.round((p(toIso) - p(fromIso)) / 86400000);
}

/** วันที่แบบไทย พ.ศ. — ใช้บน UI เท่านั้น (เก็บจริงเป็น ISO) */
export function thaiDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y + 543}`;
}

export function thaiShort(iso: string): string {
  const th = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${th[m - 1]} ${y + 543}`;
}

// ── ประกัน ─────────────────────────────────────────────────────────────────
export function warrantyDates(issueDate: string, s: Settings) {
  const start = addDays(issueDate, s.shippingDays);
  const end = addDays(start, s.warrantyDays);
  return { start, end };
}

export type WState = 'IN' | 'NEAR' | 'OUT' | 'VOID' | 'UNKNOWN';

export function warrantyState(o: Order, s: Settings, today = todayIso()): { state: WState; daysLeft: number } {
  if (o.status === 'VOID') return { state: 'VOID', daysLeft: 0 };
  const left = daysBetween(today, o.warrantyEnd);
  if (left < 0) return { state: 'OUT', daysLeft: left };
  if (left <= s.nearExpiryDays) return { state: 'NEAR', daysLeft: left };
  return { state: 'IN', daysLeft: left };
}

export type Lookup = { kind: WState | 'UNSOLD' | 'EMPTY'; sn: string; order?: Order };

/**
 * ค้น S/N เพื่อตรวจประกัน — แยก 3 เคสที่ "คนละความหมายกัน" (14/10/69)
 *   EMPTY   = ยังไม่ได้กรอกอะไร
 *   UNKNOWN = ไม่มี serial นี้ในระบบเลย (พิมพ์ผิด / เป็นของเครื่องอื่น)
 *   UNSOLD  = มี serial จริง แต่ยังไม่ได้ผูกกับออเดอร์ → ยังไม่เริ่มประกัน
 *
 * ก่อนแก้: UNKNOWN ครอบทั้ง UNKNOWN กับ UNSOLD → หัวข้อบนหน้าขึ้นว่า
 * "ไม่พบ Serial นี้" แต่ข้างล่างบอก "serial นี้ยังไม่ได้ผูกกับออเดอร์" ขัดกันเอง
 */
export function lookupWarranty(db: Db, raw: string): Lookup {
  const typed = raw.trim();
  if (!typed) return { kind: 'EMPTY', sn: '' };
  // ⚠ เทียบแบบไม่สนตัวพิมพ์ใหญ่/เล็ก แล้วคืนค่า "ตามที่เก็บในระบบ"
  //   เพราะ serial เก็บเป็น "Soverign-Temp-000" (ตัวพิมพ์ผสม)
  //   ถ้าเอา .toUpperCase() ไปเทียบตรงๆ → "SOVERIGN-TEMP-000" !== "Soverign-Temp-000"
  //   → ค้นประกันไม่มีวันเจอ แม้พิมพ์ถูก (จริงแล้วเทสต์นี้จับได้ 14/10/69)
  const key = typed.toUpperCase();
  const serial = db.serials.find((s) => s.sn.toUpperCase() === key);
  if (!serial) return { kind: 'UNKNOWN', sn: typed };
  const order = serial.orderId ? db.orders.find((o) => o.id === serial.orderId) : undefined;
  if (!order) return { kind: 'UNSOLD', sn: serial.sn };
  return { kind: warrantyState(order, db.settings).state, sn: serial.sn, order };
}

// ── Serial ─────────────────────────────────────────────────────────────────
/**
 * URL ปลายทาง QR ที่พิมพ์ลงป้ายสติกเกอร์ (14/10/69)
 *
 * ค่าเริ่มต้นใช้ origin ของเครื่องที่เปิดแอป = "http://localhost:3000"
 * → สแกนด้วยแอปบนเครื่องนี้ได้ แต่มือถือลูกค้าแกะ "localhost" ไม่ได้
 *    เพราะในความหมายของมือถือ = ตัวมือถือเอง
 * จึงต้องให้เจ้าของกรอกโดเมนจริงในหน้าตั้งค่าสติกเกอร์
 */
export function warrantyUrl(base: string | undefined, origin: string, sn: string): string {
  const host = (base ?? '').trim().replace(/\/+$/, '') || origin;
  return `${host}/warranty?sn=${encodeURIComponent(sn)}`;
}

export function modelById(db: Db, id: string): Model | undefined {
  return db.models.find((m) => m.id === id);
}

/** คืนเลขถัดไปโดยไม่บันทึก (ใช้ preview) */
export function peekNext(model: Model, count = 1): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(formatSn(model, model.lastNo + i));
  return out;
}

export function formatSn(model: Model, n: number): string {
  return `${model.prefix}-${String(n).padStart(3, '0')}`;
}

/** ออก serial ต่อเนื่องจากตัวสุดท้าย · ห้ามซ้ำ (counter เดินเฉพาะทางขึ้น) */
export function issueSerials(db: Db, modelId: string, count: number): Serial[] {
  const model = modelById(db, modelId);
  if (!model) throw new Error('ไม่พบรุ่น');
  const n = Math.max(1, Math.min(999, Math.floor(count)));
  const existing = new Set(db.serials.map((s) => s.sn));
  const out: Serial[] = [];
  let cur = model.lastNo;
  for (let i = 0; i < n; i++) {
    cur += 1;
    let sn = formatSn(model, cur);
    // เผื่อมีของค้างจาก import ข้อมูลเก่าที่ตัวนับเพี้ยน — ขยับจนกว่าจะไม่ซ้ำ
    while (existing.has(sn)) { cur += 1; sn = formatSn(model, cur); }
    existing.add(sn);
    out.push({ sn, modelId, issuedAt: todayIso(), status: 'STOCK', createdAt: new Date().toISOString() });
  }
  model.lastNo = cur;
  return out;
}

// ── ออเดอร์ ────────────────────────────────────────────────────────────────
export function nextOrderNo(db: Db): string {
  db.orderSeq += 1;
  return `SO-${String(db.orderSeq).padStart(4, '0')}`;
}

export function orderTotal(o: Order): number {
  return o.total || o.serials.length * o.unitPrice;
}

/** ลูกค้า dedupe ด้วยเบอร์โทร (ตัดช่องว่าง/ขีดออก) */
export function normPhone(p: string): string {
  return (p || '').replace(/[^0-9]/g, '');
}

export type CustomerRow = {
  phone: string;
  name: string;
  line?: string;
  address?: string;
  orderCount: number;
  value: number;
  lastOrderDate: string;
  daysSince: number;
  serials: string[];
};

/** รวมลูกค้าจากออเดอร์ทั้งหมด · ไม่นับออเดอร์ที่ void */
export function buildCustomers(db: Db, today = todayIso()): CustomerRow[] {
  const map = new Map<string, CustomerRow>();
  for (const o of db.orders) {
    if (o.status === 'VOID') continue;
    const key = normPhone(o.phone) || `name:${o.customerName.trim().toLowerCase()}`;
    const cur = map.get(key) ?? {
      phone: o.phone, name: o.customerName, line: o.line, address: o.address,
      orderCount: 0, value: 0, lastOrderDate: o.issueDate, daysSince: 0, serials: [],
    };
    cur.orderCount += 1;
    cur.value += orderTotal(o);
    cur.serials.push(...o.serials);
    if (o.issueDate > cur.lastOrderDate) {
      cur.lastOrderDate = o.issueDate;
      cur.name = o.customerName;      // ใช้ชื่อล่าสุด
      cur.line = o.line || cur.line;
      cur.address = o.address || cur.address;
    }
    map.set(key, cur);
  }
  return [...map.values()]
    .map((c) => ({ ...c, value: Math.round(c.value), daysSince: daysBetween(c.lastOrderDate, today) }))
    .sort((a, b) => b.value - a.value);
}

export type Summary = {
  totalSerials: number;
  stockSerials: number;
  totalOrders: number;
  inWarranty: number;
  nearExpiry: number;
  expired: number;
  revenue: number;
  byMonth: Array<{ month: string; count: number; value: number }>;
};

export function buildSummary(db: Db, today = todayIso()): Summary {
  const active = db.orders.filter((o) => o.status === 'ACTIVE');
  let inW = 0, near = 0, out = 0, revenue = 0;
  for (const o of active) {
    const w = warrantyState(o, db.settings, today);
    if (w.state === 'IN') inW++;
    else if (w.state === 'NEAR') near++;
    else out++;
    revenue += orderTotal(o);
  }
  // กราฟรายเดือน (12 เดือนล่าสุด)
  const buckets = new Map<string, { month: string; count: number; value: number }>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, { month: key, count: 0, value: 0 });
  }
  for (const o of active) {
    const key = o.issueDate.slice(0, 7);
    const b = buckets.get(key);
    if (b) { b.count += 1; b.value += orderTotal(o); }
  }
  return {
    totalSerials: db.serials.length,
    stockSerials: db.serials.filter((s) => s.status === 'STOCK').length,
    totalOrders: active.length,
    inWarranty: inW,
    nearExpiry: near,
    expired: out,
    revenue,
    byMonth: [...buckets.values()],
  };
}
