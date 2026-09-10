// ─────────────────────────────────────────────────────────────
//  Sovereign OS — Desktop Shell
//  โหลดแบบมีลำดับสำรอง: Dashboard :3000 → Launcher :4100 → หน้า Offline ในตัว
//  ตรวจสถานะทุก 3 วิ แล้วเด้งไป Dashboard อัตโนมัติเมื่อระบบขึ้น
// ─────────────────────────────────────────────────────────────
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const DASHBOARD_URL = 'http://localhost:3000';
const LAUNCHER_URL = 'http://localhost:4100';
const API_URL = 'http://localhost:3001';
const PROBE_MS = 3000;

let win;
let backend;
let probeTimer = null;
let showingOffline = false;
let autoStarted = false;

const DOCKER_DESKTOP_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'Docker Desktop.exe'),
  'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
];

// ── debug log → %APPDATA%/Sovereign OS/desktop-shell.log ──
let LOG = '';
try { LOG = path.join(app.getPath('userData'), 'desktop-shell.log'); } catch { /* ignore */ }
function dlog(...a) {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch { /* ignore */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800,
    show: false,
    backgroundColor: '#020617',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'Sovereign OS'
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // ถ้า Dashboard/Launcher ตายกลางคัน → กลับไปหน้า offline แล้วรอระบบขึ้นใหม่
    if (!showingOffline) {
      console.error('load failed', code, desc, url);
      showOffline();
    }
  });
  win.on('closed', () => { win = null; });
}

// ── probe: เช็คว่า URL ตอบไหม (timeout 800ms) ──
function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 800 }, (res) => {
      res.resume();
      resolve(!!res.statusCode && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function probeStatus() {
  const [frontend, launcher, api] = await Promise.all([
    probe(DASHBOARD_URL), probe(LAUNCHER_URL), probe(API_URL + '/api/health'),
  ]);
  return { frontend, launcher, api };
}

// ── หน้า offline ในตัว + วงจร probe ──
async function showOffline() {
  if (!win || win.isDestroyed()) return;
  showingOffline = true;
  stopProbe();
  try {
    await win.loadFile(path.join(__dirname, 'offline.html'));
  } catch (e) {
    console.error('loadFile offline failed', e.message);
    return;
  }
  const push = async () => {
    if (!win || win.isDestroyed() || !showingOffline) return;
    try { win.webContents.send('sovereign:status', await probeStatus()); } catch { /* ignore */ }
  };
  push();
  probeTimer = setInterval(async () => {
    if (!win || win.isDestroyed()) return;
    const st = await probeStatus();
    if (st.frontend) {
      // Dashboard ขึ้นแล้ว → เข้าแอปจริงทันที
      showingOffline = false;
      stopProbe();
      win.loadURL(DASHBOARD_URL).catch(() => showOffline());
      return;
    }
    try { win.webContents.send('sovereign:status', st); } catch { /* ignore */ }
  }, PROBE_MS);
}

function stopProbe() {
  if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
}

// ── บูต: ลอง Dashboard → Launcher → Offline ──
async function boot() {
  const st = await probeStatus();
  dlog('boot:', JSON.stringify(st), 'packaged:', app.isPackaged, 'exeDir:', app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname);
  if (st.frontend) { showingOffline = false; win.loadURL(DASHBOARD_URL).catch(() => showOffline()); return; }
  if (st.launcher) {
    showingOffline = false;
    win.loadURL(LAUNCHER_URL).catch(() => showOffline());
    // รอ Dashboard แถม: ถ้าขึ้นภายใน 5 นาที → เด้งไปเอง
    // แต่ถ้า 30 วิแล้ว Dashboard ยังไม่ขึ้น → เริ่มระบบให้เอง (one-click ครอบคลุมทุก tier)
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      if (!win || win.isDestroyed() || showingOffline) { clearInterval(t); return; }
      if (await probe(DASHBOARD_URL)) { clearInterval(t); win.loadURL(DASHBOARD_URL).catch(() => {}); return; }
      if (tries === 10) autoStartOnce();
      else if (tries > 200) clearInterval(t); // รอได้ถึง 10 นาที — เผื่อ cold start (เปิด Docker + compose + build)
    }, PROBE_MS);
    return;
  }
  await showOffline();
  // one-click: เปิดโปรแกรมมาตอนระบบดับ → เริ่มระบบให้เอง ไม่ต้องกดปุ่ม
  autoStartOnce();
}

