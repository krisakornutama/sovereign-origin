// tools/test/soverien-audit.test.mjs
//
// ── ผลจากการ "สแกน" ส่วนธุรกิจ / Soverien ทั้งหมด (17/10/69) ──
// เจ้าของสั่งให้ดูว่าเหลืออะไรบ้าง มีส่วนไหนไม่สมบูรณ์ แล้วแก้ให้
// ทุกข้อที่นี่ "เคยพังจริง" ไม่ใช่การเดา — ถ้าข้อไหนแดงกลับมา = ของที่แก้ถูกปล่อยหลุด
//
// ⚠ ทำไมต้องแยกไฟล์ออกจาก soverien-tools.test.mjs
//   arch-gate (file-budget) กำหนดเพดาน 800 บรรทัดสำหรับ "ไฟล์ที่เปลี่ยนใน branch"
//   ไฟล์เดิมอยู่ที่ 972 บรรทัด = เกินเพดานอยู่แล้ว ตั้งแต่ก่อนงานนี้
//   ถ้าแก้ไฟล์เดิมแม้แต่บรรทัดเดียว gate จะตีทันที
//   → ผลคือห้ามแตะไฟล์เดิมเลย แล้วย้ายเทสต์ใหม่ทั้งหมดมาที่นี่ (ซึ่งอ่านโค้ดไฟล์เดิมได้เหมือนกัน)
//
// ⚠ bootstrap ต้องทำซ้ำจาก soverien-tools.test.mjs ทุกบรรทัด — Node ต้องรู้จัก .ts
//   (เหตุผลละเอียดอยู่ในไฟล์นั้นบรรทัด 23-24: fileURLToPath ไม่ใช่ new URL().pathname)
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = pathToFileURL(path.join(ROOT, 'sovereign-frontend/src/components/business/soverien')).href;
const store = await import(`${dir}/store.ts`);
const roi = await import(`${dir}/roi.ts`);
const guard = await import(`${dir}/serial-guard.ts`);
const rowTotal = await import(`${dir}/csv-row-total.ts`);

const { emptyDb, issueSerials } = store;

const fsReadFile = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

beforeEach(() => mem.clear());

const SOV_DIR = 'sovereign-frontend/src/components/business/soverien';
// ตัดคอมเมนต์ออกก่อนตรวจ ไม่งั้นจะไปจับ "โค้ดเก่า" ที่เขียนอธิบายไว้ในคอมเมนต์
const code = (rel) => fsReadFile(`${SOV_DIR}/${rel}`)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ══════════════════════════════════════════════════════════════════════════
// ── 1) ป้ายดาวน์โหลดทีละใบ / ZIP ต้องใช้วันประกันของ "ตัวเอง" ─────────────
// ══════════════════════════════════════════════════════════════════════════
test('วันประกันบนป้ายต้องมาจาก serial แต่ละใบ ไม่ใช่ใบที่เปิดดูอยู่', () => {
  const db = emptyDb();
  const mk = (id, sn, end) => {
    db.serials.push({ sn, modelId: 'temp-01', status: 'SOLD', orderId: id });
    db.orders.push({
      id, no: id, issueDate: '2026-01-01', customerName: 'x', phone: '1', serials: [sn],
      unitPrice: 990, total: 990, warrantyStart: '2026-01-15', warrantyEnd: end, status: 'ACTIVE', createdAt: '',
    });
  };
  mk('a', 'Soverign-Temp-000', '2027-01-15');
  mk('b', 'Soverign-Temp-001', '2027-02-15');
  db.serials.push({ sn: 'Soverign-Temp-002', modelId: 'temp-01', status: 'STOCK' });

  assert.equal(store.warrantyTextFor(db, 'Soverign-Temp-000'), 'ประกันถึง 15/1/2570');
  assert.equal(store.warrantyTextFor(db, 'Soverign-Temp-001'), 'ประกันถึง 15/2/2570',
    'ต้องได้วันของตัวเอง — บั๊กเดิมทำป้าย 19 ใบหลังใน ZIP ได้วันของใบแรกทุกใบ');
  assert.equal(store.warrantyTextFor(db, 'Soverign-Temp-002'), 'ยังไม่ออกใบ', 'ยังไม่ผูกออเดอร์ = ยังไม่ออกใบ');
});

