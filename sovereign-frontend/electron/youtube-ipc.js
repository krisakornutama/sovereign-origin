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
 * @param {(url: string) => Promise<{close: () => void}>} [deps.openConsent]
 *        เปิดหน้าอนุญาตของ Google "ในหน้าต่างของแอปเอง" แล้วคืนตัวปิด
 *        ⚠ เจ้าของสั่งชัดเจน: การเชื่อมต่อบัญชีต้องเกิดขึ้นใน Sovereign OS ทั้งหมด
 *          ห้ามเด้งออกไปเบราว์เซอร์ภายนอก (shell.openExternal) อีก
 * @param {string} [deps.embeddedDir] - โฟลเดอร์ที่มี youtube-client.json (ดีฟอลต์ = ข้างไฟล์นี้)
 *        เทสต์ส่งโฟลเดอร์เปล่าเข้ามา เพื่อไม่ให้ผลลัพธ์ขึ้นกับไฟล์จริงบนเครื่อง
 */
function registerYouTubeIpc({ ipcMain, app, dialog, shell, safeStorage, getWin, log, openConsent, embeddedDir }) {
  const dlog = typeof log === 'function' ? log : () => {};
  const openConsentFn = typeof openConsent === 'function' ? openConsent : null;

  let cache = null;      // credential ที่โหลดแล้ว (null = ยังไม่โหลด)
  let embeddedCache;     // undefined = ยังไม่ตรวจ, null = ไม่มีไฟล์ที่ฝังมา
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

  /**
   * credential ที่ "ฝังมากับแอป" — มีไว้ให้เจ้าของไม่ต้อง import ไฟล์ JSON เอง
   * หา 2 ที่: ข้างไฟล์ electron (ติดไปกับตัวแอป) และใน userData (เผื่อแพ็กใหม่แล้วไฟล์หาย)
   */
  function embedded() {
    if (embeddedCache === undefined) {
      try {
        embeddedCache = yt.loadEmbeddedClient({
          dir: embeddedDir || __dirname,
          extra: [path.join(app.getPath('userData'), 'youtube-client.json')],
        });
      } catch { embeddedCache = null; }
    }
    return embeddedCache;
  }

  function creds() {
    if (cache === null) cache = secure() ? (store().load() || {}) : {};
    // ⭐ ยังไม่มี client ที่เคยนำเข้า = ใช้ตัวที่ฝังมากับแอปเลย (เจ้าของไม่ต้องทำอะไร)
    if (!cache.clientId || !cache.clientSecret) {
      const e = embedded();
      if (e) cache = { ...cache, clientId: e.clientId, clientSecret: e.clientSecret, clientSource: 'embedded' };
    }
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
    persist({ ...creds(), clientId: p.clientId, clientSecret: p.clientSecret, clientSource: 'imported' });
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
      clientSource: c.clientId && c.clientSecret ? (c.clientSource || 'imported') : '',
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

  ipcMain.handle('sovereign:youtubeConnect', async (_e, opts) => {
    if (connecting) return { ok: false, message: 'กำลังเชื่อมต่ออยู่แล้ว — รอให้เสร็จก่อน' };
    const c = creds();
    if (!c.clientId || !c.clientSecret) return { ok: false, message: yt.MSG.noClient };
    if (!secure()) return { ok: false, message: 'Windows ยังไม่พร้อมใช้การเข้ารหัส — จึงไม่เก็บความลับให้' };
    // ทางเลือกสุดท้าย: ผู้ใช้กดเองเท่านั้น (เกิดเมื่อ Google ปฏิเสธหน้าต่างในแอป)
    // ไม่ใช่พฤติกรรมปกติ — ดีฟอลต์ต้องเป็นหน้าต่างในแอปเสมอ
    const useExternal = Boolean(opts && opts.external === true);
    if (!useExternal && !openConsentFn) return { ok: false, message: 'แอปเวอร์ชันนี้ยังเปิดหน้าอนุญาตในแอปไม่ได้ — กรุณาอัปเดตแอป' };
    connecting = true;
    let srv = null;
    let consent = null;
    let closedEarly = false;
    let closedInfo = null;
    try {
      const pkce = yt.makePkce();
      const state = yt.makeState();
      let settle;
      const got = new Promise((resolve) => { settle = resolve; });

      srv = await yt.startLoopback({ onResult: (u) => settle(u), timeoutMs: 300000 });

      const authUrl = yt.buildAuthUrl({
        clientId: c.clientId, redirectUri: srv.redirectUri, state, codeChallenge: pkce.challenge,
      });

      if (useExternal) {
        dlog('youtube: เปิดเบราว์เซอร์ภายนอกตามคำสั่งผู้ใช้ (ทางเลือกสุดท้าย)');
        await shell.openExternal(authUrl);
      } else {
        // ⭐ เปิดหน้าอนุญาตของ Google "ในหน้าต่างของแอปเอง"
        //   เดิมใช้ shell.openExternal (เด้งออกไปเบราว์เซอร์นอก) — เจ้าของสั่งให้ยกเลิกวิธีนั้น
        consent = await openConsentFn(authUrl);
      }

      // ถ้าผู้ใช้ปิดหน้าต่างเองก่อนอนุญาต ไม่ต้องรอครบ 5 นาที
      // (หน้าต่างที่ถูก Google บล็อกจะรายงาน { blocked: true } กลับมาด้วย)
      const closed = consent && consent.done && typeof consent.done.then === 'function'
        ? consent.done.then((v) => { closedEarly = true; closedInfo = v || {}; return null; })
        : new Promise(() => {});

      const url = await Promise.race([got, closed]);
      if (!url) {
        if (closedInfo && closedInfo.blocked === true) {
          return {
            ok: false,
            blocked: true,
            message: 'Google ไม่ยอมเปิดหน้าอนุญาตในหน้าต่างของแอป (ขึ้นว่า "browser or app may not be secure") — '
              + 'ถ้าจำเป็นต้องเชื่อมต่อตอนนี้ ใช้ปุ่ม "เปิดในเบราว์เซอร์ (ทางเลือกสุดท้าย)" ด้านล่างได้',
          };
        }
        return {
          ok: false,
          message: closedEarly
            ? 'ยังไม่ได้รับการอนุญาต (ปิดหน้าต่างไปก่อน) — กดเชื่อมต่อใหม่ได้เลย'
            : 'รอ 5 นาทีแล้วยังไม่ได้รับการอนุญาต — กดเชื่อมต่อใหม่ได้เลย',
        };
      }
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
      // ปิดหน้าต่างอนุญาตเสมอ (สำเร็จ/ล้ม/หมดเวลา) — ห้ามให้มีหน้าต่างค้างบนจอ
      if (consent && typeof consent.close === 'function') { try { consent.close(); } catch { /* ปิดไม่ได้ก็ช่างมัน */ } }
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
