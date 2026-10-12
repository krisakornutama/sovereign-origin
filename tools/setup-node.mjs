// tools/setup-node.mjs — ติดตั้งเครื่องลูกแบบ "โนดเต็ม" แบบกดครั้งเดียว
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────
// เดิมการเพิ่มเครื่องใหม่ = ก๊อปชุดติดตั้ง (desktop\) แล้วดับเบิลคลิก INSTALL-DESKTOP.cmd
//   แต่ไฟล์นั้น "แค่ก๊อปไฟล์" — ไม่ได้ติดตั้ง Node/Docker ไม่ได้สร้างฐานข้อมูล
//   เคสจริง 11/10/69: เจ้าของก๊อปไปเครื่องใหม่ แอปค้างที่ "กำลังเริ่ม" ตลอด
//   เพราะไม่มีทั้ง Node และ Docker
//
// ── เจ้าของสั่ง 11/10/69 ──────────────────────────────────────────────
//   "อีกเครื่องนึงมีพื้นที่อีก 40GB" → ต้องเป็นเครื่องที่เก็บข้อมูลของตัวเองได้
//   ⇒ เครื่องลูกต้องเป็นระบบเต็ม (มีฐานข้อมูลของตัวเอง) ไม่ใช่แค่ตัวรับคำสั่ง
//
// ── หลักการที่ฝังไว้ ─────────────────────────────────────────────────
// • ตรวจพื้นที่ว่างก่อนเสมอ และบอกตัวเลขจริง — เครื่องนี้เกิดเรื่องดิสก์เต็มจริงแล้ว
// • ติดตั้ง Docker Desktop ผ่าน winget (ถ้ามี) — ไม่งั้นบอกให้ติดตั้งเอง
// • จำกัดขนาด log ของ Docker ไว้ก่อน ไม่งั้นบันทึกจะบวมจนดิสก์เต็ม (เคยเจอ)
// • ลงทะเบียนกับ HUB หลังระบบขึ้น ไม่ใช่ก่อน (ไม่งั้นเครื่อง ghost ที่ไม่มีงาน)
// • ทุกขั้นบันทึกลง log + คืนค่า exit code ชัดเจน (ไม่เดาเงียบๆ ว่าสำเร็จ)
//
// ใช้: node tools/setup-node.mjs [--hub-url=.. --code=.. --name=.. --dir=.. --dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ไฟล์ที่ตัวติดตั้งเรียกใช้ "ตอนรันจริง" — ต้องมีในชุดที่แตกทุกครั้ง
 *
 * ประกาศไว้ที่เดียวให้เทสต์ตรวจกับของจริงได้ ไม่งั้นโค้ดกับชุดจะหลุดจากกันเงียบๆ
 *   เคสจริง 12/10/69: โค้ดเช็ค `sovereign-os/agent-runner/setup-machine.mjs`
 *     ซึ่งไม่เคยมีอยู่จริง (อยู่ที่ tools/agent-pack) → เครื่องจริงดึง Docker
 *     หลาย GB มาเสร็จ แล้วล้มทีหลัง = เสียเวลาคนทั้งวัน
 */
export const RUNTIME_FILES = {
  setupFirstTime: 'setup-first-time.bat',
  startSystem: 'start-sovereign.bat',
  enrollScript: 'tools/agent-pack/setup-machine.mjs',
  pruneWalPs1: 'tools/prune-wal.ps1',
  pruneWalCmd: 'tools/hidden-tasks/sovereign-prune-wal.cmd',
};

// ── งบพื้นที่ (วัดจากเครื่องจริง 11/10/69 ไม่ใช่เดา) ──────────────────────
//   docker images ที่ระบบใช้  ~5.2 GB (timescaledb 2.4 · core-api 2.3 · emqx 0.46)
//   ฐานข้อมูลเริ่มต้น      ~0.1 GB (จริงตอนนี้ 60 MB)
//   Node.js                ~0.35 GB
//   ชุดแอปที่ก๊อปไป        ~0.83 GB
//   เผื่อ WAL/log/งาน      ~4 GB
export const SPACE_BUDGET = {
  imagesGb: 5.2,
  databaseGb: 0.5,
  nodeGb: 0.4,
  appGb: 0.9,
  headroomGb: 4,
};
export const MIN_FREE_GB = 12;

