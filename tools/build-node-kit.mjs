// tools/build-node-kit.mjs — ประกอบชุดติดตั้ง "เครื่องใหม่แบบโนดเต็ม" แล้วเผยแพร่บน HUB
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────
// เจ้าของสั่ง 12/10/69: "ผมงงมากเลย เครื่องลูกไม่รู้จะรันไฟล์ไหน เยอะซะเหลือเกิน
//   ผมก็บอกให้ทำให้เป็นไฟล์ติดตั้งไฟล์เดียวก็ไม่ทำ"
// ⇒ ตัวติดตั้งไฟล์เดียวต้อง "ดึงชุดระบบจาก HUB เอง" ไม่ใช่ให้เจ้าของก๊อปโฟลเดอร์
//   ⇒ ต้องมีที่เก็บชุดที่ HUB เสิร์ฟ = ไฟล์นี้
//
// ── ข้อบังคับ ──────────────────────────────────────────────────────────
// · เครื่องใหม่มีพื้นที่ 40 GB (เจ้าของยืนยัน) → ต้องตัดของหนักออกให้จบ
//   · Ollama        (~11 GB โมเดล) — เจ้าของเลือก "ไม่เอา"
//   · whisper models (~465 MB)
//   · node_modules · .next · dist · .git · Docker/wsl (vhdx 88 GB)
// · ห้ามใส่ .env / join.json / token ของเครื่อง HUB เด็ดขาด
// · manifest ต้องมี sha256 ของไฟล์จริง — client จะตรวจก่อนแตก (fail-closed)
//
// ใช้:
//   node tools/build-node-kit.mjs                 # ประกอบ + เขียน manifest (ยังไม่ publish)
//   node tools/build-node-kit.mjs --publish       # ประกอบ + เผยแพร่ให้เครื่องลูกดึง
//   node tools/build-node-kit.mjs --dry-run        # ดูว่าจะใส่อะไร ยังไม่ทำงาน
//   node tools/build-node-kit.mjs --out=<โฟลเดอร์> --version=<x.y.z>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const value = (n, d = '') => (argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d;

const PUBLISH = flag('publish');
const DRY = flag('dry-run');
const OUT = path.resolve(ROOT, value('out', path.join('sovereign-os', 'core-api', 'data', 'node-kits')));
const VERSION = value('version', '');
const WITH_OLLAMA = flag('with-ollama');

const say = (m = '') => console.log(m);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const die = (m) => { say(`[build-node-kit] ${m}`); process.exit(1); };

// ── โฟลเดอร์ที่ "ตัดแน่นอน" ไม่ว่าจะอยู่ตรงไหน ────────────────────────────
// (ปรับปรุงแล้วจาก FULL_KIT_SKIP_DIRS ของ pack.mjs — ถ้าแก้ที่นี่ให้แก้ที่นั่นด้วย)
const SKIP_DIRS = new Set([
  '.git', '.freebuff', '.next', '.next-verify', '.turbo', '.cache', '.playwright-browsers',
  'node_modules', 'backups', 'logs', 'data', '__pycache__', 'build', 'dist', 'coverage',
  // เคสจริง 11-12/10/69: ต้องมี ไม่งั้น build-node-kit จะพยายามอ่าน vhdx 88 GB
  //   แล้วล้ม ERR_FS_FILE_TOO_LARGE แบบเดียวกับ BUILD-KIT รอบแรก
  // ⚠ 'Ollama' ไม่อยู่ที่นี่ — ให้ --with-ollama คุมเอง (ถ้าอยู่ตรงนี้ ตัวเลือกนั้นจะเป็นโค้ดตาย)
  'Docker', '.venv', 'venv',
]);

const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const SKIP_EXT = new Set(['.log', '.tmp', '.pid', '.lock']);

/** ของใหญ่ผิดปกติ = ข้อมูลส่วนตัว ไม่ใช่โค้ด (โมเดลเสียง/ดิสก์เสมือน) */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const ALLOWED_BIG = [/\.bin$/i];

