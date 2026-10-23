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
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// สูตรคำนวณเวอร์ชัน/แฮชต้องเป็นตัวเดียวกับฝั่งเครื่องลูก — import โมดูลของ runner ตรง ๆ
// (ถ้าเขียนสูตรซ้ำสองที่ วันหนึ่งสองฝั่งจะตกลงกันไม่ได้ แล้วเครื่องลูกจะอัปเดตวนไม่จบ)
import { computeVersionFromEntries, sha256Hex } from '../../sovereign-os/agent-runner/src/selfUpdate.mjs';
import { UPDATE_SIGNING_KEY_ID, canonicalManifestPayload } from '../../sovereign-os/agent-runner/src/updateTrust.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const RUNNER_DIR = 'sovereign-os/agent-runner';
/** ที่เก็บชุดอัปเดตฝั่ง HUB — อยู่ใน volume ที่คอนเทนเนอร์ mount ไว้แล้ว (ไม่ต้องแก้ compose/rebuild) */
export const UPDATE_DATA_DIR = 'sovereign-os/core-api/data/agent-updates';
/** ที่ที่ลองเขียนตามลำดับ — เรียงจาก "ในโปรเจ็ก" ออกไปข้างนอก
 *  คำสั่งเจ้าของ 10/10/69: ของที่เกี่ยวข้องต้องอยู่กับโปรเจ็ก ไม่กระจายไปรากไดรฟ์/โฟลเดอร์ข้างนอก
 *  โฟลเดอร์นี้ถูก gitignore ผ่าน pattern "dist-*" แล้ว และ join.json ข้างในมี machine token — ห้าม commit
 *  สองตัวท้ายคงไว้เป็นทางถอย เผื่อเครื่องที่เขียนในโปรเจ็กไม่ได้ */
export const OUT_DIR_CANDIDATES = [
  path.join(REPO_ROOT, 'dist-machine-setup'),
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
  return [...srcFiles, 'package.json', '.env.example', 'README.md', 'INSTALL-HUB.md', 'setup-machine.mjs', 'SETUP-MACHINE.cmd', 'run-runner.cmd'];
}

/** ที่มาของไฟล์ในชุดติดตั้ง (ไฟล์ตัวติดตั้งมาจาก tools/agent-pack, ที่เหลือมาจาก agent-runner) */
export function bundleSource(root, rel) {
  if (rel === 'setup-machine.mjs' || rel === 'SETUP-MACHINE.cmd' || rel === 'run-runner.cmd') return path.join(root, 'tools', 'agent-pack', rel);
  return path.join(root, RUNNER_DIR, rel);
}

// ── ชุด "ติดตั้งทุกฟังก์ชั่น" (ทั้งโปรเจ็ก) ─────────────────────────────────────
//
// เจ้าของสั่ง 11/10/69: "ผมต้องการติดตั้งทุกฟังก์ชั่น" ⇒ ชุดที่ยกไปเครื่องอื่น
// ต้องมี **ทุกส่วน** ของโปรเจ็ก (เว็บ · API · ฐานข้อมูล · docker · runner · เครื่องมือ · เอกสาร · เฟิร์มแวร์)
// ไม่ใช่แค่ agent-runner อย่างชุด OTA
//
// แต่ยังคัดของที่ "ไม่ควรไปเด็ดขาด" ออกเสมอ:
//   · ความลับ (.env* ทุกไฟล์) — เครื่องปลายทางสร้างของตัวเองจาก setup-first-time
//   · ของที่สร้างใหม่ได้ (node_modules · .next · dist · build · __pycache__)
//   · ข้อมูลรันจริง/สำรอง (backups · logs · data) และไฟล์ชั่วคราว (*.log/*.tmp/*.pid)
//   · โฟลเดอร์เอาต์พุตของตัวแพ็กเอง (dist-*) — ข้างในมี machine token
//   · .freebuff (worktree/สถานะของแอป) และ tools/Git (toolchain ประจำเครื่อง ~500MB ไม่ใช่โค้ดโปรเจ็ก)
//   · โมเดล Ollama (~20GB) — เปิดมาด้วย withOllama เมื่อต้องการจริง ๆ

