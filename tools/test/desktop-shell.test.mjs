// ─────────────────────────────────────────────���───────────────────────────────
// tools/test/desktop-shell.test.mjs
// กติกา: "สนามทดลอง/โหมดสาธารณะ" เป็นของ **เว็บ** เท่านั้น — แอป desktop (Electron) ต้องไม่โผล่เด็ดขาด
//
// เคสจริง (13/10/69): กดไอคอน Sovereign OS → เด้งไปหน้า "เข้าสนามทดลอง" ทันที
//  ราก: `isPublicHostname()` คืน true ทันทีที่ build เว็บ production (NEXT_PUBLIC_PUBLIC_SITE=1
//  ถูกฝังใน .next ที่ :3000 ตัวเดียวกับที่ Electron โหลด) → แอป desktop ถูกจัดเป็น
//  "ผู้มาเยือนภายนอก" ทั้งที่มันคือเครื่องของเจ้าของเอง
//
// ทางแก้: ตรวจ "เป็น desktop shell หรือไม่" ก่อนเสมอ แล้วค่อยตัดสินโหมดสาธารณะ
//  สัญญาณที่ใช้ (เรียงตามความน่าเชื่อถือ):
//   1. window.sovereign  = preload ของ Electron เปิดให้เฉพาะในแอป desktop (เบราว์เซอร์ไม่มี)
//   2. userAgent มี "Electron/"  = Electron ใส่ให้เสมอ
//   3. protocol = "file:"         = static export ที่แอปเปิดตรง ๆ (hostname ว่าง)
//
// รัน: npm run test:tools
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MOD = pathToFileURL(path.join(ROOT, 'sovereign-frontend', 'src', 'lib', 'publicAccess.ts')).href;

let seq = 0;
/** โหลดโมดูลใหม่ทุกครั้ง (type-strip ของ Node 24 + bust cache) พร้อมค่า env ตาม build จริง */
async function load(publicSite) {
  process.env.NEXT_PUBLIC_PUBLIC_SITE = publicSite;
  delete globalThis.window;
  return import(`${MOD}?v=${++seq}`);
}

/** จำลอง window ฝั่งเบราว์เซอร์ */
function fakeWindow({ hostname = '', protocol = 'http:', sovereign, ua = 'Mozilla/5.0' } = {}) {
  const w = { location: { hostname, protocol }, navigator: { userAgent: ua } };
  if (sovereign) w.sovereign = sovereign;
  globalThis.window = w;
  return w;
}

const ELECTRON_BRIDGE = { getStatus: () => Promise.resolve({}) };

// ── 1) แอป desktop ต้องไม่เป็น "สาธารณะ" แม้ build เป็นเว็บ production ──
test('desktop shell (Electron preload bridge) = เครื่องเรา แม้ build เป็น public mode', async () => {
  const m = await load('1'); // เหมือน .next ที่ :3000 ตอนนี้ (production → NEXT_PUBLIC_PUBLIC_SITE=1)
  fakeWindow({ hostname: 'localhost', sovereign: ELECTRON_BRIDGE });
  assert.equal(m.isPublicHostname(), false, 'desktop ต้องไม่เข้าโหมดสาธารณะ');
  assert.equal(m.isLocalHostname(), true, 'desktop ต้องถูกมองเป็นเครื่องตัวเอง');
});

test('desktop shell (userAgent Electron/) = เครื่องเรา แม้ไม่มี preload bridge', async () => {
  const m = await load('1');
  fakeWindow({ hostname: 'localhost', ua: 'Mozilla/5.0 Electron/44.4.4' });
  assert.equal(m.isPublicHostname(), false);
  assert.equal(m.isLocalHostname(), true);
});

// ── 2) static export ที่เปิดด้วย file:// (hostname ว่าง) = เครื่องเรา ──
test('file:// (static export ของแอป desktop) = เครื่องเรา', async () => {
  const m = await load('1');
  fakeWindow({ hostname: '', protocol: 'file:' });
  assert.equal(m.isPublicHostname(), false, 'file:// ไม่ใช่ผู้มาเยือนภายนอก');
  assert.equal(m.isLocalHostname(), true);
});

