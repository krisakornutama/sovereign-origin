#!/usr/bin/env node
/* ── สร้าง "ตัวติดตั้งไฟล์เดียว" ที่คนก๊อปไปเครื่องใหม่แล้วดับเบิลคลิกได้ ────
   เจ้าของสั่ง 12/10/69: "ไฟล์เดียวจบ ไม่ต้องทำทีละเครื่อง"
   เดิม: ก๊อปโฟลเดอร์ 700 MB แล้วเลือกว่าจะกดไฟล์ไหน → "ผมงงมากเลย เครื่องลูกไม่รู้จะรันไฟล์ไหน"

   ── โครงสร้างไฟล์เดียว ──────────────────────────────────────────────────
   .cmd (ASCII ล้วน, ไม่มี BOM, CRLF)
     ├─ บรรทัดคำสั่ง cmd ไม่กี่บรรทัด: เปิด PowerShell แล้วสั่งให้ "อ่านตัวเอง"
     │   ตัดหัวข้อก่อนหมุด #####PSPAYLOAD##### แล้วรันส่วนที่เหลือ
     └─ payload = PowerShell ขั้นตอนที่ 1 (ASCII/English เท่านั้น)
          ติดต่อ HUB → ดาวน์โหลด install-node.ps1 → ตรวจ sha256 → เรียก

   ── ทำไมถึงแบ่งเป็นสองชั้น ──────────────────────────────────────────────
   • ไฟล์ .cmd ต้องเป็น ASCII ล้วน (กฎของโปรเจกต์) — cmd.exe อ่านไฟล์ด้วย codepage
     ของคอนโซล ถ้ามีไทยก่อน `chcp 65001` จะถูกตีความเป็นคำสั่ง → ทั้งไฟล์พัง
     (เจอจริง 10/10/69 ทั้งโปรเจกต์)
   • ข้อความที่คนอ่านต้องเป็นไทย ⇒ อยู่ใน install-node.ps1 ที่ HUB เสิร์ฟ (UTF-8 + BOM)
   • payload ขั้นที่ 1 เล็กมาก จึงฝังใน .cmd ได้โดยยังเป็น ASCII
   • ไม่มีรหัสเชิญฝังในไฟล์นี้ — ของที่คนก๊อปไปติดตัวไปทุกเครื่อง
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRLF = '\r\n';

/** หมุดคั่นส่วน payload — ความยาวถูกแทรกเข้าไปในสคริปต์ของ cmd ให้ตัดให้ตรง */
export const MARKER = '#####PSPAYLOAD#####';
const MARKER_LEN = MARKER.length;

/**
 * payload ขั้นตอนที่ 1 — ASCII ล้วน (มีบังคับตรวจที่ writeCmd)
 * หน้าที่: หา HUB → ดาวน์โหลดตัวติดตั้งจริง → ตรวจแฮช → ส่งต่อ
 */
