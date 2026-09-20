import express from 'express';
import http from 'http';
import https from 'https';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import { config } from './config';
import { auditStateChange } from './middleware/auth.middleware';
import { mountRoutes } from './routes';
import { createSocketServer } from './realtime/socket';
import { startWorkers } from './workers/start';
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
app.set('trust proxy', 1);
app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  // เปิดให้ browser อ่าน Retry-After ได้ (ใช้แสดง countdown ตอนโดน rate limit)
  exposedHeaders: ['Retry-After'],
}));
app.use(express.json({ limit: '25mb' })); // 25MB — รองรับแพ็กเกจ Export & Clone (ฐานข้อมูลเต็ม) + การนำเข้า
app.use(auditStateChange);

mountRoutes(app);

startWorkers(app, io);

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

startListener();
console.log(`📡 WebSocket server ready (${config.isProduction ? 'production' : 'development'})`);

// ── Reliability: กัน request เดียวพังทั้งระบบ ──
// 1) error middleware — 500 ที่อ่านง่ายแทน crash
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('❌ Unhandled route error:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.end();
  }
});

// 2) uncaughtException / unhandledRejection — log แล้วอยู่ต่อ (appliance ต้องไม่ตายง่าย)
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection (kept alive):', reason);
});
