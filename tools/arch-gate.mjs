#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// arch-gate.mjs — Architecture Gate: เปลี่ยน "ธรรมเนียมที่อาศัยความจำ" เป็น "ของเครื่องตรวจได้"
// (Phase 0 arch-hardening — เสียบเป็นสเต็ปของ npm run verify · fail = verify fail)
//
// กฎที่ตรวจ:
//   1) schema-sync      — schema.prisma กับ schema.sqlite.prisma ต้องมี model ชุดเดียวกัน
//                         (จับเคส "แก้ postgres ลืม sqlite" — ตอนนี้ต้องแก้คู่กันด้วยมือ)
//   2) file-budget      — ไฟล์ที่เปลี่ยนแปลงใน diff (กับ base branch) ต้องไม่โตเกิน 800 บรรทัด
//                         (ไฟล์เก่าที่ใหญ่อยู่แล้วไม่โดนย้อนหลัง — กฎกัน "โตต่อ" เท่านั้น)
//   3) env-truth        — DATABASE_URL ใน .env ต้องชี้ DB ที่ connect ได้จริง
//                         (เคสจริง: ชี้ sovereign_v2 ที่ไม่มีอยู่ — ทุก tool เจอ P1003)
//   4) module-boundary  — บังคับจริง (เฟส 1): โมดูลแตะตารางของโมดูลอื่นผ่าน prisma.<model>
//                         **หรือ raw SQL ($queryRawUnsafe/$executeRawUnsafe — เฟส 3)**
//                         เทียบกับ tools/boundary-baseline.json (สแกนรอบแรก = baseline)
//                         · เส้นข้ามที่อยู่ใน baseline แล้ว = ผ่าน (ของเดิม ไม่ย้อนหลัง)
//                         · เส้นข้าม “ใหม่” ที่ไม่เคยมีใน baseline = FAIL — แก้/ขอเพิ่ม baseline ชัด ๆ
//                         · --update-baseline = เขียน baseline ใหม่จากผลสแกนปัจจุบัน (ใช้เมื่อยอมรับเส้นใหม่)
//
// ใช้: node tools/arch-gate.mjs [--base origin/main] [--update-baseline]
// ────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'sovereign-os', 'core-api');
const argBase = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'main';

const problems = [];
const reports = [];

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT, ...opts }).trim();
}

// ── 1) schema-sync: model ทั้งสอง schema ต้องตรงกัน ──
function checkSchemaSync() {
  const pg = readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8');
  const sqlite = readFileSync(join(BACKEND, 'prisma', 'schema.sqlite.prisma'), 'utf8');
  const models = (text) =>
    [...text.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]).sort();
  const pgModels = models(pg);
  const sqModels = models(sqlite);
  const onlyPg = pgModels.filter((m) => !sqModels.includes(m));
  const onlySq = sqModels.filter((m) => !pgModels.includes(m));
  if (onlyPg.length || onlySq.length) {
    problems.push(
      `schema-sync: model ไม่ตรงกันระหว่าง schema.prisma กับ schema.sqlite.prisma` +
        (onlyPg.length ? `\n   มีใน postgres เท่านั้น: ${onlyPg.join(', ')}` : '') +
        (onlySq.length ? `\n   มีใน sqlite เท่านั้น: ${onlySq.join(', ')}` : '') +
        `\n   → แก้ทั้งสองไฟล์คู่กันเสมอ (ตามธรรมเนียมเดิมของ repo)`
    );
  } else {
    reports.push(`schema-sync: ตรงกัน ${pgModels.length} models`);
  }
}

// ── 2) file-budget: ไฟล์ที่เปลี่ยนใน diff ไม่เกินเพดาน ──
function checkFileBudget() {
  const BUDGET = 800;
  let diffOutput = '';
  try {
    diffOutput = sh(`git diff --name-only ${argBase}...HEAD`);
  } catch {
    reports.push(`file-budget: ข้าม (หา base '${argBase}' ไม่เจอ)`);
    return;
  }
  const changed = diffOutput.split('\n').filter(Boolean).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mjs') || f.endsWith('.js'));
  const offenders = [];
  for (const f of changed) {
    const full = join(ROOT, f);
    if (!existsSync(full)) continue; // ลบไฟล์ = ไม่นับ
    const lines = readFileSync(full, 'utf8').split('\n').length;
    if (lines > BUDGET) offenders.push(`${f} (${lines} บรรทัด)`);
  }
  if (offenders.length) {
    problems.push(`file-budget: ไฟล์ที่แก้ใน branch นี้ใหญ่เกิน ${BUDGET} บรรทัด:\n   ${offenders.join('\n   ')}\n   → แตกเป็นโมดูลย่อยก่อน merge (กฎกันไฟล์ยักษ์โตต่อ)`);
  } else {
    reports.push(`file-budget: ผ่าน (${changed.length} ไฟล์ที่เปลี่ยน · เพดาน ${BUDGET} บรรทัด)`);
  }
}

