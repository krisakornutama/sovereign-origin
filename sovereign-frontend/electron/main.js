// ─────────────────────────────────────────────────────────────
//  Sovereign OS — Desktop Shell
//  โหลดแบบมีลำดับสำรอง: Dashboard :3000 → Launcher :4100 → หน้า Offline ในตัว
//  ตรวจสถานะทุก 3 วิ แล้วเด้งไป Dashboard อัตโนมัติเมื่อระบบขึ้น
// ─────────────────────────────────────────────────────────────
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const { verifyAsset } = require('./verify-asset');

const DASHBOARD_URL = 'http://localhost:3000';
const LAUNCHER_URL = 'http://localhost:4100';
const API_URL = 'http://localhost:3001';
const PROBE_MS = 3000;

let win;
let backend;
let probeTimer = null;
let showingOffline = false;
let autoStarted = false;

// ── tray / wizard / updater สถานะ ──
let tray = null;
let setupWin = null;
let quitting = false; // ปิดหน้าต่าง = ย่อลง tray จนกว่าจะสั่งออกจากเมนู tray
let lastStatus = { frontend: false, launcher: false, api: false };
let updateInfo = null; // ผลตรวจอัปเดตล่าสุด (แสดงในเมนู tray + wizard)
const UPSTREAM_REPO = 'krisakornutama/sovereign-origin';

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
  // ปิดหน้าต่าง = ย่อลง tray (ระบบยังเฝ้า/เริ่มเองได้) — ออกจริงผ่านเมนู tray เท่านั้น
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); dlog('close → hidden to tray'); }
  });
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
  lastStatus = { frontend, launcher, api };
  updateTrayMenu();
  return lastStatus;
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
      dlog('flip: offline → dashboard (:3000 answering)');
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
      if (await probe(DASHBOARD_URL)) { dlog('flip: launcher → dashboard (:3000 answering)'); clearInterval(t); win.loadURL(DASHBOARD_URL).catch(() => {}); return; }
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

// ── System Tray: สถานะสด + เปิด Dashboard + ออกจริง ──
function statusGlyph(on) { return on ? '🟢' : '⚪'; }
function updateTrayMenu() {
  if (!tray) return;
  try {
    const st = lastStatus;
    const upd = updateInfo;
    const updLabel = (upd && upd.ok && upd.hasUpdate)
      ? `⬆️ มีเวอร์ชันใหม่ ${upd.latest} (ตอนนี้ v${upd.current}) — เปิดตั้งค่า`
      : 'ตรวจอัปเดต…';
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '🏰 Sovereign OS v' + app.getVersion(), enabled: false },
      { type: 'separator' },
      { label: 'เปิดหน้าจอหลัก (Dashboard)', click: showMainWindow },
      { type: 'separator' },
      { label: `${statusGlyph(st.frontend)} Dashboard :3000 — ${st.frontend ? 'ออนไลน์' : 'ออฟไลน์'}`, enabled: false },
      { label: `${statusGlyph(st.api)} Core API :3001 — ${st.api ? 'ออนไลน์' : 'ออฟไลน์'}`, enabled: false },
      { label: `${statusGlyph(st.launcher)} Launcher :4100 — ${st.launcher ? 'ออนไลน์' : 'ออฟไลน์'}`, enabled: false },
      { type: 'separator' },
      { label: '🚀 เริ่มระบบทั้งหมด', click: () => { startSystem(); } },
      { label: updLabel, click: () => { if (upd && upd.ok && upd.hasUpdate) openWizard('update'); else checkForUpdates(true); } },
      { label: '⚙️ ตั้งค่าครั้งแรก (Setup Wizard)', click: () => openWizard() },
      { type: 'separator' },
      { label: '❌ ออกจาก Sovereign OS', click: () => { quitting = true; app.quit(); } },
    ]));
  } catch (e) { dlog('updateTrayMenu error:', e.message); }
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'tray-icon.png'));
    tray.setToolTip('Sovereign OS v' + app.getVersion());
    updateTrayMenu();
    dlog('tray created');
  } catch (e) { dlog('tray create failed:', e.message); }
}

