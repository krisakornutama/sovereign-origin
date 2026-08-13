import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import {
  prisma,
  AGE_RANGES,
  extractLessonJson,
  normalizeLesson,
  buildTeachPrompt,
  generateLesson,
  saveLesson,
  lessonToText,
  createKid,
  updateKid,
  listKids,
  deleteKid,
  recordLessonProgress,
  kidStats,
  normalizeScore,
  addChore,
  deleteChore,
  completeChore,
  reopenChore,
  addBill,
  deleteBill,
  payBill,
  addWalletMoney,
  walletBalance,
  kidHome,
  dashboardSummary,
  listOllamaModels,
  setAllowance,
  allowanceDueNow,
  payWeeklyAllowances,
  payAllowanceNow,
  allowanceHistory,
  addCoupon,
  deleteCoupon,
  redeemCoupon,
  weeklyReport,
  archiveOldItems,
  setSavingsGoal,
  piggyBalance,
  monthlyPiggyIn,
  piggyTransfer,
  setKidPin,
  verifyKidPin,
  buildDailySummary,
  formatDailySummary,
  resetDailyChores,
  setPiggyTarget,
  piggyEta,
  STOCK_CATALOG,
  stockPrice,
  buyStock,
  sellStock,
  stockPortfolio,
  kidAuditLog,
  kidLevel,
  listCertificates,
  recordPortfolioSnapshot,
  portfolioHistory,
  setKidMoneyMode,
  setInvestPolicy,
  setNotifySender,
  addPortfolioDeposit,
  portfolioDeposits,
  portfolioPerformance,
  setInvestTargetPct,
} from '../src/services/teach-kids.service';

// ────────────────────────────────────────────────
// AGE_RANGES
// ────────────────────────────────────────────────
describe('AGE_RANGES', () => {
  test('covers kindergarten through high school', () => {
    const ids = AGE_RANGES.map((a) => a.id);
    assert.ok(ids.includes('3-5'));
    assert.ok(ids.includes('6-8'));
    assert.ok(ids.includes('9-12'));
    assert.ok(ids.includes('13-15'));
    assert.ok(ids.includes('16+'));
  });
});

// ────────────────────────────────────────────────
// extractLessonJson
// ────────────────────────────────────────────────
describe('extractLessonJson', () => {
  test('parses bare JSON object', () => {
    const obj = extractLessonJson('{"title":"x","quiz":[]}');
    assert.equal(obj?.title, 'x');
  });

  test('strips ```json fences', () => {
    const obj = extractLessonJson('```json\n{"title":"น้ำ"} \n```');
    assert.equal(obj?.title, 'น้ำ');
  });

  test('extracts JSON surrounded by prose', () => {
    const obj = extractLessonJson('นี่คือบทเรียนครับ {"title":"โซลาร์"} จบ');
    assert.equal(obj?.title, 'โซลาร์');
  });

  test('returns null for non-JSON text', () => {
    assert.equal(extractLessonJson('ขอโทษครับ สร้างบทเรียนไม่ได้'), null);
    assert.equal(extractLessonJson(''), null);
  });
});

// ────────────────────────────────────────────────
// normalizeLesson
// ────────────────────────────────────────────────
const goodRaw = {
  title: '  น้ำคือชีวิต  ',
  summary: 'ทำไมเราต้องดื่มน้ำ',
  sections: [
    { heading: 'น้ำสำคัญยังไง', content: 'ร่างกายเราส่วนใหญ่เป็นน้ำ' },
    { heading: '', content: 'เนื้อไม่มีหัวข้อ' },
  ],
  key_points: ['ดื่มน้ำวันละ 8 แก้ว', '', 'ประหยัดน้ำ'],
  quiz: [
    { question: 'ร่างกายเราส่วนใหญ่เป็นอะไร?', options: ['น้ำ', 'ดิน', 'ลม', 'ไฟ'], answer: 0, explanation: 'ประมาณ 70% เป็นน้ำ' },
    { question: 'คำถามที่ answer เกินช่วง', options: ['ก', 'ข'], answer: 9, explanation: 'ต้อง clamp' },
    { question: 'ตัวเลือกน้อยเกินไป', options: ['ก'], answer: 0, explanation: 'ตัดทิ้ง' },
    { question: 'ไม่ใช่ object', options: 'ไม่ใช่ array', answer: 0 },
    { question: '', options: ['ก', 'ข'], answer: 0, explanation: 'ไม่มีคำถาม → ตัด' },
  ],
  sources: ['ไฟล์คู่มือ.txt', '📚 การเอาตัวรอด [abc]'],
};

describe('normalizeLesson', () => {
  test('returns null for non-object', () => {
    assert.equal(normalizeLesson(null), null);
    assert.equal(normalizeLesson('text'), null);
    assert.equal(normalizeLesson([1, 2]), null);
  });

  test('normalizes a good lesson (trim, drop empties)', () => {
    const lesson = normalizeLesson(goodRaw);
    assert.ok(lesson);
    assert.equal(lesson!.title, 'น้ำคือชีวิต');
    assert.equal(lesson!.sections.length, 2);
    assert.equal(lesson!.sections[1].heading, ''); // ยังเก็บ แต่ content มี
    assert.deepEqual(lesson!.key_points, ['ดื่มน้ำวันละ 8 แก้ว', 'ประหยัดน้ำ']);
    assert.equal(lesson!.sources.length, 2);
  });

  test('drops invalid quiz questions and clamps answer index', () => {
    const lesson = normalizeLesson(goodRaw);
    assert.ok(lesson);
    // ข้อ 1 valid, ข้อ 2 clamp 9→1, ข้อ 3/4/5 ถูกตัด
    assert.equal(lesson!.quiz.length, 2);
    assert.equal(lesson!.quiz[0].options.length, 4);
    assert.equal(lesson!.quiz[0].answer, 0);
    assert.equal(lesson!.quiz[1].answer, 1); // clamp เกินช่วง
  });

  test('tolerates sections as plain strings', () => {
    const lesson = normalizeLesson({ title: 'x', sections: ['ย่อหน้าแรก', 'ย่อหน้าที่สอง'] });
    assert.equal(lesson?.sections.length, 2);
    assert.equal(lesson?.sections[0].content, 'ย่อหน้าแรก');
  });

  test('falls back to a default title', () => {
    const lesson = normalizeLesson({ sections: [{ heading: 'ก', content: 'ข' }] });
    assert.ok(lesson && lesson.title.length > 0);
  });

  test('caps quiz at 10 questions', () => {
    const quiz = Array.from({ length: 15 }, (_, i) => ({
      question: `q${i}`, options: ['a', 'b'], answer: 0,
    }));
    const lesson = normalizeLesson({ title: 'x', quiz });
    assert.equal(lesson!.quiz.length, 10);
  });
});

// ────────────────────────────────────────────────
// buildTeachPrompt
// ────────────────────────────────────────────────
describe('buildTeachPrompt', () => {
  test('includes topic, age guidance and source excerpts', () => {
    const prompt = buildTeachPrompt('การเอาตัวรอด', '6-8', ['ข้อมูลน้ำท่วม...', 'ข้อมูลไฟป่า...']);
    assert.match(prompt, /การเอาตัวรอด/);
    assert.match(prompt, /6-8/);
    assert.match(prompt, /ข้อมูลน้ำท่วม/);
    assert.match(prompt, /ข้อมูลไฟป่า/);
    assert.match(prompt, /"quiz"/);
    assert.match(prompt, /"answer"/);
  });

  test('mentions when no knowledge found', () => {
    const prompt = buildTeachPrompt('คณิตศาสตร์', '3-5', []);
    assert.match(prompt, /ไม่มีข้อมูล/);
  });
});

// ────────────────────────────────────────────────
// generateLesson
// ────────────────────────────────────────────────
describe('generateLesson', () => {
  const modelReply = JSON.stringify({
    title: 'การเอาตัวรอดจากน้ำท่วม',
    summary: 'เข้าใจน้ำท่วมและวิธีเตรียมตัว',
    sections: [{ heading: 'น้ำท่วมคืออะไร', content: 'น้ำท่วมเกิดจากฝนตกหนัก' }],
    key_points: ['ฟังข่าว', 'เตรียมกระเป๋าฉุกเฉิน'],
    quiz: [
      { question: 'เมื่อน้ำท่วมควรทำอะไร?', options: ['ขึ้นที่สูง', 'ลงเล่นน้ำ', 'ปิดไฟ', 'เก็บของ'], answer: 0, explanation: 'ขึ้นที่สูงปลอดภัยที่สุด' },
    ],
  });

  test('returns lesson from model and usedKnowledge=true when RAG has hits', async () => {
    const fakeSearch = async () => [
      { file: '📚 คู่มือน้ำท่วม [abc]', chunk_index: 0, content: 'น้ำท่วม: ขึ้นที่สูง เก็บของจำเป็น', score: 0.9, source: 'semantic' as const },
    ];
    const post = async (_url: string, body: unknown, _opts?: any) => {
      assert.ok(String((body as any).prompt).includes('การเอาตัวรอด'));
      return { data: { response: '```json\n' + modelReply + '\n```' } };
    };
    const { lesson, usedKnowledge } = await generateLesson('การเอาตัวรอด', '9-12', { search: fakeSearch, post });
    assert.equal(lesson.title, 'การเอาตัวรอดจากน้ำท่วม');
    assert.equal(lesson.quiz.length, 1);
    assert.equal(usedKnowledge, true);
    assert.deepEqual(lesson.sources, ['📚 คู่มือน้ำท่วม [abc]']);
  });

  test('usedKnowledge=false and still works when no knowledge found', async () => {
    const fakeSearch = async () => [];
    const post = async () => ({ data: { response: modelReply } });
    const { lesson, usedKnowledge } = await generateLesson('คณิตศาสตร์', '6-8', { search: fakeSearch, post });
    assert.equal(usedKnowledge, false);
    assert.ok(lesson.sections.length > 0);
  });

  test('throws when the model returns nothing usable', async () => {
    const fakeSearch = async () => [];
    const post = async () => ({ data: { response: 'ไม่สามารถสร้างได้ครับ' } });
    await assert.rejects(() => generateLesson('คณิตศาสตร์', '6-8', { search: fakeSearch, post }), /ไม่สามารถ|invalid JSON|usable/);
  });

  test('throws on empty model response', async () => {
    const post = async () => ({ data: { response: '' } });
    await assert.rejects(() => generateLesson('x', '6-8', { search: async () => [], post }), /empty ollama response/);
  });
});

