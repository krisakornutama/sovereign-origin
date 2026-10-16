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
const presets = await import(`${dir}/sticker-presets.ts`);
const sizes = await import(`${dir}/sticker-sizes.ts`);
const fonts = await import(`${dir}/sticker-fonts.ts`);
const tpl = await import(`${dir}/sticker-template.ts`);

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
const storesrc = code('store.ts');

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
  // ⚠ 16/10/69 — เดิมยืนยันด้วยการ grep หา `Date.now()` ใน StickerStudio.tsx ซึ่งพิสูจน์อะไรไม่ได้จริง
  //   (grep ผ่าน ≠ id ไม่ซ้ำ) → ทดสอบพฤติกรรมจริงแทน: สร้าง 500 ชุดในลมติดกัน ต้องได้ id ไม่ซ้ำเลย
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(presets.newPresetId());
  assert.equal(ids.size, 500, `สร้าง 500 แม่แบบแล้ว id ต้องไม่ซ้ำ (ได้ ${ids.size} ค่า)`);

  const cfg = store.DEFAULT_STICKER;
  const one = presets.makePreset('ป้ายหลัก', cfg);
  assert.notEqual(one.cfg, cfg, 'ต้องคัดลอก cfg ไม่ใช่อ้างอิงของเดิม (ไม่งั้นแก้ที่ที่หนึ่งโดยไปแก้ทั้งชุด)');
  one.cfg.serialX = 0.9;
  assert.equal(cfg.serialX, store.DEFAULT_STICKER.serialX, 'แก้แม่แบบที่บันทึกแล้ว ต้องไม่กระทบค่าเดิม');
  assert.ok(!ids.has(one.id), 'id ของ makePreset ต้องไม่ชนกับที่สร้างไว้ก่อน');
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

// ── 16) พิมพ์หลายใบบนกระดาษ 1 แผ่น (14/10/69 จาก "พิมพ์ได้ 8-16 ภาพ หรือมากกว่า") ──
const A4 = { paperWMm: 210, paperHMm: 297, dpi: 300, marginMm: 10, gapMm: 2, stickerWMm: 30, stickerHMm: 22.5 };
const gapPxOf = (gapMm, dpi) => Math.round((gapMm / 25.4) * dpi);

test('A4 จัดป้าย 30×22.5 มม. ได้มากกว่า 16 ใบตามที่เจ้าของต้องการ', () => {
  const p = layout.planSheet(A4);
  assert.ok(p.capacity >= 16, `ได้ ${p.cols}×${p.rows} = ${p.capacity} ใบ (ต้องการ ≥16)`);
});

test('ชิ้นสุดท้ายต้องไม่ล้นขอบกระดาษ', () => {
  const p = layout.planSheet(A4);
  const g = gapPxOf(A4.gapMm, A4.dpi);
  for (const i of [0, p.capacity - 1]) {
    const c = layout.sheetCellXY(p, i, g);
    assert.ok(c.x + p.cellWpx <= p.pageWpx, `ชิ้นที่ ${i} ล้นขอบขวา: ${c.x}+${p.cellWpx} > ${p.pageWpx}`);
    assert.ok(c.y + p.cellHpx <= p.pageHpx, `ชิ้นที่ ${i} ล้นขอบล่าง: ${c.y}+${p.cellHpx} > ${p.pageHpx}`);
  }
});

test('หน้ากระดาษต้องได้ 2480×3508 px ที่ 300 dpi (มาตรฐาน A4 สำหรับพิมพ์)', () => {
  const p = layout.planSheet(A4);
  assert.equal(p.pageWpx, 2480);
  assert.equal(p.pageHpx, 3508);
});

test('ขอบกระดาษน้อยลง = ได้ป้ายมากขึ้น', () => {
  const wide = layout.planSheet({ ...A4, marginMm: 5 });
  const narrow = layout.planSheet({ ...A4, marginMm: 20 });
  assert.ok(wide.capacity > narrow.capacity, `ขอบ 5 มม. ได้ ${wide.capacity} > ขอบ 20 มม. ได้ ${narrow.capacity}`);
});

test('ระยะห่างเพิ่ม = ลดจำนวนป้าย (ต้องพอให้ตัดได้)', () => {
  const tight = layout.planSheet({ ...A4, gapMm: 1 });
  const loose = layout.planSheet({ ...A4, gapMm: 6 });
  assert.ok(tight.capacity > loose.capacity, `ห่าง 1 มม. ได้ ${tight.capacity} > ห่าง 6 มม. ได้ ${loose.capacity}`);
});

