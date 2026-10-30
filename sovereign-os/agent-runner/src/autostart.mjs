// src/autostart.mjs — "เครื่องลูกเปิด runner เองตอนล็อกอิน" โดยไม่ต้องกดอะไร
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────────────
// เดิมการตั้ง autostart อยู่ที่ setup-machine.mjs (schtasks /SC ONLOGON) ครั้งเดียวตอนติดตั้ง
// เจอจริงบนเครื่อง 2: `schtasks /Create` **ล้มเงียบ** เพราะ path มีเว้นวรรค/ไม่มีสิทธิ์ admin
// ⇒ ผู้ใช้ต้องดับเบิลคลิกเปิด runner เองทุกครั้งที่บูต แล้วลืม = เครื่องหลุดจาก HUB
//
// ── ทางแก้: runner ดูแลตัวเองทุกครั้งที่บูต (รันซ้ำได้ผลเท่าเดิม) ────────────────
//   1) เขียน `autostart-hidden.vbs` ในโฟลเดอร์ runner — ตัวเปิดแบบซ่อนหน้าต่าง
//      (ผ่าน run-runner.cmd ⇒ crash แล้วฟื้นเอง และรับช่วง self-update exit 86)
//   2) วางไฟล์ชี้ใน Startup folder ของผู้ใช้ (`%APPDATA%\...\Startup\`)
//      ⇒ ทางนี้ **ไม่ต้องสิทธิ์ admin** และเป็นทางสำรองที่เชื่อถือได้ที่สุด
//   3) พยายามสร้าง Scheduled Task ชื่อเดิม (ถ้ายังไม่มี) — ล้มได้ ไม่ทำให้ runner ล้ม
//
// ⚠️ ไฟล์ .vbs ต้องเป็น UTF-16LE + BOM: path ไทย/ยูนิโค้ดถ้าเขียน UTF-8
//    wscript จะอ่านเป็นตัวขยะแล้วเปิดไม่ขึ้น (เงียบสนิท ไม่มี error ให้เห็น)
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const STARTUP_FILE_NAME = 'Sovereign Agent Runner.vbs';
export const HIDDEN_LAUNCHER_NAME = 'autostart-hidden.vbs';
export const TASK_NAME = 'Sovereign Agent Runner';
export const AUTOSTART_MARKER = "' sovereign-autostart v1";
/** ต้องเป็น UTF-16LE (มี BOM) เท่านั้น — ดูเหตุผลหัวไฟล์ */
export const VBS_ENCODING = 'utf16le';
const BOM = '\uFEFF';