export function buildPayload() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    '',
    'function Die($m, $code) {',
    "  Write-Host ''",
    "  Write-Host ('  FAILED: ' + $m) -ForegroundColor Red",
    "  Write-Host '  Nothing was installed. Full details: logs\\install-node.log'",
    '  exit $code',
    '}',
    '',
    'Write-Host \'\'',
    "Write-Host '==========================================================='",
    "Write-Host '  Sovereign OS - install this machine as a node'",
    "Write-Host '==========================================================='",
    "Write-Host ''",
    '',
    '# --- where is the HUB? arg > preset file > env > default ---',
    '$hub = $env:SOV_HUB',
    '$code = $env:SOV_CODE',
    '$name = $env:SOV_NAME',
    '',
    '$preset = Join-Path $env:SOV_DIR \'install-node.txt\'',
    "if (Test-Path $preset) {",
    "  $txt = Get-Content $preset -Raw -Encoding utf8",
    "  if ($txt -match '(?m)^\\s*HUB_URL\\s*=\\s*(.+)$') { $hub = $Matches[1].Trim() }",
    "  if (-not $code -and $txt -match '(?m)^\\s*MACHINE_ENROLL_CODE\\s*=\\s*(.+)$') { $code = $Matches[1].Trim() }",
    "  if (-not $name -and $txt -match '(?m)^\\s*MACHINE_NAME\\s*=\\s*(.+)$') { $name = $Matches[1].Trim() }",
    '}',
    "if (-not $hub) { $hub = 'http://192.168.1.102:3000' }",
    "$hub = $hub.TrimEnd('/')",
    "if ($hub -notmatch '^https?://') { Die (\"Bad HUB address: $hub\") 1 }",
    "Write-Host ('  HUB : ' + $hub)",
    "Write-Host ('  This machine : ' + $env:COMPUTERNAME)",
    "Write-Host ''",
    '',
    "# --- ask the HUB what to download ---",
    "$manifestUrl = $hub + '/api/agent-machines/node-kits/manifest/'",
    'try {',
    '  $m = Invoke-RestMethod -Uri $manifestUrl -TimeoutSec 25',
    '} catch {',
    '  Die ("Cannot reach the HUB at $manifestUrl - check that it is on and you are on the same network.") 2',
    '}',
    '',
    "if (-not $m.bootstrapSha256) {",
    "  Write-Host '  This HUB has not published the single-file installer yet.' -ForegroundColor Yellow",
    "  Write-Host '  Ask the owner to run:  node tools/build-node-kit.mjs --publish'",
    '  exit 3',
    '}',
    '',
    '# --- download the real installer ---',
    "$tmp = Join-Path $env:TEMP 'sovereign-install.ps1'",
    "Write-Host '  Downloading the installer script ...'",
    '$ProgressPreference = \'SilentlyContinue\'',
    'try {',
    "  Invoke-WebRequest -Uri ($hub + '/api/agent-machines/node-kits/bootstrap/') -OutFile $tmp -TimeoutSec 120 -UseBasicParsing",
    '} catch {',
    '  Die ("Download failed: " + $_.Exception.Message) 4',
    '}',
    '',
    '# --- verify before running anything that came over the network ---',
    '$got = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()',
    'if ($got -ne $m.bootstrapSha256.ToLower()) {',
    '  Remove-Item $tmp -Force -ErrorAction SilentlyContinue',
    '  Die "The downloaded installer does not match the hash the HUB published. Refusing to run it (file deleted)." 5',
    '}',
    "Write-Host '  Verified against the hash published by the HUB.'",
    "Write-Host ''",
    '',
    '# --- hand over: this is where the Thai messages live ---',
    '$p = @{',
    "  HubUrl = $hub",
    "  Code   = $code",
    "  Name   = $name",
    '}',
    "if ($env:SOV_DRYRUN -eq '1') { $env:COV_DRYRUN = '1' }",
    '$rc = 0',
    'try {',
    '  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp @p',
    '  $rc = $LASTEXITCODE',
    '} catch {',
    '  Write-Host $_.Exception.Message',
    '  $rc = 9',
    '} finally {',
    '  Remove-Item $tmp -Force -ErrorAction SilentlyContinue',
    '}',
    'exit $rc',
  ];
}

