// ─────────────────────────────────────────────────────────────
//  Sovereign OS — Launcher Server (zero dependencies)
//  ทำหน้าที่: เสิร์ฟหน้า launcher.html + สั่งเปิด .bat ผ่านปุ่ม
//  รัน: node launcher-server.mjs  →  http://localhost:4100
// ─────────────────────────────────────────────────────────────
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { exec, execSync } from 'node:child_process';
import net from 'node:net';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LAUNCHER_PORT || 4100);
const html = readFileSync(join(ROOT, 'launcher.html'), 'utf8');

// ปุ่ม → ไฟล์ .bat ที่ root ของโปรเจกต์
const ACTIONS = {
  start: { label: 'เริ่มระบบ', bat: 'start-sovereign.bat' },
  setup: { label: 'ติดตั้งครั้งแรก', bat: 'setup-first-time.bat' },
};

const history = [];
let dockerCache = { ok: null, at: 0 };

// ── ออโตสตาร์ทตอนเข้า Windows: vbs ใน Startup folder รัน autostart.mjs แบบซ่อน ──
function startupDir() {
  return join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}
const AUTOSTART_VBS = 'sovereign-autostart.vbs';

function autostartEnabled() {
  try {
    return existsSync(join(startupDir(), AUTOSTART_VBS));
  } catch {
    return false;
  }
}

function setAutostart(enable) {
  const dir = startupDir();
  const vbsPath = join(dir, AUTOSTART_VBS);
  if (!enable) {
    try { rmSync(vbsPath, { force: true }); } catch (e) { return { ok: false, message: 'ลบ shortcut ไม่สำเร็จ: ' + e.message }; }
    return { ok: true, enabled: false, message: 'ปิดออโตสตาร์ทแล้ว — ครั้งหน้าเข้า Windows ต้องเปิดเอง (launcher.bat)' };
  }
  try {
    mkdirSync(dir, { recursive: true });
    // wscript รัน autostart.mjs แบบไม่มีหน้าต่าง (window style 0)
    const vbs = [
      "' Sovereign OS - autostart (hidden) - สร้างจาก Launcher",
      'Set sh = CreateObject("WScript.Shell")',
      'sh.CurrentDirectory = "' + ROOT + '"',
      'sh.Run "cmd /c node autostart.mjs >> autostart.log 2>&1", 0, False',
    ].join('\r\n');
    writeFileSync(vbsPath, vbs, 'utf8');
    return { ok: true, enabled: true, message: 'เปิดออโตสตาร์ทแล้ว — ครั้งหน้าเข้า Windows ระบบจะขึ้นเองอัตโนมัติ' };
  } catch (e) {
    return { ok: false, message: 'สร้าง shortcut ไม่สำเร็จ: ' + (e?.message || e) };
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(700, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function dockerRunning() {
  const now = Date.now();
  if (dockerCache.at && now - dockerCache.at < 8000) return dockerCache.ok;
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5000, windowsHide: true });
    dockerCache = { ok: true, at: now };
    return true;
  } catch {
    dockerCache = { ok: false, at: now };
    return false;
  }
}

function pidsOnPort(port) {
  const pids = new Set();
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/).filter(Boolean);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && new RegExp(`:${port}\\b`).test(line)) pids.add(pid);
    }
  } catch { /* ignore */ }
  return [...pids];
}

async function getStatus() {
  const [backend, frontend, emqx, db] = await Promise.all([
    isPortOpen(3001), isPortOpen(3000), isPortOpen(18083), isPortOpen(5432),
  ]);
  return {
    docker: dockerRunning(),
    ports: { backend, frontend, emqx, db },
    config: {
      infraEnv: existsSync(join(ROOT, 'sovereign-os', 'infra', '.env')),
      coreEnv: existsSync(join(ROOT, 'sovereign-os', 'core-api', '.env')),
      frontendEnv: existsSync(join(ROOT, 'sovereign-frontend', '.env.local')),
    },
    autostart: autostartEnabled(),
    history,
  };
}

