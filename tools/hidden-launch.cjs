/**
 * tools/hidden-launch.cjs — เปิดคำสั่งให้ "ไม่มีหน้าต่าง console เด้ง" บน Windows
 *
 * ทำไมต้องมี
 * ──────────
 * ถ้าพาเรนต์ "ไม่มี console" (แอป GUI อย่าง Electron · Task Scheduler · ตัวที่รันแบบ
 * detached/windowsHide) แล้วมัน spawn "shell" (cmd.exe / .bat / .cmd) ตรง ๆ
 * ตัว shell จะไม่มี console ให้ลูกสืบทอด ⇒ ทุกโปรเซส console ที่ shell เรียกต่อ
 * (powershell · docker · npm · node) ต้องขอ console ใหม่ของตัวเอง = หน้าต่างจริงเด้ง
 *
 * เคสจริง 20/10/69: เจ้าของส่งภาพหน้าต่าง
 *   `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3001/api/health …`
 * เด้งขึ้นมาเอง — ต้นตอคือ Electron เปิด start-sovereign.bat ด้วย
 *   spawn(cmd, …, { detached: true, windowsHide: true })
 * แล้วลูป health check ใน .bat (ทุก 3 วิ) ยิง powershell ใหม่ทีละครั้ง = หน้าต่างเด้งรัว ๆ
 *
 * ทางแก้: ให้ wscript.exe เป็นคนรัน (โปรแกรม GUI — ไม่มี console ของตัวเอง)
 * ผ่าน tools/run-hidden.vbs → WshShell.Run(cmdline, 0, True) ให้ .cmd/.bat มี console
 * ของตัวเองแบบซ่อน (SW_HIDE) ลูกทุกตัวสืบทอด console ที่ซ่อนอยู่ = ไม่มีหน้าต่างเลย
 *
 * หลักฐานบนเครื่องนี้ (probe นับหน้าต่างที่ "มองเห็นได้" จริง · .freebuff/flashlab)
 *   · spawn(cmd, [{detached:true, windowsHide:true}])  → จับได้ `powershell …` + `docker info` (เด้ง!)
 *   · spawn(wscript, [run-hidden.vbs, cmdFile])        → 0 หน้าต่าง · .bat ทำงานจนจบแม้ปิดพาเรนต์ไปแล้ว
 *
 * ใช้จาก CJS (`require`) และ ESM (`import`) ได้ — สคริปต์ที่ใช้: sovereign-frontend/electron/main.js,
 * autostart.mjs · เทสต์: tools/test/windows-hide-guard.test.mjs
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** .cmd อ่านด้วย codepage ของ console → อักขระนอก ASCII ทำให้ cmd.exe พังทั้งไฟล์ (กฎ AGENTS.md) */
const ASCII_ONLY = /^[\x20-\x7E]+$/;
const WSCRIPT = 'wscript.exe';

/**
 * ต่อคำสั่งเดียวจากโปรแกรม + อาร์กิวเมนต์ (ใส่ quote เฉพาะที่จำเป็น)
 * @returns {string} command line
 */
function buildHiddenCli({ file, args = [], logFile = null }) {
  if (!file) throw new Error('buildHiddenCli: ต้องมี file');
  const q = (s) => (/[\s"]/.test(String(s)) ? `"${s}"` : String(s));
  const inner = [q(file), ...args.map(q)].join(' ');
  if (!logFile) return inner;
  // ต้องผ่าน cmd เพราะ WshShell.Run ไม่มี shell ให้ `>>` — cmd ตัวนี้อยู่ใน console ที่ซ่อนแล้ว
  return `cmd /c "${inner} >> ${q(logFile)} 2>&1"`;
}

/**
 * เนื้อไฟล์ VBS สำรอง (ใช้เมื่อไม่มี tools\run-hidden.vbs — เช่นแพ็กที่ไม่ก๊อปโฟลเดอร์ tools)
 * ทำหน้าที่เดียวกับ run-hidden.vbs: รันคำสั่งแบบซ่อน + คืน exit code
 */
function buildTempVbsBody(cli) {
  const escaped = String(cli).replace(/"/g, '""'); // ใน VBS: "" = เครื่องหมายคำพูดหนึ่งตัว
  return [
    "' sovereign hidden launcher (generated) - runs one command with no console window",
    'Option Explicit',
    'Dim sh, rc',
    'Set sh = CreateObject("WScript.Shell")',
    `rc = sh.Run("${escaped}", 0, True)`,
    'WScript.Quit rc',
    '',
  ].join('\r\n');
}

let seq = 0;

/**
 * เตรียมวิธีเปิดคำสั่งแบบไม่มีหน้าต่าง
 * @param {{ rootDir?: string, cli: string, tmpDir?: string, tag?: string }} opts
 *   rootDir = โฟลเดอร์ที่มี tools/run-hidden.vbs (ถ้าไม่มี จะสร้าง VBS ชั่วคราวเอง)
 * @returns {{ file: string, args: string[], cmdFile: string, vbs: string, hidden: true } | null}
 *   ส่งค่า null = ทำไม่ได้ (คำสั่งมีอักขระที่ .cmd รับไม่ได้ / เขียนไฟล์ไม่ได้) → ผู้เรียกต้องมีทางถอย
 */
function planHiddenLaunch({ rootDir, cli, tmpDir = os.tmpdir(), tag = 'sovereign-hidden' } = {}) {
  const cmd = String(cli ?? '').trim();
  if (!cmd || !ASCII_ONLY.test(cmd)) return null;
  // ไฟล์ต้องไม่ซ้ำกันระหว่างการเรียกที่ติดกัน (wscript อ่านไฟล์แบบ async — เขียนทับทันที = รันผิดคำสั่ง)
  const uniq = `${tag}-${process.pid}-${++seq}`;
  try {
    const cmdFile = path.join(tmpDir, `${uniq}.cmd`);
    fs.writeFileSync(cmdFile, `${cmd}\r\n`, { encoding: 'ascii' }); // CRLF · ไม่มี BOM

    let vbs = rootDir ? path.join(rootDir, 'tools', 'run-hidden.vbs') : '';
    if (!vbs || !fs.existsSync(vbs)) {
      vbs = path.join(tmpDir, `${uniq}.vbs`);
      fs.writeFileSync(vbs, buildTempVbsBody(cmd), { encoding: 'ascii' });
    }
    return { file: WSCRIPT, args: ['//B', '//Nologo', vbs, cmdFile], cmdFile, vbs, hidden: true };
  } catch {
    return null;
  }
}

module.exports = { buildHiddenCli, buildTempVbsBody, planHiddenLaunch, ASCII_ONLY, WSCRIPT };