// ────────────────────────────────────────────────
// lessonToText + saveLesson
// ────────────────────────────────────────────────
describe('saveLesson', () => {
  const lesson = normalizeLesson({
    title: 'น้ำคือชีวิต',
    summary: 'สรุป',
    sections: [{ heading: 'หัวข้อ', content: 'เนื้อหา' }],
    key_points: ['จุดสำคัญ 1'],
    quiz: [{ question: 'คำถาม?', options: ['น้ำ', 'ไฟ'], answer: 0, explanation: 'เพราะน้ำ' }],
  })!;

  test('lessonToText renders readable Thai lesson + quiz', () => {
    const text = lessonToText(lesson);
    assert.match(text, /น้ำคือชีวิต/);
    assert.match(text, /หัวข้อ/);
    assert.match(text, /จุดสำคัญ 1/);
    assert.match(text, /คำถาม\?/);
    assert.match(text, /เฉลย/);
  });

  test('saves as NOTE with tags and JSON notes', async () => {
    let data: any = null;
    mockModel(prisma, 'knowledgeItem', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'lesson-1', ...args.data };
      },
    });
    const item = await saveLesson(lesson);
    assert.equal(item.id, 'lesson-1');
    assert.equal(data.type, 'NOTE');
    assert.ok(data.tags.includes('บทเรียน'));
    assert.ok(data.tags.includes('AI'));
    assert.ok(data.title.includes('น้ำคือชีวิต'));
    // notes เก็บ JSON ครบ เพื่อเปิดเรียนแบบอินเทอร์แอคทีฟได้
    const parsed = JSON.parse(data.notes);
    assert.equal(parsed.title, 'น้ำคือชีวิต');
    assert.equal(parsed.quiz.length, 1);
    // content เก็บข้อความอ่านง่าย (preview สวยในคลังความรู้)
    assert.match(data.content, /น้ำคือชีวิต/);
  });
});

// ────────────────────────────────────────────────
// โปรไฟล์เด็ก (Kid Profiles) + บันทึกความคืบหน้า
// ────────────────────────────────────────────────
describe('normalizeScore', () => {
  test('clamps out-of-range scores', () => {
    assert.equal(normalizeScore(-3, 5).score, 0);
    assert.equal(normalizeScore(7, 5).score, 5);
    assert.equal(normalizeScore(3, 5).score, 3);
    assert.equal(normalizeScore(3, 5).total, 5);
  });

  test('throws on invalid totals', () => {
    assert.throws(() => normalizeScore(1, 0), /total/);
    assert.throws(() => normalizeScore(1, -1), /total/);
  });
});

describe('kid profiles CRUD', () => {
  test('createKid requires name and saves defaults', async () => {
    let data: any = null;
    mockModel(prisma, 'kidProfile', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'kid-1', ...args.data };
      },
    });
    const kid = await createKid({ name: '  น้องน้ำ  ', age: 7, emoji: '🧒' });
    assert.equal(kid.id, 'kid-1');
    assert.equal(data.name, 'น้องน้ำ');
    assert.equal(data.age, 7);
    assert.equal(data.emoji, '🧒');
    assert.equal(data.color, null);
  });

  test('createKid rejects empty name', async () => {
    await assert.rejects(() => createKid({ name: '   ' }), /name/);
  });

  test('updateKid only sets provided fields', async () => {
    const calls: any[] = [];
    mockModel(prisma, 'kidProfile', {
      update: async (args: any) => {
        calls.push(args);
        return { id: 'kid-1', name: 'น้องน้ำ', age: 8, emoji: '👧', color: null };
      },
    });
    await updateKid('kid-1', { age: 8, emoji: '👧' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].where.id, 'kid-1');
    assert.equal(calls[0].data.age, 8);
    assert.equal(calls[0].data.emoji, '👧');
    assert.equal(calls[0].data.name, undefined, 'ไม่แก้ชื่อถ้าไม่ส่ง');
  });

  test('listKids returns profiles', async () => {
    mockModel(prisma, 'kidProfile', {
      findMany: async () => [{ id: 'kid-1', name: 'น้องน้ำ' }, { id: 'kid-2', name: 'น้องฟ้า' }],
    });
    const kids = await listKids();
    assert.equal(kids.length, 2);
    assert.equal(kids[1].name, 'น้องฟ้า');
  });

  test('deleteKid removes by id', async () => {
    const calls: any[] = [];
    mockModel(prisma, 'kidProfile', {
      delete: async (args: any) => {
        calls.push(args);
        return { id: 'kid-1' };
      },
    });
    await deleteKid('kid-1');
    assert.equal(calls[0].where.id, 'kid-1');
  });
});

describe('kid lesson progress', () => {
  test('recordLessonProgress saves score after validating kid exists', async () => {
    mockModel(prisma, 'kidProfile', {
      findUnique: async ({ where }: any) => (where.id === 'kid-1' ? { id: 'kid-1' } : null),
    });
    let data: any = null;
    mockModel(prisma, 'kidLessonProgress', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'p-1', ...args.data };
      },
    });
    const res = await recordLessonProgress('kid-1', {
      lessonTitle: 'ผจญภัยในระบบสุริยะ',
      score: 3,
      total: 4,
      lessonItemId: 'item-9',
    });
    assert.equal(res.id, 'p-1');
    assert.equal(data.kid_id, 'kid-1');
    assert.equal(data.lesson_title, 'ผจญภัยในระบบสุริยะ');
    assert.equal(data.score, 3);
    assert.equal(data.total, 4);
    assert.equal(data.lesson_item_id, 'item-9');
  });

  test('recordLessonProgress rejects unknown kid and bad score', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => null });
    await assert.rejects(
      () => recordLessonProgress('nope', { lessonTitle: 'x', score: 1, total: 2 }),
      /kid/i
    );
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    await assert.rejects(
      () => recordLessonProgress('kid-1', { lessonTitle: 'x', score: 5, total: 0 }),
      /total/
    );
  });

  test('kidStats aggregates attempts, best and average', async () => {
    mockModel(prisma, 'kidLessonProgress', {
      findMany: async ({ where }: any) => {
        assert.equal(where.kid_id, 'kid-1');
        return [
          { lesson_title: 'a', score: 3, total: 4 },
          { lesson_title: 'b', score: 2, total: 2 },
          { lesson_title: 'c', score: 1, total: 5 },
        ];
      },
    });
    const stats = await kidStats('kid-1');
    assert.equal(stats.attempts, 3);
    assert.equal(stats.best, 100); // 2/2
    assert.equal(stats.totalCorrect, 6);
    assert.equal(stats.totalQuestions, 11);
    assert.equal(stats.avg, Math.round((6 / 11) * 100));
  });

  test('kidStats returns zeros when no progress', async () => {
    mockModel(prisma, 'kidLessonProgress', { findMany: async () => [] });
    const stats = await kidStats('kid-1');
    assert.equal(stats.attempts, 0);
    assert.equal(stats.best, null);
    assert.equal(stats.avg, null);
  });
});