export function totalRequiredGb(budget = SPACE_BUDGET) {
  return Object.values(budget).reduce((a, b) => a + b, 0);
}

/**
 * ตัดสินว่าพื้นที่พอไหม — คืนคำตัดสิน + เหตุผลที่อ่านรู้เรื่อง
 * @param {number} freeGb พื้นที่ว่างจริง
 */
export function checkSpace(freeGb, budget = SPACE_BUDGET) {
  const need = totalRequiredGb(budget);
  const free = Number(freeGb);
  if (!Number.isFinite(free) || free < 0) {
    return { ok: false, need, free: freeGb, reason: 'อ่านพื้นที่ว่างไม่ได้ — ข้ามขั้นตรวจไม่ได้ อย่าเดา' };
  }
  if (free < MIN_FREE_GB) {
    return {
      ok: false,
      need,
      free,
      reason: `พื้นที่ว่าง ${free.toFixed(1)} GB — น้อยกว่าเกณฑ์ขั้นต่ำ ${MIN_FREE_GB} GB (ต้องมีของเดิมอยู่ด้วย)`,
    };
  }
  if (free < need) {
    return {
      ok: false,
      need,
      free,
      reason: `พื้นที่ว่าง ${free.toFixed(1)} GB < ที่ต้องใช้ ${need.toFixed(1)} GB — ล้างของเก่าออกก่อน`,
    };
  }
  return { ok: true, need, free, reason: `พื้นที่พอ (ว่าง ${free.toFixed(1)} GB / ต้อง ${need.toFixed(1)} GB)` };
}

/** ตั้งค่า Docker ไม่ให้ log บวมจนดิสก์เต็ม (เขียนก่อนรัน compose) */
export const DOCKER_DAEMON_CONFIG = {
  'log-driver': 'json-file',
  'log-opts': { 'max-size': '10m', 'max-file': '3' },
};

/** รวม config เดิมของเครื่องนั้นเข้าด้วย (อย่าทับของเดิมทิ้ง) */
export function mergeDaemonConfig(existing, add = DOCKER_DAEMON_CONFIG) {
  return { ...(existing ?? {}), ...add, 'log-opts': { ...(existing?.['log-opts'] ?? {}), ...add['log-opts'] } };
}

/** ตัวสั่งงานที่ต้องมีบนเครื่องลูก */
export const REQUIRED_TOOLS = [
  { id: 'node', label: 'Node.js 20+', winget: 'OpenJS.NodeJS.LTS', probe: 'node --version' },
  { id: 'docker', label: 'Docker Desktop', winget: 'Docker.DockerDesktop', probe: 'docker info' },
];

// ── ตัวรันคำสั่ง (ฉีดได้ในเทสต์) ────────────────────────────────────────

export function defaultExec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

// ── ขั้นตอน ─────────────────────────────────────────────────────────────

/**
 * ตรวจว่ามีเครื่องมือครบไหม (probe แยกทีละตัว — ตัวหนึ่งขาดไม่ควรทำให้อีกตัวหาย)
 * @returns {Promise<Array<{id,label,ok,installed?,needed}>>}
 */
export async function checkTools(tools = REQUIRED_TOOLS, exec = defaultExec) {
  const out = [];
  for (const t of tools) {
    const [bin, ...rest] = String(t.probe).split(' ');
    const r = await exec(bin, rest);
    out.push({ ...t, ok: r.code === 0, installed: r.code === 0 ? (r.stdout || '').trim().split('\n')[0] : '' });
  }
  return out;
}

/** ติดตั้งผ่าน winget ถ้ามี (ไม่มี winget = บอกให้ติดตั้งเอง ไม่เดา) */
export async function installTool(tool, exec = defaultExec) {
  if (!tool.winget) return { ok: false, reason: `ไม่รู้วิธีติดตั้ง ${tool.label} — ให้ติดตั้งเองแล้วรันซ้ำ` };
  const hasWinget = await exec('where', ['winget']);
  if (hasWinget.code !== 0) {
    return { ok: false, reason: `ไม่พบ winget — ติดตั้ง ${tool.label} เองแล้วรันซ้ำ` };
  }
  const r = await exec('winget', [
    'install', '--id', tool.winget, '-e',
    '--accept-source-agreements', '--accept-package-agreements',
  ]);
  return { ok: r.code === 0, reason: r.code === 0 ? 'ติดตั้งแล้ว' : `winget ล้ม (exit ${r.code}) — ${r.stdout.trim().slice(-200)}` };
}

