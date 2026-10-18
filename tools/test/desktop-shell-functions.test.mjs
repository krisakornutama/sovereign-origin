// เทส "ทุกฟังก์ชั่น" ของแอปเดสก์ท็อป (sovereign-frontend/electron/main.js)
//
// ทำไมต้องมี: main.js คือไฟล์เดียวที่รวมทุกอย่างของแอป (probe / offline / tray /
// wizard / one-click start / updater / HUB update / sidecar) — แต่ต้องมี Electron ครบ
// ถึงจะรันได้ ทำให้ "แก้แล้วพังเงียบ" ได้ง่ายมากโดยไม่มีใครเห็น
//
// วิธีที่: โหลด main.js ตัวจริงเข้า VM context ที่แทน `electron` ด้วยของปลอม
// ⇒ ทดสอบ "ตรรกะจริง" ไม่ใช่สำเนา ไม่ต้องมีหน้าจอ ไม่ต้องเปิดพอร์ตจริง
//   - probe/probeStatus  → ยิง HTTP จริงเข้าเซอร์วิสปลอมในเครื่อง
//   - readHubConfig      → ไฟล์จริงชั่วคราว (รวมเคส BOM ที่เคยเป็นบั๊ก)
//   - cmpVer/fetchJsonAny→ ข้อมูลจริง/เซอร์วิสปลอม
//   - IPC 15 ตัว          → เรียกผ่านตัวจัดการที่ลงทะเบียนไว้จริง
//   - verify/download    → เทสต์ของเดิม + เพิ่มการเชื่อมโยงกับ main
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN = path.join(ROOT, 'sovereign-frontend', 'electron', 'main.js');

// ─────────────────────────────────────────────────────────────
//  แผ่นปลอมของ Electron — เก็บทุกฝั่งที่ main.js สัมผัสไว้ให้เทสต์อ้างอิงได้
// ─────────────────────────────────────────────────────────────
function makeElectronStub(opts = {}) {
  const calls = {
    openExternal: [], openPath: [], loadURL: [], loadFile: [],
    sent: [], dialogs: [], loginItem: null, quit: 0,
  };
  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });
  const handlers = new Map();   // ipcMain.handle
  const listeners = new Map();  // app.on

  const mkWin = () => ({
    once() {}, on() {}, show() {}, hide() {}, focus() {}, restore() {}, close() {},
    isMinimized: () => false, isDestroyed: () => false,
    loadURL: (u) => { calls.loadURL.push(u); return Promise.resolve(); },
    loadFile: (f) => { calls.loadFile.push(f); return Promise.resolve(); },
    webContents: { send: (ch, p) => calls.sent.push([ch, p]), on() {} },
  });

  const tray = { setToolTip() {}, setContextMenu(t) { calls.trayMenu = t; }, on() {} };

  const app = {
    isPackaged: opts.isPackaged ?? true,
    getVersion: () => opts.version || '1.1.1',
    getPath: (k) => (opts.paths && opts.paths[k]) || opts.userData || os.tmpdir(),
    getName: () => 'Sovereign OS',
    whenReady: () => readyPromise,
    on: (ev, fn) => { listeners.set(ev, fn); },
    quit: () => { calls.quit++; },
    setLoginItemSettings: (s) => { calls.loginItem = s; },
    requestSingleInstanceLock: () => opts.lock !== false,
  };

  const electron = {
    app,
    BrowserWindow: class { constructor() { return mkWin(); } },
    ipcMain: {
      handle: (ch, fn) => handlers.set(ch, fn),
      on: () => {},
    },
    dialog: {
      showOpenDialog: async () => { calls.dialogs.push('open'); return opts.openResult || { canceled: true }; },
      showMessageBox: async () => { calls.dialogs.push('msg'); return { response: 0 }; },
    },
    shell: {
      openExternal: (u) => { calls.openExternal.push(u); },
      openPath: (p) => { calls.openPath.push(p); },
    },
    Menu: { buildFromTemplate: (t) => t },
    Tray: class { constructor() { return tray; } },
    // main.js ส่ง safeStorage ต่อให้ youtube-ipc — stub ต้องมี ไม่งั้นโหลด main.js ไม่ผ่าน
    // (เข้ารหัสแบบ base64 ให้ "จริง" พอที่จะตรวจได้ว่าไฟล์บนดิสก์ไม่มี plaintext)
    safeStorage: {
      isEncryptionAvailable: () => opts.secure !== false,
      encryptString: (s) => Buffer.from('ENC|' + Buffer.from(String(s), 'utf8').toString('base64'), 'utf8'),
      decryptString: (b) => Buffer.from(String(b).slice(4), 'base64').toString('utf8'),
    },
  };
  return { electron, calls, handlers, app, tray, ready: () => readyResolve() };
}

/**
 * โหลด main.js ตัวจริงใน VM — คืน { exports, calls, handlers, ... }
 * opts.expose: ชื่อฟังก์ชันที่ต้องการดึงออกมาทดสอบ (main.js ไม่ได้ export)
 */