/** เส้นที่ข้ามทั้งเส้น (โฟลเดอร์เก่า/ใหญ่ที่ไม่ใช่ของระบบที่เครื่องใหม่ต้องมี) */
const SKIP_PATH_PREFIX = [
  'tools/Git',          // PortableGit ของเครื่องนี้ (~500 MB) — เครื่องใหม่ติดตั้งเอง
  'tools/piper',        // ไบนารีที่แตกจาก zip
  'tools/E-Tipitaka',   // ชุดข้อมูลภายนอก
  'Docker/wsl',         // vhdx 88 GB
  'tools/whisper.cpp/models',
  'tools/whisper.cpp/ggml',
  'sovereign-os/core-api/node_modules',
  'sovereign-os/core-api/dist',
  'sovereign-os/infra/data',      // WAL 25 GB + pgdata — ของเครื่องนี้เท่านั้น
  'sovereign-os/infra/offsite',    // backup ที่เข้ารหัสแล้ว
  'sovereign-frontend/dist-electron',
  'sovereign-frontend/out',
  'dist-portable', 'dist-portable-staging',
  'release',
  'portfolio',
  '.opencode',
];

/** ไฟล์ที่ห้ามหลุดเด็ดขาด — ความลับของเครื่อง HUB */
const SECRET_NAMES = new Set(['.env', 'join.json', '.env.local', '.env.production', 'daemon.json']);
const SECRET_PATTERN = /\.(key|pem|p12|pfx|age|enc|bak|old|orig)$/i;

function isSkipped(rel, opts = {}) {
  const withOllama = opts.withOllama ?? WITH_OLLAMA;
  // Ollama ตัดที่นี่จุดเดียว — ถ้าไปใส่ใน SKIP_DIRS/SKIP_PATH_PREFIX ตัวเลือก --with-ollama
  // จะกลายเป็นโค้ดตาย (เคสจริง 12/10/69: เทสต์จับได้ตอนรันครั้งแรก)
  if (!withOllama && (rel === 'Ollama' || rel.startsWith('Ollama/'))) return true;
  if (SKIP_PATH_PREFIX.some((p) => rel === p || rel.startsWith(`${p}/`))) return true;
  // ตัวติดตั้งที่ build ไว้แล้ว (dist-portable-prev-<วันที่>/ ฯลฯ) ห้ามหลุดเข้าชุด:
  // เดิมตัดเฉพาะชื่อเป๊ะ → โฟลเดอร์ที่เปลี่ยนชื่อเก็บไว้ (654 MB) จะถูก copy เข้า kit
  if (rel === 'dist-portable' || rel.startsWith('dist-portable/') || rel.startsWith('dist-portable-')) return true;
  const base = rel.split('/').pop();
  // .env ทุกชนิดห้ามหลุด — ยกเว้น template ที่ลงท้าย .example (ต้องมีไว้ให้เครื่องใหม่สร้าง env)
  // เคสจริง 19/10/69: ชุดที่ build มี .env.bak.* (ค่าจริงของ HUB) + .env.playwright ติดไปด้วย
  if (base.startsWith('.env') && !base.endsWith('.example')) return true;
  if (SECRET_NAMES.has(base)) return true;
  if (SECRET_PATTERN.test(base)) return true;
  return false;
}

/** เดินทั้งโฟลเดอร์ เก็บรายการที่จะใส่ + สถิติที่ตัดออก */
export function collectKitFiles(root = ROOT, opts = {}) {
  const withOllama = opts.withOllama ?? WITH_OLLAMA;
  const kept = [];
  const skippedBy = new Map();
  const bump = (k, bytes) => skippedBy.set(k, (skippedBy.get(k) ?? 0) + bytes);

  const walk = (dir, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (isSkipped(childRel, { withOllama })) { bump('ข้ามตามเส้นทาง', 0); continue; }
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || SKIP_FILES.has(e.name)) continue;
        walk(full, childRel);
        continue;
      }
      if (!e.isFile()) continue;
      if (SKIP_FILES.has(e.name)) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        bump('อ่านไม่ได้', 0);
        continue;
      }
      // เฝ้าไว้อีกชั้น: ไฟล์ใหญ่ผิดปกติ = ดิสก์เสมือน/ข้อมูลส่วนตัว
      if (size > MAX_FILE_BYTES && !ALLOWED_BIG.some((re) => re.test(childRel))) {
        bump('ใหญ่ผิดปกติ', size);
        continue;
      }
      kept.push({ rel: childRel, abs: full, size });
    }
  };
  walk(root, '');
  return { files: kept, skippedBy };
}