/** เขียน daemon.json ของ Docker Desktop (จำกัดขนาด log) */
export function writeDockerDaemonConfig(configPath, existingText, add = DOCKER_DAEMON_CONFIG) {
  let existing = {};
  if (existingText && String(existingText).trim()) {
    try {
      existing = JSON.parse(existingText);
    } catch {
      // ไฟล์เสีย = ไม่ทับทิ้ง เพราะอาจมีคีย์อื่นที่ตั้งไว้
      throw new Error(`อ่าน ${configPath} ไม่ได้ (JSON เพี้ยน) — ไม่ทับทับของเดิม กรุณาตรวจเอง`);
    }
  }
  const merged = mergeDaemonConfig(existing, add);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  return { configPath, config: merged };
}

// ── จุดเรียกจริง ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const val = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
const has = (k) => argv.includes(`--${k}`);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(ROOT, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, 'setup-node.log');
  const lines = [];
  const log = (m = '') => {
    lines.push(m);
    console.log(m);
    try {
      fs.appendFileSync(logFile, m + '\n', 'utf8');
    } catch {
      /* เขียน log ไม่ได้ = ยังทำงานต่อได้ อย่าทำให้ติดตั้งล้มเพราะ log */
    }
  };
  log(`[${new Date().toISOString()}] เริ่มติดตั้งเครื่องลูกแบบโนดเต็ม`);
  const out = await runSetup({
    log,
    name: val('name'),
    hubUrl: val('hub-url'),
    code: val('code'),
    kitDir: ROOT,
    dryRun: has('dry-run'),
  });
  log(`[${new Date().toISOString()}] จบ (exit ${out.exitCode})`);
  process.exitCode = out.exitCode;
}


/**
 * รันทีละขั้น — คืนรายงานที่อ่านรู้เรื่อง
 * ทุกขั้นบันทึกลง log ของตัวเอง และหยุดทันทีที่ขั้นแรกที่ล้ม
 * (ขั้นถัดไปขึ้นกับขั้นก่อนหน้าเสมอ เช่นยังไม่มี Docker ก็ยัง start ไม่ได้)
 */
