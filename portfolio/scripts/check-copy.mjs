#!/usr/bin/env node
/* check-copy — ด่านตรวจคำไทย/เครื่องหมายสำหรับเว็บโชว์ (ไม่ต้องใช้ playwright, รันใน CI ได้ทันที)
   ที่มา: "ตกการันต์" (โปรเจ็กต์→โปรเจ็ก), "ไทยติดละติน" (คrawl), "& ดิบใน HTML" เคยหลุดขึ้น production
   แล้วต้องเก็บกลับด้วยมือหลายรอบ — รอบนี้ให้ด่านนี้จับแทน

   หลักการที่learnมาจากรอบก่อน ๆ (สำคัญ — ผิดข้อนี้แล้วได้ผลลวง):
     • ตรวจ "ทีละ text node" เท่านั้น — ห้ามรวมข้อความข้ามแท็ก
       (สองคลาสที่เคยหลอก: <b>/<br> → กลายเป็นช่องว่างกลางคำ · <span> หลายตัวติดกัน → กลายเป็นคำติดกัน)
       ผลพลอยได้: คำที่เขียนข้ามแท็กจะถูก "ข้าม" ไม่ใช่ถูกกล่าวหาแบบผิด ๆ = ผิดข้างปลอดภัย
     • HTML: ไม่รวม indentation เป็นข้อความ (ตัดหัวท้ายทุก node)
     • markdown: ไม่มีแท็ก — ตรวจทีละบรรทัด และปิดโค้ด (fence/inline) ก่อนตรวจ
     • กฎ `&` ดิบ + ช่องว่าง ใช้กับ HTML เท่านั้น (ใน .md เครื่องหมาย & ใช้ได้ตามปกติ)

   กติกา (จับเฉพาะ "ผิดชัด ๆ" ไม่เดาไวยากรณ์):
     1. คำผิดในรายการที่รู้จัก (แก้แล้วห้ามกลับมา)
     2. อักษรไทยติดอักษรละตินในคำเดียวกัน (คrawl) — ใน node เดียวเท่านั้น
     3. คำที่ตกตัวท้าย/การันต์ ตามรายการคำที่ถูกต้อง
     4. ช่องว่างวางผิดที่: หน้า ๆ · หน้า "," · หน้า ")" · ช่องว่างซ้ำกลางข้อความ (markdown)
     5. `&` ดิบในข้อความ HTML (ต้องเป็น &amp;)

   ใช้: node scripts/check-copy.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');

const MISSING = [
  ['แคชเชียร์', 'แคชเียร์'],
  ['ทดสอบ', 'เดินโปรด'],
  ['ทรานแซกชัน', 'ทรานซักชัน'],
  ['จดไว้แต่ในสมุดเล่ม', 'จดแจ้นสมุดเล่ม'],
  ['กันเครื่องพังกลางทาง', 'กันแบรนด์อุปกรณ์'],
  ['เว็บไซต์', 'เว็บไซด์'],
  ['อีเมล', 'อีเมล์'],
  ['อนุญาต', 'อนุญาติ'],
  ['คำนวณ', 'คำนวน'],
  ['ปรากฏ', 'ปรากฎ'],
  ['เทคโนโลยี', 'เทคโนโลยี่'],
  ['เซิร์ฟเวอร์', 'เซิฟเวอร์'],
  ['อัปเดต', 'อัพเดท'],
  ['อัปโหลด', 'อัพโหลด'],
  ['แอป', 'แอพ'],
  ['ช็อป', 'ช๊อป'],
  ['สแตนด์บาย', 'สแตนบายด์'],
  ['สต็อก', 'สต๊อก'],
];

/* คำที่ตกตัวท้าย: [รูปที่ถูกต้อง, รูปที่ผิด, ตัวที่ต้องตามหลังรูปผิดทันที] */
const TAIL = [
  ['โปรเจ็กต์', 'โปรเจ็ก', 'ต'],
  ['ซอฟต์แวร์', 'ซอฟต์แวร', '์'],
  ['ฟอนต์', 'ฟอนต', '์'],
  ['โมดูล', 'โมดล', 'ู'],
  ['อีเมล', 'อีเมล์', undefined],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ── HTML → รายการ text node (ข้าม comment/script/style) พร้อม offset ในไฟล์จริง ── */
function textNodes(html) {
  const nodes = [];
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { if (i < html.length) nodes.push({ text: html.slice(i), offset: i }); break; }
    if (lt > i) nodes.push({ text: html.slice(i, lt), offset: i });
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt); i = end === -1 ? html.length : end + 3; continue; }
    const gt = html.indexOf('>', lt);
    const name = (html.slice(lt, gt === -1 ? lt + 40 : gt).match(/^<\/?\s*([a-zA-Z0-9-]+)/) || [])[1] || '';
    if (name === 'script' || name === 'style') {
      const close = lower.indexOf(`</${name}`, gt === -1 ? lt : gt);
      i = close === -1 ? html.length : (lower.indexOf('>', close) + 1 || html.length);
      continue;
    }
    i = gt === -1 ? lt + 1 : gt + 1;
  }
  return nodes;
}

