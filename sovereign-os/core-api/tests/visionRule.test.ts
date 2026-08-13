import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import {
  prisma,
  addKnownFace,
  deleteKnownFace,
  listKnownFaces,
  getVisionRule,
  updateVisionRule,
  analyzeStranger,
  runVisionCheck,
  setVisionOllama,
  setVisionNotify,
} from '../src/services/vision-rule.service';

describe('vision known faces', () => {
  test('addKnownFace requires a name', async () => {
    mockModel(prisma, 'knownFace', { create: async () => ({ id: 'f-1' }) });
    const ok = await addKnownFace({ name: 'พ่อ', photo_url: 'https://x/papa.jpg' });
    assert.equal(ok.id, 'f-1');
    await assert.rejects(addKnownFace({ name: '' }), /name/);
  });

  test('listKnownFaces returns rows', async () => {
    mockModel(prisma, 'knownFace', {
      findMany: async (args: any) => {
        assert.equal(args.orderBy.created_at, 'desc');
        return [{ id: 'f-1', name: 'พ่อ' }];
      },
    });
    const rows = await listKnownFaces();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'พ่อ');
  });

  test('deleteKnownFace removes by id', async () => {
    let deleted = '';
    mockModel(prisma, 'knownFace', { delete: async (args: any) => { deleted = args.where.id; return { id: args.where.id }; } });
    await deleteKnownFace('f-1');
    assert.equal(deleted, 'f-1');
  });
});

describe('vision rule settings', () => {
  test('getVisionRule creates a default row when missing', async () => {
    mockModel(prisma, 'visionRule', {
      findFirst: async () => null,
      create: async (args: any) => ({ id: 1, ...args.data }),
    });
    const rule = await getVisionRule();
    assert.equal(rule.enabled, true);
    assert.equal(rule.interval_min, 10);
    assert.equal(rule.notify_telegram, true);
  });

  test('updateVisionRule validates interval and confidence', async () => {
    mockModel(prisma, 'visionRule', { update: async (args: any) => ({ id: 1, ...args.data }) });
    await updateVisionRule({ interval_min: 30, confidence_min: 0.5, only_strangers: true });
    await assert.rejects(updateVisionRule({ interval_min: -1 }), /interval/);
    await assert.rejects(updateVisionRule({ confidence_min: 2 }), /0|1/);
  });
});

describe('analyzeStranger + runVisionCheck', () => {
  test('analyzeStranger parses VL response into persons/familiar/strangers', async () => {
    setVisionOllama({ post: async (_url: string, body: any) => {
      assert.ok(String(body.prompt).includes('ใบหน้าที่คุ้นเคย'));
      return { data: { response: '```json\n{"persons": 2, "familiar": ["พ่อ"], "strangers": 1}\n```' } };
    } });
    const res = await analyzeStranger('data:image/jpeg;base64,abc');
    assert.equal(res.persons, 2);
    assert.deepEqual(res.familiar, ['พ่อ']);
    assert.equal(res.strangers, 1);
  });

  test('runVisionCheck skips when rule disabled', async () => {
    mockModel(prisma, 'visionRule', { findFirst: async () => ({ id: 1, enabled: false }) });
    const res = await runVisionCheck();
    assert.equal(res.skipped, 'disabled');
  });

  test('runVisionCheck skips when not due yet', async () => {
    mockModel(prisma, 'visionRule', {
      findFirst: async () => ({ id: 1, enabled: true, interval_min: 10, last_check_at: new Date(Date.now() - 1000) }),
    });
    const res = await runVisionCheck();
    assert.equal(res.skipped, 'not_due');
  });

  test('runVisionCheck alerts on stranger + sends Telegram + records alert', async () => {
    mockModel(prisma, 'visionRule', {
      findFirst: async () => ({ id: 1, enabled: true, interval_min: 10, last_check_at: new Date(Date.now() - 600000), notify_telegram: true, confidence_min: 0, only_strangers: true }),
      update: async (args: any) => ({ id: 1, ...args.data }),
    });
    mockModel(prisma, 'knownFace', { findMany: async () => [{ id: 'f-1', name: 'พ่อ' }] });
    let alert: any = null;
    mockModel(prisma, 'visionAlert', { create: async (args: any) => { alert = args.data; return { id: 'v-1', ...args.data }; } });
    const msgs: string[] = [];
    setVisionNotify(async (m: string) => { msgs.push(m); });
    setVisionOllama({ post: async () => ({ data: { response: '{"persons": 1, "familiar": [], "strangers": 1}' } }) });
    const res = await runVisionCheck({ photo: 'data:image/jpeg;base64,abc' });
    assert.equal(res.alerted, true);
    assert.equal(msgs.length, 1);
    assert.ok(msgs[0].includes('คนแปลกหน้า'));
    assert.ok(alert, 'visionAlert should be created');
  });

  test('runVisionCheck does not alert when everyone is familiar (only_strangers)', async () => {
    mockModel(prisma, 'visionRule', {
      findFirst: async () => ({ id: 1, enabled: true, interval_min: 10, last_check_at: new Date(Date.now() - 600000), notify_telegram: true, confidence_min: 0, only_strangers: true }),
      update: async (args: any) => ({ id: 1, ...args.data }),
    });
    mockModel(prisma, 'knownFace', { findMany: async () => [] });
    const msgs: string[] = [];
    setVisionNotify(async (m: string) => { msgs.push(m); });
    setVisionOllama({ post: async () => ({ data: { response: '{"persons": 1, "familiar": ["พ่อ"], "strangers": 0}' } }) });
    const res = await runVisionCheck({ photo: 'data:image/jpeg;base64,abc' });
    assert.equal(res.alerted, false);
    assert.equal(msgs.length, 0);
  });
});
