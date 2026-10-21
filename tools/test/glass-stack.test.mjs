// เทสต์ของชุดวัสดุ "Liquid Glass" ฝั่ง frontend (โฟลเดอร์ src/components/glass)
//
// ทำไมต้องมี — เจอของจริงตอนเลือกไลบรารี (21/10/69):
//   • liquid-glass-react (ดาวเยอะสุด 6.4k, MIT) บังคับ peer react >= 19 ทุกเวอร์ชัน
//     ⇒ โปรเจกต์นี้ใช้ React 18.3.1 → npm install ล้ม (ERESOLVE) หรือถ้าฝืนด้วย
//     --legacy-peer-deps จะพังตอน tsc/เรนเดอร์ ⇒ ต้องใช้ตัวที่ประกาศรองรับ React 18
//   • ไลบรารี WebGL (three/@react-three/fiber) ถ้าถูก import จากหน้าโดยตรงจะพังตอน SSR
//     (window ไม่มีตอน build) ⇒ ต้องเข้าทาง next/dynamic + ssr:false เท่านั้น
//   • global CSS ของ Pages Router import ได้เฉพาะ _app.tsx — ถ้าเผลอ import ใน
//     คอมโพเนนต์ next build จะล้มทั้งก้อน ("Global CSS cannot be imported from ...")
//   • ต้องเคารพ prefers-reduced-motion: ผู้ใช้ที่ตั้งไว้ต้องไม่ถูกบังคับให้ดูภาพวิ่งตลอด
//
// เทสต์นี้อ่านไฟล์/package.json ตรง ๆ (ไม่ต้อง build) จึงเร็วและจับ regression ได้ทันที
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FRONTEND = path.join(REPO, 'sovereign-frontend');
const SRC = path.join(FRONTEND, 'src');
const GLASS_DIR = path.join(SRC, 'components', 'glass');

const readText = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(readText(p));

