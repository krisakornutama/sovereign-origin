// tools/agent-pack/pack.mjs
//
// ── แพ็ก "ชุดติดตั้งเครื่องลูก" ให้จบในขั้นตอนเดียว ──────────────────────────────
// เดิม: ผู้ใช้ต้องไปกด "ลงทะเบียนเครื่องใหม่" ในหน้าเว็บเอง → คัดลอก token → แก้ .env
//       → ตรวจ IP/firewall เอง → ค่อย copy โฟลเดอร์ไปเครื่องปลายทาง (พลาดง่ายมาก)
// ตอนนี้: รันคำสั่งนี้ที่เครื่อง HUB → ได้โฟลเดอร์ที่พร้อมก็อป → ดับเบิลคลิกที่เครื่องลูก
//         (ตัวแพ็กออก token ให้เองและฝังใน join.json — ไม่ต้องพิมพ์อะไรเลย)
//
//   node tools/agent-pack/pack.mjs --name="คอมเครื่องที่ 2"
//   node tools/agent-pack/pack.mjs --name="คอมเครื่องที่ 2" --dry-run
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const RUNNER_DIR = 'sovereign-os/agent-runner';
/** ที่ที่ลองเขียนตามลำดับ — รากไดรฟ์มักเขียนไม่ได้ (ต้องเป็นผู้ดูแลระบบ) */
export const OUT_DIR_CANDIDATES = [
  'E:\\SovereignOS-Machine-Setup',
  'E:\\My work\\SovereignOS-Machine-Setup',
  path.join(REPO_ROOT, '.freebuff', 'agent-pack-out'),
];

/** adapter ที่ไม่ใช่ LAN จริง — ห้ามใช้ IP ของพวกนี้ทำ HUB_URL */
const VIRTUAL_ADAPTER = /(vethernet|hyper-v|wsl|virtual|vmware|virtualbox|loopback|bluetooth|docker|tailscale|zerotier|npcap)/i;

/** หา URL ของ HUB จาก IP ในวง LAN ของเครื่องนี้เอง (ไม่ต้องพิมพ์) */
export function detectHubUrl(ifaces, port = 3000) {
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces ?? {})) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const addr of list ?? []) {
      const isV4 = addr?.family === 4 || addr?.family === 'IPv4';
      if (!isV4 || addr?.internal) continue;
      candidates.push(String(addr.address));
    }
  }
  const isPrivate = (ip) => /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  const pick = candidates.find(isPrivate) ?? candidates[0] ?? '127.0.0.1';
  return `http://${pick}:${port}`;
}

/**
 * เลือกโฟลเดอร์ปลายทางที่ "เขียนได้จริง" โดยไม่เขียนอะไรลงดิสก์
 * (ตรวจสิทธิ์ของบรรพบุรุษที่มีอยู่จริง — รากไดรฟ์ E: ของเครื่องจริงให้แค่ RX)
 */
export function pickWritableOutDir(candidates = OUT_DIR_CANDIDATES) {
  for (const candidate of candidates) {
    const dir = path.resolve(candidate);
    try {
      // ต้อง "เขียนจริง" เท่านั้นถึงจะรู้ — ACL ของโฟลเดอร์บน Windows ไม่ถูกจับด้วย fs.access
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe.tmp');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      // ที่นี้เขียนไม่ได้ — ลองที่ถัดไป
    }
  }
  return '';
}

/** ไฟล์ที่จะถูกก็อปไปเครื่องลูก — คำนวณจากโฟลเดอร์จริง ไม่ใช่รายการที่จำมา */
export function bundleFiles(root = REPO_ROOT) {
  const srcDir = path.join(root, RUNNER_DIR, 'src');
  const srcFiles = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .map((f) => `src/${f}`);
  return [...srcFiles, 'package.json', '.env.example', 'README.md', 'INSTALL-HUB.md', 'setup-machine.mjs', 'SETUP-MACHINE.cmd'];
}

/** ที่มาของไฟล์ในชุดติดตั้ง (ไฟล์ตัวติดตั้งมาจาก tools/agent-pack, ที่เหลือมาจาก agent-runner) */
export function bundleSource(root, rel) {
  if (rel === 'setup-machine.mjs' || rel === 'SETUP-MACHINE.cmd') return path.join(root, 'tools', 'agent-pack', rel);
  return path.join(root, RUNNER_DIR, rel);
}

