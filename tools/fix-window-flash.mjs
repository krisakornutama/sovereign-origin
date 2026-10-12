#!/usr/bin/env node
/* ── ซ่อมงานตั้งเวลาที่ทำให้หน้าต่าง console เด้งขึ้นมาจู่ ๆ ──────────────────
   เคสจริง 12/10/69 (เครื่องนี้): เจ้าของเห็นหน้าต่าง node/docker โผล่มาเอง
     ทั้งที่ไม่ได้สั่งอะไร และบอกว่า "จู่ ๆ ก็เด้งขึ้นมาเอง"

   สาเหตุ: Task Scheduler เปิดงานแบบ "Run only when user is logged on"
     จะเปิดหน้าต่าง console จริงทุกครั้งที่งานนั้นรัน
     งานที่ทำถูกต้องต้องวิ่งผ่าน wscript.exe //B run-hidden.vbs
     (wscript ไม่เปิดหน้าต่าง แต่ยังคืน exit code ให้ Task Scheduler ดูได้)

   ตรวจพบว่างานเหล่านี้ถูกลงทะเบียนผิด — เรียก node.exe/cmd ตรง ๆ:
     · Sovereign Docker Watch    ทุกนาที  → เด้งทุกนาที
     · Sovereign Frontend Watch   ทุกนาที  → เด้งทุกนาที
     (Machine Watch / Synthetic Browser Check ทำถูกแล้ว)

   ใช้:
     node tools/fix-window-flash.mjs --dry-run   ดูก่อนว่าจะแก้อะไร
     node tools/fix-window-flash.mjs             ซ่อมจริง (ต้องใช้สิทธิ์ผู้ดูแล)
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const WSCRIPT = 'C:\\Windows\\System32\\wscript.exe';
const LAUNCHER = path.join(ROOT, 'tools', 'run-hidden.vbs');

/** งานที่รันทุกนาที = เด้งบ่อยที่สุด จึงเป็นปัญหาหลัก */
export const VISIBLE_TASKS = [
  { task: 'Sovereign Docker Watch', cmd: 'sovereign-docker-watch.cmd', script: 'tools\\docker-watchdog.mjs' },
  { task: 'Sovereign Frontend Watch', cmd: 'sovereign-frontend-watch.cmd', script: 'tools\\frontend-watchdog.mjs' },
];

/** ตัว .cmd ต้องเป็น ASCII + CRLF + ไม่มี BOM (กฎของโปรเจกต์) */
export function buildCmdLine(scriptRel) {
  return `"${process.execPath}" "${path.join(ROOT, scriptRel)}"\r\n`;
}

export function writeCmdFile(fileAbs, body) {
  if (/[^\x00-\x7F]/.test(body)) throw new Error('.cmd ต้องเป็น ASCII ล้วน');
  fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
  fs.writeFileSync(fileAbs, Buffer.from(body, 'ascii'));
}

/** คำสั่งที่ซ่อนหน้าต่างได้จริง — wscript เป็นตัวเดียวที่ไม่มี console */
export function hiddenAction(cmdRel) {
  return `"${WSCRIPT}" //B "${LAUNCHER}" "${path.join(ROOT, 'tools', 'hidden-tasks', cmdRel)}"`;
}