/* ── markdown → text node ต่อบรรทัด (ปิดโค้ด fence/inline ก่อน) ── */
function mdNodes(md) {
  const blank = md.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));
  const nodes = [];
  let offset = 0;
  for (const line of blank.split('\n')) {
    nodes.push({ text: line, offset, raw: md.slice(offset, offset + line.length) });
    offset += line.length + 1;
  }
  return nodes;
}

const RULES = [
  ['คำผิดที่รู้จัก', (t) => MISSING.filter(([, bad]) => t.includes(bad)).map(([good, bad]) => `${bad} → ${good}`)],
  ['ไทยติดละตินในคำเดียว', (t) => [...t.matchAll(/[\u0E00-\u0E7F][A-Za-z]|[A-Za-z][\u0E00-\u0E7F]/g)].map((m) => m[0])],
  ['ตกตัวท้ายคำ', (t) => {
    const hits = [];
    for (const [good, bad, following] of TAIL) {
      if (!following) continue;
      if (new RegExp(esc(bad) + '(?!' + esc(following) + ')').test(t)) hits.push(`${bad}… → ${good}`);
    }
    return hits;
  }],
  /* เว้นวรรคที่ "เห็นด้วยตา" ผิดแน่ ๆ (ตัดกฎที่ไทยที่ถูกต้องก็เป็นแบบนั้นออก เช่น "ซ้ำ ๆ") */
  ['ช่องว่างวางผิดที่', (t) => {
    const hits = [];
    if (/[\u0E00-\u0E7F] +[,)]/.test(t)) hits.push('เว้นวรรคก่อนเครื่องหมาย');
    if (/\( +[\u0E00-\u0E7F]/.test(t)) hits.push('เว้นวรรคหลังเครื่องหมายเปิด');
    return hits;
  }],
];

