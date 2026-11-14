import express from 'express';
import http from 'http';
import https from 'https';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import { config } from './config';
import { runStartupMigrations } from './services/startup-migration.service';
import { auditStateChange } from './middleware/auth.middleware';
import { errorHandler } from './middleware/error.middleware';
import { applyJsonBodyParsers } from './lib/http-body';
import { mountRoutes } from './routes';
import { getObservability } from './middleware/observability.middleware';
import { createSocketServer } from './realtime/socket';
import { startWorkers } from './workers/start';
import { installErrorDedupe } from './lib/log-once';

// DB ล่มทีเดียว worker หลายตัวยิง error ซ้ำทุกวินาที — กลืนที่ประตูเดียวของโปรเซส
installErrorDedupe();
import { initFleetPolicyCache } from './services/fleet-policy.service';
import './services/livestock-cron.service'; // ปลดล็อก withdrawal + เตือนวัคซีน รายวัน

// ────────────────────────────────────────────────────────────────────────────
// Sovereign OS — Core API entrypoint
//
// โครงสร้าง (แยกออกจากไฟล์นี้เพื่อให้แก้เฉพาะจุดได้):
//   routes.ts            — เสียบ route ทุกโมดูล (ลำดับสำคัญ — ดูหัวไฟล์นั้น)
//   realtime/socket.ts   — สร้าง Socket.IO
//   workers/start.ts     — เริ่ม cron/worker/event-wiring ทั้งหมดตอน boot
//   modules/*/           — route + logic รายโมดูล
// ────────────────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = createSocketServer(server);

app.disable('x-powered-by');
// CSP สำหรับ response ฝั่ง API — เปิดแบบเข้มได้เพราะ API ไม่ serve HTML เลย (ตรวจแล้ว 20 ก.ย. 2569)
// ประโยชน์จริง: frame-ancestors กันการฝัง API ใน iframe ของเว็บอื่น + ปิด object/base ที่ไม่จำเป็น
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
// Permissions-Policy — helmet ไม่ตั้งให้เอง · ค่าตรงกับฝั่ง web (next.config.js) เป๊ะ
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
// อยู่หลัง proxy (nginx/caddy) → rate-limit นับ IP จริงได้
// ค่าเริ่มต้นคือ "ไม่เชื่อ" (TRUST_PROXY ไม่ตั้ง = false): ถ้า API เปิดตรง ผู้เรียกจะใส่
// X-Forwarded-For เองแล้วกลายเป็น IP อะไรก็ได้ (หลบ rate limit / ปลอม audit / อ้างเป็น loopback)
app.set('trust proxy', config.trustProxy);
// request-id + access log (JSON) + ตัวนับ/metrics — ต้องอยู่ต้น stack เพื่อให้ครอบทุกคำขอ
// (รวมคำขอที่ถูกปฏิเสธด้วย 401/413/429 ซึ่งเป็นคำขอที่อยากเห็นที่สุดเวลามีปัญหา)
app.use(getObservability().requestContext);
app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  // เปิดให้ browser อ่าน Retry-After ได้ (ใช้แสดง countdown ตอนโดน rate limit)
  // x-request-id: ผู้ใช้แจ้งเลขนี้มา = ไล่ log ได้ทันทีว่าคำขอนั้นเกิดอะไรขึ้น
  // X-Audit-Export-*: หน้า /audit ต้องรู้ว่าไฟล์ CSV ถูกตัดแถวหรือไม่ (ถ้าไม่ expose
  // browser จะซ่อน header ⇒ UI เตือน "ไม่ครบ" ไม่ได้เลย และไฟล์ที่ขาดจะเงียบสนิท)
  exposedHeaders: [
    'Retry-After',
    'x-request-id',
    'X-Audit-Export-Rows',
    'X-Audit-Export-Total',
    'X-Audit-Export-Truncated',
    'X-Audit-List-Has-More',
    'X-Audit-List-Offset',
    'X-Audit-List-Limit',
  ],
}));
// Stripe webhook — ลายเซ็นคำนวณจาก BYTE ต้นฉบับ จึงต้องได้ body ก่อนที่
// express.json() ทั้งแอปจะ parse ทิ้ง (แบบเดียวกับ client-monitor ที่ใช้ parser เฉพาะ route)
// Global JSON = 1 MB; /api/clone/import เท่านั้นที่ได้ 25 MB (ดู src/lib/http-body.ts)
applyJsonBodyParsers(app);
app.use(auditStateChange);

mountRoutes(app);

// worker เริ่มหลัง migrate: cron/timer ของ worker ไม่ควรคิวรี DB ก่อนตารางพร้อม
// (seed ของ route module ยังทำงานตอน import — คนละจุดกัน)

// ── HTTPS (production): ถ้าตั้ง TLS_CERT + TLS_KEY จะรันผ่าน TLS ──
function startListener() {
  if (config.tls.certPath && config.tls.keyPath) {
    const tlsOptions = {
      cert: fs.readFileSync(config.tls.certPath),
      key: fs.readFileSync(config.tls.keyPath),
    };
    const httpsServer = https.createServer(tlsOptions, app);
    io.attach(httpsServer); // websocket ผ่าน TLS ด้วย
    httpsServer.listen(config.port, () => {
      console.log(`🔒 Core API running on https://0.0.0.0:${config.port}`);
    });
    return;
  }
  server.listen(config.port, () => {
    console.log(`🚀 Core API running on port ${config.port}`);
  });
}

/** migrate ก่อนเริ่มรับ request — ล้มเหลวก็ยังเสิร์ฟต่อ แต่ต้องมีร่องรอยและ health บอกความจริง */
function startAfterMigrations() {
  const migration = runStartupMigrations({ env: process.env });
  if (!migration.ran) {
    console.log(`🗄️ migrate: ข้าม (${migration.reason}) — ${migration.detail}`);
  } else if (migration.ok) {
    console.log('🗄️ migrate: เรียบร้อย (' + migration.detail.split('\n').slice(-1)[0] + ')');
  } else {
    console.error('🗄️ migrate: ล้มเหลว — ' + migration.detail);
  }
  startWorkers(app, io);
  startListener();
}

void initFleetPolicyCache().finally(() => {
  startAfterMigrations();
  console.log(`📡 WebSocket server ready (${config.isProduction ? 'production' : 'development'})`);
});

// ── Reliability: กัน request เดียวพังทั้งระบบ ──
// 1) error middleware — 4xx ของ body-parser (413/400) คงสถานะเดิม, ที่เหลือ 500
app.use(errorHandler);

// 2) uncaughtException / unhandledRejection — log แล้วอยู่ต่อ (appliance ต้องไม่ตายง่าย)
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection (kept alive):', reason);
});