function pushHistory(action, result) {
  history.unshift({ time: new Date().toLocaleTimeString('th-TH'), action, result });
  if (history.length > 20) history.pop();
}

function runAction(name) {
  const a = ACTIONS[name];
  if (!a) return { ok: false, message: `ไม่รู้จัก action: ${name}` };
  const batPath = join(ROOT, a.bat);
  if (!existsSync(batPath)) return { ok: false, message: `ไม่พบไฟล์ ${a.bat} ที่ root` };
  // เปิดหน้าต่าง console ใหม่รัน .bat — ใช้ exec + start (spawn+argv เปิด window ไม่ได้ในสภาพแวดล้อมนี้)
  // exec ส่งคำสั่งไปให้ cmd /s /c ตรง ๆ ทำให้ quoting ของ start ถูกต้อง
  exec(`start "Sovereign-${a.label}" cmd /d /k "${batPath}"`, { cwd: ROOT }, (err) => {
    if (err) pushHistory(a.label, `❌ ${err.message}`);
  });
  pushHistory(a.label, 'เปิดหน้าต่าง console แล้ว — ดูความคืบหน้าที่หน้าต่างนั้น');
  return { ok: true, message: `กำลังเปิดหน้าต่าง: ${a.label}` };
}

function stopAll() {
  const report = [];
  try {
    execSync('docker compose down --remove-orphans', {
      cwd: join(ROOT, 'sovereign-os', 'infra'), stdio: 'ignore', timeout: 60000, windowsHide: true,
    });
    report.push('docker compose down ✅');
  } catch {
    report.push('docker compose down — ข้าม (ไม่มี container / Docker ยังไม่เปิด)');
  }
  for (const port of [3000, 3001]) {
    for (const pid of pidsOnPort(port)) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
        report.push(`ปิด process พอร์ต ${port} (PID ${pid}) ✅`);
      } catch {
        report.push(`ปิด PID ${pid} ไม่สำเร็จ`);
      }
    }
  }
  if (report.length === 0) report.push('ไม่พบอะไรให้ปิด');
  pushHistory('หยุดทั้งหมด', report.join(' · '));
  return { ok: true, message: report };
}

// ─────────────────────────────────────────────────────────────
//  📦 จัดแพ็กเกจ (ติดตั้งเครื่องอื่น) — เลือกฟังก์ชั่น → เลือกโฟลเดอร์ → คัดลอก
// ─────────────────────────────────────────────────────────────

// ฟังก์ชั่นที่เลือกได้ แต่ละตัว = ชุดไฟล์/โฟลเดอร์ที่จะคัดลอกไปปลายทาง
const FEATURES = [
  {
    id: 'core',
    label: '🧱 ระบบหลัก (Frontend + Core API + Docker/DB/EMQX + Launcher)',
    required: true,
    dirs: ['sovereign-frontend', 'sovereign-os/core-api', 'sovereign-os/infra'],
    files: ['launcher.bat', 'launcher-server.mjs', 'launcher.html', 'start-sovereign.bat', 'setup-first-time.bat'],
    skip: ['data', 'backups'],
  },
  { id: 'ollama', label: '🤖 Ollama AI (โมเดล AI ~20GB + ตัวติดตั้ง)', required: false, dirs: ['Ollama'], skip: [] },
  { id: 'edge-ai', label: '🧠 Edge AI (Python RAG + วิเคราะห์)', required: false, dirs: ['sovereign-os/edge-ai'], skip: [] },
  { id: 'rain', label: '🌧️ Rain Detection (Arduino เซ็นเซอร์ฝน)', required: false, dirs: ['rain-detection'], skip: [] },
  { id: 'whisper', label: '🗣️ Whisper STT (เสียง → ข้อความ)', required: false, dirs: ['tools/whisper.cpp'], skip: ['build'] },
  { id: 'esp8266', label: '📡 Firmware ESP8266 (เซ็นเซอร์มัลติ)', required: false, dirs: ['tools/esp8266_multi_sensor'], skip: [] },
  {
    id: 'voice',
    label: '🎙️ Voice Assistant (Piper TTS + สคริปต์เสียง)',
    required: false,
    dirs: [],
    files: ['tools/voice_assistant.py', 'tools/tts_speak.py', 'tools/piper.zip'],
    skip: [],
  },
];

