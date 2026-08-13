// ─────────────────────────────────────────────────────────────
//  One-off: อัปเกรด header เก่าทุกหน้า → ใช้ <PageHeader /> ร่วมกัน
//  รัน: node scripts/upgrade-headers.mjs
//  ข้ามไฟล์ที่ใช้ PageHeader อยู่แล้ว / หน้า bespoke (healing, portfolio)
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = join(ROOT, 'src', 'pages');

// href → กลุ่มเมนู (สำหรับ eyebrow)
const GROUP_MAP = {
  '/dashboard': 'ภาพรวม',
  '/sensors': 'อุปกรณ์ & พลังงาน', '/energy': 'อุปกรณ์ & พลังงาน', '/predictive': 'อุปกรณ์ & พลังงาน',
  '/relay': 'อุปกรณ์ & พลังงาน', '/automation': 'อุปกรณ์ & พลังงาน', '/ota': 'อุปกรณ์ & พลังงาน',
  '/security': 'ความปลอดภัย', '/ai-agent': 'ความปลอดภัย', '/ai': 'ความปลอดภัย', '/vision': 'ความปลอดภัย',
  '/property': 'ความปลอดภัย', '/alerts': 'ความปลอดภัย', '/risk-monitor': 'ความปลอดภัย', '/infrastructure': 'ความปลอดภัย',
  '/health': 'ชีวิต & การเงิน', '/inventory': 'ชีวิต & การเงิน', '/farm': 'ชีวิต & การเงิน',
  '/portfolio': 'ชีวิต & การเงิน', '/knowledge': 'ชีวิต & การเงิน', '/healing': 'ชีวิต & การเงิน',
  '/history': 'ข้อมูล & รายงาน', '/reports': 'ข้อมูล & รายงาน',
  '/system': 'ระบบ', '/backup': 'ระบบ', '/users': 'ระบบ', '/audit': 'ระบบ', '/settings': 'ระบบ',
};

const HEADER_RE = /<header\s+className="bg-gray-900 border-b border-gray-700 px-6 py-3[^"]*">([\s\S]*?)<\/header>/;
const IMPORT_RE = /import PageHeader from '..\/components\/ui\/PageHeader';/;

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

const files = readdirSync(PAGES).filter((f) => f.endsWith('.tsx'));
let converted = 0, skipped = 0, errors = 0;

for (const file of files) {
  const path = join(PAGES, file);
  let src = readFileSync(path, 'utf8');

  if (IMPORT_RE.test(src)) { skipped++; continue; }
  const m = src.match(HEADER_RE);
  if (!m) { skipped++; continue; }

  const inner = m[1];
  const h1End = inner.indexOf('</h1>');
  if (h1End === -1) { console.log(`  ✗ ${file}: ไม่พบ </h1>`); errors++; continue; }

  const h1part = inner.slice(0, h1End + 5);
  const rest = inner.slice(h1End + 5).trim();

  // title: ข้อความตรง ๆ ใน h1 (ตัด <span> subtitle ทิ้ง)
  const titleMatch = h1part.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  let titleHtml = titleMatch ? titleMatch[1].trim() : '';
  let subtitle = undefined;
  const spanIdx = titleHtml.indexOf('<span');
  if (spanIdx !== -1) {
    subtitle = titleHtml.slice(spanIdx).replace(/<span[^>]*>([\s\S]*?)<\/span>/, '$1').trim();
    titleHtml = titleHtml.slice(0, spanIdx).trim();
  }

  const href = '/' + file.replace(/\.tsx$/, '');
  const eyebrow = GROUP_MAP[href] || undefined;

  const actions = rest
    ? ` actions={${rest}}`
    : '';
  const sub = subtitle
    ? `\n          subtitle="${esc(subtitle)}"`
    : '';
  const brow = eyebrow
    ? `\n          eyebrow="${esc(eyebrow)}"`
    : '';

  const newHeader =
    `<header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">\n` +
    `        <PageHeader${brow}\n          title="${esc(titleHtml)}"${sub}${actions}\n        />\n` +
    `      </header>`;

  src = src.replace(m[0], newHeader);

  // เติม import (ต่อท้าย import ของ Sidebar หรือไฟล์แรกสุด)
  const importLine = `import PageHeader from '../components/ui/PageHeader';`;
  if (!src.includes(importLine)) {
    if (src.includes("import Sidebar from '../components/layout/Sidebar';")) {
      src = src.replace(
        "import Sidebar from '../components/layout/Sidebar';",
        "import Sidebar from '../components/layout/Sidebar';\n" + importLine
      );
    } else {
      src = src.replace(/(import [^\n]+;\n)/, `$1${importLine}\n`);
    }
  }

  writeFileSync(path, src);
  console.log(`  ✓ ${file}${subtitle ? ` — subtitle: "${subtitle.slice(0, 40)}"` : ''}`);
  converted++;
}

console.log(`\nเสร็จ: แปลง ${converted} หน้า, ข้าม ${skipped} หน้า, error ${errors}`);
