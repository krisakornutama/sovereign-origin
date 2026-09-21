// TDD: Sovereign Buddhist Healing Module — ธรรมะบำบัดใจ + สมุนไพรคู่ยา + ติดตามผล
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkHerbWithMeds,
  computeHealingProgress,
  buildDhammaPrompt,
  parseDhammaReply,
  mbtiToneFor,
  MBTI_CARE_TONES,
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

// ── MBTI Care Tones — หลวงพี่ปรับโทนตามบุคลิกครบ 16 ประเภท ──

test('MBTI_CARE_TONES covers all 16 types with distinct monk personas', () => {
  const codes = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'];
  assert.equal(Object.keys(MBTI_CARE_TONES).length, 16);
  for (const c of codes) {
    const t = MBTI_CARE_TONES[c];
    assert.ok(t, `ต้องมีโทนสำหรับ ${c}`);
    assert.ok(t.label.length > 0);
    assert.ok(t.yakLabel.startsWith('หลวงพี่'), `${c} ต้องมีบุคลิกหลวงพี่เฉพาะตัว`);
    assert.ok(t.tone.length > 5);
    assert.ok(t.healing.length > 10);
  }
  const yakLabels = new Set(codes.map((c) => MBTI_CARE_TONES[c].yakLabel));
  assert.equal(yakLabels.size, 16, 'บุคลิกหลวงพี่ต้องไม่ซ้ำกัน');
});

test('mbtiToneFor normalizes case and rejects unknown codes', () => {
  assert.equal(mbtiToneFor('intj')?.code, 'INTJ');
  assert.equal(mbtiToneFor(' estp ')?.yakLabel, 'หลวงพี่ผู้ปฏิบัติ');
  assert.equal(mbtiToneFor('XXXX'), null);
  assert.equal(mbtiToneFor(''), null);
  assert.equal(mbtiToneFor(null), null);
  assert.equal(mbtiToneFor(undefined), null);
});

test('buildDhammaPrompt adapts persona and care instructions per MBTI type', () => {
  const teaching = { title: 'อนิจจัง', content: 'ทุกสิ่งเกิดขึ้นแล้วดับไป', application: 'เห็นความไม่แน่นอน' };
  const intj = buildDhammaPrompt('เครียดมาก', teaching, mbtiToneFor('INTJ'));
  assert.ok(intj.includes('หลวงพี่นักวางแผน'), 'INTJ ต้องได้บุคลิกนักวางแผน');
  assert.ok(intj.includes('INTJ (นักวางระบบ)'));
  assert.ok(intj.includes('ตรง กระชับ'));
  const infp = buildDhammaPrompt('เครียดมาก', teaching, mbtiToneFor('INFP'));
  assert.ok(infp.includes('หลวงพี่นักเล่าเรื่อง'), 'INFP ต้องได้บุคลิกนักเล่าเรื่อง');
  assert.ok(infp.includes('ชวนเล่า') || infp.includes('ปล่อยผ่าน'));
  assert.ok(intj !== infp);
  // คงของเดิมไว้ครบ: หลักธรรม + ข้อความผู้ใช้ + กติกาเรื่องยา
  for (const p of [intj, infp]) {
    assert.ok(p.includes('อนิจจัง'));
    assert.ok(p.includes('เครียดมาก'));
    assert.ok(p.includes('อย่าแนะนำให้เลิกยา'));
  }
});

test('buildDhammaPrompt without tone falls back to generic monk (no MBTI section)', () => {
  const generic = buildDhammaPrompt('ไม่สบายใจ', null, null);
  assert.ok(generic.includes('หลวงพี่อาจารย์'));
  assert.ok(!generic.includes('ประเภท') || !generic.includes('ปรับโทน'));
  const oldSignature = buildDhammaPrompt('ไม่สบายใจ', null);
  assert.ok(oldSignature.includes('หลวงพี่อาจารย์'), 'เรียกแบบ signature เดิม (2 พารามิเตอร์) ต้องยังทำงาน');
});

// ── หลักฐานว่า prompt ของหลวงพี่ 16 โค้ดต่างกันจริง (ไม่ใช่แค่มีครบ) ──

const MBTI_CODES_16 = ['INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP', 'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP'];

