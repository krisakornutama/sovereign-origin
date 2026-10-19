// ─────────────────────────────────────────────────────────────
//  Sovereign OS — Desktop Shell
//  โหลดแบบมีลำดับสำรอง: Dashboard :3000 → Launcher :4100 → หน้า Offline ในตัว
//  ตรวจสถานะทุก 3 วิ แล้วเด้งไป Dashboard อัตโนมัติเมื่อระบบขึ้น
//  อัปเดต: ถาม HUB ของเจ้าของก่อน (sovereign-hub.json ข้าง exe) → ไม่ได้ค่อยไป GitHub release
// ─────────────────────────────────────────────────────────────
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const { verifyAsset, sha256File } = require('./verify-asset');
const { downloadFile } = require('./download');
const yt = require('./youtube');
const { registerYouTubeIpc } = require('./youtube-ipc');

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
      ? `⬆️ มีเวอร์ชันใหม่ ${upd.latest} (ตอนนี้ v${upd.current})${upd.source === 'hub' ? ' · จาก HUB' : ''} — เปิดตั้งค่า`
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
    win.show();
    win.focus();
    dlog('showMainWindow: หน้าต่างถูกเรียกกลับมา');
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

// ── HUB ของเจ้าของ: เครื่องปลายทางถาม HUB ก่อน แล้วค่อยตกไป GitHub ──
// ไฟล์ sovereign-hub.json วางไว้ข้าง exe (INSTALL-DESKTOP.cmd เขียนให้จาก join.json ของเครื่องนั้น)
//   { hubUrl: "http://192.168.1.102:3000", machineToken: "...", machineName: "คอมเครื่องที่ 2" }
// ไม่มีไฟล์นี้ = พฤติกรรมเดิม (เช็ค GitHub เท่านั้น) — เครื่องที่ไม่ได้อยู่ในวงของเจ้าของไม่พัง
function readHubConfig() {
  try {
    const p = path.join(path.dirname(app.getPath('exe')), 'sovereign-hub.json');
    if (!fs.existsSync(p)) return null;
    // เผื่อไฟล์ถูกเขียนโดย PowerShell/โปรแกรมที่ใส่ BOM — JSON.parse กับ BOM จะโยน error
    const j = JSON.parse(String(fs.readFileSync(p, 'utf8')).replace(/^\uFEFF/, ''));
    const hubUrl = String(j.hubUrl || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(hubUrl)) return null;
    return { hubUrl, machineToken: String(j.machineToken || ''), machineName: String(j.machineName || '') };
  } catch { return null; }
}

// ── Auto-Update: ตรวจเวอร์ชันจาก HUB ก่อน แล้วจึง GitHub (ไม่พึ่ง dependency ภายนอก) ──
const https = require('https');
const httpTransport = require('http');