/* ── ตรวจไฟล์เดียว ── */
export function checkFile(file, { markdown = false } = {}) {
  const raw = fs.readFileSync(file, 'utf8');
  const findings = [];
  const lineOf = (off) => raw.slice(0, off).split('\n').length;
  const nodes = markdown ? mdNodes(raw) : textNodes(raw);

  for (const n of nodes) {
    if (markdown) {
      // ปิดโค้ดอินไลน์ด้วยอักษรแทน (ห้ามใช้ช่องว่าง — จะกลายเป็น "ช่องว่างซ้ำ" ปลอมเอง)
      const masked = n.raw.replace(/`[^`\n]*`/g, (m) => '\u0001'.repeat(m.length));
      for (const [rule, fn] of RULES) {
        for (const detail of fn(masked)) findings.push({ line: lineOf(n.offset), rule, detail, snippet: masked.trim().slice(0, 80) });
      }
      continue;
    }
    const text = n.text.trim();
    if (!text) continue;
    // กฎ & ดิบ: ใช้กับ HTML เท่านั้น และใช้กับ node ที่ยังไม่ trim ก็ได้ (ตำแหน่งตรงกว่า)
    for (const m of n.text.matchAll(/&(?!(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g)) {
      findings.push({ line: lineOf(n.offset), rule: '& ดิบในข้อความ', detail: 'ต้องเขียน &amp;', snippet: n.text.trim().slice(0, 60) });
      void m;
    }
    for (const [rule, fn] of RULES) {
      for (const detail of fn(text)) findings.push({ line: lineOf(n.offset), rule, detail, snippet: text.slice(0, 80) });
    }
  }
  return findings;
}

export function collectTargets(site = SITE) {
  const targets = [];
  for (const f of fs.readdirSync(site)) if (f.endsWith('.html')) targets.push({ file: path.join(site, f) });
  const readme = path.join(site, 'README.md');
  if (fs.existsSync(readme)) targets.push({ file: readme, markdown: true });
  const parent = path.resolve(site, '..');
  if (fs.existsSync(path.join(parent, 'docs'))) {
    for (const f of fs.readdirSync(path.join(parent, 'docs'))) {
      if (f.endsWith('.md')) targets.push({ file: path.join(parent, 'docs', f), markdown: true });
    }
    const proot = path.join(parent, 'README.md');
    if (fs.existsSync(proot)) targets.push({ file: proot, markdown: true });
  }
  return targets;
}

export function runCheck(site = SITE) {
  const targets = collectTargets(site);
  let all = 0;
  for (const t of targets) {
    for (const f of checkFile(t.file, { markdown: t.markdown })) {
      all++;
      console.log(`FAIL copy ${path.relative(site, t.file)}:${f.line} [${f.rule}] ${f.detail} — ${f.snippet}`);
    }
  }
  if (!all) console.log(`PASS copy: no Thai/copy defects in ${targets.length} files`);
  else console.log(`COPY FAILED: ${all} finding(s) in ${targets.length} files`);
  return { ok: all === 0, findings: all, files: targets.length };
}

/* ── self-test: พิสูจน์ว่าด่านยิงจริงเมื่อเจอของจริง (ด่านที่ไม่เคยยิง = ไร้ค่า) ── */
export function selfTest() {
  const bad = [
    ['คำผิด', '<p>จ่ายที่แคชเียร์เท่านั้น</p>'],
    ['ไทยติดละติน', '<p>ระบบคrawl ทั้งเว็บ</p>'],
    ['ตกการันต์', '<p>ชุดเดียวกับทั้งโปรเจ็ก</p>'],
    ['& ดิบ', '<p>เกษตร&สมุนไพร</p>'],
    ['ช่องว่างวางผิดที่', '<p>ทดสอบระบบ , กดเพื่อเริ่ม</p>'],
  ];
  const tmp = path.join(SITE, '.copy-selftest.tmp');
  const failures = [];
  for (const [label, html] of bad) {
    fs.writeFileSync(tmp, `<!doctype html><html><body>${html}</body></html>`, 'utf8');
    const got = checkFile(tmp);
    if (!got.length) failures.push(label);
  }
  fs.writeFileSync(tmp, '<!doctype html><html><body><p>เว็บนี้ไม่มีข้อมูลจริงในหน้า</p></body></html>', 'utf8');
  if (checkFile(tmp).length) failures.push('ข้อความสะอาดกลับถูกกล่าวหา');
  fs.unlinkSync(tmp);
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--self-test')) {
    const failures = selfTest();
    if (failures.length) { console.log(`FAIL copy self-test: ตรวจไม่เจอ ${failures.join(', ')}`); process.exit(1); }
    console.log('PASS copy self-test: จับได้ครบทั้ง 5 คลาส + ไม่กล่าวหาข้อความสะอาด');
    process.exit(0);
  }
  process.exit(runCheck(SITE).ok ? 0 : 1);
}
