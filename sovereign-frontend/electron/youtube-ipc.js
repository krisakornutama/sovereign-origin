// electron/youtube-ipc.js
// ────────────────────────────────────────────────────────────────────────────
// IPC ของฟีเจอร์ "อัปโหลดขึ้น YouTube อัตโนมัติ" (โหมด B)
//
// แยกออกมาจาก main.js เพราะ
//   1) main.js เป็น shell กลางที่ทุกอย่างพึ่งพา — ยาวเกิน 800 บรรทัดเมื่อไร quality gate พัง
//   2) การรับ electron API เข้ามาทางพารามิเตอร์ (ไม่ require('electron') เอง)
//      ทำให้เทสต์ Node เรียกได้ด้วยของปลอม → flow ทั้งเส้นถูกตรึงด้วยเทสต์จริง
//      (ดู tools/test/youtube-ipc.test.mjs)
//
// ⚠ กติกาความปลอดภัยที่ห้ามละเมิด
//   - client secret / refresh token อยู่แต่ใน main process + safeStorage (Windows DPAPI)
//     ห้ามส่งค่าลับกลับไปให้ renderer เด็ดขาด (ส่งกลับได้แค่ "มี/ไม่มี" กับ hint ที่ปิดบางส่วน)
//   - ไฟล์: %APPDATA%\Sovereign OS\youtube-oauth.bin
//     นี่คือที่เก็บมาตรฐานของแอปเดสก์ท็อป ไม่ใช่การคัดลอกตัวโปรเจ็กไปไดรฟ์ C
// ────────────────────────────────────────────────────────────────────────────
'use strict';

const path = require('path');
const fs = require('fs');
const yt = require('./youtube');

/**
 * @param {object} deps
 * @param {object} deps.ipcMain     - electron.ipcMain
 * @param {object} deps.app         - electron.app (ใช้ app.getPath('userData'))
 * @param {object} deps.dialog      - electron.dialog
 * @param {object} deps.shell       - electron.shell
 * @param {object} deps.safeStorage - electron.safeStorage
 * @param {() => object|null} deps.getWin - คืน BrowserWindow ปัจจุบัน (อาจถูกปิดไปแล้ว)
 * @param {(...a:any[])=>void} [deps.log] - ตัวเขียน log ของ shell
 */