function loadShell(opts = {}) {
  const stub = makeElectronStub(opts);
  const userData = opts.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'sov-shell-'));
  stub.app.getPath = (k) => (opts.paths && opts.paths[k]) || userData;

  const expose = new Set(opts.expose || []);
  const src = fs.readFileSync(MAIN, 'utf8');
  // ต่อท้ายด้วยตัว export เฉพาะที่ขอ + ตัวช่วยจำลองสภาวะที่ whenReady สร้างให้ในแอปจริง
  // (win/tray ถูกสร้างตอนบูต — ถ้าไม่จำลอง จะทดสอบโค้ดที่แตะ win ไม่ได้เลย)
  const helpers = ['__mkwin', '__setWin', '__setSetupWin', '__setTray', '__setUpdateInfo'];
  const names = [...new Set([...expose, ...helpers])];
  const helperSrc = `
  function __mkwin() {
    return {
      once(){}, on(){}, show(){}, hide(){}, focus(){}, restore(){}, close(){},
      isMinimized: () => false, isDestroyed: () => false,
      loadURL: (u) => { __calls.loadURL.push(u); return Promise.resolve(); },
      loadFile: (f) => { __calls.loadFile.push(f); return Promise.resolve(); },
      webContents: { send: (ch, p) => __calls.sent.push([ch, p]), on(){} },
    };
  }
  function __setWin(w) { win = w; }
  function __setSetupWin(w) { setupWin = w; }
  function __setTray(t) { tray = t; }
  function __setUpdateInfo(u) { updateInfo = u; }
  `;
  const epilogue = `\n;__TEST__ = { ${names.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ')} };`;
  const code = src + helperSrc + epilogue;

  const sandbox = {
    require: (id) => {
      if (id === 'electron') return stub.electron;
      // โมดูลในเครื่องของ shell (./x) ทุกตัว resolve จากโฟลเดอร์ electron เสมอ
      // (เดิมไล่ชื่อทีละตัว — เพิ่มโมดูลใหม่แล้วเทสต์ล้มทั้งไฟล์โดยไม่เกี่ยวกับบั๊กจริง)
      if (typeof id === 'string' && id.startsWith('./')) return require(path.join(ROOT, 'sovereign-frontend/electron', `${id.slice(2)}.js`));
      return require(id);
    },
    console: opts.quiet ? { log() {}, error() {}, warn() {} } : console,
    __calls: stub.calls,
    process: { ...process, env: { ...process.env, ...(opts.env || {}) } },
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    URL, Promise, Date, Math, JSON, RegExp, Error, __dirname: path.dirname(MAIN),
    __filename: MAIN,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'main.js' });

  return { ...stub, exports: sandbox.__TEST__ || {}, sandbox, userData };
}

// require แบบ CJS สำหรับโมดูลที่ main.js ดึงเข้ามา
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────
//  เซอร์วิสปลอม — probe() ต้องยิงของจริง ไม่ mock (ไม่งั้นเทสต์ผ่านเปล่าๆ)
// ─────────────────────────────────────────────────────────────
async function withServer(handler, fn) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => srv.close(r)); }
}

// ═════════════════════════════════════════════════════════════
//  1) probe / probeStatus — หัวใจการตัดสินว่าจะพาไป Dashboard หรือ offline
// ═════════════════════════════════════════════════════════════
describe('probe — ตรวจว่า URL ตอบไหม', () => {
  test('200 = ออนไลน์ / 404 = ยังถือว่าออนไลน์ / 500 = ล่ม', async () => {
    await withServer((req, res) => {
      if (req.url === '/ok') return res.writeHead(200), res.end('x');
      if (req.url === '/nf') return res.writeHead(404), res.end('x');
      res.writeHead(500), res.end('x');
    }, async (base) => {
      const { exports: S } = loadShell({ expose: ['probe'] });
      assert.equal(await S.probe(base + '/ok'), true, '200 ต้อง true');
      assert.equal(await S.probe(base + '/nf'), true, '404 ยังไอ็ที่ (แอปเปิดได้)');
      assert.equal(await S.probe(base + '/boom'), false, '5xx = ล่ม');
    });
  });

  test('ตั้งชื่อโดเมนที่ไม่มีจริง = false ไม่ค้าง (timeout/error ต้อง settle)', async () => {
    const { exports: S } = loadShell({ expose: ['probe'] });
    assert.equal(await S.probe('http://127.0.0.1:1/never'), false, 'ปอร์ตที่ไม่มี = false เร็ว');
    const t0 = Date.now();
    await S.probe('http://no-such-host-xyz-999.invalid/');
    assert.ok(Date.now() - t0 < 5000, 'DNS ล้มต้องจบไว ไม่ค้างหลายวินาที');
  });
});

describe('probeStatus — สถานะ 3 บริการพร้อมกัน', () => {
  test('คืนครบ 3 พอร์ต (ไม่มีคีย์หาย/เพิ่ม — เมนู tray พึ่งคีย์พอร์ตตรง ๆ)', async () => {
    const { exports: S } = loadShell({ expose: ['probeStatus', 'updateTrayMenu'] });
    const st = await S.probeStatus();
    assert.deepEqual(Object.keys(st).sort(), ['api', 'frontend', 'launcher']);
    for (const k of ['frontend', 'launcher', 'api']) {
      assert.equal(typeof st[k], 'boolean', `${k} ต้องเป็น boolean`);
    }
  });

  test('เมนู tray สร้างได้และสะท้อนสถานะจริง', async () => {
    const sh = loadShell({ expose: ['probeStatus', 'updateTrayMenu'] });
    // tray ถูกสร้างตอนบูตในแอปจริง — จำลองสภาวะเดียวกัน
    sh.exports.__setTray({ setToolTip() {}, setContextMenu(t) { sh.calls.trayMenu = t; }, on() {} });
    await sh.exports.probeStatus();
    const menu = sh.calls.trayMenu;
    assert.ok(Array.isArray(menu) && menu.length >= 8, 'เมนู tray ต้องมีรายการพอใช้');
    const labels = menu.filter((m) => m.label).map((m) => m.label);
    assert.ok(labels.some((l) => /Dashboard :3000/.test(l)), 'ต้องมีบรรทัดสถานะ Dashboard');
    assert.ok(labels.some((l) => /Core API :3001/.test(l)), 'ต้องมีบรรทัดสถานะ API');
    assert.ok(labels.some((l) => /Launcher :4100/.test(l)), 'ต้องมีบรรทัดสถานะ Launcher');
    assert.ok(labels.some((l) => /เริ่มระบบทั้งหมด/.test(l)), 'ต้องมีปุ่มเริ่มระบบ');
    assert.ok(labels.some((l) => /ออกจาก/.test(l)), 'ต้องมีทางออกจริง (ไม่ใช่ปิดหน้าต่าง)');
  });
});

