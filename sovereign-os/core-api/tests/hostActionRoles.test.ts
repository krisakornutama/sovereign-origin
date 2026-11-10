// Role gates for host-level actions.
//
// - POST /api/system/processes/kill: killing an arbitrary host process is a
//   SUPERADMIN action (the agent guard/approval flow stays in place underneath).
// - POST /api/actuation/execute: physical actuation is for humans (and site/node
//   admins). SYSTEM_AI must never drive an actuator over HTTP — the generated
//   "strict AI/actuator separation" rule.
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import systemRoutes from '../src/modules/system/system.routes';
import actuationRoutes from '../src/modules/actuation/actuation.routes';
import { agentActions } from '../src/services/agent-actions.service';
import { actuationService } from '../src/services/actuation.service';
import { createTestServer, makeToken, TestServer } from './helpers';

let system: TestServer;
let actuation: TestServer;
let executeCalls = 0;

before(async () => {
  mock.method(agentActions, 'executeAction', async () => ({ status: 'executed', result: 'ok' }));
  // isolate the role gate from the safety envelope / persisted state file
  mock.method(actuationService, 'executeCommand', async () => {
    executeCalls += 1;
    return { ok: true, actuatorId: 'load-1', action: 'executed' } as any;
  });
  system = await createTestServer((app) => app.use('/api/system', systemRoutes));
  actuation = await createTestServer((app) => app.use('/api/actuation', actuationRoutes));
});

after(async () => {
  mock.restoreAll();
  if (system) await system.close();
  if (actuation) await actuation.close();
});

function post(base: string, path: string, body: unknown, token: string) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test('process kill: OPERATOR / SYSTEM_AI โดน 403 (ไม่แตะ host process)', async () => {
  for (const role of ['OPERATOR', 'SYSTEM_AI', 'NODE_ADMIN']) {
    const res = await post(system.baseUrl, '/api/system/processes/kill', { pid: 1234 }, makeToken(role));
    assert.equal(res.status, 403, role);
  }
});

test('process kill: SUPERADMIN ผ่านเข้า flow ของ agentActions', async () => {
  const res = await post(system.baseUrl, '/api/system/processes/kill', { pid: 1234 }, makeToken('SUPERADMIN'));
  assert.equal(res.status, 200);
});

test('actuation execute: SYSTEM_AI โดน 403 (AI สั่ง actuator ผ่าน HTTP ไม่ได้)', async () => {
  executeCalls = 0;
  const res = await post(actuation.baseUrl, '/api/actuation/execute', { actuatorId: 'load-1', state: 'on' }, makeToken('SYSTEM_AI'));
  assert.equal(res.status, 403);
  assert.equal(executeCalls, 0, 'ต้องไม่เรียก service เลย');
});

test('actuation execute: OPERATOR ยังใช้ได้ปกติ (ไม่ทำพฤติกรรมเดิมพัง)', async () => {
  executeCalls = 0;
  const res = await post(actuation.baseUrl, '/api/actuation/execute', { actuatorId: 'load-1', state: 'on' }, makeToken('OPERATOR'));
  assert.equal(res.status, 200);
  assert.equal(executeCalls, 1);
});
