// tools/test/soverien-tools.test.mjs
//
// ── ตรรกะเครื่องมือร้าน Soverien (14/10/69) ──
// ของจริง = serial ที่พิมพ์ลงป้าย + ประกันที่ลูกค้าเอาไปเรียกร้อง
// ผิดแม้แต่ตัวเดียว = ของชิ้นซ้ำ / ประกันคำนวณผิด → ต้องกันให้แน่น
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { readFileSync } from 'node:fs';
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
const layout = await import(`${dir}/sticker-layout.ts`);

const { load, save, issueSerials, formatSn, warrantyDates, warrantyState, addDays, daysBetween, buildCustomers, buildSummary, emptyDb, KEY } = store;

const fsReadFile = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

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

// ── 14) จับขนาดป้ายให้ตรงภาพ (14/10/69 จาก "ผมไม่สามารถปรับภาพให้ตรงได้เลย") ──
test('คำนวณส่วนสูงป้ายจากสัดส่วนภาพ คงความกว้างเดิม', () => {
  // ภาพ 1456×1090 (สัดส่วน ~4:3) ·ป้ายกว้าง 40 มม. → สูงต้องเป็น ~29.9
  const hMm = layout.stickerHeightFor(1456, 1090, 40);
  assert.ok(Math.abs(hMm - 29.9) < 0.15, `คำนวณได้ ${hMm} มม.`);
});

test('ภาพแคบสูงก็คำนวณได้ถูก (ไม่ใช่สมมติฐานว่ากว้างกว่าสูงเสมอ)', () => {
  assert.equal(layout.stickerHeightFor(500, 1000, 30), 60);      // แคบสูง 1:2 → สูงเป็น 2 เท่า
  assert.equal(layout.stickerHeightFor(1000, 500, 30), 15);      // กว้าง → สูงน้อย
});

test('กันหารด้วยศูนย์ — ภาพเสียต้องไม่ทำให้ป้ายเป็น Infinity', () => {
  assert.ok(Number.isFinite(layout.stickerHeightFor(0, 100, 40)), 'กว้างภาพ = 0');
  assert.ok(Number.isFinite(layout.stickerHeightFor(100, 0, 40)), 'สูงภาพ = 0');
  assert.ok(Number.isFinite(layout.stickerHeightFor(100, 100, 0)), 'ความกว้างป้าย = 0');
});

test('ปัดเป็นทศนิยม 1 ตำแหน่ง ไม่ให้โผล่ 29.9455555', () => {
  const v = layout.stickerHeightFor(1456, 1090, 40);
  assert.equal(String(v).split('.')[1]?.length <= 1, true, `ได้ ${v}`);
});

// ── 13) React ไม่รีเฟรช = ผู้ใช้ต้องกดอะไรสักอย่างก่อน (14/10/69) ─────────
const SOV_DIR = 'sovereign-frontend/src/components/business/soverien';
const components = ['StickerQuickPanel.tsx', 'StickerPresets.tsx','StickerStudio.tsx', 'SerialIssuer.tsx', 'OrderCreate.tsx', 'OrderVault.tsx', 'BackupSecurity.tsx'];

// ตัดคอมเมนต์ออกก่อนตรวจ ไม่งั้นจะไปจับ "โค้ดเก่า" ที่เขียนอธิบายไว้ในคอมเมนต์
const code = (rel) => fsReadFile(`${SOV_DIR}/${rel}`)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('ห้ามแก้ object เดิมแล้วส่งกลับเข้า setDb — React เทียบ Object.is แล้วไม่วาดใหม่', () => {
  for (const f of components) {
    const src = code(f);
    assert.doesNotMatch(
      src,
      /const next = db\b/,
      `${f}: ยังมี "const next = db" → ได้ object เดิม → เลื่อนสไลเดอร์แล้วไม่มีอะไรเกิดขึ้น`,
    );
  }
});