// ────────────────────────────────────────────────
// หน้าที่ของลูก: งานบ้าน + บิล + กระเป๋าเงิน
// ────────────────────────────────────────────────
describe('chores (งานบ้าน)', () => {
  const kidExists = { findUnique: async ({ where }: any) => (where.id === 'kid-1' ? { id: 'kid-1' } : null) };

  test('addChore validates reward and saves', async () => {
    mockModel(prisma, 'kidProfile', kidExists);
    let data: any = null;
    mockModel(prisma, 'kidChore', {
      create: async (args: any) => { data = args.data; return { id: 'c-1', ...args.data }; },
    });
    const res = await addChore('kid-1', { title: '  กวาดบ้าน  ', reward: 10, emoji: '🧹' });
    assert.equal(res.id, 'c-1');
    assert.equal(data.kid_id, 'kid-1');
    assert.equal(data.title, 'กวาดบ้าน');
    assert.equal(data.reward, 10);
    assert.equal(data.status, 'pending');
  });

  test('addChore rejects bad reward', async () => {
    await assert.rejects(() => addChore('kid-1', { title: 'x', reward: 0 }), /reward/);
    await assert.rejects(() => addChore('kid-1', { title: 'x', reward: -5 }), /reward/);
  });

  test('completeChore is idempotent and credits wallet once', async () => {
    mockModel(prisma, 'kidProfile', kidExists);
    let choreState: any = { id: 'c-1', kid_id: 'kid-1', title: 'กวาดบ้าน', reward: 10, status: 'pending' };
    mockModel(prisma, 'kidChore', {
      findUnique: async () => choreState,
      update: async ({ data }: any) => { choreState = { ...choreState, ...data }; return choreState; },
    });
    const txs: any[] = [];
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { txs.push(args.data); return { id: 't', ...args.data }; },
      aggregate: async () => ({ _sum: { amount: 10 } }),
    });
    mockModel(prisma, 'kidProfile', { update: async (args: any) => ({ id: args.where.id }) });
    mockModel(prisma, 'kidCertificate', { create: async () => ({ id: 'c-1' }) });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    setNotifySender(async () => {});
    await completeChore('kid-1', 'c-1');
    await completeChore('kid-1', 'c-1'); // ทำซ้ำ → ไม่เพิ่มเงินอีก
    assert.equal(txs.length, 1, 'ทำงานซ้ำต้องไม่ได้เงินซ้ำ');
    assert.equal(txs[0].amount, 10);
    assert.equal(txs[0].category, 'chore');
  });

  test('completeChore rejects unknown kid/chore', async () => {
    mockModel(prisma, 'kidProfile', kidExists);
    mockModel(prisma, 'kidChore', { findUnique: async () => null });
    await assert.rejects(() => completeChore('kid-1', 'nope'), /chore/);
  });

  test('reopenChore resets to pending', async () => {
    mockModel(prisma, 'kidChore', {
      update: async (args: any) => ({ ...args.data }),
    });
    const res = await reopenChore('kid-1', 'c-1');
    assert.equal(res.status, 'pending');
    assert.equal(res.completed_at, null);
  });

  test('deleteChore removes by id', async () => {
    const calls: any[] = [];
    mockModel(prisma, 'kidChore', { delete: async (args: any) => { calls.push(args); return {}; } });
    await deleteChore('kid-1', 'c-9');
    assert.equal(calls[0].where.id, 'c-9');
  });
});

describe('bills (ค่าไฟ/น้ำ/ห้อง)', () => {
  const kidExists = { findUnique: async ({ where }: any) => (where.id === 'kid-1' ? { id: 'kid-1' } : null) };

  test('addBill validates amount and saves', async () => {
    mockModel(prisma, 'kidProfile', kidExists);
    let data: any = null;
    mockModel(prisma, 'kidBill', {
      create: async (args: any) => { data = args.data; return { id: 'b-1', ...args.data }; },
    });
    const res = await addBill('kid-1', { title: 'ค่าไฟ', amount: 50, emoji: '⚡', period: 'monthly' });
    assert.equal(res.id, 'b-1');
    assert.equal(data.amount, 50);
    assert.equal(data.status, 'unpaid');
  });

  test('addBill rejects non-positive amount', async () => {
    await assert.rejects(() => addBill('kid-1', { title: 'ค่าไฟ', amount: 0 }), /amount/);
  });

  test('payBill is idempotent and debits wallet once', async () => {
    mockModel(prisma, 'kidProfile', kidExists);
    let billState: any = { id: 'b-1', kid_id: 'kid-1', title: 'ค่าไฟ', amount: 50, status: 'unpaid' };
    mockModel(prisma, 'kidBill', {
      findUnique: async () => billState,
      update: async ({ data }: any) => { billState = { ...billState, ...data }; return billState; },
    });
    const txs: any[] = [];
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { txs.push(args.data); return { id: 't', ...args.data }; },
    });
    await payBill('kid-1', 'b-1');
    await payBill('kid-1', 'b-1'); // จ่ายซ้ำ → ไม่หักซ้ำ
    assert.equal(txs.length, 1);
    assert.equal(txs[0].amount, -50);
    assert.equal(txs[0].category, 'bill');
  });

  test('deleteBill removes by id', async () => {
    const calls: any[] = [];
    mockModel(prisma, 'kidBill', { delete: async (args: any) => { calls.push(args); return {}; } });
    await deleteBill('kid-1', 'b-9');
    assert.equal(calls[0].where.id, 'b-9');
  });
});

describe('wallet (กระเป๋าเงิน)', () => {
  test('walletBalance sums transactions', async () => {
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async ({ where }: any) => {
        assert.equal(where.kid_id, 'kid-1');
        return { _sum: { amount: 25 } };
      },
    });
    assert.equal(await walletBalance('kid-1'), 25);
  });

  test('addWalletMoney validates and records manual tx', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    let data: any = null;
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { data = args.data; return { id: 't', ...args.data }; },
    });
    await addWalletMoney('kid-1', 20, 'เงินค่าแป้ง');
    assert.equal(data.amount, 20);
    assert.equal(data.category, 'manual');
    await assert.rejects(() => addWalletMoney('kid-1', 0), /amount/);
  });

  test('kidHome aggregates chores, bills, coupons, balance and txs', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', name: 'น้องน้ำ', age: 7, emoji: '👧', color: null, allowance_day: 0, allowance_amount: 50, allowance_last_paid: null, pin_hash: null, savings_goal: null }) });
    mockModel(prisma, 'kidChore', { findMany: async () => [{ id: 'c-1', title: 'กวาดบ้าน', reward: 10, status: 'pending' }] });
    mockModel(prisma, 'kidBill', { findMany: async () => [{ id: 'b-1', title: 'ค่าไฟ', amount: 50, status: 'unpaid' }] });
    mockModel(prisma, 'kidCoupon', { findMany: async () => [{ id: 'cp-1', title: 'เล่นเกม 30 นาที', cost: 50, status: 'available' }] });
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async () => ({ _sum: { amount: 30 } }),
      findMany: async () => [{ id: 't-1', amount: 10, note: 'กวาดบ้าน', category: 'chore' }],
    });
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async () => ({ _sum: { amount: 25 } }),
      findMany: async () => [{ id: 'p-1', amount: 25, note: 'ฝากเข้าถัง', created_at: new Date() }],
    });
    mockModel(prisma, 'kidInvestment', { findMany: async () => [] });
    mockModel(prisma, 'kidPortfolioSnapshot', { findMany: async () => [], findFirst: async () => null });
    mockModel(prisma, 'kidPortfolioDeposit', { findMany: async () => [], aggregate: async () => ({ _sum: { amount: 0 } }) });
    mockModel(prisma, 'kidCertificate', { findMany: async () => [] });
    const home = await kidHome('kid-1');
    assert.equal(home.kid.name, 'น้องน้ำ');
    assert.equal(home.kid.allowance_amount, 50);
    assert.equal(home.chores.length, 1);
    assert.equal(home.bills.length, 1);
    assert.equal(home.coupons.length, 1);
    assert.equal(home.balance, 30);
    assert.equal(home.piggy, 25);
    assert.equal(home.piggy_month, 25);
    assert.equal(home.txs.length, 1);
  });
});

describe('dashboardSummary', () => {
  test('aggregates per-kid quiz stats and wallet balance', async () => {
    mockModel(prisma, 'kidProfile', {
      findMany: async () => [
        { id: 'kid-1', name: 'น้องน้ำ', age: 7, emoji: '👧', color: null },
        { id: 'kid-2', name: 'น้องฟ้า', age: 10, emoji: '👦', color: null },
      ],
    });
    mockModel(prisma, 'kidLessonProgress', {
      findMany: async (args: any = {}) => {
        // dashboard: ไม่มี where (เอาแค่ล่าสุด); kidStats: where.kid_id
        if (!args.where?.kid_id) {
          assert.ok(args.orderBy?.completed_at === 'desc');
          assert.equal(args.take, 2);
        }
        return [{ kid_id: args.where?.kid_id || 'kid-1', lesson_title: 'ระบบสุริยะ', score: 4, total: 4, completed_at: new Date() }];
      },
    });
    mockModel(prisma, 'kidWalletTx', {
      groupBy: async () => [{ kid_id: 'kid-1', _sum: { amount: 40 } }],
    });
    mockModel(prisma, 'kidChore', { groupBy: async () => [] });
    mockModel(prisma, 'kidBill', { groupBy: async () => [] });
    mockModel(prisma, 'kidPiggyTx', { groupBy: async () => [] });
    mockModel(prisma, 'kidInvestment', { findMany: async () => [] });
    const sum = await dashboardSummary();
    assert.equal(sum.length, 2);
    assert.equal(sum[0].name, 'น้องน้ำ');
    assert.equal(sum[0].lastQuiz?.score, 4);
    assert.equal(sum[0].wallet, 40);
    assert.equal(sum[0].piggy, 0);
    assert.equal(sum[1].wallet, 0); // ไม่มีรายการ → 0
  });
});

describe('listOllamaModels', () => {
  test('parses model names from /api/tags', async () => {
    const models = await listOllamaModels({ post: async () => ({ data: { models: [{ name: 'gemma3:4b' }, { name: 'qwen3:8b' }, { name: 'nomic-embed-text:latest' }] } }) } as any);
    assert.deepEqual(models, ['gemma3:4b', 'qwen3:8b', 'nomic-embed-text:latest']);
  });

  test('returns empty list on failure', async () => {
    const models = await listOllamaModels({ post: async () => { throw new Error('down'); } } as any);
    assert.deepEqual(models, []);
  });
});