function registerYouTubeIpc({ ipcMain, app, dialog, shell, safeStorage, getWin, log }) {
  const dlog = typeof log === 'function' ? log : () => {};

  let cache = null;      // credential ที่โหลดแล้ว (null = ยังไม่โหลด)
  let connecting = false; // กันกดเชื่อมต่อซ้อนกันสองรอบ (loopback จะชนกัน)
  let abort = false;      // ธงยกเลิกการอัปโหลด

  function secure() { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } }

  function storePath() { return path.join(app.getPath('userData'), 'youtube-oauth.bin'); }

  function store() {
    return yt.makeStore({
      filePath: storePath(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(Buffer.from(b)),
    });
  }

  function creds() {
    if (cache === null) cache = secure() ? (store().load() || {}) : {};
    return cache;
  }

  function persist(next) {
    cache = next || {};
    if (!secure()) return false;
    try { return store().save(cache); } catch (e) { dlog('youtube: บันทึก credential ไม่สำเร็จ', e && e.message); return false; }
  }

  function send(channel, payload) {
    try {
      const w = getWin();
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    } catch { /* หน้าต่างปิดไปแล้ว — ไม่ใช่เรื่องต้องกังวล */ }
  }

  function applyClient(text) {
    const p = yt.parseClientSecretFile(String(text || ''));
    if (!p.ok) return p;
    if (!secure()) return { ok: false, message: 'Windows ยังไม่พร้อมใช้การเข้ารหัส — จึงยังไม่เก็บความลับให้' };
    persist({ ...creds(), clientId: p.clientId, clientSecret: p.clientSecret });
    return { ok: true, clientHint: p.clientId.slice(0, 24) + '...' };
  }

  // ── สถานะ: บอกแค่ "มี/ไม่มี" + hint — ห้ามคายค่าลับออกไป ──
  ipcMain.handle('sovereign:youtubeStatus', () => {
    const c = creds();
    return {
      ok: true,
      secure: secure(),
      hasClient: Boolean(c.clientId && c.clientSecret),
      connected: Boolean(c.refreshToken),
      channelTitle: c.channelTitle || '',
      clientHint: c.clientId ? c.clientId.slice(0, 24) + '...' : '',
      freePerDay: yt.FREE_UPLOADS_PER_DAY,
    };
  });

  ipcMain.handle('sovereign:youtubeImportDialog', async () => {
    const r = await dialog.showOpenDialog(getWin(), {
      properties: ['openFile'],
      filters: [{ name: 'Google client JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, cancelled: true };
    try { return applyClient(fs.readFileSync(r.filePaths[0], 'utf8')); }
    catch (e) { return { ok: false, message: 'อ่านไฟล์ไม่ได้: ' + (e && e.message) }; }
  });

  ipcMain.handle('sovereign:youtubeImportText', (_e, text) => applyClient(text));

  ipcMain.handle('sovereign:youtubeConnect', async () => {
    if (connecting) return { ok: false, message: 'กำลังเชื่อมต่ออยู่แล้ว — รอให้เสร็จก่อน' };
    const c = creds();
    if (!c.clientId || !c.clientSecret) return { ok: false, message: yt.MSG.noClient };
    if (!secure()) return { ok: false, message: 'Windows ยังไม่พร้อมใช้การเข้ารหัส — จึงไม่เก็บความลับให้' };
    connecting = true;
    let srv = null;
    try {
      const pkce = yt.makePkce();
      const state = yt.makeState();
      let settle;
      const got = new Promise((resolve) => { settle = resolve; });

      srv = await yt.startLoopback({ onResult: (u) => settle(u), timeoutMs: 300000 });
      await shell.openExternal(yt.buildAuthUrl({
        clientId: c.clientId, redirectUri: srv.redirectUri, state, codeChallenge: pkce.challenge,
      }));

      const url = await got;
      if (!url) return { ok: false, message: 'รอ 5 นาทีแล้วยังไม่ได้รับการอนุญาต — กดเชื่อมต่อใหม่ได้เลย' };
      const parsed = yt.parseRedirect(url, state);
      if (!parsed.ok) return parsed;

      const tok = await yt.exchangeCode({
        clientId: c.clientId, clientSecret: c.clientSecret, code: parsed.code,
        redirectUri: srv.redirectUri, codeVerifier: pkce.verifier,
      });
      if (!tok.ok) return tok;

      const ch = await yt.fetchChannel({ accessToken: tok.accessToken });
      // ⚠ Google ส่ง refresh_token มาแค่ครั้งแรก — รอบต่อ ๆ ไปต้องคงของเดิมไว้ ห้ามทับด้วย null
      persist({
        ...c,
        refreshToken: tok.refreshToken || c.refreshToken,
        accessToken: tok.accessToken,
        expiresAt: tok.expiresAt,
        channelTitle: ch.ok ? ch.title : (c.channelTitle || ''),
      });
      return { ok: true, channelTitle: ch.ok ? ch.title : '(ไม่ทราบชื่อช่อง)' };
    } catch (e) {
      return { ok: false, message: 'เชื่อมต่อไม่สำเร็จ: ' + (e && e.message) };
    } finally {
      if (srv) { try { srv.close(); } catch { /* ปิดไม่ได้ก็ช่างมัน */ } }
      connecting = false;
    }
  });

  ipcMain.handle('sovereign:youtubeDisconnect', () => {
    cache = {};
    try { store().clear(); } catch { /* ไม่มีไฟล์ก็ไม่เป็นไร */ }
    return { ok: true };
  });

  ipcMain.handle('sovereign:youtubeCancel', () => { abort = true; return { ok: true }; });

  ipcMain.handle('sovereign:youtubeUpload', async (_e, req) => {
    const c = creds();
    if (!c.refreshToken) return { ok: false, message: yt.MSG.notConnected };
    const filePath = req && req.filePath;
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { return { ok: false, message: yt.MSG.fileMissing }; }

    // ต่ออายุก่อนหมดอายุ 1 นาที — คลิปยาวใช้เวลาอัปโหลดนานกว่าอายุของ access token
    let at = c.accessToken;
    if (!at || !c.expiresAt || c.expiresAt < Date.now() + 60000) {
      const r = await yt.refreshAccessToken({ clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken });
      if (!r.ok) return r;
      at = r.accessToken;
      persist({ ...c, accessToken: at, expiresAt: r.expiresAt });
    }

    const desc = String((req && req.description) || '');
    const metadata = yt.buildVideoMetadata({
      title: (req && req.title) || '',
      description: desc,
      tags: yt.extractHashtags(desc),
      privacyStatus: (req && req.privacy) || yt.DEFAULT_PRIVACY,
      madeForKids: false,
    });

    abort = false;
    const res = await yt.uploadVideo({
      accessToken: at, filePath, size, metadata,
      onProgress: (p) => send('sovereign:youtubeProgress', p),
      shouldAbort: () => abort,
    });
    send('sovereign:youtubeProgress', { done: true, ok: res.ok });
    return res;
  });
}

module.exports = { registerYouTubeIpc };