function showMainWindow() {
  try {
    if (!win || win.isDestroyed()) { createWindow(); boot(); return; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  } catch (e) { dlog('showMainWindow error:', e.message); }
}

// ── Setup Wizard: ตั้งค่าครั้งแรก (โฟลเดอร์/ตรวจสภาพแวดล้อม/เริ่มระบบ/อัปเดต) ──
function setupFlagPath() { return path.join(app.getPath('userData'), 'setup-done.json'); }
function setupDone() { try { return fs.existsSync(setupFlagPath()); } catch { return false; } }

function openWizard(focus) {
  if (setupWin && !setupWin.isDestroyed()) {
    if (focus) setupWin.webContents.send('sovereign:wizardFocus', focus);
    setupWin.show(); setupWin.focus(); return;
  }
  setupWin = new BrowserWindow({
    width: 720, height: 680, show: false,
    backgroundColor: '#020617', autoHideMenuBar: true, resizable: false,
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'Sovereign OS — ตั้งค่าครั้งแรก',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  setupWin.once('ready-to-show', () => setupWin.show());
  setupWin.on('closed', () => { setupWin = null; });
  setupWin.loadFile(path.join(__dirname, 'setup-wizard.html'), focus ? { hash: focus } : undefined);
}

function runCmd(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    try {
      const c = spawn(cmd, args, { windowsHide: true, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout && c.stdout.on('data', (d) => { out += d; });
      c.on('error', () => resolve(null));
      c.on('exit', () => resolve(out.trim() || null));
    } catch { resolve(null); }
  });
}

// ── Auto-Update: ตรวจ release จาก GitHub (ไม่พึ่ง dependency ภายนอก) ──
const https = require('https');
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SovereignOS-Desktop', Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function cmpVer(a, b) {
  const p = (s) => String(s).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = p(a), pb = p(b);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1; }
  return 0;
}
async function checkForUpdates(interactive) {
  const res = { ok: false, latest: null, current: app.getVersion(), assetUrl: null, hasUpdate: false, error: null, at: Date.now() };
  try {
    const rel = await fetchJson('https://api.github.com/repos/' + UPSTREAM_REPO + '/releases/latest');
    const asset = (rel.assets || []).find((a) => /portable\.exe$/i.test(a.name)) || null;
    res.ok = true; res.latest = rel.tag_name; res.assetUrl = asset ? asset.browser_download_url : null;
  } catch (e) { res.error = e.message; }
  res.hasUpdate = !!(res.ok && res.latest && cmpVer(res.latest, res.current) > 0);
  updateInfo = res;
  updateTrayMenu();
  for (const w of [win, setupWin]) { try { w && !w.isDestroyed() && w.webContents.send('sovereign:update', res); } catch { /* ignore */ } }
  if (interactive) {
    const msg = !res.ok ? ('ตรวจอัปเดตไม่สำเร็จ: ' + res.error)
      : res.hasUpdate ? ('มีเวอร์ชันใหม่ ' + res.latest + ' (ตอนนี้ v' + res.current + ')' + (res.assetUrl ? ' — ดาวน์โหลดได้จากหน้าตั้งค่า' : ' — ยังไม่มีไฟล์ติดตั้งใน release'))
      : ('ใช้เวอร์ชันล่าสุดแล้ว (v' + res.current + ')');
    try { dialog.showMessageBox(win || undefined, { type: 'info', title: 'Sovereign OS — อัปเดต', message: msg }); } catch { /* ignore */ }
  }
  return res;
}
function downloadFile(url, dest, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    if (redirectDepth > 4) return reject(new Error('redirect ลึกเกินไป'));
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'SovereignOS-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => fs.unlink(dest, () => {}));
        return resolve(downloadFile(res.headers.location, dest, redirectDepth + 1));
      }
      if (res.statusCode !== 200) { res.resume(); file.close(() => fs.unlink(dest, () => {})); return reject(new Error('HTTP ' + res.statusCode)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', (e) => { try { fs.unlink(dest, () => {}); } catch { /* ignore */ } reject(e); });
    }).on('error', (e) => { try { fs.unlink(dest, () => {}); } catch { /* ignore */ } reject(e); });
  });
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

// ── single instance — startup folder + HKCU\Run ยิง exe ซ้ำสองตัวแข่ง startSystem กันเอง ──
const hasSingleLock = app.requestSingleInstanceLock();
if (hasSingleLock) app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
else { dlog('single-instance: Sovereign OS รันอยู่แล้ว — ปิดตัวซ้ำ'); app.quit(); }