// ────────────────────────────────────────────────
// ค่าขนมรายสัปดาห์ (allowance)
// ────────────────────────────────────────────────
describe('weekly allowance (ค่าขนม)', () => {
  test('setAllowance validates day (0-6) and amount', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async ({ where }: any) => (where.id === 'kid-1' ? { id: 'kid-1' } : null) });
    await assert.rejects(() => setAllowance('kid-1', { day: 7, amount: 50 }), /day/);
    await assert.rejects(() => setAllowance('kid-1', { day: -1, amount: 50 }), /day/);
    await assert.rejects(() => setAllowance('kid-1', { day: 0, amount: 0 }), /amount/);
    await assert.rejects(() => setAllowance('nope', { day: 0, amount: 50 }), /kid/);
  });

  test('setAllowance saves day + amount', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    let data: any = null;
    mockModel(prisma, 'kidProfile', {
      update: async (args: any) => { data = args.data; return { id: 'kid-1', ...args.data }; },
    });
    const res = await setAllowance('kid-1', { day: 1, amount: 50 });
    assert.equal(data.allowance_day, 1);
    assert.equal(data.allowance_amount, 50);
    assert.equal(res.day, 1);
  });

  test('allowanceDueNow — not configured → never due', () => {
    assert.equal(allowanceDueNow({ id: 'k', allowance_day: null, allowance_amount: null, allowance_last_paid: null }, new Date('2026-08-12T10:00:00')), false);
    assert.equal(allowanceDueNow({ id: 'k', allowance_day: 0, allowance_amount: null, allowance_last_paid: null }, new Date('2026-08-12T10:00:00')), false);
  });

  test('allowanceDueNow — never paid → due on configured day', () => {
    // 2026-08-12 = วันพุธ (getDay() 3) — กำหนดจ่ายวันอาทิตย์ (0)
    const kid = { id: 'k', allowance_day: 0, allowance_amount: 50, allowance_last_paid: null };
    assert.equal(allowanceDueNow(kid, new Date('2026-08-12T10:00:00')), true);
  });

  test('allowanceDueNow — paid this week → skip, paid last week → due again', () => {
    // anchor = อาทิตย์ 2026-08-09
    const kid = { id: 'k', allowance_day: 0, allowance_amount: 50, allowance_last_paid: null };
    assert.equal(
      allowanceDueNow({ ...kid, allowance_last_paid: new Date('2026-08-09T08:00:00') }, new Date('2026-08-12T10:00:00')),
      false,
      'จ่ายแล้วในสัปดาห์นี้ → ไม่ต้องจ่ายซ้ำ'
    );
    assert.equal(
      allowanceDueNow({ ...kid, allowance_last_paid: new Date('2026-08-02T08:00:00') }, new Date('2026-08-12T10:00:00')),
      true,
      'จ่ายสัปดาห์ก่อน → ถึงกำหนดอีกครั้ง'
    );
  });

  test('allowanceDueNow — on the pay day itself, still due if not yet paid today', () => {
    // 2026-08-09 = อาทิตย์
    const kid = { id: 'k', allowance_day: 0, allowance_amount: 50, allowance_last_paid: null };
    assert.equal(allowanceDueNow(kid, new Date('2026-08-09T06:00:00')), true);
    assert.equal(
      allowanceDueNow({ ...kid, allowance_last_paid: new Date('2026-08-09T00:30:00') }, new Date('2026-08-09T06:00:00')),
      false
    );
  });

  test('payWeeklyAllowances pays each due kid once and stamps last_paid', async () => {
    const kids = [
      { id: 'kid-1', name: 'น้ำ', allowance_day: 0, allowance_amount: 50, allowance_last_paid: null },
      { id: 'kid-2', name: 'ฟ้า', allowance_day: 0, allowance_amount: 30, allowance_last_paid: new Date('2026-08-09T08:00:00') }, // จ่ายแล้ว
      { id: 'kid-3', name: 'ดิน', allowance_day: null, allowance_amount: null, allowance_last_paid: null }, // ไม่ได้ตั้ง
    ];
    mockModel(prisma, 'kidProfile', {
      findMany: async () => kids,
    });
    const txs: any[] = [];
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { txs.push(args.data); return { id: 't' }; },
    });
    const updates: any[] = [];
    mockModel(prisma, 'kidProfile', {
      update: async (args: any) => { updates.push(args); return args.data; },
    });
    const result = await payWeeklyAllowances(new Date('2026-08-12T10:00:00'));
    assert.equal(result.paid, 1);
    assert.equal(result.total, 50);
    assert.equal(txs.length, 1);
    assert.equal(txs[0].kid_id, 'kid-1');
    assert.equal(txs[0].amount, 50);
    assert.equal(txs[0].category, 'allowance');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].where.id, 'kid-1');
  });
});

// ────────────────────────────────────────────────
// คูปองรางวัล (reward coupons)
// ────────────────────────────────────────────────
describe('reward coupons (คูปองรางวัล)', () => {
  test('addCoupon validates title/cost and saves', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    let data: any = null;
    mockModel(prisma, 'kidCoupon', {
      create: async (args: any) => { data = args.data; return { id: 'cp-1', ...args.data }; },
    });
    const res = await addCoupon('kid-1', { title: '  เล่นเกม 30 นาที  ', cost: 50, emoji: '🎮' });
    assert.equal(res.id, 'cp-1');
    assert.equal(data.title, 'เล่นเกม 30 นาที');
    assert.equal(data.cost, 50);
    assert.equal(data.status, 'available');
    await assert.rejects(() => addCoupon('kid-1', { title: '', cost: 50 }), /title/);
    await assert.rejects(() => addCoupon('kid-1', { title: 'x', cost: 0 }), /cost/);
  });

  test('redeemCoupon deducts wallet and marks redeemed once', async () => {
    mockModel(prisma, 'kidCoupon', {
      findUnique: async () => ({ id: 'cp-1', kid_id: 'kid-1', title: 'เล่นเกม 30 นาที', cost: 50, status: 'available' }),
      update: async (args: any) => ({ id: 'cp-1', ...args.data }),
    });
    let txData: any = null;
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async () => ({ _sum: { amount: 100 } }),
      create: async (args: any) => { txData = args.data; return { id: 't' }; },
    });
    const res = await redeemCoupon('kid-1', 'cp-1');
    assert.equal(txData.amount, -50);
    assert.equal(txData.category, 'coupon');
    assert.equal(res.cost, 50);
  });

  test('redeemCoupon rejects when already redeemed or not enough balance', async () => {
    mockModel(prisma, 'kidCoupon', {
      findUnique: async () => ({ id: 'cp-2', kid_id: 'kid-1', title: 'x', cost: 50, status: 'redeemed' }),
    });
    await assert.rejects(() => redeemCoupon('kid-1', 'cp-2'), /redeemed/);
    mockModel(prisma, 'kidCoupon', {
      findUnique: async () => ({ id: 'cp-3', kid_id: 'kid-1', title: 'x', cost: 50, status: 'available' }),
    });
    mockModel(prisma, 'kidWalletTx', { aggregate: async () => ({ _sum: { amount: 10 } }) });
    await assert.rejects(() => redeemCoupon('kid-1', 'cp-3'), /enough/);
    mockModel(prisma, 'kidCoupon', { findUnique: async () => null });
    await assert.rejects(() => redeemCoupon('kid-1', 'nope'), /coupon/);
  });

  test('deleteCoupon removes by id', async () => {
    const calls: any[] = [];
    mockModel(prisma, 'kidCoupon', { delete: async (args: any) => { calls.push(args); return {}; } });
    await deleteCoupon('kid-1', 'cp-9');
    assert.equal(calls[0].where.id, 'cp-9');
  });
});

// ────────────────────────────────────────────────
// เก็บถาวรอัตโนมัติ — งาน/บิลที่จบแล้วเกิน 30 วัน
// ────────────────────────────────────────────────
describe('archiveOldItems (เก็บถาวร 30 วัน)', () => {
  const DAY = 86400000;

  test('archives done chores and paid bills older than 30 days', async () => {
    const now = new Date('2026-08-12T10:00:00');
    let choreWhere: any = null;
    let billWhere: any = null;
    mockModel(prisma, 'kidChore', {
      updateMany: async (args: any) => { choreWhere = args.where; return { count: 2 }; },
    });
    mockModel(prisma, 'kidBill', {
      updateMany: async (args: any) => { billWhere = args.where; return { count: 1 }; },
    });
    const res = await archiveOldItems(now);
    assert.equal(res.chores, 2);
    assert.equal(res.bills, 1);
    assert.equal(choreWhere.status, 'done');
    assert.equal(choreWhere.archived_at, null);
    assert.ok(choreWhere.completed_at.lt instanceof Date ? true : choreWhere.completed_at.lt);
    assert.ok(billWhere.status === 'paid');
  });

  test('kidHome hides archived items', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', name: 'น้ำ', age: 8, emoji: '👧', color: null, allowance_day: null, allowance_amount: null, allowance_last_paid: null, pin_hash: null, savings_goal: 100 }) });
    let choreWhere: any = null;
    let billWhere: any = null;
    mockModel(prisma, 'kidChore', { findMany: async (args: any) => { choreWhere = args.where; return []; } });
    mockModel(prisma, 'kidBill', { findMany: async (args: any) => { billWhere = args.where; return []; } });
    mockModel(prisma, 'kidCoupon', { findMany: async () => [] });
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async () => ({ _sum: { amount: 10 } }),
      findMany: async () => [],
    });
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async () => ({ _sum: { amount: 50 } }),
      findMany: async () => [{ id: 'p-1', amount: 50, note: 'ฝากเข้าถัง', created_at: new Date() }],
    });
    mockModel(prisma, 'kidInvestment', { findMany: async () => [] });
    mockModel(prisma, 'kidPortfolioSnapshot', { findMany: async () => [], findFirst: async () => null });
    mockModel(prisma, 'kidPortfolioDeposit', { findMany: async () => [], aggregate: async () => ({ _sum: { amount: 0 } }) });
    mockModel(prisma, 'kidCertificate', { findMany: async () => [] });
    const home = await kidHome('kid-1');
    assert.equal(choreWhere.archived_at, null, 'ไม่แสดงงานที่เก็บถาวร');
    assert.equal(billWhere.archived_at, null, 'ไม่แสดงบิลที่เก็บถาวร');
    assert.equal(home.piggy, 50);
    assert.equal(home.kid.savings_goal, 100);
    assert.equal(home.kid.has_pin, false);
  });
});