/** ไฟล์ที่ต้องมีในชุดเสมอ ไม่งั้นเครื่องใหม่จะติดตั้งไม่ได้ */
export const REQUIRED_IN_KIT = [
  'SETUP-NODE.cmd',
  'setup-first-time.bat',
  'start-sovereign.bat',
  'sovereign-os/infra/docker-compose.prod.yml',
  'sovereign-os/infra/docker-compose.yml',
  'sovereign-os/infra/.env.example',
  // setup-machine.mjs อยู่ใน tools/agent-pack (ตัวแพ็กก๊อปมาใส่ชุดเล็กตอนเรียก)
  //   ไม่ใช่ใน agent-runner — ต้นแบบนี้พลาดแล้วตอนรันครั้งแรก
  'tools/agent-pack/setup-machine.mjs',
  'tools/agent-pack/SETUP-MACHINE.cmd',
  'tools/agent-pack/SETUP-MACHINE.cmd',
  'tools/setup-node.mjs',
  'tools/prune-wal.mjs',
  'tools/prune-wal.ps1',
  'tools/hidden-tasks/sovereign-prune-wal.cmd',
];

/**
 * ของที่ชุดไม่ได้พาไป แต่เครื่องใหม่ต้องสร้างเองหลังแตก (พร้อมขนาดที่วัดได้)
 *   node_modules ของ frontend = 483 MB · ถ้าใส่ในชุดจะใหญ่ขึ้นนี้ทันที
 *   ⇒ ให้ setup-node.mjs สั่ง npm ci บนเครื่องเป้าหมายแทน (เร็วกว่าเทียบกับการดาวน์โหลดและแตก)
 */
export const BUILT_ON_TARGET = [
  { path: 'sovereign-frontend/node_modules', mb: 483, why: 'next build ต้องใช้' },
  { path: 'sovereign-os/core-api/node_modules', mb: 278, why: 'host-side บางคำสั่ง' },
];

/** เช็คว่าของที่ต้องมีครบ — คืนรายการที่ขาด */
export function missingRequired(files, required = REQUIRED_IN_KIT) {
  const set = new Set(files.map((f) => f.rel));
  return required.filter((r) => !set.has(r));
}

/** BOM = 3 ไบต์ EF BB BF */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * วางสคริปต์ตัวติดตั้งไฟล์เดียวลงในโฟลเดอร์ที่ HUB เสิร์ฟ
 *
 * ต้องเติม UTF-8 BOM เสมอ: PowerShell 5.1 (ของที่มากับ Windows) อ่านไฟล์ .ps1
 *   ที่ไม่มี BOM เป็น ANSI ตาม codepage ของเครื่อง → ข้อความไทยกลายเป็นตัวยึกยือ
 *   (เจอจริงในโปรเจกต์นี้ — ทางแก้คือ BOM + [Console]::OutputEncoding)
 *
 * @returns {{name: string, sha256: string, size: number} | null}
 */
export function stageBootstrap(filesDir, srcRel = 'tools/node-installer.ps1') {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) {
    console.error(`[build-node-kit] ไม่พบ ${srcRel} — ตัวติดตั้งไฟล์เดียวจะใช้ไม่ได้`);
    return null;
  }
  const body = fs.readFileSync(src);
  const out = Buffer.concat([UTF8_BOM, body]);
  const name = 'install-node.ps1';
  const abs = path.join(filesDir, name);
  fs.writeFileSync(abs, out);
  return {
    name,
    sha256: crypto.createHash('sha256').update(out).digest('hex'),
    size: out.length,
  };
}

function sha256File(abs) {
  const h = crypto.createHash('sha256');
  const s = fs.readFileSync(abs); // ตอนแตกจะเป็นก้อนเดียว — ขนาดระดับสิบ MB
  h.update(s);
  return h.digest('hex');
}