/** ชื่อโฟลเดอร์/ไฟล์ที่ข้ามเสมอ (ตรงกับ SKIP_NAMES ฝั่ง launcher เพื่อให้สองระบบคัดเหมือนกัน) */
export const FULL_KIT_SKIP_DIRS = new Set([
  '.git',
  '.freebuff',
  '.next',
  '.next-verify',
  '.turbo',
  '.cache',
  '.playwright-browsers',
  'node_modules',
  'backups',
  'logs',
  'data',
  '__pycache__',
  'build',
  'dist',
  'coverage',
]);

/** ไฟล์นามสกุลที่ไม่ยกไป (บันทึก/ไฟล์ชั่วคราว) */
export const FULL_KIT_SKIP_EXT = ['.log', '.tmp', '.pid'];

// .next ทุกพันธุ์เป็น artifact ของ build (รวม .next.broken-* ที่เก็บไว้สอบสวน)
// ห้ามหลุดเข้า kit — ตรงกับ tools/build-node-kit.mjs
const isBuildArtifactDir = (name) => name === '.next' || name.startsWith('.next-') || name.startsWith('.next.');

/** ไฟล์ระบบปฏิบัติการที่ไม่มีความหมายบนเครื่องอื่น */
export const FULL_KIT_SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/**
 * ไฟล์ที่ล็อกอยู่ขณะอ่าน — ข้ามเสมอ (ไม่ใช่ของที่ต้องก๊อปไปเครื่องอื่น)
 *   · *.lock ของ Docker = ไฟล์ชั่วคราวตอน Docker daemon กำลังรัน
 *     อ่านแล้วได้ EBUSY บน Windows (เคสจริง 11/10/69 — BUILD-KIT ล้มกลางคันทั้งชุด)
 *   · ไม่มีความหมายกับเครื่องอื่นอยู่แล้ว = ข้ามโดยไม่เสียดี
 */
const FULL_KIT_LOCKED_EXT = ['.lock'];

/**
 * ไฟล์ที่ใหญ่ผิดปกติ = ข้อมูลส่วนตัว/ดิสก์เสมือน ไม่ใช่โค้ดโปรเจกต์
 *   เคสจริง 11/10/69: Docker/wsl/disk/docker_data.vhdx = 88 GB
 *   ⇒ node อ่านไฟล์ >2 GB ไม่ได้ (ERR_FS_FILE_TOO_LARGE) → BUILD-KIT ล้มกลางคันทั้งชุด
 *
 * เกณฑ์: ข้ามเมื่อใหญ่กว่าเพดานนี้ **และ** ไม่ใช่ไฟล์ที่ระบุว่าอยู่ในชุด
 * (โมเดลเสียง/ข้อมูลที่ตั้งใจพกไป เช่น whisper ggml ยังผ่านตามปกติ)
 */
const KIT_MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB
const KIT_ALLOWED_BIG = [/\.bin$/i]; // โมเดลที่ตั้งใจพกไป (เช่น whisper)

function isSuspiciouslyLarge(absPath, rel = '') {
  if (KIT_ALLOWED_BIG.some((re) => re.test(rel))) return false;
  let size = 0;
  try {
    size = fs.statSync(absPath).size;
  } catch {
    return true; // อ่านไม่ได้ = ไม่เอาไป (กัน BUILD-KIT ล้มตอนอ่าน)
  }
  return size > KIT_MAX_FILE_BYTES;
}

/**
 * เส้น/โฟลเดอร์ที่ข้าม (เทียบกับ path สัมพัทธ์แบบ /)
 * tools/Git = PortableGit ของเครื่องนี้ · tools/piper = ไบนารีที่แตกจาก piper.zip (ตัว zip ยังไปด้วย)
 * tools/E-Tipitaka = ชุดข้อมูลภายนอก · dist-* = เอาต์พุตของตัวแพ็ก (มี token)
 * Docker/wsl = ดิสก์ข้อมูล Docker ของเครื่องนี้ (vhdx ~88 GB — เคสจริง 11/10/69
 *   BUILD-KIT ล้ม ERR_FS_FILE_TOO_LARGE เพราะพยายามอ่านทั้งไฟล์) · เครื่องปลายทาง
 *   ต้องติดตั้ง Docker เอง ไม่ใช่ก๊อปดิสก์คนละเครื่องไป
 */
