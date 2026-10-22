import { test, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import { applyJsonBodyParsers } from '../src/lib/http-body';
import { errorHandler } from '../src/middleware/error.middleware';

// P0: the global JSON parser used to accept 25 MB before authentication.
// Only /api/clone/import needs the large limit; everything else stays at 1 MB.

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app = express();
  applyJsonBodyParsers(app);
  app.post('/api/auth/login', (req, res) => res.json({ ok: true, size: JSON.stringify(req.body).length }));
  app.post('/api/clone/import', (req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function postJson(path: string, body: string) {
  return fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

test('global JSON limit rejects >1 MB before it reaches a route', async () => {
  const body = JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) });
  const res = await postJson('/api/auth/login', body);
  assert.strictEqual(res.status, 413);
});

test('clone import keeps its 25 MB limit', async () => {
  const body = JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) });
  const res = await postJson('/api/clone/import', body);
  assert.strictEqual(res.status, 200);
});

test('malformed JSON returns 400, not 500', async () => {
  const res = await postJson('/api/auth/login', '{"broken":');
  assert.strictEqual(res.status, 400);
});
