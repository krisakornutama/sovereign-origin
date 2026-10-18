// tools/test/youtube-ipc.test.mjs
//
// ── เทสต์: IPC ของ "อัปโหลดขึ้น YouTube" (electron/youtube-ipc.js) ──
//
// ทำไมต้องมีเทสต์ชุดนี้ (ทั้งที่ youtube.js มีเทสต์อยู่แล้ว)
//   1) เทสต์ของ youtube.js คุม "กลไก" (OAuth/upload) แต่ไม่ได้คุม "การต่อสาย"
//      ต่อสายผิด = กดแล้วเงียบ หรือแย่กว่านั้นคือ "คายความลับออกไปที่ renderer"
//   2) ⭐ ข้อที่ห้ามพลาด: youtubeStatus ต้องไม่ส่ง client secret ออกไปเด็ดขาด
//      (renderer = หน้าเว็บที่โหลดจาก localhost:3000 — ถ้าหลุด เท่ากับความลับอยู่บนหน้าเว็บ)
//   3) ⭐ refresh_token ห้ามถูกลบตอนต่ออายุ — หลุดเมื่อไรเจ้าของต้องไปนั่งกดอนุญาตใหม่ทั้งขั้นตอน
//
// ⚠ เทสต์ชุดนี้ไม่ต่อเน็ต และไม่เปิดเบราว์เซอร์เลย: ฟังก์ชันของ youtube.js ที่ต้องใช้เน็ต
//   ถูกแทนที่ด้วยของปลอม (CommonJS แชร์อ็อบเจ็กต์โมดูลเดียวกัน ⇒ แทนที่แล้ว youtube-ipc เห็นของปลอมทันที)
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EL = path.join(ROOT, 'sovereign-frontend', 'electron');

const yt = require(path.join(EL, 'youtube.js'));
const { registerYouTubeIpc } = require(path.join(EL, 'youtube-ipc.js'));

const CLIENT_ID = '40987354946-abcdefg.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-ความลับที่สุดห้ามหลุด';
const CLIENT_JSON = JSON.stringify({ installed: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET } });

const ORIGINALS = { ...yt };
let dir;
let progressSeen;
let openedUrls;
let externalUrls;
let consentClosed;
/** ตัวรับผลลัพธ์ของ loopback ที่ startLoopback ปลอมสร้างไว้ (ให้เทสต์ยิง code กลับเข้าไปเองได้) */
let pendingSrv = null;

/** รอให้ startLoopback ถูกเรียก แล้วคืนฟังก์ชันป้อนผลลัพธ์กลับ */
async function waitSrv() {
  for (let i = 0; i < 50 && !pendingSrv; i++) await new Promise((r) => setImmediate(r));
  const s = pendingSrv;
  pendingSrv = null;
  assert.ok(s, 'startLoopback ไม่ถูกเรียก');
  return s;
}

/**
 * ของปลอมของ Electron — ไม่มีตัวไหนแตะดิสก์จริง/เน็ตจริง
 * @param {object} [opts]
 * @param {string} [opts.embeddedDir] - โฟลเดอร์จำลอง "credential ที่ฝังมากับแอป"
 *        ดีฟอลต์ = โฟลเดอร์เปล่า เพื่อไม่ให้ผลเทสต์ขึ้นกับไฟล์จริงบนเครื่อง
 */
function boot({ secure = true, winAlive = true, embeddedDir, openConsent } = {}) {
  const handlers = new Map();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytipc-'));
  progressSeen = [];
  openedUrls = [];
  externalUrls = [];
  consentClosed = [];
  pendingSrv = null;

  const win = winAlive
    ? { isDestroyed: () => false, webContents: { send: (ch, p) => progressSeen.push({ ch, p }) } }
    : { isDestroyed: () => true, webContents: { send: () => { throw new Error('หน้าต่างถูกทำลายแล้ว'); } } };

  registerYouTubeIpc({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    app: { getPath: () => dir },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    // ห้ามถูกเรียกอีกแล้ว: การเชื่อมต่อบัญชีต้องอยู่ในหน้าต่างของแอปเท่านั้น
    shell: { openExternal: async (url) => { externalUrls.push(url); } },
    safeStorage: {
      isEncryptionAvailable: () => secure,
      // ต้อง "เข้ารหัสจริง" ในเทสต์ด้วย ไม่งั้นเทสต์ที่ตรวจว่าไฟล์บนดิสก์ไม่มี plaintext จะผ่านแบบหลอก ๆ
      encryptString: (s) => Buffer.from('ENC|' + Buffer.from(s, 'utf8').toString('base64'), 'utf8'),
      decryptString: (b) => Buffer.from(String(b).slice(4), 'base64').toString('utf8'),
    },
    getWin: () => win,
    log: () => {},
    // ของปลอมของหน้าต่างอนุญาตในแอป — เก็บ URL ไว้ให้เทสต์ตรวจ และเก็บว่า "ปิดหน้าต่างตอนจบ" ไหม
    // ส่ง openConsent: null เข้ามาเพื่อจำลอง "แอปเวอร์ชันเก่าที่ไม่มีหน้าต่างในแอป"
    openConsent: openConsent === null
      ? undefined
      : (openConsent || (async (url) => {
        openedUrls.push(url);
        return { close: () => { consentClosed.push(url); } };
      })),
    // โฟลเดอร์ที่ใช้ค้น youtube-client.json (ตัวที่ฝังมากับแอป)
    embeddedDir: embeddedDir === undefined ? path.join(dir, 'no-embedded') : embeddedDir,
  });

  const call = (name, ...args) => {
    const h = handlers.get(name);
    assert.ok(h, `ไม่พบ handler ${name}`);
    return h({}, ...args);
  };
  return { call, handlers, win };
}

