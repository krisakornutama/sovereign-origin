// electron/youtube.js
// ────────────────────────────────────────────────────────────────────────────
// YouTube Data API v3 — OAuth 2.0 (loopback) + อัปโหลดวิดีโอแบบ resumable
//
// ทำไมงานนี้อยู่ใน Electron ไม่ใช่ backend (อ่านก่อนแก้)
//   1) ไฟล์วิดีโออยู่บนเครื่องนี้ — อ่านตรงแล้วส่งขึ้น YouTube = ข้อมูลวิ่งรอบเดียว
//      ถ้าให้ backend อัปโหลดจะกลายเป็น 2 รอบ (เครื่อง → backend → YouTube)
//      คลิป 1 GB จะกลายเป็น 2 GB และต้อง buffer เพิ่มโดยไม่จำเป็น
//   2) ไม่ต้อง restart backend เลย (โปรเจ็กอยู่ระหว่าง Cold Soak)
//   3) OAuth แบบ loopback เป็นวิธีที่ Google ออกแบบมาสำหรับ client ชนิด
//      "Desktop app" โดยตรง — ไม่ใช่การเลี่ยงข้อจำกัด
//
// ⚠ ไฟล์นี้ห้าม require('electron') เด็ดขาด
//   เพื่อให้เทสต์ Node ธรรมดาเรียกได้ (มีเทสต์คุมอยู่ที่ tools/test/youtube-upload.test.mjs)
//   ของที่ต้องพึ่ง Electron (safeStorage · userData · shell) ถูก "ฉีด" เข้ามาทางพารามิเตอร์
// ────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';

// ข้อกำหนดของ resumable upload: ขนาด chunk ต้องเป็นพหุคูณของ 256 KiB (262144)
const CHUNK = 8 * 1024 * 1024; // 8 MiB
const CHUNK_STEP = 256 * 1024;

// YouTube ให้โควตาฟรี 10,000 units/วัน และการอัปโหลด 1 คลิปใช้ 1,600 units
const UNITS_PER_UPLOAD = 1600;
const UNITS_PER_DAY = 10000;
const FREE_UPLOADS_PER_DAY = Math.floor(UNITS_PER_DAY / UNITS_PER_UPLOAD); // = 6

const PRIVACY = ['private', 'unlisted', 'public'];
const DEFAULT_PRIVACY = 'private'; // ค่าปลอดภัย: ยังไม่ขึ้นสาธารณะจนกว่าเจ้าของจะเลือกเอง

// ── ข้อความไทย (รวมไว้ที่เดียว เพื่อให้เทสต์ตรวจได้ว่าผู้ใช้ไม่มีวันเห็นข้อความอังกฤษดิบ) ──
const MSG = {
  noClient: 'ยังไม่ได้ใส่ Client ID/Secret ของ Google — กรุณานำเข้าไฟล์ JSON ที่ดาวน์โหลดจาก Google Cloud',
  notConnected: 'ยังไม่ได้เชื่อมต่อบัญชี YouTube',
  denied: 'คุณกดปฏิเสธการอนุญาตในหน้า Google — ยังไม่ได้เชื่อมต่อ',
  stateMismatch: 'คำตอบจาก Google ไม่ตรงกับที่ขอไว้ (กันการปลอมแปลง) — ยกเลิกเพื่อความปลอดภัย',
  noCode: 'Google ไม่ได้ส่งรหัสอนุญาตกลับมา — ลองเชื่อมต่อใหม่',
  quota: `โควตาฟรีของ YouTube วันนี้หมดแล้ว (อัปโหลดได้ประมาณ ${FREE_UPLOADS_PER_DAY} คลิป/วัน) — พรุ่งนี้ค่อยลองใหม่ หรืออัปโหลดผ่านหน้าเว็บแทน`,
  expired: 'สิทธิ์การเชื่อมต่อหมดอายุ — กรุณากดเชื่อมต่อ YouTube ใหม่',
  fileMissing: 'ไม่พบไฟล์วิดีโอนี้แล้ว (อาจถูกย้ายหรือลบ) — กรุณาเลือกไฟล์ใหม่',
  tooLong: 'ไฟล์ยาวเกินขีดจำกัด',
  tooBig: 'ไฟล์ใหญ่เกินขีดจำกัดของ YouTube (128 GB)',
};

