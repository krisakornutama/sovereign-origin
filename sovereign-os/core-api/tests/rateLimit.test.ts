import { test } from 'node:test';
import assert from 'node:assert';
import { rateLimit } from '../src/middleware/rateLimit.middleware';

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  setHeader(k: string, v: string): void;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    setHeader(k, v) {
      res.headers[k] = String(v);
    },
  };
  return res;
}

function makeReq(ip: string): { ip: string; socket: { remoteAddress: string } } {
  return { ip, socket: { remoteAddress: ip } };
}

test('allows up to max requests then blocks with 429', () => {
  const mw = rateLimit({ windowMs: 60000, max: 3 });
  let nextCalled = 0;

  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    mw(makeReq('10.0.0.1'), res, () => { nextCalled++; });
    assert.strictEqual(res.statusCode, 200);
  }

  const blocked = makeRes();
  mw(makeReq('10.0.0.1'), blocked, () => { nextCalled++; });
  assert.strictEqual(blocked.statusCode, 429);
  assert.strictEqual(nextCalled, 3); // ตัวที่เกินไปไม่เรียก next
});

test('sets Retry-After header when rate limited', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1 });
  mw(makeReq('10.0.0.2'), makeRes(), () => {});
  const blocked = makeRes();
  mw(makeReq('10.0.0.2'), blocked, () => {});
  assert.strictEqual(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) >= 1);
});

test('keeps separate buckets per IP', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1 });
  const a1 = makeRes();
  mw(makeReq('10.0.0.3'), a1, () => {});
  const b1 = makeRes();
  mw(makeReq('10.0.0.4'), b1, () => {});

  assert.strictEqual(a1.statusCode, 200);
  assert.strictEqual(b1.statusCode, 200);

  const a2 = makeRes();
  mw(makeReq('10.0.0.3'), a2, () => {});
  assert.strictEqual(a2.statusCode, 429); // IP แรกถูกบล็อก

  const b2 = makeRes();
  mw(makeReq('10.0.0.4'), b2, () => {});
  assert.strictEqual(b2.statusCode, 429); // IP ที่สองก็ถูกบล็อกหลังครบ max
});

test('resets after the window expires', async () => {
  const mw = rateLimit({ windowMs: 50, max: 1 });
  mw(makeReq('10.0.0.5'), makeRes(), () => {});
  const blocked = makeRes();
  mw(makeReq('10.0.0.5'), blocked, () => {});
  assert.strictEqual(blocked.statusCode, 429);

  // รอให้ window หมด แล้วควรผ่านได้อีก
  await new Promise((r) => setTimeout(r, 80));
  const after = makeRes();
  mw(makeReq('10.0.0.5'), after, () => {});
  assert.strictEqual(after.statusCode, 200);
});

test('uses custom error message', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, message: 'Slow down!' });
  mw(makeReq('10.0.0.6'), makeRes(), () => {});
  const blocked = makeRes();
  mw(makeReq('10.0.0.6'), blocked, () => {});
  assert.deepStrictEqual(blocked.body, { error: 'Slow down!' });
});

test('backoff: escalates Retry-After on each blocked retry', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, backoff: true });
  mw(makeReq('10.0.0.7'), makeRes(), () => {}); // allowed

  const b1 = makeRes();
  mw(makeReq('10.0.0.7'), b1, () => {});
  assert.strictEqual(b1.statusCode, 429);
  const first = Number(b1.headers['Retry-After']);

  const b2 = makeRes();
  mw(makeReq('10.0.0.7'), b2, () => {});
  assert.strictEqual(b2.statusCode, 429);
  const second = Number(b2.headers['Retry-After']);

  const b3 = makeRes();
  mw(makeReq('10.0.0.7'), b3, () => {});
  assert.strictEqual(b3.statusCode, 429);
  const third = Number(b3.headers['Retry-After']);

  // exponential: แต่ละครั้งที่ retry ขณะโดนบล็อก → รอต่อไปนานขึ้น
  assert.ok(second > first, `expected ${second} > ${first}`);
  assert.ok(third > second, `expected ${third} > ${second}`);
});

test('backoff: block outlives the counting window (deterministic, no sleeps)', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, backoff: true });
  mw(makeReq('10.0.0.8'), makeRes(), () => {}); // allowed
  const b1 = makeRes();
  mw(makeReq('10.0.0.8'), b1, () => {}); // first block
  const b2 = makeRes();
  mw(makeReq('10.0.0.8'), b2, () => {}); // escalate
  assert.strictEqual(b1.statusCode, 429);
  assert.strictEqual(b2.statusCode, 429);
  assert.ok(Number(b2.headers['Retry-After']) > Number(b1.headers['Retry-After']));

  // block ถูกกำหนดด้วย blockedUntil ไม่ใช่ counting window → ต้องยาวกว่า window
  const s = mw.store.get('10.0.0.8')!;
  assert.ok(s.blockedUntil > s.windowResetAt, 'block ต้องยาวกว่า counting window');

  // ยังโดนบล็อกอยู่ → 429 (ไม่ได้รับ bucket ใหม่แค่เพราะ window หมด)
  const b3 = makeRes();
  mw(makeReq('10.0.0.8'), b3, () => {});
  assert.strictEqual(b3.statusCode, 429);

  // ล้าง bucket → กลับเข้าได้
  mw.store.clear('10.0.0.8');
  const after = makeRes();
  mw(makeReq('10.0.0.8'), after, () => {});
  assert.strictEqual(after.statusCode, 200);
});

test('store: exposes state, clear one IP, clear all', () => {
  const mw = rateLimit({ windowMs: 60000, max: 2 });
  mw(makeReq('10.0.0.9'), makeRes(), () => {});
  mw(makeReq('10.0.0.9'), makeRes(), () => {});
  mw(makeReq('10.0.0.10'), makeRes(), () => {});

  const s9 = mw.store.get('10.0.0.9');
  assert.ok(s9, 'store.get ควรคืน state');
  assert.strictEqual(s9.count, 2);
  assert.strictEqual(s9.blockLevel, 0);
  assert.ok(!s9.blockedUntil || s9.blockedUntil <= Date.now());

  // clear IP เดียว
  const cleared = mw.store.clear('10.0.0.9');
  assert.deepStrictEqual(cleared, ['10.0.0.9']);
  assert.strictEqual(mw.store.get('10.0.0.9'), undefined);
  assert.ok(mw.store.get('10.0.0.10'), 'IP อื่นต้องไม่ถูกเคลียร์');

  // clear ทั้งหมด
  const all = mw.store.clear();
  assert.ok(all.includes('10.0.0.10'));
  assert.strictEqual(mw.store.all().length, 0);
});
