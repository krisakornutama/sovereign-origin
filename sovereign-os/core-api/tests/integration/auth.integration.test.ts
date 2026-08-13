// ── INTEGRATION TEST: ต้องมี DB จริง ──
// รัน:  RUN_INTEGRATION=1 DATABASE_URL=postgresql://... JWT_SECRET=... npm run test:integration
// (Windows cmd: set RUN_INTEGRATION=1 && npm run test:integration)
// ไม่ import tests/setup-env — ใช้ env จริงจาก process
import { test } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const SKIP = process.env.RUN_INTEGRATION !== '1';
const prisma = new PrismaClient();

const USERNAME = `itest_${Date.now()}`;

test('can connect to the real database', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const result = await prisma.$queryRawUnsafe<Array<any>>('SELECT 1 AS ok');
  assert.strictEqual(Number(result[0].ok), 1);
});

test('user create → password verify → JWT round trip (real DB + config secret)', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const password = 'Integration-Test-Pass!42';
  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { username: USERNAME, password_hash: hash, role: 'OPERATOR' },
  });
  try {
    // รหัสผ่านถูก/ผิด
    assert.ok(await bcrypt.compare(password, user.password_hash), 'password ต้อง match');
    assert.ok(!(await bcrypt.compare('wrong', user.password_hash)), 'password ผิดต้องไม่ match');

    // JWT sign + verify ด้วย secret จาก config (JWT_SECRET env)
    const secret = process.env.JWT_SECRET!;
    assert.ok(secret && secret.length >= 16, 'JWT_SECRET ต้องตั้งค่าจริง');
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, secret, { expiresIn: '1h' });
    const payload = jwt.verify(token, secret) as any;
    assert.strictEqual(payload.id, user.id);
    assert.strictEqual(payload.role, 'OPERATOR');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('cleanup leftover users from previous failed runs', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const result = await prisma.user.deleteMany({ where: { username: { startsWith: 'itest_' } } });
  assert.ok(result.count >= 0);
});
