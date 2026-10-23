import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers';
import { uploadLimiter } from '../src/middleware/upload-rate-limit';

test('upload limiter allows a burst of 30 then returns 429', async () => {
  uploadLimiter.store.clear();
  const server = await createTestServer((app) => {
    app.post('/probe', uploadLimiter, (_req, res) => res.json({ ok: true }));
  });
  try {
    for (let i = 0; i < 30; i += 1) {
      const res = await fetch(`${server.baseUrl}/probe`, { method: 'POST' });
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const blocked = await fetch(`${server.baseUrl}/probe`, { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally {
    await server.close();
  }
});
