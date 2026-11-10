// JWT algorithm lock.
//
// jsonwebtoken accepts any HMAC algorithm that matches the secret type, so a
// token signed with HS512 (same secret) authenticated exactly like HS256. Only
// our own signer uses HS256, so every other algorithm is an unsupported path
// that must be rejected instead of silently trusted.
//
// Also covers `alg: none` (unsigned token) — must never authenticate.
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, authenticatePartial } from '../src/middleware/auth.middleware';
import { createTestServer, makeToken, TestServer } from './helpers';
import { registerTestUser } from './auth-user-registry';

const SECRET = process.env.JWT_SECRET as string;
const USER_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';

let server: TestServer;

before(async () => {
  registerTestUser({ id: USER_ID, role: 'SUPERADMIN', assigned_node_id: null, token_version: 0 });
  server = await createTestServer((app) => {
    const router = express.Router();
    router.get('/whoami', authenticate, (req, res) => res.json({ id: req.user!.id }));
    router.get('/partial', authenticatePartial, (req, res) => res.json({ id: req.user!.id }));
    app.use('/', router);
  });
});

after(async () => {
  if (server) await server.close();
});

function payload(overrides: Record<string, unknown> = {}) {
  return { userId: USER_ID, role: 'SUPERADMIN', mfa_verified: true, token_version: 0, ...overrides };
}

function get(path: string, token: string) {
  return fetch(server.baseUrl + path, { headers: { Authorization: `Bearer ${token}` } });
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

test('HS256 (อัลกอริทึมเดียวที่เราออกเอง) ยังผ่านปกติ', async () => {
  const res = await get('/whoami', makeToken('SUPERADMIN', { userId: USER_ID }));
  assert.equal(res.status, 200);
});

test('token ที่เซ็นด้วย HS512 (secret เดียวกัน) ต้องถูกปฏิเสธ 401', async () => {
  const token = jwt.sign(payload(), SECRET, { algorithm: 'HS512' });
  const res = await get('/whoami', token);
  assert.equal(res.status, 401, 'HS512 ไม่ใช่ทางที่ระบบนี้ออก token — ต้องไม่ถูกเชื่อ');
});

test('token ที่เซ็นด้วย HS512 ต้องใช้กับ authenticatePartial ไม่ได้เช่นกัน', async () => {
  const token = jwt.sign(payload(), SECRET, { algorithm: 'HS512' });
  const res = await get('/partial', token);
  assert.equal(res.status, 401);
});

test('alg: none (ไม่มีลายเซ็น) ต้องถูกปฏิเสธ 401', async () => {
  const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload())}.`;
  const res = await get('/whoami', unsigned);
  assert.equal(res.status, 401);
});
