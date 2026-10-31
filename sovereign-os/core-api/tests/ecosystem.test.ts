import './setup-env';
import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { mockModel, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';

// ── Ecosystem ส่วนตัวของผู้ใช้ — "ที่เก็บ id/password ที่แน่นหนา" ─────────────
//
// ของที่ต้องจับให้ได้ (ทุกข้อเคยเป็นความผิดพลาดที่แพง):
//   1) รหัสผ่านห้ามอยู่ใน DB เป็น plaintext — ต้องเป็น enc:v1:... (AES-256-GCM)
//   2) list/สรุปห้ามคืนรหัสผ่าน — ทางเดียวคือ reveal และต้องมี audit log
//   3) บัญชีของคนอื่นต้อง 404 (ไม่ยืนยันว่ามีอยู่) — ทุก query ผูก user_id
//   4) URL ที่เปิดได้ต้อง http/https เท่านั้น (กัน javascript:/file:/data:)
//   5) ฟอร์มแก้ไขที่เว้นรหัสว่าง = คงรหัสเดิม (ไม่ลบเงียบ ๆ)
//
// ใช้ key ชั่วคราวต่อการรัน — ห้ามเขียนทับ data/field-crypto.key ของเครื่องจริง
process.env.FIELD_CRYPTO_KEY_FILE = path.join(
  os.tmpdir(),
  `sovereign-ecosystem-test-${process.pid}-${Date.now()}.key`,
);

interface Row {
  id: string;
  user_id: string;
  platform: string;
  label: string;
  url: string | null;
  login_id: string | null;
  password_enc: string | null;
  notes: string | null;
  category: string | null;
  status: string;
  last_used_at: Date | null;
  password_updated_at: Date | null;
  primary_account_id?: string | null;
  created_at: Date;
  updated_at: Date;
}

let rows: Row[] = [];
let audits: any[] = [];
let seq = 0;

let svc: typeof import('../src/services/ecosystem.service');
let server: http.Server;
let baseUrl = '';

const OWNER = 'test-user';
const OTHER = 'test-user-operator';

function seed(overrides: Partial<Row> = {}): Row {
  const now = new Date();
  const row: Row = {
    id: `acc-${++seq}`,
    user_id: OWNER,
    platform: 'fiverr',
    label: 'Fiverr รับงานเขียน',
    url: 'https://www.fiverr.com/',
    login_id: null,
    password_enc: null,
    notes: null,
    category: 'freelance',
    status: 'active',
    last_used_at: null,
    password_updated_at: null,
    primary_account_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  rows.push(row);
  return row;
}

before(async () => {
  mockModel(prisma as any, 'userEcosystemAccount', {
    findMany: async (args: any) => rows.filter((r) => r.user_id === args?.where?.user_id),
    findFirst: async (args: any) =>
      rows.find((r) => r.id === args?.where?.id && r.user_id === args?.where?.user_id) ?? null,
    create: async (args: any) => {
      const now = new Date();
      const row: Row = {
        id: `acc-${++seq}`,
        last_used_at: null,
        password_updated_at: null,
        created_at: now,
        updated_at: now,
        ...args.data,
      };
      rows.push(row);
      return row;
    },
    update: async (args: any) => {
      const row = rows.find((r) => r.id === args?.where?.id);
      if (!row) throw new Error('not found');
      Object.assign(row, args.data, { updated_at: new Date() });
      return row;
    },
    delete: async (args: any) => {
      const idx = rows.findIndex((r) => r.id === args?.where?.id);
      if (idx < 0) throw new Error('not found');
      return rows.splice(idx, 1)[0];
    },
  });
  mockModel(prisma as any, 'auditLog', {
    create: async (args: any) => {
      audits.push(args.data);
      return args.data;
    },
  });

  // import หลังตั้ง key/env เท่านั้น — field-crypto อ่าน path ของ key ตอน module load
  svc = await import('../src/services/ecosystem.service');
  const { default: ecosystemRoutes } = await import('../src/modules/ecosystem/ecosystem.routes');
  const express = (await import('express')).default;

  const app = express();
  app.use(express.json());
  app.use('/api/ecosystem', ecosystemRoutes);
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  rows = [];
  audits = [];
});

after(async () => {
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

describe('ecosystem service — เข้ารหัสและความเป็นเจ้าของ', () => {
  test('createAccount: รหัสผ่านถูกเข้ารหัส AES-256-GCM (ไม่มี plaintext ใน DB)', async () => {
    const dto = await svc.createAccount(OWNER, {
      platform: 'fiverr',
      label: 'Fiverr หลัก',
      loginId: 'owner@example.com',
      password: 'SuperSecret-123!',
      url: 'https://www.fiverr.com/',
    });

    assert.equal(dto.hasPassword, true);
    assert.equal(dto.loginId, 'owner@example.com');
    assert.equal((dto as any).password, undefined, 'DTO ต้องไม่มีรหัสผ่าน');
    assert.equal((dto as any).password_enc, undefined);

    const stored = rows[0];
    assert.ok(stored.password_enc?.startsWith('enc:v1:'), 'ต้องเก็บเป็น enc:v1:...');
    assert.ok(!stored.password_enc?.includes('SuperSecret-123!'), 'ห้ามมี plaintext ใน DB');
    assert.ok(stored.login_id?.startsWith('enc:v1:'), 'login id ก็ต้องเข้ารหัส');
    assert.ok(!stored.login_id?.includes('owner@example.com'));
  });

  test('listAccounts: คืน loginId ที่ถอดได้ แต่ไม่คืนรหัสผ่านแม้แต่ฟิลด์เดียว', async () => {
    await svc.createAccount(OWNER, {
      platform: 'gmail',
      label: 'Gmail รับงาน',
      loginId: 'me@gmail.com',
      password: 'pw-1',
    });

    const { accounts, summary } = await svc.listAccounts(OWNER);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].loginId, 'me@gmail.com');
    assert.equal(accounts[0].hasPassword, true);
    assert.equal(JSON.stringify(accounts).includes('pw-1'), false, 'ห้ามมีรหัสผ่านใน JSON ของ list');
    assert.equal(JSON.stringify(accounts).includes('password_enc'), false);
    assert.equal(summary.total, 1);
    assert.equal(summary.withPassword, 1);
  });

  test('revealPassword: คืนรหัสจริง + เขียน audit ทุกครั้ง', async () => {
    const dto = await svc.createAccount(OWNER, {
      platform: 'facebook',
      label: 'Facebook เพจ',
      password: 'fb-secret',
    });
    audits = [];

    assert.equal(await svc.revealPassword(OWNER, dto.id), 'fb-secret');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action_type, 'ECOSYSTEM_PASSWORD_REVEALED');
    assert.equal(audits[0].user_id, OWNER);
    assert.equal(JSON.stringify(audits[0].payload).includes('fb-secret'), false, 'audit ห้ามเก็บรหัส');
  });

  test('revealPassword: บัญชีที่ยังไม่มีรหัส = 409 (ไม่ใช่คืน string ว่าง)', async () => {
    const dto = await svc.createAccount(OWNER, { platform: 'linkedin', label: 'LinkedIn' });
    await assert.rejects(
      () => svc.revealPassword(OWNER, dto.id),
      (err: any) => err.status === 409 && err.code === 'PASSWORD_NOT_SET',
    );
  });

  test('บัญชีของคนอื่น: reveal/update/delete ต้อง 404 เหมือนไม่มีอยู่', async () => {
    const dto = await svc.createAccount(OWNER, {
      platform: 'youtube',
      label: 'YouTube ช่องหลัก',
      password: 'yt-secret',
    });

    await assert.rejects(() => svc.revealPassword(OTHER, dto.id), (e: any) => e.status === 404);
    await assert.rejects(() => svc.updateAccount(OTHER, dto.id, { label: 'x' }), (e: any) => e.status === 404);
    await assert.rejects(() => svc.deleteAccount(OTHER, dto.id), (e: any) => e.status === 404);

    // ของเจ้าของยังอยู่ครบ
    assert.equal(rows.length, 1);
    assert.equal(await svc.revealPassword(OWNER, dto.id), 'yt-secret');
  });

  test('validation: ชื่อว่าง / platform ปลอม / URL javascript: / status ปลอม = 400', async () => {
    await assert.rejects(
      () => svc.createAccount(OWNER, { platform: 'fiverr', label: '   ' }),
      (e: any) => e.status === 400 && e.code === 'LABEL_REQUIRED',
    );
    await assert.rejects(
      () => svc.createAccount(OWNER, { platform: 'not-a-platform', label: 'x' }),
      (e: any) => e.status === 400 && e.code === 'UNKNOWN_PLATFORM',
    );
    await assert.rejects(
      () => svc.createAccount(OWNER, { platform: 'custom', label: 'x', url: 'javascript:alert(1)' }),
      (e: any) => e.status === 400 && e.code === 'BAD_URL',
    );
    await assert.rejects(
      () => svc.createAccount(OWNER, { platform: 'custom', label: 'x', status: 'deleted' }),
      (e: any) => e.status === 400 && e.code === 'BAD_STATUS',
    );
  });

  test('updateAccount: password ว่าง = คงรหัสเดิม · ส่งค่าใหม่ = เปลี่ยน · removePassword = ลบ', async () => {
    const dto = await svc.createAccount(OWNER, {
      platform: 'fastwork',
      label: 'Fastwork',
      password: 'old-pw',
    });

    await svc.updateAccount(OWNER, dto.id, { label: 'Fastwork ใหม่', password: '' });
    assert.equal(await svc.revealPassword(OWNER, dto.id), 'old-pw', 'เว้นว่างต้องไม่ลบรหัส');

    await svc.updateAccount(OWNER, dto.id, { password: 'new-pw' });
    assert.equal(await svc.revealPassword(OWNER, dto.id), 'new-pw');

    await svc.updateAccount(OWNER, dto.id, { removePassword: true });
    await assert.rejects(
      () => svc.revealPassword(OWNER, dto.id),
      (e: any) => e.code === 'PASSWORD_NOT_SET',
    );
  });

  test('openAccount: คืน URL ที่ปลอดภัย + บันทึก last_used_at · ปฏิเสธ javascript:', async () => {
    const dto = await svc.createAccount(OWNER, {
      platform: 'website',
      label: 'เว็บของฉัน',
      url: 'https://example.com/admin',
    });
    const out = await svc.openAccount(OWNER, dto.id);
    assert.equal(out.url, 'https://example.com/admin');
    assert.ok(rows[0].last_used_at instanceof Date, 'ต้องบันทึกว่าเพิ่งเปิด');

    // ข้อมูลเก่า/ถูกแก้ตรง DB เป็น javascript: ต้องไม่ถูกเปิด
    rows[0].url = 'javascript:alert(1)';
    await assert.rejects(() => svc.openAccount(OWNER, dto.id), (e: any) => e.code === 'BAD_URL');
  });

  test('summarize: นับตาม platform และรหัสที่เก่าเกิน 180 วัน', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    await svc.createAccount(OWNER, { platform: 'fiverr', label: 'a', password: 'x' });
    await svc.createAccount(OWNER, { platform: 'fiverr', label: 'b', password: 'y' });
    await svc.createAccount(OWNER, { platform: 'gmail', label: 'c' });
    seed({ platform: 'gmail', label: 'old', password_enc: 'enc:v1:fake', password_updated_at: old });

    const { summary } = await svc.listAccounts(OWNER);
    assert.equal(summary.total, 4);
    assert.equal(summary.withPassword, 3);
    assert.equal(summary.missingPassword, 1);
    assert.equal(summary.platforms, 2);
    assert.equal(summary.byPlatform.fiverr, 2);
    assert.equal(summary.stalePasswords, 1);
  });

  test('catalog: มี platform ที่เจ้าของใช้จริงครบ', () => {
    const ids = svc.getEcosystemCatalog().platforms.map((p) => p.id);
    for (const want of ['fiverr', 'fastwork', 'youtube', 'gmail', 'facebook', 'linkedin', 'website', 'custom']) {
      assert.ok(ids.includes(want), `catalog ต้องมี ${want}`);
    }
  });
});