test('ตัววาดป้ายต้องถามวันประกันจาก sn ที่กำลังวาด ไม่ใช่ค่าที่คำนวณไว้ก่อนหนึ่งครั้ง', () => {
  const src = code('StickerStudio.tsx');
  assert.match(src, /warrantyTextOf\(sn\)/, 'paint ต้องเรียกหาวันประกันของ sn แต่ละไฟล์');
  assert.match(src, /paintSticker\([^)]*warrantyTextOf\(sn\)/, 'ต้องส่งค่าที่เพิ่งคำนวณจาก sn ไปให้ตัววาดโดยตรง');
  assert.doesNotMatch(src, /const warrantyText =/,
    'ห้ามมีตัวแปร warrantyText ที่คำนวณจากใบที่เปิดดู — นั่นคือบั๊กเดิม');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 2) เครื่องคำนวณ ROI ต้องตอบเป็น "วัน" ไม่ใช่เดือนที่กำกับว่า "วัน" ────
// ══════════════════════════════════════════════════════════════════════════
test('ROI: 990 บาท เมื่อลูกค้าเสียของ 12,000/ปี ต้องคุ้มทุน ~30 วัน ไม่ใช่ 1 วัน', () => {
  const d = roi.breakEvenDays(990, 12000);
  assert.ok(d >= 29 && d <= 32, `ต้องได้ ~30 วัน (ได้ ${d} วัน)`);
  // ตรวจสอบตัวเองด้วยกติกาที่คนทั่วไปคิดตามได้
  assert.ok(Math.abs(roi.breakEvenDays(990, 990) - 365) <= 2, 'เสียของปีละเท่ากับราคา = คุ้มทุนที่ 1 ปีพอดี');
  const oneMonth = roi.breakEvenDays(990, 990 * 12);
  assert.ok(oneMonth >= 30 && oneMonth <= 32, `เสียปีละ 12 เท่าของราคา = คุ้มทุน ~1 เดือน (ได้ ${oneMonth})`);
});

test('ROI: ยังไม่มีข้อมูลพอ = คืน null ไม่ใช่ 0/Infinity', () => {
  assert.equal(roi.breakEvenDays(0, 12000), null, 'ยังไม่ตั้งราคา');
  assert.equal(roi.breakEvenDays(990, 0), null, 'ยังไม่กรอกมูลค่าของเสีย');
  assert.equal(roi.breakEvenDays(-5, 12000), null, 'ค่าติดลบ = ยังไม่ได้กรอกจริง');
  assert.ok(Number.isFinite(roi.breakEvenDays(990, 1e-9)), 'loss จิ๋วมากต้องได้ตัวเลข ไม่ใช่ Infinity/NaN');
});

test('หน้าคู่มือขายต้องใช้ roi.breakEvenDays ไม่ใช่สูตรเดิมที่ผิดหน่วย', () => {
  const src = code('SalesGuide.tsx');
  assert.match(src, /breakEvenDays\(/, 'ต้องเรียกฟังก์ชันที่มีเทสต์คุม ไม่ใช่คำนวณในไฟล์ UI เอง');
  assert.doesNotMatch(src, /price \/ \(loss \/ 12\)/, 'ห้ามมีสูตรเดิมที่ได้ "เดือน" แล้วไปแสดงเป็น "วัน"');
  assert.doesNotMatch(src, /perYear/, 'ตัวแปรเดิมชื่อ perYear แต่จริง ๆ ถือค่าเดือน ต้องหายไปจากไฟล์');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 3) กราฟ 12 เดือน ต้องไม่พังตอนวันนี้เป็น 29/30/31 ───────────────────
// ══════════════════════════════════════════════════════════════════════════
test('คีย์เดือน 12 ช่องต้องเรียงต่อกันจริง ไม่ซ้ำ แม้วันนี้เป็นสิ้นเดือน', () => {
  for (const today of ['2026-10-31', '2026-03-31', '2024-02-29', '2023-05-30', '2026-01-31', '2025-08-30']) {
    const keys = store.lastTwelveMonthKeys(today);
    assert.equal(keys.length, 12, `${today}: ต้องได้ 12 ช่อง (ได้ ${keys.length})`);
    assert.equal(new Set(keys).size, 12, `${today}: ห้ามมีคีย์ซ้ำ — เจอ ${keys.join(', ')}`);
    const [y, m] = today.split('-').map(Number);
    assert.equal(keys[11], `${y}-${String(m).padStart(2, '0')}`, `${today}: ช่องสุดท้ายต้องเป็นเดือนของวันนี้`);
  }
});

test('พิสูจน์ว่าเทสต์ข้อบนจับของได้จริง — สูตรเดิม (setMonth ย้อนหลัง) พังตอนวันที่ 31', () => {
  // ใส่สูตรเก่าไว้ในเทสต์เพื่อไม่ให้ข้อบน "ผ่านอยู่แล้วโดยไม่รู้ตัว"
  const legacy = (today) => {
    const [y, m, d] = today.split('-').map(Number);
    const out = [];
    for (let i = 0; i < 12; i++) {
      const dt = new Date(y, m - 1 - i, d);   // 31 ก.ย. ไม่มี → JavaScript โดดไป 1 ต.ค.
      out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  };
  const broken = legacy('2026-10-31');
  assert.ok(new Set(broken).size < 12,
    `สูตรเดิมต้องมีคีย์ซ้ำตอนวันที่ 31 (เหลือแค่ ${new Set(broken).size} ช่อง) — แสดงว่าเทสต์ข้อนี้มีประโยชน์จริง`);
});

// ══════════════════════════════════════════════════════════════════════════
// ── 4) กู้ไฟล์สำรองห้ามทำให้ตัวนับ serial ถอยหลัง ────────────────────────
// ══════════════════════════════════════════════════════════════════════════
const mkModel = (id, prefix, lastNo) => ({ id, name: id, prefix, price: 990, active: true, lastNo });
const mkSerial = (sn, modelId, status = 'STOCK') => ({ sn, modelId, status, issuedAt: '2026-01-01', createdAt: '' });

test('กู้ไฟล์เก่าที่ตัวนับต่ำกว่าของจริง → ต้องยกขึ้นเท่าของจริง ไม่ใช่ถอยหลัง', () => {
  const backup = emptyDb();
  backup.models = [mkModel('temp-01', 'Soverign-Temp', 5)];
  const current = emptyDb();
  current.models = [mkModel('temp-01', 'Soverign-Temp', 21)];
  const raised = guard.guardSerialCounter(backup, current);
  assert.equal(backup.models[0].lastNo, 21, 'ตัวนับต้องไม่ถอยหลัง');
  assert.equal(raised.length, 1, 'ต้องรายงานว่าปรับตัวนับ เพื่อให้เจ้าของรู้');
});

test('lastNo ในไฟล์เพี้ยน (ต่ำกว่า serial จริงที่อยู่ในไฟล์เดียวกัน) ก็ต้องถูกยกขึ้น', () => {
  const backup = emptyDb();
  backup.models = [mkModel('temp-01', 'Soverign-Temp', 2)];
  backup.serials = [mkSerial('Soverign-Temp-007'), mkSerial('Soverign-Temp-003')];
  guard.guardSerialCounter(backup, null);
  assert.equal(backup.models[0].lastNo, 7, 'ต้องอ่านจาก serial จริงสูงสุด');
});

test('ไฟล์สำรองที่ตัวนับสูงกว่าของจริง ต้องคงไว้ ไม่ถอยให้', () => {
  const backup = emptyDb();
  backup.models = [mkModel('temp-01', 'Soverign-Temp', 40)];
  const current = emptyDb();
  current.models = [mkModel('temp-01', 'Soverign-Temp', 21)];
  guard.guardSerialCounter(backup, current);
  assert.equal(backup.models[0].lastNo, 40, 'ห้ามลดตัวนับแม้ของจริงต่ำกว่า');
});

test('รุ่นที่มีในเครื่องแต่ไม่มีในไฟล์สำรอง ต้องเก็บไว้ (ไม่งั้นเปิด prefix เดิมด้วยตัวนับศูนย์)', () => {
  const backup = emptyDb();
  backup.models = [mkModel('a', 'Soverign-Temp', 3)];
  const current = emptyDb();
  current.models = [mkModel('a', 'Soverign-Temp', 30), mkModel('b', 'Soverign-Pro', 12)];
  guard.guardSerialCounter(backup, current);
  const pro = backup.models.find((m) => m.prefix === 'Soverign-Pro');
  assert.ok(pro, 'ต้องยังมีรุ่น Soverign-Pro อยู่หลังกู้ข้อมูล');
  assert.equal(pro.lastNo, 12, 'ตัวนับต้องคงไว้เท่าของจริง');
});

test('กู้ข้อมูลแล้วออกออเดอร์ต่อ ห้ามได้เลขซ้ำกับที่เคยพิมพ์ป้ายไปแล้ว', () => {
  const backup = emptyDb();
  backup.models = [mkModel('temp-01', 'Soverign-Temp', 0)];
  const current = emptyDb();
  current.models = [mkModel('temp-01', 'Soverign-Temp', 21)];
  current.serials = [mkSerial('Soverign-Temp-021')];
  guard.guardSerialCounter(backup, current);
  const made = issueSerials(backup, 'temp-01', 1);
  assert.equal(made[0].sn, 'Soverign-Temp-022', 'ต้องออกเลขนัดจากของจริง ไม่ใช่กลับไป 001');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 5) กู้ไฟล์สำรองต้องผ่านจุด normalize เดียวกับการโหลดข้อมูล ───────────
// ══════════════════════════════════════════════════════════════════════════
test('normalizeDb เติมส่วนที่ไฟล์เก่าไม่มี — ไม่งั้นเปิดหน้าสติกเกอร์แล้วพัง', () => {
  const out = store.normalizeDb({ version: 1, serials: [], orders: [] });
  assert.ok(out, 'ไฟล์รูปแบบถูกต้องต้องผ่าน');
  assert.equal(out.settings.sticker.widthMm, store.DEFAULT_STICKER.widthMm, 'ต้องมีค่าป้ายครบทุกช่อง');
  assert.ok(Array.isArray(out.models) && out.models.length > 0, 'ต้องมีรุ่นสินค้า');
  assert.deepEqual(out.stickerPresets, [], 'แม่แบบป้ายต้องเป็น [] ไม่ใช่ undefined');
  assert.equal(out.orderSeq, 0);
  assert.equal(store.normalizeDb({ ...out, orderSeq: '7' }).orderSeq, 7, 'ตัวเลขจากไฟล์เก่าต้องกลายเป็น number');
});

test('normalizeDb ปฏิเสธไฟล์ที่ไม่ใช่ข้อมูลของเครื่องมือนี้', () => {
  assert.equal(store.normalizeDb(null), null);
  assert.equal(store.normalizeDb(undefined), null);
  assert.equal(store.normalizeDb({ version: 99, serials: [], orders: [] }), null);
  assert.equal(store.normalizeDb({ version: 1, serials: {}, orders: [] }), null);
});

test('การกู้ไฟล์ต้องใช้ normalizeDb + guardSerialCounter เหมือนที่ load() ใช้', () => {
  const src = code('BackupSecurity.tsx');
  assert.match(src, /normalizeDb\(/, 'เดิมใช้ object ดิบจากไฟล์ → เปิดหน้าสติกเกอร์แล้ว crash');
  assert.match(src, /guardSerialCounter\(parsed, db\)/, 'ต้องยามตัวนับไม่ให้ถอยหลังตอนกู้');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 6) ข้อมูลห้าม "ดูเหมือนบันทึกแล้ว" ทั้งที่ไม่ได้เก็บ ───────────────────
// ══════════════════════════════════════════════════════════════════════════
test('บันทึกไม่สำเร็จ (โควตาเต็ม) ต้องคืน false ให้ UI เตือน ไม่ใช่เงียบหาย', () => {
  const goodSet = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    assert.equal(store.save(emptyDb()), false, 'ต้องบอกว่าบันทึกไม่สำเร็จ');
  } finally {
    window.localStorage.setItem = goodSet;
  }
  assert.equal(store.save(emptyDb()), true, 'ปกติ = สำเร็จ');
});

test('hub ต้องเตือนทันทีเมื่อบันทึกไม่สำเร็จ ไม่ปล่อยให้เจ้าของคิดว่าข้อมูลถูกเก็บ', () => {
  const hub = code('SoverienHub.tsx');
  assert.match(hub, /const saved = save\(d\);/, 'ต้องรับค่าตอบกลับของ save');
  assert.match(hub, /setSaveErr\(saved \? null : /, 'ต้องแปลงผลเป็นข้อความเตือน');
  assert.match(hub, /role="alert"/, 'ข้อความเตือนต้องเด่นพอ (role=alert) และขึ้นทุกแท็บ');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 7) CSV: รวมคอลัมน์ยอดรวมต้องได้เงินจริง ไม่ใช่คูณจำนวนชิ้น ───────────
//    ตรรกะจริงอยู่ที่ csv-row-total.ts เพราะ csv.ts import store (value import)
//    → Node เรียก csv.ts ตรง ๆ ไม่ได้ (ERR_MODULE_NOT_FOUND ที่ './store' ไม่มีนามสกุล)
// ══════════════════════════════════════════════════════════════════════════
const orderWith = (serials, unitPrice, total) => ({
  id: 'o1', no: 'SO-0001', issueDate: '2026-01-01', customerName: 'สมชาย', phone: '0811111111',
  serials, unitPrice, total, warrantyStart: '2026-01-15', warrantyEnd: '2027-01-15',
  status: 'ACTIVE', createdAt: '',
});

test('CSV ออเดอร์ 3 ชิ้น — รวมยอดรวมทุกแถวต้องได้ยอดออเดอร์จริง (เดิมได้ 3 เท่า)', () => {
  const rows = rowTotal.orderRowTotals(orderWith(['A', 'B', 'C'], 990, 2970));
  assert.equal(rows.length, 3, 'ต้องมีค่า 1 ช่องต่อ 1 แถว (1 แถวต่อ 1 S/N)');
  assert.equal(rows.reduce((a, b) => a + b, 0), 2970,
    `รวมแล้วต้องได้ 2,970 (ได้ ${rows.reduce((a, b) => a + b, 0)}) — เดิมได้ 8,910 เพราะใส่ 2,970 ทุกแถว`);
});

test('ออเดอร์มีส่วนลด — รวมยอดรวมแล้วต้องเท่ากับยอดที่คิดเงินจริง', () => {
  const rows = rowTotal.orderRowTotals(orderWith(['A', 'B', 'C'], 990, 2780));
  assert.equal(rows.reduce((a, b) => a + b, 0), 2780, 'แถวแรกต้องรับส่วนต่างของส่วนลดไว้');
  assert.equal(rows[1], 990, 'แถวที่เหลือเป็นราคาต่อหน่วย 1 ชิ้น');
  assert.equal(rows[2], 990);
});

test('ออเดอร์ไม่ได้ตั้ง total (ต้องคำนวณเอง) — รวมยอดรวมแล้วเท่ากับจำนวน × ราคา', () => {
  const rows = rowTotal.orderRowTotals({ ...orderWith(['A', 'B', 'C', 'D'], 1490, 0) });
  assert.equal(rows.reduce((a, b) => a + b, 0), 1490 * 4, 'ค่าเริ่มต้น total=0 ต้องเท่ากับจำนวน × ราคาต่อหน่วย');
  assert.ok(rows.every((r) => r > 0), 'ห้ามมีแถวติดลบในเคสปกติ');
});

test('ออเดอร์ยังไม่มี S/N เลย → คืน array ว่าง (ไม่พัง ไม่คิดเงินมั่ว)', () => {
  assert.deepEqual(rowTotal.orderRowTotals(orderWith([], 990, 0)), []);
});

test('csv.ts ต้องใช้ orderRowTotals ไม่ใช่ใส่ยอดออเดอร์เดิมทุกแถว', () => {
  const src = code('csv.ts');
  assert.match(src, /orderRowTotals\(o\)/, 'ต้องเรียกตรรกะที่มีเทสต์คุม');
  assert.doesNotMatch(src, /String\(orderTotal\(o\)\)/, 'ห้ามใส่ยอดออเดอร์ทั้งก้อนทุกแถว (บั๊กเดิม)');
  assert.match(src, /String\(totals\[i\]\)/, 'แถว i ต้องใช้ค่าแถว i');
  assert.match(src, /'1', String\(o\.unitPrice\)/, 'จำนวนต่อแถว = 1 และราคาต่อหน่วยต้องเป็นของจริง');
});

test('ไฟล์ logic ที่เทสต์เรียกตรงต้องใช้ import type ไม่งั้น Node resolve ไม่ได้ (เจอจริง 17/10/69)', () => {
  for (const f of ['csv-row-total.ts', 'serial-guard.ts', 'roi.ts']) {
    const imports = [...code(f).matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    assert.deepEqual(imports.filter((p) => !p.startsWith('./types')), [],
      `${f}: ห้ามมี value import เพราะ Node เรียกตรง ๆ ไม่ได้`);
  }
  assert.equal(typeof rowTotal.orderRowTotals, 'function');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 8) การกระทำที่ย้อนกลับไม่ได้ ต้องถามก่อน ─────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
test('ปุ่มยกเลิก serial ต้องถามยืนยัน (ปุ่มอยู่ชิดตาราง กดผิด = เลขหายถาวร)', () => {
  const fn = /function voidSerial\([\s\S]*?\n  \}/.exec(code('SerialIssuer.tsx'));
  assert.ok(fn, 'ต้องมีฟังก์ชัน voidSerial');
  assert.match(fn[0], /window\.confirm/, 'ก่อนทำลาย serial ต้องถามยืนยัน');
});

test('ปุ่ม "คืนค่าตำแหน่งเริ่มต้น" ห้ามแตะ showQr/showWarranty (ป้ายจริงมี QR พิมพ์อยู่แล้ว)', () => {
  const raw = fsReadFile(`${SOV_DIR}/StickerControls.tsx`);
  // ⚠ ต้องหาจาก "ข้อความบนปุ่ม" ไม่ใช่คำว่า คืนค่าตำแหน่ง เฉย ๆ
  //   เพราะ comment ใต้ปุ่มมีคำนี้ซ้ำอยู่ → ถ้าหาจากคำนั้นจะไปเริ่มจาก onClick ก่อนหน้า
  //   แล้วครอบปุ่ม QR/วันประกัน ทำให้เทสต์ผิดแบบไม่รู้ตัว
  const at = raw.indexOf('คืนค่าตำแหน่งเริ่มต้น (ไม่แตะ QR');
  assert.ok(at > 0, 'ต้องมีปุ่มคืนค่าตำแหน่งเริ่มต้น (และป้ายปุ่มต้องบอกว่าไม่แตะ QR)');
  const block = raw.slice(raw.lastIndexOf('onClick={() => patch({', at), at);
  assert.match(block, /serialX: 0\.06/, 'ต้องจับถึง patch ชุดคืนค่าตำแหน่งจริง ๆ (ไม่ใช่ patch ก่อนหน้า)');
  assert.doesNotMatch(block, /showQr/, 'ห้ามแตะ showQr ทั้งเปิดและปิด — ให้คงสิ่งที่ผู้ใช้เลือกไว้');
  assert.doesNotMatch(block, /showWarranty/, 'ห้ามแตะ showWarranty — บรรทัดวันประกันจะไปชน QR ที่พิมพ์ไว้');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 9) คลังออเดอร์ต้องแก้ไขได้จริง (ข้อความในหน้าตั้งค่าชี้มาที่นี่) ───────
// ══════════════════════════════════════════════════════════════════════════
test('คลังออเดอร์มีการแก้ไขจริง ไม่ใช่แค่ข้อความบอกให้ไปแก้', () => {
  const src = code('OrderVault.tsx');
  assert.match(src, /function saveEdit\(\)/, 'ต้องมีฟังก์ชันบันทึกการแก้ไข');
  assert.match(src, /warrantyDates\(issueDate, db\.settings\)/, 'แก้วันที่ออกใบต้องคำนวณประกันใหม่ทั้งคู่');
  assert.match(src, /total: unitPrice \* open\.serials\.length/, 'แก้ราคาต่อหน่วยต้องคำนวณยอดรวมใหม่');
  assert.match(src, /บันทึกการแก้ไข/, 'ต้องมีปุ่มบันทึก');
  assert.match(src, /ยกเลิกการแก้ไข/, 'ต้องมีปุ่มยกเลิกการแก้ไข');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 10) ออเดอร์ต้องผูก serial ที่อยู่ในคลัง (ป้ายที่พิมพ์ไปต้องถูกขาย) ────
// ══════════════════════════════════════════════════════════════════════════
test('ออกออเดอร์ต้องผูกของที่อยู่ในคลังก่อน ไม่ใช่สร้างเลขอื่นทับป้ายที่พิมพ์ไปแล้ว', () => {
  const src = code('OrderCreate.tsx');
  assert.match(src, /status === 'STOCK'\)\.slice\(0, count\)/, 'ต้องเลือกจากของที่อยู่ในคลัง');
  assert.match(src, /taken\.length < count \? issueSerials\(db, model\.id, count - taken\.length\) : \[\]/,
    'ออกใหม่เฉพาะส่วนที่คลังไม่พอ');
  assert.doesNotMatch(src, /const made = issueSerials\(db, model\.id, count\)/,
    'ห้ามสร้าง serial ใหม่ทั้งหมดโดยไม่ดูคลัง — ป้ายที่พิมพ์ไว้จะไม่เคยถูกขาย');
  assert.doesNotMatch(src, /stockLeft >= count/,
    'เดิมบังคับให้มีคลังก่อน ทั้งที่โค้ดสร้างใหม่อยู่ดี = เงื่อนไขไม่ได้ป้องกันอะไร');
});

// ══════════════════════════════════════════════════════════════════════════
// ── 11) หน้าตรวจประกัน ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
test('หน้าตรวจประกันต้องนับวันตามเวลาเครื่อง ไม่ใช่ UTC', () => {
  const src = code('WarrantyCheck.tsx');
  assert.match(src, /daysBetween\(todayIso\(\), order\.warrantyEnd\)/, 'ต้องใช้ todayIso() ของ store');
  assert.doesNotMatch(src, /toISOString\(\)\.slice\(0, 10\)/,
    'UTC ทำให้ช่วง 00:00–07:00 ของไทย ลูกค้าเห็นเหลือประกันเกิน 1 วัน');
});

test('หน้าตรวจประกัน: ปุ่มและ Enter ต้องทำงาน (เดิมกดแล้วไม่มีอะไรเกิดขึ้น)', () => {
  const src = code('WarrantyCheck.tsx');
  assert.match(src, /<form/, 'ต้องเป็น form เพื่อให้ Enter ทำงานเท่ากับกดปุ่ม');
  assert.match(src, /type="submit"/, 'ปุ่มต้องเป็น submit ไม่ใช่ปุ่มเปล่า');
  assert.doesNotMatch(src, /onKeyDown/, 'ห้ามมี onKeyDown ที่ดัก Enter แล้วทิ้ง');
});

test('ออเดอร์ยกเลิกห้ามขึ้น "หมดประกันเมื่อ … วันที่แล้ว" (ขัดกับป้าย ⚫ ด้านบน)', () => {
  const src = code('WarrantyCheck.tsx');
  assert.match(src, /order\.status === 'ACTIVE' \?/, 'ต้องแยกทางระหว่างออเดอร์ใช้งานกับที่ยกเลิกแล้ว');
  assert.match(src, /ออเดอร์นี้ถูกยกเลิกแล้ว — ประกันหยุดนับ/, 'ต้องบอกตรง ๆ ว่าประกันหยุดนับ');
});