const MAX_BYTES = 128 * 1024 * 1024 * 1024; // 128 GB — เพดานของ YouTube เอง
const MAX_TITLE = 100;
// เพดานของ YouTube: tags รวมกันไม่เกิน 500 ตัวอักษร
const MAX_TAGS_CHARS = 500;

// ────────────────────────────────────────────────────────────────────────────
// ส่วนที่ 1 — ฟังก์ชันบริสุทธิ์ (ไม่มี I/O) → เทสต์ตรงได้ 100%
// ────────────────────────────────────────────────────────────────────────────

/** สุ่ม PKCE — Google แนะนำให้ใช้คู่กับ Desktop client */
function makePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeState() {
  return base64url(crypto.randomBytes(16));
}

/** สร้าง URL หน้าให้อนุญาตของ Google */
function buildAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  // access_type=offline + prompt=consent ⇒ ได้ refresh_token มาใช้ต่อโดยไม่ต้องกดอนุญาตซ้ำ
  // (ถ้าไม่ใส่ prompt=consent บางกรณี Google จะไม่คืน refresh_token มาให้เลย)
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  if (codeChallenge) {
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
  }
  return u.toString();
}

/**
 * อ่านผลที่ Google โยนกลับมาที่ loopback
 * ⚠ ต้องเทียบ state ให้ตรงเสมอ — ถ้าไม่ตรงแปลว่ามีคนอื่นยิง callback ปลอมเข้ามา
 */
function parseRedirect(urlStr, expectedState) {
  let u;
  try { u = new URL(urlStr, 'http://127.0.0.1'); } catch { return { ok: false, reason: 'bad-url' }; }
  const err = u.searchParams.get('error');
  if (err) return { ok: false, reason: 'denied', detail: err, message: MSG.denied };
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  if (!code) return { ok: false, reason: 'no-code', message: MSG.noCode };
  if (state !== expectedState) return { ok: false, reason: 'state-mismatch', message: MSG.stateMismatch };
  return { ok: true, code };
}

/**
 * ดึงแฮชแท็กจากข้อความ → ใช้เป็น tags ของ YouTube (ตัดซ้ำ · จำกัด 500 ตัวอักษรตามเพดาน)
 *
 * ⚠ กับดักภาษาไทย: วรรณยุกต์/สระบน-ล่าง (้ ั ี ่ ำ …) เป็นหมวด \p{M} ไม่ใช่ \p{L}
 *   ถ้าเขียนแค่ `[\p{L}\p{N}_]` คำว่า "#หม้อทอด" จะถูกตัดเหลือ "#หม" แล้วส่งขึ้น YouTube ผิด
 *   (เจอจริงตอนรันเทสต์รอบแรก — เทสต์จับได้ ไม่ใช่ตาคน)
 *   ⇒ ต้องมี \p{M} ต่อท้ายเสมอ และให้อักษรตัวแรกเป็น \p{L}/\p{N} (แฮชแท็กห้ามเริ่มด้วยวรรณยุกต์)
 */