// ────────────────────────────────────────────────
// ถังสะสมแต้ม (piggy bank) + เป้าหมายออมรายเดือน
// ────────────────────────────────────────────────
describe('piggy bank (ถังสะสมแต้ม)', () => {
  test('piggyBalance sums piggy transactions', async () => {
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async () => ({ _sum: { amount: 30 } }),
    });
    assert.equal(await piggyBalance('kid-1'), 30);
  });

  test('monthlyPiggyIn sums only current month deposits', async () => {
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async ({ where }: any) => {
        assert.equal(where.kid_id, 'kid-1');
        assert.equal(where.amount.gt, 0);
        return { _sum: { amount: 80 } };
      },
    });
    assert.equal(await monthlyPiggyIn('kid-1', new Date('2026-08-12T10:00:00')), 80);
  });

  test('piggyTransfer deposits deduct wallet and credit piggy', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    const walletTxs: any[] = [];
    const piggyTxs: any[] = [];
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async () => ({ _sum: { amount: 100 } }),
      create: async (args: any) => { walletTxs.push(args.data); return { id: 'w' }; },
    });
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async () => ({ _sum: { amount: 0 } }),
      create: async (args: any) => { piggyTxs.push(args.data); return { id: 'p' }; },
    });
    await piggyTransfer('kid-1', 40, 'ฝากครั้งแรก');
    assert.equal(walletTxs.length, 1);
    assert.equal(walletTxs[0].amount, -40);
    assert.equal(walletTxs[0].category, 'piggy');
    assert.equal(piggyTxs[0].amount, 40);
    assert.equal(piggyTxs[0].note, 'ฝากครั้งแรก');
  });

  test('piggyTransfer rejects deposit when wallet cannot cover', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    mockModel(prisma, 'kidWalletTx', { aggregate: async () => ({ _sum: { amount: 10 } }) });
    await assert.rejects(() => piggyTransfer('kid-1', 40), /enough/);
  });

  test('piggyTransfer withdraw credits wallet', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    const walletTxs: any[] = [];
    const piggyTxs: any[] = [];
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { walletTxs.push(args.data); return { id: 'w' }; },
    });
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async () => ({ _sum: { amount: 50 } }),
      create: async (args: any) => { piggyTxs.push(args.data); return { id: 'p' }; },
    });
    await piggyTransfer('kid-1', -20, 'นับเหรียญแล้วเอาไปซื้อขนม');
    assert.equal(walletTxs[0].amount, 20);
    assert.equal(piggyTxs[0].amount, -20);
  });

  test('setSavingsGoal validates and saves monthly goal', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    let data: any = null;
    mockModel(prisma, 'kidProfile', {
      update: async (args: any) => { data = args.data; return { id: 'kid-1', ...args.data }; },
    });
    await setSavingsGoal('kid-1', 500);
    assert.equal(data.savings_goal, 500);
    await setSavingsGoal('kid-1', 0);
    assert.equal(data.savings_goal, null); // 0 = ปิดเป้าหมาย
    await assert.rejects(() => setSavingsGoal('kid-1', -5), /goal/);
  });
});

// ────────────────────────────────────────────────
// PIN ส่วนตัวของลูก — บังคับก่อนทำงานเสร็จ/แลกคูปอง
// ────────────────────────────────────────────────
describe('kid PIN (รหัสลับของลูก)', () => {
  test('setKidPin hashes, clears and validates 4-6 digits', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    let data: any = null;
    mockModel(prisma, 'kidProfile', {
      update: async (args: any) => { data = args.data; return { id: 'kid-1', ...args.data }; },
    });
    await setKidPin('kid-1', '1234');
    assert.ok(data.pin_hash && data.pin_hash !== '1234', 'ต้องเก็บเป็น hash ไม่ใช่ PIN ตรงๆ');
    assert.ok(data.pin_hash.startsWith('$2'));
    // ล้าง PIN
    data = null;
    await setKidPin('kid-1', '');
    assert.equal(data.pin_hash, null);
    // ฟอร์แมตไม่ถูก
    await assert.rejects(() => setKidPin('kid-1', '123'), /PIN/);
    await assert.rejects(() => setKidPin('kid-1', 'abc'), /PIN/);
  });

  test('verifyKidPin compares against hash', async () => {
    mockModel(prisma, 'kidProfile', {
      findUnique: async ({ where }: any) => (where.id === 'kid-1' ? { id: 'kid-1', pin_hash: '$2a$10$dummyhashvalue' } : { id: 'kid-1', pin_hash: null }),
    });
    assert.equal(await verifyKidPin('nope', '1234'), false);
    assert.equal(await verifyKidPin('kid-2', '1234'), false); // ไม่มี PIN → false
  });

  test('completeChore enforces PIN when set', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', pin_hash: 'hashed' }) });
    mockModel(prisma, 'kidChore', {
      findUnique: async () => ({ id: 'c-1', kid_id: 'kid-1', title: 'กวาดบ้าน', reward: 10, status: 'pending' }),
    });
    await assert.rejects(() => completeChore('kid-1', 'c-1', ''), /PIN/i);
    await assert.rejects(() => completeChore('kid-1', 'c-1', '0000'), /PIN/i);
  });

  test('completeChore works without PIN when none set', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', pin_hash: null }) });
    mockModel(prisma, 'kidChore', {
      findUnique: async () => ({ id: 'c-1', kid_id: 'kid-1', title: 'กวาดบ้าน', reward: 10, status: 'pending' }),
      update: async (args: any) => ({ id: 'c-1', ...args.data }),
    });
    mockModel(prisma, 'kidWalletTx', { create: async () => ({ id: 't' }) });
    const res = await completeChore('kid-1', 'c-1');
    assert.equal(res.reward, 10);
  });
});

// ────────────────────────────────────────────────
// จ่ายค่าขนมย้อนหลัง + ประวัติ
// ────────────────────────────────────────────────
describe('allowance history + manual pay', () => {
  test('payAllowanceNow pays a due kid and stamps last_paid', async () => {
    mockModel(prisma, 'kidProfile', {
      findUnique: async () => ({ id: 'kid-1', name: 'น้ำ', allowance_day: 3, allowance_amount: 40, allowance_last_paid: new Date('2026-08-05T08:00:00') }),
      update: async (args: any) => ({ ...args.data }),
    });
    let tx: any = null;
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { tx = args.data; return { id: 't' }; },
    });
    const res = await payAllowanceNow('kid-1', new Date('2026-08-12T10:00:00'));
    assert.equal(res.paid, true);
    assert.equal(res.amount, 40);
    assert.equal(tx.category, 'allowance');
  });

  test('payAllowanceNow skips when already paid this week', async () => {
    mockModel(prisma, 'kidProfile', {
      findUnique: async () => ({ id: 'kid-1', allowance_day: 3, allowance_amount: 40, allowance_last_paid: new Date('2026-08-12T08:00:00') }),
    });
    const res = await payAllowanceNow('kid-1', new Date('2026-08-12T10:00:00'));
    assert.equal(res.paid, false);
    assert.equal(res.amount, null);
  });

  test('allowanceHistory returns per-kid settings + allowance txs', async () => {
    mockModel(prisma, 'kidProfile', { findMany: async () => [{ id: 'kid-1', name: 'น้ำ', emoji: '👧', allowance_day: 3, allowance_amount: 40 }] });
    mockModel(prisma, 'kidWalletTx', {
      findMany: async () => [{ id: 't-1', amount: 40, note: 'ค่าขนมรายสัปดาห์ (พุธ)', category: 'allowance', created_at: new Date() }],
    });
    const hist = await allowanceHistory();
    assert.equal(hist.length, 1);
    assert.equal(hist[0].name, 'น้ำ');
    assert.equal(hist[0].allowance_amount, 40);
    assert.equal(hist[0].txs.length, 1);
    assert.equal(hist[0].txs[0].amount, 40);
  });
});