export const FULL_KIT_SKIP_REL = ['tools/Git', 'tools/piper', 'tools/E-Tipitaka', 'Docker/wsl'];

/** โฟลเดอร์ที่ข้ามเพราะเป็นเอาต์พุตของตัวแพ็กเอง (ข้างในมี join.json/token) */
const FULL_KIT_SKIP_REL_PREFIX = ['dist-', 'sovereign-frontend/dist-electron/'];

/**
 * ชื่อไฟล์ที่เป็น "ความลับของเครื่อง" — ห้ามยกไปเครื่องอื่น
 * `.env.example` / `.env.sample` / `.env.template` ไม่นับ: เป็นตัวอย่างให้เครื่องใหม่คัดลอกใช้
 */
export function isSecretEnvName(name) {
  if (!name.startsWith('.env')) return false;
  return !/^\.env\.(example|sample|template)$/i.test(name);
}

/**
 * ไฟล์ทั้งโปรเจ็กที่ยกไปกับชุดติดตั้ง (คำนวณจากการเดินบนดิสก์จริง — ไม่ใช่รายการที่จำมา)
 * @param {string} root repo ของ HUB
 * @param {{ withOllama?: boolean }} [opts] withOllama = ยกโมเดล Ollama (~20GB) ไปด้วย
 * @returns {string[]} path สัมพัทธ์แบบ / เรียงตามชื่อ (ใช้เทียบแฮช/ตรวจความครบได้)
 */
export function fullKitFiles(root = REPO_ROOT, opts = {}) {
  const withOllama = opts.withOllama === true;
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // อ่านไม่ได้ (สิทธิ์/ถูกล็อก) = ข้าม ไม่ทำให้ทั้งชุดล้ม
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (FULL_KIT_SKIP_DIRS.has(entry.name) || isBuildArtifactDir(entry.name)) continue;
      if (FULL_KIT_SKIP_FILES.has(entry.name)) continue;
      if (isSecretEnvName(entry.name)) continue; // ความลับห้ามหลุดออกจากเครื่องนี้ (.env.example ผ่านได้)
      if (!withOllama && childRel === 'Ollama') continue;
      if (FULL_KIT_SKIP_REL.includes(childRel)) continue;
      if (FULL_KIT_SKIP_REL_PREFIX.some((p) => childRel.startsWith(p))) continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), childRel);
        continue;
      }
      if (!entry.isFile()) continue; // symlink/อุปกรณ์ — ไม่ก็อป
      const ext = path.extname(entry.name).toLowerCase();
      if (FULL_KIT_SKIP_EXT.includes(ext)) continue;
      if (FULL_KIT_LOCKED_EXT.includes(ext)) continue; // *.lock ของ Docker (EBUSY ตอนอ่าน)
      if (isSuspiciouslyLarge(path.join(dir, entry.name), childRel)) continue;
      out.push(childRel);
    }
  };
  walk(root, '');
  return out;
}

/** ที่มาของไฟล์ในชุดทั้งโปรเจ็ก = ตัวไฟล์ใน repo ตรง ๆ (path สัมพัทธ์เท่านั้น) */
export function fullKitSource(root, rel) {
  return path.join(root, ...String(rel).split('/'));
}

/**
 * สรุปเป็นรายส่วน (โฟลเดอร์บนสุด) — ใช้รายงานว่า "ชุดนี้ครอบคลุมอะไรบ้าง" ให้เจ้าของอ่าน
 * @returns {Array<{ part: string, files: number }>} เรียงมาก→น้อย
 */