export async function runSetup(opts = {}) {
  const exec = opts.exec ?? defaultExec;
  const log = opts.log ?? console.log;
  const home = opts.homedir ?? os.homedir();
  const kitDir = opts.kitDir ?? ROOT;
  // dry-run = รายงานว่าจะทำอะไร แต่ไม่แตะอะไรเลย
  // (เคสจริง 11/10/69: ประกาศไว้แต่ไม่ได้ทำงาน → รันแล้วไปเขียน daemon.json
  //  ของเครื่องจริง อันตรายกว่าที่คิด)
  const dryRun = opts.dryRun === true;
  const steps = [];

  const step = (name, status, detail = '') => {
    steps.push({ name, status, detail });
    const mark = status === 'ok' ? '✔' : status === 'fail' ? '✘' : status === 'warn' ? '!' : '·';
    log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  /** ถ้าเป็น dry-run = ไม่ทำ แต่รายงานว่าจะทำ */
  const wouldDo = (name, detail) => {
    if (!dryRun) return false;
    step(name, 'warn', `[dry-run] จะ${detail}`);
    return true;
  };
  const finish = (ok, exitCode) => {
    log('');
    if (dryRun) {
      log('  ℹ️  DRY RUN — ไม่ได้แก้อะไรทั้งสิ้น (ลบ --dry-run เพื่อติดตั้งจริง)');
    } else {
      log(ok
        ? '  ✅ ติดตั้งเสร็จ — เครื่องนี้พร้อมรับคำสั่งจาก HUB'
        : '  ❌ ยังไม่เสร็จ — อ่านข้อความด้านบน (ทุกอย่างอยู่ใน logs/setup-node.log)');
    }
    return { ok, exitCode, steps, dryRun };
  };

  log('══════════════════════════════════════════════════');
  log('  Sovereign OS — ติดตั้งเครื่องลูกแบบโนดเต็ม');
  log('══════════════════════════════════════════════════');
  log(`  ชุดติดตั้ง: ${kitDir}`);
  log(`  เครื่องนี้: ${opts.name || os.hostname()}`);
  if (dryRun) log('  ⚠ DRY RUN — จะตรวจอย่างเดียว ไม่แก้อะไร');
  log('');

  // 1) พื้นที่ — ตรวจก่อนทุกอย่าง เพราะถ้าไม่พอ อย่าเพิ่งไป pull อะไร
  const freeGb = opts.freeGb ?? freeSpaceGb(kitDir);
  const space = checkSpace(freeGb);
  if (!space.ok) {
    step('พื้นที่ว่าง', 'fail', space.reason);
    return finish(false, 1);
  }
  step('พื้นที่ว่าง', 'ok', space.reason);

  // 2) เครื่องมือ — ตรวจทีละตัว ตัวไหนขาดค่อยติดตั้งเฉพาะตัวนั้น
  let tools = await checkTools(REQUIRED_TOOLS, exec);
  const missing = tools.filter((t) => !t.ok);
  if (missing.length) {
    step('ตรวจเครื่องมือ', 'warn', `ขาด ${missing.map((t) => t.label).join(', ')}`);
    if (!wouldDo('ติดตั้งเครื่องมือ', `ติดตั้ง ${missing.map((t) => t.label).join(', ')} ผ่าน winget`)) {
      for (const t of missing) {
        const r = await installTool(t, exec);
        step(`ติดตั้ง ${t.label}`, r.ok ? 'ok' : 'fail', r.reason);
      }
      tools = await checkTools(REQUIRED_TOOLS, exec);
    }
  }
  const stillMissing = tools.filter((t) => !t.ok);
  if (stillMissing.length) {
    step('เครื่องมือ', 'fail', `ยังขาด ${stillMissing.map((t) => t.label).join(', ')} — ติดตั้งเองแล้วรันซ้ำ`);
    return finish(false, 2);
  }
  step('เครื่องมือ', 'ok', tools.map((t) => `${t.label} ${t.installed || 'พร้อม'}`).join(' · '));

  // 3) จำกัดขนาด log ของ Docker — ต้องทำก่อน compose ไม่งั้นบันทึกเริ่มบวม
  const daemonPath = path.join(home, '.docker', 'daemon.json');
  if (wouldDo('จำกัดขนาด log', `เขียน ${daemonPath}`)) {
    // รายงานเฉพาะข้อมูลเดิม ไม่แก้ไฟล์
  } else {
    try {
      const prev = fs.existsSync(daemonPath) ? fs.readFileSync(daemonPath, 'utf8') : '';
      const r = writeDockerDaemonConfig(daemonPath, prev);
      step('จำกัดขนาด log', 'ok', `${r.config['log-opts']['max-size']} × ${r.config['log-opts']['max-file']} (ต้องรีสตาร์ท Docker เพื่อมีผล)`);
    } catch (err) {
      step('จำกัดขนาด log', 'warn', String(err?.message ?? err));
    }
  }

  // 4) Docker ตอบแล้วจริงไหม (compose จะล้มถ้ายังไม่พร้อม)
  const docker = await exec('docker', ['info']);
  if (docker.code !== 0) {
    step('Docker', 'fail', 'ยังไม่ตอบ — เปิด Docker Desktop แล้วรันซ้ำ');
    return finish(false, 3);
  }
  step('Docker', 'ok', 'ตอบปกติ');

  // 5) ตั้งค่าครั้งแรก (สร้าง infra/.env จากตัวอย่าง) — ข้ามถ้าทำแล้ว
  const infraEnv = path.join(kitDir, 'sovereign-os', 'infra', '.env');
  if (fs.existsSync(infraEnv)) {
    step('ตั้งค่าครั้งแรก', 'ok', 'มี .env อยู่แล้ว — ไม่ทับ');
  } else if (wouldDo('ตั้งค่าครั้งแรก', 'รัน setup-first-time.bat')) {
    /* ไม่รันจริงในโหมดตรวจ */
  } else {
    const firstTime = await runBatch(path.join(kitDir, RUNTIME_FILES.setupFirstTime), exec);
    if (!firstTime.ok) {
      step('ตั้งค่าครั้งแรก', 'fail', firstTime.reason);
      return finish(false, 4);
    }
    step('ตั้งค่าครั้งแรก', 'ok', 'สร้าง .env แล้ว');
  }

  // 6) ติดตั้ง dependency บนเครื่องนี้ — ชุดที่ดาวน์โหลดมาไม่ได้พา node_modules มา
  //    (483 MB ฝั่ง frontend · ถ้าใส่ในชุดจะใหญ่กว่านี้มาก · และ npm ci บนเครื่องเป้าหมาย
  //    เร็วกว่าดาวน์โหลด+แตก) — start-sovereign.bat จะเรียก `npm run build` ซึ่งต้องมี node_modules
  const depsTargets = [
    path.join(kitDir, 'sovereign-frontend'),
    path.join(kitDir, 'sovereign-os', 'core-api'),
  ].filter((d) => fs.existsSync(path.join(d, 'package.json')));

  for (const dir of depsTargets) {
    const nm = path.join(dir, 'node_modules');
    if (fs.existsSync(nm)) {
      step(`dependency ${path.basename(dir)}`, 'ok', 'มี node_modules อยู่แล้ว — ข้าม');
      continue;
    }
    if (wouldDo(`dependency ${path.basename(dir)}`, 'npm ci')) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    // ไม่มี lockfile = npm ci ใช้ไม่ได้ (ต้องไป install) — บอกชัดแทนที่จะล้มเงียบๆ
    const lock = fs.existsSync(path.join(dir, 'package-lock.json'));
    const cmd = lock ? 'ci' : 'install';
    step(`dependency ${path.basename(dir)}`, 'warn', `กำลัง npm ${cmd} (อาจใช้เวลาหลายนาที) · รุ่น ${pkg.version ?? '?'}`);
    const r = await exec('npm', [cmd, '--no-audit', '--no-fund'], { cwd: dir, timeout: 20 * 60 * 1000 });
    if (r.code !== 0 || !fs.existsSync(nm)) {
      step(`dependency ${path.basename(dir)}`, 'fail', `npm ${cmd} ล้ม (exit ${r.code}) — ต้องมีอินเทอร์เน็ต`);
      return finish(false, 45);
    }
    step(`dependency ${path.basename(dir)}`, 'ok', 'ติดตั้งแล้ว');
  }

  // 7) เริ่มระบบ (ฐานข้อมูล + API + เว็บ)
  if (wouldDo('เริ่มระบบ', 'รัน start-sovereign.bat (ดึง Docker หลาย GB — ใช้เวลานาน)')) {
    return finish(true, 0); // dry-run จบตรงนี้ ไม่ต้องไปข้างล่าง
  }
  const started = await runBatch(path.join(kitDir, RUNTIME_FILES.startSystem), exec);
  if (!started.ok) {
    step('เริ่มระบบ', 'fail', started.reason);
    return finish(false, 5);
  }
  step('เริ่มระบบ', 'ok', 'ฐานข้อมูล + API + เว็บ ทำงานแล้ว');

  // 8) ลงทะเบียนกับ HUB — หลังระบบขึ้น ไม่งั้นเครื่อง ghost ที่ไม่มีงาน
  // ⚠ setup-machine.mjs อยู่ใน tools/agent-pack ไม่ใช่ agent-runner
  //   (เคสจริง 12/10/69: ตรวจพาธเดิมตอนรันครั้งแรก → ไม่พบไฟล์ = เครื่องจริงติดตั้งไม่เสร็จ
  //    หลังดึง Docker หลาย GB มาแล้ว = เสียเวลาคนทั้งวัน) เทสต์ kit-files จับกรณีนี้
  const runnerDir = path.join(kitDir, 'sovereign-os', 'agent-runner');
  const setupMachine = path.join(kitDir, RUNTIME_FILES.enrollScript);
  if (!fs.existsSync(setupMachine)) {
    step('ลงทะเบียน HUB', 'fail', 'ไม่พบ tools/agent-pack/setup-machine.mjs — ชุดติดตั้งไม่ครบ');
    return finish(false, 6);
  }
  if (wouldDo('ลงทะเบียน HUB', `POST /enroll ที่ ${opts.hubUrl || 'HUB'} ด้วยรหัสเชิญ`)) {
    return finish(true, 0);
  }
  const enrollArgs = [
    setupMachine,
    '--enroll',
    ...(opts.hubUrl ? [`--hub-url=${opts.hubUrl}`] : []),
    ...(opts.code ? [`--code=${opts.code}`] : []),
    ...(opts.name ? [`--name=${opts.name}`] : []),
    '--dir=' + runnerDir,
  ];
  const enroll = await exec(process.execPath, enrollArgs);
  if (enroll.code !== 0) {
    step('ลงทะเบียน HUB', 'fail', (enroll.stdout || enroll.stderr || '').trim().split('\n').slice(-2).join(' '));
    return finish(false, 7);
  }
  step('ลงทะเบียน HUB', 'ok', (enroll.stdout || '').trim().split('\n').filter(Boolean).pop() ?? 'สำเร็จ');

  // 9) กันดิสก์เต็ม — ติดตั้งงานตัด WAL อัตโนมัติ
  if (!wouldDo('กันดิสก์เต็ม', 'ตั้งงานตัด WAL ทุกคืน 04:30')) {
    const guard = await installWalGuard({ kitDir, exec });
    step('กันดิสก์เต็ม', guard.ok ? 'ok' : 'warn', guard.reason);
  }

  return finish(true, 0);
}

/** รันไฟล์ .bat (ต้องผ่าน cmd.exe — Windows ไม่รัน .bat โดยตรง) */
export async function runBatch(batPath, exec = defaultExec) {
  if (!fs.existsSync(batPath)) return { ok: false, reason: `ไม่พบ ${path.basename(batPath)}` };
  const r = await exec('cmd.exe', ['/c', batPath], { timeout: 15 * 60 * 1000 });
  return {
    ok: r.code === 0,
    reason: r.code === 0 ? 'สำเร็จ' : `exit ${r.code} — ดู ${path.basename(batPath)} หรือ start-sovereign.log`,
  };
}

/** ติดตั้งงานตัด WAL อัตโนมัติ (ตัวเดียวกับที่ทำไว้ที่เครื่อง HUB) */
export async function installWalGuard({ kitDir, exec = defaultExec }) {
  const ps1 = path.join(kitDir, RUNTIME_FILES.pruneWalPs1);
  const cmd = path.join(kitDir, RUNTIME_FILES.pruneWalCmd);
  if (!fs.existsSync(ps1) || !fs.existsSync(cmd)) {
    return { ok: false, reason: 'ชุดติดตั้งไม่มีตัวตัด WAL — ติดตั้งเองภายหลังได้' };
  }
  const r = await exec('schtasks', [
    '/Create', '/F',
    '/TN', 'Sovereign Prune WAL',
    '/TR', `"${cmd}"`,
    '/SC', 'DAILY',
    '/ST', '04:30',
  ]);
  if (r.code !== 0) {
    return { ok: false, reason: `ตั้งงานไม่สำเร็จ (exit ${r.code}) — รันด้วยสิทธิ์ผู้ดูแลระบบ` };
  }
  return { ok: true, reason: 'ตัด WAL เก่าทุกคืน 04:30' };
}

/** พื้นที่ว่างของไดรฟ์ที่เก็บ path (GB) */
export function freeSpaceGb(target) {
  try {
    // เดินขึ้นไปจนเจอรากไดรฟ์
    let dir = path.resolve(target);
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const stat = fs.statfsSync?.(dir);
    if (stat) return stat.bavail * stat.bsize / 1024 ** 3;
  } catch {
    /* ไม่ได้ = คืน NaN ให้ checkSpace ตัดสินเอง (fail-closed) */
  }
  return Number.NaN;
}