// ────────────────────────────────────────────────
// สรุปประจำวันส่ง Telegram
// ────────────────────────────────────────────────
describe('daily summary (สรุปประจำวัน)', () => {
  test('buildDailySummary aggregates 24h activity per kid', async () => {
    mockModel(prisma, 'kidProfile', { findMany: async () => [{ id: 'kid-1', name: 'น้ำ', emoji: '👧' }] });
    mockModel(prisma, 'kidChore', { count: async () => 2 });
    mockModel(prisma, 'kidBill', { count: async () => 1 });
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async ({ where }: any) => {
        if (where.category === 'chore') return { _sum: { amount: 25 } };
        return { _sum: { amount: 0 } };
      },
    });
    mockModel(prisma, 'kidPiggyTx', { aggregate: async () => ({ _sum: { amount: 40 } }) });
    const s = await buildDailySummary(new Date('2026-08-12T18:00:00'));
    assert.equal(s.kids.length, 1);
    assert.equal(s.kids[0].choresDone, 2);
    assert.equal(s.kids[0].choresReward, 25);
    assert.equal(s.kids[0].billsPaid, 1);
    assert.equal(s.kids[0].wallet, 0);
    assert.equal(s.kids[0].piggy, 40);
  });

  test('formatDailySummary includes name, work done, balances and piggy', () => {
    const text = formatDailySummary({
      kids: [
        { id: 'kid-1', name: 'น้องน้ำ', emoji: '👧', choresDone: 3, choresReward: 45, billsPaid: 1, wallet: 120, piggy: 200 },
        { id: 'kid-2', name: 'น้องฟ้า', emoji: '🧒', choresDone: 0, choresReward: 0, billsPaid: 0, wallet: 5, piggy: 0 },
      ],
      generatedAt: new Date('2026-08-12T18:00:00'),
    });
    assert.ok(text.includes('น้องน้ำ'));
    assert.ok(text.includes('3'));
    assert.ok(text.includes('45'));
    assert.ok(text.includes('120'));
    assert.ok(text.includes('200'));
    assert.ok(text.includes('น้องฟ้า'));
  });
});

// ────────────────────────────────────────────────
// งานบ้านรายวัน (เช็กลิสต์ที่รีเซ็ตเองตอนเช้า)
// ────────────────────────────────────────────────
describe('daily chores (งานบ้านรายวัน)', () => {
  test('resetDailyChores resets daily chores done before today', async () => {
    let where: any = null;
    let data: any = null;
    mockModel(prisma, 'kidChore', {
      updateMany: async (args: any) => { where = args.where; data = args.data; return { count: 3 }; },
    });
    const res = await resetDailyChores(new Date('2026-08-12T07:00:00'));
    assert.equal(res.reset, 3);
    assert.equal(where.repeat, 'daily');
    assert.equal(where.status, 'done');
    assert.equal(data.status, 'pending');
    assert.equal(data.completed_at, null);
    assert.ok(where.completed_at.lt instanceof Date);
  });

  test('addChore saves repeat flag (daily/none)', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    let data: any = null;
    mockModel(prisma, 'kidChore', {
      create: async (args: any) => { data = args.data; return { id: 'c-1', ...args.data }; },
    });
    await addChore('kid-1', { title: 'กวาดบ้าน', reward: 10, repeat: 'daily' });
    assert.equal(data.repeat, 'daily');
    await addChore('kid-1', { title: 'ล้างห้องน้ำ', reward: 20 });
    assert.equal(data.repeat, 'none');
  });
});

// ────────────────────────────────────────────────
// เป้าหมายระยะยาวของถังสะสมแต้ม + ETA
// ────────────────────────────────────────────────
describe('piggy long-term target (เป้าหมายถังระยะยาว)', () => {
  test('setPiggyTarget validates title+amount and saves', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    let data: any = null;
    mockModel(prisma, 'kidProfile', {
      update: async (args: any) => { data = args.data; return { ...args.data }; },
    });
    await setPiggyTarget('kid-1', { title: 'ซื้อจักรยาน', amount: 500 });
    assert.equal(data.piggy_target_title, 'ซื้อจักรยาน');
    assert.equal(data.piggy_target_amount, 500);
    // ล้าง
    await setPiggyTarget('kid-1', { title: '', amount: 0 });
    assert.equal(data.piggy_target_amount, null);
    await assert.rejects(() => setPiggyTarget('kid-1', { title: '', amount: 500 }), /title/);
    await assert.rejects(() => setPiggyTarget('kid-1', { title: 'x', amount: -1 }), /amount/);
  });

  test('piggyEta estimates months remaining from 30-day deposit rate', async () => {
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async ({ where }: any) => {
        if (where.amount != null) return { _sum: { amount: 90 } }; // 30 วัน ฝาก 90 → เดือนละ 90
        return { _sum: { amount: 50 } }; // ยอดในถัง 50
      },
    });
    const eta = await piggyEta('kid-1', 200, new Date('2026-08-12T10:00:00'));
    assert.equal(eta.monthlyRate, 90);
    assert.equal(eta.months, 2); // (200-50)/90 → 2 เดือน
  });

  test('piggyEta returns null months when no deposits or already reached', async () => {
    mockModel(prisma, 'kidPiggyTx', {
      aggregate: async ({ where }: any) => {
        if (where.amount != null) return { _sum: { amount: 0 } };
        return { _sum: { amount: 300 } };
      },
    });
    const eta = await piggyEta('kid-1', 200);
    assert.equal(eta.months, null);
  });
});

// ────────────────────────────────────────────────
// หุ้นจำลองของบ้าน (สอนการลงทุน)
// ────────────────────────────────────────────────
describe('kid stocks (หุ้นจำลองของบ้าน)', () => {
  test('STOCK_CATALOG has household-themed symbols', () => {
    const syms = STOCK_CATALOG.map((s) => s.symbol);
    assert.ok(syms.includes('WATER'));
    assert.ok(syms.includes('SOLAR'));
    assert.ok(syms.includes('FARM'));
  });

  test('stockPrice is deterministic per date and positive', () => {
    const d = new Date('2026-08-12T10:00:00');
    const p1 = stockPrice('WATER', d);
    const p2 = stockPrice('WATER', d);
    assert.equal(p1, p2, 'ราคาวันเดียวกันต้องเท่ากัน');
    assert.ok(p1 > 0);
    assert.ok(STOCK_CATALOG.every((s) => stockPrice(s.symbol, d) > 0));
  });

  test('buyStock deducts wallet and records holding with avg cost', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async () => ({ _sum: { amount: 500 } }),
      create: async (args: any) => { txData = args.data; return { id: 't' }; },
    });
    let txData: any = null;
    mockModel(prisma, 'kidInvestment', {
      findUnique: async () => null,
      create: async (args: any) => ({ id: 'i-1', ...args.data }),
    });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    const price = stockPrice('FARM');
    const res = await buyStock('kid-1', 'FARM', 2);
    assert.equal(res.symbol, 'FARM');
    assert.equal(res.units, 2);
    assert.equal(txData.category, 'stock');
    assert.equal(txData.amount, -Math.round(2 * price));
  });

  test('buyStock rejects insufficient funds and unknown symbol', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    mockModel(prisma, 'kidWalletTx', { aggregate: async () => ({ _sum: { amount: 1 } }) });
    await assert.rejects(() => buyStock('kid-1', 'FARM', 2), /enough/);
    await assert.rejects(() => buyStock('kid-1', 'NOPE', 2), /symbol/);
  });

  test('sellStock credits wallet and reduces units', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    mockModel(prisma, 'kidInvestment', {
      findUnique: async () => ({ id: 'i-1', kid_id: 'kid-1', symbol: 'FARM', units: 5, avg_cost: 30 }),
      update: async (args: any) => ({ id: 'i-1', ...args.data }),
    });
    let txData: any = null;
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { txData = args.data; return { id: 't' }; },
    });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    const price = stockPrice('FARM');
    const res = await sellStock('kid-1', 'FARM', 2);
    assert.equal(res.units, 3);
    assert.equal(txData.amount, Math.round(2 * price));
    assert.equal(txData.category, 'stock');
  });

  test('stockPortfolio computes value and profit for holdings', async () => {
    mockModel(prisma, 'kidInvestment', {
      findMany: async () => [
        { symbol: 'FARM', units: 2, avg_cost: 30 },
        { symbol: 'WATER', units: 1, avg_cost: 50 },
      ],
    });
    const port = await stockPortfolio('kid-1');
    assert.equal(port.holdings.length, 2);
    assert.equal(port.value, Math.round((stockPrice('FARM') * 2 + stockPrice('WATER')) * 100) / 100);
    assert.ok(port.totalCost > 0);
  });
});