export function kitPartSummary(files) {
  const byPart = new Map();
  for (const rel of files) {
    const part = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(ไฟล์ที่รากโปรเจ็ก)';
    byPart.set(part, (byPart.get(part) ?? 0) + 1);
  }
  return [...byPart.entries()]
    .map(([part, count]) => ({ part, files: count }))
    .sort((a, b) => b.files - a.files || a.part.localeCompare(b.part));
}

/** ชื่อไฟล์ private key เริ่มต้น (อยู่นอก data dir ที่ mount เข้า container; gitignore ผ่าน *.pem) */
export const UPDATE_SIGNING_KEY_FILE = 'signing-key.pem';
/** path ของ private key เมื่อเทียบกับ repo root — ห้ามอยู่ใน core-api/data เพราะ container มองเห็น */
export const UPDATE_SIGNING_KEY_PATH = 'tools/agent-pack/keys/signing-key.pem';

/**
 * หา private key สำหรับเซ็น manifest
 * ลำดับ: signingKey (ส่งตรง) → env AGENT_UPDATE_SIGNING_KEY → ไฟล์ signingKeyPath/env → repo/tools/agent-pack/keys
 * ต้องมีก่อนเขียนชุดเสมอ — ไม่มี key = ไม่เผยแพร่ manifest ที่ยังไม่เซ็น
 * หมายเหตุ: private key ต้องไม่อยู่ใน core-api/data (container mount เห็น) — HUB มีไว้ตรวจ public key เท่านั้น
 */
export function resolveUpdateSigningKey({ root = REPO_ROOT, signingKey = '', signingKeyPath = '' } = {}) {
  const keyId = String(process.env.AGENT_UPDATE_SIGNING_KEY_ID || UPDATE_SIGNING_KEY_ID).trim() || UPDATE_SIGNING_KEY_ID;
  const normalizePem = (pem) => String(pem).replace(/\\n/g, '\n');
  const inline = signingKey || process.env.AGENT_UPDATE_SIGNING_KEY;
  if (inline) return { privateKeyPem: normalizePem(inline), keyId, keyPath: null };

  const file = path.resolve(signingKeyPath || process.env.AGENT_UPDATE_SIGNING_KEY_PATH || path.join(root, UPDATE_SIGNING_KEY_PATH));
  if (!fs.existsSync(file)) {
    throw new Error(
      `ไม่พบ private key สำหรับเซ็น manifest: ${file} — ` +
        'สร้าง Ed25519 keypair แล้วเก็บ private key ไว้ที่ path นี้ (ดู docs/modules/fleet.md)',
    );
  }
  return { privateKeyPem: normalizePem(fs.readFileSync(file, 'utf8')), keyId, keyPath: file };
}

/**
 * เผยแพร่ชุดอัปเดตให้ "เครื่องลูกที่ออนไลน์อยู่" ดึงไปใช้เอง (ไม่ต้องก็อปไฟล์ผ่าน USB อีก)
 * เขียนลง core-api/data/agent-updates/ = โฟลเดอร์ที่คอนเทนเนอร์ HUB มองเห็นอยู่แล้ว
 * เซ็น manifest ด้วย Ed25519; ไม่มี private key = throw ก่อนแตะไฟล์เดิม
 * คืน { version, files, dir, signature } · throw เมื่อไฟล์ต้นทางหาย (จะได้ไม่เผยแพร่ชุดที่ไม่ครบ)
 */
