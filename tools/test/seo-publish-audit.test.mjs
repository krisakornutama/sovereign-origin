// เทสต์ tools/verify/seo-publish-audit.mjs — ตัวที่ตอบคำถาม "หน้าสาธารณะที่พร้อมประกาศ แต่ยังไม่ถูกประกาศ มีไหม"
//
// เหตุผลที่ต้องมี: รุ่นแรกของเครื่องมือรายงาน "ผ่าน" ทั้งที่ยังหาหน้าที่หลุดไม่พบ
// เพราะ (ก) อ่านรายการหน้าสาธารณะด้วย regex จากซอร์ส → เปลี่ยนรูปแบบแล้วได้ 0 เงียบ ๆ
// (ข) คิดเฉพาะหน้าที่ "ประกาศ index" → หน้าที่ยังไม่ประกาศอะไรเลย (robots=none)
//     และหน้าที่ประกาศ noindex หายไปจากการตรวจทั้งหมด (เกิดจริงกับ /partners/me)
// ถ้าไม่มีเทสต์ คนแก้ regex/เงื่อนไขพลาดจะทำให้ gate ผ่านตลอดโดยที่ตรวจอะไรไม่ได้เลย
//
// กติกาที่เทสต์นี้ป้องกัน (แก้ไฟล์นี้เมื่อกติกาในเครื่องมือเปลี่ยน):
//   1) รายการหน้าสาธารณะต้องมาจากของจริง และอ่านไม่ได้ต้อง "ดัง" ไม่ใช่ผ่าน
//   2) ทุก route บนดิสก์ต้องถูกจัดเข้ากองเสมอ (ไม่มีหน้าไหนหายไปเงียบ)
//   3) หน้าที่ประกาศ index แต่ไม่อยู่ใน sitemap = ต้องจับ (บั๊กรุ่นแรก)
//   4) หน้าที่อยู่ใน sitemap แต่เป็น noindex = ต้องจับ (ขัดกันเอง)
//   5) ป้าย auth-free ใช้ตอนพิมพ์อย่างเดียว ห้ามกรองข้อผิดพลาดออก
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, classify, enumerateRoutes, isAuthFree, loadPublicPaths } from '../verify/seo-publish-audit.mjs';

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (d ? ' — ' + d : '')); if (!ok) fails++; };

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PAGES = join(ROOT, 'sovereign-frontend', 'src', 'pages');
const ACCESS = join(ROOT, 'sovereign-frontend', 'src', 'lib', 'publicAccess.ts');

// โฟลเดอร์ fixture ชั่วคราว (อยู่ใต้ tools/test ซึ่ง .gitignore ไม่เก็บอยู่แล้ว · ลบทิ้งทุกครั้ง)
const TMP = join(dirname(fileURLToPath(import.meta.url)), '.audit-tmp');
const tmpFile = (name, content) => {
  const f = join(TMP, name);
  writeFileSync(f, content, 'utf8');
  return f;
};
const throws = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

// ─────────────────────────────────────────────────────────────
// 1) classify() — กติกา robots เดิม ต้องไม่ถูกทำให้อ่อนลง
// ─────────────────────────────────────────────────────────────
check('SeoHead ปกติ = index', classify('<SeoHead title="t" description="d" path="/x" />') === 'index');
check('meta index,follow = index', classify('<Head><meta name="robots" content="index,follow" /></Head>') === 'index');
check('SeoHead noindex prop = noindex',
  classify('<SeoHead title="t" path="/x" noindex />') === 'noindex');
check('meta noindex = noindex', classify('<Head><meta name="robots" content="noindex" /></Head>') === 'noindex');
check('หน้าธรรมดา = none', classify('export default function Dashboard() { return <div/>; }') === 'none');
check('มีทั้งสองแบบ = noindex (ตัวที่เข้มกว่าชนะ)',
  classify('<meta name="robots" content="noindex" /><SeoHead path="/x" />') === 'noindex');

// ─────────────────────────────────────────────────────────────
// 2) รายการหน้าสาธารณะต้องมาจากของจริง (import) ไม่ใช่ regex
// ─────────────────────────────────────────────────────────────
const realPaths = await loadPublicPaths();
check('อ่าน PUBLIC_PATHS จากโมดูลจริงได้', realPaths.length === 11, `${realPaths.length} URL`);
check('รายการจริงมี /shop และ /trace', realPaths.includes('/shop') && realPaths.includes('/trace'));
check('ทุก path เป็นข้อความขึ้นต้น /', realPaths.every((p) => typeof p === 'string' && p.startsWith('/')));