function extractHashtags(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(/#([\p{L}\p{N}][\p{L}\p{M}\p{N}_]{1,39})/gu)) {
    const tag = m[1];
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  let used = 0;
  const kept = [];
  for (const t of out) {
    if (used + t.length + 1 > MAX_TAGS_CHARS) break;
    used += t.length + 1;
    kept.push(t);
  }
  return kept;
}

/** ประกอบ metadata ตามที่ YouTube API ต้องการ */
function buildVideoMetadata({ title, description, tags, privacyStatus, madeForKids }) {
  // slice() บน UTF-16 ตัด surrogate pair (emoji) กลางตัวได้ → ใช้ [...str] เพื่อตัดที่ระดับ "ตัวอักษร" จริง
  const clean = [...String(title || '').trim()].slice(0, MAX_TITLE).join('');
  const privacy = PRIVACY.includes(privacyStatus) ? privacyStatus : DEFAULT_PRIVACY;
  const list = Array.isArray(tags) ? tags.filter((t) => t && t.length <= 40).slice(0, 30) : [];
  return {
    snippet: {
      title: clean || 'คลิปใหม่',
      description: String(description || '').slice(0, 5000),
      ...(list.length ? { tags: list } : {}),
    },
    status: {
      privacyStatus: privacy,
      // ⚠ ต้องส่งค่านี้เสมอ — ถ้าไม่ส่ง YouTube จะบังคับให้ไปตั้งใน Studio ก่อนคลิปจะขึ้น
      selfDeclaredMadeForKids: madeForKids === true,
    },
  };
}

/** แปลง error จาก API เป็นข้อความที่เจ้าของอ่านแล้วรู้ว่าต้องทำอะไรต่อ */
function describeApiError(status, bodyText) {
  const body = String(bodyText || '');
  if (status === 401 || /invalid_grant|Invalid Credentials/i.test(body)) {
    return { code: 'auth', message: MSG.expired, retryable: true };
  }
  if (status === 403 && /quotaExceeded|dailyLimitExceeded/i.test(body)) {
    return { code: 'quota', message: MSG.quota, retryable: false };
  }
  if (status === 403) {
    return { code: 'forbidden', message: `Google ปฏิเสธคำขอนี้ (403) — ${firstReason(body)}`, retryable: false };
  }
  if (status === 400) {
    return { code: 'bad-request', message: `ข้อมูลไม่ถูกต้องตามที่ YouTube ต้องการ (400) — ${firstReason(body)}`, retryable: false };
  }
  if (status === 404) {
    return { code: 'not-found', message: 'ไม่พบปลายทางอัปโหลด (404) — ลองเชื่อมต่อใหม่', retryable: true };
  }
  if (status >= 500) {
    return { code: 'server', message: `YouTube ขัดข้องชั่วคราว (${status}) — ลองใหม่อีกครั้ง`, retryable: true };
  }
  return { code: 'unknown', message: `อัปโหลดไม่สำเร็จ (${status}) — ${firstReason(body)}`, retryable: false };
}

function firstReason(body) {
  try {
    const j = JSON.parse(body);
    const e = j && j.error;
    if (e && e.message) return String(e.message).slice(0, 200);
    if (Array.isArray(e && e.errors) && e.errors[0] && e.errors[0].reason) return String(e.errors[0].reason);
  } catch { /* ไม่ใช่ JSON — ใช้ข้อความดิบ */ }
  return String(body || '').replace(/\s+/g, ' ').slice(0, 160) || 'ไม่ทราบสาเหตุ';
}

/** ตรวจไฟล์ก่อนอัปโหลด — คืน null = ผ่าน */
function checkVideoFile({ size, mtimeOk }) {
  if (mtimeOk === false) return MSG.fileMissing;
  if (!Number.isFinite(size) || size <= 0) return MSG.fileMissing;
  if (size > MAX_BYTES) return MSG.tooBig;
  return null;
}

/** คำนวณช่วง byte ของแต่ละ chunk (แยกออกมาเพื่อเทสต์เลขได้ตรง ๆ) */
function planChunks(total, chunkSize = CHUNK) {
  const size = Math.max(CHUNK_STEP, Math.floor(chunkSize / CHUNK_STEP) * CHUNK_STEP);
  const out = [];
  for (let start = 0; start < total; start += size) {
    const end = Math.min(start + size, total) - 1;
    out.push({ start, end, length: end - start + 1 });
  }
  if (out.length === 0) out.push({ start: 0, end: -1, length: 0 }); // ไฟล์ 0 byte
  return out;
}

function contentRange({ start, end, total }) {
  return start === 0 && end === -1 ? `bytes */${total}` : `bytes ${start}-${end}/${total}`;
}

/** ที่เก็บข้อมูลลับ: รับ encrypt/decrypt จาก Electron (safeStorage) ผ่านพารามิเตอร์ */
function makeStore({ filePath, encrypt, decrypt }) {
  return {
    load() {
      try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath);
        if (!raw || raw.length === 0) return null;
        const json = decrypt(raw);
        const o = JSON.parse(json);
        return o && typeof o === 'object' ? o : null;
      } catch { return null; }
    },
    save(obj) {
      const json = JSON.stringify(obj || {});
      const buf = encrypt(json);
      // เขียนแบบ atomic — ถ้าไฟดับกลางทางต้องไม่เหลือไฟล์ครึ่ง ๆ ที่อ่านไม่ได้
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, filePath);
      return true;
    },
    clear() {
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); return true; } catch { return false; }
    },
  };
}