/** ตัวเลขความแตกต่างระหว่าง 2 prompt (จำนวนอักขระต่างกันแบบไม่อิงตำแหน่ง) */
function charDistance(a: string, b: string): number {
  const ca = new Map<string, number>();
  for (const ch of a) ca.set(ch, (ca.get(ch) ?? 0) + 1);
  const cb = new Map<string, number>();
  for (const ch of b) cb.set(ch, (cb.get(ch) ?? 0) + 1);
  let diff = 0;
  for (const [ch, n] of ca) diff += Math.abs(n - (cb.get(ch) ?? 0));
  for (const [ch, n] of cb) if (!ca.has(ch)) diff += n;
  return diff;
}

test('buildDhammaPrompt: 16 โค้ด → 16 prompt ต่างกันจริงทั้ง 120 คู่', () => {
  const teaching = { title: 'อนิจจัง', content: 'ทุกสิ่งเกิดขึ้นแล้วดับไป', application: 'เห็นความไม่แน่นอน' };
  const prompts = new Map<string, string>();
  for (const c of MBTI_CODES_16) {
    const p = buildDhammaPrompt('ช่วยดูแลใจผู้ใช้หน่อย', teaching, mbtiToneFor(c));
    assert.ok(p.includes(MBTI_CARE_TONES[c].yakLabel), `${c}: prompt ต้องอ้าง "${MBTI_CARE_TONES[c].yakLabel}"`);
    prompts.set(c, p);
  }
  assert.equal(prompts.size, 16, 'ต้องได้ prompt ไม่ซ้ำกันเลย 16 ชุด');
  for (let i = 0; i < MBTI_CODES_16.length; i++) {
    for (let j = i + 1; j < MBTI_CODES_16.length; j++) {
      const a = MBTI_CODES_16[i], b = MBTI_CODES_16[j];
      const pa = prompts.get(a)!, pb = prompts.get(b)!;
      assert.ok(pa !== pb, `${a} vs ${b}: prompt ต้องไม่เท่ากัน`);
      assert.ok(!pa.includes(MBTI_CARE_TONES[b].yakLabel), `${a}: ห้ามไปอ้างบุคลิกของ ${b}`);
      assert.ok(!pb.includes(MBTI_CARE_TONES[a].yakLabel), `${b}: ห้ามไปอ้างบุคลิกของ ${a}`);
      const d = charDistance(pa, pb);
      assert.ok(d >= 20, `${a} vs ${b}: ความต่างเชิงเนื้อหา = ${d} อักขระ (น้อยกว่าเกณฑ์ 20)`);
    }
  }
});

test('buildDhammaPrompt: บทบาทของหลวงพี่ (persona) ไม่หลุดเกณฑ์กลางของ AI นิจธรรม', () => {
  const teaching = { title: 'สติ', content: 'รู้ลมหายใจเข้าออก', application: null };
  for (const c of MBTI_CODES_16) {
    const p = buildDhammaPrompt('วันนี้ใจไม่นิ่ง', teaching, mbtiToneFor(c));
    assert.ok(p.includes('หลวงพี่'), `${c}: ต้องขึ้นบทบาทหลวงพี่`);
    assert.ok(p.includes('อย่าแนะนำให้เลิกยา'), `${c}: กติกาเรื่องยาต้องอยู่ครบทุกโค้ด`);
    assert.ok(p.includes('รู้ลมหายใจ') || p.includes('หายใจเข้าออก'), `${c}: คำแนะนำการปฏิบัติต้องอยู่`);
    assert.ok(p.includes('วันนี้ใจไม่นิ่ง'), `${c}: ข้อความผู้ใช้ต้องถูกฝัง`);
  }
});

test('mbtiToneFor: โค้ด 16 ตัวต้องไม่โดน map ไปโทนอื่นและ normalize ให้ตรงกันเสมอ', () => {
  for (const c of MBTI_CODES_16) {
    const t = mbtiToneFor(c);
    assert.ok(t, `${c} ต้องมีโทน`);
    assert.equal(t!.code, c);
    assert.equal(t!.yakLabel, MBTI_CARE_TONES[c].yakLabel);
    // lowercase ต้องได้ object เดียวกัน (same tone)
    const lower = mbtiToneFor(c.toLowerCase());
    assert.equal(lower!.yakLabel, t!.yakLabel, `${c.toLowerCase()} ต้อง normalize เป็นโทนเดียวกับ ${c}`);
  }
});