beforeEach(() => { for (const k of Object.keys(yt)) if (typeof ORIGINALS[k] === 'function') yt[k] = ORIGINALS[k]; });
afterEach(() => { for (const k of Object.keys(ORIGINALS)) yt[k] = ORIGINALS[k]; });

const okJson = (obj) => ({ status: 200, headers: {}, text: JSON.stringify(obj) });

describe('youtubeStatus — ด่านกันความลับรั่ว', () => {
  test('เริ่มต้น: ยังไม่มี client และยังไม่เชื่อมต่อ', async () => {
    const { call } = boot();
    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.ok, true);
    assert.equal(s.hasClient, false);
    assert.equal(s.connected, false);
    assert.equal(s.secure, true);
  });

  test('⭐ หลังนำเข้า client แล้ว status ต้อง "ไม่" มี client secret อยู่ในคำตอบเด็ดขาด', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.hasClient, true, 'ต้องรู้ว่ามี client แล้ว');
    const dump = JSON.stringify(s);
    assert.ok(!dump.includes(CLIENT_SECRET), '❌ รั่ว client secret ออกไปที่ renderer');
    assert.ok(!dump.includes('GOCSPX'), '❌ รั่ว client secret ออกไปที่ renderer');
    assert.ok(s.clientHint.includes('...'), 'ให้ได้แค่ hint ที่ปิดบางส่วน');
  });

  test('⭐ หลังเชื่อมต่อแล้ว status ต้องไม่มี refresh/access token หลุดออกไป', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 1, redirectUri: 'http://127.0.0.1:1', close: () => {} }; };
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT-ลับ', refreshToken: 'RT-ลับที่สุด', expiresAt: Date.now() + 3600e3 });
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องของฉัน' });
    // ยิงให้ loopback "ตอบกลับ" ด้วย code ที่ถูกต้อง (ต้องดึง state จริงจาก URL ที่ขอ)
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=C1&state=' + new URL(openedUrls[openedUrls.length - 1]).searchParams.get('state'));
    const done = await p;
    assert.equal(done.ok, true);

    const s = await call('sovereign:youtubeStatus');
    const dump = JSON.stringify(s);
    assert.ok(!dump.includes('RT-ลับที่สุด'), '❌ รั่ว refresh token');
    assert.ok(!dump.includes('AT-ลับ'), '❌ รั่ว access token');
    assert.equal(s.connected, true);
    assert.equal(s.channelTitle, 'ช่องของฉัน');
  });

  test('safeStorage ใช้ไม่ได้ → status บอกตรง ๆ ว่า secure=false (ไม่โกหก)', async () => {
    const { call } = boot({ secure: false });
    assert.equal((await call('sovereign:youtubeStatus')).secure, false);
  });
});