// ────────────────────────────────────────────────
// audit log — ประวัติการแลกคูปอง/PIN/ทำงาน/จ่ายบิล
// ────────────────────────────────────────────────
describe('kid audit log', () => {
  test('redeemCoupon writes audit entry', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', pin_hash: null }) });
    mockModel(prisma, 'kidCoupon', {
      findUnique: async () => ({ id: 'cp-1', kid_id: 'kid-1', title: 'เล่นเกม 30 นาที', cost: 50, status: 'available' }),
      update: async (args: any) => ({ ...args.data }),
    });
    mockModel(prisma, 'kidWalletTx', { aggregate: async () => ({ _sum: { amount: 100 } }), create: async () => ({ id: 't' }) });
    let audit: any = null;
    mockModel(prisma, 'kidAuditLog', {
      create: async (args: any) => { audit = args.data; return { id: 'a' }; },
    });
    await redeemCoupon('kid-1', 'cp-1');
    assert.equal(audit.action, 'coupon_redeem');
    assert.equal(audit.kid_id, 'kid-1');
    assert.ok(audit.detail.includes('เล่นเกม 30 นาที'));
  });

  test('completeChore writes audit entry', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', pin_hash: null }) });
    mockModel(prisma, 'kidChore', {
      findUnique: async () => ({ id: 'c-1', kid_id: 'kid-1', title: 'กวาดบ้าน', reward: 10, status: 'pending' }),
      update: async (args: any) => ({ ...args.data }),
    });
    mockModel(prisma, 'kidWalletTx', { create: async () => ({ id: 't' }) });
    let audit: any = null;
    mockModel(prisma, 'kidAuditLog', {
      create: async (args: any) => { audit = args.data; return { id: 'a' }; },
    });
    await completeChore('kid-1', 'c-1');
    assert.equal(audit.action, 'chore_complete');
    assert.ok(audit.detail.includes('กวาดบ้าน'));
  });

  test('setKidPin writes pin_set and pin_clear entries', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    mockModel(prisma, 'kidProfile', { update: async (args: any) => ({ ...args.data }) });
    const actions: string[] = [];
    mockModel(prisma, 'kidAuditLog', {
      create: async (args: any) => { actions.push(args.data.action); return { id: 'a' }; },
    });
    await setKidPin('kid-1', '1234');
    await setKidPin('kid-1', '');
    assert.deepEqual(actions, ['pin_set', 'pin_clear']);
  });

  test('kidAuditLog returns recent rows', async () => {
    mockModel(prisma, 'kidAuditLog', {
      findMany: async (args: any) => {
        assert.equal(args.where.kid_id, 'kid-1');
        return [{ id: 'a-1', action: 'chore_complete', detail: 'กวาดบ้าน', actor: 'kid' }];
      },
    });
    const rows = await kidAuditLog('kid-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'chore_complete');
  });
});

// ────────────────────────────────────────────────
// รายงานรายสัปดาห์ + การแจ้งเตือนงานค้าง/บิลค้าง
// ────────────────────────────────────────────────
describe('weeklyReport + dashboard alerts', () => {
  test('weeklyReport returns per-kid data within the window', async () => {
    mockModel(prisma, 'kidProfile', { findMany: async () => [{ id: 'kid-1', name: 'น้ำ', age: 8, emoji: '👧', color: null, allowance_day: 0, allowance_amount: 50 }] });
    mockModel(prisma, 'kidLessonProgress', { findMany: async () => [{ lesson_title: 'ระบบสุริยะ', score: 4, total: 4, completed_at: new Date() }] });
    mockModel(prisma, 'kidChore', { findMany: async () => [{ title: 'กวาดบ้าน', reward: 10, status: 'done' }] });
    mockModel(prisma, 'kidBill', { findMany: async () => [{ title: 'ค่าไฟ', amount: 50, status: 'unpaid' }] });
    mockModel(prisma, 'kidWalletTx', {
      aggregate: async () => ({ _sum: { amount: 40 } }),
      findMany: async () => [{ amount: 10, note: 'กวาดบ้าน', category: 'chore' }],
    });
    const report = await weeklyReport(7);
    assert.equal(report.length, 1);
    assert.equal(report[0].name, 'น้ำ');
    assert.equal(report[0].progress.length, 1);
    assert.equal(report[0].chores.length, 1);
    assert.equal(report[0].bills.length, 1);
    assert.equal(report[0].balance, 40);
    assert.equal(report[0].stats.attempts, 1); // kidStats ใช้ mock เดียวกัน → 1 แถว
  });

  test('dashboardSummary includes pending chores and unpaid bills counts', async () => {
    mockModel(prisma, 'kidProfile', {
      findMany: async () => [{ id: 'kid-1', name: 'น้ำ', age: 8, emoji: '👧', color: null }],
    });
    mockModel(prisma, 'kidLessonProgress', { findMany: async () => [] });
    mockModel(prisma, 'kidWalletTx', { groupBy: async () => [] });
    mockModel(prisma, 'kidChore', { groupBy: async () => [{ kid_id: 'kid-1', _count: 2 }] });
    mockModel(prisma, 'kidBill', { groupBy: async () => [{ kid_id: 'kid-1', _count: 1 }] });
    mockModel(prisma, 'kidPiggyTx', { groupBy: async () => [] });
    mockModel(prisma, 'kidInvestment', { findMany: async () => [] });
    const sum = await dashboardSummary();
    assert.equal(sum[0].pendingChores, 2);
    assert.equal(sum[0].unpaidBills, 1);
  });
});

describe('generateLesson options (quizCount + model)', () => {
  const good = JSON.stringify({ title: 't', sections: [{ heading: 'h', content: 'c' }], quiz: [{ question: 'q', options: ['a', 'b'], answer: 0 }] });

  test('passes selected model and quizCount into the Ollama call', async () => {
    let body: any = null;
    const post = async (_url: string, b: unknown, _o?: any) => { body = b; return { data: { response: good } }; };
    await generateLesson('น้ำ', '6-8', { search: async () => [], post }, { model: 'qwen3:8b', quizCount: 8 });
    assert.equal(body.model, 'qwen3:8b');
    assert.match(String(body.prompt), /8/);
    assert.match(String(body.prompt), /แบบทดสอบ/);
  });

  test('defaults to AI_MODEL when model not given', async () => {
    let body: any = null;
    const post = async (_url: string, b: unknown, _o?: any) => { body = b; return { data: { response: good } }; };
    await generateLesson('น้ำ', '6-8', { search: async () => [], post }, {});
    assert.equal(body.model, process.env.AI_MODEL || 'gemma3:4b');
  });
});

// ────────────────────────────────────────────────
// ระดับ/ดาว + XP + เกียรติบัตรอัตโนมัติ
// ────────────────────────────────────────────────
describe('kid level & certificates (ระดับ/ดาว + เกียรติบัตร)', () => {
  test('kidLevel thresholds use triangular XP curve', () => {
    assert.equal(kidLevel(0), 1);
    assert.equal(kidLevel(99), 1);
    assert.equal(kidLevel(100), 2);
    assert.equal(kidLevel(299), 2);
    assert.equal(kidLevel(300), 3);
    assert.equal(kidLevel(1000), 5);
  });

  test('recordLessonProgress grants XP = score * 10', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', xp: 0 }) });
    mockModel(prisma, 'kidLessonProgress', { create: async () => ({ id: 'p-1' }) });
    let updatedXp: any = null;
    mockModel(prisma, 'kidProfile', { update: async (args: any) => { updatedXp = args.data.xp; return { id: args.where.id }; } });
    mockModel(prisma, 'kidCertificate', { create: async () => ({ id: 'c-1' }) });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a-1' }) });
    await recordLessonProgress('kid-1', { lessonTitle: 'ระบบสุริยะ', score: 6, total: 6 });
    assert.deepEqual(updatedXp, { increment: 60 });
  });

  test('completeChore grants XP = reward', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', xp: 0 }) });
    mockModel(prisma, 'kidChore', {
      findUnique: async () => ({ id: 'c-1', kid_id: 'kid-1', title: 'กวาดบ้าน', reward: 15, status: 'pending' }),
      update: async (args: any) => ({ ...args.data }),
    });
    mockModel(prisma, 'kidWalletTx', { create: async () => ({ id: 't' }) });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    let updatedXp: any = null;
    mockModel(prisma, 'kidProfile', { update: async (args: any) => { updatedXp = args.data.xp; return { id: args.where.id }; } });
    mockModel(prisma, 'kidCertificate', { create: async () => ({ id: 'c-1' }) });
    mockModel(prisma, 'kidWalletTx', { aggregate: async () => ({ _sum: { amount: 0 } }) });
    setNotifySender(async () => {});
    await completeChore('kid-1', 'c-1');
    assert.deepEqual(updatedXp, { increment: 15 });
  });

  test('level-up auto-creates a certificate + audit entry', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', xp: 95, name: 'น้ำ' }) });
    mockModel(prisma, 'kidLessonProgress', { create: async () => ({ id: 'p-1' }) });
    mockModel(prisma, 'kidProfile', { update: async (args: any) => ({ id: args.where.id }) });
    let cert: any = null;
    mockModel(prisma, 'kidCertificate', { create: async (args: any) => { cert = args.data; return { id: 'c-1' }; } });
    const audits: any[] = [];
    mockModel(prisma, 'kidAuditLog', { create: async (args: any) => { audits.push(args.data); return { id: 'a' }; } });
    setNotifySender(async () => {});
    await recordLessonProgress('kid-1', { lessonTitle: 'ระบบสุริยะ', score: 6, total: 6 }); // xp 95 → 155 → level 2
    assert.ok(cert, 'certificate should be created on level-up');
    assert.equal(cert.level, 2);
    assert.ok(String(cert.title).includes('2'));
    assert.ok(audits.some((a) => a.action === 'level_up'));
  });

  test('no certificate when level unchanged', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', xp: 10, name: 'น้ำ' }) });
    mockModel(prisma, 'kidLessonProgress', { create: async () => ({ id: 'p-1' }) });
    mockModel(prisma, 'kidProfile', { update: async (args: any) => ({ id: args.where.id }) });
    let created = false;
    mockModel(prisma, 'kidCertificate', { create: async () => { created = true; return { id: 'c-1' }; } });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    setNotifySender(async () => {});
    await recordLessonProgress('kid-1', { lessonTitle: 'ระบบสุริยะ', score: 6, total: 6 }); // xp 10 → 70 → still level 1
    assert.equal(created, false);
  });

  test('listCertificates returns rows newest first', async () => {
    mockModel(prisma, 'kidCertificate', {
      findMany: async (args: any) => {
        assert.equal(args.where.kid_id, 'kid-1');
        return [{ id: 'c-1', level: 2, title: 'เกียรติบัตรระดับ 2' }];
      },
    });
    const rows = await listCertificates('kid-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, 2);
  });
});