/** อ่านสวิตช์ปิดจาก .env — ค่าเริ่มต้น = เปิด */
export function isAutostartEnabled(env = {}) {
  const raw = String(env?.AUTOSTART ?? '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

/** โฟลเดอร์ Startup ของผู้ใช้ปัจจุบัน (ว่าง = ไม่รู้จัก %APPDATA%) */
export function resolveStartupDir({ appData = '' } = {}) {
  const base = String(appData ?? '').trim();
  if (!base) return '';
  return path.join(base, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

/**
 * เนื้อหา VBS ตัวเปิดจริง (ซ่อนหน้าต่าง)
 * - มี run-runner.cmd = ใช้ตัวห่อ (รีสตาร์ทเองเมื่อ crash · ไม่เริ่มซ้ำตอน self-update)
 * - ไม่มี = เรียก node ตรง ๆ
 */
export function buildHiddenLauncher({ runnerDir, hasWrapper = true, nodeExe = 'node' }) {
  const dir = String(runnerDir ?? '').replace(/[\\/]+$/, '');
  // ใน VBS เครื่องหมายคำพูดหนึ่งตัวเขียนเป็น "" ⇒ บรรทัดล่างนี้กลายเป็น cmd /c "E:\...\run-runner.cmd"
  const command = hasWrapper
    ? `cmd /c ""${dir}\\run-runner.cmd""`
    : `"${nodeExe}" "${dir}\\src\\main.mjs"`;
  return BOM + [
    `${AUTOSTART_MARKER} — เปิด Sovereign Agent Runner แบบไม่เด้งหน้าต่าง`,
    `' ลบไฟล์นี้ = ปิดการเปิดเอง (หรือตั้ง AUTOSTART=false ใน .env)`,
    `Set sh = CreateObject("WScript.Shell")`,
    `sh.CurrentDirectory = "${dir}"`,
    `sh.Run "${command}", 0, False`,
    '',
  ].join('\r\n');
}

/** ไฟล์เล็กใน Startup folder — ชี้ไปตัวเปิดจริง (path เดียว จึงแก้ที่เดียว) */
export function buildStartupEntry({ hiddenLauncherPath }) {
  return BOM + [
    `${AUTOSTART_MARKER} — จุดเริ่มของ Windows`,
    `' ลบไฟล์นี้ = ปิดการเปิดเอง`,
    `CreateObject("WScript.Shell").Run "wscript.exe ""${hiddenLauncherPath}""", 0, False`,
    '',
  ].join('\r\n');
}

const execFileAsync = promisify(execFile);

/** รันคำสั่งแบบไม่ throw — คืน { code, stdout, stderr } เสมอ */
async function defaultExec(file, args = [], opts = {}) {
  try {
    const r = await execFileAsync(file, args, { ...opts, windowsHide: true });
    return { code: 0, stdout: String(r?.stdout ?? ''), stderr: String(r?.stderr ?? '') };
  } catch (err) {
    return {
      code: typeof err?.code === 'number' ? err.code : 1,
      stdout: String(err?.stdout ?? ''),
      stderr: String(err?.stderr ?? err?.message ?? err),
    };
  }
}

/** เขียนเฉพาะเมื่อเนื้อหาเปลี่ยน (idempotent — ถูกเรียกทุกครั้งที่บูต) */
function writeIfChanged(fsImpl, file, content) {
  try {
    if (fsImpl.existsSync(file) && fsImpl.readFileSync(file, VBS_ENCODING) === content) return false;
  } catch {
    // อ่านไม่ได้/ไฟล์เสีย = เขียนทับด้วยของถูกต้อง
  }
  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    // มีอยู่แล้ว/สร้างไม่ได้ — ปล่อยให้ writeFileSync ตัดสินอีกครั้ง
  }
  fsImpl.writeFileSync(file, content, VBS_ENCODING);
  return true;
}

/**
 * ติดตั้ง autostart (เรียกทุกครั้งที่ runner บูต)
 * @returns {Promise<{ok:boolean, status:'installed'|'unchanged'|'skipped', reason?:string,
 *   startup:'created'|'unchanged'|'skipped', task:'created'|'exists'|'failed'|'skipped',
 *   taskError?:string, hiddenLauncherPath:string, startupPath:string}>}
 */
export async function ensureAutostart({
  runnerDir,
  appData = process.env.APPDATA,
  platform = process.platform,
  env = process.env,
  fsImpl = fsSync,
  exec = defaultExec,
  log = () => {},
} = {}) {
  const out = {
    ok: true,
    status: 'unchanged',
    startup: 'skipped',
    task: 'skipped',
    hiddenLauncherPath: '',
    startupPath: '',
  };

  if (platform !== 'win32') {
    out.status = 'skipped';
    out.reason = 'ไม่ใช่ Windows';
    return out;
  }
  if (!isAutostartEnabled(env)) {
    out.status = 'skipped';
    out.reason = 'ปิดด้วย AUTOSTART=false';
    return out;
  }
  const dir = String(runnerDir ?? '').trim();
  if (!dir) {
    out.status = 'skipped';
    out.reason = 'ไม่รู้โฟลเดอร์ของ runner';
    return out;
  }

  let created = false;

  // 1) ตัวเปิดจริงในโฟลเดอร์ runner
  const hiddenPath = path.join(dir, HIDDEN_LAUNCHER_NAME);
  out.hiddenLauncherPath = hiddenPath;
  const hasWrapper = fsImpl.existsSync(path.join(dir, 'run-runner.cmd'));
  if (writeIfChanged(fsImpl, hiddenPath, buildHiddenLauncher({ runnerDir: dir, hasWrapper }))) {
    created = true;
    log(`สร้างตัวเปิดอัตโนมัติ: ${hiddenPath}`);
  }

  // 2) Startup folder (ไม่ต้อง admin)
  const startupDir = resolveStartupDir({ appData });
  if (startupDir) {
    const startupPath = path.join(startupDir, STARTUP_FILE_NAME);
    out.startupPath = startupPath;
    const wrote = writeIfChanged(fsImpl, startupPath, buildStartupEntry({ hiddenLauncherPath: hiddenPath }));
    out.startup = wrote ? 'created' : 'unchanged';
    if (wrote) {
      created = true;
      log(`วางจุดเริ่มใน Startup: ${startupPath}`);
    }
  } else {
    out.startup = 'skipped';
    out.reason = 'ไม่พบ %APPDATA% — ใช้ Scheduled Task อย่างเดียว';
  }

  // 3) Scheduled Task (ทางเสริม) — มีอยู่แล้วไม่ต้องสร้าง · ล้มได้ไม่ทำให้ runner ล้ม
  const query = await exec('schtasks', ['/Query', '/TN', TASK_NAME], { windowsHide: true });
  if (query?.code === 0) {
    out.task = 'exists';
  } else {
    const tr = `wscript.exe "${hiddenPath}"`;
    const made = await exec(
      'schtasks',
      ['/Create', '/TN', TASK_NAME, '/TR', tr, '/SC', 'ONLOGON', '/F'],
      { windowsHide: true },
    );
    if (made?.code === 0) {
      out.task = 'created';
      created = true;
      log(`สร้าง Scheduled Task "${TASK_NAME}" (ตอนล็อกอิน)`);
    } else {
      out.task = 'failed';
      out.taskError = String(made?.stderr || made?.stdout || `exit ${made?.code ?? '?'}`).trim();
      log(`สร้าง Scheduled Task ไม่สำเร็จ (ใช้ Startup folder แทน): ${out.taskError}`);
    }
  }

  out.status = created ? 'installed' : 'unchanged';
  return out;
}