// ── 3) env-truth: DATABASE_URL ต้อง connect ได้จริง ──
async function checkEnvTruth() {
  const envPath = join(BACKEND, '.env');
  if (!existsSync(envPath)) {
    reports.push('env-truth: ข้าม (ไม่มี .env — เครื่องนี้ใช้ env จากที่อื่น)');
    return;
  }
  const env = readFileSync(envPath, 'utf8');
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) {
    problems.push('env-truth: .env ไม่มี DATABASE_URL');
    return;
  }
  const url = m[1].trim().replace(/\s+#.*$/, '').trim(); // ตัด comment ท้ายบรรทัดออก
  const parsed = url.match(/^postgres(?:ql)?:\/\/([^:@]+):([^@]*)@([^:/]+):(\d+)\/(.+?)(\?.*)?$/);
  if (!parsed) {
    problems.push('env-truth: DATABASE_URL รูปแบบไม่รู้จัก (ต้องเป็น postgresql://user:pass@host:port/db)');
    return;
  }
  const [, user, , host, port, dbName] = parsed;
  // connect ผ่าน pg ของ core-api — ไม่พิมพ์รหัสผ่านลง output เด็ดขาด
  try {
    // pg เป็น CJS — ใช้ createRequire (ESM import() ของ Windows absolute path ใช้ไม่ได้)
    const require = createRequire(import.meta.url);
    const { Client } = require(join(BACKEND, 'node_modules', 'pg'));
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 4000 });
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    reports.push(`env-truth: DATABASE_URL ชี้ ${host}:${port}/${dbName} (user=${user}) — connect สำเร็จ`);
  } catch (err) {
    const code = err?.code || '';
    const hint =
      code === '3D000'
        ? 'ฐานข้อมูลไม่มีอยู่จริง — แก้ชื่อ DB ให้ตรงของจริง (ดูจาก container: docker exec sovereign-core-api sh -c "echo $DATABASE_URL")'
        : code === '28P01'
          ? 'รหัสผ่านไม่ถูก'
          : code === 'ECONNREFUSED'
            ? 'เชื่อมต่อไม่ได้ — Postgres ยังไม่รัน?'
            : err?.message?.slice(0, 120);
    problems.push(`env-truth: DATABASE_URL ชี้ ${host}:${port}/${dbName} แต่ connect ไม่ได้ (${hint})`);
  }
}