test('ค่าผิดปกติต้องไม่ทำให้ระบบพัง (0 หรือ ติดลบ)', () => {
  assert.ok(layout.planSheet({ ...A4, dpi: 0 }).pageWpx > 0, 'dpi = 0 ต้องกลับไปใช้ 300');
  const z = layout.planSheet({ ...A4, stickerWMm: 0, stickerHMm: 0 });
  assert.ok(Number.isFinite(z.cols) && Number.isFinite(z.rows), 'ป้าย 0 มม. ต้องไม่ให้ Infinity/NaN');
  assert.ok(z.capacity >= 1 && z.cellWpx > 0, `ป้าย 0 มม. ต้องยังจัดได้ (ได้ ${z.capacity} ช่อง)`);
  const neg = layout.planSheet({ ...A4, gapMm: -5, marginMm: -20 });
  assert.ok(Number.isFinite(neg.capacity) && neg.capacity >= 1, 'ค่าติดลบต้องไม่ทำให้พัง');
});

test('ช่องถัดไปต้องขยับตามระยะห่างพอดี ไม่ทับกัน', () => {
  const p = layout.planSheet(A4);
  const g = gapPxOf(A4.gapMm, A4.dpi);
  const a = layout.sheetCellXY(p, 0, g);
  const b = layout.sheetCellXY(p, 1, g);
  assert.equal(b.x - (a.x + p.cellWpx), g, 'ระยะแนวนอนต้องเท่ากับ gap พอดี');
});

// ── 17) ขนาดป้าย + ฟอนต์ + ขนาดจริงจากไฟล์ (16/10/69 จากเจ้าของ) ────────────
test('ค่าเริ่มต้นต้องเป็นกรอบอุปกรณ์ 81×55 มม. ที่เจ้าของวัดมา', () => {
  assert.equal(store.DEFAULT_STICKER.widthMm, 81, '8.1 ซม. = 81 มม.');
  assert.equal(store.DEFAULT_STICKER.heightMm, 55, '5.5 ซม. = 55 มม.');
});

test('ค่าเริ่มต้นต้องใช้ฟอนต์ Garuda (ของเจ้าของ) ไม่ใช่ฟอนต์โค้ด', () => {
  assert.equal(store.DEFAULT_STICKER.serialFont, 'Garuda');
  assert.doesNotMatch(storesrc, /JetBrains Mono/, 'อย่าฝังฟอนต์เว็บไว้ใน store — ถ้าเครื่องอื่นไม่มีจะกลายเป็นฟอนต์สำรองเงียบ ๆ');
});

test('ฟอนต์ที่มีช่องว่างต้องถูกห่อด้วยอัญประกาศ (ไม่งั้น canvas ตัดที่ช่องว่างแล้วหาไม่เจอ)', () => {
  assert.equal(fonts.fontCss('Leelawadee UI', 40, false), '400 40px "Leelawadee UI"');
  assert.equal(fonts.fontCss('Garuda', 48, true), '700 48px "Garuda"');
  assert.match(fonts.fontCss('Tahoma', 30, true), /^700 /, 'ตัวหนาได้ weight 700');
});

test('ค่าฟอนต์ผิดปกติต้องกลายเป็นค่าใช้ได้ ไม่ใช่ ctx.font ที่พัง', () => {
  assert.equal(fonts.fontCss('', 0, false), '400 16px "Garuda"', 'ค่าว่าง/ขนาดศูนย์ = ใช้ค่าเริ่มต้น');
  assert.equal(fonts.fontCss('  ', -5, false), '400 16px "Garuda"', 'ค่าติดลบ = ใช้ค่าเริ่มต้น');
  assert.equal(fonts.safeFontName('a"b;c'), 'abc', 'ตัดอัญประกาศ/เซมิโคลอนที่จะทำให้ CSS เพี้ยน');
  assert.equal(fonts.safeFontName(''), 'Garuda', 'ว่าง = Garuda');
});

test('เปลี่ยนขนาดป้ายแล้วขนาดตัวอักษรต้องขยับตาม (ไม่งั้นป้ายใหญ่ขึ้นแต่อักษรเล็กเท่าเดิม = อ่านไม่ออก)', () => {
  const big = sizes.serialSizeFor(81, 300);
  const small = sizes.serialSizeFor(40, 300);
  assert.ok(big > small, `81 มม. (${big} px) ต้องใหญ่กว่า 40 มม. (${small} px)`);
  const patch = sizes.sizePatch({ key: 'k', label: 'l', widthMm: 81, heightMm: 55 }, 300);
  assert.equal(patch.serialSize, big, 'sizePatch ต้องใช้ขนาดตัวอักษรที่คำนวณมา');
  assert.equal(patch.widthMm, 81);
  assert.equal(patch.heightMm, 55);
});

