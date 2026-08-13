// TDD: Sovereign Buddhist Healing Module — ธรรมะบำบัดใจ + สมุนไพรคู่ยา + ติดตามผล
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkHerbWithMeds,
  computeHealingProgress,
  buildDhammaPrompt,
  parseDhammaReply,
  HERB_DB,
} from '../src/services/buddhist-healing.service';

test('HERB_DB contains the core Thai herbs with warnings', () => {
  const names = HERB_DB.map((h) => h.name);
  for (const n of ['ฟ้าทะลายโจร', 'ขมิ้นชัน', 'มะขามป้อม', 'เห็ดหลินจือ']) {
    assert.ok(names.includes(n), `ควรมี ${n}`);
  }
  const fa = HERB_DB.find((h) => h.name === 'ฟ้าทะลายโจร')!;
  assert.ok(fa.warnings.length > 0);
  assert.ok(fa.interactions.some((i) => i.med.toLowerCase().includes('warfarin')));
});

test('checkHerbWithMeds flags dangerous herb-med interactions', () => {
  const r = checkHerbWithMeds('ฟ้าทะลายโจร', ['Warfarin']);
  assert.equal(r.safe, false);
  assert.equal(r.conflicts.length, 1);
  assert.ok(r.conflicts[0].severity === 'high');
});

test('checkHerbWithMeds is safe when no conflicting meds', () => {
  const r = checkHerbWithMeds('มะขามป้อม', ['Paracetamol']);
  assert.equal(r.safe, true);
  assert.equal(r.conflicts.length, 0);
});

test('checkHerbWithMeds warns to consult doctor for chemo (ขมิ้นชัน)', () => {
  const r = checkHerbWithMeds('ขมิ้นชัน', ['Doxorubicin']);
  assert.equal(r.safe, false);
  assert.ok(r.conflicts.some((c) => c.med.toLowerCase().includes('คีโม') || c.med.toLowerCase().includes('doxorubicin')));
});

test('checkHerbWithMeds handles unknown herbs gracefully', () => {
  const r = checkHerbWithMeds('สมุนไพรลึกลับ', []);
  assert.equal(r.safe, true);
  assert.ok(r.note.length > 0);
});

test('checkHerbWithMeds treats empty/whitespace herb name as unknown (no false match)', () => {
  const r = checkHerbWithMeds('', ['Warfarin']);
  assert.equal(r.safe, true);
  assert.equal(r.herb, null);
  assert.equal(r.conflicts.length, 0);
  const r2 = checkHerbWithMeds('   ', []);
  assert.equal(r2.herb, null);
  assert.equal(r2.safe, true);
});

test('checkHerbWithMeds ignores empty/whitespace med entries (no false conflicts)', () => {
  const r = checkHerbWithMeds('ฟ้าทะลายโจร', ['', '  ', ',']);
  assert.equal(r.safe, true);
  assert.equal(r.conflicts.length, 0);
});

test('computeHealingProgress shows week-over-week improvement for stress/meditation', () => {
  const logs = [
    { metric: 'stress', value: 72, logged_at: '2026-08-01T08:00:00Z' },
    { metric: 'stress', value: 65, logged_at: '2026-08-03T08:00:00Z' },
    { metric: 'stress', value: 58, logged_at: '2026-08-05T08:00:00Z' },
    { metric: 'stress', value: 45, logged_at: '2026-08-07T08:00:00Z' },
    { metric: 'stress', value: 35, logged_at: '2026-08-09T08:00:00Z' },
  ];
  const p = computeHealingProgress(logs);
  const stress = p.find((x) => x.metric === 'stress');
  assert.ok(stress);
  assert.equal(stress.before, 72);
  assert.equal(stress.after, 35);
  assert.equal(stress.delta, -37);
  assert.ok(stress.improving); // ความเครียดลด = ดีขึ้น
});

test('computeHealingProgress marks meditation increase as improving', () => {
  const logs = [
    { metric: 'meditation_min', value: 15, logged_at: '2026-08-01T08:00:00Z' },
    { metric: 'meditation_min', value: 30, logged_at: '2026-08-05T08:00:00Z' },
    { metric: 'meditation_min', value: 45, logged_at: '2026-08-09T08:00:00Z' },
  ];
  const p = computeHealingProgress(logs);
  const m = p.find((x) => x.metric === 'meditation_min');
  assert.ok(m);
  assert.equal(m.delta, 30);
  assert.ok(m.improving);
});

test('buildDhammaPrompt embeds retrieved teaching and user message', () => {
  const prompt = buildDhammaPrompt('กลัวความตาย', {
    title: 'มรณัสสติ',
    content: 'ความตายเป็นของธรรมดา ผู้เกิดมาแล้วย่อมตาย',
    application: 'เตรียมใจรับความจริง',
  });
  assert.ok(prompt.includes('กลัวความตาย'));
  assert.ok(prompt.includes('มรณัสสติ'));
  assert.ok(prompt.includes('ความตายเป็นของธรรมดา'));
});

test('parseDhammaReply strips markdown fences and keeps the answer', () => {
  const reply = '```\nหายใจเข้าลึก ๆ... รู้ว่ากำลังหายใจเข้า\n```';
  const r = parseDhammaReply(reply);
  assert.ok(!r.includes('```'));
  assert.ok(r.includes('หายใจเข้า'));
});
