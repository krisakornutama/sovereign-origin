#!/usr/bin/env node
// tools/agent-pack/pack-machine.mjs
//
// ── "ถาม–ตอบ 2–3 ข้อ" แทนการพิมพ์คำสั่งยาว ───────────────────────────────────────
// คำสั่งจริงคือ
//   node tools/agent-pack/pack.mjs --name="เครื่องที่-4" --full --out="dist-machine-setup\เครื่องที่-4"
// เจ้าของต้องจำชื่อ, flag และพาธ — พลาดนิดเดียว (ลืม --full / แพ็กทับชุดเดิม / ชื่อชนเครื่องที่
// เคยออนไลน์แล้วจนจบด้วย error) ก็ต้องเริ่มใหม่ทั้งหมด
//
// ไฟล์นี้ทำให้เหลือ: ดับเบิลคลิก PACK-MACHINE.cmd → ตอบชื่อเครื่อง → (ถาม Ollama) → ยืนยัน
//
// กติกาที่ล็อกด้วยเทสต์ (tools/test/pack-machine-wizard.test.mjs):
//   · ไม่พิมพ์ token ออกหน้าจอ — pack.mjs เก็บลง join.json เท่านั้น
//   · ทุกเครื่องได้โฟลเดอร์ย่อยของตัวเอง ⇒ แพ็กเครื่องที่ 2 ไม่ทับชุดของเครื่องแรก
//   · ชื่อชนกับเครื่องที่เคยออนไลน์ = ถามชื่อใหม่ต่อในหน้าต่างเดิม
//   · โฟลเดอร์เดิมมีอยู่ = ถามก่อนเขียนทับ (ไม่ทับเงียบ ๆ และไม่ force เอง)
//   · กด Ctrl+C = จบอย่างสุภาพ ไม่มีอะไรถูกเขียน/ลงทะเบียน
//
// ใช้แบบไม่ถาม (สคริปต์/เทสต์):
//   node tools/agent-pack/pack-machine.mjs --name="เครื่องที่-4" --yes --dry-run
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUT_DIR_CANDIDATES, detectHubUrl, pickWritableOutDir, runPack } from './pack.mjs';

/** ชื่อที่ Windows ห้ามใช้เป็นชื่อโฟลเดอร์ (แม้จะมีนามสกุลต่อท้าย) */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** อักขระที่ Windows ห้ามในชื่อไฟล์/โฟลเดอร์ + ตัวควบคุมที่มองไม่เห็น */
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** เหตุผลที่ชื่อใช้ไม่ได้ — ข้อความให้ผู้ใช้อ่าน (ไม่ใช่รหัสลับ) */
export const NAME_ERRORS = {
  empty: 'ชื่อว่างไม่ได้',
  too_long: 'ยาวเกิน 64 ตัวอักษร',
  control: 'มีอักขระควบคุมที่มองไม่เห็น',
};

/**
 * ชื่อเครื่อง → ชื่อโฟลเดอร์ที่ Windows ใช้ได้ (คงภาษาไทยไว้ให้อ่านออก)
 * @param {unknown} name
 * @returns {string} ชื่อที่ปลอดภัยต่อการเอาไปต่อ path (ไม่ว่างแน่นอน)
 */
export function safeFolderName(name) {
  const cleaned = String(name ?? '')
    .replace(ILLEGAL_CHARS, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/, '')
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  if (!cleaned) return 'machine';
  return WINDOWS_RESERVED.test(cleaned) ? `${cleaned}-machine` : cleaned;
}

/**
 * ตรวจชื่อเครื่องก่อนเอาไปออก token (ชื่อนี้โชว์บนหน้าเว็บและเก็บใน DB)
 * @param {unknown} raw
 * @returns {{ ok: true, name: string } | { ok: false, error: keyof typeof NAME_ERRORS }}
 */
export function validateMachineName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'empty' };
  if (name.length > 64) return { ok: false, error: 'too_long' };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { ok: false, error: 'control' };
  return { ok: true, name };
}

/**
 * โฟลเดอร์ปลายทางของเครื่องนี้
 *   · ผู้ใช้ระบุ --out เอง = ใช้พาธนั้นตรง ๆ
 *   · ไม่ระบุ = <ที่เขียนได้>/<ชื่อเครื่อง> ⇒ เครื่องละโฟลเดอร์ ไม่ทับกัน
 * @returns {string} '' = ให้ pack.mjs เลือกเอง (ไม่มีที่ให้เขียน)
 */