/** อ่านไฟล์ JSON ที่ดาวน์โหลดจาก Google Cloud (client_secret_*.json) */
function parseClientSecretFile(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, message: 'ไฟล์นี้ไม่ใช่ JSON' }; }
  const node = j.installed || j.web || j;
  const clientId = typeof node.client_id === 'string' ? node.client_id.trim() : '';
  const clientSecret = typeof node.client_secret === 'string' ? node.client_secret.trim() : '';
  if (!clientId || !clientSecret) return { ok: false, message: 'ในไฟล์ไม่มี client_id/client_secret' };
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, message: 'client_id หน้าตาไม่ถูกต้อง' };
  return { ok: true, clientId, clientSecret };
}

/**
 * โหลด credential ที่ "ฝังมากับแอป" — เพื่อให้เจ้าของไม่ต้อง import ไฟล์ JSON เองเลย
 * (เจ้าของสั่งชัดเจน: การเชื่อมต่อบัญชีต้องทำใน Sovereign OS ทั้งหมด)
 *
 * ⚠ ไฟล์นี้ "ห้ามเข้า git" (gitignore ไว้)
 *   client_secret ของ installed app ไม่ใช่ความลับตามนิยามของ Google แต่ถ้าขึ้น GitHub
 *   secret scanning ของ GitHub จะรายงานให้ Google แล้วอาจถูกเพิกถอนอัตโนมัติ → เสี่ยงเกินไป
 *
 * ลำดับการหา: <dir>/youtube-client.json → path ที่ส่งมาเพิ่ม (เช่น userData) — ตัวแรกที่ใช้ได้ชนะ
 * ไม่มีไฟล์/ไฟล์เสีย = คืน null (ไม่ throw) แล้วให้ UI ตกไปใช้ทางเดิม (import ไฟล์เอง)
 */
function loadEmbeddedClient({ dir, extra = [], readFile = fs.readFileSync, exists = fs.existsSync } = {}) {
  const base = dir || __dirname;
  const candidates = [path.join(base, 'youtube-client.json'), ...extra.filter(Boolean)];
  for (const p of candidates) {
    try {
      if (!exists(p)) continue;
      const r = parseClientSecretFile(readFile(p, 'utf8'));
      if (r.ok) return { ...r, source: p };
    } catch { /* ไฟล์เสีย/อ่านไม่ได้ = ลองตัวถัดไป ไม่ทำให้แอปพัง */ }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// ส่วนที่ 2 — transport (ฉีดได้ → เทสต์ไม่ต้องต่อเน็ตจริง)
// ────────────────────────────────────────────────────────────────────────────

/** transport จริง: คืน { status, headers, text } */
function defaultTransport({ method, url, headers, body }) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const req = https.request({
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: { ...headers, ...(payload ? { 'content-length': payload.length } : {}) },
    }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(parts).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('หมดเวลาเชื่อมต่อ Google')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function form(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) u.set(k, String(v));
  return u.toString();
}

/** แลก code → token (ครั้งแรกหลังผู้ใช้อนุญาต) */
async function exchangeCode({ clientId, clientSecret, code, redirectUri, codeVerifier, transport = defaultTransport }) {
  const r = await transport({
    method: 'POST',
    url: TOKEN_URL,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri,
      grant_type: 'authorization_code', ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }),
  });
  return readTokens(r);
}

