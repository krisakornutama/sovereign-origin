#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// map-owners.mjs — เติมเจ้าของตารางที่ยัง unmapped ใน tools/module-owners.json
// จาก "การใช้จริงในโค้ด": สแกน prisma.<delegate> ต่อโมดูล (modules/*) และ service
// (services/* — ใช้ label เดียวกับ arch-gate boundary scan) แล้วเสนอเจ้าของ = ผู้ใช้เยอะสุด
//
// กติกา:
//   - รายการที่มีใน owners อยู่แล้ว = ห้ามแตะ (manual ชนะเสมอ)
//   - prefix-rules: ตารางโดเมนเดียวกันชัดเจน (kid_* → teach-kids, livestock_* → livestock)
//     ถ้ามีเจ้าของที่ prefix ตรง = ใช้ก่อนผลโหวต
//   - ตารางที่ "ไม่มีใครใช้" ใน src = orphan → mark ไว้แบบไม่ map (มองเห็น ไม่เดา)
//
// ใช้: node tools/map-owners.mjs          (dry-run แสดงข้อเสนอ)
//      node tools/map-owners.mjs --apply  (เขียน module-owners.json จริง)
// ────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'sovereign-os', 'core-api');
const APPLY = process.argv.includes('--apply');

// ── prefix-rules: โดเมนชัดเจนจากชื่อตาราง (ใช้ก่อนผลโหวตเสมอ) ──
const PREFIX_RULES = [
  { test: /^kid_/, owner: 'teach-kids' },
  { test: /^livestock_/, owner: 'livestock' },
  { test: /^restaurant_/, owner: 'restaurant' },
  { test: /^treasury_/, owner: 'treasury' },
  { test: /^business_/, owner: 'business' },
  { test: /^farm_|^herb_/, owner: 'farm' },
  { test: /^health_/, owner: 'health' },
  { test: /^vision_/, owner: 'vision' },
  { test: /^knowledge_/, owner: 'knowledge' },
];

// ── 1) อ่าน owners เดิม + aliases/shared จาก json แหล่งเดียว + schema map (model → table) ──
const ownersPath = join(ROOT, 'tools', 'module-owners.json');
const ownersJson = JSON.parse(readFileSync(ownersPath, 'utf8'));
const owners = ownersJson.owners ?? {};
const serviceAliases = ownersJson.serviceAliases ?? {};   // แหล่งความจริงเดียว — แก้ที่ json
const SHARED = new Set(ownersJson.sharedTables ?? []);     // cross-cutting — ทุกโมดูลแตะได้
const schema = readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8');
const modelTable = {};
for (const m of schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{[^}]*?@@map\("([^"]+)"\)/gms)) {
  // delegate ในโค้ด = ชื่อ model ตัวแรกพิมพ์เล็ก (prisma.restaurant ← model Restaurant)
  const camel = m[1].charAt(0).toLowerCase() + m[1].slice(1);
  modelTable[camel] = m[2];
}
const tableToModels = {};
for (const [model, table] of Object.entries(modelTable)) {
  (tableToModels[table] ??= []).push(model);
}
const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

// ── 2) สแกนการใช้ prisma.<delegate> ต่อโมดูล (label เดียวกับ arch-gate) ──
const SRC = join(BACKEND, 'src');
// lookup alias: ลองชื่อไฟล์เปล่า ๆ ก่อน (teach-kids-curriculum) แล้วค่อยแบบ .service
const aliasOf = (base) => serviceAliases[base] ?? serviceAliases[`${base}.service`] ?? `service:${base}`;
const usage = {}; // table → { consumer: count }
let scanned = 0;
const walk = (dir) => {
  let list = [];
  try { list = readdirSync(dir); } catch { return; }
  for (const name of list) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (!/\.ts$/.test(name) || name.endsWith('.test.ts')) continue;
    scanned++;
    const rel = relative(SRC, full).split(sep);
    const module =
      rel[0] === 'modules' ? rel[1]
      : rel[0] === 'services' ? aliasOf(rel[1]?.replace(/\.ts$/, ''))
      : rel[0] === 'workers' ? aliasOf(rel[1]?.replace(/\.ts$/, ''))
      : `root:${rel[0]}`;
    const text = readFileSync(full, 'utf8');
    for (const mm of text.matchAll(/\bprisma\.([a-z][A-Za-z0-9]*)\b/g)) {
      const table = modelTable[mm[1]] || camelToSnake(mm[1]);
      ((usage[table] ??= {})[module] ??= 0);
      usage[table][module]++;
    }
  }
};
walk(SRC);

// ── 3) เสนอเจ้าของรายตาราง ──
const proposals = [];
const orphans = [];
const sharedList = [];
const allTables = [...new Set(Object.values(modelTable))].sort();
for (const table of allTables) {
  if (owners[table]) continue; // manual ชนะเสมอ
  if (SHARED.has(table)) { sharedList.push(table); continue; } // cross-cutting — ไม่จำเป็นต้องมีเจ้าของ
  const prefix = PREFIX_RULES.find((r) => r.test.test(table));
  const consumers = Object.entries(usage[table] ?? {});
  if (prefix) {
    proposals.push([table, prefix.owner, `prefix ${table.split('_')[0]}_*`]);
    continue;
  }
  if (!consumers.length) { orphans.push(table); continue; }
  const sorted = consumers.sort((a, b) => b[1] - a[1]);
  const [top, count] = sorted[0];
  const total = sorted.reduce((s, [, c]) => s + c, 0);
  proposals.push([table, top, `${count}/${total} การใช้ (${sorted.slice(0, 3).map(([m, c]) => `${m}×${c}`).join(', ')})`]);
}

// ── 4) แสดง/เขียน ──
console.log(`═══ map-owners (สแกน ${scanned} ไฟล์) ═══`);
console.log(`mapped แล้ว: ${Object.keys(owners).length} · ข้อเสนอใหม่: ${proposals.length} · orphan: ${orphans.length}`);
const byOwner = {};
for (const [t, o, why] of proposals) (byOwner[o] ??= []).push([t, why]);
for (const o of Object.keys(byOwner).sort()) {
  console.log(`\n— ${o} (${byOwner[o].length})`);
  for (const [t, why] of byOwner[o]) console.log(`   ${t}  ← ${why}`);
}
if (sharedList.length) console.log(`\nℹ️  shared (cross-cutting — ทุกโมดูลแตะได้): ${sharedList.join(', ')}`);
if (orphans.length) console.log(`\n⚠️  orphan (ไม่มีใครใช้ใน src — ไม่ map): ${orphans.join(', ')}`);

if (APPLY) {
  for (const [t, o] of proposals) owners[t] = o;
  ownersJson.owners = Object.fromEntries(Object.entries(owners).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(ownersPath, JSON.stringify(ownersJson, null, 2) + '\n', 'utf8');
  console.log(`\n✅ เขียน ${proposals.length} รายการลง module-owners.json (รวม ${Object.keys(owners).length})`);
} else {
  console.log('\n(dry-run — ใส่ --apply เพื่อเขียนจริง)');
}
