// ── INTEGRATION TEST: ต้องมี DB จริง ──
// รัน:  RUN_INTEGRATION=1 DATABASE_URL=postgresql://... JWT_SECRET=... npm run test:integration
// (Windows cmd: set RUN_INTEGRATION=1 && npm run test:integration)
// ไม่ import tests/setup-env — ใช้ env จริงจาก process
//
// ย้ายมาจาก tests/nextgenSecurity.test.ts (เดิมอยู่ใน unit suite
// ทำให้ npm test แดงบนเครื่องที่ไม่ได้เปิด Postgres)
import { test } from 'node:test';
import assert from 'node:assert';

const SKIP = process.env.RUN_INTEGRATION !== '1';

test('threat intel: add + matchDomains + hits เพิ่ม + remove', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const { threatIntel } = await import('../../src/services/threat-intel.service');
  const value = `unittest-${Date.now()}.example.com`;
  const item = await threatIntel.add({ type: 'DOMAIN', value, category: 'malware', note: 'test' });
  try {
    const matched1 = await threatIntel.matchDomains([value]);
    assert.equal(matched1.length, 1);
    assert.equal(matched1[0].category, 'malware');
    const matched2 = await threatIntel.matchDomains([value]);
    assert.equal(matched2.length, 1, 'match ซ้ำต้องเจออีก');
    const list = await threatIntel.list({ q: value });
    assert.ok(list.items.some((i: any) => i.value === value), 'list ค้นหาควรเจอ');
  } finally {
    await threatIntel.remove(item.id);
  }
  const after = await threatIntel.matchDomains([value]);
  assert.equal(after.length, 0, 'ลบแล้วต้องไม่เจอ');
});

test('threat intel: seedIfEmpty ไม่ทำอะไรถ้าฐานมีข้อมูลแล้ว', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const { threatIntel } = await import('../../src/services/threat-intel.service');
  const n = await threatIntel.seedIfEmpty();
  assert.equal(n, 0, 'มีข้อมูลอยู่แล้ว seed ควรคืน 0');
});