describe('นำเข้า client JSON', () => {
  test('JSON ที่ถูกต้อง → บันทึกสำเร็จ + คืน hint', async () => {
    const { call } = boot();
    const r = await call('sovereign:youtubeImportText', CLIENT_JSON);
    assert.equal(r.ok, true);
    assert.ok(r.clientHint.startsWith('40987354946-'));
  });

  test('JSON เสีย → ปฏิเสธพร้อมข้อความไทย ไม่ throw', async () => {
    const { call } = boot();
    const r = await call('sovereign:youtubeImportText', '{ไม่ใช่ json');
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });

  test('client_id ที่ไม่ใช่ของ Google → ปฏิเสธ', async () => {
    const { call } = boot();
    const r = await call('sovereign:youtubeImportText', JSON.stringify({ installed: { client_id: 'evil.com', client_secret: 'x' } }));
    assert.equal(r.ok, false);
  });

  test('safeStorage ใช้ไม่ได้ → ปฏิเสธ ไม่ยอมเก็บความลับแบบไม่เข้ารหัส', async () => {
    const { call } = boot({ secure: false });
    const r = await call('sovereign:youtubeImportText', CLIENT_JSON);
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });

  test('ผู้ใช้กดยกเลิกใน file dialog → cancelled:true (ไม่ใช่ error)', async () => {
    const { call } = boot();
    assert.deepEqual(await call('sovereign:youtubeImportDialog'), { ok: false, cancelled: true });
  });

  test('⭐ ความลับบนดิสก์ต้องถูกเข้ารหัส ไม่ใช่ข้อความธรรมดา', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1, `ควรมีไฟล์เดียว ได้: ${files.join(',')}`);
    const raw = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    assert.ok(!raw.includes(CLIENT_SECRET), '❌ client secret ถูกเขียนลงดิสก์แบบไม่เข้ารหัส');
    assert.ok(raw.startsWith('ENC|'), 'ต้องผ่าน safeStorage');
  });
});

describe('youtubeConnect', () => {
  test('ยังไม่ได้ใส่ client → บอกให้ไปนำเข้าไฟล์ก่อน', async () => {
    const { call } = boot();
    const r = await call('sovereign:youtubeConnect');
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
    assert.equal(openedUrls.length, 0, 'ไม่ควรเปิดเบราว์เซอร์เลย');
  });

  test('เสียบ flow ครบเส้น: เปิดเบราว์เซอร์ → รับ code → แลก token → เก็บ refresh_token', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    let exchanged = null;
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 55, redirectUri: 'http://127.0.0.1:55', close: () => {} };
    };
    yt.exchangeCode = async (o) => { exchanged = o; return { ok: true, accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600e3 }; };
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องทดสอบ' });

    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const auth = new URL(openedUrls[0]);
    assert.equal(auth.searchParams.get('redirect_uri'), 'http://127.0.0.1:55');
    assert.ok(auth.searchParams.get('code_challenge'), 'ต้องใช้ PKCE');
    const srv = await waitSrv();
    srv(`/?code=CODE1&state=${auth.searchParams.get('state')}`);
    const r = await p;

    assert.equal(r.ok, true);
    assert.equal(r.channelTitle, 'ช่องทดสอบ');
    assert.equal(exchanged.code, 'CODE1');
    assert.equal(exchanged.redirectUri, 'http://127.0.0.1:55');
    assert.ok(exchanged.codeVerifier, 'ต้องส่ง code_verifier ไปด้วย');
    assert.equal((await call('sovereign:youtubeStatus')).connected, true);
  });

  test('⭐ state ไม่ตรง → ปฏิเสธและ "ไม่" แลก token (กัน callback ปลอม)', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    let called = false;
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 56, redirectUri: 'http://127.0.0.1:56', close: () => {} }; };
    yt.exchangeCode = async () => { called = true; return { ok: true, accessToken: 'AT', refreshToken: 'RT' }; };

    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=CODE1&state=ปลอม');
    const r = await p;

    assert.equal(r.ok, false);
    assert.equal(called, false, 'ห้ามแลก token จาก callback ที่ state ไม่ตรง');
    assert.equal((await call('sovereign:youtubeStatus')).connected, false);
  });

  test('ผู้ใช้กดปฏิเสธในหน้า Google → ไม่เชื่อมต่อ และไม่เก็บอะไร', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 57, redirectUri: 'http://127.0.0.1:57', close: () => {} }; };
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?error=access_denied');
    const r = await p;
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
    assert.equal((await call('sovereign:youtubeStatus')).connected, false);
  });

  test('หมดเวลา (ไม่มีใครตอบ) → ข้อความบอกให้ลองใหม่ + ปิด server ทิ้ง', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    let closed = false;
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 58, redirectUri: 'http://127.0.0.1:58', close: () => { closed = true; } };
    };
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv(null); // = timeout
    const r = await p;
    assert.equal(r.ok, false);
    assert.match(r.message, /5 นาที/);
    assert.equal(closed, true, 'ต้องปิด loopback ทิ้งเสมอ (ไม่ให้ port ค้าง)');
  });

  test('Google ตอบ error ตอนแลก token → ส่งข้อความไทยต่อ ไม่เก็บ token', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 59, redirectUri: 'http://127.0.0.1:59', close: () => {} }; };
    yt.exchangeCode = async () => ({ ok: false, code: 'auth', message: 'สิทธิ์การเชื่อมต่อหมดอายุ — กรุณากดเชื่อมต่อ YouTube ใหม่' });
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=X&state=' + new URL(openedUrls[0]).searchParams.get('state'));
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal((await call('sovereign:youtubeStatus')).connected, false);
  });

  test('error ที่ไม่คาดคิด → คืนข้อความไทย ไม่ throw ออกมาทำให้แอปพัง', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async () => { throw new Error('พอร์ตชน'); };
    const r = await call('sovereign:youtubeConnect');
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });

  test('⭐ เชื่อมต่อ "ซ้ำ" แล้ว Google ไม่ส่ง refresh_token มา → ต้องคงของเดิมไว้ ไม่ใช่หายเกลี้ยง', async () => {
    // เกิดจริงเสมอ: Google ส่ง refresh_token ให้เฉพาะครั้งแรกที่อนุญาต
    // ถ้าจุดนี้พลาด เจ้าของที่เผลอกด "เชื่อมต่อ" อีกครั้งจะหลุดการเชื่อมต่อทันที
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 64, redirectUri: 'http://127.0.0.1:64', close: () => {} }; };
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องเดิม' });

    // รอบแรก — ได้ refresh_token ตามปกติ
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT-1', refreshToken: 'RT-เดิม', expiresAt: Date.now() + 3600e3 });
    const p1 = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    (await waitSrv())('/?code=C1&state=' + new URL(openedUrls[openedUrls.length - 1]).searchParams.get('state'));
    assert.equal((await p1).ok, true);
    assert.equal((await call('sovereign:youtubeStatus')).connected, true);

    // รอบสอง — Google ไม่ส่ง refresh_token กลับมา (พฤติกรรมปกติ)
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT-2', refreshToken: null, expiresAt: Date.now() + 3600e3 });
    const p2 = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    (await waitSrv())('/?code=C2&state=' + new URL(openedUrls[openedUrls.length - 1]).searchParams.get('state'));
    assert.equal((await p2).ok, true);

    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.connected, true, '❌ refresh token ถูกทับด้วย null หลังเชื่อมต่อซ้ำ');
    assert.equal(s.channelTitle, 'ช่องเดิม', 'ชื่อช่องต้องคงอยู่');
  });
});