// ─────────────────────────────────────────────────────────────
// 3) ข้อมูลเสียต้องดัง ไม่ใช่ผ่านเงียบ ๆ (บั๊กรุ่นแรกคือรายงาน 0 URL แล้วผ่าน)
// ─────────────────────────────────────────────────────────────
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
try {
  const broken = await throws(() => loadPublicPaths(tmpFile('syntax.ts', 'export const PUBLIC_PATHS = ;')));
  check('syntax ของไฟล์พัง → throw', broken.includes('อ่านรายการหน้าสาธารณะไม่ได้'), broken.slice(0, 60));

  const notArray = await throws(() => loadPublicPaths(tmpFile('notarray.ts', 'export const PUBLIC_PATHS = { path: "/" };')));
  check('ไม่ใช่ array → throw', notArray.includes('ไม่ได้ export PUBLIC_PATHS เป็น array'), notArray.slice(0, 70));

  const empty = await throws(() => loadPublicPaths(tmpFile('empty.ts', 'export const PUBLIC_PATHS = [];')));
  check('array ว่าง → throw (ห้ามรายงาน 0 URL ว่าผ่าน)', empty.includes('ว่างเปล่า'), empty.slice(0, 60));

  const badShape = await throws(() => loadPublicPaths(tmpFile('shape.ts', 'export const PUBLIC_PATHS = [{ href: "/" }];')));
  check('path ผิดรูป → throw', badShape.includes('path ไม่ใช่ข้อความ'), badShape.slice(0, 60));

  const dup = await throws(() => loadPublicPaths(tmpFile('dup.ts', 'export const PUBLIC_PATHS = [{ path: "/" }, { path: "/" }];')));
  check('path ซ้ำ → throw', dup.includes('ซ้ำ'), dup.slice(0, 50));

  const missing = await throws(() => loadPublicPaths(tmpFile('gone.ts', 'export const SOMETHING = 1;')));
  check('ไม่มี export PUBLIC_PATHS → throw', missing.includes('ไม่มี export'), missing.slice(0, 70));
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────
// 4) ทุก route บนดิสก์ต้องถูกเดินเจอ (รวมหน้าที่เคยหลุด)
// ─────────────────────────────────────────────────────────────
const { routes, nonPageRoutes } = enumerateRoutes(PAGES);
const routeNames = routes.map((r) => r.route);
check('เดิน src/pages เจอทุกไฟล์หน้า', routes.length === 64, `${routes.length} route`);
check('เจอ /partners/me (หน้าที่เคยหลุด)', routeNames.includes('/partners/me'));
check('เจอหน้าที่ซ้อน /mbti/compare และ /terrain-demo', routeNames.includes('/mbti/compare') && routeNames.includes('/terrain-demo'));
check('index.tsx → /', routeNames.includes('/') && !routeNames.includes('/index'));
check('ไม่นับ _app/_document เป็น route', !routeNames.some((r) => r.includes('_app') || r.includes('_document')));
check('ไฟล์ route ที่ไม่ใช่หน้าแยกไว้ (/sitemap.xml)', nonPageRoutes.map((r) => r.route).includes('/sitemap.xml'));

// ─────────────────────────────────────────────────────────────
// 5) audit() จริง — /partners/me ต้อง "ถูกนับ" ไม่ใช่หายไป
// ─────────────────────────────────────────────────────────────
const real = await audit();
const bucketTotal = Object.values(real.buckets).reduce((n, l) => n + l.length, 0);
check('ทุก route ถูกจัดเข้ากองครบ (ไม่มีหน้าหาย)', bucketTotal === real.routes.length, `${bucketTotal}/${real.routes.length}`);
const me = real.excluded.find((c) => c.route === '/partners/me');
check('/partners/me ถูกรายงานว่าตัดสินใจไม่ประกาศแล้ว', !!me, me ? me.why : 'ไม่พบในรายงานเลย');
check('/partners/me ไม่ถูกนับเป็นหน้าค้าง (noindex = ตัดสินใจแล้ว)', !real.candidates.some((c) => c.route === '/partners/me'));
check('/partners/me ไม่ถูกนับเป็นข้อผิดพลาด (ตั้งใจไม่ประกาศ = ถูกต้อง)', !real.findings.some((f) => f.includes('/partners/me')));
check('ไม่มีข้อผิดพลาดในสถานะปัจจุบัน', real.findings.length === 0, real.findings.join(' | '));
check('ไม่มีหน้าที่ยังไม่ได้ตัดสินใจเหลือ (undecided = 0)', real.candidates.length === 0, real.candidates.map((c) => c.route).join(', '));
check('หน้าที่สั่ง noindex ถูกลิสต์ครบ', real.excluded.length === 4, real.excluded.map((c) => c.route).join(', '));

// ─────────────────────────────────────────────────────────────
// 6) กติกาที่จับบั๊กได้จริง — ทดสอบกับ fixture สังเคราะห์
// ─────────────────────────────────────────────────────────────
rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, 'pages'), { recursive: true });
try {
  const p = join(TMP, 'pages');
  writeFileSync(join(p, 'index.tsx'), '<SeoHead title="t" path="/" />');                       // index · อยู่ในรายการ
  writeFileSync(join(p, 'about.tsx'), '<SeoHead title="t" path="/about" />');                    // index · ไม่อยู่ในรายการ → ต้องจับ
  writeFileSync(join(p, 'secret.tsx'), '<meta name="robots" content="noindex" />');               // noindex · อยู่ในรายการ → ต้องจับ (ขัดกัน)
  writeFileSync(join(p, 'private.tsx'), '<meta name="robots" content="noindex" />');              // noindex · ไม่อยู่ในรายการ → ตัดสินใจแล้ว
  writeFileSync(join(p, 'hidden.tsx'), 'useAuthStore((s) => s.isAuthenticated); <SeoHead path="/hidden" />'); // auth แต่ประกาศ index ไม่อยู่ในรายการ → ต้องจับ
  writeFileSync(join(p, 'dashboard.tsx'), "import { useAuthStore } from '../stores/useAuthStore';");  // none + auth → หน้าในระบบ
  const list = tmpFile('list.ts', "export const PUBLIC_PATHS = [{ path: '/' }, { path: '/secret' }, { path: '/gone' }];");

  const r = await audit({ pagesDir: p, accessFile: list });
  const has = (frag) => r.findings.some((f) => f.includes(frag));

  check('index แต่ไม่อยู่ใน sitemap → จับ', has('/about ประกาศ index'), r.findings.join(' | '));
  check('อยู่ใน sitemap แต่ noindex → จับ', has('/secret อยู่ใน sitemap แต่หน้าเป็น noindex'));
  check('sitemap มี URL ที่ไม่มีไฟล์หน้า → จับ', has('sitemap มี /gone'));
  check('ป้าย auth กรองข้อผิดพลาดไม่ได้ (/hidden ยังถูกจับ)', has('/hidden ประกาศ index'));
  check('รวมแล้ว 4 ข้อผิดพลาด', r.findings.length === 4, `${r.findings.length}`);
  check('หน้าในระบบ (auth + ไม่มี robots) ไม่ถูกทำเป็นข้อผิดพลาด', r.buckets.internal.length === 1 && r.candidates.length === 0);
  check('noindex ที่ไม่อยู่ใน sitemap ถูกนับเป็น “ตัดสินใจแล้ว” ไม่ใช่งานค้าง', r.excluded.length === 1 && r.excluded[0].route === '/private');
  check('noindex ที่อยู่ใน sitemap เป็นข้อผิดพลาด ไม่ใช่งานที่ตัดสินใจแล้ว', !r.excluded.some((c) => c.route === '/secret'));
  check('รายการตายไม่ทำให้การจัดกองครบพัง', Object.values(r.buckets).reduce((n, l) => n + l.length, 0) === r.routes.length);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────
// 7) isAuthFree = ป้ายกำกับ ไม่ใช่เงื่อนไขตัดสิน
// ─────────────────────────────────────────────────────────────
check('ไม่อ้าง auth store = auth-free', isAuthFree('export default function P(){return <div/>}') === true);
check('อ้าง auth store = หน้าในระบบ', isAuthFree("import { useAuthStore } from 'x';") === false);

console.log(fails === 0 ? '\nผ่านทั้งหมด' : `\nFAIL ${fails} เคส`);
process.exitCode = fails === 0 ? 0 : 1;