// ── 4) module-boundary (บังคับด้วย baseline — เฟส 1): ใครแตะตารางของใคร ──
function checkModuleBoundary() {
  const ownersPath = join(ROOT, 'tools', 'module-owners.json');
  const baselinePath = join(ROOT, 'tools', 'boundary-baseline.json');
  if (!existsSync(ownersPath)) {
    reports.push('module-boundary: ข้าม (ไม่มี tools/module-owners.json)');
    return;
  }
  const ownersJson = JSON.parse(readFileSync(ownersPath, 'utf8'));
  const owners = ownersJson.owners || {};
  const serviceAlias = ownersJson.serviceAliases || {};   // แหล่งความจริงเดียวกับ map-owners
  const shared = new Set(ownersJson.sharedTables || []);   // cross-cutting — ทุกโมดูลแตะได้
  // delegate prisma.<model> ↔ ตาราง: ตาม @@map — อ่านจาก schema.prisma
  const schema = readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8');
  const modelTable = {};
  for (const m of schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{[^}]*?@@map\("([^"]+)"\)/gms)) {
    // delegate ในโค้ด = camelCase ของ model (prisma.businessOrder ← model BusinessOrder)
    const camel = m[1].charAt(0).toLowerCase() + m[1].slice(1);
    modelTable[camel] = m[2];
  }
  const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()); // fallback กรณี @@map ไม่ตรง snake
  const hits = {}; // `${module} → ${owner}(${table})` = count
  let scanCount = 0;
  const SRC = join(ROOT, 'sovereign-os', 'core-api', 'src');
  const aliasOf = (base) => serviceAlias[base] ?? serviceAlias[`${base}.service`] ?? `service:${base}`;
  const walk = (dir) => {
    let list = [];
    try { list = readdirSync(dir); } catch { return; }
    for (const name of list) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!/\.ts$/.test(name) || name.endsWith('.test.ts')) continue;
      scanCount++;
      const rel = relative(SRC, full);
      const parts = rel.split(sep);
      const module =
        parts[0] === 'modules' ? parts[1]
        : parts[0] === 'services' ? aliasOf(parts[1]?.replace(/\.ts$/, ''))
        : parts[0] === 'workers' ? aliasOf(parts[1]?.replace(/\.ts$/, ''))
        : `root:${parts[0]}`;
      const text = readFileSync(full, 'utf8');
      for (const mm of text.matchAll(/\bprisma\.([a-z][A-Za-z0-9]*)\b/g)) {
        const delegate = mm[1];
        const table = modelTable[delegate] || camelToSnake(delegate);
        const owner = owners[table];
        if (!owner) continue; // unmapped — ยังไม่ถูกกติกาครอบ (จัดการด้วย map-owners)
        if (shared.has(table)) continue; // cross-cutting — ทุกโมดูลแตะได้
        if (owner === module) continue; // เจ้าของแตะของตัวเอง = ถูกต้อง
        const key = `${module} → ${owner}(${table})`;
        hits[key] = (hits[key] || 0) + 1;
      }
      // เฟส 3: raw SQL ($queryRawUnsafe/$executeRawUnsafe) — ดึงชื่อตารางจากคำสั่ง SQL
      // (เคสจริง: sensor_telemetry เขียนด้วย raw SQL จาก 5 จุด — prisma-delegate scan มองไม่เห็น)
      // [^(]* กิน generic ที่มี > ซ้อน (เช่น <Array<any>>) · (['"`]) รับทั้ง backtick/quote
      for (const rm of text.matchAll(/\$(?:queryRawUnsafe|executeRawUnsafe)[^(]*\(\s*([`"'])([\s\S]*?)\1/g)) {
        for (const tm of rm[2].matchAll(/\b(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
          const table = tm[1];
          const owner = owners[table];
          if (!owner || shared.has(table) || owner === module) continue;
          const key = `${module} → ${owner}(${table})`;
          hits[key] = (hits[key] || 0) + 1;
        }
      }
    }
  };
  walk(SRC);
  const keys = Object.keys(hits).sort();

  // baseline: { "<key>": "<เหตุผล/ที่มา สั้น ๆ>" } — สแกนรอบแรก = สร้างอัตโนมัติ (report เดิมทั้งหมดผ่าน)
  let baseline = {};
  if (existsSync(baselinePath)) {
    try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).violations || {}; } catch { baseline = {}; }
  }

  if (process.argv.includes('--update-baseline')) {
    writeFileSync(baselinePath, JSON.stringify({
      $comment: 'baseline เส้นข้ามโมดูลที่ “ยอมรับแล้ว” — เส้นใหม่นอกไฟล์นี้ = arch-gate fail · เพิ่มเส้นใหม่เมื่อ: โมดูลอื่นจำเป็นจริง (เช่นผ่าน service กลาง) — ระบุเหตุผลไว้ทุกครั้ง · อัปเดตทั้งไฟล์ด้วย: node tools/arch-gate.mjs --update-baseline',
      generatedAt: new Date().toISOString().slice(0, 10),
      violations: Object.fromEntries(keys.map((k) => [k, hits[k]])),
    }, null, 2) + '\n', 'utf8');
    reports.push(`module-boundary: เขียน baseline ${keys.length} เส้น (อัปเดตจากผลสแกน ${scanCount} ไฟล์)`);
    return;
  }

  if (!existsSync(baselinePath)) {
    // รอบแรก: สร้าง baseline ให้เอง — ของเดิมทั้งหมดผ่าน ไม่ทำให้ใคร build พังทันที
    writeFileSync(baselinePath, JSON.stringify({
      $comment: 'baseline เส้นข้ามโมดูลที่ “ยอมรับแล้ว” — เส้นใหม่นอกไฟล์นี้ = arch-gate fail · เพิ่มเส้นใหม่เมื่อ: โมดูลอื่นจำเป็นจริง (เช่นผ่าน service กลาง) — ระบุเหตุผลไว้ทุกครั้ง · อัปเดตทั้งไฟล์ด้วย: node tools/arch-gate.mjs --update-baseline',
      generatedAt: new Date().toISOString().slice(0, 10),
      violations: Object.fromEntries(keys.map((k) => [k, hits[k]])),
    }, null, 2) + '\n', 'utf8');
    reports.push(`module-boundary: สร้าง baseline ครั้งแรก — ยอมรับเส้นข้ามที่มีอยู่ ${keys.length} เส้น (สแกน ${scanCount} ไฟล์) · เส้นใหม่ถัดจากนี้ = fail`);
    return;
  }

  const newOnes = keys.filter((k) => !(k in baseline));
  const gone = Object.keys(baseline).filter((k) => !keys.includes(k));
  if (newOnes.length) {
    problems.push(
      `module-boundary: เจอเส้นข้ามโมดูล “ใหม่” ${newOnes.length} เส้น (ไม่มีใน baseline):\n` +
        newOnes.slice(0, 10).map((k) => `   ✗ ${k} ×${hits[k]}`).join('\n') +
        `\n   → กลับไปทำผ่าน service ของเจ้าของตาราง หรือถ้าจำเป็นจริง ให้เพิ่มลง tools/boundary-baseline.json พร้อมเหตุผล`
    );
  }
  const cleaned = gone.length ? ` · เส้นที่เลิกแล้ว ${gone.length} (ลบจาก baseline ได้ด้วย --update-baseline)` : '';
  reports.push(`module-boundary: ผ่าน (เส้นข้ามที่ยอมรับแล้ว ${keys.length}/${Object.keys(baseline).length} · สแกน ${scanCount} ไฟล์${cleaned})`);
}

const results = [];
checkSchemaSync();
checkFileBudget();
await checkEnvTruth(); // top-level await (ESM) — ต้องรอ ไม่งั้น report/fail หลุดไปหลัง print
checkModuleBoundary();

console.log('═══ Architecture Gate ═══');
for (const r of reports) console.log('  · ' + r);
if (problems.length) {
  console.error('\n❌ Architecture Gate ล้ม — แก้ก่อน commit:');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('✅ Architecture Gate ผ่าน');
