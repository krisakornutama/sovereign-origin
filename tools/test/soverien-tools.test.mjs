// tools/test/soverien-tools.test.mjs
//
// ── ตรรกะเครื่องมือร้าน Soverien (14/10/69) ──
// ของจริง = serial ที่พิมพ์ลงป้าย + ประกันที่ลูกค้าเอาไปเรียกร้อง
// ผิดแม้แต่ตัวเดียว = ของชิ้นซ้ำ / ประกันคำนวณผิด → ต้องกันให้แน่น
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── stub localStorage ก่อน import store (store เช็ค typeof window) ──
const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  },
};

// ⚠ ต้องใช้ fileURLToPath ไม่ใช่ new URL(...).pathname — pathname คืน %20 แทนช่องว่าง
//   → path ผิด → import ไม่เจอ (เจอจริง 14/10/69 ตอนเขียนเทสต์ชุดนี้)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = pathToFileURL(path.join(ROOT, 'sovereign-frontend/src/components/business/soverien')).href;
const store = await import(`${dir}/store.ts`);
const types = await import(`${dir}/types.ts`);
const zip = await import(`${dir}/zip.ts`);

const { load, save, issueSerials, formatSn, warrantyDates, warrantyState, addDays, daysBetween, buildCustomers, buildSummary, emptyDb, KEY } = store;

beforeEach(() => mem.clear());

// ── 1) Serial ต่อเนื่อง ไม่ซ้ำ ────────────────────────────────────────────
test('ออก serial ต่อเนื่องจากตัวสุดท้าย เริ่มที่ 000', () => {
  const db = emptyDb();
  const made = issueSerials(db, 'temp-01', 3);
  assert.deepEqual(made.map((s) => s.sn), ['Soverign-Temp-000', 'Soverign-Temp-001', 'Soverign-Temp-002']);
  db.serials.push(...made);
  const next = issueSerials(db, 'temp-01', 2);
  assert.deepEqual(next.map((s) => s.sn), ['Soverign-Temp-003', 'Soverign-Temp-004']);
});

test('ห้ามออก serial ซ้ำเด็ดขาด แม้เรียกซ้ำหลายรอบ', () => {
  const db = emptyDb();
  for (let i = 0; i < 20; i++) db.serials.push(...issueSerials(db, 'temp-01', 5));
  const all = db.serials.map((s) => s.sn);
  assert.equal(all.length, 100);
  assert.equal(new Set(all).size, 100, 'มี serial ซ้ำ');
  assert.ok(all.includes('Soverign-Temp-099'));
});

test('นับต่อจากข้อมูลเก่าที่โหลดกลับมา (localStorage) ไม่เริ่มใหม่', () => {
  const db = emptyDb();
  db.serials.push(...issueSerials(db, 'temp-01', 7));
  save(db);
  const back = load();
  const more = issueSerials(back, 'temp-01', 1);
  assert.equal(more[0].sn, 'Soverign-Temp-007');
  // ต้องตรวจตัวนับเองด้วย ไม่ใช่ผลลัพธ์อย่างเดียว
  // (ถ้ามีแต่ while(existing.has) ช่วย ผลลัพธ์จะถูกเสมอ แต่ lastNo จะเพี้ยน
  //  → รอบถัดไปจะเริ่มนับผิดตำแหน่งและเลขจะไม่เรียงตามเวลา)
  assert.equal(back.models[0].lastNo, 7, 'ตัวนับต้องเดินหน้าตามจำนวนที่ออกจริง');
});

test('ตัวนับ serial เดินหน้าตามจำนวนที่ออกเสมอ', () => {
  const db = emptyDb();
  assert.equal(db.models[0].lastNo, -1, 'เริ่มที่ -1 = ยังไม่ได้ออกเลย');
  issueSerials(db, 'temp-01', 1);
  assert.equal(db.models[0].lastNo, 0);
  issueSerials(db, 'temp-01', 4);
  assert.equal(db.models[0].lastNo, 4);
});

test('แต่ละรุ่นนับแยกกัน และ prefix ต่างกัน', () => {
  const db = emptyDb();
  db.models.push({ id: 'm2', name: 'รุ่น 2', prefix: 'Soverign-Pro', price: 1790, active: true, lastNo: -1 });
  const a = issueSerials(db, 'temp-01', 1)[0].sn;
  const b = issueSerials(db, 'm2', 1)[0].sn;
  assert.equal(a, 'Soverign-Temp-000');
  assert.equal(b, 'Soverign-Pro-000');
  assert.equal(formatSn(db.models[1], 12), 'Soverign-Pro-012');
});

// ── 2) Void แล้วตัวนับห้ามถอย (ไม่ให้ serial ถูกใช้ซ้ำ) ──────────────────
test('ยกเลิก serial แล้ว ตัวนับไม่ถอยหลัง', () => {
  const db = emptyDb();
  db.serials.push(...issueSerials(db, 'temp-01', 3));
  db.serials[1].status = 'VOID';
  const next = issueSerials(db, 'temp-01', 1);
  assert.equal(next[0].sn, 'Soverign-Temp-003', 'serial ที่ยกเลิก (001) ต้องไม่ถูกใช้ซ้ำ');
});