app.whenReady().then(() => {
  if (!hasSingleLock) return; // กันหน้าต่างซ้อนในช่วงรอ app.quit() ของ instance ที่แพ้ lock
  // จด login item เฉพาะตอน packaged — โหมด dev ห้ามลงทะเบียน auto-start ชี้ไปที่ electron ตัวทดสอบ
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  createTray();
  startBackend();
  createWindow();
  boot();
  if (!setupDone()) openWizard(); // ครั้งแรกของเครื่องนี้ — เปิด wizard รอเลย (ปิดข้ามได้)
  setTimeout(() => { checkForUpdates(false).catch(() => {}); }, 15000); // เช็คเงียบ ๆ รอบเดียวหลังบูต
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

// ── IPC: wizard + อัปเดต ──
ipcMain.handle('sovereign:openWizard', (_e, focus) => { openWizard(focus); return { ok: true }; });
ipcMain.handle('sovereign:pickInstallDir', async () => {
  const r = await dialog.showOpenDialog(setupWin || win, { properties: ['openDirectory', 'createDirectory'], title: 'เลือกโฟลเดอร์สำหรับ Sovereign OS' });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle('sovereign:checkEnv', async () => {
  const [nodeV, dockerV] = await Promise.all([runCmd('node', ['--version']), runCmd('docker', ['--version'])]);
  const found = findStartBat();
  return {
    node: nodeV ? { ok: true, detail: nodeV } : { ok: false, detail: 'ไม่พบ node — จำเป็นเฉพาะโหมดซอร์ส (แพ็กเกจในตัวไม่ต้องใช้)' },
    docker: dockerV ? { ok: true, detail: dockerV } : { ok: false, detail: 'ไม่พบ Docker — โปรแกรมจะเปิด Docker Desktop ให้เองตอนเริ่มระบบ (ถ้ามีติดตั้ง)' },
    bat: found ? { ok: true, detail: found.bat } : { ok: false, detail: 'ไม่พบ start-sovereign.bat ใกล้ตัวโปรแกรม — ยังเริ่มระบบหลักอัตโนมัติไม่ได้' },
  };
});
ipcMain.handle('sovereign:getSetupDir', () => {
  try { const j = JSON.parse(fs.readFileSync(setupFlagPath(), 'utf8')); return j.dir || null; } catch { return null; }
});
ipcMain.handle('sovereign:beginSetup', (_e, dir) => {
  try { fs.writeFileSync(setupFlagPath(), JSON.stringify({ dir: dir || null, ts: Date.now() }, null, 2)); } catch (e) { return { ok: false, message: e.message }; }
  if (dir && fs.existsSync(dir)) {
    try { fs.writeFileSync(path.join(dir, 'sovereign-home.txt'), 'Sovereign OS setup marker — ' + new Date().toISOString() + '\n'); } catch { /* best-effort */ }
  }
  dlog('setup done:', dir || '(no dir)');
  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  showMainWindow();
  return { ok: true };
});
ipcMain.handle('sovereign:checkUpdates', () => checkForUpdates(true));
ipcMain.handle('sovereign:downloadUpdate', async () => {
  const u = updateInfo;
  if (!u || !u.ok || !u.hasUpdate || !u.assetUrl) return { ok: false, message: 'ยังไม่มีตัวติดตั้งให้ดาวน์โหลด — กดตรวจอัปเดตก่อน' };
  const dest = path.join(app.getPath('downloads'), 'Sovereign-OS-' + String(u.latest).replace(/^v/, '') + '-portable.exe');
  try {
    await downloadFile(u.assetUrl, dest);
    // ด่านความปลอดภัย: ตรวจ SHA-256 ก่อนเปิดรัน — ไม่ผ่าน/ไม่มีลายเซ็นอ้างอิง/ตรวจไม่ได้ = ลบไฟล์ทิ้ง ห้ามเปิด (fail-closed)
    let v;
    try { v = await verifyAsset({ assetUrl: u.assetUrl, dest }); }
    catch (ve) {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      dlog('update verify error:', ve.message);
      return { ok: false, message: 'ยกเลิกการติดตั้ง — ตรวจลายเซ็นไม่สำเร็จ (' + ve.message + ') ลบไฟล์ที่ดาวน์โหลดแล้ว' };
    }
    if (!v.ok) {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      dlog('update rejected:', v.reason);
      const why = v.reason === 'mismatch' ? 'ลายเซ็นไม่ตรง (ไฟล์เสียหายหรือไม่น่าเชื่อถือ)'
        : v.reason === 'no-reference' ? 'release นี้ยังไม่มีลายเซ็นอ้างอิง (digest/SHA256SUMS)'
        : 'ลายเซ็นอ้างอิงไม่ถูกต้อง';
      return { ok: false, message: 'ยกเลิกการติดตั้ง — ' + why + ' ลบไฟล์ที่ดาวน์โหลดแล้ว' };
    }
    shell.openPath(dest);
    dlog('update downloaded + hash verified (' + v.source + '):', dest);
    return { ok: true, message: 'ดาวน์โหลดแล้ว และตรวจลายเซ็น SHA-256 ผ่าน (' + (v.source === 'github-digest' ? 'GitHub digest' : 'SHA256SUMS') + ') — เปิดตัวติดตั้งให้แล้ว (แนะนำปิดโปรแกรมเดิมก่อนติดตั้ง)' };
  } catch (e) { return { ok: false, message: 'ดาวน์โหลดไม่สำเร็จ: ' + e.message }; }
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  stopProbe();
  if (backend && !backend.killed) { try { backend.kill(); } catch { /* ignore */ } }
});

dlog('desktop-shell loaded — version', app.getVersion(), '(tray+wizard+autostart)');