/** ข้อความหน้าแรกที่คนอ่านเจอในโฟลเดอร์ชุดติดตั้ง (ห้ามมี token) */
export function renderStartHere({ machineName, hubUrl }) {
  return [
    '══════════════════════════════════════════════════',
    '  Sovereign OS — ชุดติดตั้ง "เครื่องลูก"',
    '══════════════════════════════════════════════════',
    `  เครื่องนี้จะลงทะเบียนกับ HUB: ${hubUrl}`,
    `  ชื่อที่จะโชว์บนหน้าเว็บ: ${machineName}`,
    '',
    '  วิธีใช้ (ที่เครื่องปลายทาง)',
    '   1) ก็อป "ทั้งโฟลเดอร์นี้" ไปวางบนไดรฟ์ E: ของเครื่องนั้น',
    '   2) ดับเบิลคลิก  SETUP-MACHINE.cmd',
    '   3) รอจนขึ้น "ออนไลน์แล้ว" → เปิดหน้าเว็บ HUB → คิวเอเจนต์ จะเห็นเครื่องนี้',
    '',
    '  ต้องมี: Node.js 20+ (ถ้าไม่มี ตัวติดตั้งจะพาไปติดตั้งให้) · Windows + PowerShell',
    '  ไม่ต้องตั้งค่า token หรือ IP เอง — ฝังมาใน join.json ให้แล้ว',
    '',
    '  ⚠️ ไฟล์นี้มี token ของเครื่องนี้อยู่ใน join.json — อย่าแชร์โฟลเดอร์นี้ให้คนอื่น',
    '     ถ้าติดตั้งเสร็จแล้ว เก็บ join.json ไว้เป็นหลักฐานได้ แต่ถ้าไม่ใช้แล้วให้ลบทิ้ง',
    '',
  ].join('\r\n');
}

function defaultExec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** ออก token ให้เครื่องใหม่ (ค่าเริ่มต้น: เรียกสคริปต์ฝั่ง core-api ซึ่งต่อ DB ของ HUB) */
async function issueToken({ root, name, executors, exec, issueCommand = null }) {
  const coreDir = path.join(root, 'sovereign-os', 'core-api');
  let cmd;
  let args;
  let cwd = coreDir;
  if (issueCommand) {
    cmd = issueCommand.cmd;
    args = issueCommand.args;
    cwd = issueCommand.cwd ?? coreDir;
  } else {
    // ห้ามเรียก npx.cmd ตรง ๆ — Node 20+ โยน spawn EINVAL ให้ไฟล์ .cmd
    // ⇒ เรียก tsx ผ่าน node ด้วยพาธจริง (ใช้ได้ทั้ง Windows/Linux)
    const tsxCli = path.join(coreDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!fs.existsSync(tsxCli)) {
      return { ok: false, error: `ไม่พบ tsx ที่ ${tsxCli} — ติดตั้ง dependency ของ core-api ก่อน (npm install)` };
    }
    cmd = process.execPath;
    args = [tsxCli, 'scripts/issue-machine-token.ts', `--name=${name}`, `--executors=${executors}`, '--json'];
  }
  const res = await exec(cmd, args, { cwd });
  const lines = String(res.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.token) return { ok: true, token: parsed.token, id: parsed.id, reused: Boolean(parsed.reused) };
      if (parsed?.error === 'name_exists') {
        return { ok: false, conflict: { id: parsed.id, lastHeartbeat: parsed.lastHeartbeat ?? null } };
      }
    } catch {
      // ไม่ใช่ JSON ของเรา — ลองบรรทัดก่อนหน้า
    }
  }
  return { ok: false, error: (res.stderr || res.stdout || `exit ${res.code}`).trim().split(/\r?\n/).slice(-3).join(' · ') };
}

/**
 * แพ็กชุดติดตั้งเครื่องลูก
 * @returns {{ exitCode: number, report: string, plan: string[], bundleDir: string, steps: Array<{name:string,status:string,detail:string}> }}
 */