/** หุ่มจำลอง tar ด้วย zip ที่มีใน Windows (ไม่ต้องพึ่ง tar ภายนอก) */
function makeZip(files, outAbs) {
  // ใช้ PowerShell Compress-Archive — มีมากับ Windows ทุกเครื่อง
  const tmp = `${outAbs}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const f of files) {
      const dest = path.join(tmp, f.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.abs, dest);
    }
    const ps = `Compress-Archive -Path '${tmp}\\*' -DestinationPath '${outAbs}' -Force`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, encoding: 'utf8' });
    if (r.status !== 0) die(`บีบอัดไม่สำเร็จ (exit ${r.status}): ${r.stderr || r.stdout}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  say('══════════════════════════════════════════════════');
  say('  ชุดติดตั้งเครื่องใหม่แบบโนดเต็ม — ประกอบจาก repo ของ HUB');
  say('══════════════════════════════════════════════════');
  say(`  repo : ${ROOT}`);
  say(`  ออกที่: ${OUT}`);
  say(`  Ollama: ${WITH_OLLAMA ? 'รวม (หนัก!)' : 'ไม่รวม (ตามที่เจ้าของเลือก)'}`);
  say('');

  const { files, skippedBy } = collectKitFiles(ROOT);
  const bytes = files.reduce((a, f) => a + f.size, 0);
  say(`  ไฟล์ที่จะใส่: ${files.length.toLocaleString('en-US')} · ${mb(bytes)}`);

  const missing = missingRequired(files);
  if (missing.length) {
    say('');
    say('  ✗ ขาดไฟล์ที่จำเป็นต่อการติดตั้ง:');
    for (const m of missing) say(`      - ${m}`);
    die('ชุดนี้ติดตั้งไม่ได้ — แก้การตัดออกก่อน (อย่าใช้ SKIP_PATH_PREFIX ตัดสิ่งที่จำเป็น)');
  }

  // เตือนถ้าใหญ่ผิดปกติ
  const tooBig = files.filter((f) => f.size > 200 * 1024 * 1024);
  if (tooBig.length) {
    say('');
    say('  ⚠ ไฟล์ใหญ่กว่า 200 MB (ควรตัดออกถ้าไม่จำเป็น):');
    for (const f of tooBig.slice(0, 8)) say(`      ${mb(f.size).padStart(9)} — ${f.rel}`);
  }

  if (DRY) {
    say('');
    say('  [--dry-run] ไม่ได้เขียนอะไร');
    return;
  }

  const pkgPath = path.join(ROOT, 'sovereign-frontend', 'package.json');
  const version = VERSION || (fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version : '0.0.0');

  const filesDir = path.join(OUT, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const assetName = `node-kit-${version}.zip`;
  const assetAbs = path.join(filesDir, assetName);

  say('');
  say('[1/4] คัดลอกไฟล์ + บีบอัด (อาจใช้เวลาหลายนาที) ...');
  makeZip(files, assetAbs);

  const stat = fs.statSync(assetAbs);
  say(`      ได้ ${assetName} · ${mb(stat.size)}`);

  // สคริปต์ตัวติดตั้งไฟล์เดียว — ไฟล์ .cmd ที่คนก๊อปไปจะโหลดชิ้นนี้มาก่อน
  say('[2/4] วางสคริปต์ตัวติดตั้งไฟล์เดียว (bootstrap) ...');
  const bootstrap = stageBootstrap(filesDir);

  say('[3/4] คำนวณ sha256 ...');
  const sha256 = sha256File(assetAbs);

  // enrollmentOpen = HUB ตั้ง MACHINE_ENROLL_CODE ไว้แล้วหรือยัง
  //   อ่านค่า "เปิดไว้ไหม" เท่านั้น ห้ามอ่านค่าลับลงไฟล์/manifest
  const envPath = path.join(ROOT, 'sovereign-os', 'core-api', '.env');
  let enrollmentOpen = false;
  try {
    const envTxt = fs.readFileSync(envPath, 'utf8');
    enrollmentOpen = /^MACHINE_ENROLL_CODE=\s*\S+/m.test(envTxt);
  } catch {
    enrollmentOpen = false;
  }

  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    asset: { name: assetName, sha256, size: stat.size },
    bootstrap,
    entrypoint: 'SETUP-NODE.cmd',
    enrollmentOpen,
    notes: `ไฟล์ ${files.length.toLocaleString('en-US')} · Ollama: ${WITH_OLLAMA ? 'รวม' : 'ไม่รวม'}`,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  say('[4/4] เขียน manifest.json แล้ว');

  say('');
  say(PUBLISH
    ? `  ✅ เผยแพร่แล้ว — เครื่องใหม่ถาม GET /api/agent-machines/node-kits/manifest ได้`
    : '  ✅ ประกอบแล้ว (ยังไม่เผยแพร่) — เพิ่ม --publish เพื่อให้เครื่องใหม่ดึงได้');
  say(`     enrollmentOpen = ${enrollmentOpen}${enrollmentOpen ? '' : '  (ยังไม่ได้ตั้ง MACHINE_ENROLL_CODE ที่ HUB)'}`);
  say(`     sha256 = ${sha256.slice(0, 16)}…`);
  if (bootstrap) say(`     bootstrap = ${bootstrap.name} · ${bootstrap.size} bytes · ${bootstrap.sha256.slice(0, 16)}…`);
  else say('     bootstrap = ไม่มี (ตัวติดตั้งจะใช้ได้แค่ .cmd รุ่นเก่า)');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

export { isSkipped };