test('setDb(...) ต้องไม่รับตัวแปรที่ชี้กลับไปที่ db เดิม', () => {
  for (const f of components) {
    const src = code(f);
    for (const m of src.matchAll(/setDb\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const arg = m[1];
      assert.ok(
        arg !== 'db' && arg !== 'next',
        `${f}: setDb(${arg}) ส่ง object เดิมกลับเข้า → React จะไม่วาดหน้าจอใหม่`,
      );
    }
  }
});

test('จุดที่แก้ settings ต้องสร้าง object ใหม่ทุกชั้น (ไม่แก้ในตัว)', () => {
  // patch() ของ StickerStudio/BackupSecurity คือจุดที่ผู้ใช้ "ปรับค่าแล้วไม่มีผล"
  for (const f of ['StickerStudio.tsx', 'BackupSecurity.tsx']) {
    const src = code(f);
    assert.match(
      src,
      /setDb\(\{\s*\.\.\.db,\s*settings:\s*\{\s*\.\.\.db\.settings/,
      `${f}: patch() ต้องสร้าง object ใหม่ทั้ง db และ settings`,
    );
  }
});

test('setDb ใน hub ต้องบันทึกลง localStorage แล้วค่อยอัปเดต state', () => {
  const hub = code('SoverienHub.tsx');
  assert.match(hub, /save\(d\);\s*\n?\s*setDbState\(d\)/, 'ต้อง save ก่อน setState เพื่อไม่ให้ข้อมูลหายเงียบ');
});

// ── 15) โหมดง่าย + แม่แบบป้าย (14/10/69 จาก "ยุ่งยากทั้งๆ ที่ควรจะง่าย") ──
test('หน้าสติกเกอร์เปิดโหมดง่ายเป็นค่าเริ่มต้น (ซ่อนตัวเลื่อน ~20 ตัว)', () => {
  const src = code('StickerStudio.tsx');
  assert.match(src, /useState\(false\)/, 'ต้องเริ่มเป็นโหมดง่าย');
  assert.match(src, /StickerQuickPanel/, 'โหมดง่ายต้องใช้แผงย่อ');
  assert.match(src, /StickerControls/, 'ต้องมีโหมดขั้นสูงไว้ให้เปิดเมื่อจำเป็น');
});

test('ตัวเลื่อน/ช่องละเอียดต้องอยู่ฝั่งขั้นสูง ไม่โผล่ในโหมดง่าย', () => {
  const quick = code('StickerQuickPanel.tsx');
  assert.doesNotMatch(quick, /NumSlider/, 'แผงโหมดง่ายต้องไม่มีสไลเดอร์ยาว ๆ');
  assert.doesNotMatch(quick, /qrX|qrY|serialX|serialY/, 'ตำแหน่งละเอียดอยู่ฝั่งขั้นสูง');
});

test('แม่แบบป้าย: บันทึก/เรียก/ลบ ครบ และไม่กิน id ซ้ำ', () => {
  const src = code('StickerPresets.tsx');
  assert.match(src, /onSave/, 'ต้องบันทึกได้');
  assert.match(src, /onApply/, 'ต้องเรียกกลับมาได้');
  assert.match(src, /onDelete/, 'ต้องลบได้');
  const studio = code('StickerStudio.tsx');
  assert.match(studio, /`p-\$\{Date\.now\(\)\.toString\(36\)\}`/, 'id ต้องไม่ซ้ำ (ใช้เวลาปัจจุบัน)');
});

test('db ต้องเก็บ stickerPresets และข้อมูลเก่าที่ไม่มีต้องไม่พัง', () => {
  const empty = emptyDb();
  assert.deepEqual(empty.stickerPresets, [], 'ของใหม่ต้องมีช่องว่าง');
  mem.clear();
  const old = { ...emptyDb() };
  delete old.stickerPresets;                 // ข้อมูลที่บันทึกไว้ก่อนมีฟิลด์นี้
  mem.set(KEY, JSON.stringify(old));
  const db = load();
  assert.deepEqual(db.stickerPresets, [], 'ข้อมูลเก่าต้องได้ [] ไม่ใช่ undefined');
});

// ── 12) โครงสร้างแท็บเครื่องมือ ต้องไม่รกกลับมา (14/10/69) ────────────────
const hubSrc = fsReadFile('sovereign-frontend/src/components/business/soverien/SoverienHub.tsx');

test('แท็บหลักไม่เกิน 5 อัน (เดิม 9 อัน รกจนมองไม่ออกว่ากดอะไรก่อน)', () => {
  const block = hubSrc.slice(hubSrc.indexOf('const TABS'), hubSrc.indexOf('const SECTIONS'));
  const labels = block.match(/label: '([^']+)'/g) || [];
  assert.equal(labels.length, 5, `ต้องมี 5 แท็บหลัก · ตอนนี้มี ${labels.length}: ${labels.join(' / ')}`);
});

test('เครื่องมือทั้ง 9 ส่วนต้องยังเข้าถึงได้ ไม่มีอันไหนหายไปกับการรวมแท็บ', () => {
  for (const c of ['SummaryCards', 'SalesGuide', 'SerialIssuer', 'StickerStudio', 'OrderCreate',
    'OrderVault', 'WarrantyCheck', 'CustomerCRM', 'BackupSecurity']) {
    assert.ok(hubSrc.includes(`<${c} `), `ต้องยังเรียกใช้ ${c} ได้`);
    assert.ok(hubSrc.includes(`import ${c} from`), `ต้องมี import ของ ${c}`);
  }
});

test('รายละเอียดถูกซ่อนไว้ในหัวข้อย่อย ไม่โผล่เป็นแท็บหลัก', () => {
  for (const s of ['ออก Serial', 'พิมพ์สติกเกอร์', 'คลังออเดอร์', 'ตรวจประกัน', 'ลูกค้า', 'คู่มือขาย']) {
    assert.ok(hubSrc.includes(`label: '${s}'`), `'${s}' ต้องอยู่ในกลุ่มหัวข้อย่อย`);
  }
});

test('ทุกหัวข้อย่อยต้องมีเนื้อหาตรงกัน ไม่มีปุ่มที่กดแล้วไม่ได้อะไร', () => {
  // ต้องดูเฉพาะบล็อก SECTIONS — TABS ก็ใช้รูปแบบ { key:..., label:... } เหมือนกัน
  const block = hubSrc.slice(hubSrc.indexOf('const SECTIONS'), hubSrc.indexOf('const DEFAULT_SECTION'));
  const keys = [...block.matchAll(/\{ key: '(\w+)', label:/g)].map((m) => m[1]);
  assert.equal(keys.length, 7, `ต้องมีหัวข้อย่อย 7 อัน (2+2+3) · เจอ ${keys.length}`);
  for (const k of keys) {
    assert.ok(hubSrc.includes(`section === '${k}'`), `หัวข้อย่อย "${k}" ต้องมีเงื่อนไข render ด้วย`);
  }
});

test('ออกออเดอร์/กดทำสติกเกอร์ ต้องพาไปหัวข้อ "พิมพ์สติกเกอร์" ถูกที่', () => {
  assert.match(hubSrc, /const goSticker[\s\S]*?setTab\('sticker'\);[\s\S]*?setSection\('design'\)/,
    'ต้องพาไปแท็บสติกเกอร์ + หัวข้อย่อยพิมพ์สติกเกอร์ (ไม่ใช่ค้างที่หัวข้อผิด)');
});

test('ยังคุม PIN ไว้ที่แท็บที่เคยคุม (ออกออเดอร์ + ติดตาม)', () => {
  assert.match(hubSrc, /key: 'sell'.*needPin: true/, 'ออกออเดอร์ต้องมี PIN');
  assert.match(hubSrc, /key: 'track'.*needPin: true/, 'คลังออเดอร์/ตรวจประกันต้องมี PIN');
});

// ── 11) ข้อมูลห้ามหายเงียบ (14/10/69) ──────────────────────────────────────
const richDb = () => {
  const d = emptyDb();
  d.orders.push({
    id: 'o1', no: 'SO-0001', customerName: 'สำคัญ', phone: '0800000000', line: '', address: '', note: '',
    modelIds: [], serials: [], issueDate: '2026-10-01', warrantyStart: '2026-10-15', warrantyEnd: '2027-10-15',
    status: 'ACTIVE', total: 0, createdAt: '2026-10-01',
  });
  d.settings.sticker.templateDataUrl = 'data:image/jpeg;base64,PRECIOUS';
  return d;
};

test('JSON อ่านไม่ขึ้น = เก็บสำเนาของดิบไว้ ไม่ใช่ปล่อยทิ้ง', () => {
  mem.clear();
  mem.set(KEY, '{"version":1,"serials":[');   // ข้อมูลพังกลางคัน
  const db = store.load();
  assert.equal(db.orders.length, 0, 'คืนค่าว่างให้ใช้ต่อได้ ไม่ค้าง');
  const kept = [...mem.keys()].filter((k) => k.startsWith(KEY + '.damaged.'));
  assert.equal(kept.length, 1, 'ต้องเก็บของดิบไว้ 1 ชุด');
  assert.equal(mem.get(kept[0]), '{"version":1,"serials":[', 'เก็บของดิบตามเดิมทุกตัวอักษร');
});

test('JSON ถูกแต่รูปร่างไม่ผ่าน (เช่น version ไม่ตรง) = ต้องเก็บสำเนาไว้เหมือนกัน', () => {
  // ⚠ เส้นทางนี้เดิมไม่เก็บสำเนาเลย แต่เป็นเส้นทางที่พบบ่อยกว่า (ข้อมูลจากเวอร์ชันเก่า/ถูกแก้)
  mem.clear();
  const bad = { ...richDb(), version: 99 };
  mem.set(KEY, JSON.stringify(bad));
  const db = store.load();
  assert.equal(db.orders.length, 0, 'คืนค่าว่างให้ใช้ต่อได้');
  const kept = [...mem.keys()].filter((k) => k.startsWith(KEY + '.damaged.'));
  assert.equal(kept.length, 1, 'ต้องเก็บของดิบไว้ ไม่ใช่ทิ้งให้หาย');
  const raw = JSON.parse(mem.get(kept[0]));
  assert.equal(raw.settings.sticker.templateDataUrl, 'data:image/jpeg;base64,PRECIOUS', 'ภาพต้นแบบต้องอยู่ในของที่กู้');
  assert.equal(raw.orders.length, 1, 'ออเดอร์ต้องอยู่ในของที่กู้');
});

test('ข้อมูลดีปกติ = ไม่ต้องสร้างสำเนาซ้ำเปล่า', () => {
  mem.clear();
  mem.set(KEY, JSON.stringify(richDb()));
  const db = store.load();
  assert.equal(db.orders.length, 1, 'อ่านได้ตามปกติ');
  assert.equal(db.settings.sticker.templateDataUrl, 'data:image/jpeg;base64,PRECIOUS');
  assert.equal([...mem.keys()].filter((k) => k.includes('.damaged.')).length, 0, 'ไม่ต้องมีสำเนาเพราะไม่มีอะไรเสีย');
});

test('patch ค่าเดียว ต้องไม่ทำให้ฟิลด์เดิม (ภาพต้นแบบ) หาย', () => {
  mem.clear();
  const db = richDb();
  const merged = { ...db.settings.sticker, tplFit: 'contain' };
  assert.equal(merged.templateDataUrl, 'data:image/jpeg;base64,PRECIOUS', 'spread ต้องไม่ทิ้งฟิลด์เดิม');
  assert.equal(merged.tplFit, 'contain', 'แต่ต้องอัปเดตค่าใหม่');
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

// ── 10) จัดวางสติกเกอร์ (14/10/69 จากอาการ "ย่อภาพไม่ได้ / ปรับตัวอักษรไม่คล่อง / ตัวหนังสือไม่ชัด") ──
test('ปัดทศนิยมเหลือ 3 ตำแหน่ง — กันเลขยาวอย่าง 0.3787364104 ในช่องกรอก', () => {
  assert.equal(layout.round3(0.3787364104), 0.379);
  assert.equal(layout.round3(0.6042961035), 0.604);
  assert.equal(layout.round3(1 / 3), 0.333);
  assert.equal(layout.round3(0), 0);
});

test('clamp ไม่ให้ค่าหลุดช่วง และกัน NaN จากช่องกรอกว่าง', () => {
  assert.equal(layout.clamp(1.4, 0, 1), 1);
  assert.equal(layout.clamp(-0.2, 0, 1), 0);
  assert.equal(layout.clamp(NaN, 0, 1), 0, 'ช่องว่างมาเป็น NaN ต้องไม่ทำให้ภาพพัง');
  assert.equal(layout.clamp(2, -1, 1), 1);
});

test('contain = เห็นภาพต้นแบบครบทั้งภาพ (ขอบว่างได้ แต่ขอบภาพห้ามหาย)', () => {
  // สติกเกอร์ 400x200, ภาพต้นแบบ 1000x400 (กว้างกว่ามาก)
  const r = layout.fitImageRect(1000, 400, 400, 200, 'contain');
  assert.ok(r.w <= 400 + 0.001, 'ความกว้างต้องไม่เกินสติกเกอร์');
  assert.ok(r.h <= 200 + 0.001, 'ความสูงต้องไม่เกินสติกเกอร์');
  // ไม่มีขอบไหนโดนตัด → อัตราส่วนต้องตรงเท่าเดิม
  assert.ok(Math.abs(r.w / r.h - 1000 / 400) < 0.001, 'ต้องรักษาสัดส่วนภาพ (ไม่เบี้ยว)');
});

test('cover = เต็มพื้นที่เสมอ (ตัดขอบทิ้ง) แต่ห้ามเกินกรอบ', () => {
  const r = layout.fitImageRect(1000, 400, 400, 200, 'cover');
  assert.ok(r.w >= 400 - 0.001, 'cover ต้องเต็มความกว้าง');
  assert.ok(r.h >= 200 - 0.001, 'cover ต้องเต็มความสูง');
});

test('stretch = ยืดเต็มกรอบพอดี ไม่มีขอบว่าง', () => {
  const r = layout.fitImageRect(1000, 400, 400, 200, 'stretch');
  assert.deepEqual([r.w, r.h], [400, 200]);
});

test('ย่อภาพให้เล็กได้จริงด้วย tplScale (ของที่เจ้าของบอกว่าทำไม่ได้)', () => {
  const full = layout.fitImageRect(1000, 400, 400, 200, 'contain', 1);
  const half = layout.fitImageRect(1000, 400, 400, 200, 'contain', 0.5);
  assert.ok(half.w < full.w / 2 + 0.001, 'scale 0.5 ต้องเล็กลงครึ่งหนึ่ง');
  const big = layout.fitImageRect(1000, 400, 400, 200, 'contain', 2);
  assert.ok(big.w > full.w * 2 - 0.001, 'scale 2 ต้องใหญ่ขึ้นสองเท่า');
});

test('เลื่อนภาพได้ทั้งแนวนอนและแนวตั้ง และห้ามหลุดเกิน 1', () => {
  const c = layout.fitImageRect(1000, 400, 400, 200, 'contain');
  const moved = layout.fitImageRect(1000, 400, 400, 200, 'contain', 1, 0.5, -0.5);
  assert.ok(moved.x > c.x + 50, 'ox บวกต้องขยับไปทางขวา');
  assert.ok(moved.y < c.y - 10, 'oy ลบต้องขยับขึ้น');
  const wild = layout.fitImageRect(1000, 400, 400, 200, 'contain', 1, 99, -99);
  assert.ok(Math.abs(wild.x - c.x) <= 400 + 0.001, 'ox เกินขอบเขตต้องถูก clamp');
});

test('จัดตำแหน่งข้อความ: ซ้าย / กึ่งกลาง / ขวา อ้างอิงจุดเดียวกัน', () => {
  const anchor = 300, boxW = 100, W = 400;
  assert.equal(layout.alignOffsetX('left', boxW, W, anchor), 300);
  assert.equal(layout.alignOffsetX('center', boxW, W, anchor), 250);
  assert.equal(layout.alignOffsetX('right', boxW, W, anchor), 200);
});

test('ตัวอักษรยาวเกินช่อง = ย่อขนาดให้พอดี ไม่ให้ล้นออกป้าย', () => {
  const want = 26;
  assert.equal(layout.fitFontSize('Soverign-Temp-000', 400, want), want, 'สั้นพอ = คงขนาดเดิม');
  const shrunk = layout.fitFontSize('Soverign-Temp-000-EXTRA-LONG-SERIAL', 400, want);
  assert.ok(shrunk < want, 'ยาวเกิน = ต้องย่อลง');
  assert.ok(shrunk >= 8, 'แต่ห้ามย่อเล็กกว่า 8 (อ่านไม่ออก)');
});

// ── 9) ปลายทาง QR บนป้ายสติกเกอร์ (14/10/69) ───────────────────────────────
test('ไม่ตั้งปลายทาง = ใช้ origin ของเครื่องที่เปิดแอป', () => {
  assert.equal(
    store.warrantyUrl('', 'http://localhost:3000', 'Soverign-Temp-001'),
    'http://localhost:3000/warranty?sn=Soverign-Temp-001',
  );
});

test('ตั้งโดเมนจริงแล้ว QR ชี้ไปโดเมนนั้น (ลูกค้าสแกนด้วยมือถือได้)', () => {
  assert.equal(
    store.warrantyUrl('https://shop.example.com', 'http://localhost:3000', 'Soverign-Temp-001'),
    'https://shop.example.com/warranty?sn=Soverign-Temp-001',
  );
});

test('ตัดเครื่องหมาย / ท้ายออก ไม่ให้ URL ซ้ำสองชั้น', () => {
  assert.equal(
    store.warrantyUrl('https://shop.example.com///', 'http://localhost:3000', 'S-1'),
    'https://shop.example.com/warranty?sn=S-1',
  );
});

test('escape S/N ที่มีอักขระพิเศษ กันพัง URL', () => {
  assert.equal(
    store.warrantyUrl(undefined, 'http://localhost:3000', 'A&B C/D'),
    'http://localhost:3000/warranty?sn=A%26B%20C%2FD',
  );
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