export function outDirFor({ name, outRoot = '', explicitOut = '' }) {
  if (explicitOut) return path.resolve(explicitOut);
  if (!outRoot) return '';
  return path.join(path.resolve(outRoot), safeFolderName(name));
}

/** เปิดโฟลเดอร์ใน Explorer (ล้มเหลวได้โดยไม่ทำให้งานล้ม) */
export function openInExplorer(dir) {
  if (process.platform !== 'win32' || !dir) return;
  try {
    const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // เปิดไม่ได้ก็ไม่ใช่เหตุให้แพ็กที่สำเร็จแล้วกลายเป็นล้ม — ผู้ใช้เปิดเองได้
  }
}

/**
 * ลูปถาม–ตอบทั้งหมด (แยกจาก CLI เพื่อเทสต์ได้โดยไม่ต้องมี terminal)
 *
 * @param {object} opts
 * @param {(question: string) => Promise<string | null>} opts.ask  ถามหนึ่งคำถาม · คืน null = ผู้ใช้ยกเลิก
 * @param {Function} [opts.pack]  ค่าเริ่มต้น = runPack ของ pack.mjs
 * @param {(dir: string) => void} [opts.openFolder]
 * @param {(msg: string) => void} [opts.log]
 * @param {string} [opts.hostname]  ใช้เป็นชื่อเริ่มต้นเมื่อกด Enter
 * @param {string} [opts.hubUrl]    ว่าง = ตรวจ IP ในวง LAN เอง
 * @param {string} [opts.outRoot]   โฟลเดอร์แม่ของชุดติดตั้ง (ปกติ = ตัวเลือกแรกที่เขียนได้)
 * @param {string} [opts.presetName]      มีค่า = ข้ามคำถามชื่อ
 * @param {string} [opts.presetOutDir]    มีค่า = ใช้พาธนี้ตรง ๆ
 * @param {string} [opts.executors]
 * @param {boolean} [opts.fullKit]
 * @param {boolean|undefined} [opts.withOllama]  undefined = ถาม (โหมด interactive)
 * @param {boolean} [opts.assumeYes]  true = ไม่ถามอะไรเลย (สำหรับสคริปต์)
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ exitCode: number, code: string, bundleDir?: string, machineName?: string }>}
 */
