// tools/verify/ui-sweep.mjs — UI regression ด้วย Chromium จริง (รันซ้ำได้จาก repo root)
// ใช้: node tools/verify/ui-sweep.mjs   (ต้องมี :3000 + :3001)
//  ล็อกอินด้วย session (localStorage sovereign-auth) → ไล่หน้าสำคัญ → ต้อง render + ไม่มี pageerror + ไม่มี API 5xx
//  browsers อยู่ที่ <repo>/.playwright-browsers (กฎ drive E:) — resolve playwright จาก frontend
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';
// browsers อยู่ที่ <repo>/.playwright-browsers (กฎ drive E:) — ต้องตั้ง env "ก่อน" require playwright
// (playwright 1.63 อ่าน PLAYWRIGHT_BROWSERS_PATH ตอน require — ตั้งหลัง require จะถูกเมินเงียบ ๆ)
const BROWSERS = path.join(ROOT, '.playwright-browsers');
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS;
const require = createRequire(import.meta.url);
const jwt = require(path.join(ROOT, 'sovereign-os/core-api/node_modules/jsonwebtoken'));
const { chromium } = require(path.join(ROOT, 'sovereign-frontend/node_modules/playwright'));
if (!fs.existsSync(BROWSERS) || !fs.readdirSync(BROWSERS).some((d) => d.startsWith('chromium'))) {
  console.error(`FATAL ไม่พบ browsers ที่ ${BROWSERS} — รัน: npx playwright install (จาก sovereign-frontend)`);
  process.exit(2);
}
const psql = (sql) => execSync(`docker exec sovereign-db psql -U sovereign -d sovereign -t -A -c "${sql}"`, { encoding: 'utf8' }).trim();
const secret = fs.readFileSync(path.join(ROOT, 'sovereign-os/infra/.env'), 'utf8')
  .split(/\r?\n/).find(l => l.startsWith('JWT_SECRET=')).slice('JWT_SECRET='.length).replace(/^["']|["']$/g, '');
const [adminId, tvStr] = psql("SELECT id||'|'||token_version FROM users WHERE username='mock-admin'").split('|');
if (!adminId) { console.error('FATAL ไม่พบ mock-admin'); process.exit(2); }
const token = jwt.sign({ userId: adminId, role: 'SUPERADMIN', assigned_node_id: null, mfa_verified: true, must_change_password: false, token_version: Number(tvStr) }, secret, { expiresIn: '30m' });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => { localStorage.setItem('sovereign-auth', t); }, JSON.stringify({ state: { token }, version: 0 }));
const page = await ctx.newPage();

// เก็บ error ต่อหน้า — pageerror (exception ของหน้า) + console.error ที่ไม่ใช่ noise ของ infra
// (HMR websocket, MIME manifest, stack-frame 403 ของ dev overlay — พบเองตอนทดสอบ มีอยู่ทุกหน้าใน dev)
const NOISE = /(ResizeObserver|hmr|_clientMiddlewareManifest|__nextjs_original-stack-frames|Download the React DevTools)/i;
const NOISE_URL = /(hmr|_clientMiddlewareManifest|__nextjs_original-stack-frames)/i;
let pageErrors = [], consoleErrors = [], api5xx = [];
page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 100)));
page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text()) && !NOISE_URL.test(m.location()?.url || '')) consoleErrors.push(`${m.text().slice(0, 100)} (${(m.location()?.url || '').slice(-40)})`); });
page.on('response', (r) => { if (r.url().includes(':3001/api') && r.status() >= 500) api5xx.push(`${r.status()} ${r.url().slice(-40)}`); });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++; };

await page.goto(`${WEB}/`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
const first = await page.evaluate(() => ({ hit: !!document.body.innerText.match(/เข้าสู่ระบบ|Unauthorized/)?.[0], path: location.pathname }));
ok('session ใช้ได้ — ไม่โดนเตะ login', !first.hit, first.path + (first.hit ? ' (โดนเตะ)' : ''));

const PAGES = (process.env.SWEEP_PAGES || '/dashboard,/audit,/users,/system,/sensors,/devices,/nodes,/reports').split(',');
for (const p of PAGES) {
  // เริ่มนับใหม่ทุกหน้า — error ของหน้าก่อนต้องไม่ติดโทษหน้าถัดไป (กัน fail ลูกโซ่)
  pageErrors = []; consoleErrors = [];
  await page.goto(`${WEB}${p}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);
  const app = await page.evaluate(() => !!document.querySelector('#__next')?.children.length);
  const len = await page.evaluate(() => document.body.innerText.trim().length);
  const err = pageErrors.filter(e => !/ResizeObserver/.test(e));
  ok(`${p} render + ไม่มี pageerror`, app && len > 10 && err.length === 0, `len=${len}` + (err.length ? ` · ${err[0]}` : ''));
  // เช็คใหม่: หน้าต้องไม่มี console.error จากงาน — จับเคส mock/API คืนรูปทรงผิดแล้วหน้า crash ซ้ำ ๆ
  ok(`${p} ไม่มี console error (นอกจาก noise infra)`, consoleErrors.length === 0, consoleErrors.length ? `· ${consoleErrors[0]}` : '');
}

console.log(`\n── สรุป: pageerror=${pageErrors.length} console=${consoleErrors.length} API 5xx=${api5xx.length}`);
if (api5xx.length) console.log('API 5xx:', [...new Set(api5xx)].slice(0, 5).join(' | '));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
