import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDimeProcessor, sha1Section, type DimeDeps } from '../src/services/dime.service';

const STATEMENT_TEXT = `Dime! Statement
รายงานยอดคงเหลือประจำเดือนสิงหาคม 2569
US Stocks (หุ้นสหรัฐฯ)
AAPL APPLE INC. 120 45.30 44.50 5,340.00
MSFT MICROSOFT CORP 60 150.00 160.25 9,615.00
Thai Stocks
SCB บมจ.ไทยพาณิชย์ 100 120.00 130.00 13,000.00`;

function makeDeps(overrides: Partial<DimeDeps> = {}): DimeDeps & {
  calls: { statements: any[]; positions: any[]; updated: any[]; prices: any[]; findPositionCalls: any[] };
} {
  const calls = {
    statements: [] as any[],
    positions: [] as any[],
    updated: [] as any[],
    prices: [] as any[],
    findPositionCalls: [] as any[],
  };
  const deps: DimeDeps = {
    parsePdf: async () => ({ text: STATEMENT_TEXT }),
    findUser: async (q) => (q.username === 'kriss' ? { id: 'owner-1' } : { id: 'admin-1' }),
    findStatement: async () => null,
    createStatement: async (data) => {
      calls.statements.push(data);
      return { id: 'stmt-1' };
    },
    findPosition: async (w) => {
      calls.findPositionCalls.push(w);
      return w.symbol === 'AAPL' ? { id: 'pos-aapl' } : null;
    },
    updatePosition: async (where, data) => {
      calls.updated.push({ where, data });
    },
    createPosition: async (data) => {
      calls.positions.push(data);
    },
    insertPrice: async (p) => {
      calls.prices.push(p);
    },
    log: () => {},
    ...overrides,
  };
  return { ...deps, calls };
}

test('pipeline: เต็มวงจร — parse → upsert ตำแหน่ง + ราคา → บันทึก statement', async () => {
  const { calls, ...deps } = makeDeps();
  const proc = createDimeProcessor(deps, { DIME_OWNER_USERNAME: 'kriss' });

  const buf = Buffer.from('fake pdf');
  const r = await proc.processPdf(buf, { source: 'UPLOAD', subject: 'statement.pdf' });

  assert.equal(r.status, 'ok');
  assert.equal(r.period, '2026-08');
  assert.equal(r.assets.length, 2);
  assert.equal(r.upserted, 2);
  assert.equal(r.ownerId, 'owner-1');

  // AAPL มีอยู่แล้ว → update, MSFT ใหม่ → create
  assert.equal(calls.updated.length, 1);
  assert.deepEqual(calls.updated[0].where, { id: 'pos-aapl' });
  assert.equal(calls.updated[0].data.quantity, 120);
  assert.ok(calls.positions.some((c) => c.symbol === 'MSFT'));
  // ราคา 2 ตัว
  assert.equal(calls.prices.length, 2);
  assert.equal(calls.prices[0].symbol, 'AAPL');
  assert.equal(calls.prices[0].source, 'dime');
  // statement บันทึกด้วย hash + message_id
  const stmt = calls.statements[0];
  assert.equal(stmt.statement_period, '2026-08');
  assert.equal(stmt.message_id, null);
  assert.equal(stmt.raw_text_hash, sha1Section('AAPL APPLE INC. 120 45.30 44.50 5,340.00\nMSFT MICROSOFT CORP 60 150.00 160.25 9,615.00'));
  assert.equal(stmt.source, 'UPLOAD');
  assert.ok(Array.isArray(stmt.assets));
});

test('pipeline: duplicate (hash ซ้ำ) → status duplicate, ไม่แตะพอร์ต', async () => {
  const { calls, ...deps } = makeDeps({ findStatement: async () => ({ id: 'existing-1' }) });
  const proc = createDimeProcessor(deps, { DIME_OWNER_USERNAME: 'kriss' });
  const r = await proc.processPdf(Buffer.from('x'), { source: 'EMAIL', messageId: 'msg-9', subject: 'S' });
  assert.equal(r.status, 'duplicate');
  assert.equal(r.statementId, 'existing-1');
  assert.equal(calls.updated.length, 0);
  assert.equal(calls.prices.length, 0);
  assert.equal(calls.findPositionCalls.length, 0);
  assert.equal(calls.positions.length, 0);
  assert.equal(calls.statements.length, 0, 'ไม่ควรบันทึก statement ซ้ำ');
});

test('pipeline: ไม่มี section หุ้น US → status no-section', async () => {
  const { ...deps } = makeDeps({
    parsePdf: async () => ({ text: 'ข้อความทั่วไป' }),
  });
  const proc = createDimeProcessor(deps as DimeDeps, {});
  const r = await proc.processPdf(Buffer.from('x'), { source: 'UPLOAD' });
  assert.equal(r.status, 'no-section');
});

test('pipeline: อ่าน PDF ไม่ได้ → status error (ไม่ crash)', async () => {
  const { ...deps } = makeDeps({ parsePdf: async () => { throw new Error('broken file'); } });
  const proc = createDimeProcessor(deps as DimeDeps, {});
  const r = await proc.processPdf(Buffer.from('x'), { source: 'UPLOAD' });
  assert.equal(r.status, 'error');
  assert.match(r.reason!, /อ่าน PDF ไม่ได้/);
});

test('pipeline: PDF ล็อกรหัส → ลองอ่านรอบ 2 ด้วย password จาก env', async () => {
  let calls = 0;
  let usedPassword: string | undefined;
  const deps = makeDeps({
    parsePdf: async (_buf, password) => {
      calls++;
      if (calls === 1 && !password) throw new Error('Encrypted PDF');
      usedPassword = password;
      return { text: STATEMENT_TEXT };
    },
  });
  const proc = createDimeProcessor(deps, { DIME_PDF_PASSWORD: '123456' });
  const r = await proc.processPdf(Buffer.from('x'), { source: 'EMAIL', messageId: 'm1' });
  assert.equal(r.status, 'ok');
  assert.equal(calls, 2);
  assert.equal(usedPassword, '123456');
});

test('pipeline: หาเจ้าของไม่เจอ → เก็บ statement แต่ upserted 0', async () => {
  const { calls, ...deps } = makeDeps({
    findUser: async () => null,
  });
  const proc = createDimeProcessor(deps, {});
  const r = await proc.processPdf(Buffer.from('x'), { source: 'EMAIL', messageId: 'm2' });
  assert.equal(r.status, 'ok');
  assert.equal(r.ownerId, null);
  assert.equal(r.upserted, 0);
  assert.equal(calls.prices.length, 0);
  assert.equal(calls.statements.length, 1, 'statement ยังบันทึก');
  const stmt = calls.statements[0];
  assert.equal(stmt.user_id, null);
});

test('pipeline: upsert ตำแหน่งหนึ่งพลาด → ข้ามตัวนั้น ดำเนินต่อ', async () => {
  const deps = makeDeps({
    createPosition: async () => { throw new Error('db down'); },
  });
  const proc = createDimeProcessor(deps, { DIME_OWNER_USERNAME: 'kriss' });
  const r = await proc.processPdf(Buffer.from('x'), { source: 'UPLOAD' });
  // AAPL อัปเดตได้, MSFT สร้างไม่ได้ → upserted 1 ตัว แต่ status ยัง ok
  assert.equal(r.status, 'ok');
  assert.equal(r.upserted, 1);
});