// ── HTTP routes ──────────────────────────────────────────────────────────────

describe('ecosystem — Gmail เป็นบัญชีหลัก', () => {
  async function makeGmail(email = 'owner@gmail.com', userId = OWNER) {
    return svc.createAccount(userId, {
      platform: 'gmail',
      label: 'Gmail หลัก',
      loginId: email,
      url: 'https://mail.google.com/',
    });
  }

  test('จับคู่อัตโนมัติ: อีเมลที่ใช้สมัครตรงกับ Gmail (ไม่สนตัวพิมพ์/ช่องว่าง)', async () => {
    const gmail = await makeGmail('Owner@Gmail.com');
    const fiverr = await svc.createAccount(OWNER, {
      platform: 'fiverr',
      label: 'Fiverr',
      loginId: '  owner@gmail.com  ',
    });

    assert.equal(fiverr.primaryAccountId, gmail.id, 'ต้องผูกกับ Gmail ที่อีเมลตรงกัน');
    const { accounts } = await svc.listAccounts(OWNER);
    assert.equal(accounts.find((a) => a.id === gmail.id)!.linkedCount, 1, 'การ์ด Gmail ต้องรู้ว่ามีกี่บัญชีใช้');
  });

  test('อีเมลไม่ตรง = ไม่ผูก', async () => {
    await makeGmail('owner@gmail.com');
    const other = await svc.createAccount(OWNER, {
      platform: 'fastwork',
      label: 'Fastwork',
      loginId: 'other@gmail.com',
    });
    assert.equal(other.primaryAccountId, null);
  });

  test('บัญชีหลักต้องเป็น Gmail — ผูกกับ Fiverr = 400 PRIMARY_MUST_BE_GMAIL', async () => {
    const fiverr = await svc.createAccount(OWNER, { platform: 'fiverr', label: 'F', loginId: 'x@y.com' });
    await assert.rejects(
      () => svc.createAccount(OWNER, { platform: 'fastwork', label: 'W', primaryAccountId: fiverr.id }),
      (err: any) => err.status === 400 && err.code === 'PRIMARY_MUST_BE_GMAIL',
    );
  });

  test('ผูกกับ Gmail ของคนอื่น = 404 (ไม่ยืนยันว่ามีอยู่)', async () => {
    const otherGmail = await makeGmail('other@gmail.com', OTHER);
    await assert.rejects(
      () => svc.createAccount(OWNER, { platform: 'fiverr', label: 'F', primaryAccountId: otherGmail.id }),
      (err: any) => err.status === 404,
    );
  });

  test('ห้ามผูกบัญชีเข้ากับตัวเอง', async () => {
    const gmail = await makeGmail();
    await assert.rejects(
      () => svc.updateAccount(OWNER, gmail.id, { primaryAccountId: gmail.id }),
      (err: any) => err.code === 'SELF_LINK',
    );
  });

  test('ผูกได้ชั้นเดียว: Gmail ที่มีลูกอยู่แล้วถูกนำไปเป็นลูกของอีกใบ = 400', async () => {
    const g1 = await makeGmail('a@gmail.com');
    const g2 = await makeGmail('b@gmail.com');
    await svc.createAccount(OWNER, { platform: 'fiverr', label: 'F', loginId: 'a@gmail.com' });
    await assert.rejects(
      () => svc.updateAccount(OWNER, g1.id, { primaryAccountId: g2.id }),
      (err: any) => err.code === 'HAS_LINKED_ACCOUNTS',
    );
  });

  test('ถอดการผูกได้ และการแก้ฟิลด์อื่นไม่ทำให้หลุดเอง', async () => {
    const gmail = await makeGmail();
    const fiverr = await svc.createAccount(OWNER, {
      platform: 'fiverr',
      label: 'F',
      loginId: 'owner@gmail.com',
    });
    assert.equal(fiverr.primaryAccountId, gmail.id);

    const unlinked = await svc.updateAccount(OWNER, fiverr.id, { primaryAccountId: '' });
    assert.equal(unlinked.primaryAccountId, null);

    const edited = await svc.updateAccount(OWNER, fiverr.id, { notes: 'แก้หมายเหตุ' });
    assert.equal(edited.primaryAccountId, null, 'แก้ฟิลด์อื่นแล้วต้องไม่ผูกกลับเอง');
  });

  test('แก้อีเมลให้ตรงกับ Gmail = ผูกให้อัตโนมัติ', async () => {
    const gmail = await makeGmail('owner@gmail.com');
    const fiverr = await svc.createAccount(OWNER, {
      platform: 'fiverr',
      label: 'F',
      loginId: 'old@example.com',
      primaryAccountId: '',
    });
    assert.equal(fiverr.primaryAccountId, null);

    const updated = await svc.updateAccount(OWNER, fiverr.id, { loginId: 'owner@gmail.com' });
    assert.equal(updated.primaryAccountId, gmail.id);
  });

  test('autoLinkAccounts: ผูกบัญชีเดิมที่ยังไม่ผูก เฉพาะอีเมลที่ตรง', async () => {
    const gmail = await makeGmail('owner@gmail.com');
    const fiverr = await svc.createAccount(OWNER, {
      platform: 'fiverr',
      label: 'F',
      loginId: 'owner@gmail.com',
      primaryAccountId: '',
    });
    const fastwork = await svc.createAccount(OWNER, {
      platform: 'fastwork',
      label: 'W',
      loginId: 'OWNER@gmail.com',
      primaryAccountId: '',
    });
    const linkedin = await svc.createAccount(OWNER, {
      platform: 'linkedin',
      label: 'L',
      loginId: 'someone@else.com',
      primaryAccountId: '',
    });

    const out = await svc.autoLinkAccounts(OWNER);
    assert.deepEqual(out, { linked: 2, checked: 3 });

    const { accounts, summary } = await svc.listAccounts(OWNER);
    assert.equal(accounts.find((a) => a.id === fiverr.id)!.primaryAccountId, gmail.id);
    assert.equal(accounts.find((a) => a.id === fastwork.id)!.primaryAccountId, gmail.id);
    assert.equal(accounts.find((a) => a.id === linkedin.id)!.primaryAccountId, null);
    assert.equal(summary.linked, 2);
    assert.equal(summary.unlinked, 2, 'Gmail หลัก + LinkedIn = ยังไม่ผูก');
  });

  test('POST /accounts/auto-link → 200 และคืนจำนวนที่ผูก', async () => {
    const token = makeToken('SUPERADMIN');
    await makeGmail('owner@gmail.com');
    await svc.createAccount(OWNER, {
      platform: 'fiverr',
      label: 'F',
      loginId: 'owner@gmail.com',
      primaryAccountId: '',
    });
    const res = await api('POST', '/api/ecosystem/accounts/auto-link', token);
    assert.equal(res.status, 200);
    assert.equal(res.body.linked, 1);
    assert.equal(res.body.checked, 1);
  });
});

