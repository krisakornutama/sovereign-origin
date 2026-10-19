// tests/fleetEnrollment.test.ts
//
// Fleet enrollment tokens — lifecycle tests
// เป้าหมาย: รหัสจริงต้องไม่ถูกเก็บลงดิสก์, ใช้ซ้ำไม่ได้, หมดอายุ/เพิกถอนแล้วใช้ไม่ได้,
// และการคืนสิทธิ์เมื่อ register ล้มเหลวต้องไม่ทำให้ใช้เกินโควตา
import './setup-env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  consumeEnrollToken,
  createEnrollToken,
  enrollTokenSummary,
  generateEnrollToken,
  isEnrollTokenFormat,
  listEnrollTokens,
  markEnrollTokenMachine,
  readEnrollTokenStore,
  releaseEnrollTokenUse,
  revokeEnrollToken,
} from '../src/services/fleet-enrollment.service';
import { fleetFile, writeJsonAtomic } from '../src/services/fleet-store.service';

let root = '';

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-fleet-enroll-'));
});

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function createOne(overrides: Record<string, unknown> = {}) {
  const created = await createEnrollToken(
    { label: 'สาขาทดสอบ', maxUses: 1, expiresInHours: 1, ...overrides },
    'admin-1',
    root,
  );
  assert.equal(created.ok, true, created.ok ? '' : created.error);
  if (!created.ok) throw new Error(created.error);
  return created;
}

describe('fleet enrollment — token shape', () => {
  it('รหัสจริงมีรูปแบบ enr_ + 48 hex และคืนครั้งเดียว', async () => {
    const created = await createOne();
    assert.equal(isEnrollTokenFormat(created.token), true);
    assert.match(created.token, /^enr_[a-f0-9]{48}$/);
    assert.equal(created.record.prefix, created.token.slice(0, 12));
    assert.equal('tokenHash' in created.record, false, 'public record ต้องไม่มี hash');
    assert.equal('token' in created.record, false, 'public record ต้องไม่มีรหัสจริง');
  });

  it('ดิสก์เก็บเฉพาะ sha256 ไม่เก็บรหัสจริง', async () => {
    const created = await createOne();
    const raw = fs.readFileSync(fleetFile('enrollment-tokens.json', root), 'utf8');
    assert.equal(raw.includes(created.token), false, 'ต้องไม่พบรหัสจริงในไฟล์');
    const store = readEnrollTokenStore(root);
    assert.equal(store.tokens.length, 1);
    assert.match(store.tokens[0]!.tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(store.tokens[0]!.tokenHash, created.token);
  });

  it('generateEnrollToken สุ่มไม่ซ้ำ', () => {
    const a = generateEnrollToken();
    const b = generateEnrollToken();
    assert.notEqual(a.token, b.token);
    assert.equal(isEnrollTokenFormat(a.token), true);
  });
});

describe('fleet enrollment — consume lifecycle', () => {
  it('ใช้ได้ครั้งเดียวตาม maxUses แล้ว exhausted', async () => {
    const created = await createOne({ maxUses: 1 });
    const first = await consumeEnrollToken(created.token, { id: 'machine-1', name: 'PC-1' }, root);
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.usesRemaining, 0);
      assert.equal(first.label, 'สาขาทดสอบ');
    }
    const second = await consumeEnrollToken(created.token, { id: 'machine-2', name: 'PC-2' }, root);
    assert.deepEqual(second, { ok: false, reason: 'exhausted' });
  });

  it('รหัสผิด = invalid และไม่แตะ usedCount', async () => {
    const created = await createOne();
    const wrong = generateEnrollToken().token;
    const out = await consumeEnrollToken(wrong, { id: 'm', name: 'x' }, root);
    assert.deepEqual(out, { ok: false, reason: 'invalid' });
    assert.equal(listEnrollTokens(root)[0]!.usedCount, 0);
  });

  it('เพิกถอนแล้วใช้ไม่ได้', async () => {
    const created = await createOne();
    const revoked = await revokeEnrollToken(created.record.id, root);
    assert.equal(revoked.ok, true);
    const out = await consumeEnrollToken(created.token, { id: 'm', name: 'x' }, root);
    assert.deepEqual(out, { ok: false, reason: 'revoked' });
  });

  it('หมดอายุแล้วใช้ไม่ได้', async () => {
    const created = await createOne();
    const store = readEnrollTokenStore(root);
    store.tokens[0]!.expiresAt = new Date(Date.now() - 60_000).toISOString();
    writeJsonAtomic(fleetFile('enrollment-tokens.json', root), store);
    const out = await consumeEnrollToken(created.token, { id: 'm', name: 'x' }, root);
    assert.deepEqual(out, { ok: false, reason: 'expired' });
    assert.equal(listEnrollTokens(root)[0]!.expired, true);
  });

  it('คืนสิทธิ์เมื่อ register ล้มเหลว และใช้ซ้ำได้', async () => {
    const created = await createOne({ maxUses: 1 });
    const first = await consumeEnrollToken(created.token, { id: null, name: 'PC-1' }, root);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(listEnrollTokens(root)[0]!.usesRemaining, 0);

    const released = await releaseEnrollTokenUse(first.tokenId, root);
    assert.equal(released, true);
    assert.equal(listEnrollTokens(root)[0]!.usesRemaining, 1);
    assert.equal(listEnrollTokens(root)[0]!.lastMachineName, null);

    const retry = await consumeEnrollToken(created.token, { id: 'machine-1', name: 'PC-1' }, root);
    assert.equal(retry.ok, true);
  });

  it('ผูก machine id จริงหลัง register สำเร็จได้', async () => {
    const created = await createOne();
    const consumed = await consumeEnrollToken(created.token, { id: null, name: 'PC-1' }, root);
    assert.equal(consumed.ok, true);
    if (!consumed.ok) return;
    const marked = await markEnrollTokenMachine(consumed.tokenId, 'machine-9', 'PC-1', root);
    assert.equal(marked, true);
    const row = listEnrollTokens(root)[0]!;
    assert.equal(row.lastMachineId, 'machine-9');
    assert.equal(row.lastMachineName, 'PC-1');
  });
});

