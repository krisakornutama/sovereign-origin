// tools/preview-stack.mjs — สแตก preview คำสั่งเดียว: mock API :3101 + frontend dev :3100
// ใช้: node tools/preview-stack.mjs            (เริ่มทั้งคู่, Ctrl+C = หยุดทั้งคู่)
//      node tools/preview-stack.mjs --check   (เช็คว่าสแตกฟังพอร์ตครบไหม — exit 0/1 เงียบ ๆ)
//
// ทำไมต้องสคริปต์นี้: การสั่ง `next dev` เองแล้วหวังให้ NEXT_PUBLIC_API_URL ทำงาน
// เคยพังจริง — ถ้า dev server ถูกเริ่มโดยกระบวนการที่ไม่ได้รับ env (restart ตัวเอง,
// worker หลัง HMR) หน้าเว็บจะ fallback ไป :3001 แล้วโดน 401 เด้ง login ตลอด
// → สคริปต์นี้เป็นพ่อของทั้งสองกระบวนการ + ตรวจ /api/ai/policy ของ mock จริงก่อนเปิดเว็บ
import { spawn } from 'node:child_process';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'sovereign-frontend');
const MOCK_PORT = 3101;
const DEV_PORT = 3100;

if (process.argv.includes('--check')) {
  const probe = (port, path) =>
    new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path, timeout: 2000 }, (res) => resolve(res.statusCode !== undefined && res.statusCode < 500));
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  const mockOk = await probe(MOCK_PORT, '/api/ai/policy');
  const devOk = await probe(DEV_PORT, '/');
  process.exit(mockOk && devOk ? 0 : 1);
}

const children = [];
const procs = [];

function start(name, cmd, args, cwd, env, waitForPort) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const tag = `[${name}]`;
  child.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}`).join('\n') + '\n'));
  child.stderr.on('data', (d) => process.stderr.write(String(d).split('\n').filter(Boolean).map((l) => `${tag} ${l}`).join('\n') + '\n'));
  child.on('exit', (code) => console.log(`${tag} exited (${code})`));
  const ready = waitForPort
    ? new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          const req = http.get({ host: '127.0.0.1', port: waitForPort, path: waitForPort === MOCK_PORT ? '/api/ai/policy' : '/', timeout: 1500 }, (res) => {
            res.resume();
            resolve();
          });
          req.on('error', () => {
            if (Date.now() - t0 > 60000) reject(new Error(`${tag} ไม่ยอมฟัง :${waitForPort} ใน 60 วิ`));
            else setTimeout(tick, 800);
          });
          req.on('timeout', () => { req.destroy(); setTimeout(tick, 800); });
        };
        tick();
      })
    : Promise.resolve();
  procs.push(ready);
  return child;
}

console.log(`[preview-stack] mock :3101 + dev :${DEV_PORT} (NEXT_PUBLIC_API_URL=http://localhost:${MOCK_PORT})`);
start('mock', 'node', ['tools/mock-api-preview.mjs'], ROOT, {}, MOCK_PORT);
start('dev', 'node', [`node_modules/next/dist/bin/next dev -p ${DEV_PORT}`], FRONTEND, {
  NEXT_PUBLIC_API_URL: `http://localhost:${MOCK_PORT}`,
  NEXT_PUBLIC_WS_URL: `http://localhost:${MOCK_PORT}`,
}, DEV_PORT);

try {
  await Promise.all(procs);
  console.log(`[preview-stack] พร้อม — เปิด http://localhost:${DEV_PORT}`);
} catch (err) {
  console.error('[preview-stack]', err.message);
  for (const c of children) try { c.kill(); } catch {}
  process.exit(1);
}

const stopAll = () => { for (const c of children) try { c.kill(); } catch {}; process.exit(0); };
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
setInterval(() => {}, 1 << 30); // ครอบ event loop ไว้ — ทั้งสองลูกยังรันต่อ