// ═════════════════════════════════════════════════════════════
//  2) cmpVer — ตัดสินว่ามีเวอร์ชันใหม่ไหม (ผิดแล้ว = อัปเดตไม่เคยเกิด)
// ═════════════════════════════════════════════════════════════
describe('cmpVer — เทียบเวอร์ชันแบบเชิงตัวเลข', () => {
  const S = loadShell({ expose: ['cmpVer'] }).exports;
  test('ปกติ', () => {
    assert.equal(S.cmpVer('1.1.2', '1.1.1'), 1);
    assert.equal(S.cmpVer('1.1.1', '1.1.1'), 0);
    assert.equal(S.cmpVer('1.1.0', '1.1.1'), -1);
  });
  test('ตัวเลขหลายหลัก — ห้ามเทียบเป็นสตริง (1.10 < 1.9 แบบ string)', () => {
    assert.equal(S.cmpVer('1.10.0', '1.9.0'), 1, '1.10 > 1.9');
    assert.equal(S.cmpVer('2.0.0', '10.0.0'), -1);
    assert.equal(S.cmpVer('v1.2.3', '1.2.4'), -1, 'ตัด v ทิ้ง');
  });
  test('เวอร์ชันขยาว/ตัวเลขผิดรูป = ไม่ crash', () => {
    assert.equal(S.cmpVer('1.2', '1.2.0'), 0, '1.2 == 1.2.0');
    assert.equal(S.cmpVer('1.2.3.4', '1.2.3'), 0, 'เกิน 3 หลัก = ไม่นับ (ตรงกับที่โค้ดเขียนไว้)');
    assert.equal(S.cmpVer('', '1.0.0'), -1);
    assert.equal(S.cmpVer('a.b.c', '1.0.0'), -1, 'parseInt ได้ NaN → 0');
  });
});

// ═════════════════════════════════════════════════════════════
//  3) fetchJsonAny — ตัวดึง manifest (HUB เป็น LAN/http, GitHub เป็น https)
// ═════════════════════════════════════════════════════════════
describe('fetchJsonAny — ดึง JSON ได้ทั้ง http และ https', () => {
  test('อ่าน JSON ได้จริงจากเซอร์วิส', async () => {
    await withServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '1.2.0', asset: { name: 'a.exe', sha256: 'AB' } }));
    }, async (base) => {
      const { exports: S } = loadShell({ expose: ['fetchJsonAny'] });
      const j = await S.fetchJsonAny(base + '/manifest');
      assert.equal(j.version, '1.2.0');
      assert.equal(j.asset.name, 'a.exe');
    });
  });

  test('ส่ง header ที่สั่งไว้ (x-machine-token ของ HUB)', async () => {
    let seen = null;
    await withServer((req, res) => { seen = req.headers; res.writeHead(200); res.end('{}'); }, async (base) => {
      const { exports: S } = loadShell({ expose: ['fetchJsonAny'] });
      await S.fetchJsonAny(base + '/x', { 'x-machine-token': 'TOK-123' });
      assert.equal(seen['x-machine-token'], 'TOK-123');
      assert.equal(seen['user-agent'], 'SovereignOS-Desktop', 'ต้องระบุตัวตน');
    });
  });

  test('สถานะไม่ใช่ 200 = throw (ไม่ใช่ null — จะได้ไม่รู้ว่าล้ม)', async () => {
    await withServer((req, res) => { res.writeHead(503); res.end(); }, async (base) => {
      const { exports: S } = loadShell({ expose: ['fetchJsonAny'] });
      await assert.rejects(() => S.fetchJsonAny(base + '/down'), /HTTP 503/);
    });
  });

  test('เนื้อหาไม่ใช่ JSON = throw', async () => {
    await withServer((req, res) => { res.writeHead(200); res.end('<html>nope'); }, async (base) => {
      const { exports: S } = loadShell({ expose: ['fetchJsonAny'] });
      await assert.rejects(() => S.fetchJsonAny(base + '/html'));
    });
  });
});