/** ตรวจว่างานนี้ถูกลงทะเบียนแบบเปิดหน้าต่างหรือไม่ (ใช้ตอนเทสต์/ตรวจซ้ำ) */
export function isVisibleAction(action) {
  const a = String(action ?? '').trim();
  if (!a) return false;
  if (/wscript\.exe/i.test(a)) return false;
  // เรียก node/cmd/powershell ตรงในงานแบบ interactive = เปิด console แน่นอน
  //   ขอบเขตแคบไปเกินไปจับไม่ได้: 'C:\Program Files\nodejs\node.exe' มี "\" คั่นชื่อไฟล์
  //   (เคสจริง 12/10/69: เทสต์ผ่านมั่วเพราะจับไม่เจอ แล้วไปตรวจว่างานจริง "ผ่าน" ทั้งที่ยังเปิดหน้าต่าง)
  return /(^|[\\/\s"'])(node|cmd|powershell|pwsh)\.exe(\s|$|")/i.test(a);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function isAdmin() {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    '(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  ], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return String(r.stdout ?? '').toLowerCase().includes('true');
}

/**
 * ไฟล์สำหรับดับเบิลคลิก — ยกระดับสิทธิ์เอง แล้วรันตัวซ่อม
 * (schtasks แก้งานของผู้ใช้ไม่ได้ถ้าไม่มีสิทธิ์ผู้ดูแล และเจ้าของไม่ควรต้องรู้เรื่องนี้)
 *
 * ASCII ล้วน · CRLF · ไม่มี BOM (กฎของโปรเจกต์ — ข้อความไทยใน .cmd ทำให้ cmd.exe พัง)
 */
export function buildFixCmd() {
  const tool = path.join(ROOT, 'tools', 'fix-window-flash.mjs').replace(/'/g, "''");
  return [
    '@echo off',
    'REM ============================================================================',
    'REM  Fix: stop the console windows that pop up by themselves.',
    'REM  Every Sovereign task that runs node.exe directly opens a window.',
    'REM  This file raises itself to administrator and repairs them.',
    'REM  ASCII only on purpose - Thai text inside a .cmd breaks cmd.exe.',
    'REM ============================================================================',
    'chcp 65001 >nul 2>&1',
    'setlocal EnableExtensions DisableDelayedExpansion',
    '',
    'net session >nul 2>&1',
    'if not errorlevel 1 goto :isadmin',
    'echo.',
    'echo   Requesting administrator permission ...',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"`,
    'exit /b 0',
    ':isadmin',
    '',
    `node "${tool}" %*`,
    'set "RC=%ERRORLEVEL%"',
    'echo.',
    'if not "%RC%"=="0" echo   FAILED - exit %RC%',
    'pause',
    'exit /b %RC%',
  ].join('\r\n') + '\r\n';
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  ซ่อมงานตั้งเวลาที่ทำให้หน้าต่าง console เด้งขึ้นมา');
  console.log('══════════════════════════════════════════════════');
  console.log(`  ${DRY ? '[DRY RUN] ' : ''}${ROOT}`);

  if (!fs.existsSync(LAUNCHER)) {
    console.error(`\n  X ไม่พบ ${LAUNCHER} — งานนี้พึ่งตัวนี้ในการซ่อนหน้าต่าง`);
    process.exit(1);
  }

  // เขียนไฟล์ .cmd ที่งานจะเรียก (ต้องมีก่อน ไม่งั้น wscript จะออกด้วยรหัส 2)
  for (const t of VISIBLE_TASKS) {
    const abs = path.join(ROOT, 'tools', 'hidden-tasks', t.cmd);
    const body = buildCmdLine(t.script);
    if (DRY) {
      console.log(`  [dry-run] เขียน ${t.cmd}`);
    } else {
      writeCmdFile(abs, body);
      console.log(`  เขียน ${t.cmd}`);
    }
  }

  // ลงทะเบียนงานใหม่ผ่านตัวซ่อนหน้าต่าง
  let failed = false;
  if (!DRY && !isAdmin()) {
    // งานที่ลงทะเบียนไว้ด้วยบัญชีผู้ใช้ แก้ได้โดยไม่ต้องยกระดับ
    //   (เคสจริง 12/10/69: schtasks /change /disable ทำได้เลย → จึงลองลงทะเบียนใหม่ก่อน
    //    ค่อยบอกให้ยกระดับเฉพาะเมื่อสั่งจริงแล้วล้ม)
    console.log('  (ยังไม่มีสิทธิ์ผู้ดูแล — จะลองลงทะเบียนก่อน งานของผู้ใช้มักแก้ได้)');
  }

  for (const t of VISIBLE_TASKS) {
    const action = hiddenAction(t.cmd);
    if (DRY) {
      console.log(`  [dry-run] ตั้งงาน "${t.task}" → ${action}`);
      continue;
    }
    const r = run('schtasks.exe', [
      '/Create', '/F',
      '/TN', t.task,
      '/TR', action,
      '/SC', 'MINUTE', '/MO', '1',
      '/RL', 'LIMITED',
    ]);
    console.log(r.code === 0 ? `  ✔ ${t.task} → ซ่อนหน้าต่างแล้ว` : `  ✘ ${t.task}: ${r.out.trim().slice(0, 160)}`);
    if (r.code !== 0) failed = true;
  }

  if (failed) {
    console.error('\n  X ลงทะเบียนไม่สำเร็จ — ต้องใช้สิทธิ์ผู้ดูแลระบบ');
    console.error('    ดับเบิลคลิก FIX-WINDOW-FLASH.cmd ที่รากโครงการ — มันยกระดับสิทธิ์ให้เอง');
    process.exitCode = 1;
  }

  if (!DRY) {
    console.log('\n  ตรวจซ้ำ:');
    for (const t of VISIBLE_TASKS) {
      const q = run('schtasks.exe', ['/query', '/TN', t.task, '/fo', 'CSV', '/v']);
      const m = /"([^"]*node\.exe[^"]*|[^",]*wscript\.exe[^",]*)"/i.exec(q.out);
      const visible = isVisibleAction(m ? m[1] : q.out);
      console.log(`  ${visible ? '✘' : '✔'} ${t.task}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // เขียนไฟล์ดับเบิลคลิกไว้ข้างเคียงเสมอ แล้วค่อยซ่อม
  const cmdPath = path.join(ROOT, 'FIX-WINDOW-FLASH.cmd');
  const body = buildFixCmd();
  if (!DRY) {
    if (/[^\x00-\x7F]/.test(body)) throw new Error('FIX-WINDOW-FLASH.cmd ต้องเป็น ASCII ล้วน');
    fs.writeFileSync(cmdPath, Buffer.from(body, 'ascii'));
  }
  await main();
}

export { run, isAdmin };
