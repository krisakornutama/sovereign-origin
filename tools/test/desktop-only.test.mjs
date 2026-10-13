// tools/test/desktop-only.test.mjs
//
// ── กัน "ส่วนเว็บ" ย้อนกลับเข้ามาในโปรเจกต์โดยไม่ตั้งใจ ──
//
// 13/10/69 คำสั่งเจ้าของ: "เว็บไซต์คุณไม่ต้องยุ่ง · คุณพัฒนาแค่ app desktop
// ตรงนี้เท่านั้น · ส่วน web สลัดออกจากโปรเจกต์นี้เร็วเข้า"
// → ส่วนเว็บทั้งหมดถูกถอดออกไป E:\My work\Sovereign-Web-Standalone
//   และ E:\My work\Sovereign-Demo-Standalone
//
// เทสต์นี้ไม่ได้กัน "ใครจะเพิ่มเว็บกลับ" (ตั้งใจเพิ่ม = ต้องรู้ก่อน)
// แต่กันหมวดที่ถูกถอดจริงไม่ให้หลุดกลับมาเงียบ ๆ เช่น import ค้างในไฟล์อื่น
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠ ต้องใช้ fileURLToPath ไม่ใช่ new URL(...).pathname
//   pathname คืน %20 แทนช่องว่าง → ROOT ผิด → ทุกเทสต์ผ่านมั่วโดยไม่ได้อ่านไฟล์จริง
//   (เจอจริง 13/10/69 ตอนพิสูจน์ red-first — repo นี้อยู่ใน "E:\My work\..." ที่มีช่องว่าง)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'sovereign-frontend', 'src');

assert.ok(fs.existsSync(FE), `หา sovereign-frontend/src ไม่เจอที่ ${FE} — เทสต์นี้จะผ่านมั่ว ห้ามปล่อยให้เงียบ`);

const walk = (d, out = []) => {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

/** โค้ดที่ "ใช้งานจริง" = ตัดบรรทัดคอมเมนต์ออก (คอมเมนต์ที่อธิบายว่า "ถอดออกแล้ว" ไม่ใช่คำสั่ง) */
const code = (p) =>
  fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── 1) หน้าเว็บสาธารณะต้องไม่อยู่ในโปรเจกต์ ──────────────────────────────
test('หน้าเว็บสาธารณะถูกถอดออกจากโปรเจกต์แล้ว', () => {
  const gone = [
    'pages/about.tsx', 'pages/shop.tsx', 'pages/community.tsx',
    'pages/partners.tsx', 'pages/partners/guide.tsx', 'pages/partners/me.tsx',
    'pages/software-pricing.tsx', 'pages/feedback-admin.tsx',
    'pages/mbti/compare.tsx', 'pages/sitemap.xml.ts',
  ];
  const left = gone.filter((rel) => fs.existsSync(path.join(FE, rel)));
  assert.deepEqual(left, [], `หน้าเว็บยังอยู่ในโปรเจกต์:\n  ${left.join('\n  ')}`);
});

// ── 2) คอมโพเนนต์/ไลบรารีของเว็บต้องไม่อยู่ ───────────────────────────────
test('คอมโพเนนต์ + ไลบรารีของเว็บถูกถอดออกแล้ว', () => {
  const gone = [
    'components/public/SeoHead.tsx', 'components/public/PageIntro.tsx',
    'components/public/FeedbackButton.tsx', 'components/public/SensorsPublic.tsx',
    'components/public/ShopPublicLanding.tsx', 'components/public/ShopCheckoutPanel.tsx',
    'lib/visitorTrack.ts',
  ];
  const left = gone.filter((rel) => fs.existsSync(path.join(FE, rel)));
  assert.deepEqual(left, [], `ไฟล์ของเว็บยังอยู่:\n  ${left.join('\n  ')}`);
});

// ── 3) ไม่มีโค้ดหน้าเว็บไหน import ของที่ถูกถอด ───────────────────────────
test('ไม่มีไฟล์ใด import ของเว็บที่ถูกถอด (FounderCredit ยังใช้ได้)', () => {
  const banned = /components[\\/]public[\\/](SeoHead|PageIntro|FeedbackButton|SensorsPublic|ShopPublicLanding|ShopCheckoutPanel)|[\\/]lib[\\/]visitorTrack/;
  const bad = walk(FE)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => banned.test(code(f)))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, [], `ยังมี import ของเว็บ:\n  ${bad.join('\n  ')}`);
});

