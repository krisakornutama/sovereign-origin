// The /system page must show real service health, never a hard-coded "Running".
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeSystemServices } from '../src/services/system-services.service';
import systemRoutes from '../src/modules/system/system.routes';
import { createTestServer } from './helpers';

const okDeps = {
  checkDatabase: async () => {},
  checkTcp: async () => {},
  checkHttp: async () => 200,
  timeoutMs: 200,
};

test('all probes up → up/up/up with latency', async () => {
  const result = await probeSystemServices(okDeps);
  assert.equal(result.services.length, 3);
  assert.deepEqual(result.services.map((s) => s.status), ['up', 'up', 'up']);
  assert.ok(result.checkedAt, 'ต้องมีเวลาที่ตรวจ');
  for (const svc of result.services) assert.ok((svc.latencyMs ?? -1) >= 0);
});

test('database down does not hide mqtt/ai status', async () => {
  const result = await probeSystemServices({
    ...okDeps,
    checkDatabase: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    },
  });
  const byId = Object.fromEntries(result.services.map((s) => [s.id, s]));
  assert.equal(byId.database.status, 'down');
  assert.match(byId.database.detail || '', /ECONNREFUSED/);
  assert.equal(byId.mqtt.status, 'up');
  assert.equal(byId.ai.status, 'up');
});

test('a hanging probe is cut off by the timeout and reported down', async () => {
  const result = await probeSystemServices({
    ...okDeps,
    timeoutMs: 25,
    checkDatabase: () => new Promise<void>(() => {}), // never resolves
  });
  const db = result.services.find((s) => s.id === 'database')!;
  assert.equal(db.status, 'down');
  assert.match(db.detail || '', /timeout/);
});

test('Ollama HTTP 5xx is down; 4xx still means reachable (up)', async () => {
  const down = await probeSystemServices({ ...okDeps, checkHttp: async () => 503 });
  assert.equal(down.services.find((s) => s.id === 'ai')!.status, 'down');
  const up = await probeSystemServices({ ...okDeps, checkHttp: async () => 404 });
  assert.equal(up.services.find((s) => s.id === 'ai')!.status, 'up');
});

test('GET /api/system/services requires authentication', async () => {
  const server = await createTestServer((app) => app.use('/api/system', systemRoutes));
  try {
    const res = await fetch(server.baseUrl + '/api/system/services');
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});