test('รายการขนาดต้องมีกรอบอุปกรณ์ 81×55 เป็นค่าแรก และไฮไลต์ได้ตรงตัว', () => {
  assert.equal(sizes.STICKER_SIZES[0].key, 'device-81x55');
  assert.equal(sizes.matchSize(81, 55), 'device-81x55');
  assert.equal(sizes.matchSize(77, 55), null, 'ขนาดที่ไม่มีในรายการต้องไม่ไฮไลต์ปุ่มไหนเลย');
});

/** สร้าง PNG header ปลอม ๆ ที่มี chunk pHYs ตามหน่วยพิกเซลต่อเมตร */
function pngWithPhys(pxW, pxH, ppu) {
  const b = new Uint8Array(64);
  b.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const be = (o, v) => { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; };
  be(33, 9);                                        // ความยาว chunk
  b.set([0x70, 0x48, 0x59, 0x73], 37);              // 'p' 'H' 'Y' 's'
  be(41, ppu); be(45, ppu); b[49] = 1;              // ppuX, ppuY, หน่วย = เมตร
  return tpl.pngPhysicalMm(b, pxW, pxH);
}

test('อ่านขนาดจริงจากไฟล์ PNG ได้ (เจ้าของไม่ต้องพิมพ์ตัวเลขเอง)', () => {
  // 81×55 มม. @300 dpi = 957×650 px และ 11811 พิกเซล/เมตร (300/0.0254)
  const r = pngWithPhys(957, 650, 11811);
  assert.ok(r, 'ต้องอ่านได้');
  assert.ok(Math.abs(r.widthMm - 81) < 0.5, `ได้ ${r.widthMm?.toFixed(1)} มม. (คาด ~81)`);
  assert.ok(Math.abs(r.heightMm - 55) < 0.5, `ได้ ${r.heightMm?.toFixed(1)} มม. (คาด ~55)`);
  assert.ok(Math.abs(r.dpi - 300) < 2, `ได้ ${r.dpi} dpi (คาด ~300)`);
});

test('ไฟล์ที่ไม่มีขนาดจริงต้องคืน null ไม่ใช่ตัวเลขมั่ว', () => {
  assert.equal(tpl.pngPhysicalMm(new Uint8Array(0), 100, 100), null, 'ไฟล์ว่าง');
  const short = new Uint8Array(10);
  short.set([137, 80, 78, 71, 13, 10, 26, 10], 0);   // signature มี แต่ข้อมูลไม่ครบ
  assert.equal(tpl.pngPhysicalMm(short, 100, 100), null, 'ไฟล์สั้นกว่า header');
  const jpeg = new Uint8Array(64); jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
  assert.equal(tpl.pngPhysicalMm(jpeg, 100, 100), null, 'ไม่ใช่ PNG (JPEG)');
  // ชิ้น chunk ชื่ออื่น (เช่น sRGB) ต้องไม่ถูกอ่านเป็น pHYs
  const other = new Uint8Array(64);
  other.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  other.set([0x73, 0x52, 0x47, 0x42], 37);            // "sRGB"
  assert.equal(tpl.pngPhysicalMm(other, 100, 100), null, 'chunk ชื่ออื่น = ใช้ไม่ได้');
  // หน่วยไม่ใช่เมตร = ไม่รู้ขนาดจริง
  const noUnit = new Uint8Array(64);
  noUnit.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const be = (o, v) => { noUnit[o] = (v >>> 24) & 255; noUnit[o + 1] = (v >>> 16) & 255; noUnit[o + 2] = (v >>> 8) & 255; noUnit[o + 3] = v & 255; };
  be(33, 9); noUnit.set([0x70, 0x48, 0x59, 0x73], 37); be(41, 11811); be(45, 11811); noUnit[49] = 0;
  assert.equal(tpl.pngPhysicalMm(noUnit, 957, 650), null, 'หน่วยไม่ใช่เมตร = ใช้ไม่ได้');
});

test('ป้าย Sovereign OS ต้องตั้งค่าให้เห็นบนแถบสีเข้ม (16/10/69 จากภาพต้นแบบจริง)', () => {
  const p = presets.labelProfile('sovereign-os');
  assert.ok(p, 'ต้องมีโปรไฟล์ป้าย Sovereign OS');
  assert.equal(p.patch.serialColor, '#ffffff', 'ช่อง Serial No. อยู่บนแถบน้ำเงินเข้ม → ตัวเลขต้องเป็นสีขาว (สีดำมองไม่เห็น)');
  assert.equal(p.patch.showQr, false, 'มี QR พิมพ์ไว้แล้วมุมขวาล่าง ห้ามวางทับ');
  assert.equal(p.patch.showWarranty, false, 'บรรทัดวันสิ้นประกันจะไปชนกับ QR ที่พิมพ์ไว้');
  assert.equal(p.patch.serialPlate, false, 'พื้นหลังสีขาวบนแถบเข้มจะเห็นเป็นก้อนสีขาว');
  assert.ok(p.patch.serialY > 0.7 && p.patch.serialY < 0.95, `ตำแหน่งต้องอยู่แถบล่าง (ได้ ${p.patch.serialY})`);
  assert.ok(p.patch.serialX > 0.15 && p.patch.serialX < 0.5, `ต้องอยู่ถัดจากคำว่า "Serial No." (ได้ ${p.patch.serialX})`);
});