export async function runWizard(opts = {}) {
  const {
    ask,
    pack = runPack,
    openFolder = openInExplorer,
    log = (msg) => console.log(msg),
    hostname = os.hostname(),
    hubUrl = '',
    outRoot = '',
    presetName = '',
    presetOutDir = '',
    executors = 'echo',
    fullKit = true,
    withOllama = undefined,
    assumeYes = false,
    dryRun = false,
  } = opts;

  if (typeof ask !== 'function') throw new Error('runWizard ต้องได้รับฟังก์ชัน ask');
  const interactive = !assumeYes;
  const hub = String(hubUrl || detectHubUrl(os.networkInterfaces())).replace(/\/$/, '');

  /** ยกเลิกแล้ว — ไม่มีอะไรถูกเขียน/ลงทะเบียน (ไม่ใช่ความล้มเหลว) */
  const canceled = () => {
    log('');
    log('  ยกเลิกแล้ว — ไม่มีอะไรถูกเขียนหรือลงทะเบียน');
    return { exitCode: 0, code: 'canceled' };
  };

  let picked = presetName ? validateMachineName(presetName) : null;
  if (picked && !picked.ok) {
    log(`  ✘ ชื่อเครื่องที่ให้มาใช้ไม่ได้ — ${NAME_ERRORS[picked.error] ?? picked.error}`);
    return { exitCode: 1, code: 'bad_name' };
  }
  let ollama = withOllama === true;
  let askedOllama = withOllama !== undefined || !fullKit;
  let force = false;

  // โฟลเดอร์แม่คำนวณครั้งเดียว (pickWritableOutDir สร้างโฟลเดอร์ให้จริง — ไม่ควรทำซ้ำทุกรอบ)
  // dry-run ห้ามแตะดิสก์ ⇒ ใช้ตัวเลือกแรกโดยไม่ทดสอบสิทธิ์
  const root = outRoot || (dryRun ? OUT_DIR_CANDIDATES[0] : pickWritableOutDir());

  if (interactive) {
    log('');
    log('══════════════════════════════════════════════════');
    log('  ชุดติดตั้งเครื่องใหม่ — ตอบสั้น ๆ ไม่ต้องพิมพ์คำสั่ง');
    log('  (กด Ctrl+C เพื่อยกเลิกได้ทุกเมื่อ)');
    log('══════════════════════════════════════════════════');
    log('');
  }

  const askName = async () => {
    for (;;) {
      const answer = await ask(`ชื่อเครื่องใหม่ (เช่น เครื่องที่-4) — Enter ใช้ "${hostname}": `);
      if (answer === null) return null;
      const check = validateMachineName(String(answer).trim() === '' ? hostname : answer);
      if (check.ok) return check.name;
      log(`  ! ชื่อนี้ใช้ไม่ได้ — ${NAME_ERRORS[check.error] ?? check.error} · ลองอีกครั้ง`);
    }
  };

  for (;;) {
    if (!picked) {
      if (!interactive) {
        // โหมดสคริปต์ที่ไม่ได้ส่งชื่อมา → ใช้ชื่อเครื่องนี้ (พฤติกรรมเดียวกับ pack.mjs)
        picked = validateMachineName(hostname);
        if (!picked.ok) return { exitCode: 1, code: 'bad_name' };
      } else {
        const next = await askName();
        if (next === null) return canceled();
        picked = { ok: true, name: next };
      }
    }
    const machineName = picked.name;

    if (interactive && !askedOllama) {
      askedOllama = true;
      const raw = await ask('รวมโมเดล Ollama (~20GB) ไปด้วยไหม? [y/N]: ');
      if (raw === null) return canceled();
      ollama = /^(y|yes|ใช่)$/i.test(String(raw).trim());
    }

    const target = outDirFor({ name: machineName, outRoot: root, explicitOut: presetOutDir });

    if (interactive) {
      log('');
      log(`  เครื่องใหม่ : ${machineName}`);
      log(`  HUB        : ${hub}`);
      log(
        `  ชุดติดตั้ง : ${target || '(ให้ pack.mjs เลือกโฟลเดอร์เอง)'}` +
          ` — ${fullKit ? 'ทั้งโปรเจ็ก' : 'เฉพาะ runner'}${ollama ? ' + Ollama' : ''}`,
      );
      if (!dryRun) log('  หมายเหตุ   : แพ็กจริงจะลงทะเบียนเครื่องนี้กับ HUB และออก token ให้หนึ่งครั้ง');
      if (/^http:\/\/(127\.0\.0\.1|localhost)/i.test(hub)) {
        log('  ! ตรวจไม่พบ IP ในวง LAN ของเครื่องนี้ — เครื่องปลายทางจะต่อ HUB ไม่ได้');
        log('    ถ้าเครื่องลูกอยู่คนละเครื่อง ให้ระบุ --hub-url=http://<IP ของ HUB>:3000');
      }
      const yes = await ask(dryRun ? 'ดูแผนก่อนใช่ไหม? [Y/n]: ' : 'ดำเนินการเลยไหม? [Y/n]: ');
      if (yes === null) return canceled();
      if (/^(n|no|ไม่)$/i.test(String(yes).trim())) return canceled();
    }

    // ── ลองแพ็ก (ซ้ำได้เมื่อโฟลเดอร์เดิมมีอยู่ — โดยไม่ถามซ้ำทั้งชุด) ──
    for (;;) {
      const res = await pack({
        name: machineName,
        outDir: target,
        hubUrl: hub,
        executors,
        fullKit,
        withOllama: ollama,
        dryRun,
        force,
      });

      if (res?.report) log(res.report);

      if (res?.exitCode === 0) {
        const dir = res.bundleDir || target;
        if (!dryRun) {
          log('');
          log('  ✔ เสร็จแล้ว — ชุดติดตั้งพร้อมก็อปไปเครื่องปลายทาง');
          log(`     ${dir}`);
          log('');
          log('  ขั้นต่อไป:');
          log('    1) ก็อป "ทั้งโฟลเดอร์" นี้ไปไว้บนไดรฟ์ E: ของเครื่องปลายทาง (USB/แชร์ LAN)');
          log('    2) ที่เครื่องนั้น ดับเบิลคลิก  tools\\agent-pack\\SETUP-MACHINE.cmd');
          log('    3) เปิดหน้าเว็บ HUB → คิวเอเจนต์ → เครื่องนี้จะขึ้นออนไลน์');
          log('  หลังจากนั้นไม่ต้องก็อปไฟล์อีก: เครื่องลูกอัปเดตตัวเองจาก HUB');
          // เปิด Explorer ให้เฉพาะคนที่นั่งอยู่หน้าจอ — โหมดสคริปต์ (--yes) ต้องไม่เด้งหน้าต่าง
          if (interactive && openFolder) openFolder(dir);
        }
        return { exitCode: 0, code: 'ok', bundleDir: dir, machineName };
      }

      if (res?.code === 'name_conflict') {
        if (!interactive) return { exitCode: 1, code: 'name_conflict' };
        log('');
        log(`  ! ชื่อ "${machineName}" มีเครื่องที่เคยออนไลน์แล้ว — พิมพ์ชื่ออื่นได้เลย`);
        picked = null;
        break; // ออกไปถามชื่อใหม่ที่ลูปนอก (ไม่ถามคำถามอื่นซ้ำ)
      }

      if (res?.code === 'out_exists') {
        if (!interactive) return { exitCode: 1, code: 'out_exists' };
        log('');
        log(`  ! มีชุดติดตั้งของ "${machineName}" อยู่แล้ว`);
        const overwrite = await ask(
          '     แพ็กทับหรือไม่? (ออก token ใหม่ · ถ้าเครื่องนั้นออนไลน์อยู่จะหลุดจาก HUB) [y/N]: ',
        );
        if (overwrite === null) return canceled();
        if (!/^(y|yes|ใช่)$/i.test(String(overwrite).trim())) {
          log('  ไม่ได้แตะอะไร — ย้าย/ลบโฟลเดอร์เดิม หรือใช้ชื่อเครื่องอื่น แล้วรันใหม่');
          return { exitCode: 1, code: 'out_exists' };
        }
        force = true;
        continue; // ลองแพ็กซ้ำทันที
      }

      return { exitCode: res?.exitCode ?? 1, code: res?.code ?? 'failed' };
    }
  }
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

const HELP = `ชุดติดตั้งเครื่องใหม่ — แบบตอบคำถาม (ปกติดับเบิลคลิก PACK-MACHINE.cmd)

  node tools/agent-pack/pack-machine.mjs [options]

  --name=..        ชื่อเครื่อง (ไม่ระบุ = ถาม; ในโหมด --yes ใช้ชื่อเครื่องนี้)
  --out=..         โฟลเดอร์ปลายทางตรง ๆ (ค่าเริ่มต้น = ${OUT_DIR_CANDIDATES[0]}\\<ชื่อเครื่อง>)
  --hub-url=..     ที่อยู่ HUB ที่จะฝังให้เครื่องลูก (ค่าเริ่มต้น = IP ในวง LAN :3000)
  --executors=..   executor ของเครื่องลูก เช่น echo หรือ echo,opencode (ค่าเริ่มต้น echo)
  --full           ยกทั้งโปรเจ็ก (ค่าเริ่มต้น)
  --minimal        เฉพาะ agent-runner
  --with-ollama    รวมโมเดล Ollama (~20GB) โดยไม่ถาม
  --yes            ไม่ถามอะไรเลย (สำหรับสคริปต์) — ใช้ร่วมกับ --name
  --dry-run        ดูแผนก่อน ไม่เขียน/ไม่รันอะไร/ไม่ออก token
  --help           แสดงข้อความนี้
`;

async function main() {
  const { flags, values } = parseArgv(process.argv.slice(2));
  if (flags.has('help') || flags.has('h')) {
    console.log(HELP);
    return 0;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let aborted = false;
  rl.on('SIGINT', () => {
    aborted = true;
    rl.close();
  });
  const ask = async (question) => {
    if (aborted) return null;
    try {
      return await rl.question(question);
    } catch {
      return null; // หน้าต่างถูกปิด/Ctrl+C ระหว่างรอคำตอบ
    }
  };

  try {
    const res = await runWizard({
      ask,
      presetName: values.name ?? '',
      presetOutDir: values.out ?? '',
      hubUrl: values['hub-url'] ?? '',
      executors: values.executors ?? 'echo',
      fullKit: !flags.has('minimal'),
      withOllama: flags.has('with-ollama') ? true : undefined,
      // ไม่มี console ให้ตอบ (CI/สคริปต์) = ห้ามค้างรอตลอดกาล
      assumeYes: flags.has('yes') || flags.has('y') || !process.stdin.isTTY,
      dryRun: flags.has('dry-run'),
    });
    return res.exitCode;
  } finally {
    rl.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`\n  ✘ ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}