// ── ปุ่มจากหน้า offline ──
function findStartBat() {
  // หา start-sovereign.bat: โฟลเดอร์ exe → ขึ้นไปหา 2 ชั้น (เผื่อแพ็กอยู่ใน dist-portable ของโปรเจกต์)
  const candidates = [];
  if (!app.isPackaged) {
    candidates.push(path.join(__dirname, '..', '..'));
  } else {
    const exeDir = path.dirname(app.getPath('exe'));
    candidates.push(exeDir, path.join(exeDir, '..'), path.join(exeDir, '..', '..'));
  }
  for (const dir of candidates) {
    const bat = path.join(dir, 'start-sovereign.bat');
    if (fs.existsSync(bat)) return { bat, cwd: dir };
  }
  // จุดติดตั้งหลัก — เผื่อรันจาก stable home (junction E:\Sovereign OS) ที่ bat ไม่ได้อยู่ใต้โฟลเดอร์ exe
  const MAIN_ROOT = 'E:\\My work\\Project Sovereign Origin';
  const mainBat = path.join(MAIN_ROOT, 'start-sovereign.bat');
  if (fs.existsSync(mainBat)) return { bat: mainBat, cwd: MAIN_ROOT };
  return null;
}

// ── one-click: เริ่มระบบให้เองอัตโนมัติเมื่อทุกอย่างดับ ──
function dockerEngineUp() {
  return new Promise((resolve) => {
    try {
      const c = spawn('docker', ['info', '--format', 'ok'], { windowsHide: true, stdio: 'ignore' });
      c.on('exit', (code) => resolve(code === 0));
      c.on('error', () => resolve(false));
    } catch { resolve(false); }
  });
}

// ถ้า engine ยังไม่ขึ้น → เปิด Docker Desktop เอง แล้วรอได้สูงสุด ~3 นาที
// หมายเหตุ: docker info สำเร็จ = pipe ขึ้นแล้ว แต่ engine อาจยัง init อยู่ → เช็คซ้ำหลังพักก่อนคืนค่า
async function ensureDockerEngine() {
  const settled = async () => {
    if (!(await dockerEngineUp())) return false;
    await new Promise((r) => setTimeout(r, 6000));
    const ok = await dockerEngineUp();
    if (ok) dlog('autostart: engine settled');
    return ok;
  };
  if (await settled()) return true;
  const exe = DOCKER_DESKTOP_CANDIDATES.find((p) => { try { return !!p && fs.existsSync(p); } catch { return false; } });
  if (!exe) { dlog('autostart: docker engine down, Docker Desktop not found'); return false; }
  dlog('autostart: engine down — launching Docker Desktop:', exe);
  try { spawn(exe, [], { detached: true, windowsHide: true, stdio: 'ignore' }).unref(); } catch (e) { dlog('docker desktop spawn error', e.message); return false; }
  for (let tries = 0; tries < 60; tries++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await settled()) { dlog('autostart: docker engine up after', (tries + 1) * 3, 's'); return true; }
  }
  return false;
}

async function startSystem() {
  const found = findStartBat();
  if (!found) {
    return { ok: false, message: 'ไม่พบ start-sovereign.bat — เปิด Launcher ที่ http://localhost:4100 แล้วกด "เริ่มระบบ"' };
  }
  const engineUp = await ensureDockerEngine();
  if (!engineUp) {
    dlog('startSystem: docker engine not ready after wait');
    return { ok: false, message: 'Docker ยังไม่พร้อม — เปิด Docker Desktop รอจนขึ้น Running แล้วกดเริ่มระบบอีกครั้ง' };
  }
  try {
    // cmd /d /c call — ปลอดภัยกับ path ที่มีเว้นวรรค ("E:\My work\...")
    // (cmd start แบบฝัง quote และ PS Start-Process บน .bat เคยเงียบทั้งคู่ — call ผ่าน args array เชื่อถือได้)
    // windowsHide → ไม่มีเทอร์มินัลแปล๊บเด้งมารบกวน (หน้าต่าง Frontend ยังโผล่จาก start ภายใน bat ตามดีไซน์เดิม)
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', found.bat], {
      cwd: found.cwd, detached: true, windowsHide: true, stdio: 'ignore',
    });
    child.unref();
    dlog('startSystem: launched', found.bat, 'engineSettled=true');
    return { ok: true, message: 'กำลังเริ่มระบบ — รอ 1–2 นาที หน้านี้จะพาเข้า Dashboard เองเมื่อพร้อม' };
  } catch (e) {
    dlog('startSystem error:', e.message);
    return { ok: false, message: 'เริ่มระบบไม่สำเร็จ: ' + e.message };
  }
}

