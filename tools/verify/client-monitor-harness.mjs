// tools/verify/client-monitor-harness.mjs
// ── Harness ตรวจท่อ client-monitor จริง (โค้ดใหม่ที่ build แล้ว) บนพอร์ตแยก ──
// ไม่แตะ prod :3000/:3001 และไม่แตะ DB ของ prod — ต่อ Postgres ทดสอบ ephemeral
// (container --rm ที่ runner ปั่นขึ้นเอง) ทุกค่าละเอียดอ่อนมาจาก env เท่านั้น (ไม่มี secret ในไฟล์)
// โหลด dist จริงของ client-monitor (require) — ถ้าโค้ดพัง ทดสอบพังตามจริง
// ใช้: node tools/verify/client-monitor-harness.mjs  (รันคู่กับ tools/verify/run-client-monitor-e2e.mjs)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ── env ก่อน require โค้ด (config อ่านตอน import) ──
const PORT = Number(process.env.HARNESS_PORT || 3199);
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = String(PORT);
process.env.JWT_SECRET = process.env.HARNESS_JWT_SECRET;
process.env.DATABASE_URL = process.env.HARNESS_DATABASE_URL;
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
  console.error('HARNESS-CONFIG-FAIL: ต้องตั้ง HARNESS_JWT_SECRET และ HARNESS_DATABASE_URL');
  process.exit(1);
}
process.env.CLIENT_ERROR_ALERT_THRESHOLD = '3';
process.env.CLIENT_ERROR_ALERT_WINDOW_MS = '60000';

// Windows: new URL().pathname ให้ /E:/My%20work/... — ต้อง fileURLToPath
const CORE = fileURLToPath(new URL('../../sovereign-os/core-api/', import.meta.url)).replace(/[\\/]$/, '');
// resolve dependency ผ่าน node_modules ของ core-api (root ของ worktree ไม่มี node_modules)
const require = createRequire(`${CORE}/package.json`);

// ── stub Telegram sender ก่อน import service chain (กันยิง network จริง) ──
const telegramAlert = require(`${CORE}/dist/services/telegram-alert.service.js`);
const alerts = [];
telegramAlert.setTelegramAlertSender(async (html) => {
  alerts.push(html);
  return true;
});

// ── โหลดโค้ดใหม่จริง (dist ที่ tsc build) ──
const clientMonitorRoutes = require(`${CORE}/dist/modules/system/client-monitor.routes.js`).default;
const { authenticate } = require(`${CORE}/dist/middleware/auth.middleware.js`);
const clientMonitorService = require(`${CORE}/dist/services/client-monitor.service.js`);
const express = require('express');
const bcrypt = require('bcryptjs');

const cors = require('cors');
const app = express();
app.use(cors({ origin: true })); // harness: อนุญาตทุก origin (เทสเท่านั้น) — production ใช้ cors จริงใน server.ts
app.use(express.json({ limit: '1mb' }));
// เหมือน prod (server.ts): auto-audit ทุก POST/PUT/PATCH/DELETE ที่ผ่าน auth
app.use(require(`${CORE}/dist/middleware/auth.middleware.js`).auditStateChange);

// หน้า health สำหรับ ApiConnectionBanner ของ frontend (ให้ UI ทดสอบสงบ)
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// login จริง (bcrypt + prisma บน test DB) — แผง Client Health ต้องมี token
const authRoutes = require(`${CORE}/dist/modules/auth/auth.routes.js`).default;
app.use('/api/auth', authRoutes);

// route ใหม่จริง
app.use('/api/client-monitor', clientMonitorRoutes);

// user management จริง (reset-password + PUT ตั้งบังคับ) — ใช้กับการทดสอบ UI หน้า /users
app.use('/api/users', require(`${CORE}/dist/modules/users/users.routes.js`).default);

// endpoint จริงที่แผง Client Health เรียก (middleware authenticate จริง)
app.get('/api/system/client-health', authenticate, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(String(req.query.days) || '7', 10) || 7, 1), 30);
    res.json(await clientMonitorService.getClientHealthSummary(days));
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// จุดสังเกตการณ์สำหรับ e2e runner (ไม่อยู่ในโค้ด production)
app.get('/__verify/state', (_req, res) => res.json({ alerts }));
app.post('/__verify/reset', async (_req, res) => {
  alerts.length = 0;
  clientMonitorService.clientMonitor.resetCounters();
  await prisma.securityEvent.deleteMany({ where: { event_type: 'CLIENT_ERROR' } });
  res.json({ ok: true });
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// ── seed user สำหรับ login จริงผ่าน /api/auth/login ของ frontend ──
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seedUser() {
  const hash = await bcrypt.hash(process.env.HARNESS_TEST_PASSWORD, 10);
  await prisma.user.upsert({
    where: { username: 'verify-admin' },
    update: { password_hash: hash, must_change_password: false, mfa_secret: null },
    create: { username: 'verify-admin', password_hash: hash, role: 'SUPERADMIN', must_change_password: false },
  });
}

const server = app.listen(PORT, process.env.HARNESS_HOST || '127.0.0.1', () => console.log(`HARNESS-READY on ${PORT}`));

process.on('SIGTERM', () => { server.close(); prisma.$disconnect().finally(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(); prisma.$disconnect().finally(() => process.exit(0)); });

seedUser()
  .then(() => console.log('HARNESS-SEEDED user verify-admin'))
  .catch((err) => { console.error('HARNESS-SEED-FAIL', err?.message || err); process.exit(1); });