/** GET JSON ได้ทั้ง http (ในวง LAN) และ https + แนบ header ได้ */
function fetchJsonAny(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const transport = String(url).startsWith('http:') ? httpTransport : https;
    const req = transport.get(url, { headers: { 'User-Agent': 'SovereignOS-Desktop', ...headers } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; });
      res.on('error', reject);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
  });
}
function fetchJson(url) {
  return fetchJsonAny(url, { Accept: 'application/vnd.github+json' });
}
function cmpVer(a, b) {
  const p = (s) => String(s).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = p(a), pb = p(b);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1; }
  return 0;
}
async function checkForUpdates(interactive) {
  const res = { ok: false, latest: null, current: app.getVersion(), assetUrl: null, hasUpdate: false, error: null, at: Date.now(), source: null, expectedSha: null, assetName: null };
  // 1) HUB ของเจ้าของก่อน — เครื่องในวง LAN ไม่ต้องรอ release บน GitHub
  const hub = readHubConfig();
  if (hub) {
    try {
      const m = await fetchJsonAny(
        hub.hubUrl + '/api/agent-machines/desktop-update/manifest',
        hub.machineToken ? { 'x-machine-token': hub.machineToken } : {}
      );
      if (m && m.version && m.asset && m.asset.name) {
        res.ok = true; res.source = 'hub'; res.latest = String(m.version);
        res.assetUrl = hub.hubUrl + '/api/agent-machines/desktop-update/asset';
        res.assetName = String(m.asset.name);
        res.expectedSha = String(m.asset.sha256 || '').toLowerCase();
        dlog('update check: HUB มีเวอร์ชัน', res.latest);
      }
    } catch (e) { dlog('hub update check failed (จะลอง GitHub แทน):', e.message); }
  }
  // 2) ไม่ได้จาก HUB (ยังไม่เผยแพร่/ติดต่อไม่ได้) → ตกไป GitHub เหมือนเดิม
  if (!res.ok) {
    try {
      const rel = await fetchJson('https://api.github.com/repos/' + UPSTREAM_REPO + '/releases/latest');
      const asset = (rel.assets || []).find((a) => /portable\.exe$/i.test(a.name)) || null;
      res.ok = true; res.source = 'github'; res.latest = rel.tag_name; res.assetUrl = asset ? asset.browser_download_url : null;
    } catch (e) { res.error = e.message; }
  }
  res.hasUpdate = !!(res.ok && res.latest && cmpVer(res.latest, res.current) > 0);
  updateInfo = res;
  updateTrayMenu();
  for (const w of [win, setupWin]) { try { w && !w.isDestroyed() && w.webContents.send('sovereign:update', res); } catch { /* ignore */ } }
  if (interactive) {
    const msg = !res.ok ? ('ตรวจอัปเดตไม่สำเร็จ: ' + res.error)
      : res.hasUpdate ? ('มีเวอร์ชันใหม่ ' + res.latest + ' (ตอนนี้ v' + res.current + ')' + (res.source === 'hub' ? ' · จาก HUB' : '') + (res.assetUrl ? ' — ดาวน์โหลดได้จากหน้าตั้งค่า' : ' — ยังไม่มีไฟล์ติดตั้งใน release'))
      : ('ใช้เวอร์ชันล่าสุดแล้ว (v' + res.current + ')');
    try { dialog.showMessageBox(win || undefined, { type: 'info', title: 'Sovereign OS — อัปเดต', message: msg }); } catch { /* ignore */ }
  }
  return res;
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

// single instance — startup folder + HKCU\Run ยิง exe ซ้ำสองตัวแข่ง startSystem กันเอง
const hasSingleLock = app.requestSingleInstanceLock();
if (hasSingleLock) app.on('second-instance', () => {
  // ดับเบิลคลิกซ้ำต้อง "เห็นหน้าต่าง" เสมอ ไม่ใช่แค่โชว์แล้วหายไป
  // (เคสจริง 11/10/69: ปิดหน้าต่าง = ย่อลง tray แล้วเปิดใหม่ไม่ขึ้นเลย
  //  เพราะ show() ไม่ได้เรียก — ผู้ใช้คิดว่าแอปพัง ทั้งที่มันรันอยู่)
  dlog('second-instance: เรียกหน้าต่างกลับมา');
  showMainWindow();
});
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

// ── IPC: วิดีโอสำหรับแท็บ "📣 โพสต์" ──
// pickVideo อ่านแค่ metadata (statSync) — ⛔ ห้าม readFileSync ทั้งไฟล์
// คลิป 4 GB จะทำให้โปรเซสหลักของ Electron กินหน่วยความจำจนแอปค้างทั้งตัว
// (sovereign:pickFile ด้านบนทำแบบนั้นอยู่ — ใช้ได้กับไฟล์เล็กเท่านั้น ห้ามลอกมาใช้กับวิดีโอ)
ipcMain.handle('sovereign:pickVideo', async () => {
  const filters = [{ name: 'วิดีโอ', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }];
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const fp = r.filePaths[0];
  try { return { path: fp, name: path.basename(fp), size: fs.statSync(fp).size }; }
  catch (e) { return { path: fp, name: path.basename(fp), size: 0, error: e.message }; }
});

// เปิดโฟลเดอร์ให้เห็นไฟล์ที่เลือก — เจ้าของจะได้ลากไฟล์จาก Explorer ไปวางบนหน้าเว็บต่อได้
ipcMain.handle('sovereign:showItemInFolder', (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return { ok: false, message: 'พาธไม่ถูกต้อง' };
  if (!path.isAbsolute(filePath)) return { ok: false, message: 'ต้องเป็นพาธแบบเต็ม' };
  try {
    if (!fs.existsSync(filePath)) return { ok: false, message: 'ไม่พบไฟล์นี้แล้ว (อาจถูกย้าย/ลบ)' };
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
});

// ── โดเมนที่ยอมให้เปิดด้วยเบราว์เซอร์จริง (แท็บ "📣 โพสต์") ──
// ⚠ ต้องเทียบ "ชื่อโฮสต์ตรงตัว" เท่านั้น ห้ามใช้ regex/substring/endsWith
//   เพราะ https://youtube.com.evil.com และ https://www.youtube.com@evil.com
//   จะผ่านด่านแบบนั้นไปได้ — ทั้งสองเคสมีเทสต์คุมที่ tools/test/social-post.test.mjs
// ⚠ รายการนี้ต้องตรงกับ hosts[] ใน sovereign-frontend/src/components/business/post/post-model.ts
//   ถ้าฝั่ง UI เพิ่มโดเมนแต่ที่นี่ไม่เพิ่ม ผู้ใช้จะกดแล้ว "ไม่มีอะไรเกิดขึ้น"
//   (มีเทสต์ cross-check สองฝั่งไว้แล้ว)
const EXTERNAL_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'studio.youtube.com',
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'tiktok.com',
  'www.tiktok.com',
  'instagram.com',
  'www.instagram.com',
]);