// เริ่มระบบอัตโนมัติครั้งเดียวต่อ session เมื่อ Dashboard ยังไม่ขึ้น (ทุก tier)
function autoStartOnce() {
  if (autoStarted) return;
  autoStarted = true;
  setTimeout(async () => {
    if (!win || win.isDestroyed()) return;
    const st = await probeStatus();
    if (st.frontend) return; // Dashboard ขึ้นเองระหว่างรอ — ไม่ต้องทำอะไร
    try { win.webContents.send('sovereign:autostart', { ok: true, message: 'กำลังเริ่มระบบให้อัตโนมัติ — ไม่ต้องกดอะไร' }); } catch { /* ignore */ }
    const r = await startSystem();
    dlog('autostart result:', JSON.stringify(r));
    try { win.webContents.send('sovereign:autostart', r); } catch { /* ignore */ }
  }, 1500);
}

// ── sidecar backend (เฉพาะตอนมี dist จริง — เช่นรันจากซอร์ส) ──
function startBackend() {
  try {
    const coreApiPath = app.isPackaged
      ? path.join(process.resourcesPath, 'core-api/dist/server.js')
      : path.join(__dirname, '../../sovereign-os/core-api/dist/server.js');
    if (!fs.existsSync(coreApiPath)) return; // ไม่มี backend ในตัว → ใช้ระบบหลัก (Docker/autostart) แทน
    const cwd = path.dirname(path.dirname(coreApiPath));
    backend = spawn('node', [coreApiPath], {
      env: {
        ...process.env,
        PORT: '3001',
        // ถ้าเครื่องแม่มี DATABASE_URL อยู่แล้ว อย่าทับ
        ...(process.env.DATABASE_URL ? {} : { DATABASE_URL: 'file:' + path.join(app.getPath('userData'), 'data.db') }),
      },
      stdio: 'ignore', cwd, detached: false,
    });
    backend.on('error', (e) => console.error('backend spawn error', e.message));
  } catch (e) { console.error('startBackend failed', e.message); }
}

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  startBackend();
  createWindow();
  boot();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); boot(); } });
});

// ── IPC: ไฟล์/โฟลเดอร์ (เดิม) ──
ipcMain.handle('sovereign:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'All', extensions: ['*'] }] });
  if (r.canceled) return null;
  const fp = r.filePaths[0];
  try { const data = fs.readFileSync(fp); return { path: fp, size: data.length, name: path.basename(fp) }; } catch (e) { return { path: fp, error: e.message }; }
});
ipcMain.handle('sovereign:readDir', async (_e, dir) => {
  try { const list = fs.readdirSync(dir || 'C:\\', { withFileTypes: true }); return list.map(d => ({ name: d.name, isDir: d.isDirectory() })).slice(0, 200); } catch (e) { return { error: e.message }; }
});

// ── IPC: สถานะ + ปุ่มควบคุมระบบ ──
ipcMain.handle('sovereign:getStatus', async () => probeStatus());
ipcMain.handle('sovereign:startSystem', () => startSystem());
ipcMain.handle('sovereign:isAutoStarted', () => autoStarted);
ipcMain.handle('sovereign:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(url)) {
    shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false, message: 'URL ไม่อนุญาต' };
});
ipcMain.handle('sovereign:retryDashboard', async () => {
  const st = await probeStatus();
  if (st.frontend) { showingOffline = false; stopProbe(); win.loadURL(DASHBOARD_URL).catch(() => showOffline()); return { ok: true }; }
  return { ok: false, message: 'Dashboard ยังไม่พร้อม' };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  stopProbe();
  if (backend && !backend.killed) { try { backend.kill(); } catch { /* ignore */ } }
});

dlog('desktop-shell loaded — version 1.2.0 overlay (auto-start)');
