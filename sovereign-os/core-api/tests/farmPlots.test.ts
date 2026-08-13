import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import farmRoutes, { prisma } from '../src/modules/farm/farm.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;

const basePlot = (overrides: Record<string, any> = {}) => ({
  id: '22222222-2222-2222-2222-222222222222',
  name: 'แปลงผักหลังบ้าน',
  location: 'โซน A',
  crop: 'มะเขือเทศ',
  area_sqm: 20,
  soil_notes: 'pH 6.5',
  planted_at: new Date('2026-07-01T00:00:00Z'),
  expected_harvest_at: new Date('2026-09-01T00:00:00Z'),
  status: 'growing',
  notes: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

before(async () => {
  mockModel(prisma, 'farmPlot', {
    findMany: async () => [basePlot()],
    findUnique: async () => basePlot(),
    create: async ({ data }: any) => ({ id: 'plot-1', ...data }),
    update: async ({ data }: any) => ({ id: '22222222-2222-2222-2222-222222222222', ...data }),
    delete: async () => ({}),
  });
  server = await createTestServer((app) => app.use('/api/farm/plots', farmRoutes));
  adminToken = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test('requires authentication on all endpoints', async () => {
  for (const [method, url] of [
    ['GET', '/api/farm/plots'],
    ['POST', '/api/farm/plots'],
    ['GET', '/api/farm/plots/overview'],
  ] as const) {
    const res = await fetch(server.baseUrl + url, { method });
    assert.strictEqual(res.status, 401, `${method} ${url} should be 401`);
  }
});

test('GET / returns plots with daysToHarvest', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.plots));
  assert.strictEqual(typeof body.plots[0].daysToHarvest, 'number');
});

test('GET /overview returns status counts', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots/overview', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.totals.plots, 1);
  // ทุกสถานะต้องมี key (รวม 0)
  for (const status of ['active', 'growing', 'harvested', 'fallow']) {
    assert.ok(status in body.totals, `totals.${status} missing`);
  }
});

test('POST / requires name and valid status', async () => {
  const noName = await fetch(server.baseUrl + '/api/farm/plots', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  ', crop: 'ข้าว' }),
  });
  assert.strictEqual(noName.status, 400);

  const badStatus = await fetch(server.baseUrl + '/api/farm/plots', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'แปลงข้าว', status: 'exploding' }),
  });
  assert.strictEqual(badStatus.status, 400);
});

test('POST / creates plot with dates', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'แปลงข้าวนาปี',
      crop: 'ข้าวหอมมะลิ',
      planted_at: '2026-08-01',
      expected_harvest_at: '2026-12-15',
      status: 'active',
    }),
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.strictEqual(body.success, true);
});

test('POST / rejects invalid date strings', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'แปลงประหลาด', expected_harvest_at: 'soon-ish' }),
  });
  assert.strictEqual(res.status, 400);
});

test('PUT /:id validates status and returns 404 when missing', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots/22222222-2222-2222-2222-222222222222', {
    method: 'PUT',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'harvested' }),
  });
  assert.strictEqual(res.status, 200);
});

test('DELETE /:id works', async () => {
  const res = await fetch(server.baseUrl + '/api/farm/plots/22222222-2222-2222-2222-222222222222', {
    method: 'DELETE',
    headers: auth(adminToken),
  });
  assert.strictEqual(res.status, 200);
});