describe('youtubeUpload', () => {
  const mkFile = (size = 1000) => {
    const f = path.join(dir, 'clip.mp4');
    fs.writeFileSync(f, Buffer.alloc(size, 1));
    return f;
  };
  const connected = async (call) => {
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 60, redirectUri: 'http://127.0.0.1:60', close: () => {} }; };
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT-1', refreshToken: 'RT-1', expiresAt: Date.now() + 3600e3 });
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องทดสอบ' });
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(openedUrls[openedUrls.length - 1]).searchParams.get('state'));
    await p;
  };

  test('ยังไม่เชื่อมต่อ → บอกตรง ๆ ไม่พยายามอัปโหลด', async () => {
    const { call } = boot();
    let tried = false;
    yt.uploadVideo = async () => { tried = true; return { ok: true }; };
    const r = await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x' });
    assert.equal(r.ok, false);
    assert.equal(tried, false);
  });

  test('ไฟล์หาย → ไม่ยิง request เลย', async () => {
    const { call } = boot();
    await connected(call);
    let tried = false;
    yt.uploadVideo = async () => { tried = true; return { ok: true }; };
    const r = await call('sovereign:youtubeUpload', { filePath: path.join(dir, 'ไม่มี.mp4'), title: 'x' });
    assert.equal(r.ok, false);
    assert.equal(tried, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });

  test('อัปโหลดสำเร็จ → ส่ง metadata ที่ถูกต้อง + รายงานความคืบหน้า + แจ้งจบ', async () => {
    const { call } = boot();
    await connected(call);
    let got = null;
    yt.uploadVideo = async (o) => {
      got = o;
      o.onProgress({ sent: 500, total: 1000 });
      o.onProgress({ sent: 1000, total: 1000 });
      return { ok: true, videoId: 'VID1', bytes: 1000 };
    };
    const f = mkFile(1000);
    const r = await call('sovereign:youtubeUpload', { filePath: f, title: 'สินค้าใหม่', description: 'รายละเอียด #หม้อทอด', privacy: 'public' });

    assert.equal(r.ok, true);
    assert.equal(r.videoId, 'VID1');
    assert.equal(got.size, 1000);
    assert.equal(got.metadata.snippet.title, 'สินค้าใหม่');
    assert.equal(got.metadata.status.privacyStatus, 'public');
    assert.deepEqual(got.metadata.snippet.tags, ['หม้อทอด'], 'ต้องดึงแฮชแท็กไทยเป็น tags ได้');
    const prog = progressSeen.filter((p) => p.ch === 'sovereign:youtubeProgress');
    assert.ok(prog.some((p) => p.p.sent === 500), 'ต้องส่งความคืบหน้าระหว่างทาง');
    assert.ok(prog.some((p) => p.p.done === true), 'ต้องแจ้งจุดจบ');
  });

  test('privacy ที่ไม่รู้จัก → ถูกบังคับเป็น private (ห้ามหลุดเป็น public เอง)', async () => {
    const { call } = boot();
    await connected(call);
    let got = null;
    yt.uploadVideo = async (o) => { got = o; return { ok: true, videoId: 'V' }; };
    await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x', privacy: 'PUBLIC!!' });
    assert.equal(got.metadata.status.privacyStatus, 'private');
  });

  test('access token หมดอายุ → ต่ออายุให้อัตโนมัติก่อนอัปโหลด', async () => {
    const { call } = boot();
    await connected(call);
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 61, redirectUri: 'http://127.0.0.1:61', close: () => {} }; };
    // ต่ออายุครั้งแรกให้ access token ที่ "หมดอายุแล้ว" → รอบอัปโหลดต้องขอใหม่
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT-เก่า', refreshToken: 'RT-1', expiresAt: Date.now() - 1 });
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(openedUrls[openedUrls.length - 1]).searchParams.get('state'));
    await p;

    let refreshed = 0;
    yt.refreshAccessToken = async () => { refreshed++; return { ok: true, accessToken: 'AT-ใหม่', refreshToken: null, expiresAt: Date.now() + 3600e3 }; };
    let usedToken = null;
    yt.uploadVideo = async (o) => { usedToken = o.accessToken; return { ok: true, videoId: 'V' }; };

    const r = await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x' });
    assert.equal(r.ok, true);
    assert.equal(refreshed, 1);
    assert.equal(usedToken, 'AT-ใหม่');
  });

  test('⭐ ต่ออายุแล้ว Google ไม่ส่ง refresh_token มา → ต้อง "ไม่" ทับของเดิมด้วย null', async () => {
    // เคสนี้เกิดขึ้นจริงทุกครั้งหลังการเชื่อมต่อครั้งแรก: Google ส่ง refresh_token มาแค่ครั้งเดียว
    // ถ้าพลาดข้อนี้ เจ้าของจะถูกบังคับให้กดอนุญาตใหม่ทุกครั้งที่อัปโหลด
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 62, redirectUri: 'http://127.0.0.1:62', close: () => {} }; };
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT-เก่า', refreshToken: 'RT-สำคัญมาก', expiresAt: Date.now() - 1 });
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องทดสอบ' });
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(openedUrls[openedUrls.length - 1]).searchParams.get('state'));
    await p;

    yt.refreshAccessToken = async () => ({ ok: true, accessToken: 'AT-ใหม่', refreshToken: null, expiresAt: Date.now() + 3600e3 });
    yt.uploadVideo = async () => ({ ok: true, videoId: 'V' });
    const r = await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x' });

    assert.equal(r.ok, true);
    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.connected, true, '❌ refresh token ถูกทับด้วย null — จะต้องกดอนุญาตใหม่ทุกรอบ');
    assert.equal(s.channelTitle, 'ช่องทดสอบ', 'ชื่อช่องต้องไม่หายไปตอนต่ออายุ');
  });

  test('ต่ออายุไม่สำเร็จ (สิทธิ์หมดอายุ) → คืนข้อความไทย ไม่พยายามอัปโหลด', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    // เชื่อมต่อด้วย access token ที่ "หมดอายุแล้ว" → รอบอัปโหลดต้องพยายามต่ออายุ
    yt.startLoopback = async ({ onResult }) => { pendingSrv = onResult; return { port: 63, redirectUri: 'http://127.0.0.1:63', close: () => {} }; };
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT-เก่า', refreshToken: 'RT-1', expiresAt: Date.now() - 1 });
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องทดสอบ' });
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(openedUrls[openedUrls.length - 1]).searchParams.get('state'));
    await p;

    let refreshed = 0;
    yt.refreshAccessToken = async () => { refreshed++; return { ok: false, code: 'auth', message: 'สิทธิ์การเชื่อมต่อหมดอายุ — กรุณากดเชื่อมต่อ YouTube ใหม่' }; };
    let tried = false;
    yt.uploadVideo = async () => { tried = true; return { ok: true }; };

    const r = await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x' });
    assert.equal(refreshed, 1, 'ต้องพยายามต่ออายุหนึ่งครั้ง');
    assert.equal(r.ok, false);
    assert.equal(tried, false, 'ต่ออายุไม่ผ่านแล้วห้ามอัปโหลดต่อ');
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });

  test('กดยกเลิก "ระหว่าง" อัปโหลด → shouldAbort คืน true ให้ตัวอัปโหลดหยุดเอง', async () => {
    const { call } = boot();
    await connected(call);
    let sawAbort = null;
    yt.uploadVideo = async (o) => {
      // จำลองว่าผู้ใช้กดยกเลิกหลังจากอัปโหลดเริ่มไปแล้ว
      await call('sovereign:youtubeCancel');
      sawAbort = o.shouldAbort();
      return { ok: false, code: 'aborted' };
    };
    const r = await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x' });
    assert.equal(sawAbort, true, 'ธงยกเลิกต้องมีผลระหว่างอัปโหลด');
    assert.equal(r.ok, false);
  });

  test('ยกเลิกรอบก่อนต้องไม่ค้างมาถึงรอบใหม่ (รีเซ็ตธงทุกครั้ง)', async () => {
    const { call } = boot();
    await connected(call);
    await call('sovereign:youtubeCancel');
    yt.uploadVideo = async (o) => ({ ok: true, first: o.shouldAbort() });
    const r = await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x' });
    assert.equal(r.ok, true);
    assert.equal(r.first, false, 'ธงยกเลิกรอบก่อนต้องถูกล้าง');
  });

  test('หน้าต่างถูกปิดระหว่างอัปโหลด → ยังอัปโหลดต่อได้ ไม่ throw', async () => {
    const { call } = boot({ winAlive: false });
    await connected(call);
    yt.uploadVideo = async (o) => { o.onProgress({ sent: 1, total: 2 }); return { ok: true, videoId: 'V' }; };
    const r = await call('sovereign:youtubeUpload', { filePath: mkFile(), title: 'x' });
    assert.equal(r.ok, true);
  });
});