/** คำสั่ง cmd หัวไฟล์ — ทั้งหมด ASCII */
export function buildCmdHead() {
  return [
    '@echo off',
    'REM ============================================================================',
    'REM  Sovereign OS - install this machine as a full node',
    'REM',
    'REM  Double-click this file. That is the whole procedure.',
    'REM',
    'REM  This file is ASCII only on purpose. Thai text inside a .cmd breaks',
    'REM  cmd.exe (it reads files using the console code page). Thai messages come',
    'REM  from install-node.ps1, which is downloaded from the HUB as UTF-8.',
    'REM',
    'REM  No secret is stored in this file, so it is safe to copy anywhere.',
    'REM  Optional: put install-node.txt next to it with HUB_URL / MACHINE_ENROLL_CODE',
    'REM  Optional args:  "%~nx0" HUB_URL  ENROLL_CODE  MACHINE_NAME',
    'REM ============================================================================',
    'chcp 65001 >nul 2>&1',
    'setlocal EnableExtensions DisableDelayedExpansion',
    '',
    // ── ขอสิทธิ์ผู้ดูแลระบบก่อนทุกอย่าง ──────────────────────────────────
    // เคสจริง 12/10/69: winget ติดตั้ง Docker Desktop ไม่ได้
    //   "The installer will request to run as administrator" → ตัวติดตั้งรันไม่มีสิทธิ์
    //   winget ล้ม exit 1 แล้วตัวติดตั้งบอก "ติดตั้งเองแล้วรันซ้ำ" ทั้งที่คนไม่รู้ว่าต้องกดอะไร
    //   ⇒ ขอสิทธิ์เองตั้งแต่ต้น คนกดดับเบิลคลิกครั้งเดียวเหมือนเดิม
    //   (ยังจำเป็นอีกจุด: ตั้งงานตัด WAL ด้วย schtasks ก็ต้องใช้สิทธิ์)
    'net session >nul 2>&1',
    'if not errorlevel 1 goto :isadmin',
    // ข้ามการยกระดับได้เฉพาะตอนทดสอบเท่านั้น
    //   ปลอดภัยเพราะ .ps1 ยังตรวจสิทธิ์อยู่เสมอ — ข้ามแค่ "การขอ" ไม่ได้ข้าม "การบังคับ"
    'if defined SOV_NO_ELEVATE goto :isadmin',
    'echo.',
    'echo   Opening with administrator permission ...',
    'if "%*"=="" goto :elevate_noargs',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath \'%~f0\' -ArgumentList \'%*\' -Verb RunAs"',
    'exit /b 0',
    ':elevate_noargs',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath \'%~f0\' -Verb RunAs"',
    'exit /b 0',
    ':isadmin',
    '',
    // ส่งโฟลเดอร์ของตัวเองไปให้ payload ใช้
    //   $PSScriptRoot ใช้ไม่ได้ เพราะ payload รันผ่าน iex ซึ่งไม่มี script file
    //   (เจอตอนรันครั้งแรก — "Cannot bind argument to parameter 'Path'")
    'set "SOV_DIR=%~dp0"',
    '',
    // ⚠ เก็บพาธตัวเองไว้ก่อนวนลูปแยกอาร์กิวเมนต์
    //   shift ใน cmd.exe ดัน %0 ด้วย (ไม่ได้ดันแค่ %1) → ถ้าใช้ %~f0 หลังวน
    //   จะได้พาธของอาร์กิวเมนต์แทน แล้ว PowerShell ไปอ่านไฟล์ผิดจนล้ม
    'set "SOV_SELF=%~f0"',
    '',
    // แยกสวิตช์ออกจากค่าตำแหน่งก่อน ไม่งั้น "-DryRun" จะถูกใช้เป็น URL ของ HUB
    //   (เจอตอนรันครั้งแรก — "Bad HUB address: -DryRun")
    'set "SOV_HUB="',
    'set "SOV_CODE="',
    'set "SOV_NAME="',
    'set "SOV_DRYRUN="',
    'set "SOV_I=0"',
    ':parseargs',
    'if "%~1"=="" goto :parsedone',
    'if /i "%~1"=="-DryRun" set "SOV_DRYRUN=1" & shift & goto :parseargs',
    'if "%SOV_I%"=="0" set "SOV_HUB=%~1" & set "SOV_I=1" & shift & goto :parseargs',
    'if "%SOV_I%"=="1" set "SOV_CODE=%~1" & set "SOV_I=2" & shift & goto :parseargs',
    'if "%SOV_I%"=="2" set "SOV_NAME=%~1" & set "SOV_I=3" & shift & goto :parseargs',
    'shift',
    'goto :parseargs',
    ':parsedone',
    '',
    'where powershell.exe >nul 2>&1',
    'if errorlevel 1 (',
    '  echo ERROR: PowerShell not found. This should never happen on Windows.',
    '  echo        Cannot continue - nothing was changed.',
    '  pause',
    '  exit /b 9',
    ')',
    '',
    // จุดเดียวที่ cmd.exe แตะ payload: อ่านตัวเองแล้วรันส่วนหลังหมุด
    //   ใช้ IndexOf + Substring แทน more/findstr เพราะสองตัวหลังแปลงบรรทัดได้
    //   (ถ้า payload ขึ้นบรรทัดใหม่ไป สคริปต์จะพังเงียบๆ บนเครื่องคนอื่น)
    // สร้างเป็น template literal เดียวทั้งบรรทัด — ต่างจากการเชื่อมสตริง
    //   ด้วย + ซึ่งเคยทำให้สตริงหลุดกลางคันจนไฟล์ทั้งไฟล์ parse ไม่ผ่าน
    // LastIndexOf ไม่ใช่ IndexOf: หมุดนี้ปรากฏ 2 จุดในไฟล์ — ในบรรทัดคำสั่งนี้เอง
    //   และในบรรทัดคั่น payload ถ้าใช้ IndexOf จะไปตัดที่จุดแรก = ได้ payload ขยะ
    //   (เจอจริงตอนรันครั้งแรก — ข้อความแปลก ๆ เต็มจอ)
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=$env:SOV_SELF;$t=[IO.File]::ReadAllText($f);$i=$t.LastIndexOf('${MARKER}');if($i -lt 0){exit 8};iex $t.Substring($i+${MARKER_LEN})"`,
    'set "RC=%ERRORLEVEL%"',
    '',
    // ⚠ ห้ามใส่วงเล็บในข้อความ echo ที่อยู่ภายในบล็อก if
    //   cmd.exe นับ ) เป็นตัวปิดบล็อกก่อน echo ได้ยิน → "was unexpected at this time"
    //   และทั้งบล็อกพัง (เจอตอนรันครั้งแรก)
    'if not "%RC%"=="0" goto :doneerr',
    'echo.',
    'echo   Done. Open http://localhost:3000 on this machine.',
    'echo.',
    'pause',
    'exit /b 0',
    '',
    ':doneerr',
    'echo.',
    'echo   Finished with errors. Exit code %RC%. Nothing was left half-installed.',
    'echo   Log: logs\\install-node.log',
    'echo.',
    'pause',
    'exit /b %RC%',
    '',
  ];
}