/** ไฟล์ .ts/.tsx ทั้งหมดใต้ src (ไม่รวม node_modules/.next) */
function sourceFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/** import specifier ทั้งหมด (static + dynamic + side-effect) */
function importSpecs(file) {
  const src = readText(file);
  const out = [];
  const re = /(?:import\s[^'"()]*?from\s*|export\s[^'"()]*?from\s*|import\s*\(|(?:^|\n)\s*import\s)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push({ spec: m[1], static: !/import\s*\(/.test(m[0]) });
  return out;
}

/** ตรวจว่า peer range รองรับ React 18 หรือไม่ (พอสำหรับกันของที่บังคับ >=19) */
function peerAcceptsReact18(range) {
  if (!range) return true; // ไม่ประกาศ = ไม่บล็อก
  const r = String(range);
  if (r.includes('*')) return true;
  if (/(?:>=|>|\^|~)\s*19|19\.\d/.test(r) && !/18/.test(r)) return false;
  return /18/.test(r);
}

function lineCount(file) {
  return readText(file).split('\n').length;
}

const pkg = readJson(path.join(FRONTEND, 'package.json'));
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

describe('ไลบรารีวัสดุ Liquid Glass — ต้องเข้ากับ React 18 ของโปรเจกต์', () => {
  test('ประกาศ dependency ครบทั้ง 3 ตัว', () => {
    assert.match(deps['@react-three/fiber'] || '', /^\^?8\./, '@react-three/fiber ต้องอยู่ไลน์ 8.x (คู่กับ React 18)');
    assert.ok(deps['@vepando/liquid-glass-react'], 'ขาด @vepando/liquid-glass-react (วัสดุกระจก)');
    assert.ok(deps['@shadergradient/react'], 'ขาด @shadergradient/react (ฉากไล่สี shader)');
  });

  test('ห้ามถอยไปใช้ liquid-glass-react (บังคับ React >= 19)', () => {
    assert.equal(deps['liquid-glass-react'], undefined, 'liquid-glass-react บังคับ React >= 19 — ใช้ @vepando/liquid-glass-react แทน');
    const lockPath = path.join(FRONTEND, 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      const lock = readJson(lockPath);
      assert.equal(lock.packages?.['node_modules/liquid-glass-react'], undefined, 'package-lock มี liquid-glass-react ค้างอยู่');
    }
  });

  test('peerDependencies ของทุกตัวรองรับ React 18', () => {
    for (const name of ['@react-three/fiber', '@vepando/liquid-glass-react', '@shadergradient/react']) {
      const p = path.join(FRONTEND, 'node_modules', name, 'package.json');
      if (!fs.existsSync(p)) continue; // เครื่องที่ยังไม่ npm install — ข้าม (เทสต์อื่นยังคุมอยู่)
      const peer = readJson(p).peerDependencies?.react;
      assert.ok(
        peerAcceptsReact18(peer),
        `${name} ประกาศ peer react="${peer}" ซึ่งไม่รองรับ React 18 ของโปรเจกต์`,
      );
    }
  });
});

describe('ขอบเขต client-only ของฉาก WebGL', () => {
  const heavy = [
    { module: 'ShaderGradientScene', wrapper: 'ShaderGradientBackdrop.tsx' },
    { module: 'GlassOrbScene', wrapper: 'GlassOrb.tsx' },
  ];

  for (const { module, wrapper } of heavy) {
    test(`${module} เข้าได้ทาง next/dynamic + ssr:false เท่านั้น`, () => {
      const offenders = [];
      for (const file of sourceFiles()) {
        const isWrapper = file.endsWith(path.join('glass', wrapper));
        for (const { spec, static: isStatic } of importSpecs(file)) {
          if (!spec.includes(module)) continue;
          // wrapper เองใช้ dynamic import (ไม่ใช่ static) — ยอมรับ
          if (isWrapper && !isStatic) continue;
          offenders.push(path.relative(REPO, file));
        }
      }
      assert.deepEqual(offenders, [], `${module} ถูก import แบบ static จาก: ${offenders.join(', ')}`);

      const wrapperSrc = readText(path.join(GLASS_DIR, wrapper));
      assert.match(wrapperSrc, /dynamic\(/, `${wrapper} ต้องใช้ next/dynamic`);
      assert.match(wrapperSrc, /ssr:\s*false/, `${wrapper} ต้องปิด SSR (ssr: false) — ไม่งั้น WebGL พังตอน build`);
    });
  }

  test('หน้าเพจทุกหน้าไม่แตะฉาก WebGL ตรง ๆ', () => {
    const pages = sourceFiles(path.join(SRC, 'pages'));
    const bad = pages.filter((f) => /ShaderGradientScene|GlassOrbScene/.test(readText(f)));
    assert.deepEqual(bad.map((f) => path.relative(REPO, f)), []);
  });
});

describe('CSS และการเคลื่อนไหว', () => {
  test('CSS ของไลบรารี import ครั้งเดียวใน _app.tsx', () => {
    const re = /(?:^|\n)\s*import\s+['"]@vepando\/liquid-glass-react\/style\.css['"]/;
    const hits = sourceFiles().filter((f) => re.test(readText(f)));
    assert.equal(hits.length, 1, `ต้องมี import CSS ครั้งเดียว พบ ${hits.length} ไฟล์`);
    assert.ok(hits[0].endsWith(path.join('pages', '_app.tsx')), 'global CSS ต้อง import ใน _app.tsx เท่านั้น');
  });

  test('ไม่มี global CSS ใหม่ถูก import นอก _app.tsx (Next จะพังตอน build)', () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      if (file.endsWith(path.join('pages', '_app.tsx'))) continue;
      const src = readText(file);
      const re = /(?:^|\n)\s*import\s+['"]([^'"]+\.css)['"]/g;
      let m;
      while ((m = re.exec(src))) offenders.push(`${path.relative(REPO, file)} → ${m[1]}`);
    }
    assert.deepEqual(offenders, [], `global CSS ต้องอยู่ใน _app.tsx เท่านั้น: ${offenders.join(', ')}`);
  });

  test('ฉากที่เคลื่อนไหวต้องเคารพ prefers-reduced-motion', () => {
    const hook = readText(path.join(GLASS_DIR, 'useReducedMotion.ts'));
    assert.match(hook, /prefers-reduced-motion/, 'hook ต้องอ่าน media query จริง');
    assert.match(hook, /typeof window/, 'hook ต้องกัน SSR (window ไม่มีตอน build)');

    for (const wrapper of ['ShaderGradientBackdrop.tsx', 'GlassOrb.tsx']) {
      const src = readText(path.join(GLASS_DIR, wrapper));
      assert.match(src, /useReducedMotion/, `${wrapper} ต้องเรียก useReducedMotion`);
      assert.match(src, /animate=/, `${wrapper} ต้องส่ง animate ลงฉาก`);
    }

    const gradient = readText(path.join(GLASS_DIR, 'ShaderGradientScene.tsx'));
    assert.match(gradient, /animate\s*\?\s*"on"\s*:\s*"off"/, 'ShaderGradientScene ต้องหยุด animation เมื่อ animate=false');
    const orb = readText(path.join(GLASS_DIR, 'GlassOrbScene.tsx'));
    assert.match(orb, /frameloop=\{animate\s*\?\s*"always"\s*:\s*"demand"\}/, 'GlassOrbScene ต้องเรนเดอร์เฟรมเดียวเมื่อ animate=false');
  });
});

describe('ขนาดไฟล์และโทนของวัสดุ', () => {
  test('คอมโพเนนต์แก้วทุกไฟล์อยู่ในเพดาน 400 บรรทัด', () => {
    const files = fs.readdirSync(GLASS_DIR).filter((f) => /\.(ts|tsx)$/.test(f));
    assert.ok(files.length >= 5, 'ต้องมีคอมโพเนนต์ชุดแก้วครบ (surface/backdrop/orb/palettes/hook)');
    for (const f of files) {
      const n = lineCount(path.join(GLASS_DIR, f));
      assert.ok(n <= 400, `${f} ยาว ${n} บรรทัด เกินเพดาน components ≤ 400`);
    }
  });

  test('GlassSurface ครบทั้ง 3 โทน และปิดชั้นหักเหได้', () => {
    const src = readText(path.join(GLASS_DIR, 'GlassSurface.tsx'));
    for (const tone of ['panel', 'contrast', 'light']) {
      assert.match(src, new RegExp(`${tone}:\\s*"`), `ขาด tint ของโทน ${tone}`);
    }
    assert.match(src, /refraction=\{refraction \? 1 : 0\}/, 'ต้องส่ง refraction ลงไลบรารีเพื่อปิดชั้นหักเหได้');
  });
});