function isAllowedExternalUrl(url) {
  if (typeof url !== 'string') return false;
  // ของเดิม: หน้าในเครื่อง (offline page / dev server) — คงไว้ให้ทำงานเหมือนเดิมเป๊ะ
  if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(url)) return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname.toLowerCase());
}

// ── IPC: สถานะ + ปุ่มควบคุมระบบ ──
ipcMain.handle('sovereign:getStatus', async () => probeStatus());
ipcMain.handle('sovereign:startSystem', () => startSystem());
ipcMain.handle('sovereign:isAutoStarted', () => autoStarted);
ipcMain.handle('sovereign:openExternal', (_e, url) => {
  if (isAllowedExternalUrl(url)) {
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

// ── IPC: YouTube — อัปโหลดอัตโนมัติ (OAuth 2.0 loopback + resumable upload) ──
// ตัว logic อยู่ใน ./youtube-ipc.js (รับ electron API เข้ามาทางพารามิเตอร์ → เทสต์ด้วยของปลอมได้)
// ทำไมไม่ทำใน backend: ไฟล์วิดีโออยู่บนเครื่องนี้ อ่านตรงแล้วส่งขึ้น YouTube = ข้อมูลวิ่งรอบเดียว
// และไม่ต้อง restart backend เลย (โปรเจ็กอยู่ระหว่าง Cold Soak)
// ⚠ credential เก็บด้วย safeStorage (Windows DPAPI) ที่ userData\youtube-oauth.bin
//   ห้ามลง localStorage และห้ามลง repo เด็ดขาด — repo นี้เป็น public
//
// ⭐ หน้าอนุญาตของ Google ต้องเปิด "ในหน้าต่างของแอปนี้" เท่านั้น (เจ้าของสั่งชัดเจน)
//   ห้ามเด้งออกไปเบราว์เซอร์ภายนอกอีก ⇒ ต้องตั้ง User-Agent เป็น Chrome ล้วน
//   เพราะ Google บล็อก OAuth ใน embedded webview ที่ UA มีคำว่า Electron
//   (ถ้าไม่ตั้ง จะเจอหน้า "This browser or app may not be secure")
function openConsentWindow(url) {
  const parent = win && !win.isDestroyed() ? win : undefined;
  const w = new BrowserWindow({
    width: 540,
    height: 740,
    parent,
    modal: false,
    show: false,
    autoHideMenuBar: true,
    title: 'เชื่อมต่อบัญชี YouTube — Sovereign OS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // แยก session ของ Google ออกจากหน้าแอป (ล็อกอินครั้งเดียวแล้วจำไว้)
      partition: 'persist:youtube-oauth',
    },
  });

  const chromeVer = process.versions.chrome || '120.0.0.0';
  try {
    w.webContents.setUserAgent(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`,
    );
  } catch (e) { dlog('youtube: ตั้ง User-Agent ไม่สำเร็จ', e && e.message); }

  let closedResolve;
  let blocked = false;
  const done = new Promise((r) => { closedResolve = r; });
  w.once('ready-to-show', () => { try { w.show(); w.focus(); } catch { /* โชว์ไม่ได้ก็ยังโหลดอยู่ */ } });
  w.on('closed', () => closedResolve({ blocked }));

  // ⚠ Google บล็อก OAuth ใน embedded webview ("This browser or app may not be secure")
  //   เราตั้ง UA เป็น Chrome ล้วนเพื่อไม่ให้โดน ⇒ หน้าปกติจะผ่าน
  //   แต่ถ้า Google เปลี่ยนวิธีตรวจในอนาคต ต้องจับได้ทันที ไม่ปล่อยให้ผู้ใช้รอค้าง 5 นาที
  w.webContents.on('did-finish-load', () => {
    const probe = '(() => { const t = document.body ? document.body.innerText : ""; return String(t).slice(0, 4000); })()';
    w.webContents.executeJavaScript(probe, true)
      .then((text) => {
        if (/may not be secure|disallowed_useragent/i.test(String(text || ''))) {
          blocked = true;
          dlog('youtube: Google ปฏิเสธหน้าต่างในแอป (disallowed_useragent)');
          try { w.destroy(); } catch { /* ปิดไม่ได้ก็ช่างมัน */ }
        }
      })
      .catch(() => { /* อ่านหน้าไม่ได้ = ปล่อยให้ผู้ใช้ทำต่อ */ });
  });

  // Google อาจสั่งเปิด popup — ให้เปิดในหน้าต่างเดิมแทนการเด้งหน้าต่างใหม่
  w.webContents.setWindowOpenHandler(({ url: target }) => {
    try { w.loadURL(target); } catch { /* โหลดไม่ได้ก็ปล่อย */ }
    return { action: 'deny' };
  });

  w.loadURL(url).catch((e) => dlog('youtube: เปิดหน้าอนุญาตไม่สำเร็จ', e && e.message));

  return Promise.resolve({
    close: () => { try { if (!w.isDestroyed()) w.destroy(); } catch { /* ปิดไม่ได้ก็ช่างมัน */ } },
    done,
  });
}

registerYouTubeIpc({
  ipcMain, app, dialog, shell, safeStorage,
  getWin: () => win,
  log: dlog,
  openConsent: openConsentWindow,
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
    // ── มาจาก HUB: ลายเซ็นอ้างอิงคือ sha256 ใน manifest ของ HUB (fail-closed เหมือนกัน) ──
    // เหตุผลที่ตรวจได้โดยไม่ต้องมี registry: manifest เดินทางมาก่อนหน้าแล้ว และไฟล์ต้องตรงแฮชที่ประกาศไว้
    if (u.source === 'hub') {
      let actual = '';
      try { actual = (await sha256File(dest)).toLowerCase(); }
      catch (he) {
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        return { ok: false, message: 'ยกเลิกการติดตั้ง — อ่านไฟล์ที่ดาวน์โหลดไม่ได้ (' + he.message + ')' };
      }
      if (!u.expectedSha || actual !== u.expectedSha) {
        try { fs.unlinkSync(dest); } catch { /* ignore */ }
        dlog('hub update rejected: hash mismatch');
        return { ok: false, message: 'ยกเลิกการติดตั้ง — แฮชไม่ตรงกับที่ HUB ประกาศ ลบไฟล์ทิ้งแล้ว' };
      }
      shell.openPath(dest);
      dlog('hub update downloaded + hash verified:', dest);
      return { ok: true, message: 'ดาวน์โหลดจาก HUB แล้ว และตรวจ SHA-256 ผ่าน — เปิดตัวติดตั้งให้แล้ว (แนะนำปิดโปรแกรมเดิมก่อนติดตั้ง)' };
    }
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