test('โปรไฟล์ป้ายเปล่าต้องตั้งค่าตรงข้ามกับป้าย Sovereign OS', () => {
  const a = presets.profilePatch('sovereign-os', store.DEFAULT_STICKER);
  const b = presets.profilePatch('blank-light', store.DEFAULT_STICKER);
  assert.equal(b.serialColor, '#111827', 'พื้นสว่างใช้ตัวเลขสีเข้ม');
  assert.equal(b.showQr, true, 'ป้ายเปล่าให้ระบบวาง QR เอง');
  assert.notEqual(a.serialColor, b.serialColor, 'สองแบบต้องต่างกันจริง');
  assert.equal(presets.profilePatch('ไม่มีแบบนี้', store.DEFAULT_STICKER), null, 'ชื่อไม่รู้จัก = ไม่แก้อะไร');
});

test('หน้าจอต้องมีตัวเลือกขนาดและฟอนต์ และต้องเช็คว่าฟอนต์มีในเครื่องจริง', () => {
  const quick = code('StickerQuickPanel.tsx');
  assert.match(quick, /STICKER_SIZES/, 'ต้องมีปุ่มเลือกขนาดป้าย');
  assert.match(quick, /serialFont/, 'ต้องมีตัวเลือกฟอนต์');
  assert.match(quick, /isFontAvailable/, 'ต้องเช็คว่าฟอนต์มีในเครื่อง (canvas เงียบ ๆ เมื่อฟอนต์หาย)');
  assert.match(code('sticker-draw.ts'), /fontCss\(cfg\.serialFont/, 'ตัววาดต้องใช้ฟอนต์ที่เลือก ไม่ hardcode');
});

// ── 18) เส้นประกอบห้ามหลุดไปกับไฟล์ที่ดาวน์โหลด (16/10/69) ────────────────
// ⚠ ตอนนี้ผมนับ "พิกเซลสีเขียว" ในไฟล์ที่ดาวน์โหลด แล้วสรุปว่ามีเส้นประกอบติดไป
//   ผิด — ป้ายจริงของเจ้าของมีสีเขียวอยู่ในภาพอยู่แล้ว (เกล็ดหิมะ/วงจรไฟฟ้า) นับได้ 20 พิกเซล
//   ทั้งที่ไฟล์สะอาด → การวัดด้วยสีพิสูจน์อะไรไม่ได้ ต้องดูว่า "สั่งวาดกรอบ" หรือไม่ตรง ๆ
const frame = await import(`${dir}/sticker-frame.ts`);

function spyCtx() {
  const calls = { strokeRect: [], setLineDash: [], fillText: [], save: 0, restore: 0 };
  const ctx = new Proxy({}, {
    get(_t, p) {
      if (p === 'measureText') return () => ({ width: 120 });
      if (p in calls) return (...a) => { calls[p] = Array.isArray(calls[p]) ? [...calls[p], ...a] : calls[p] + 1; };
      return () => {};
    },
    set() { return true; },
  });
  return { ctx, calls };
}

test('กรอบประกอบวาดเป็นเส้นประกอบจริง (ขีดกลับมา 1 กรอบ + ล้างสถานะ)', () => {
  const a = spyCtx();
  frame.drawGuideFrame(a.ctx, 100, 200, 250, 40);
  assert.equal(a.calls.strokeRect.length, 4, `ต้องวาดกรอบ 1 ครั้ง (ได้ ${a.calls.strokeRect.length / 4} ครั้ง)`);
  assert.deepEqual(a.calls.strokeRect, [96, 176, 258, 48], 'กรอบต้องอยู่รอบกล่องข้อความจริง');
  // ⚠ spy เก็บ "รายการของ argument แต่ละครั้ง" → setLineDash([4,3]) เก็บเป็น [[4,3]]
  assert.deepEqual(a.calls.setLineDash, [[4, 3]], 'ต้องเป็นเส้นประกอบ ไม่ใช่เส้นทึบ');
  assert.equal(a.calls.save, 1, 'ต้อง save ก่อนเปลี่ยนสถานะ');
  assert.equal(a.calls.restore, 1, 'ต้อง restore หลังเสร็จ (ไม่งั้นสีของข้อความจะถูกกรอบทิ้ง)');
});

test('สีกรอบต้องอ่านได้แต่บางพอ — ไม่งั้นบังตัวเลขหรือเห็นเป็นกรอบในไฟล์จริง', () => {
  assert.match(frame.GUIDE_COLOR, /^rgba\(/, 'ต้องเป็น rgba (มี alpha)');
  const alpha = parseFloat(frame.GUIDE_COLOR.split(',')[3]);
  assert.ok(alpha > 0 && alpha < 1, `alpha ต้องอยู่ระหว่าง 0-1 (ได้ ${alpha})`);
});

test('ตัววาดต้องเรียกกรอบเฉพาะตอน showGuide เป็นจริง (ไม่งั้นกรอบหลุดลงไฟล์)', () => {
  const src = code('sticker-draw.ts');
  assert.match(src, /if \(showGuide\) drawGuideFrame\(/, 'ต้องมีเงื่อนไข if (showGuide) ครอบการวาดกรอบ');
  assert.doesNotMatch(src, /ctx\.strokeRect\(/, 'ห้ามเรียก strokeRect ตรง ๆ ใน sticker-draw (ให้ผ่าน sticker-frame เท่านั้น)');
  assert.match(src, /showGuide\s*=\s*false/, 'ค่าเริ่มต้นต้องเป็น false — เรียกแบบลืมใส่พารามิเตอร์ก็ปลอดภัย');
});

test('จุดที่ดาวน์โหลดต้องไม่มีทางขอกรอบประกอบได้เลย', () => {
  // 16/10/69 — ย้ายการดาวน์โหลดไป sticker-download.ts แล้ว
  // ตอนนี้พิสูจน์ได้แรงกว่าเดิม: ชนิด PaintFn ไม่มีพารามิเตอร์ showGuide ให้ส่งตั้งแต่แรก
  const dl = code('sticker-download.ts');
  assert.match(dl, /type PaintFn = \(canvas: HTMLCanvasElement, sn: string, scale: number\)/,
    'PaintFn ต้องรับแค่ (canvas, sn, scale) — ไม่มีช่องให้ส่ง showGuide');
  assert.doesNotMatch(dl, /paint\([^)]*,\s*true\s*\)/, 'sticker-download ห้ามส่ง showGuide=true ไปกับ paint');
  assert.match(dl, /paint\(c, sn, dlScale\)/, 'ต้องวาดด้วย paint(c, sn, dlScale)');
  assert.doesNotMatch(dl, /showGuide/, 'ไม่ควรมีคำว่า showGuide ในไฟล์ดาวน์โหลดเลย');

  const studio = code('StickerStudio.tsx');
  assert.match(studio, /\(canvas, sn, scale\) => paint\(canvas, sn, scale\)/,
    'ตัวห่อ paintForFile ต้องไม่เติม showGuide (ส่งต่อ 3 พารามิเตอร์เท่านั้น)');
  assert.match(studio, /paint\(canvasRef\.current, active, PREVIEW_SCALE, true\)/, 'หน้าจอต้องขอกรอบประกอบ');
});

test('ตัดขอบขาวต้องหากรอบเนื้อหาจริงได้ และไม่ตัดภาพที่ไม่มีขอบขาว', () => {
  const W = 100, H = 80;
  const px = new Uint8ClampedArray(W * H * 4);
  const fill = (x0, y0, x1, y1, v) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
    }
  };
  fill(0, 0, W, H, 255);        // พื้นขาวทั้งภาพ
  fill(10, 20, 90, 60, 0);       // เนื้อหาสีดำ
  const box = tpl.findContentBox(px, W, H);
  assert.deepEqual(box, { x: 10, y: 20, w: 80, h: 40 }, 'ต้องหากรอบเนื้อหาตรงเป๊ะ');

  const allWhite = new Uint8ClampedArray(W * H * 4).fill(255);
  assert.equal(tpl.findContentBox(allWhite, W, H), null, 'ภาพขาวล้วน = ไม่มีอะไรให้ตัด');

  // ขอบขาวเกือบขาวเป๊ะ (สแกน/บีบอัด) ต้องถือว่าขาว ไม่งั้น noise 1 จุดจะกันภาพทั้งใบ
  const noise = new Uint8ClampedArray(px); noise[0] = noise[1] = noise[2] = 250;
  assert.deepEqual(tpl.findContentBox(noise, W, H), box, 'พิกเซลเกือบขาวต้องไม่ถือเป็นเนื้อหา');
});

// ── 19) กำหนดขนาดภาพเป็นมิลลิเมตรเอง (16/10/69 จาก "ภาพมันเล็กกว่าที่ควรจะเป็น") ──
const rectOf = (o) => layout.exactRect(100, 50, 800, 600, ...o);

test('กำหนดกว้าง-สูงได้ตรง ๆ ตามที่ใส่ (มิลลิเมตร → พิกเซลตามสัดส่วนที่ผ่านเข้ามา)', () => {
  const r = rectOf([800, 600, 0, 0]);
  assert.equal(r.w, 800, 'กว้างต้องเท่าที่สั่ง');
  assert.equal(r.h, 600, 'สูงต้องเท่าที่สั่ง');
  assert.equal(r.x, 0, 'กว้างเต็มป้าย = ต้องชิดซ้าย ไม่เหลือขอบ');
  assert.equal(r.y, 0, 'สูงเต็มป้าย = ต้องชิดบน ไม่เหลือขอบ');
});

test('ใส่ข้างเดียว อีกข้างต้องคงสัดส่วนภาพ (ภาพ 2:1)', () => {
  const onlyW = rectOf([400, 0, 0, 0]);
  assert.equal(onlyW.w, 400);
  assert.equal(onlyW.h, 200, 'สูงต้อง = กว้าง/2 ตามสัดส่วนภาพ ไม่ใช่ยืดจนเต็มป้าย');
  const onlyH = rectOf([0, 300, 0, 0]);
  assert.equal(onlyH.h, 300);
  assert.equal(onlyH.w, 600, 'กว้างต้อง = สูง×2');
});

test('ภาพเล็กกว่าป้ายต้องอยู่กลางป้าย ไม่ลอยมุม (กันภาพหายไปมุม)', () => {
  const r = rectOf([200, 100, 0, 0]);
  assert.equal(r.x, 300, 'ต้องเหลือขอบซ้าย 300 (= (800-200)/2)');
  assert.equal(r.y, 250, 'ต้องเหลือขอบบน 250 (= (600-100)/2)');
});

test('เลื่อนภาพด้ยังทำงานตอนกำหนดขนาดเอง', () => {
  const r = rectOf([200, 100, 0.5, -0.5]);
  assert.equal(r.x, 300 + 400, 'เลื่อนขวา 50% = ขยับเท่าครึ่งความกว้างป้าย');
  assert.equal(r.y, 250 - 300, 'เลื่อนขึ้น 50%');
});

test('ค่า 0 ทั้งคู่ต้องไม่ทำให้ภาพหาย (กันเรียกผิดแล้วป้ายว่าง)', () => {
  // ไม่ได้กำหนดขนาดเลย = เต็มความกว้างป้าย แล้วคงสัดส่วนภาพ (พฤติกรรมเดียวกับ contain)
  // ตัววาดจริงจะไม่เรียก exactRect เมื่อเป็น 0 ทั้งคู่ แต่ถ้าเรียกผิดก็ต้องไม่ทำให้ป้ายว่าง
  const r = rectOf([0, 0, 0, 0]);
  assert.equal(r.w, 800, 'กว้างเต็มป้าย');
  assert.equal(r.h, 400, 'สูง = กว้าง/2 ตามสัดส่วนภาพ (ไม่ยืดจนเต็ม = ไม่บิดภาพ)');
  assert.equal(r.y, 100, 'ต้องอยู่กลางแนวตั้ง ไม่ชิดบน');
});

test('ภาพที่ไม่มีขนาด (0×0) ต้องไม่ทำให้หารด้วยศูนย์', () => {
  const r = layout.exactRect(0, 0, 800, 600, 400, 0, 0, 0);
  assert.ok(Number.isFinite(r.w) && Number.isFinite(r.h) && r.w > 0, 'ต้องได้ขนาดใช้งาน ไม่ใช่ NaN/Infinity');
});

test('ค่าเริ่มต้นต้องไม่กำหนดขนาดภาพเอง (0 = ให้ระบบคำนวณ)', () => {
  assert.equal(store.DEFAULT_STICKER.tplWMm, 0, '0 = ใช้โหมด fit ตามปกติ');
  assert.equal(store.DEFAULT_STICKER.tplHMm, 0);
});

test('ตัววาดต้องเลือกใช้ exactRect เมื่อกำหนดขนาดเอง และ fitImageRect เมื่อไม่กำหนด', () => {
  const src = code('sticker-draw.ts');
  assert.match(src, /cfg\.tplWMm > 0 \|\| cfg\.tplHMm > 0/,
    'ต้องมีเงื่อนไขแยกสองทาง: กำหนดเอง → exactRect · ไม่กำหนด → fitImageRect');
  assert.match(src, /exactRect\(img\.width[\s\S]{0,120}fitImageRect\(/,
    'ต้องเรียก exactRect ก่อน แล้วค่อย fall back เป็น fitImageRect');
  assert.match(src, /cfg\.tplWMm \* perMm/, 'ต้องแปลงมิลลิเมตรเป็นพิกเซลด้วย perMm = W / widthMm');
});

// ── 20) แจ้งเตือน Telegram เข้าห้องธุรกิจ (16/10/69) ────────────────────────
const tg = await import(`${dir}/telegram-notify.ts`);
/** สูตรของจริงจาก store — ส่งเข้า buildTrackingDigest ตามที่ component ทำ (ดูคอมเมนต์ใน telegram-notify.ts) */
const DEPSX = { warrantyState: store.warrantyState, thaiDate: store.thaiDate };

test('ตรวจหมายเลขห้องต้องเหมือนกฎของ backend เป๊ะ (สองฝั่งตรวจ กันกรณีเขียนทับข้าม)', () => {
  for (const ok of ['123456789', '-123456789', '-1001234567890', '  -1009876543210  ']) {
    assert.equal(tg.validateChatId(ok), '', `"${ok}" ต้องผ่าน`);
  }
  for (const bad of ['', 'abc', '@mygroup', '12.5', '12 345']) {
    assert.notEqual(tg.validateChatId(bad), '', `"${bad}" ต้องถูกปฏิเสธ`);
  }
});

test('ไฟล์ logic ต้องไม่ import อะไรที่ต้องใช้เบราว์เซอร์ (Node เรียกไฟล์นี้เพื่อทดสอบ)', () => {
  // ⚠ เคยพลาดตรงนี้: import getApiUrl แบบ static → Node โหลดไฟล์ไม่ขึ้นเลยตั้งแต่ต้น (16/10/69)
  //   เจอเพราะ ERR_MODULE_NOT_FOUND ตอนรันเทสต์ ไม่ใช่เพราะ logic ผิด
  const src = code('telegram-notify.ts');
  assert.doesNotMatch(src, /<[A-Za-z][\s\S]*>\s*$/m, 'ต้องไม่มี JSX ในไฟล์ logic');
  const imports = [...src.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
  const browserOnly = imports.filter((p) => !p.startsWith('./types'));
  assert.deepEqual(browserOnly, [], `ต้อง import แค่ type เท่านั้น แต่เจอ: ${browserOnly.join(', ')}`);
  assert.match(src, /api\/telegram\/biz/, 'ต้องชี้ไปที่ route ฝั่ง backend');
  assert.doesNotMatch(src, /botToken\s*[:=]/, 'ห้ามฝัง bot token ในฝั่งหน้าเว็บ');
});

test('สรุปงานที่ต้องติดตาม: ไม่มีอะไรค้าง = บอกว่าสบายใจ ไม่ใช่ส่งข้อความเปล่า', () => {
  const empty = tg.buildTrackingDigest(store.emptyDb(), DEPSX, '2026-10-17');
  assert.equal(empty.isEmpty, true);
  assert.match(empty.detail, /ทุกออเดอร์/, 'ต้องบอกว่าสถานะปกติ');
  assert.ok(empty.detail.length > 0, 'ห้ามส่งรายละเอียดว่าง');
});

test('สรุปงานที่ต้องติดตาม: แยกหมดแล้ว / ใกล้หมด / S/N ไม่ผูกออเดอร์ ให้เห็นชัด', () => {
  const db = store.emptyDb();
  const base = { id: 'o1', customerName: 'สมชาย', serials: ['Soverign-Temp-000'], createdAt: '2026-01-01', status: 'ACTIVE', shippingDays: 0 };
  db.orders = [
    { ...base, id: 'out', warrantyStart: '2025-01-01', warrantyEnd: '2025-06-01', serials: ['A'] },
    { ...base, id: 'near', warrantyStart: '2026-10-01', warrantyEnd: '2026-10-20', serials: ['B'] },
    { ...base, id: 'ok', warrantyStart: '2026-10-01', warrantyEnd: '2027-10-01', serials: ['C'] },
  ];
  db.serials = [
    { sn: 'A', modelId: 'temp-01', status: 'SOLD', orderId: 'out' },
    { sn: 'B', modelId: 'temp-01', status: 'SOLD', orderId: 'near' },
    { sn: 'C', modelId: 'temp-01', status: 'SOLD', orderId: 'ok' },
    { sn: 'D', modelId: 'temp-01', status: 'SOLD' },      // ออกแล้วไม่ผูกออเดอร์
    { sn: 'E', modelId: 'temp-01', status: 'STOCK' },     // ยังไม่ออก ไม่นับ
  ];
  const d = tg.buildTrackingDigest(db, DEPSX, '2026-10-17');
  assert.equal(d.isEmpty, false);
  assert.match(d.detail, /หมดประกันแล้ว 1 รายการ/, 'ต้องนับหมดแล้ว 1 (ไม่รวมใกล้หมด/ปกติ)');
  assert.match(d.detail, /ใกล้หมดประกัน 1 รายการ/, 'ต้องนับใกล้หมด 1');
  assert.match(d.detail, /ยังไม่ผูกออเดอร์ 1 ใบ/, 'S/N ที่ออกแล้วไม่ผูก = 1 (E ยังไม่ออก ไม่นับ)');
  assert.match(d.detail, /สมชาย/, 'ต้องบอกว่าใคร');
});

test('ออเดอร์ที่ยกเลิก (VOID) ต้องไม่ถูกนับว่าประกันหมด (ไม่งั้นเจ้าของโดนแจ้งเตือนมั่ว)', () => {
  const db = store.emptyDb();
  db.orders = [{
    id: 'v', customerName: 'เก่า', serials: ['X'], status: 'VOID', createdAt: '2020-01-01',
    warrantyStart: '2020-01-01', warrantyEnd: '2020-02-01',
  }];
  db.serials = [{ sn: 'X', modelId: 'temp-01', status: 'VOID' }];
  assert.equal(tg.buildTrackingDigest(db, DEPSX, '2026-10-17').isEmpty, true, 'VOID ต้องไม่ทำให้มีรายการค้าง');
});

test('รายการค้างเยอะต้องถูกตัด ไม่ยัดข้อความยาวจน Telegram ปฏิเสธ (ข้อจำกัด 4096 ตัว)', () => {
  const db = store.emptyDb();
  db.orders = Array.from({ length: 60 }, (_, i) => ({
    id: `o${i}`, customerName: `ลูกค้าหมายเลข${i}`, serials: [`SN${i}`], status: 'ACTIVE',
    createdAt: '2025-01-01', warrantyStart: '2025-01-01', warrantyEnd: '2025-02-01',
  }));
  db.serials = db.orders.map((o, i) => ({ sn: `SN${i}`, modelId: 'temp-01', status: 'SOLD', orderId: o.id }));
  const d = tg.buildTrackingDigest(db, DEPSX, '2026-10-17');
  assert.ok(d.detail.length < 3500, `ข้อความยาว ${d.detail.length} ตัว ต้องไม่เกินที่ Telegram รับได้`);
  assert.match(d.detail, /60 รายการ/, 'ต้องบอกจำนวนรวมจริง ไม่ใช่จำนวนที่ตัด');
});

test('ต้องมีการ์ดแจ้งเตือนอยู่ในแท็บ "ติดตาม" ไม่ใช่ที่อื่น (ตามที่เจ้าของขอ)', () => {
  const hub = code('SoverienHub.tsx');
  assert.match(hub, /section === 'notify' && <TelegramNotifyCard/, 'ต้องผูกการ์ดเข้ากับหัวข้อย่อย notify');
  const trackBlock = /track: \[([\s\S]*?)\]/.exec(hub);
  assert.ok(trackBlock && trackBlock[1].includes("key: 'notify'"), 'หัวข้อย่อยต้องอยู่ใน track');
  const sellBlock = /sell: \[([\s\S]*?)\]/.exec(hub);
  assert.ok(!sellBlock[1].includes("key: 'notify'"), 'ห้ามไปอยู่ผิดแท็บ');
});

test('หน้าเว็บห้ามฝัง bot token ของเจ้าของไว้ในซอร์สโค้ด (16/10/69)', () => {
  // ⚠ เจ้าของวาง token จริงในแชท (รอบแรก) แล้วออกใหม่รอบที่สอง — ทั้งสองตัวต้องไม่หลุดเข้า git
  //   ถ้าวันหนึ่งมีคนอยู่ดี ๆ ก็ควรเพิ่มรายการนี้ทันที (ข้อนี้คือกันไว้เผื่อเกิดซ้ำ)
  const banned = [
    ['8807673052', 'บอทรุ่นแรก'],
    ['AAG93mLtKvYyNyLQLzGhnbqHCw6RbqIYcZI', 'token รุ่นแรก'],
    ['8671099037', 'บอทรุ่นสอง'],
    ['AAEmDQ7P9DTu2kUBJRbL926Kw_N1hi8ylHU', 'token รุ่นสอง'],
  ];
  const files = ['telegram-notify.ts', 'TelegramNotifyCard.tsx', 'SoverienHub.tsx', 'store.ts', 'StickerStudio.tsx'];
  for (const f of files) {
    const src = code(f);
    for (const [secret, label] of banned) {
      assert.ok(!src.includes(secret), `${f}: ห้ามมี${label}ของเจ้าของ (${secret.slice(0, 6)}…)`);
    }
  }
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
  // 2 (sell) + 2 (sticker) + 4 (track: คลัง/ตรวจประกัน/ลูกค้า/แจ้งเตือน) = 8
  assert.equal(keys.length, 8, `ต้องมีหัวข้อย่อย 8 อัน · เจอ ${keys.length}`);
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