// ── 4) หน้าแรกต้องเป็น "ประตูล็อกอิน" ล้วน ไม่มี landing สาธารณะ ──────────
test('หน้าแรกไม่มี branch สาธารณะเหลือ', () => {
  const src = code(path.join(FE, 'pages', 'index.tsx'));
  assert.doesNotMatch(src, /isPublicHostname|isLocalHostname|showPublic|trackCtaClick/, 'index.tsx ยังแตกแขนงสาธารณะอยู่');
  assert.match(src, /LoginForm/, 'index.tsx ต้องยังเป็นหน้าเข้าสู่ระบบ');
});

// ── 5) เมนูต้องไม่มีลิงก์ไปหน้าที่ถูกลบ ──────────────────────────────────
test('เมนูไม่มีลิงก์ไปหน้าเว็บที่ถูกถอด', () => {
  const nav = code(path.join(FE, 'lib', 'navigation.ts'));
  const gone = ['/community', '/shop', '/about', '/partners', '/hover-cards', '/software-pricing', '/feedback-admin'];
  const left = gone.filter((h) => nav.includes(`'${h}'`));
  assert.deepEqual(left, [], `เมนูยังลิงก์ไปหน้าที่ถูกถอด:\n  ${left.join('\n  ')}`);
});

// ── 6) backend ต้องไม่ mount เส้นทางสาธารณะของเว็บ ────────────────────────
test('backend ไม่ mount เส้นทางของเว็บแล้ว', () => {
  const routes = code(path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'routes.ts'));
  for (const mount of ['/api/shop', '/api/demo', '/api/feedback', '/api/partners', '/api/software']) {
    assert.ok(!routes.includes(`app.use('${mount}'`), `ยัง mount ${mount} อยู่`);
  }
  assert.doesNotMatch(routes, /businessShopRoutes|feedbackRoutes|analyticsRoutes|partnersRoutes|softwareRoutes/,
    'routes.ts ยัง import router ของเว็บอยู่');
});

// ── 7) service ของเว็บถูกถอดแล้ว ─────────────────────────────────────────
test('service ของเว็บถูกถอดออกจาก src/services แล้ว', () => {
  const gone = ['feedback.service.ts', 'partner.service.ts', 'partner-guard.service.ts',
    'software-catalog.service.ts', 'visitor-tracking.service.ts'];
  const left = gone.filter((f) => fs.existsSync(path.join(ROOT, 'sovereign-os', 'core-api', 'src', 'services', f)));
  assert.deepEqual(left, [], `service ของเว็บยังอยู่:\n  ${left.join('\n  ')}`);
});

// ── 8) สคริปต์/e2e ต้องไม่ยิงไปหน้าที่ถูกลบ ──────────────────────────────
test('สคริปต์และ e2e ไม่อ้างหน้าที่ถูกถอด', () => {
  const gone = ['/shop', '/about', '/partners', '/community', '/feedback-admin', '/software-pricing', '/demo'];
  const dirs = ['sovereign-frontend/e2e', 'sovereign-frontend/scripts', 'tools'];
  // ไฟล์เหล่านี้ตั้งใจ "พูดถึง" path ที่ถูกถอดโดยไม่ต้องแก้
  const ALLOW = new Set([
    'tools/test/desktop-only.test.mjs',               // ไฟล์เทสต์นี้เอง (รายการอยู่ใน source)
    'tools/verify/run-client-monitor-e2e.mjs',       // ใช้ '/shop' เป็น "ข้อมูลจำลอง" ของ crash reporter
  ]);
  const bad = [];
  for (const d of dirs) {
    for (const f of walk(path.join(ROOT, d))) {
      if (!/\.(ts|mjs|js)$/.test(f)) continue;
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      if (ALLOW.has(rel)) continue;
      const c = code(f);
      const hit = gone.filter((g) => c.includes(`'${g}'`) || c.includes(`"${g}"`));
      if (hit.length) bad.push(`${rel} → ${hit.join(', ')}`);
    }
  }
  assert.deepEqual(bad, [], `ยังอ้างหน้าที่ถูกถอด:\n  ${bad.join('\n  ')}`);
});

// ── 9) เอกสารต้องบอกว่า "ไม่ต้องใช้ tunnel/WAF ของเว็บแล้ว" ─────────────
test('ops-runbook มีหมายเหตุว่าโปรเจกต์นี้เป็นแอป desktop เท่านั้น', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'ops-runbook.md'), 'utf8');
  assert.match(md, /แอป desktop เท่านั้น/, 'ต้องมีหมายเหตุกันไม่ให้ใครไปตั้ง WAF/tunnel ของเว็บกับโปรเจกต์นี้');
});