/** ประกอบไฟล์เดียวจบ */
export function buildInstallerCmd({ file = 'INSTALL-SOVEREIGN-NODE.cmd' } = {}) {
  const body = [...buildCmdHead(), MARKER, ...buildPayload()].join(CRLF) + CRLF;
  return { file, body };
}

/**
 * บันทึกเป็น .cmd — ASCII ล้วน · CRLF · ไม่มี UTF-8 BOM
 * ทั้งสามข้อบังคับ เพราะแต่ละข้อทำให้ไฟล์พังบนเครื่องที่ไม่ใช่เครื่องนี้
 */
export function writeCmd(fileAbs, body) {
  const badLine = body.split(CRLF).find((l) => /[^\x00-\x7F]/.test(l));
  if (badLine !== undefined) {
    throw new Error(
      `ไฟล์ .cmd ต้องเป็น ASCII ล้วน — พบ: ${badLine.slice(0, 70)}\n` +
        '(cmd.exe จะตีความข้อความไทยเป็นคำสั่ง → ทั้งไฟล์พัง)',
    );
  }
  if (!body.includes(MARKER)) {
    throw new Error(`ไฟล์ .cmd ต้องมีหมุด ${MARKER} — ไม่งั้น PowerShell หาส่วน payload ไม่เจอ`);
  }
  fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
  // เขียนด้วย Buffer เพื่อกันไม่ให้ BOM เลอดเข้ามาโดยไม่รู้ตัว
  fs.writeFileSync(fileAbs, Buffer.from(body, 'ascii'));
  return fileAbs;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const val = (k, d = '') => (argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3) || d;
  const one = val('out', '');
  const targets = one
    ? [path.resolve(ROOT, one)]
    : [
        path.join(ROOT, 'INSTALL-SOVEREIGN-NODE.cmd'),
        'E:\\My work\\Project Sovereign Origin Install\\INSTALL-SOVEREIGN-NODE.cmd',
      ];
  const { file, body } = buildInstallerCmd();
  for (const t of targets) {
    writeCmd(t, body);
    console.log(`เขียน ${t}  (${body.length.toLocaleString('en-US')} ไบต์ · ASCII · CRLF · ไม่มี BOM)`);
  }
  void file;
}