/** ต่ออายุ access token ด้วย refresh token */
async function refreshAccessToken({ clientId, clientSecret, refreshToken, transport = defaultTransport }) {
  const r = await transport({
    method: 'POST',
    url: TOKEN_URL,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  return readTokens(r);
}

function readTokens(r) {
  if (r.status !== 200) {
    const d = describeApiError(r.status, r.text);
    return { ok: false, ...d };
  }
  let j;
  try { j = JSON.parse(r.text); } catch { return { ok: false, code: 'parse', message: 'อ่านคำตอบจาก Google ไม่ได้', retryable: true }; }
  if (!j.access_token) return { ok: false, code: 'no-token', message: MSG.expired, retryable: true };
  return {
    ok: true,
    accessToken: j.access_token,
    // ⚠ Google คืน refresh_token ครั้งแรกครั้งเดียว — ถ้ารอบหลังไม่คืนมา ต้องเก็บของเดิมไว้ ห้ามทับด้วย null
    refreshToken: typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : null,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    scope: j.scope || '',
  };
}

/** ขอข้อมูลช่อง (ไว้โชว์ว่าเชื่อมกับช่องไหน — ทำให้เจ้าของมั่นใจว่าถูกช่อง) */
async function fetchChannel({ accessToken, transport = defaultTransport }) {
  const r = await transport({
    method: 'GET',
    url: 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (r.status !== 200) return { ok: false };
  try {
    const j = JSON.parse(r.text);
    const it = j.items && j.items[0];
    if (!it) return { ok: false };
    return { ok: true, title: it.snippet.title, id: it.id };
  } catch { return { ok: false }; }
}

/**
 * อัปโหลดวิดีโอแบบ resumable
 * - เริ่ม session → รับ session URI จาก header `location`
 * - ส่งทีละ chunk (8 MiB) แล้วรายงานความคืบหน้า
 * - 308 = ยังไม่จบ ให้ส่งช่วงถัดไปต่อ (ไม่ใช่ error)
 */
async function uploadVideo({
  accessToken, filePath, size, metadata, onProgress, chunkSize = CHUNK,
  transport = defaultTransport, openFile = fs.openSync, readInto = readChunk, closeFile = fs.closeSync,
  exists = fs.existsSync, shouldAbort = null,
}) {
  // ตรวจ "ก่อน" ยิง request — ไฟล์หายต้องรู้ทันทีโดยไม่เสียโควตา (โควตาฟรีมีแค่ ~6 คลิป/วัน)
  const guard = checkVideoFile({ size }) || (exists(filePath) ? null : MSG.fileMissing);
  if (guard) return { ok: false, code: 'file', message: guard };

  const init = await transport({
    method: 'POST',
    url: `${UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': 'video/*',
      'x-upload-content-length': String(size),
    },
    body: JSON.stringify(metadata),
  });

  const session = init.headers && (init.headers.location || init.headers.Location);
  if (init.status !== 200 || !session) {
    const d = describeApiError(init.status, init.text);
    return { ok: false, ...d };
  }

  let fd;
  try {
    fd = openFile(filePath, 'r');
  } catch (e) {
    return { ok: false, code: 'file', message: `${MSG.fileMissing} (${e.code || e.message})` };
  }

  try {
    const chunks = planChunks(size, chunkSize);
    let sent = 0;
    for (const c of chunks) {
      // เช็ค "ก่อน" อ่านไฟล์ก้อนถัดไป — ยกเลิกแล้วต้องหยุดทันที ไม่กินดิสก์/เน็ตต่อ
      if (typeof shouldAbort === 'function' && shouldAbort()) {
        return { ok: false, code: 'aborted', sent, message: 'ยกเลิกการอัปโหลดแล้ว (ไฟล์บางส่วนถูกส่งไปแล้ว ควรไปลบใน YouTube Studio)' };
      }
      const buf = Buffer.alloc(c.length);
      readInto(fd, buf, c.length);
      const r = await transport({
        method: 'PUT',
        url: session,
        headers: {
          'content-type': 'video/*',
          'content-length': String(c.length),
          'content-range': contentRange({ start: c.start, end: c.end, total: size }),
        },
        body: buf,
      });
      sent += c.length;
      if (typeof onProgress === 'function') {
        try { onProgress({ sent, total: size }); } catch { /* UI พังไม่ควรทำให้อัปโหลดพัง */ }
      }
      if (r.status === 308) continue;                 // ยังไม่จบ → ส่งช่วงถัดไป
      if (r.status === 200 || r.status === 201) {
        let videoId = null;
        try { videoId = JSON.parse(r.text).id || null; } catch { /* ไม่มี id ก็ยังนับว่าสำเร็จ */ }
        return { ok: true, videoId, bytes: sent };
      }
      const d = describeApiError(r.status, r.text);
      return { ok: false, sent, ...d };
    }
    return { ok: false, code: 'incomplete', message: 'อัปโหลดจบครบแต่ YouTube ยังไม่ยืนยันผล', retryable: true };
  } finally {
    try { closeFile(fd); } catch { /* ปิดไม่ได้ก็ไม่ควรกลบ error จริง */ }
  }
}

function readChunk(fd, buf, length) {
  let off = 0;
  while (off < length) {
    const n = fs.readSync(fd, buf, off, length - off, null);
    if (n <= 0) break;
    off += n;
  }
  return off;
}

// ────────────────────────────────────────────────────────────────────────────
// ส่วนที่ 3 — loopback server สำหรับรับ code จาก Google
// ────────────────────────────────────────────────────────────────────────────

/**
 * เปิด server ชั่วคราวบน 127.0.0.1 พอร์ตว่าง แล้วรอ Google โยน code กลับมา
 * ⚠ ผูกกับ 127.0.0.1 เท่านั้น — ห้าม 0.0.0.0 ไม่งั้นเครื่องอื่นในวงเดียวกันยิงเข้ามาได้
 */
function startLoopback({ onResult, timeoutMs = 300000, page = donePage }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page());
      if (settled) return;
      settled = true;
      onResult(req.url || '/');
      finish();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onResult(null);
      finish();
    }, timeoutMs);

    function finish() {
      clearTimeout(timer);
      try { server.close(); } catch { /* ปิดไม่สำเร็จก็ไม่เป็นไร เดี๋ยว GC เก็บ */ }
    }

    server.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        redirectUri: `http://127.0.0.1:${addr.port}`,
        close: () => { settled = true; finish(); },
      });
    });
  });
}

function donePage() {
  return `<!doctype html><html lang="th"><meta charset="utf-8">
<title>Sovereign OS</title>
<body style="font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:44px">✅</div>
<h1 style="font-size:20px;margin:12px 0 6px">เชื่อมต่อเรียบร้อย</h1>
<p style="color:#9ca3af;font-size:14px">ปิดหน้านี้ได้เลย แล้วกลับไปที่แอป Sovereign OS</p></div>
</body></html>`;
}

module.exports = {
  SCOPE, AUTH_URL, TOKEN_URL, UPLOAD_URL, CHUNK, CHUNK_STEP, PRIVACY, DEFAULT_PRIVACY,
  UNITS_PER_UPLOAD, UNITS_PER_DAY, FREE_UPLOADS_PER_DAY, MAX_TITLE, MAX_BYTES, MSG,
  makePkce, makeState, buildAuthUrl, parseRedirect, extractHashtags, buildVideoMetadata,
  describeApiError, checkVideoFile, planChunks, contentRange, makeStore, parseClientSecretFile,
  loadEmbeddedClient,
  defaultTransport, exchangeCode, refreshAccessToken, fetchChannel, uploadVideo, startLoopback, donePage,
};