describe('youtubeDisconnect', () => {
  test('ตัดการเชื่อมต่อ → ลบไฟล์ credential และ status กลับเป็นว่าง', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    assert.equal(fs.readdirSync(dir).length, 1);
    const r = await call('sovereign:youtubeDisconnect');
    assert.equal(r.ok, true);
    assert.equal(fs.readdirSync(dir).length, 0, 'ต้องลบไฟล์ credential ทิ้ง');
    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.hasClient, false);
    assert.equal(s.connected, false);
  });

  test('ตัดการเชื่อมต่อตอนที่ยังไม่เคยมีอะไร → ไม่ throw', async () => {
    const { call } = boot();
    assert.equal((await call('sovereign:youtubeDisconnect')).ok, true);
  });

  test('หลังจากตัดแล้ว อัปโหลดต้องไม่ทำงาน', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    await call('sovereign:youtubeDisconnect');
    let tried = false;
    yt.uploadVideo = async () => { tried = true; return { ok: true }; };
    const r = await call('sovereign:youtubeUpload', { filePath: path.join(dir, 'a.mp4'), title: 'x' });
    assert.equal(r.ok, false);
    assert.equal(tried, false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⭐ เจ้าของสั่งชัดเจน (19/10/69):
//    "ให้การเชื่อมต่อบัญชี ผ่านใน Sovereign OS ทั้งหมดเลย อย่าทำด้านนอกเหนือจากนี้"
//    ⇒ หน้าอนุญาตของ Google ต้องเปิด "ในหน้าต่างของแอป" เท่านั้น
//      ห้ามเด้งออกไปเบราว์เซอร์ภายนอก (shell.openExternal) อีก
//    ⇒ ไม่ต้องให้เจ้าของไป import ไฟล์ JSON เอง (credential ฝังมากับแอป)
// เทสต์ชุดนี้คือด่านกันการถอยหลังกลับไปทำแบบเดิม
// ────────────────────────────────────────────────────────────────────────────
describe('เชื่อมต่อบัญชีในแอปเท่านั้น — ห้ามเด้งออกนอกแอป', () => {
  test('⭐ connect เปิดหน้าต่างอนุญาตในแอป และไม่แตะ shell.openExternal เลย', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 77, redirectUri: 'http://127.0.0.1:77', close: () => {} };
    };
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600e3 });
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องในแอป' });

    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    assert.equal(openedUrls.length, 1, 'ต้องเปิดหน้าอนุญาตในแอป 1 ครั้ง');
    assert.equal(externalUrls.length, 0, '❌ ห้ามเด้งออกไปเบราว์เซอร์ภายนอก');
    assert.equal(new URL(openedUrls[0]).searchParams.get('redirect_uri'), 'http://127.0.0.1:77');

    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(openedUrls[0]).searchParams.get('state'));
    const r = await p;
    assert.equal(r.ok, true);
    assert.equal(externalUrls.length, 0, '❌ ห้ามเด้งออกไปเบราว์เซอร์ภายนอกแม้แต่ครั้งเดียว');
    assert.equal(consentClosed.length, 1, 'ต้องปิดหน้าต่างอนุญาตเมื่อจบ');
  });

  test('หน้าต่างอนุญาตต้องถูกปิดแม้ flow ล้ม (state ไม่ตรง)', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 78, redirectUri: 'http://127.0.0.1:78', close: () => {} };
    };
    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    const srv = await waitSrv();
    srv('/?code=C&state=ปลอม');
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(consentClosed.length, 1, 'หน้าต่างค้างบนจอไม่ได้');
  });

  test('⭐ แอปที่ไม่มีช่องทางเปิดหน้าต่างในแอป → ปฏิเสธ ไม่แอบเด้งเบราว์เซอร์นอก', async () => {
    const { call } = boot({ openConsent: null });
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    let loopStarted = false;
    yt.startLoopback = async () => {
      loopStarted = true;
      return { port: 79, redirectUri: 'http://127.0.0.1:79', close: () => {} };
    };
    const r = await call('sovereign:youtubeConnect');
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
    assert.equal(externalUrls.length, 0, '❌ ห้าม fallback ไปเบราว์เซอร์นอก');
    assert.equal(loopStarted, false, 'ไม่มีทางให้ผู้ใช้อนุญาตในแอป → ไม่ต้องเปิด loopback ทิ้งไว้');
  });

  test('ผู้ใช้ปิดหน้าต่างเองก่อนกดอนุญาต → ตอบกลับทันที ไม่ต้องรอครบ 5 นาที', async () => {
    let finishWindow;
    const { call } = boot({
      openConsent: async (url) => {
        openedUrls.push(url);
        const done = new Promise((r) => { finishWindow = r; });
        return { close: () => { consentClosed.push(url); }, done };
      },
    });
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 80, redirectUri: 'http://127.0.0.1:80', close: () => {} };
    };

    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    await waitSrv();
    assert.equal(typeof finishWindow, 'function', 'ต้องส่งสัญญาณ "หน้าต่างปิด" กลับมาได้');
    finishWindow(); // ผู้ใช้กดกากบาท
    const r = await p;
    assert.equal(r.ok, false);
    assert.match(r.message, /ปิดหน้าต่าง/);
    assert.equal(consentClosed.length, 1);
  });

  test('⭐ ทางเลือกสุดท้าย: ส่ง { external: true } → ใช้เบราว์เซอร์นอก และไม่เปิดหน้าต่างในแอป', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 82, redirectUri: 'http://127.0.0.1:82', close: () => {} };
    };
    yt.exchangeCode = async () => ({ ok: true, accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600e3 });
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่อง' });

    const p = call('sovereign:youtubeConnect', { external: true });
    await new Promise((r) => setImmediate(r));
    assert.equal(externalUrls.length, 1, 'ต้องใช้เบราว์เซอร์นอกเฉพาะเมื่อสั่ง external: true');
    assert.equal(openedUrls.length, 0, 'ไม่ควรเปิดหน้าต่างในแอปเมื่อสั่ง external');
    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(externalUrls[0]).searchParams.get('state'));
    assert.equal((await p).ok, true);
  });

  test('ไม่ส่ง opts มาเลย → ยังเป็นหน้าต่างในแอป (ดีฟอลต์ห้ามเปลี่ยน)', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 83, redirectUri: 'http://127.0.0.1:83', close: () => {} };
    };
    yt.exchangeCode = async () => ({ ok: false, message: 'ไม่แลก token ในเทสต์นี้' });

    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    assert.equal(openedUrls.length, 1, 'ดีฟอลต์ต้องเปิดในแอป');
    assert.equal(externalUrls.length, 0, '❌ ดีฟอลต์ห้ามเด้งออกนอกแอป');
    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(openedUrls[0]).searchParams.get('state'));
    await p;
    assert.equal(externalUrls.length, 0);
  });

  test('⭐ Google บล็อกหน้าต่างในแอป → ตอบกลับเร็วพร้อม blocked:true (ไม่ค้าง 5 นาที)', async () => {
    const { call } = boot({
      openConsent: async (url) => {
        openedUrls.push(url);
        return { close: () => {}, done: Promise.resolve({ blocked: true }) };
      },
    });
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 84, redirectUri: 'http://127.0.0.1:84', close: () => {} };
    };
    const r = await call('sovereign:youtubeConnect');
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true, 'UI ต้องรู้ว่าโดนบล็อกเพื่อโชว์ทางเลือกสุดท้าย');
    assert.match(r.message, /may not be secure/);
    assert.equal(externalUrls.length, 0, 'ห้ามเด้งออกเองโดยไม่ได้รับคำสั่ง');
  });
});