// ชื่อที่ห้ามคัดลอกเด็ดขาด (runtime data / secrets / build cache)
const SKIP_NAMES = new Set([
  'node_modules', '.next', '.git', 'dist', '.cache', '.turbo', 'build', '__pycache__',
  '.env', '.env.local', '.env.production', '.env.development',
  'data', 'backups', '.freebuff',
]);

function dirStats(dirPath, skip = new Set()) {
  let bytes = 0;
  let files = 0;
  const walk = (p) => {
    let entries;
    try {
      entries = readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(p, e.name);
      if (SKIP_NAMES.has(e.name) || skip.has(e.name)) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          const s = statSync(full);
          bytes += s.size;
          files += 1;
        } catch { /* ignore */ }
      }
    }
  };
  walk(dirPath);
  return { bytes, files };
}

function formatBytes(n) {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

function getFeatures() {
  return FEATURES.map((f) => {
    let bytes = 0;
    let files = 0;
    const skip = new Set(f.skip || []);
    for (const d of f.dirs) {
      const p = join(ROOT, d);
      if (existsSync(p)) {
        const r = dirStats(p, skip);
        bytes += r.bytes;
        files += r.files;
      }
    }
    for (const file of f.files || []) {
      const p = join(ROOT, file);
      if (existsSync(p)) {
        try {
          bytes += statSync(p).size;
          files += 1;
        } catch { /* ignore */ }
      }
    }
    return {
      id: f.id,
      label: f.label,
      required: !!f.required,
      dirs: f.dirs,
      files: f.files || [],
      sizeBytes: bytes,
      sizeLabel: formatBytes(bytes),
      exists: files > 0,
    };
  });
}

// ── ตรวจว่าไฟล์ Ollama อยู่ในโฟลเดอร์เดียวครบไหม (สำหรับพกไปเครื่องอื่น) ──
function ollamaCheck() {
  const modelsDir = process.env.OLLAMA_MODELS || '';
  const projectOllama = join(ROOT, 'Ollama');
  const out = {
    envModels: modelsDir,
    modelsInProject: existsSync(join(projectOllama, 'blobs')) && existsSync(join(projectOllama, 'manifests')),
    setupExe: existsSync(join(projectOllama, 'OllamaSetup.exe')),
    projectSize: formatBytes(dirStats(projectOllama).bytes),
    binaryPath: '',
    binaryInstalled: false,
    notes: [],
  };
  try {
    const localApp = process.env.LOCALAPPDATA || '';
    out.binaryPath = join(localApp, 'Programs', 'Ollama', 'ollama.exe');
    out.binaryInstalled = existsSync(out.binaryPath);
  } catch { /* ignore */ }

  if (out.modelsInProject && out.setupExe) {
    out.notes.push('✅ โมเดล (blobs/manifests) + OllamaSetup.exe อยู่ในโฟลเดอร์ Ollama เดียว — ครบสำหรับพกไปเครื่องอื่น');
  } else {
    out.notes.push('⚠️ โฟลเดอร์ Ollama ไม่ครบ (ขาด blobs/manifests หรือ OllamaSetup.exe) — ดึงโมเดลอีกครั้งก่อนแพ็ก');
  }
  if (modelsDir && resolve(modelsDir).toLowerCase() === resolve(projectOllama).toLowerCase()) {
    out.notes.push('ℹ️ OLLAMA_MODELS ชี้มาที่โฟลเดอร์โปรเจกต์นี้ — โมเดลจะไปกับแพ็กเกจ');
  } else {
    out.notes.push(`ℹ️ OLLAMA_MODELS = ${modelsDir || '(ไม่ได้ตั้ง)'} — ถ้าคนละที่กับโฟลเดอร์ Ollama โมเดลจะไม่ครบ`);
  }
  out.notes.push(
    out.binaryInstalled
      ? `ℹ️ ตัวรัน (ollama.exe) ติดตั้งที่เครื่องนี้: ${out.binaryPath} — เครื่องอื่นต้องรัน OllamaSetup.exe (อยู่ในแพ็กเกจ)`
      : 'ℹ️ ยังไม่พบ ollama.exe ที่ติดตั้ง — เครื่องปลายทางต้องรัน OllamaSetup.exe จากโฟลเดอร์ Ollama'
  );
  return out;
}

// ── เลือกโฟลเดอร์ปลายทาง (PowerShell FolderBrowserDialog, ไม่พึ่ง dependency) ──
function pickFolder() {
  const ps1 = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'เลือกโฟลเดอร์ปลายทางสำหรับแพ็กเกจ Sovereign OS'
$d.ShowNewFolderButton = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
`;
  const tmp = join(tmpdir(), `sovereign-picker-${Date.now()}.ps1`);
  try {
    writeFileSync(tmp, ps1, 'utf8');
    const out = execSync(`powershell -NoProfile -STA -ExecutionPolicy Bypass -File "${tmp}"`, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
    });
    const dest = (out || '').trim().split(/\r?\n/).pop() || '';
    if (!dest) return { ok: false, cancelled: true, message: 'ยกเลิกการเลือกโฟลเดอร์' };
    return { ok: true, dest };
  } catch (e) {
    return { ok: false, cancelled: false, message: 'เลือกโฟลเดอร์ไม่สำเร็จ: ' + (e?.message || e) };
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}

// ── คัดลอกชุดไฟล์ของฟังก์ชั่นหนึ่งไปปลายทาง ──
function copyFeature(f, destRoot) {
  let copied = 0;
  const skip = new Set([...(f.skip || []), ...SKIP_NAMES]);
  const copyOne = (rel) => {
    const src = join(ROOT, rel);
    if (!existsSync(src)) return;
    const target = join(destRoot, rel);
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(target, { recursive: true });
      cpSync(src, target, {
        recursive: true,
        force: true,
        filter: (s) => !skip.has(basename(s)),
      });
      copied += 1;
    } else {
      mkdirSync(dirname(target), { recursive: true });
      cpSync(src, target, { force: true });
      copied += 1;
    }
  };
  for (const d of f.dirs) copyOne(d);
  for (const file of f.files || []) copyOne(file);
  return copied;
}

function buildInstallBat() {
  return `@echo off
chcp 65001 >nul
title Sovereign OS - Install Package
cd /d "%~dp0"

echo ========================================
echo   Sovereign OS - Install Package
echo ========================================
echo.

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js - ติดตั้ง Node.js 18+ ก่อน แล้วรันใหม่
    pause
    exit /b 1
)

echo == [1/3] ติดตั้ง Frontend dependencies ==
if exist "sovereign-frontend\package.json" (
    cd /d "%~dp0sovereign-frontend"
    call npm install
    cd /d "%~dp0"
)

echo == [2/3] ติดตั้ง Core API dependencies ==
if exist "sovereign-os\core-api\package.json" (
    cd /d "%~dp0sovereign-os\core-api"
    call npm install
    cd /d "%~dp0"
)

echo == [3/3] ตรวจ Docker ==
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo   [WARN] ยังไม่เห็น Docker Desktop - เปิด Docker Desktop แล้วรัน setup-first-time.bat
) else (
    echo   [OK] Docker พร้อม - รัน setup-first-time.bat ได้เลย
)