describe('fleet enrollment — validation + summary', () => {
  it('ปฏิเสธ label สั้น/โควตาผิด/อายุผิด', async () => {
    assert.equal((await createEnrollToken({ label: 'x' }, null, root)).ok, false);
    assert.equal((await createEnrollToken({ label: 'ok', maxUses: 0 }, null, root)).ok, false);
    assert.equal((await createEnrollToken({ label: 'ok', maxUses: 1001 }, null, root)).ok, false);
    assert.equal((await createEnrollToken({ label: 'ok', maxUses: 1, expiresInHours: 0 }, null, root)).ok, false);
    assert.equal((await createEnrollToken({ label: 'ok', maxUses: 1, expiresInHours: 8761 }, null, root)).ok, false);
  });

  it('summary แยก usable / exhausted / revoked / expired', async () => {
    const a = await createOne({ label: 'AA', maxUses: 1 });
    const b = await createOne({ label: 'BB', maxUses: 1 });
    await createOne({ label: 'CC', maxUses: 1 });
    await consumeEnrollToken(a.token, { id: 'm1', name: 'PC-1' }, root);
    await revokeEnrollToken(b.record.id, root);
    const store = readEnrollTokenStore(root);
    const c = store.tokens.find((row) => row.label === 'CC')!;
    c.expiresAt = new Date(Date.now() - 1_000).toISOString();
    writeJsonAtomic(fleetFile('enrollment-tokens.json', root), store);

    const summary = enrollTokenSummary(root);
    assert.equal(summary.total, 3);
    assert.equal(summary.usable, 0);
    assert.equal(summary.exhausted, 1);
    assert.equal(summary.revoked, 1);
    assert.equal(summary.expired, 1);
  });

  it('ไฟล์ store เสีย = ปิดทะเบียน (list ว่าง) ไม่ throw', () => {
    fs.writeFileSync(fleetFile('enrollment-tokens.json', root), '{broken', 'utf8');
    assert.deepEqual(listEnrollTokens(root), []);
    assert.equal(enrollTokenSummary(root).total, 0);
  });

  it('expiresAt/revokedAt ที่แปลงไม่ได้ = ทิ้ง record (ไม่ตีความเป็นไม่หมดอายุ/ไม่ถูกเพิกถอน)', async () => {
    await createOne({ label: 'EXP' });
    const withBadExpiry = readEnrollTokenStore(root);
    withBadExpiry.tokens[0]!.expiresAt = 'not-a-date';
    writeJsonAtomic(fleetFile('enrollment-tokens.json', root), withBadExpiry);
    assert.deepEqual(listEnrollTokens(root), []);

    await createOne({ label: 'REV' });
    const withBadRevoke = readEnrollTokenStore(root);
    withBadRevoke.tokens[0]!.revokedAt = 'not-a-date';
    writeJsonAtomic(fleetFile('enrollment-tokens.json', root), withBadRevoke);
    assert.deepEqual(listEnrollTokens(root), []);
  });
});