describe('credential ที่ฝังมากับแอป — เจ้าของไม่ต้อง import ไฟล์เอง', () => {
  /** สร้างโฟลเดอร์จำลองที่มี youtube-client.json */
  function embDir(content, name = 'youtube-client.json') {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ytemb-'));
    if (content !== null) fs.writeFileSync(path.join(d, name), content, 'utf8');
    return d;
  }

  test('⭐ มีไฟล์ฝังมา → hasClient=true ทันที โดยไม่ต้อง import และไม่เขียนดิสก์', async () => {
    const { call } = boot({ embeddedDir: embDir(CLIENT_JSON) });
    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.hasClient, true);
    assert.equal(s.clientSource, 'embedded');
    assert.equal(s.connected, false);
    const dump = JSON.stringify(s);
    assert.ok(!dump.includes(CLIENT_SECRET), '❌ รั่ว client secret ออกไปที่ renderer');
    assert.ok(!dump.includes('GOCSPX'), '❌ รั่ว client secret ออกไปที่ renderer');
    assert.equal(fs.readdirSync(dir).length, 0, 'ยังไม่เชื่อมต่อ = ต้องไม่เขียนอะไรลง userData');
  });

  test('⭐ กดเชื่อมต่อได้เลยด้วย credential ที่ฝังมา และความลับไม่หลุดลงดิสก์แบบ plaintext', async () => {
    const { call } = boot({ embeddedDir: embDir(CLIENT_JSON) });
    let exchanged = null;
    yt.startLoopback = async ({ onResult }) => {
      pendingSrv = onResult;
      return { port: 81, redirectUri: 'http://127.0.0.1:81', close: () => {} };
    };
    yt.exchangeCode = async (o) => {
      exchanged = o;
      return { ok: true, accessToken: 'AT', refreshToken: 'RT-ยาว', expiresAt: Date.now() + 3600e3 };
    };
    yt.fetchChannel = async () => ({ ok: true, title: 'ช่องจริง' });

    const p = call('sovereign:youtubeConnect');
    await new Promise((r) => setImmediate(r));
    assert.equal(openedUrls.length, 1, 'ต้องเปิดหน้าต่างอนุญาตในแอปได้ทันที');
    const srv = await waitSrv();
    srv('/?code=C&state=' + new URL(openedUrls[0]).searchParams.get('state'));
    const r = await p;

    assert.equal(r.ok, true);
    assert.equal(exchanged.clientId, CLIENT_ID, 'ต้องใช้ client ที่ฝังมา');
    assert.equal(exchanged.clientSecret, CLIENT_SECRET, 'ต้องใช้ secret ที่ฝังมา');
    const raw = fs.readFileSync(path.join(dir, 'youtube-oauth.bin'), 'utf8');
    assert.ok(!raw.includes(CLIENT_SECRET), '❌ เขียน secret ลงดิสก์แบบ plaintext');
    assert.ok(!raw.includes('RT-ยาว'), '❌ เขียน refresh token ลงดิสก์แบบ plaintext');
  });

  test('ไฟล์ฝังมาเสีย → ไม่ throw และตกไปสถานะ "ยังไม่มี client"', async () => {
    const { call } = boot({ embeddedDir: embDir('{ not json') });
    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.ok, true);
    assert.equal(s.hasClient, false);
    assert.equal(s.clientSource, '');
  });

  test('import เองยังใช้ได้ (ทางสำรอง) → clientSource = imported', async () => {
    const { call } = boot();
    await call('sovereign:youtubeImportText', CLIENT_JSON);
    const s = await call('sovereign:youtubeStatus');
    assert.equal(s.hasClient, true);
    assert.equal(s.clientSource, 'imported');
  });

  test('ไม่มีไฟล์ฝังมาและไม่ import → ยังบอกให้ผู้ใช้รู้ว่าต้องทำอะไร (ข้อความไทย)', async () => {
    const { call } = boot();
    const r = await call('sovereign:youtubeConnect');
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });

  test('เครื่องที่ deploy ครบ: ถ้ามี sovereign-frontend/electron/youtube-client.json ต้อง parse ผ่าน', (t) => {
    const p = path.join(EL, 'youtube-client.json');
    if (!fs.existsSync(p)) {
      t.skip('เครื่องนี้ไม่มีไฟล์ credential ที่ฝังมา (gitignored) — ข้าม');
      return;
    }
    const parsed = yt.parseClientSecretFile(fs.readFileSync(p, 'utf8'));
    assert.equal(parsed.ok, true, 'ไฟล์ credential ที่ฝังมาต้องอ่านได้');
    const loaded = yt.loadEmbeddedClient({ dir: EL });
    assert.ok(loaded && loaded.clientId === parsed.clientId, 'loadEmbeddedClient ต้องเจอไฟล์นี้');
    assert.equal(typeof loaded.clientSecret, 'string');
    assert.ok(loaded.clientSecret.length > 8);
  });
});