echo.
echo ========================================
echo   ติดตั้ง dependencies เสร็จแล้ว!
echo   ขั้นตอนถัดไป (ครั้งแรก):
echo     1. เปิด Docker Desktop
echo     2. ดับเบิลคลิก setup-first-time.bat  (สร้าง .env + ฐานข้อมูล + seed)
echo     3. ดับเบิลคลิก launcher.bat แล้วกด "เริ่มระบบ"
echo ========================================
pause
`;
}

function runInstall(payload) {
  const ids = Array.isArray(payload?.features) ? payload.features : [];
  const destRaw = String(payload?.dest || '').trim();
  if (!destRaw) return { ok: false, message: 'ยังไม่ได้เลือกโฟลเดอร์ปลายทาง' };
  // Windows: ต้องมี drive letter หรือ UNC (เช่น D:\... หรือ \\server\share) —
  // กัน path แบบ Git Bash (/e/...) ที่ resolve ผิดแล้วไป mkdir ที่ root ไดรฟ์
  if (!/^[a-zA-Z]:[\\/]|^\\\\/.test(destRaw)) {
    return { ok: false, message: 'ต้องเป็น path แบบเต็ม เช่น D:\\sovereign-package' };
  }

  const dest = resolve(destRaw);
  const rootAbs = resolve(ROOT);
  // กัน overwrite ตัวโปรเจกต์เอง
  if (dest === rootAbs || dest.startsWith(rootAbs + '\\') || rootAbs.startsWith(dest + '\\')) {
    return { ok: false, message: 'ห้ามใช้โฟลเดอร์เดียวกับโปรเจกต์ (หรืออยู่ข้างใน/ข้างนอกทับกัน)' };
  }

  // ระบบหลักบังคับเลือกเสมอ
  const selected = FEATURES.filter((f) => f.required || ids.includes(f.id));

  mkdirSync(dest, { recursive: true });
  const copied = [];
  let filesCopied = 0;
  for (const f of selected) {
    const n = copyFeature(f, dest);
    filesCopied += n;
    copied.push({ id: f.id, label: f.label, dirs: n });
  }

  // install.bat + manifest.json (บันทึกว่าประกอบด้วยอะไรบ้าง)
  writeFileSync(join(dest, 'install.bat'), buildInstallBat(), 'utf8');
  writeFileSync(
    join(dest, 'manifest.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        source: 'Project Sovereign Origin',
        features: copied,
        notes: 'ติดตั้ง: ดับเบิลคลิก install.bat (ต้องการ Node.js 18+ + Docker Desktop)' + (selected.some((f) => f.id === 'ollama') ? ' · Ollama: รัน OllamaSetup.exe' : ''),
      },
      null,
      2
    ),
    'utf8'
  );

  return { ok: true, dest, features: copied, filesCopied: filesCopied + 2, installBat: 'install.bat' };
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (req.method === 'GET' && path === '/api/status') { send(200, await getStatus()); return; }
  if (req.method === 'POST' && path === '/api/action/start') { send(200, runAction('start')); return; }
  if (req.method === 'POST' && path === '/api/action/setup') { send(200, runAction('setup')); return; }
  if (req.method === 'POST' && path === '/api/action/stop') { send(200, stopAll()); return; }

  // 📦 จัดแพ็กเกจ
  if (req.method === 'GET' && path === '/api/features') { send(200, { ok: true, features: getFeatures() }); return; }
  if (req.method === 'GET' && path === '/api/ollama-check') { send(200, { ok: true, ...ollamaCheck() }); return; }
  if (req.method === 'POST' && path === '/api/autostart') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let enable = false;
      try { enable = !!JSON.parse(body || '{}').enable; } catch { /* default false */ }
      const r = setAutostart(enable);
      send(r.ok ? 200 : 400, r);
    });
    return;
  }
  if (req.method === 'POST' && path === '/api/pick-folder') { send(200, pickFolder()); return; }
  if (req.method === 'POST' && path === '/api/install') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch { /* ignore */ }
      let result;
      try {
        result = runInstall(payload);
      } catch (e) {
        result = { ok: false, message: 'สร้างแพ็กเกจไม่สำเร็จ: ' + (e?.message || e) };
      }
      send(result.ok ? 200 : 400, result);
    });
    return;
  }

  send(404, { ok: false, message: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🏰 Sovereign OS Launcher → http://localhost:${PORT}`);
  console.log(`   ปุ่ม: start / setup / stop · status: /api/status`);
});