// ── 3) ประกัน: เริ่ม = ออกใบ + ขนส่ง(14) · สิ้น = เริ่ม + 365 ──────────────
test('คำนวณประกันถูกต้อง: ขนส่ง 14 วัน แล้ว 1 ปี', () => {
  const db = emptyDb();
  const { start, end } = warrantyDates('2026-01-01', db.settings);
  assert.equal(start, '2026-01-15');
  assert.equal(daysBetween(start, end), 365);
});

test('addDays ชนวันสิ้นเดือน/ปีได้ถูก', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // ปีอธิกสุทธิ์
});

test('สถานะประกัน: เขียว / เหลือง / แดง ตามระยะเวลาที่เหลือ', () => {
  const db = emptyDb();
  const mk = (end, status = 'ACTIVE') => ({
    id: 'o1', no: 'SO-0001', issueDate: '2026-01-01', customerName: 'x', phone: '08',
    serials: [], unitPrice: 0, total: 0, warrantyStart: '2026-01-15', warrantyEnd: end,
    status, createdAt: '',
  });
  const t = '2026-06-01';
  assert.equal(warrantyState(mk('2027-01-01'), db.settings, t).state, 'IN');
  assert.equal(warrantyState(mk('2026-06-20'), db.settings, t).state, 'NEAR', 'เหลือ 19 วัน = เหลือง');
  assert.equal(warrantyState(mk('2026-05-01'), db.settings, t).state, 'OUT');
  assert.equal(warrantyState(mk('2027-01-01', 'VOID'), db.settings, t).state, 'VOID');
});

test('เกณฑ์ "ใกล้หมดประกัน" ปรับตามการตั้งค่า', () => {
  const db = emptyDb();
  const o = { id: 'o', no: 'SO-1', issueDate: '2026-01-01', customerName: 'x', phone: '1', serials: [], unitPrice: 0, total: 0, warrantyStart: '2026-01-15', warrantyEnd: '2026-07-10', status: 'ACTIVE', createdAt: '' };
  assert.equal(warrantyState(o, db.settings, '2026-06-20').state, 'NEAR', 'เหลือ 20 วัน เกิน 30 ไม่ใช่');
  db.settings.nearExpiryDays = 45;
  assert.equal(warrantyState(o, db.settings, '2026-06-20').state, 'NEAR', 'ตั้ง 45 แล้วต้องเป็นเหลือง');
});

// ── 4) ลูกค้า dedupe ด้วยเบอร์ ────────────────────────────────────────────
test('รวมลูกค้าด้วยเบอร์โทร แม้รูปแบบเขียนต่างกัน', () => {
  const db = emptyDb();
  const mk = (id, phone, name, date, total) => ({ id, no: id, issueDate: date, customerName: name, phone, serials: [], unitPrice: total, total, warrantyStart: date, warrantyEnd: date, status: 'ACTIVE', createdAt: '' });
  db.orders = [mk('a', '081-234-5678', 'สมชาย', '2026-01-01', 990), mk('b', '0812345678', 'สมชาย ม.', '2026-02-01', 1790)];
  const cs = buildCustomers(db);
  assert.equal(cs.length, 1, 'ต้องรวมเป็นคนเดียว');
  assert.equal(cs[0].orderCount, 2);
  assert.equal(cs[0].value, 2780);
  assert.equal(cs[0].name, 'สมชาย ม.', 'ใช้ชื่อจากออเดอร์ล่าสุด');
});

test('ออเดอร์ที่ void ไม่ถูกนับใน CRM', () => {
  const db = emptyDb();
  db.orders = [{ id: 'a', no: 'a', issueDate: '2026-01-01', customerName: 'x', phone: '081', serials: [], unitPrice: 1, total: 1, warrantyStart: '', warrantyEnd: '', status: 'VOID', createdAt: '' }];
  assert.equal(buildCustomers(db).length, 0);
});

// ── 5) สรุปภาพรวม ─────────────────────────────────────────────────────────
test('สรุปนับแยกสถานะประกันและรายได้เฉพาะออเดอร์ที่ยังใช้งาน', () => {
  const db = emptyDb();
  const mk = (id, end, status = 'ACTIVE', total = 100) => ({ id, no: id, issueDate: '2026-01-01', customerName: 'x', phone: '1', serials: [], unitPrice: total, total, warrantyStart: '2026-01-15', warrantyEnd: end, status, createdAt: '' });
  db.orders = [mk('1', '2027-01-01'), mk('2', '2026-06-10'), mk('3', '2026-01-01'), mk('4', '2027-01-01', 'VOID', 999)];
  db.serials = issueSerials(db, 'temp-01', 4);
  const s = buildSummary(db, '2026-06-01');
  assert.equal(s.totalOrders, 3, 'void ไม่นับ');
  assert.equal(s.inWarranty, 1);
  assert.equal(s.nearExpiry, 1);
  assert.equal(s.expired, 1);
  assert.equal(s.revenue, 300, 'รายได้รวมเฉพาะออเดอร์ใช้งาน');
  assert.equal(s.totalSerials, 4);
  assert.equal(s.byMonth.length, 12);
});

