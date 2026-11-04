#!/usr/bin/env node
// tools/verify/open-core-boundary.mjs — วัดและกัน "เส้นแบ่ง CE/Pro" ตาม docs/OPEN-CORE.md
//
// ใช้ทำ 2 อย่าง:
//   1) รายงาน (default): แต่ละ Pro area มีไฟล์เท่าไร อยู่ในที่ไหน
//   2) ด่าน (--check): exit 1 ถ้าไฟล์ CE ไป import ของ Pro (จะทำให้แยก repo ไม่ได้จริง)
//
// เหตุผลที่ต้องมีด่านนี้: การ "ย้ายโฟลเดอร์" ทำได้ในครึ่งชั่วโมง แต่การไล่ import ที่ผูกกัน
// อยู่คือส่วนที่ทำให้ CE build ไม่ผ่านหลังแยก — ต้องเห็นก่อนแยก ไม่ใช่หลังแยก
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRO_AREAS = {
  business: {
    label: 'ร้านค้า/ออเดอร์/ใบกำกับ',
    modules: ['business'],
    pages: ['business', 'ecosystem'],
    routes: ['/api/business', '/api/ecosystem'],
  },
  restaurant: {
    label: 'จักรวรรดิร้านอาหาร (POS/เมนู/สต็อก)',
    modules: ['restaurant'],
    pages: ['restaurant'],
    routes: ['/api/restaurant'],
  },
  treasury: {
    label: 'การเงิน/พอร์ต/บัญชี',
    modules: ['treasury', 'dime', 'portfolio', 'payments'],
    pages: ['treasury', 'portfolio'],
    routes: ['/api/treasury', '/api/dime', '/api/portfolio', '/api/payments'],
  },
  fleet: {
    label: 'Fleet Control Plane (องค์กร)',
    modules: ['fleet'],
    pages: ['fleet'],
    routes: ['/api/fleet'],
  },
};

const PRO_MODULE_TO_AREA = new Map();
const PRO_PAGE_TO_AREA = new Map();
for (const [area, def] of Object.entries(PRO_AREAS)) {
  for (const m of def.modules) PRO_MODULE_TO_AREA.set(m, area);
  for (const p of def.pages) PRO_PAGE_TO_AREA.set(p, area);
}

const toPosix = (p) => p.split(sep).join('/');

/** 'pro:<area>' หรือ 'ce' */
export function classifyPath(pathLike) {
  const p = toPosix(pathLike);
  const mod = p.match(/src\/modules\/([^/]+)\//);
  if (mod && PRO_MODULE_TO_AREA.has(mod[1])) return `pro:${PRO_MODULE_TO_AREA.get(mod[1])}`;
  const page = p.match(/src\/pages\/([^/.]+)(?:\.tsx|\/)/);
  if (page && PRO_PAGE_TO_AREA.has(page[1])) return `pro:${PRO_PAGE_TO_AREA.get(page[1])}`;
  return 'ce';
}

const IMPORT_LINE = /(?:from\s+['"]|require\(\s*['"])([^'"]+)['"]/g;

/** หาไฟล์ CE ที่ import ของ Pro */
export function findViolations({ files, readFile }) {
  const out = [];
  for (const file of files) {
    if (classifyPath(file) !== 'ce') continue;
    const src = readFile(file) ?? '';
    for (const m of src.matchAll(IMPORT_LINE)) {
      const target = m[1];
      const hit = [...PRO_MODULE_TO_AREA.keys()].find((slug) => new RegExp(`(^|/)${slug}/`).test(target));
      if (hit) out.push({ file, reason: `import ${target} (โมดูล Pro: ${hit})` });
    }
  }
  return out;
}

// ── CLI ────────────────────────────────────────────────────────────────────
function walk(root) {
  const out = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    out.push(toPosix(join(entry.parentPath ?? entry.path, entry.name)));
  }
  return out;
}

const isMain = process.argv[1] && toPosix(process.argv[1]).endsWith('tools/verify/open-core-boundary.mjs');
if (isMain) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const check = process.argv.includes('--check');
  const roots = ['sovereign-os/core-api/src', 'sovereign-frontend/src'].map((r) => join(ROOT, r));
  const files = roots.flatMap((r) => walk(r).map((f) => toPosix(relative(ROOT, f))));

  const buckets = new Map(Object.keys(PRO_AREAS).map((a) => [`pro:${a}`, []]));
  for (const f of files) {
    const cls = classifyPath(f);
    if (cls.startsWith('pro:')) buckets.get(cls).push(f);
  }

  console.log('=== ขอบเขต Pro ใน repo นี้ ===');
  for (const [area, def] of Object.entries(PRO_AREAS)) {
    const list = buckets.get(`pro:${area}`);
    console.log(`${area.padEnd(11)} ${String(list.length).padStart(3)} ไฟล์ — ${def.label}`);
  }

  const violations = findViolations({ files, readFile: (f) => readFileSync(join(ROOT, f), 'utf8') });
  console.log(`\n=== CE ที่อ้างถึง Pro: ${violations.length} จุด ===`);
  for (const v of violations.slice(0, 20)) console.log(`- ${v.file}: ${v.reason}`);
  if (violations.length > 20) console.log(`… อีก ${violations.length - 20} จุด`);

  if (check && violations.length > 0) {
    console.error('\nไม่ผ่าน: ต้องแก้ import เหล่านี้ก่อนแยก Pro ออกจาก repo');
    process.exit(1);
  }
}