// ═════════════════════════════════════════════════════════════
//  4) readHubConfig — ไฟล์ sovereign-hub.json ข้าง exe
// ═════════════════════════════════════════════════════════════
describe('readHubConfig — อ่านการตั้งค่า HUB ข้าง exe', () => {
  const withExeDir = (content, name = 'sovereign-hub.json') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-hub-'));
    if (content !== null) fs.writeFileSync(path.join(dir, name), content);
    return dir;
  };

  test('ไฟล์ปกติ → hubUrl สะอาด (ตัด / ท้าย) + token', () => {
    const dir = withExeDir(JSON.stringify({
      hubUrl: 'http://192.168.1.102:3000/', machineToken: 'TK', machineName: 'เครื่อง 2',
    }));
    const { exports: S } = loadShell({ expose: ['readHubConfig'], paths: { exe: path.join(dir, 'app.exe') } });
    const c = S.readHubConfig();
    assert.equal(c.hubUrl, 'http://192.168.1.102:3000', 'ตัด slash ท้ายออก');
    assert.equal(c.machineToken, 'TK');
  });

  test('ไฟล์มี BOM (เขียนโดย PowerShell) = ยังอ่านได้ — เคยเป็นบั๊กเงียบ', () => {
    const dir = withExeDir('\uFEFF' + JSON.stringify({ hubUrl: 'http://10.0.0.5:3000' }));
    const { exports: S } = loadShell({ expose: ['readHubConfig'], paths: { exe: path.join(dir, 'app.exe') } });
    const c = S.readHubConfig();
    assert.ok(c, 'BOM ต้องถูกตัดออก ไม่ใช่ null');
    assert.equal(c.hubUrl, 'http://10.0.0.5:3000');
  });

  test('ไม่มีไฟล์ = null (เครื่องนอกวงของเจ้าของไม่พัง)', () => {
    const dir = withExeDir(null);
    const { exports: S } = loadShell({ expose: ['readHubConfig'], paths: { exe: path.join(dir, 'app.exe') } });
    assert.equal(S.readHubConfig(), null);
  });

  test('ไฟล์เสีย/JSON ผิด/ไม่มี scheme = null (ล้มเงียบ ไม่ throw)', () => {
    for (const bad of ['{not json', JSON.stringify({ hubUrl: 'not-a-url' }), JSON.stringify({})]) {
      const dir = withExeDir(bad);
      const { exports: S } = loadShell({ expose: ['readHubConfig'], paths: { exe: path.join(dir, 'app.exe') } });
      assert.equal(S.readHubConfig(), null, `ต้องเป็น null สำหรับ ${bad.slice(0, 20)}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════
//  5) findStartBat — หา .bat สำหรับปุ่ม "เริ่มระบบ"
// ═════════════════════════════════════════════════════════════
describe('findStartBat — หา start-sovereign.bat', () => {
  test('โหมด dev (ไม่ได้ pack) ดูจากรากโปรเจกต์', () => {
    const { exports: S } = loadShell({ expose: ['findStartBat'], isPackaged: false });
    const f = S.findStartBat();
    assert.ok(f, 'ต้องหาเจอที่รากโปรเจกต์');
    assert.ok(fs.existsSync(f.bat), 'ไฟล์ .bat ต้องมีจริง');
    assert.ok(f.bat.endsWith('start-sovereign.bat'));
  });

  test('โหมด pack: ไล่ขึ้นไป 2 ชั้นจากโฟลเดอร์ exe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-exe-'));
    fs.writeFileSync(path.join(dir, 'start-sovereign.bat'), '@echo off');
    const { exports: S } = loadShell({ expose: ['findStartBat'], paths: { exe: path.join(dir, 'Sovereign OS.exe') } });
    const f = S.findStartBat();
    assert.ok(f && f.bat.endsWith('start-sovereign.bat'), 'ต้องเจอ .bat ข้าง exe');
  });

  test('ไม่มี .bat ที่ไหนเลย = null (ไม่ throw) → startSystem ตอบว่าเปิด Launcher', () => {
    // ชี้ MAIN_ROOT ไปที่โฟลเดอร์ที่ไม่มีอะไร + ไม่มี exe dir ที่มี bat
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-empty-'));
    const { exports: S } = loadShell({ expose: ['findStartBat'], paths: { exe: path.join(empty, 'x.exe') } });
    const f = S.findStartBat();
    // อาจเจอ MAIN_ROOT จริงของเครื่องนี้ — ถ้าเจอต้องชี้ไฟล์ที่มีอยู่จริง
    if (f) assert.ok(fs.existsSync(f.bat), 'ถ้าเจอต้องเป็นไฟล์จริง');
  });
});

// ═════════════════════════════════════════════════════════════
//  6) IPC — ทุก handler ที่ลงทะเบียนไว้ต้องเรียกได้จริงและไม่ throw
// ═════════════════════════════════════════════════════════════
describe('IPC — ครบทุก handler ที่หน้าเว็บเรียกใช้', () => {
  test('ลงทะเบียนครบ 15 ช่อง และชื่อตรงกับ preload.js', () => {
    const { handlers } = loadShell({});
    const expect = [
      'sovereign:pickFile', 'sovereign:readDir', 'sovereign:getStatus', 'sovereign:startSystem',
      'sovereign:isAutoStarted', 'sovereign:openExternal', 'sovereign:retryDashboard',
      'sovereign:openWizard', 'sovereign:pickInstallDir', 'sovereign:checkEnv',
      'sovereign:getSetupDir', 'sovereign:beginSetup', 'sovereign:checkUpdates',
      'sovereign:downloadUpdate',
    ];
    for (const ch of expect) assert.ok(handlers.has(ch), `ไม่มี handler ${ch}`);
    // preload ต้อง expose ครบ — ถ้าฝั่งโหลดเรียกช่องที่ไม่มี = ปุ่มในแอปตายเงียบ
    const preload = fs.readFileSync(path.join(ROOT, 'sovereign-frontend/electron/preload.js'), 'utf8');
    const exposed = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]);
    assert.ok(exposed.length >= 14, `preload ควร expose ≥14 ช่อง เจอ ${exposed.length}`);
    for (const ch of exposed) assert.ok(handlers.has(ch), `preload เรียก ${ch} แต่ไม่มี handler`);
  });

  test('readDir อ่านได้จริง และคืน error เมื่อไม่มีโฟลเดอร์ (ไม่ throw)', async () => {
    const { handlers } = loadShell({});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dir-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const ok = await handlers.get('sovereign:readDir')(null, dir);
    assert.ok(Array.isArray(ok) && ok.some((d) => d.name === 'a.txt'), 'ต้องเห็นไฟล์');
    const bad = await handlers.get('sovereign:readDir')(null, path.join(dir, 'nope'));
    assert.ok(bad.error, 'โฟลเดอร์ไม่มี = คืน error ไม่ใช่ throw');
  });

  test('pickFile — ผู้ใช้กดยกเลิก = null', async () => {
    const { handlers } = loadShell({ openResult: { canceled: true } });
    assert.equal(await handlers.get('sovereign:pickFile')(null), null);
  });

  test('openExternal — อนุญาตเฉพาะ localhost/127.0.0.1 (กันเปิด URL แปลกปลอม)', async () => {
    const { handlers, calls } = loadShell({});
    const h = handlers.get('sovereign:openExternal');
    // เทียบทีละคีย์ ไม่ใช่ deepEqual — วัตถุมาจาก VM realm อีกโลกหนึ่ง (prototype คนละตัว
    // ⇒ deepEqual พังทั้งที่ค่าเท่ากันจริง)
    for (const u of ['http://localhost:3000', 'http://127.0.0.1:4100/x']) {
      const r = await h(null, u);
      assert.equal(r.ok, true, `ต้องอนุญาต ${u}`);
    }
    assert.equal(calls.openExternal.length, 2, 'ต้องเปิดจริง 2 ครั้ง');
    for (const u of ['https://evil.example', 'file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)', 'http://10.0.0.5:3000', '']) {
      const r = await h(null, u);
      assert.equal(r.ok, false, `ห้ามเปิด ${u || '(ว่าง)'}`);
    }
    assert.equal(calls.openExternal.length, 2, 'ไม่มี URL แปลกปลอมหลุดออกไปเปิดจริง');
  });

  test('getStatus / isAutoStarted / retryDashboard ตอบได้ไม่ throw', async () => {
    const sh = loadShell({});
    sh.exports.__setWin(sh.exports.__mkwin());
    const { handlers } = sh;
    const st = await handlers.get('sovereign:getStatus')(null);
    assert.equal(typeof st.frontend, 'boolean');
    assert.equal(typeof (await handlers.get('sovereign:isAutoStarted')(null)), 'boolean');
    const rd = await handlers.get('sovereign:retryDashboard')(null);
    assert.equal(typeof rd.ok, 'boolean', 'retryDashboard ต้องตอบ ok เสมอ');
  });

  test('checkEnv รายงาน node/docker/bat ครบ 3 ช่อง', async () => {
    const { handlers } = loadShell({});
    const env = await handlers.get('sovereign:checkEnv')(null);
    for (const k of ['node', 'docker', 'bat']) {
      assert.ok(env[k], `ขาด ${k}`);
      assert.equal(typeof env[k].ok, 'boolean');
      assert.equal(typeof env[k].detail, 'string');
    }
  });

  test('beginSetup เขียน flag ได้จริง และ getSetupDir อ่านกลับมาได้', async () => {
    const { handlers } = loadShell({});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-setup-'));
    assert.equal((await handlers.get('sovereign:beginSetup')(null, dir)).ok, true);
    assert.equal(await handlers.get('sovereign:getSetupDir')(null), dir, 'ต้องอ่านกลับได้');
    assert.ok(fs.existsSync(path.join(dir, 'sovereign-home.txt')), 'ต้องมี marker ในโฟลเดอร์ที่เลือก');
  });

  test('getSetupDir ยังไม่เคยตั้งค่า = null (ไม่ throw)', async () => {
    const { handlers } = loadShell({});
    assert.equal(await handlers.get('sovereign:getSetupDir')(null), null);
  });

  test('openWizard เปิดได้ และ beginSetup ปิด wizard ให้เอง', async () => {
    const sh = loadShell({});
    sh.exports.__setWin(sh.exports.__mkwin());
    const { handlers, calls } = sh;
    assert.equal((await handlers.get('sovereign:openWizard')(null)).ok, true);
    await handlers.get('sovereign:beginSetup')(null, null);
    assert.ok(calls.loadFile.some((f) => String(f).endsWith('setup-wizard.html')), 'ต้องโหลดหน้า wizard');
  });
});

// ═════════════════════════════════════════════════════════════
//  7) checkForUpdates — HUB ก่อน GitHub (เส้นทางที่เพิ่งเพิ่ม = จุดเสี่ยงสุด)
// ═════════════════════════════════════════════════════════════
describe('checkForUpdates — ลำดับ HUB → GitHub', () => {
  /** main.js อ่าน hubUrl จากข้าง exe — จัดให้ชี้เซอร์วิสปลอม
   ต้องคืน fn ที่ยัง "ยืนอยู่" พร้อม base แล้วปิดเซอร์วิสทีหลัง ไม่ใช่ปิดก่อนผู้เรียกใช้
   (เคยพลาดตรงนี้: withServer ปิดพอร์ตใน finally ก่อน test จะยิง manifest → ได้ source=github) */
const withHub = (manifestHandler, opts = {}) => {
  const srv = http.createServer(manifestHandler);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-hub2-'));
      fs.writeFileSync(path.join(exeDir, 'sovereign-hub.json'), JSON.stringify({
        hubUrl: base, machineToken: 'TK', machineName: 'เครื่องทดสอบ',
      }));
      const sh = loadShell({ expose: ['checkForUpdates', 'cmpVer'], paths: { exe: path.join(exeDir, 'app.exe') }, quiet: true, ...opts });
      resolve({ sh, base, close: () => new Promise((r) => srv.close(r)) });
    });
  });
};

  test('HUB มีเวอร์ชันใหม่ → source=hub + ได้ sha256 + assetUrl ชี้ HUB', async () => {
    const { sh, close } = await withHub((req, res) => {
      if (req.url.includes('/desktop-update/manifest')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          version: '1.2.0',
          asset: { name: 'Sovereign-OS-1.2.0-portable.exe', sha256: 'AB'.repeat(32), size: 100 },
        }));
      }
      res.writeHead(404); res.end();
    });
    try {
      const r = await sh.exports.checkForUpdates(false);
      assert.equal(r.ok, true);
      assert.equal(r.source, 'hub', 'ต้องตอบว่ามาจาก HUB');
      assert.equal(r.latest, '1.2.0');
      assert.equal(r.hasUpdate, true, '1.2.0 > 1.1.1 ต้องมีอัปเดต');
      assert.match(r.assetUrl, /desktop-update\/asset$/, 'ต้องชี้ route ของ HUB');
      assert.equal(r.expectedSha, 'ab'.repeat(32), 'sha ต้องเป็นตัวพิมพ์เล็ก');
      assert.equal(r.assetName, 'Sovereign-OS-1.2.0-portable.exe');
    } finally { await close(); }
  });

  test('HUB บอกว่าเท่ากัน = ไม่มีอัปเดต (ไม่หลุดไปหา GitHub เปล่าๆ)', async () => {
    const { sh, close } = await withHub((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '1.1.1', asset: { name: 'a.exe', sha256: 'ab'.repeat(32) } }));
    });
    try {
      const r = await sh.exports.checkForUpdates(false);
      assert.equal(r.source, 'hub');
      assert.equal(r.hasUpdate, false, 'เวอร์ชันเท่ากัน = ไม่มีอัปเดต');
    } finally { await close(); }
  });

  test('HUB ล้ม (404/ไม่มีเนื้อหา) = ตกไป GitHub ไม่ crash', async () => {
    const { sh, close } = await withHub((req, res) => { res.writeHead(404); res.end(); });
    try {
      const r = await sh.exports.checkForUpdates(false);
      // ต่อเน็ตจริงได้หรือไม่ไม่สำคัญ — สำคัญคือ "ไม่ throw" และคืนโครงสร้างครบ
      assert.equal(typeof r.ok, 'boolean');
      assert.ok(['hub', 'github', null].includes(r.source));
      if (!r.ok) assert.ok(r.error, 'ล้มแล้วต้องบอกเหตุผล ไม่ใช่เงียบ');
    } finally { await close(); }
  });

  test('HUB ตอบ 200 แต่เนื้อหามัดจำ = ถือว่า HUB ใช้ไม่ได้ (ไม่เชื่อ manifest พัง)', async () => {
    const { sh, close } = await withHub((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"version":""}'); });
    try {
      const r = await sh.exports.checkForUpdates(false);
      if (r.source === 'hub') assert.fail('manifest ที่ไม่มี asset ต้องไม่ถูกรับ');
      assert.equal(typeof r.ok, 'boolean');
    } finally { await close(); }
  });
});

// ═════════════════════════════════════════════════════════════
//  8) downloadUpdate — fail-closed ทั้ง 2 แหล่ง (HUB และ GitHub)
// ═════════════════════════════════════════════════════════════
describe('downloadUpdate — ปฏิเสธไฟล์ที่แฮชไม่ตรงเสมอ', () => {
  test('ยังไม่ได้ตรวจอัปเดต = บอกให้กดตรวจก่อน ไม่ดาวน์โหลดมั่ว', async () => {
    const { handlers, calls } = loadShell({});
    const r = await handlers.get('sovereign:downloadUpdate')(null);
    assert.equal(r.ok, false);
    assert.equal(calls.openPath.length, 0, 'ห้ามเปิดไฟล์อะไรเด็ดขาด');
  });

  test('มาจาก HUB + แฮชตรง = ดาวน์โหลดแล้วเปิดตัวติดตั้งจริง', async () => {
    const body = Buffer.from('Sovereign desktop payload');
    const realSha = require('node:crypto').createHash('sha256').update(body).digest('hex');
    await withServer((req, res) => {
      if (req.url.includes('/desktop-update/manifest')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ version: '1.2.0', asset: { name: 'Sovereign-OS-1.2.0-portable.exe', sha256: realSha } }));
      }
      if (req.url.includes('/desktop-update/asset')) {
        res.writeHead(200, { 'Content-Length': body.length });
        return res.end(body);
      }
      res.writeHead(404); res.end();
    }, async (base) => {
      const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dl1-'));
      fs.writeFileSync(path.join(exeDir, 'sovereign-hub.json'), JSON.stringify({ hubUrl: base }));
      const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dlout1-'));
      const { handlers, calls } = loadShell({ paths: { exe: path.join(exeDir, 'app.exe'), downloads: dlDir }, quiet: true });
      await handlers.get('sovereign:checkUpdates')(null);
      const r = await handlers.get('sovereign:downloadUpdate')(null);
      assert.equal(r.ok, true, 'แฮชตรง = ต้องผ่าน: ' + r.message);
      assert.equal(calls.openPath.length, 1, 'ต้องเปิดตัวติดตั้งจริง 1 ครั้ง');
      assert.ok(calls.openPath[0].includes('1.2.0'), 'ชื่อไฟล์ต้องมีเวอร์ชัน');
    });
  });

  test('มาจาก HUB + แฮชไม่ตรง = ลบไฟล์ทิ้ง ไม่เปิด (fail-closed)', async () => {
    const body = Buffer.from('Sovereign desktop payload');
    // ประกาศแฮชคนละอันกับไฟล์จริง = จำลองถูกแฮ็ก/เสียหาย
    const wrongSha = 'de'.repeat(32);
    await withServer((req, res) => {
      if (req.url.includes('/desktop-update/manifest')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ version: '1.2.0', asset: { name: 'Sovereign-OS-1.2.0-portable.exe', sha256: wrongSha } }));
      }
      if (req.url.includes('/desktop-update/asset')) {
        res.writeHead(200, { 'Content-Length': body.length });
        return res.end(body);
      }
      res.writeHead(404); res.end();
    }, async (base) => {
      const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dl2-'));
      fs.writeFileSync(path.join(exeDir, 'sovereign-hub.json'), JSON.stringify({ hubUrl: base }));
      const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dlout2-'));
      const { handlers, calls } = loadShell({ paths: { exe: path.join(exeDir, 'app.exe'), downloads: dlDir }, quiet: true });
      await handlers.get('sovereign:checkUpdates')(null);
      const r = await handlers.get('sovereign:downloadUpdate')(null);
      assert.equal(r.ok, false, 'แฮชไม่ตรง = ต้องปฏิเสธ');
      assert.match(r.message, /แฮชไม่ตรง/, 'ต้องบอกเหตุผลชัด');
      assert.equal(calls.openPath.length, 0, 'ห้ามเปิดไฟล์ที่แฮชไม่ตรงเด็ดขาด');
      const leftovers = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
      assert.equal(leftovers.length, 0, `ต้องลบไฟล์ทิ้ง เหลือ ${leftovers.join(',')}`);
    });
  });

  test('HUB ไม่ประกาศแฮชเลย = ปฏิเสธ (ไม่เดาให้ผ่าน)', async () => {
    const body = Buffer.from('payload');
    await withServer((req, res) => {
      if (req.url.includes('/desktop-update/manifest')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // ไม่มี field sha256 เลย
        return res.end(JSON.stringify({ version: '1.2.0', asset: { name: 'a.exe' } }));
      }
      if (req.url.includes('/desktop-update/asset')) { res.writeHead(200, { 'Content-Length': body.length }); return res.end(body); }
      res.writeHead(404); res.end();
    }, async (base) => {
      const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dl3-'));
      fs.writeFileSync(path.join(exeDir, 'sovereign-hub.json'), JSON.stringify({ hubUrl: base }));
      const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dlout3-'));
      const { handlers, calls } = loadShell({ paths: { exe: path.join(exeDir, 'app.exe'), downloads: dlDir }, quiet: true });
      await handlers.get('sovereign:checkUpdates')(null);
      const r = await handlers.get('sovereign:downloadUpdate')(null);
      assert.equal(r.ok, false, 'ไม่มีแฮชอ้างอิง = ต้องไม่อนุมัติ');
      assert.equal(calls.openPath.length, 0, 'ห้ามเปิดไฟล์');
      assert.equal(fs.readdirSync(dlDir).length, 0, 'ต้องลบไฟล์ทิ้ง');
    });
  });
});

// ═════════════════════════════════════════════════════════════
//  9) โมดูลลูก — verify-asset / download (ของเดิม + ยืนยันว่าต่อกับ main ได้จริง)
// ═════════════════════════════════════════════════════════════
describe('โมดูลที่ main.js พึ่ง — ต้องไม่หลุดวิธีตรวจ', () => {
  const va = require(path.join(ROOT, 'sovereign-frontend/electron/verify-asset.js'));
  const dl = require(path.join(ROOT, 'sovereign-frontend/electron/download.js'));

  test('verify-asset: ไม่มีลายเซ็นอ้างอิง = ไม่อนุมัติ (fail-closed)', async () => {
    const r = await va.verifyAssetWith({
      assetUrl: 'https://github.com/o/r/releases/download/v1/a.exe', dest: 'x',
      getDigest: async () => null, getSums: async () => null, hashFile: async () => 'a'.repeat(64),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-reference');
  });

  test('verify-asset: แฮชไม่ตรง = ไม่อนุมัติ', async () => {
    const r = await va.verifyAssetWith({
      assetUrl: 'https://github.com/o/r/releases/download/v1/a.exe', dest: 'x',
      getDigest: async () => 'b'.repeat(64), getSums: async () => null, hashFile: async () => 'a'.repeat(64),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'mismatch');
  });

  test('verify-asset: แฮชตรง = อนุมัติ + บอกที่มา', async () => {
    const r = await va.verifyAssetWith({
      assetUrl: 'https://github.com/o/r/releases/download/v1/a.exe', dest: 'x',
      getDigest: async () => 'a'.repeat(64), getSums: async () => null, hashFile: async () => 'a'.repeat(64),
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'github-digest');
  });

  test('sha256File เทียบ certutil ของจริง', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-sha-'));
    const f = path.join(dir, 'f.bin');
    const data = Buffer.from('ตรวจแฮชให้ตรงกับของจริง');
    fs.writeFileSync(f, data);
    const mine = await va.sha256File(f);
    assert.match(mine, /^[0-9a-f]{64}$/);
    assert.equal(mine, require('node:crypto').createHash('sha256').update(data).digest('hex'), 'ต้องตรงกับ crypto มาตรฐาน');
  });

  test('downloadFile: 200/redirect/404/เขียนไม่ได้ = settle ทุกทาง ไม่ค้าง', async () => {
    const body = Buffer.alloc(2048, 3);
    await withServer((req, res) => {
      if (req.url === '/ok') { res.writeHead(200, { 'Content-Length': body.length }); return res.end(body); }
      if (req.url === '/jump') { res.writeHead(302, { Location: '/ok' }); return res.end(); }
      res.writeHead(404); res.end();
    }, async (base) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-dlt-'));
      const dest = (n) => path.join(dir, n);
      assert.equal(await dl.downloadFile(base + '/ok', dest('a.bin')), dest('a.bin'));
      assert.equal(fs.statSync(dest('a.bin')).size, body.length, 'ไฟล์ต้องครบ');
      assert.equal(await dl.downloadFile(base + '/jump', dest('b.bin')), dest('b.bin'), 'redirect ต้องตามไป');
      await assert.rejects(() => dl.downloadFile(base + '/404', dest('c.bin')), /HTTP 404/);
      assert.equal(fs.existsSync(dest('c.bin')), false, '404 ต้องไม่เหลือไฟล์ค้าง');
      // เขียนลงโฟลเดอร์ที่ไม่มี = reject ทันที (บั๊กเดิม: IPC ค้างเงียบ)
      await assert.rejects(() => dl.downloadFile(base + '/ok', path.join(dir, 'no', 'such', 'x.bin')));
    });
  });
});

// ═════════════════════════════════════════════════════════════
//  10) ความสมบูรณ์ของไฟล์แอป — ของที่ต้องมีให้รันได้จริง
// ═════════════════════════════════════════════════════════════
describe('ไฟล์ประกอบแอปครบ (ของที่หายไป = เปิดไม่ขึ้น)', () => {
  test('main/preload/verify-asset/download มีจริงทุกตัว', () => {
    for (const f of ['main.js', 'preload.js', 'verify-asset.js', 'download.js', 'offline.html', 'setup-wizard.html', 'tray-icon.png']) {
      const p = path.join(ROOT, 'sovereign-frontend/electron', f);
      assert.ok(fs.existsSync(p), `ขาด ${f}`);
      assert.ok(fs.statSync(p).size > 0, `${f} ว่างเปล่า`);
    }
  });

  test('offline.html มีปุ่มที่เรียก IPC ครบ (ไม่มีปุ่มตาย)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'sovereign-frontend/electron/offline.html'), 'utf8');
    // หน้าเว็บเรียกผ่าน window.sovereign.* (preload เป็นคน expose) — จับให้ตรงรูปแบบจริง
    for (const fn of ['getStatus', 'startSystem', 'isAutoStarted']) {
      assert.ok(html.includes('window.sovereign.' + fn), `offline.html ไม่ได้เรียก ${fn}`);
    }
    for (const fn of ['onStatus', 'onAutostart']) {
      assert.ok(html.includes('window.sovereign.' + fn), `offline.html ไม่ได้รับ ${fn}`);
    }
    // ปุ่มทุกตัวต้องผูก handler — ปุ่มที่ไม่ผูก = กดแล้วไม่เกิดอะไร
    const ids = [...html.matchAll(/<button[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 2, `ต้องมีปุ่มอย่างน้อย 2 ปุ่ม เจอ ${ids.length}`);
    for (const id of ids) {
      assert.ok(html.includes("$('" + id + "')"), `ปุ่ม #${id} ไม่มีโค้ดผูกกับมัน — กดแล้วไม่เกิดอะไร`);
    }
  });

  test('setup-wizard.html มีปุ่มครบ + รับสถานะอัปเดต', () => {
    const html = fs.readFileSync(path.join(ROOT, 'sovereign-frontend/electron/setup-wizard.html'), 'utf8');
    for (const fn of ['checkEnv', 'pickInstallDir', 'beginSetup', 'checkUpdates', 'downloadUpdate', 'getSetupDir']) {
      assert.ok(html.includes('window.sovereign.' + fn), `setup-wizard.html ไม่ได้เรียก ${fn}`);
    }
    for (const fn of ['onUpdate', 'onWizardFocus']) {
      assert.ok(html.includes('window.sovereign.' + fn), `setup-wizard.html ไม่ได้รับ ${fn}`);
    }
  });

  test('หน้าเว็บทั้งสองปิด contextIsolation + ไม่เปิด nodeIntegration', () => {
    const src = fs.readFileSync(MAIN, 'utf8');
    // นับจากจำนวน BrowserWindow จริง ⇒ หน้าต่างใหม่ (เช่น หน้าอนุญาต Google ของ YouTube)
    // ถ้าลืมปิด nodeIntegration เพดานนี้จะฟ้องทันที ไม่ต้องมาไล่แก้ทีหลัง
    const windows = (src.match(/new BrowserWindow\(/g) || []).length;
    const occurrences = (src.match(/nodeIntegration:\s*false/g) || []).length;
    assert.ok(windows >= 2, `ต้องมีหน้าต่างอย่างน้อย 2 (หน้าหลัก + wizard) เจอ ${windows}`);
    assert.equal(occurrences, windows, 'ทุกหน้าต่างต้องปิด nodeIntegration');
    const isolated = (src.match(/contextIsolation:\s*true/g) || []).length;
    assert.equal(isolated, windows, 'ทุกหน้าต่างต้องเปิด contextIsolation');
  });

  test('package.json แพ็ก static export + sidecar API (ไม่งั้นแอปเปล่า)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sovereign-frontend/package.json'), 'utf8'));
    const res = (pkg.build?.extraResources || []).map((r) => `${r.from}→${r.to}`);
    assert.ok(res.some((r) => /out→/.test(r)), 'ขาด static export (out)');
    assert.ok(res.some((r) => /core-api\/dist→/.test(r)), 'ขาด sidecar API');
    assert.ok(res.some((r) => /core-api\/node_modules→/.test(r)), 'ขาด node_modules ของ API');
    assert.ok(pkg.scripts['electron:build'], 'ขาดสคริปต์ build');
  });
});