describe('ecosystem routes — สัญญา HTTP', () => {
  test('ไม่มี token = 401 ทุก endpoint ที่มีข้อมูล', async () => {
    assert.equal((await api('GET', '/api/ecosystem/accounts', '')).status, 401);
    assert.equal((await api('POST', '/api/ecosystem/accounts', '', { label: 'x' })).status, 401);
  });

  test('POST /accounts → 201 และ response ไม่มีรหัสผ่าน', async () => {
    const token = makeToken('SUPERADMIN');
    const out = await api('POST', '/api/ecosystem/accounts', token, {
      platform: 'fiverr',
      label: 'Fiverr รับงาน',
      loginId: 'me@example.com',
      password: 'route-secret',
      url: 'https://www.fiverr.com/',
    });

    assert.equal(out.status, 201);
    assert.equal(out.body.account.platform, 'fiverr');
    assert.equal(out.body.account.hasPassword, true);
    assert.equal(JSON.stringify(out.body).includes('route-secret'), false);
    assert.equal(rows[0].password_enc?.startsWith('enc:v1:'), true);
  });

  test('GET /accounts → no-store + ไม่มีรหัสผ่าน · reveal → คืนรหัสพร้อม no-store', async () => {
    const token = makeToken('SUPERADMIN');
    const created = await api('POST', '/api/ecosystem/accounts', token, {
      platform: 'gmail',
      label: 'Gmail',
      password: 'route-pw',
    });
    const id = created.body.account.id;

    const list = await api('GET', '/api/ecosystem/accounts', token);
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(list.body).includes('route-pw'), false);
    assert.equal(list.body.summary.total, 1);

    const revealed = await api('POST', `/api/ecosystem/accounts/${id}/reveal`, token);
    assert.equal(revealed.status, 200);
    assert.equal(revealed.body.password, 'route-pw');
    assert.equal(revealed.headers.get('cache-control'), 'no-store');
    assert.ok(audits.some((a) => a.action_type === 'ECOSYSTEM_PASSWORD_REVEALED'));
  });

  test('บัญชีของคนอื่นผ่าน HTTP = 404', async () => {
    const ownerToken = makeToken('SUPERADMIN');
    const created = await api('POST', '/api/ecosystem/accounts', ownerToken, {
      platform: 'linkedin',
      label: 'LinkedIn',
      password: 'pw',
    });
    const id = created.body.account.id;
    const otherToken = makeToken('OPERATOR');

    assert.equal((await api('POST', `/api/ecosystem/accounts/${id}/reveal`, otherToken)).status, 404);
    assert.equal((await api('PATCH', `/api/ecosystem/accounts/${id}`, otherToken, { label: 'x' })).status, 404);
    assert.equal((await api('DELETE', `/api/ecosystem/accounts/${id}`, otherToken)).status, 404);
  });

  test('PATCH/DELETE ทำงานกับเจ้าของ และ validation ตอบ 400 พร้อม code', async () => {
    const token = makeToken('SUPERADMIN');
    const created = await api('POST', '/api/ecosystem/accounts', token, {
      platform: 'youtube',
      label: 'YouTube',
      password: 'pw',
    });
    const id = created.body.account.id;

    const patched = await api('PATCH', `/api/ecosystem/accounts/${id}`, token, {
      label: 'YouTube ใหม่',
      password: '',
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.account.label, 'YouTube ใหม่');
    assert.equal((await api('POST', `/api/ecosystem/accounts/${id}/reveal`, token)).body.password, 'pw');

    const bad = await api('POST', '/api/ecosystem/accounts', token, {
      platform: 'custom',
      label: 'x',
      url: 'file:///C:/Windows/System32',
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'BAD_URL');

    assert.equal((await api('DELETE', `/api/ecosystem/accounts/${id}`, token)).status, 200);
    assert.equal((await api('POST', `/api/ecosystem/accounts/${id}/reveal`, token)).status, 404);
  });

  test('GET /catalog → 200 และมี platform ที่ต้องใช้', async () => {
    const out = await api('GET', '/api/ecosystem/catalog', makeToken('SUPERADMIN'));
    assert.equal(out.status, 200);
    assert.ok(out.body.platforms.some((p: any) => p.id === 'fiverr'));
    assert.ok(out.body.categories.length >= 5);
  });
});