export function publishUpdateBundle({
  root = REPO_ROOT,
  dataDir = '',
  log = () => {},
  signingKey = '',
  signingKeyPath = '',
} = {}) {
  const dir = path.resolve(dataDir || path.join(root, UPDATE_DATA_DIR));
  const signing = resolveUpdateSigningKey({ root, signingKey, signingKeyPath });
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(signing.privateKeyPem);
  } catch {
    throw new Error(`private key สำหรับเซ็น manifest อ่านไม่ได้ (${signing.keyPath || 'inline key'})`);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`private key ต้องเป็น Ed25519 (พบ ${privateKey.asymmetricKeyType || 'unknown'})`);
  }

  const files = bundleFiles(root);
  const entries = files.map((rel) => {
    const from = bundleSource(root, rel);
    if (!fs.existsSync(from)) throw new Error(`เผยแพร่ชุดอัปเดตไม่ได้ — ไม่พบไฟล์ต้นทาง ${from}`);
    const body = fs.readFileSync(from);
    return { path: rel, sha256: sha256Hex(body), size: body.length };
  });
  const version = computeVersionFromEntries(entries);

  // เซ็นก่อนลบ/เขียนไฟล์ใด ๆ: ถ้า key ผิดหรือ sign ล้ม ต้องไม่ทิ้งชุดเดิมให้เสียหาย
  const base = { version, generatedAt: new Date().toISOString(), files: entries };
  const signature = {
    alg: 'ed25519',
    keyId: signing.keyId,
    value: crypto.sign(null, canonicalManifestPayload(base), privateKey).toString('base64'),
  };
  const manifest = { ...base, signature };

  // เขียนทับทั้งชุด: ลบของเก่าก่อน เพื่อไม่ให้ไฟล์ที่ถูกถอดออกจากชุดค้างอยู่ในโฟลเดอร์ files/
  fs.rmSync(path.join(dir, 'files'), { recursive: true, force: true });
  for (const rel of files) {
    const to = path.join(dir, 'files', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(bundleSource(root, rel), to);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  log(`[agent-pack] เผยแพร่ชุดอัปเดตเวอร์ชัน ${version} (${files.length} ไฟล์) ที่ ${dir} — เซ็นด้วย ${signing.keyId}`);
  return { version, files: entries, dir, signature };
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
    '   2) ดับเบิลคลิก  tools\\agent-pack\\SETUP-MACHINE.cmd',
    // เคสจริง 11/10/69: เดิมบอกแค่ "SETUP-MACHINE.cmd" แต่ไฟล์อยู่ลึก 2 ชั้น
    //   (tools\agent-pack\) → ผู้ใช้ไล่หาไม่เจอ คิดว่าชุดเสีย
    '      (ไฟล์อยู่ในโฟลเดอร์ tools\\agent-pack\\ — ไม่ได้อยู่ระดับบนสุด)',
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
  /** fullKit = ยก "ทั้งโปรเจ็ก" ไปเครื่องนั้น (ติดตั้งทุกฟังก์ชั่น) · false = เฉพาะ runner (ชุดเล็กสำหรับ OTA) */
  fullKit = false,
  /** withOllama = ยกโมเดล Ollama (~20GB) ไปด้วย (มีผลเมื่อ fullKit) */
  withOllama = false,
  exec = defaultExec,
  issueCommand = null,
  platform = process.platform,
  interfaces = os.networkInterfaces(),
  updateDataDir = '',
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
  // ชุดเต็ม = ทั้งโปรเจ็ก (ทุกฟังก์ชั่น) · ชุดเล็ก = เฉพาะ runner ตามเดิม
  const fileList = fullKit ? fullKitFiles(root, { withOllama }) : bundleFiles(root);
  const sourceOf = (rel) => (fullKit ? fullKitSource(root, rel) : bundleSource(root, rel));
  plan.push(
    fullKit
      ? `ไฟล์ที่จะก็อป: ${fileList.length} ไฟล์ — ทั้งโปรเจ็ก (ทุกฟังก์ชั่น)${withOllama ? ' + โมเดล Ollama' : ''} · ไม่รวม .env/ของที่สร้างใหม่ได้`
      : `ไฟล์ที่จะก็อป: ${fileList.length} ไฟล์ (จาก ${RUNNER_DIR} — ไม่รวม .env/test)`
  );
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
    lines.push('  ✘ เขียนโฟลเดอร์ปลายทางในโปรเจ็กและที่สำรองไม่ได้ — ระบุเองด้วย --out="E:\\ที่ของคุณ" ');
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

  // 2) ก็อปไฟล์ (fileList/sourceOf ถูกเลือกตามโหมดตั้งแต่ต้นฟังก์ชัน)
  const files = fileList;
  for (const rel of files) {
    const from = sourceOf(rel);
    const to = path.join(target, rel);
    if (!fs.existsSync(from)) {
      add('copy', 'fail', `ไม่พบไฟล์ต้นทาง ${from}`);
      lines.push(`  ✘ แพ็กไม่สำเร็จ — ขาด ${from}`);
      return { exitCode: 1, report: render(), plan, bundleDir: target, steps };
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  add('copy', 'ok', `ก็อป ${files.length} ไฟล์ไป ${target}${fullKit ? ' (ทั้งโปรเจ็ก)' : ''}`);

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

  // 4) เผยแพร่ชุดอัปเดตบน HUB — เครื่องลูกที่ออนไลน์อยู่จะดึงไปใช้เองในรอบถัดไป
  try {
    const published = publishUpdateBundle({ root, dataDir: updateDataDir, log: (m) => lines.push(`  ${m}`) });
    add('update', 'ok', `เผยแพร่ชุดอัปเดตเวอร์ชัน ${published.version} (${published.files.length} ไฟล์) ให้เครื่องลูกดึงเอง`);
    plan.push(`ชุดอัปเดตเวอร์ชัน: ${published.version} (${published.files.length} ไฟล์) — เครื่องลูกที่อัปเดตโค้ดเองได้อยู่จะได้เวอร์ชันนี้ทันที`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    add('update', 'warn', `เผยแพร่ชุดอัปเดตไม่สำเร็จ: ${msg}`);
    lines.push('  ! เครื่องลูกจะยังรันโค้ดเดิมและไม่ได้รับเวอร์ชันนี้ — แก้ไฟล์ต้นทางแล้วรันแพ็กใหม่');
  }

  lines.push('══════════════════════════════════════════════════');
  lines.push('  ชุดติดตั้งเครื่องลูก — พร้อมแล้ว');
  lines.push('══════════════════════════════════════════════════');
  for (const p of plan) lines.push(`  · ${p}`);
  lines.push('');
  lines.push('  ขั้นถัดไป:');
  lines.push(`    1) ก็อปโฟลเดอร์ ${target} ไปเครื่องปลายทาง (USB/แชร์ LAN)`);
  lines.push('    2) ที่เครื่องนั้น: ดับเบิลคลิก SETUP-MACHINE.cmd');
  lines.push('    3) เปิดหน้าเว็บ HUB → คิวเอเจนต์ → เครื่องนี้จะขึ้นออนไลน์');
  lines.push('  หลังจากนี้ไม่ต้องก็อปไฟล์อีก: เครื่องลูกเช็คเวอร์ชันกับ HUB เองแล้วอัปเดต+รีสตาร์ทตัวเอง');
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
  --out=..         โฟลเดอร์ปลายทางบนเครื่อง HUB (ค่าเริ่มต้น ${OUT_DIR_CANDIDATES[0]})
  --hub-url=..     ที่อยู่ HUB ที่จะฝังให้เครื่องลูก (ค่าเริ่มต้น = IP ในวง LAN ของเครื่องนี้ :3000)
  --executors=..   executor ของเครื่องลูก เช่น echo หรือ echo,opencode (ค่าเริ่มต้น echo)
  --full           ยก "ทั้งโปรเจ็ก" ไปด้วย (ติดตั้งทุกฟังก์ชั่น — ไฟล์เยอะกว่า แต่ครบ)
  --minimal        เฉพาะ agent-runner (ชุดเล็ก — ใช้เมื่อเครื่องนั้นต้องเป็นแค่โหนดรับคำสั่ง)
  --with-ollama    รวมโมเดล Ollama (~20GB) — ใช้กับ --full
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
    // ดีฟอลต์ของ CLI = ชุดเต็ม (ติดตั้งทุกฟังก์ชั่น) — --minimal ค่อยกลับไปชุดเล็ก
    fullKit: !flags.has('minimal'),
    withOllama: flags.has('with-ollama'),
  });
  console.log(out.report);
  process.exitCode = out.exitCode;
}
