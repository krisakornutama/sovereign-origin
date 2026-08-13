import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import automationRoutes from '../src/modules/automation/automation.routes';
import { automationEngine, prisma } from '../src/services/automation.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const DEFAULT_RULE = {
  id: 'default-1',
  metric: 'battery_soc',
  condition: 'lt',
  threshold: 20,
  message: '🔋 แบตเตอรี่ต่ำ',
  severity: 'critical',
  enabled: true,
  is_default: true,
  created_at: new Date(),
};

const CUSTOM_RULE = {
  id: 'custom-1',
  metric: 'temperature',
  condition: 'gt',
  threshold: 40,
  message: '🌡️ ร้อนเกินไป',
  severity: 'warning',
  enabled: true,
  is_default: false,
  created_at: new Date(),
};

let server: TestServer;
let adminToken: string;

before(async () => {
  // จำลอง DB: ตารางว่าง → seed → โหลดกฎ 2 ตัว (1 default + 1 custom)
  mockModel(prisma, 'automationRule', {
    count: async () => 0,
    createMany: async () => ({ count: 1 }),
    findMany: async () => [DEFAULT_RULE, CUSTOM_RULE],
  });

  await automationEngine.loadRules();

  server = await createTestServer((app) => app.use('/api/automation', automationRoutes));
  adminToken = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function json(token: string) {
  return { ...auth(token), 'Content-Type': 'application/json' };
}

test('requires authentication to list rules', async () => {
  const res = await fetch(server.baseUrl + '/api/automation/rules');
  assert.strictEqual(res.status, 401);
});

test('lists rules from the engine', async () => {
  const res = await fetch(server.baseUrl + '/api/automation/rules', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const rules = await res.json();
  assert.strictEqual(rules.length, 2);
});

test('validates rule input on create', async () => {
  const cases = [
    { body: {}, expect: /metric/ },
    { body: { metric: 'temperature' }, expect: /condition/ },
    { body: { metric: 'temperature', condition: 'gt' }, expect: /threshold/ },
    { body: { metric: 'temperature', condition: 'gt', threshold: 40 }, expect: /message/ },
    { body: { metric: 'temperature', condition: 'gte', threshold: 40, message: 'x', severity: 'warning' }, expect: /condition/ },
    { body: { metric: 'temperature', condition: 'gt', threshold: 40, message: 'x', severity: 'extreme' }, expect: /severity/ },
    { body: { metric: 'temperature', condition: 'gt', threshold: 'high', message: 'x', severity: 'warning' }, expect: /threshold/ },
  ];
  for (const c of cases) {
    const res = await fetch(server.baseUrl + '/api/automation/rules', {
      method: 'POST',
      headers: json(adminToken),
      body: JSON.stringify(c.body),
    });
    assert.strictEqual(res.status, 400, JSON.stringify(c.body));
    const data = await res.json();
    assert.match(data.error, c.expect);
  }
});

test('creates a custom rule', async () => {
  mockModel(prisma, 'automationRule', { create: async (args: any) => ({ id: 'new-1', ...args.data }) });

  const res = await fetch(server.baseUrl + '/api/automation/rules', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ metric: 'humidity', condition: 'lt', threshold: 30, message: '💦 อากาศแห้ง', severity: 'info' }),
  });
  assert.strictEqual(res.status, 200);
  const rule = await res.json();
  assert.strictEqual(rule.id, 'new-1');
  assert.strictEqual(rule.is_default, false);
  assert.strictEqual(automationEngine.getRules().length, 3);
});

test('updates a rule', async () => {
  mockModel(prisma, 'automationRule', { update: async (args: any) => ({ ...CUSTOM_RULE, ...args.data }) });

  const res = await fetch(server.baseUrl + '/api/automation/rules/custom-1', {
    method: 'PUT',
    headers: json(adminToken),
    body: JSON.stringify({ metric: 'temperature', condition: 'gt', threshold: 45, message: '🌡️ ร้อนมาก', severity: 'critical' }),
  });
  assert.strictEqual(res.status, 200);
  const rule = await res.json();
  assert.strictEqual(rule.threshold, 45);
  assert.strictEqual(rule.message, '🌡️ ร้อนมาก');
});

test('toggles a rule', async () => {
  mockModel(prisma, 'automationRule', { update: async () => ({}) });

  const res = await fetch(server.baseUrl + '/api/automation/rules/custom-1/toggle', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ enabled: false }),
  });
  assert.strictEqual(res.status, 200);
  const rule = automationEngine.getRules().find((r) => r.id === 'custom-1');
  assert.strictEqual(rule?.enabled, false);
});

test('cannot delete a built-in (default) rule', async () => {
  const res = await fetch(server.baseUrl + '/api/automation/rules/default-1', {
    method: 'DELETE',
    headers: auth(adminToken),
  });
  assert.strictEqual(res.status, 409);
});

test('deletes a custom rule', async () => {
  mockModel(prisma, 'automationRule', { delete: async () => ({}) });

  const res = await fetch(server.baseUrl + '/api/automation/rules/custom-1', {
    method: 'DELETE',
    headers: auth(adminToken),
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(automationEngine.getRules().some((r) => r.id === 'custom-1'), false);
});
