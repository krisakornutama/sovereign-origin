import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import {
  prisma,
  curriculumOverview,
  recordCurriculumProgress,
  subjectCertificates,
  setNotifySender,
} from '../src/services/teach-kids.service';

interface TrackRow {
  id: string;
  code: string;
  title: string;
  emoji: string;
  color: string;
  sort_order: number;
  items: { id: string; title: string; description: string | null; stage: number; sequence: number }[];
}

const TRACK: TrackRow = {
  id: 't-1',
  code: 'INNER_OS',
  title: 'Inner OS — จัดการใจและตัวเอง',
  emoji: '🧠',
  color: '#a78bfa',
  sort_order: 1,
  items: [
    { id: 'i-1', title: 'ตั้งเป้าหมายส่วนตัว', description: null, stage: 1, sequence: 1 },
    { id: 'i-2', title: 'สมาธิและสติ', description: null, stage: 2, sequence: 2 },
    { id: 'i-3', title: 'ทบทวนสัปดาห์', description: null, stage: 4, sequence: 3 },
  ],
};

const allItems: any[] = [];
for (const t of [TRACK]) for (const it of t.items) allItems.push(it);

// ────────────────────────────────────────────────
// curriculumOverview
// ────────────────────────────────────────────────
describe('curriculumOverview (หลักสูตรสร้างยอดคน)', () => {
  test('returns every track with ordered items', async () => {
    mockModel(prisma, 'curriculumTrack', {
      findMany: async () => [{ ...TRACK }],
    });
    mockModel(prisma, 'kidProfile', { findMany: async () => [] });
    mockModel(prisma, 'kidLessonProgress', { findMany: async () => [] });
    mockModel(prisma, 'kidCertificate', { findMany: async () => [] });

    const ov = await curriculumOverview();
    assert.equal(ov.tracks.length, 1);
    assert.equal(ov.tracks[0].code, 'INNER_OS');
    assert.deepEqual(ov.tracks[0].items.map((i) => i.sequence), [1, 2, 3]);
    assert.deepEqual(ov.kids, []);
  });

  test('computes per-track completion per kid', async () => {
    mockModel(prisma, 'curriculumTrack', { findMany: async () => [{ ...TRACK }] });
    mockModel(prisma, 'kidProfile', {
      findMany: async () => [{ id: 'kid-1', name: 'น้ำ', emoji: '🧒', color: null }],
    });
    // kid-1 เรียนจบ 2/3 บท (i-1, i-2) — ยังไม่ครบสาขา
    mockModel(prisma, 'kidLessonProgress', {
      findMany: async () => [
        { kid_id: 'kid-1', curriculum_item_id: 'i-1' },
        { kid_id: 'kid-1', curriculum_item_id: 'i-2' },
        { kid_id: 'other', curriculum_item_id: 'i-1' },
      ],
    });
    mockModel(prisma, 'kidCertificate', { findMany: async () => [] });

    const ov = await curriculumOverview();
    const kid = ov.kids[0];
    const pt = kid.per_track['t-1'];
    assert.equal(pt.total, 3);
    assert.equal(pt.done.length, 2);
    assert.equal(pt.completed, false);
    assert.deepEqual(kid.completed_tracks, []);
  });

  test('marks track completed when all items done', async () => {
    mockModel(prisma, 'curriculumTrack', { findMany: async () => [{ ...TRACK }] });
    mockModel(prisma, 'kidProfile', {
      findMany: async () => [{ id: 'kid-1', name: 'น้ำ', emoji: '🧒', color: null }],
    });
    mockModel(prisma, 'kidLessonProgress', {
      findMany: async () => [
        { kid_id: 'kid-1', curriculum_item_id: 'i-1' },
        { kid_id: 'kid-1', curriculum_item_id: 'i-2' },
        { kid_id: 'kid-1', curriculum_item_id: 'i-3' },
      ],
    });
    mockModel(prisma, 'kidCertificate', { findMany: async () => [] });

    const ov = await curriculumOverview();
    const kid = ov.kids[0];
    assert.equal(kid.per_track['t-1'].completed, true);
    assert.deepEqual(kid.completed_tracks, ['t-1']);
  });
});