export async function runPack({
  root = REPO_ROOT,
  outDir = '',
  name = '',
  hubUrl = '',
  executors = 'echo',
  token = '',
  force = false,
  dryRun = false,
  exec = defaultExec,
  issueCommand = null,
  platform = process.platform,
  interfaces = os.networkInterfaces(),
} = {}) {
  const steps = [];
  const plan = [];
  const add = (stepName, status, detail = '') => steps.push({ name: stepName, status, detail });
  const lines = [];
  /** รายงาน = ผลรายขั้น + ข้อความที่สะสมไว้ (ให้ผู้ใช้เห็นว่าอะไรสำเร็จ/ล้ม) */
  const render = () =>
    [
      ...steps.map((s) => {
        const mark = s.status === 'ok' ? '✔' : s.status === 'fail' ? '✘' : s.status === 'warn' ? '!' : '·';
        return `  ${mark} ${s.name}${s.detail ? ` — ${s.detail}` : ''}${s.nextAction ? `\n      ↳ ${s.nextAction}` : ''}`;
      }),
      '',
      ...lines,
    ].join('\n');  const machineName = String(name || os.hostname()).trim();
  const hub = String(hubUrl || detectHubUrl(interfaces)).replace(/\/$/, '');
  let target = outDir ? path.resolve(outDir) : dryRun ? OUT_DIR_CANDIDATES[0] : pickWritableOutDir();
  if (!target) target = '';

  plan.push(`เครื่องใหม่: ${machineName} (executors: ${executors})`);
  plan.push(`HUB_URL ที่จะฝังในชุดติดตั้ง: ${hub}`);
  plan.push(`โฟลเดอร์ปลายทาง (บนเครื่อง HUB): ${target || '(ไม่พบที่ที่เขียนได้ — ใช้ --out=<พาธของคุณ> )'}`);
  if (!outDir) plan.push(`เลือกอัตโนมัติจาก: ${OUT_DIR_CANDIDATES.join(' → ')}`);
  plan.push(`ไฟล์ที่จะก็อป: ${bundleFiles(root).length} ไฟล์ (จาก ${RUNNER_DIR} — ไม่รวม .env/test)`);
  plan.push('ออก token: node scripts/issue-machine-token.ts ผ่าน tsx ของ core-api (ต่อ DB ของ HUB)');

  if (dryRun) {
    add('plan', 'ok', `${plan.length} ขั้น`);
    lines.push('══════════════════════════════════════════════════');
    lines.push('  ชุดติดตั้งเครื่องลูก — [dry-run] ไม่ได้ลงมือ');
    lines.push('══════════════════════════════════════════════════');
    for (const p of plan) lines.push(`  · ${p}`);
    lines.push('');
    lines.push('  ขั้นถัดไป: ตัด --dry-run ออกเพื่อแพ็กจริง แล้วเอาโฟลเดอร์ไปเครื่องปลายทาง');
    return { exitCode: 0, report: render(), plan, bundleDir: target, steps };
  }

  if (!target) {
    add('output', 'fail', 'ไม่พบโฟลเดอร์ปลายทางที่เขียนได้');
    lines.push('  ✘ เขียนที่รากไดรฟ์ E: ไม่ได้ (ต้องเป็นผู้ดูแลระบบ) — ระบุเองด้วย --out="E:\\ที่ของคุณ" ');
    return { exitCode: 1, report: render(), plan, bundleDir: "", steps };
  }
  const joinPath = path.join(target, 'join.json');
  if (fs.existsSync(joinPath) && !force) {
    add('output', 'fail', `${joinPath} มีอยู่แล้ว`);
    lines.push(`  ✘ ${target} มีชุดติดตั้งอยู่แล้ว — ใช้ --force ถ้าตั้งใจแพ็กทับ (จะออก token ใหม่)`);
    return { exitCode: 1, report: render(), plan, bundleDir: target, steps };
  }

  // 1) token
  let machineToken = String(token ?? '').trim();
  if (!machineToken) {
    const issued = await issueToken({ root, name: machineName, executors, exec, issueCommand });
    if (!issued.ok && issued.conflict) {
      add('token', 'fail', `ชื่อ "${machineName}" ตรงกับเครื่องที่เคยออนไลน์แล้ว`);
      lines.push('  ✘ ชื่อนี้มีเครื่องที่เคยออนไลน์ใช้อยู่ — เลือกอย่างใดอย่างหนึ่ง:');
      lines.push('     · ใช้ชื่ออื่น:  --name="คอมเครื่องที่ 3"');
      lines.push('     · หรือถ้าตั้งใจเปลี่ยน token ของเครื่องนั้น (เครื่องเดิมจะหลุดจาก HUB):  --force');
      return { exitCode: 1, report: render(), plan, bundleDir: target, steps };
    }
    if (!issued.ok) {
      add('token', 'fail', issued.error);
      lines.push('  ✘ ออก token ไม่สำเร็จ — ตรวจว่า core-api ต่อ DB ได้ (DATABASE_URL) หรือชื่อเครื่องซ้ำ');
      lines.push(`     ${issued.error}`);
      return { exitCode: 1, report: render(), plan, bundleDir: target, steps };
    }
    machineToken = issued.token;
    if (issued.reused) {
      add('token', 'warn', `ชื่อ "${machineName}" มีแถวเดิมอยู่แล้วแต่ยังไม่เคยออนไลน์ — หมุน token ของแถวเดิม (ไม่สร้างซ้ำ)`);
    } else {
      add('token', 'ok', `ออก token ให้ "${machineName}" แล้ว (เก็บใน join.json ไม่แสดงที่นี่)`);
    }
  } else {
    add('token', 'warn', 'ใช้ token ที่ผู้ใช้ส่งมา (ไม่เรียก DB)');
  }

  // 2) ก็อปไฟล์
  const files = bundleFiles(root);
  for (const rel of files) {
    const from = bundleSource(root, rel);
    const to = path.join(target, rel);
    if (!fs.existsSync(from)) {
      add('copy', 'fail', `ไม่พบไฟล์ต้นทาง ${from}`);
      lines.push(`  ✘ แพ็กไม่สำเร็จ — ขาด ${from}`);
      return { exitCode: 1, report: render(), plan, bundleDir: target, steps };
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  add('copy', 'ok', `ก็อป ${files.length} ไฟล์ไป ${target}`);

  // 3) join.json + หน้าคู่มือ
  const join = {
    hubUrl: hub,
    machineToken,
    machineName,
    createdAt: new Date().toISOString(),
    note: 'สร้างโดย tools/agent-pack/pack.mjs — ไฟล์นี้มี token ของเครื่องนี้ อย่าแชร์',
  };
  fs.writeFileSync(joinPath, JSON.stringify(join, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(target, 'START-HERE.txt'), renderStartHere({ machineName, hubUrl: hub }), 'utf8');
  add('bundle', 'ok', 'เขียน join.json + START-HERE.txt');

  lines.push('══════════════════════════════════════════════════');
  lines.push('  ชุดติดตั้งเครื่องลูก — พร้อมแล้ว');
  lines.push('══════════════════════════════════════════════════');
  for (const p of plan) lines.push(`  · ${p}`);
  lines.push('');
  lines.push('  ขั้นถัดไป:');
  lines.push(`    1) ก็อปโฟลเดอร์ ${target} ไปเครื่องปลายทาง (USB/แชร์ LAN)`);
  lines.push('    2) ที่เครื่องนั้น: ดับเบิลคลิก SETUP-MACHINE.cmd');
  lines.push('    3) เปิดหน้าเว็บ HUB → คิวเอเจนต์ → เครื่องนี้จะขึ้นออนไลน์');
  return { exitCode: 0, report: render(), plan, bundleDir: target, steps };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgv(argv) {
  const out = { flags: new Set(), values: {} };
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[2] === undefined) out.flags.add(m[1]);
    else out.values[m[1]] = m[2];
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { flags, values } = parseArgv(process.argv.slice(2));
  if (flags.has('help') || flags.has('h') || process.argv.length <= 2) {
    console.log(`แพ็กชุดติดตั้งเครื่องลูก (รันบนเครื่อง HUB)

  node tools/agent-pack/pack.mjs --name="ชื่อเครื่องลูก" [options]

  --name=..        ชื่อเครื่องที่จะโชว์บนหน้าเว็บ (ค่าเริ่มต้น = ชื่อเครื่องนี้)
  --out=..         โฟลเดอร์ปลายทางบนเครื่อง HUB (ค่าเริ่มต้น ${DEFAULT_OUT_DIR})
  --hub-url=..     ที่อยู่ HUB ที่จะฝังให้เครื่องลูก (ค่าเริ่มต้น = IP ในวง LAN ของเครื่องนี้ :3000)
  --executors=..   executor ของเครื่องลูก เช่น echo หรือ echo,opencode (ค่าเริ่มต้น echo)
  --token=..       ใช้ token ที่มีอยู่แล้ว (ข้ามการออก token ใหม่)
  --force          แพ็กทับได้ (ออก token ใหม่)
  --dry-run        ดูแผนก่อน ไม่เขียน/ไม่รันอะไร
`);
    process.exit(0);
  }
  const out = await runPack({
    name: values.name ?? '',
    outDir: values.out ?? '',
    hubUrl: values['hub-url'] ?? '',
    executors: values.executors ?? 'echo',
    token: values.token ?? '',
    force: flags.has('force'),
    dryRun: flags.has('dry-run'),
  });
  console.log(out.report);
  process.exitCode = out.exitCode;
}