// ────────────────────────────────────────────────
// พอร์ตหุ้นย้อนหลัง + เงินจริง/นโยบายลงทุน
// ────────────────────────────────────────────────
describe('portfolio history + money mode', () => {
  test('recordPortfolioSnapshot creates a snapshot row', async () => {
    mockModel(prisma, 'kidProfile', { findMany: async () => [{ id: 'kid-1' }] });
    mockModel(prisma, 'kidInvestment', { findMany: async () => [] });
    let created = false;
    mockModel(prisma, 'kidPortfolioSnapshot', {
      findFirst: async () => null,
      create: async () => { created = true; return { id: 's-1' }; },
    });
    await recordPortfolioSnapshot('kid-1');
    assert.equal(created, true);
  });

  test('recordPortfolioSnapshot updates today existing snapshot instead of duplicating', async () => {
    mockModel(prisma, 'kidProfile', { findMany: async () => [{ id: 'kid-1' }] });
    mockModel(prisma, 'kidInvestment', { findMany: async () => [] });
    let updated = false;
    mockModel(prisma, 'kidPortfolioSnapshot', {
      findFirst: async () => ({ id: 's-1' }),
      create: async () => { assert.fail('should not create'); },
      update: async () => { updated = true; return { id: 's-1' }; },
    });
    await recordPortfolioSnapshot('kid-1');
    assert.equal(updated, true);
  });

  test('portfolioHistory returns daily values', async () => {
    mockModel(prisma, 'kidPortfolioSnapshot', {
      findMany: async (args: any) => {
        assert.equal(args.where.kid_id, 'kid-1');
        return [{ value: 100, created_at: new Date('2026-08-10T10:00:00Z') }, { value: 103.5, created_at: new Date('2026-08-11T10:00:00Z') }];
      },
    });
    const rows = await portfolioHistory('kid-1');
    assert.equal(rows.length, 2);
    assert.equal(rows[1].value, 103.5);
  });

  test('setKidMoneyMode accepts play/real only', async () => {
    let saved: any = null;
    mockModel(prisma, 'kidProfile', { update: async (args: any) => { saved = args.data; return { id: args.where.id }; } });
    await setKidMoneyMode('kid-1', 'real');
    assert.equal(saved.money_mode, 'real');
    await assert.rejects(setKidMoneyMode('kid-1', 'crypto'), /play|real/);
  });

  test('setInvestPolicy saves parent policy text', async () => {
    let saved: any = null;
    mockModel(prisma, 'kidProfile', { update: async (args: any) => { saved = args.data; return { id: args.where.id }; } });
    await setInvestPolicy('kid-1', 'ลูกต้องเก็บ 20% ของรายได้เข้าถังและลงทุนเสมอ');
    assert.ok(String(saved.invest_policy).includes('20%'));
  });
});

// ────────────────────────────────────────────────
// แจ้งเตือน Telegram ทันที
// ────────────────────────────────────────────────
describe('telegram instant notify hooks', () => {
  test('completeChore notifies parent with chore + balance', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', xp: 0, name: 'น้ำ' }) });
    mockModel(prisma, 'kidChore', {
      findUnique: async () => ({ id: 'c-1', kid_id: 'kid-1', title: 'กวาดบ้าน', reward: 10, status: 'pending' }),
      update: async (args: any) => ({ ...args.data }),
    });
    mockModel(prisma, 'kidWalletTx', { create: async () => ({ id: 't' }), aggregate: async () => ({ _sum: { amount: 25 } }) });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    mockModel(prisma, 'kidProfile', { update: async (args: any) => ({ id: args.where.id }) });
    mockModel(prisma, 'kidCertificate', { create: async () => ({ id: 'c-1' }) });
    const msgs: string[] = [];
    setNotifySender(async (m: string) => { msgs.push(m); });
    await completeChore('kid-1', 'c-1');
    assert.equal(msgs.length, 1);
    assert.ok(msgs[0].includes('น้ำ'));
    assert.ok(msgs[0].includes('กวาดบ้าน'));
    assert.ok(msgs[0].includes('25'));
  });

  test('redeemCoupon notifies parent with coupon title', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', pin_hash: null, xp: 0, name: 'น้ำ' }) });
    mockModel(prisma, 'kidCoupon', {
      findUnique: async () => ({ id: 'cp-1', kid_id: 'kid-1', title: 'เล่นเกม 30 นาที', cost: 50, status: 'available' }),
      update: async (args: any) => ({ ...args.data }),
    });
    mockModel(prisma, 'kidWalletTx', { aggregate: async () => ({ _sum: { amount: 100 } }), create: async () => ({ id: 't' }) });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    mockModel(prisma, 'kidProfile', { update: async (args: any) => ({ id: args.where.id }) });
    mockModel(prisma, 'kidCertificate', { create: async () => ({ id: 'c-1' }) });
    const msgs: string[] = [];
    setNotifySender(async (m: string) => { msgs.push(m); });
    await redeemCoupon('kid-1', 'cp-1');
    assert.equal(msgs.length, 1);
    assert.ok(msgs[0].includes('เล่นเกม 30 นาที'));
  });
});

// ────────────────────────────────────────────────
// พ่อแม่เติมเงินจริงเข้าพอร์ตหุ้น + ผลตอบแทนรายเดือน
// ────────────────────────────────────────────────
describe('portfolio deposits + monthly performance', () => {
  test('addPortfolioDeposit credits wallet, records deposit and audit', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', name: 'น้ำ' }) });
    const tx: any[] = [];
    mockModel(prisma, 'kidWalletTx', {
      create: async (args: any) => { tx.push(args.data); return { id: 't', ...args.data }; },
    });
    let deposit: any = null;
    mockModel(prisma, 'kidPortfolioDeposit', { create: async (args: any) => { deposit = args.data; return { id: 'd', ...args.data }; } });
    let audit: any = null;
    mockModel(prisma, 'kidAuditLog', { create: async (args: any) => { audit = args.data; return { id: 'a' }; } });
    setNotifySender(async () => {});
    await addPortfolioDeposit('kid-1', 500, 'เงินจริงชุดแรก');
    assert.equal(tx.length, 1);
    assert.equal(tx[0].amount, 500);
    assert.equal(tx[0].category, 'stock_deposit');
    assert.equal(deposit.amount, 500);
    assert.ok(String(deposit.note).includes('เงินจริงชุดแรก'));
    assert.equal(audit.action, 'portfolio_deposit');
  });

  test('addPortfolioDeposit rejects non-positive amount', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1' }) });
    mockModel(prisma, 'kidWalletTx', { create: async () => ({ id: 't' }) });
    mockModel(prisma, 'kidPortfolioDeposit', { create: async () => ({ id: 'd' }) });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });
    await assert.rejects(addPortfolioDeposit('kid-1', 0, 'x'), /amount/);
  });

  test('portfolioDeposits lists newest first', async () => {
    mockModel(prisma, 'kidPortfolioDeposit', {
      findMany: async (args: any) => {
        assert.equal(args.where.kid_id, 'kid-1');
        return [{ id: 'd-1', amount: 500, note: 'เงินจริง', created_at: new Date() }];
      },
    });
    const rows = await portfolioDeposits('kid-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 500);
  });

  test('portfolioPerformance computes profit vs deposits + monthly return', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => ({ id: 'kid-1', invest_target_pct: 2 }) });
    mockModel(prisma, 'kidInvestment', { findMany: async () => [{ symbol: 'WATER', units: 10, avg_cost: 50 }] }); // value = 10 * stockPrice(WATER)
    mockModel(prisma, 'kidPortfolioDeposit', {
      findMany: async () => [{ amount: 400 }],
      aggregate: async () => ({ _sum: { amount: 400 } }),
    });
    mockModel(prisma, 'kidPortfolioSnapshot', {
      findFirst: async (args: any) => (args.orderBy?.created_at === 'asc' ? { value: 100 } : { value: 550 }),
    });
    const perf = await portfolioPerformance('kid-1');
    assert.equal(perf.total_deposited, 400);
    assert.ok(perf.portfolio_value > 0);
    assert.equal(perf.target_pct, 2);
    assert.ok(typeof perf.month_return_pct === 'number');
  });

  test('setInvestTargetPct validates 0-100', async () => {
    let saved: any = null;
    mockModel(prisma, 'kidProfile', { update: async (args: any) => { saved = args.data; return { id: args.where.id }; } });
    await setInvestTargetPct('kid-1', 2.5);
    assert.equal(saved.invest_target_pct, 2.5);
    await assert.rejects(setInvestTargetPct('kid-1', 150), /0|100/);
  });
});
