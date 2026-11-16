// SITE_ADMIN = อ่านอย่างเดียว (docs/modules/fleet.md §"บทบาท SITE_ADMIN")
//
// ปัญหาจริง: `POST /api/actuation/execute` เปิดให้ SITE_ADMIN สั่ง actuator ได้
// ขณะที่หน้าจอทุกหน้าใช้ `useCanWriteModules()` (SUPERADMIN/NODE_ADMIN/OPERATOR)
// ⇒ เรียก API ตรงข้าม UI ได้ + `/execute` ไม่ตรวจขอบเขตสาขาเลย
//    (SITE_ADMIN ของสาขาหนึ่งสั่ง actuator ของสาขาอื่นได้)
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import actuationRoutes from '../src/modules/actuation/actuation.routes';
import { actuationService } from '../src/services/actuation.service';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

let actuation: TestServer;
let executeCalls = 0;

before(async () => {
  mock.method(actuationService, 'executeCommand', async () => {
    executeCalls += 1;
    return { ok: true, actuatorId: 'load-1', action: 'executed' } as any;
  });
  actuation = await createTestServer((app) => app.use('/api/actuation', actuationRoutes));
});

after(async () => {
  mock.restoreAll();
  if (actuation) await actuation.close();
  // service ที่ import มาถือ PrismaClient ไว้ — ปิดให้หมด ไม่งั้น process exit ชน libuv
  // assertion (UV_HANDLE_CLOSING) บน Windows แม้ assertion ของเทสต์จะผ่านครบแล้ว
  await prisma.$disconnect().catch(() => {});
});

function execute(token?: string) {
  return fetch(actuation.baseUrl + '/api/actuation/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ actuatorId: 'load-1', state: 'on' }),
  });
}

test('actuation execute: SITE_ADMIN (อ่านอย่างเดียว) โดน 403 และไม่แตะ service', async () => {
  executeCalls = 0;
  const res = await execute(makeToken('SITE_ADMIN'));
  assert.equal(res.status, 403);
  assert.equal(executeCalls, 0);
});

test('actuation execute: SYSTEM_AI / KID ยังโดน 403', async () => {
  for (const role of ['SYSTEM_AI', 'KID']) {
    executeCalls = 0;
    const res = await execute(makeToken(role));
    assert.equal(res.status, 403, role);
    assert.equal(executeCalls, 0, role);
  }
});

test('actuation execute: ชุด role ที่สั่งงานได้ยังผ่าน (ไม่ over-block)', async () => {
  for (const role of ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR']) {
    executeCalls = 0;
    const res = await execute(makeToken(role));
    assert.equal(res.status, 200, role);
    assert.equal(executeCalls, 1, role);
  }
});

test('actuation execute: ไม่มี token = 401', async () => {
  const res = await execute();
  assert.equal(res.status, 401);
});
