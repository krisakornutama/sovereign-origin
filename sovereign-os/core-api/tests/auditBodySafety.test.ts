// Audit payload safety.
//
// Every state-changing request is auto-audited with its body
// (auditStateChange in auth.middleware). Two things must hold or the audit log
// becomes a liability:
//   1. A secret nested anywhere in the body (e.g. {user:{password}}) must be
//      redacted — top-level-only redaction leaks it straight into audit_logs.
//   2. The stored payload must stay small. /api/clone/import accepts up to
//      25 MB, and dumping that into audit_logs on every call bloats the DB
//      (and copies customer data into the audit trail).
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { auditStateChange } from '../src/middleware/auth.middleware';
import { AuditService } from '../src/services/audit.service';
import { TestServer, createTestServer } from './helpers';

const MAX_SERIALIZED_BODY = 8192; // must stay well under any DB text limit / row size

let server: TestServer;
const logged: any[] = [];
let nextUserId = 1;

before(async () => {
  mock.method(AuditService, 'logAction', async (p: any) => {
    logged.push(p);
  });
  server = await createTestServer((app) => {
    // จำลองผลของ authenticate: เทสต์นี้สนใจ "สิ่งที่ถูกบันทึก" ไม่ใช่การยืนยันตัวตน
    app.use((req: any, _res, next) => {
      req.user = { id: `auditor-${nextUserId++}`, role: 'SUPERADMIN' };
      next();
    });
    // ต้อง mount ก่อน router เพื่อให้ res.end ถูกห่อจริง
    app.use(auditStateChange);
    app.post('/api/thing', (req, res) => res.json({ ok: true, received: true }));
    app.get('/api/thing', (req, res) => res.json({ ok: true }));
  });
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

async function postBody(body: any): Promise<any> {
  logged.length = 0;
  const res = await fetch(server.baseUrl + '/api/thing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  assert.equal(logged.length, 1, 'ต้องเขียน audit หนึ่งครั้งต่อ request ที่เปลี่ยน state');
  return logged[0].payload.body;
}

test('ความลับที่ซ้อนอยู่ใน object ต้องถูกปิดด้วย (เดิมปิดแค่ชั้นบน)', async () => {
  const body = await postBody({
    username: 'somchai',
    profile: { nickname: ' chai ', password: 'p@ss', nested: { token: 'abc.def' } },
  });
  assert.equal(body.profile.password, '[REDACTED]');
  assert.equal(body.profile.nested.token, '[REDACTED]');
  assert.equal(body.profile.nickname, ' chai ', 'ค่าที่ไม่ใช่ความลับต้องคงเดิม');
});

test('ความลับใน array ก็ถูกปิดด้วย (เช่นหลายบัญชีในครั้งเดียว)', async () => {
  const body = await postBody({
    accounts: [
      { name: 'a', secret: 's1' },
      { name: 'b', apiToken: 't2' },
    ],
  });
  assert.equal(Array.isArray(body.accounts), true);
  assert.equal(body.accounts[0].secret, '[REDACTED]');
  assert.equal(body.accounts[1].apiToken, '[REDACTED]');
  assert.equal(body.accounts[1].name, 'b');
});

test('body ปกติที่ไม่ใหญ่เกินยังถูกเก็บรายละเอียดเดิมครบ', async () => {
  const body = await postBody({ title: 'งาน', count: 3, ok: true });
  assert.deepEqual(body, { title: 'งาน', count: 3, ok: true });
});

test('body ใหญ่ (จำลอง import หลายสิบ KB) ต้องถูกตัดพร้อมบอกขนาด ไม่เก็บทั้งก้อน', async () => {
  // 90 KB — ใหญ่กว่าเพดานที่เก็บจริงหลายเท่า แต่ยังต่ำกว่า limit ของ express.json (100 kb)
  const huge = 'x'.repeat(90 * 1024);
  const body = await postBody({ source: 'clone', payload: huge, meta: { device: 'node-1' } });
  assert.equal(body._truncated, true, 'body ที่ใหญ่เกินเพดานต้องถูกทำเครื่องหมาย');
  assert.ok(body._bytes > MAX_SERIALIZED_BODY, 'ต้องรายงานขนาดจริงที่มาถึง');
  assert.deepEqual(body._keys, ['source', 'payload', 'meta'], 'ยังบอกได้ว่า request ส่ง key อะไรมาบ้าง');
  assert.ok(JSON.stringify(body).length < MAX_SERIALIZED_BODY, 'payload ที่เก็บต้องเล็กจริง');
});

test('GET ไม่ถูกบันทึกเป็น audit (ไม่ใช่การเปลี่ยน state)', async () => {
  logged.length = 0;
  const res = await fetch(server.baseUrl + '/api/thing');
  assert.equal(res.status, 200);
  assert.equal(logged.length, 0);
});
