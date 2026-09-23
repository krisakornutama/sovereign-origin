#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// gen-module-docs.mjs — สร้างเอกสาร docs/modules/<โมดูล>.md จาก "ของจริงในโค้ด"
// ดึง: route files + บรรทัด · endpoints · service ที่ทำงานให้ (serviceAliases)
//      · ตารางที่เป็นเจ้าของ (module-owners.json) · เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
// เจตนา/ข้อห้ามเฉพาะโมดูล = ช่องให้เจ้าของโมดูลเติม (เอกสารไม่เดาแทนโค้ด)
//
// กติกาไม่ทำลาย: ไฟล์ที่มีอยู่แล้ว (8 โมดูลหลักที่เขียนมือ) = ห้ามทับ เว้นแต่ --force
//                marker <!-- auto:begin --> … <!-- auto:end --> ใช้อัปเดตเฉพาะส่วนอัตโนมัติ
//
// ใช้: node tools/gen-module-docs.mjs [--force]
// ────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'sovereign-os', 'core-api');
const DOCS = join(ROOT, 'docs', 'modules');
const FORCE = process.argv.includes('--force');

const ownersJson = JSON.parse(readFileSync(join(ROOT, 'tools', 'module-owners.json'), 'utf8'));
const owners = ownersJson.owners ?? {};
const serviceAliases = ownersJson.serviceAliases ?? {};
let baseline = {};
try { baseline = JSON.parse(readFileSync(join(ROOT, 'tools', 'boundary-baseline.json'), 'utf8')).violations ?? {}; } catch {}

// ── schema: model(camel) → table ──
const schema = readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8');
const modelTable = {};
for (const m of schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{[^}]*?@@map\("([^"]+)"\)/gms)) {
  modelTable[m[1].charAt(0).toLowerCase() + m[1].slice(1)] = m[2];
}

// ── สแกน src: endpoints ต่อโมดูล + การใช้ prisma ต่อไฟล์ ──
const SRC = join(BACKEND, 'src');
const moduleInfo = {}; // module → { routes: [{file, lines}], endpoints: [], services: [], touches: Set(table) }
const info = (mod) => (moduleInfo[mod] ??= { routes: [], endpoints: [], services: [], touches: new Set() });
const aliasOf = (base) => serviceAliases[base] ?? serviceAliases[`${base}.service`] ?? `service:${base}`;
const walk = (dir) => {
  let list = [];
  try { list = readdirSync(dir); } catch { return; }
  for (const name of list) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (!/\.ts$/.test(name) || name.endsWith('.test.ts')) continue;
    const rel = relative(SRC, full).split(sep);
    const text = readFileSync(full, 'utf8');
    const lines = text.split('\n').length;
    if (rel[0] === 'modules') {
      const mod = rel[1];
      info(mod);
      if (rel[1 + 1] && rel[2]?.endsWith('.routes.ts')) {
        info(mod).routes.push({ file: rel.slice(1).join('/'), lines });
        for (const mm of text.matchAll(/\.(get|post|put|patch|delete)\('([^']+)'/g)) {
          info(mod).endpoints.push(`${mm[1].toUpperCase()} ${mm[2]}`);
        }
      }
    } else if (rel[0] === 'services' || rel[0] === 'workers') {
      const mod = aliasOf(rel[1]?.replace(/\.ts$/, ''));
      info(mod).services.push(rel[1]?.replace(/\.ts$/, ''));
    }
    for (const mm of text.matchAll(/\bprisma\.([a-z][A-Za-z0-9]*)\b/g)) {
      const table = modelTable[mm[1]];
      if (table && moduleInfo[rel[0] === 'modules' ? rel[1] : aliasOf(rel[1]?.replace(/\.ts$/, ''))]) {
        moduleInfo[rel[0] === 'modules' ? rel[1] : aliasOf(rel[1]?.replace(/\.ts$/, ''))].touches.add(table);
      }
    }
  }
};
walk(SRC);

// ── owners → ตารางต่อโมดูล ──
const tablesOf = {};
for (const [table, mod] of Object.entries(owners)) (tablesOf[mod] ??= []).push(table);

// ── เส้นข้ามที่ยอมรับแล้ว ต่อโมดูลต้นทาง ──
const crosses = {};
for (const key of Object.keys(baseline)) {
  const [from] = key.split(' → ');
  (crosses[from] ??= []).push(key);
}

const modules = Object.keys(moduleInfo).filter((m) => !m.startsWith('service:') && !m.startsWith('root:')).sort();
let created = 0, skipped = 0, updated = 0;
for (const mod of modules) {
  const path = join(DOCS, `${mod}.md`);
  const mi = info(mod);
  const auto = [];
  auto.push('<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->');
  auto.push('');
  auto.push('## ของจริงในโค้ด (auto-generated)');
  auto.push('');
  auto.push('### ตารางที่เป็นเจ้าของ');
  const own = (tablesOf[mod] ?? []).sort();
  auto.push(own.length ? own.map((t) => `\`${t}\``).join(' · ') : '_(ยังไม่มีตารางใน owners map)_');
  auto.push('');
  if (mi.routes.length) {
    auto.push('### Routes');
    for (const r of mi.routes) auto.push(`- \`${r.file}\` (${r.lines} บรรทัด)`);
    auto.push('');
    const eps = [...new Set(mi.endpoints)];
    if (eps.length) {
      auto.push('### Endpoints (จาก router)');
      auto.push('```');
      for (const e of eps.slice(0, 40)) auto.push(e);
      if (eps.length > 40) auto.push(`… อีก ${eps.length - 40} เส้น`);
      auto.push('```');
      auto.push('');
    }
  }
  if (mi.services.length) {
    auto.push('### Services ที่ทำงานให้โมดูลนี้');
    auto.push([...new Set(mi.services)].map((s) => `\`${s}\``).join(' · '));
    auto.push('');
  }
  const cross = crosses[mod] ?? [];
  if (cross.length) {
    auto.push('### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)');
    for (const c of cross) auto.push(`- ${c}`);
    auto.push('');
  }
  auto.push('<!-- auto:end -->');

  if (existsSync(path) && !FORCE) {
    const cur = readFileSync(path, 'utf8');
    if (cur.includes('<!-- auto:begin -->')) {
      const next = cur.replace(/<!-- auto:begin -->[\s\S]*?<!-- auto:end -->/, auto.join('\n'));
      if (next !== cur) { writeFileSync(path, next, 'utf8'); updated++; }
      else skipped++;
    } else {
      // ไฟล์เก่าไม่มี marker — ต่อท้ายส่วน auto (ไม่แตะเนื้อหาเดิม)
      writeFileSync(path, cur.replace(/\s*$/, '\n') + '\n' + auto.join('\n') + '\n', 'utf8');
      updated++;
    }
    continue;
  }
  const head = [
    `# โมดูล ${mod}`, '',
    '## เจตนา', '',
    '_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_', '',
    '## ข้อห้าม / ระวัง', '',
    '_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_', '',
  ].join('\n');
  writeFileSync(path, head + auto.join('\n') + '\n', 'utf8');
  created++;
}
console.log(`═══ gen-module-docs ═══ โมดูลทั้งหมด ${modules.length} · สร้างใหม่ ${created} · อัปเดต auto ${updated} · ข้าม ${skipped}`);