test('hostname ว่าง (ไม่มีทั้ง bridge และ file:) = เครื่องเรา', async () => {
  const m = await load('0');
  fakeWindow({ hostname: '' });
  assert.equal(m.isPublicHostname(), false);
});

// ── 3) เว็บต้องไม่พัง — สาธารณะยังเป็นสาธารณะ ──
test('เว็บโดเมนจริง + build public = สาธารณะ (ไม่ถูก desktop guard ไปบัง)', async () => {
  const m = await load('1');
  fakeWindow({ hostname: 'sovereignoriginshop.dpdns.org', ua: 'Mozilla/5.0' });
  assert.equal(m.isPublicHostname(), true);
  assert.equal(m.isLocalHostname(), false);
});

test('เว็บโดเมนจริง + build ปกติ = สาธารณะ (ตรวจ runtime)', async () => {
  const m = await load('0');
  fakeWindow({ hostname: 'sovereignoriginshop.dpdns.org' });
  assert.equal(m.isPublicHostname(), true);
});

test('localhost เปล่า ๆ (เบราว์เซอร์บนเครื่อง) = เครื่องเรา', async () => {
  const m = await load('1');
  fakeWindow({ hostname: 'localhost' });
  assert.equal(m.isLocalHostname(), true);
});

test('LAN IP = เครื่องเรา', async () => {
  const m = await load('1');
  fakeWindow({ hostname: '192.168.1.102' });
  assert.equal(m.isLocalHostname(), true);
});

// ── 4) SSR ต้องคืน false (ไม่มี window) เหมือนเดิม ──
test('SSR (ไม่มี window) = ไม่ใช่สาธารณะ', async () => {
  const m = await load('0');
  delete globalThis.window;
  assert.equal(m.isPublicHostname(), false);
});

// ── 5) ระบบสนามทดลองถูกถอดออกจากโปรเจกต์นี้แล้ว (13/10/69) ──
test('หน้าสนามทดลอง /demo ไม่อยู่ในโปรเจกต์อีกแล้ว', () => {
  const demoPage = path.join(ROOT, 'sovereign-frontend', 'src', 'pages', 'demo.tsx');
  assert.equal(fs.existsSync(demoPage), false, 'pages/demo.tsx ต้องถูกลบออก (ย้ายไป E:\\My work\\Sovereign-Demo-Standalone)');
  const svc = path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'services', 'demo-sandbox.service.ts');
  assert.equal(fs.existsSync(svc), false, 'demo-sandbox.service.ts ต้องถูกลบออก');
});

test('ไม่มีลิงก์หรือ import ที่ชี้ไป /demo เหลือในโค้ดฝั่งหน้าเว็บ', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const src = path.join(ROOT, 'sovereign-frontend', 'src');
  const bad = walk(src)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => {
      const code = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      return /href=["']\/demo|["']\/demo["']|DemoExplain|trackDemoTab/.test(code);
    })
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, [], `ยังมีโค้ดอ้าง /demo:\n  ${bad.join('\n  ')}`);
});

test('backend ไม่ mount /api/demo แล้ว', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'routes.ts'), 'utf8');
  // ข้ามบรรทัดคอมเมนต์ (คอมเมนต์ที่อธิบายว่า "ถอด /api/demo ออกแล้ว" ไม่ใช่คำสั่ง)
  const code = raw.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /demoRoutes|\/api\/demo/, 'routes.ts ต้องไม่ mount /api/demo');
});

// ── 6) next.config.js ต้องไม่เปิด public mode ตอน static export (กันซ้ำ) ──
test('next.config.js ปิด public mode ตอน SOVEREIGN_STATIC_EXPORT=1', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sovereign-frontend', 'next.config.js'), 'utf8');
  assert.match(src, /SOVEREIGN_STATIC_EXPORT !== '1'/, 'ธง public ต้องถูกปิดตอน export เดสก์ท็อป');
});