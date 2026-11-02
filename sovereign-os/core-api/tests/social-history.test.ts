// tests/social-history.test.ts
//
// ── ประวัติการโพสต์ของ Social Studio ────────────────────────────────────────
// เป้าหมาย: งานที่เจ้าของทำ (โพสต์ข้อความ/ลงคลิป) ต้องไม่หาย และต้องรู้ว่า
// แพลตฟอร์มไหน "โพสต์แล้ว" — กันโพสต์ซ้ำ/ลืมปลายทาง
//
// กติกาความปลอดภัย:
//   · ทุก query ผูก user_id — ของคนอื่น = 404
//   · ไม่เก็บรหัสผ่าน/ความลับใด ๆ ในประวัติ
//   · URL ปลายทางต้องเป็น http/https เท่านั้น
import './setup-env';
import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { mockModel, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';

interface TargetRow {
  id: string;
  post_id: string;
  platform: string;
  account_id: string | null;
  status: string;
  external_url: string | null;
  external_id: string | null;
  posted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface PostRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  video_name: string | null;
  video_size: string | null;
  created_at: Date;
  updated_at: Date;
}

let posts: PostRow[] = [];
let targets: TargetRow[] = [];
let accounts: any[] = [];
let audits: any[] = [];
let seq = 0;

let svc: typeof import('../src/services/social-history.service');
let server: http.Server;
let baseUrl = '';

const OWNER = 'test-user';
const OTHER = 'test-user-operator';
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function withTargets(p: PostRow) {
  return { ...p, targets: targets.filter((t) => t.post_id === p.id) };
}

function seedAccount(overrides: Partial<any> = {}) {
  const row = {
    id: UUID(++seq),
    user_id: OWNER,
    platform: 'facebook',
    label: 'Facebook',
    status: 'active',
    ...overrides,
  };
  accounts.push(row);
  return row;
}

before(async () => {
  mockModel(prisma as any, 'socialPost', {
    create: async (args: any) => {
      const now = new Date();
      const { targets: nested, ...data } = args.data;
      const row: PostRow = {
        id: UUID(++seq),
        created_at: now,
        updated_at: now,
        ...data,
      };
      posts.push(row);
      for (const t of nested?.create ?? []) {
        targets.push({
          id: UUID(++seq),
          post_id: row.id,
          account_id: null,
          status: 'pending',
          external_url: null,
          external_id: null,
          posted_at: null,
          created_at: now,
          updated_at: now,
          ...t,
        });
      }
      return withTargets(row);
    },
    findMany: async (args: any) => {
      let out = posts.filter((p) => p.user_id === args?.where?.user_id);
      out = [...out].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      if (args?.take) out = out.slice(0, args.take);
      return out.map(withTargets);
    },
    findFirst: async (args: any) => {
      const p = posts.find((x) => x.id === args?.where?.id && x.user_id === args?.where?.user_id);
      return p ? withTargets(p) : null;
    },
    delete: async (args: any) => {
      const idx = posts.findIndex((p) => p.id === args?.where?.id);
      if (idx < 0) throw new Error('not found');
      const [row] = posts.splice(idx, 1);
      targets = targets.filter((t) => t.post_id !== row.id);
      return row;
    },
  });

  mockModel(prisma as any, 'socialPostTarget', {
    updateMany: async (args: any) => {
      const rows = targets.filter(
        (t) => t.post_id === args?.where?.post_id && t.platform === args?.where?.platform,
      );
      for (const row of rows) Object.assign(row, args.data, { updated_at: new Date() });
      return { count: rows.length };
    },
  });

  mockModel(prisma as any, 'userEcosystemAccount', {
    findMany: async (args: any) => accounts.filter((a) => a.user_id === args?.where?.user_id),
    findFirst: async (args: any) => {
      const a = accounts.find((x) => x.id === args?.where?.id && x.user_id === args?.where?.user_id);
      return a ?? null;
    },
  });

  mockModel(prisma as any, 'auditLog', {
    create: async (args: any) => {
      audits.push(args.data);
      return args.data;
    },
  });

  svc = await import('../src/services/social-history.service');
  const { default: socialRoutes } = await import('../src/modules/ecosystem/social-history.routes');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/ecosystem/social', socialRoutes);
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

beforeEach(() => {
  posts = [];
  targets = [];
  accounts = [];
  audits = [];
  seq = 0;
});

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function api(method: string, p: string, token: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

// ── service ──────────────────────────────────────────────────────────────────

describe('social history — สร้างและอ่าน', () => {
  test('สร้างโพสต์ข้อความ + target Facebook ได้ และไม่เก็บรหัสผ่าน', async () => {
    const fb = seedAccount();
    const dto = await svc.createSocialPost(OWNER, {
      kind: 'text',
      title: '',
      body: 'สวัสดีครับ',
      link: 'https://example.com/x',
      targets: [{ platform: 'facebook', accountId: fb.id }],
    });

    assert.equal(dto.kind, 'text');
    assert.equal(dto.body, 'สวัสดีครับ');
    assert.equal(dto.link, 'https://example.com/x');
    assert.equal(dto.targets.length, 1);
    assert.equal(dto.targets[0].platform, 'facebook');
    assert.equal(dto.targets[0].accountId, fb.id);
    assert.equal(dto.targets[0].status, 'pending');
    assert.equal(JSON.stringify(dto).includes('password'), false, 'ประวัติห้ามมีฟิลด์รหัสผ่าน');
    assert.ok(audits.some((a) => a.action_type === 'ECOSYSTEM_SOCIAL_POST_CREATED'));
  });

  test('สร้างคลิป + หลายแพลตฟอร์ม, ตัด target ซ้ำ และเรียงตามลำดับที่กำหนด', async () => {
    const yt = seedAccount({ platform: 'youtube' });
    const tt = seedAccount({ platform: 'tiktok' });
    const dto = await svc.createSocialPost(OWNER, {
      kind: 'clip',
      title: 'รีวิวเซนเซอร์',
      body: 'คำอธิบาย',
      videoName: 'clip.mp4',
      videoSize: 123456789,
      targets: [
        { platform: 'youtube', accountId: yt.id },
        { platform: 'tiktok', accountId: tt.id },
        { platform: 'youtube', accountId: yt.id },
      ],
    });

    assert.deepEqual(dto.targets.map((t) => t.platform), ['youtube', 'tiktok']);
    assert.equal(dto.videoName, 'clip.mp4');
    assert.equal(dto.videoSize, '123456789');
  });

  test('list คืนเฉพาะของผู้ใช้คนนี้ เรียงใหม่สุดก่อน และไม่ปนของคนอื่น', async () => {
    await svc.createSocialPost(OWNER, { kind: 'text', body: 'ของฉัน', targets: [{ platform: 'facebook' }] });
    await svc.createSocialPost(OTHER, { kind: 'text', body: 'ของคนอื่น', targets: [{ platform: 'facebook' }] });

    const mine = await svc.listSocialPosts(OWNER);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].body, 'ของฉัน');

    const theirs = await svc.listSocialPosts(OTHER);
    assert.equal(theirs.length, 1);
    assert.equal(theirs[0].body, 'ของคนอื่น');
  });

  test('limit ถูกจำกัดไม่ให้ดึงทั้งประวัติทีเดียว', async () => {
    for (let i = 0; i < 5; i += 1) {
      await svc.createSocialPost(OWNER, { kind: 'text', body: `โพสต์ ${i}`, targets: [{ platform: 'facebook' }] });
    }
    assert.equal((await svc.listSocialPosts(OWNER, 2)).length, 2);
    assert.equal((await svc.listSocialPosts(OWNER, 999)).length, 5);
  });
});

describe('social history — สถานะปลายทาง', () => {
  test('ทำเครื่องหมายโพสต์แล้ว: ตั้ง posted_at + externalUrl และเขียน audit', async () => {
    const dto = await svc.createSocialPost(OWNER, {
      kind: 'clip',
      title: 'คลิป',
      targets: [{ platform: 'youtube' }],
    });
    audits = [];

    const updated = await svc.updateSocialPostTarget(OWNER, dto.id, 'youtube', {
      status: 'posted',
      externalUrl: 'https://www.youtube.com/watch?v=abc123',
      externalId: 'abc123',
    });

    const t = updated.targets[0];
    assert.equal(t.status, 'posted');
    assert.equal(t.externalUrl, 'https://www.youtube.com/watch?v=abc123');
    assert.equal(t.externalId, 'abc123');
    assert.ok(t.postedAt, 'ต้องบันทึกเวลาที่โพสต์');
    assert.ok(audits.some((a) => a.action_type === 'ECOSYSTEM_SOCIAL_TARGET_POSTED'));
    assert.equal(JSON.stringify(audits).includes('password'), false);
  });

  test('เปลี่ยนกลับเป็น skipped = ล้าง posted_at (ไม่ค้างสถานะเก่า)', async () => {
    const dto = await svc.createSocialPost(OWNER, { kind: 'text', targets: [{ platform: 'facebook' }] });
    await svc.updateSocialPostTarget(OWNER, dto.id, 'facebook', { status: 'posted' });
    const back = await svc.updateSocialPostTarget(OWNER, dto.id, 'facebook', { status: 'skipped' });
    assert.equal(back.targets[0].status, 'skipped');
    assert.equal(back.targets[0].postedAt, null);
  });

  test('แก้ target ของโพสต์คนอื่น = 404', async () => {
    const dto = await svc.createSocialPost(OWNER, { kind: 'text', targets: [{ platform: 'facebook' }] });
    await assert.rejects(
      () => svc.updateSocialPostTarget(OTHER, dto.id, 'facebook', { status: 'posted' }),
      (err: any) => err.status === 404,
    );
  });

  test('platform/status แปลกปลอม / URL javascript: = 400', async () => {
    const dto = await svc.createSocialPost(OWNER, { kind: 'text', targets: [{ platform: 'facebook' }] });
    await assert.rejects(
      () => svc.updateSocialPostTarget(OWNER, dto.id, 'twitter', { status: 'posted' }),
      (err: any) => err.status === 400,
    );
    await assert.rejects(
      () => svc.updateSocialPostTarget(OWNER, dto.id, 'facebook', { status: 'done' }),
      (err: any) => err.status === 400,
    );
    await assert.rejects(
      () => svc.updateSocialPostTarget(OWNER, dto.id, 'facebook', {
        status: 'posted',
        externalUrl: 'javascript:alert(1)',
      }),
      (err: any) => err.status === 400,
    );
  });

  test('accountId ของคนอื่น หรือ platform ไม่ตรง = 400 (ไม่หลุดข้อมูลบัญชี)', async () => {
    const otherFb = seedAccount({ user_id: OTHER });
    const mineYt = seedAccount({ platform: 'youtube' });

    await assert.rejects(
      () => svc.createSocialPost(OWNER, { kind: 'text', targets: [{ platform: 'facebook', accountId: otherFb.id }] }),
      (err: any) => err.status === 400,
    );
    await assert.rejects(
      () => svc.createSocialPost(OWNER, { kind: 'text', targets: [{ platform: 'facebook', accountId: mineYt.id }] }),
      (err: any) => err.status === 400,
    );
  });

  test('ลบโพสต์ของตัวเองได้ · ของคนอื่น = 404', async () => {
    const dto = await svc.createSocialPost(OWNER, { kind: 'text', targets: [{ platform: 'facebook' }] });
    await assert.rejects(() => svc.deleteSocialPost(OTHER, dto.id), (err: any) => err.status === 404);
    await svc.deleteSocialPost(OWNER, dto.id);
    assert.equal((await svc.listSocialPosts(OWNER)).length, 0);
    assert.equal(targets.length, 0, 'target ต้องถูกลบตาม (cascade)');
  });
});

describe('social history — validation', () => {
  test('kind ไม่ถูกต้อง / ไม่มี target / target ซ้ำจนว่าง = 400', async () => {
    await assert.rejects(
      () => svc.createSocialPost(OWNER, { kind: 'video', targets: [{ platform: 'facebook' }] }),
      (err: any) => err.status === 400,
    );
    await assert.rejects(
      () => svc.createSocialPost(OWNER, { kind: 'text', targets: [] }),
      (err: any) => err.status === 400,
    );
    await assert.rejects(
      () => svc.createSocialPost(OWNER, { kind: 'text', targets: 'facebook' as any }),
      (err: any) => err.status === 400,
    );
  });

  test('body ยาวเกินเพดาน / URL ไม่ปลอดภัย = 400', async () => {
    await assert.rejects(
      () => svc.createSocialPost(OWNER, {
        kind: 'text',
        body: 'x'.repeat(100_001),
        targets: [{ platform: 'facebook' }],
      }),
      (err: any) => err.status === 400,
    );
    await assert.rejects(
      () => svc.createSocialPost(OWNER, {
        kind: 'text',
        link: 'file:///C:/secret.txt',
        targets: [{ platform: 'facebook' }],
      }),
      (err: any) => err.status === 400,
    );
  });
});

// ── HTTP routes ──────────────────────────────────────────────────────────────

describe('social history — HTTP', () => {
  test('ไม่มี token = 401 ทุก endpoint', async () => {
    assert.equal((await api('GET', '/api/ecosystem/social/posts', '')).status, 401);
    assert.equal((await api('POST', '/api/ecosystem/social/posts', '', { kind: 'text', targets: [{ platform: 'facebook' }] })).status, 401);
  });

  test('POST → 201 · GET → 200 · PATCH target → 200 · DELETE → 200', async () => {
    const token = makeToken('SUPERADMIN');
    const created = await api('POST', '/api/ecosystem/social/posts', token, {
      kind: 'text',
      body: 'โพสต์จาก HTTP',
      targets: [{ platform: 'facebook' }],
    });
    assert.equal(created.status, 201);
    const id = created.body.post.id;
    assert.equal(created.body.post.body, 'โพสต์จาก HTTP');

    const list = await api('GET', '/api/ecosystem/social/posts', token);
    assert.equal(list.status, 200);
    assert.equal(list.body.posts.length, 1);
    assert.equal(list.headers.get('cache-control'), 'no-store');

    const patched = await api('PATCH', `/api/ecosystem/social/posts/${id}/targets/facebook`, token, {
      status: 'posted',
      externalUrl: 'https://www.facebook.com/permalink/123',
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.post.targets[0].status, 'posted');

    const removed = await api('DELETE', `/api/ecosystem/social/posts/${id}`, token);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { success: true });
  });

  test('id ผิดรูปแบบ/ของคนอื่น = 404 ไม่ใช่ 500', async () => {
    const token = makeToken('SUPERADMIN');
    const other = makeToken('OPERATOR');
    const created = await api('POST', '/api/ecosystem/social/posts', token, {
      kind: 'text',
      targets: [{ platform: 'facebook' }],
    });
    const id = created.body.post.id;

    assert.equal((await api('PATCH', '/api/ecosystem/social/posts/not-a-uuid/targets/facebook', token, { status: 'posted' })).status, 404);
    assert.equal((await api('PATCH', `/api/ecosystem/social/posts/${id}/targets/facebook`, other, { status: 'posted' })).status, 404);
    assert.equal((await api('DELETE', '/api/ecosystem/social/posts/not-a-uuid', token)).status, 404);
  });
});