// ────────────────────────────────────────────────
// recordCurriculumProgress — บันทึกเรียนจบ + จบสาขาอัตโนมัติ
// ────────────────────────────────────────────────
describe('recordCurriculumProgress (บันทึกเรียนจบหลักสูตร)', () => {
  beforeEach(() => setNotifySender(async () => {}));

  test('rejects unknown kid', async () => {
    mockModel(prisma, 'kidProfile', { findUnique: async () => null });
    await assert.rejects(() =>
      recordCurriculumProgress('ghost', 'i-1', { score: 3, total: 3 }),
      /kid not found/
    );
  });

  test('records progress with curriculum_item_id + grants XP', async () => {
    mockModel(prisma, 'kidProfile', {
      findUnique: async () => ({ id: 'kid-1', xp: 0, name: 'น้ำ' }),
      update: async (args: any) => ({ id: args.where.id, xp: args.data.xp, level: 1 }),
    });
    mockModel(prisma, 'curriculumItem', {
      findUnique: async () => ({ id: 'i-1', track_id: 't-1', title: 'ตั้งเป้าหมายส่วนตัว', track: TRACK }),
    });
    let created: any = null;
    mockModel(prisma, 'kidLessonProgress', {
      create: async (args: any) => { created = args.data; return { id: 'p-1' }; },
      // เรียก 2 ครั้ง: จบ i-1 (แค่บทนี้) แล้วตรวจความครบสาขา
      findMany: async () => [{ kid_id: 'kid-1', curriculum_item_id: 'i-1' }],
    });
    mockModel(prisma, 'curriculumItem', {
      findMany: async () => [{ id: 'i-1' }, { id: 'i-2' }, { id: 'i-3' }],
    });
    mockModel(prisma, 'kidCertificate', {
      create: async () => ({ id: 'c-1' }),
      findFirst: async () => null,
    });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a-1' }) });

    const res = await recordCurriculumProgress('kid-1', 'i-1', { score: 3, total: 3 });
    assert.equal(res.id, 'p-1');
    assert.equal(res.certificate, null);
    assert.ok(created, 'progress row created');
    assert.equal(created.kid_id, 'kid-1');
    assert.equal(created.curriculum_item_id, 'i-1');
    assert.equal(created.score, 3);
  });

  test('auto-creates subject certificate when a track is completed', async () => {
    mockModel(prisma, 'kidProfile', {
      findUnique: async () => ({ id: 'kid-1', xp: 0, name: 'น้ำ' }),
      update: async (args: any) => ({ id: args.where.id, xp: args.data.xp, level: 1 }),
    });
    const item = { id: 'i-3', track_id: 't-1', title: 'ทบทวนสัปดาห์', track: TRACK };
    mockModel(prisma, 'curriculumItem', {
      findUnique: async () => item,
    });
    // ครบทั้ง 3 บทของสาขาแล้ว
    mockModel(prisma, 'kidLessonProgress', {
      create: async () => ({ id: 'p-3' }),
      findMany: async () => [
        { kid_id: 'kid-1', curriculum_item_id: 'i-1' },
        { kid_id: 'kid-1', curriculum_item_id: 'i-2' },
        { kid_id: 'kid-1', curriculum_item_id: 'i-3' },
      ],
    });
    mockModel(prisma, 'curriculumItem', {
      findMany: async () => [{ id: 'i-1' }, { id: 'i-2' }, { id: 'i-3' }],
    });
    let cert: any = null;
    let createdAgain = 0;
    mockModel(prisma, 'kidCertificate', {
      findFirst: async () => null,
      create: async (args: any) => { cert = args.data; createdAgain++; return { id: 'c-1' }; },
    });
    const audits: any[] = [];
    mockModel(prisma, 'kidAuditLog', { create: async (args: any) => { audits.push(args.data); return { id: 'a' }; } });

    const res = await recordCurriculumProgress('kid-1', 'i-3', { score: 5, total: 5 });
    assert.ok(cert, 'subject certificate created');
    assert.equal(cert.kind, 'subject');
    assert.ok(cert.title.includes('จบสาขา'), cert.title);
    assert.ok(audits.some((a) => a.action === 'track_complete'));
  });

  test('does not duplicate subject certificate on repeat completion', async () => {
    mockModel(prisma, 'kidProfile', {
      findUnique: async () => ({ id: 'kid-1', xp: 0, name: 'น้ำ' }),
      update: async (args: any) => ({ id: args.where.id, xp: args.data.xp, level: 1 }),
    });
    mockModel(prisma, 'curriculumItem', {
      findUnique: async () => ({ id: 'i-3', track_id: 't-1', title: 'ทบทวนสัปดาห์', track: TRACK }),
    });
    mockModel(prisma, 'kidLessonProgress', {
      create: async () => ({ id: 'p-3' }),
      findMany: async () => [
        { kid_id: 'kid-1', curriculum_item_id: 'i-1' },
        { kid_id: 'kid-1', curriculum_item_id: 'i-2' },
        { kid_id: 'kid-1', curriculum_item_id: 'i-3' },
      ],
    });
    mockModel(prisma, 'curriculumItem', {
      findMany: async () => [{ id: 'i-1' }, { id: 'i-2' }, { id: 'i-3' }],
    });
    let created = 0;
    mockModel(prisma, 'kidCertificate', {
      findFirst: async () => ({ id: 'existing-cert' }), // พบว่ามีใบเดิมแล้ว
      create: async () => { created++; return { id: 'c-new' }; },
    });
    mockModel(prisma, 'kidAuditLog', { create: async () => ({ id: 'a' }) });

    const res = await recordCurriculumProgress('kid-1', 'i-3', { score: 5, total: 5 });
    assert.equal(created, 0);
    assert.equal(res.certificate, null);
  });
});

// ────────────────────────────────────────────────
// subjectCertificates
// ────────────────────────────────────────────────
describe('subjectCertificates (เกียรติบัตรจบสาขา)', () => {
  test('filters by kind=subject only', async () => {
    let whereUsed: any = null;
    mockModel(prisma, 'kidCertificate', {
      findMany: async (args: any) => { whereUsed = args.where; return []; },
    });
    await subjectCertificates('kid-1');
    assert.equal(whereUsed.kind, 'subject');
    assert.equal(whereUsed.kid_id, 'kid-1');
  });
});