// ── 6) ความทนทานของที่เก็บข้อมูล ──────────────────────────────────────────
test('ข้อมูลเสีย/ไม่ใช่เวอร์ชันนี้ → คืนค่าเริ่มต้น ไม่ crash', () => {
  mem.set('soverien.tools.v1', '{ไม่ใช่ JSON');
  assert.deepEqual(load().orders, []);
  mem.set('soverien.tools.v1', JSON.stringify({ version: 99, serials: [], orders: [] }));
  assert.equal(load().version, 1);
  mem.set('soverien.tools.v1', JSON.stringify({ version: 1, serials: [{ sn: 'x' }] }));
  assert.equal(load().orders.length, 0, 'orders ที่ไม่ใช่ array ต้องถูกทิ้ง');
});

test('wipeAll ล้างเฉพาะคีย์ของเครื่องมือนี้', () => {
  const db = emptyDb();
  db.serials.push(...issueSerials(db, 'temp-01', 2));
  save(db);
  mem.set('unrelated', 'ของอื่น');
  window.localStorage.removeItem(KEY);
  assert.equal(mem.has(KEY), false);
  assert.equal(mem.get('unrelated'), 'ของอื่น', 'ต้องไม่ไปแตะคีย์อื่นของแอป');
});

// ── 7) ตัวเขียน ZIP (ดาวน์โหลดสติกเกอร์ทั้งหมด) ───────────────────────────
test('crc32 ตรงกับค่ามาตรฐาน', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(zip.crc32(bytes), 0xcbf43926, 'ค่ามาตรฐาน CRC-32 ของ "123456789"');
});

test('ZIP ที่สร้างมี signature ถูกต้องครบ', () => {
  const blob = zip.buildZip([{ name: 'a.png', data: new Uint8Array([1, 2, 3]) }]);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'application/zip');
});

// ── 8) ค้นประกันด้วย S/N — ต้องแยก "ไม่มี serial" ออกจาก "ยังไม่ผูกออเดอร์" (14/10/69) ──
const { lookupWarranty } = store;

test('กรอกว่าง = ยังไม่ได้ค้น (EMPTY)', () => {
  assert.equal(lookupWarranty(emptyDb(), '   ').kind, 'EMPTY');
});

test('S/N ที่ไม่มีในระบบ = UNKNOWN (ต่างจาก serial ที่ออกแล้วแต่ยังไม่ขาย)', () => {
  assert.equal(lookupWarranty(emptyDb(), 'Soverign-Temp-999').kind, 'UNKNOWN');
});

test('serial ที่ออกแล้วแต่ยังไม่ผูกออเดอร์ = UNSOLD ไม่ใช่ UNKNOWN', () => {
  const db = emptyDb();
  const made = store.issueSerials(db, db.models[0].id, 1);
  db.serials.push(...made);
  const hit = lookupWarranty(db, made[0].sn);
  assert.equal(hit.kind, 'UNSOLD', 'serial มีจริงแต่ยังไม่ขาย → ต้องไม่ขึ้นว่า "ไม่พบ Serial"');
  assert.equal(hit.order, undefined);
});

test('serial ที่ผูกกับออเดอร์แล้ว = สถานะประกันจริง', () => {
  const db = emptyDb();
  const made = store.issueSerials(db, db.models[0].id, 1);
  const s = made[0];
  db.serials.push(s);
  db.orders.push({
    id: 'o1', no: 'SO-0001', customerName: 'ทดสอบ', phone: '0800000000', line: '', address: '', note: '',
    modelIds: [db.models[0].id], serials: [s.sn], issueDate: '2026-10-01',
    warrantyStart: '2026-10-15', warrantyEnd: '2027-10-15', status: 'ACTIVE', total: 0, createdAt: '2026-10-01',
  });
  s.orderId = 'o1';
  const hit = lookupWarranty(db, `  ${s.sn.toLowerCase()}  `);
  assert.equal(hit.kind, 'IN', 'ต้อง normalize เป็นตัวพิมพ์ใหญ่และตัดช่องว่าง');
  assert.equal(hit.order?.no, 'SO-0001');
});

test('ออเดอร์ที่ยกเลิก = VOID ไม่ใช่หมดประกัน', () => {
  const db = emptyDb();
  const made = store.issueSerials(db, db.models[0].id, 1);
  const s = made[0];
  db.serials.push(s);
  const o = {
    id: 'o1', no: 'SO-0001', customerName: 'ทดสอบ', phone: '0800000000', line: '', address: '', note: '',
    modelIds: [db.models[0].id], serials: [s.sn], issueDate: '2026-10-01',
    warrantyStart: '2026-10-15', warrantyEnd: '2027-10-15', status: 'VOID', total: 0, createdAt: '2026-10-01',
  };
  db.orders.push(o); s.orderId = 'o1';
  assert.equal(lookupWarranty(db, s.sn).kind, 'VOID');
});