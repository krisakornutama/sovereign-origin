// tools/test/youtube-upload.test.mjs
//
// ── เทสต์: อัปโหลด YouTube อัตโนมัติ (OAuth loopback + resumable upload) ──
//
// ทำไมเทสต์ชุดนี้สำคัญเป็นพิเศษ
//   1) OAuth + อัปโหลด เป็นงานที่ "พลาดแล้วเงียบ" — โค้ดผิดแล้วได้แค่ "ไม่ขึ้น" ไม่มี error ให้เห็น
//      และกว่าเจ้าของจะรู้ตัวคือตอนคลิปไม่ขึ้น YouTube
//   2) client_secret/refresh_token ผิดพลาด = ข้อมูลลับรั่ว ต้องมีเทสต์คุมว่าห้าม require('electron')
//      ในโมดูลนี้ (ถ้าหลุดเมื่อไร เทสต์จะพังทันที ไม่ใช่ตอนแพ็กแอป)
//   3) chunk ที่ไม่ใช่พหุคูณ 256 KiB ทำให้ YouTube ตอบ 400 ทุกครั้ง — เป็นบั๊กที่หาไม่เจอด้วยตา
//
// ⚠ ห้ามต่อเน็ตจริง: transport ถูกฉีดเข้ามาเป็น fake ทุกตัว
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const yt = require(path.join(ROOT, 'sovereign-frontend/electron/youtube.js'));
const ytSource = fs.readFileSync(path.join(ROOT, 'sovereign-frontend/electron/youtube.js'), 'utf8');

/**
 * ⚠ ต้องตัดคอมเมนต์ก่อนสแกนซอร์ส
 *   ในไฟล์มีคอมเมนต์ที่เขียนว่า "ห้าม require('electron')" ⇒ สแกนดิบ ๆ จะจับคอมเมนต์ตัวเองแล้วฟ้องผิด
 *   (`([^:])\/\/` กันไม่ให้ `https://` ที่อยู่ในสตริงถูกตัดทิ้งไปด้วย)
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const ytCode = stripComments(ytSource);
// โมดูลของ Node ที่ใช้ได้โดยไม่ต้องมี dependency
const BUILTIN = new Set(['assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'stream', 'tls', 'url', 'util', 'zlib']);

/** fake transport — เก็บ request ที่เข้ามาไว้ตรวจ แล้วตอบตามคิวที่กำหนด */
function fakeTransport(replies) {
  const seen = [];
  const queue = [...replies];
  const fn = async (req) => {
    seen.push(req);
    const next = queue.shift();
    if (!next) throw new Error(`fake transport ไม่มีคำตอบเหลือ (request ที่ ${seen.length})`);
    return typeof next === 'function' ? next(req) : next;
  };
  fn.seen = seen;
  return fn;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-test-'));

describe('youtube.js — ข้อกำหนดเชิงโครงสร้าง', () => {
  test('ห้าม require electron (ไม่งั้นเทสต์ Node เรียกไม่ได้ และแพ็กแล้วจะพังที่อื่น)', () => {
    assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(ytCode), 'youtube.js ต้องไม่ require electron');
  });
  test('ต้องไม่พึ่ง dependency ภายนอก (มีแต่ built-in)', () => {
    const req = [...ytCode.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    assert.ok(req.length >= 3, 'ต้องมี require ของ built-in อย่างน้อย 3 ตัว (อ่านซอร์สเพี้ยน?)');
    for (const r of req) assert.ok(r.startsWith('.') || BUILTIN.has(r), `ห้าม require แพ็กเกจภายนอก: ${r}`);
  });
  test('loopback ต้องผูก 127.0.0.1 เท่านั้น (ห้าม 0.0.0.0)', () => {
    assert.match(ytCode, /listen\(0,\s*'127\.0\.0\.1'/);
    assert.ok(!/listen\([^)]*'0\.0\.0\.0'/.test(ytCode), 'ห้ามผูก 0.0.0.0 เด็ดขาด');
  });
  test('ค่าเริ่มต้น privacy ต้องเป็น private (ปลอดภัยไว้ก่อน)', () => {
    assert.equal(yt.DEFAULT_PRIVACY, 'private');
  });
});

describe('buildAuthUrl', () => {
  const base = { clientId: 'abc.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:51234', state: 'st1', codeChallenge: 'ch1' };

  test('ใส่พารามิเตอร์ครบตามที่ OAuth ต้องการ', () => {
    const u = new URL(yt.buildAuthUrl(base));
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(u.searchParams.get('client_id'), base.clientId);
    assert.equal(u.searchParams.get('redirect_uri'), base.redirectUri);
    assert.equal(u.searchParams.get('response_type'), 'code');
    assert.equal(u.searchParams.get('state'), 'st1');
    assert.equal(u.searchParams.get('code_challenge'), 'ch1');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  });
  test('ต้องขอ refresh_token (access_type=offline + prompt=consent)', () => {
    const u = new URL(yt.buildAuthUrl(base));
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.equal(u.searchParams.get('prompt'), 'consent');
  });
  test('scope ต้องเป็น youtube.upload ตัวเดียว', () => {
    const u = new URL(yt.buildAuthUrl(base));
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload');
  });
  test('ไม่ส่ง codeChallenge ก็ต้องไม่ใส่ code_challenge_method (ห้ามส่งคู่ไม่ครบ)', () => {
    const u = new URL(yt.buildAuthUrl({ ...base, codeChallenge: undefined }));
    assert.equal(u.searchParams.get('code_challenge'), null);
    assert.equal(u.searchParams.get('code_challenge_method'), null);
  });
});

describe('parseRedirect — ด่านกัน callback ปลอม', () => {
  test('code + state ถูกต้อง → ผ่าน', () => {
    const r = yt.parseRedirect('/?code=XYZ&state=S1', 'S1');
    assert.equal(r.ok, true);
    assert.equal(r.code, 'XYZ');
  });
  test('state ไม่ตรง → ปฏิเสธ (กัน CSRF)', () => {
    const r = yt.parseRedirect('/?code=XYZ&state=EVIL', 'S1');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'state-mismatch');
  });
  test('ไม่มี state เลย → ปฏิเสธ', () => {
    assert.equal(yt.parseRedirect('/?code=XYZ', 'S1').ok, false);
  });
  test('ผู้ใช้กดปฏิเสธ (error=access_denied) → ข้อความไทย', () => {
    const r = yt.parseRedirect('/?error=access_denied&state=S1', 'S1');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'denied');
    assert.ok(r.message.includes('ปฏิเสธ'));
  });
  test('ไม่มี code → ปฏิเสธ', () => {
    assert.equal(yt.parseRedirect('/?state=S1', 'S1').reason, 'no-code');
  });
  test('URL เพี้ยน → ไม่ throw', () => {
    assert.equal(yt.parseRedirect('::::', 'S1').ok, false);
  });
});

describe('extractHashtags — ใช้เป็น tags ของ YouTube', () => {
  test('ดึงแฮชแท็กและตัดเครื่องหมาย # ออก', () => {
    assert.deepEqual(yt.extractHashtags('ขาย #หม้อทอด #ครัว'), ['หม้อทอด', 'ครัว']);
  });
  test('ตัดตัวซ้ำแบบไม่สนตัวพิมพ์', () => {
    assert.deepEqual(yt.extractHashtags('#Promo #promo #PROMO'), ['Promo']);
  });
  test('รองรับภาษาไทย/emoji-adjacent และไม่เอาแฮชลอย', () => {
    assert.deepEqual(yt.extractHashtags('#ก'), []);
    assert.deepEqual(yt.extractHashtags('#ab'), ['ab']);
  });
  test('รวมกันต้องไม่เกิน 500 ตัวอักษร (เพดาน YouTube)', () => {
    const text = Array.from({ length: 100 }, (_, i) => `#${'x'.repeat(20)}${i}`).join(' ');
    const tags = yt.extractHashtags(text);
    const total = tags.reduce((n, t) => n + t.length + 1, 0);
    assert.ok(total <= 500, `รวมได้ ${total} ต้องไม่เกิน 500`);
    assert.ok(tags.length > 0);
  });
  test('ข้อความว่าง → อาเรย์ว่าง ไม่ throw', () => {
    assert.deepEqual(yt.extractHashtags(''), []);
    assert.deepEqual(yt.extractHashtags(null), []);
  });
  /**
   * ⭐ เทสต์นี้คือ "ร่องรอยบั๊กจริง" — รอบแรกโค้ดเขียนเป็น [\p{L}\p{N}_] ซึ่งไม่รวม \p{M}
   *    ทำให้ "#หม้อทอด" ถูกตัดเหลือ "#หม" แล้วส่ง tags ผิดขึ้น YouTube แบบเงียบ ๆ
   *    ⇒ ห้ามลบเทสต์นี้ และห้ามถอด \p{M} ออกจาก regex
   */
  test('⭐ คำไทยที่มีวรรณยุกต์/สระ (\\p{M}) ต้องไม่ถูกตัดขาดกลางคำ', () => {
    assert.deepEqual(yt.extractHashtags('#หม้อทอด'), ['หม้อทอด']);
    assert.deepEqual(yt.extractHashtags('#น้ำพริก'), ['น้ำพริก']);
    assert.deepEqual(yt.extractHashtags('#โปรโมชั่นลดราคา'), ['โปรโมชั่นลดราคา']);
    assert.deepEqual(yt.extractHashtags('ขาย #หม้อทอด #ครัว'), ['หม้อทอด', 'ครัว']);
  });
});

describe('buildVideoMetadata', () => {
  const m = yt.buildVideoMetadata({ title: 'สวัสดี', description: 'รายละเอียด', tags: ['a'], privacyStatus: 'public', madeForKids: false });

  test('ห่อใน snippet/status ตามที่ API ต้องการ', () => {
    assert.equal(m.snippet.title, 'สวัสดี');
    assert.equal(m.snippet.description, 'รายละเอียด');
    assert.deepEqual(m.snippet.tags, ['a']);
    assert.equal(m.status.privacyStatus, 'public');
  });
  test('ต้องส่ง selfDeclaredMadeForKids เสมอ (ไม่งั้นคลิปไม่ขึ้นจนกว่าจะไปตั้งใน Studio)', () => {
    assert.equal(typeof m.status.selfDeclaredMadeForKids, 'boolean');
    assert.equal(yt.buildVideoMetadata({}).status.selfDeclaredMadeForKids, false);
    assert.equal(yt.buildVideoMetadata({ madeForKids: true }).status.selfDeclaredMadeForKids, true);
  });
  test('privacy ที่ไม่รู้จัก → ถอยไป private (ห้ามหลุดเป็น public โดยอุบัติเหตุ)', () => {
    assert.equal(yt.buildVideoMetadata({ privacyStatus: 'PUBLIC' }).status.privacyStatus, 'private');
    assert.equal(yt.buildVideoMetadata({ privacyStatus: 'hack' }).status.privacyStatus, 'private');
  });
  test('ชื่อยาวเกิน 100 → ตัดที่ 100', () => {
    const t = yt.buildVideoMetadata({ title: 'ก'.repeat(300) }).snippet.title;
    assert.equal([...t].length, 100);
  });
  test('ชื่อว่าง → ใส่ค่าสำรอง ไม่ส่งช่องว่าง (YouTube จะ 400)', () => {
    assert.ok(yt.buildVideoMetadata({ title: '   ' }).snippet.title.length > 0);
  });
  test('ไม่มี tags → ไม่ส่งคีย์ tags เลย', () => {
    assert.equal('tags' in yt.buildVideoMetadata({ tags: [] }).snippet, false);
  });
});

describe('describeApiError — ข้อความที่เจ้าของอ่านแล้วรู้ว่าต้องทำอะไร', () => {
  test('quota หมด → บอกจำนวนคลิปที่ได้ต่อวัน', () => {
    const d = yt.describeApiError(403, JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }));
    assert.equal(d.code, 'quota');
    assert.ok(d.message.includes(String(yt.FREE_UPLOADS_PER_DAY)));
  });
  test('401 → บอกให้เชื่อมต่อใหม่', () => {
    assert.equal(yt.describeApiError(401, '').code, 'auth');
  });
  test('invalid_grant → มองเป็นการหมดอายุสิทธิ์', () => {
    assert.equal(yt.describeApiError(400, '{"error":"invalid_grant"}').code, 'auth');
  });
  test('500 → บอกว่าลองใหม่ได้', () => {
    const d = yt.describeApiError(500, '');
    assert.equal(d.retryable, true);
  });
  test('body ที่ไม่ใช่ JSON → ไม่ throw และยังมีข้อความ', () => {
    const d = yt.describeApiError(418, '<html>นี่คือ HTML');
    assert.ok(d.message.length > 0);
  });
  test('ทุกข้อความต้องมีภาษาไทย (ผู้ใช้ห้ามเห็นข้อความอังกฤษดิบ)', () => {
    for (const s of [400, 401, 403, 404, 418, 500, 503]) {
      assert.match(yt.describeApiError(s, '').message, /[\u0E00-\u0E7F]/, `status ${s} ต้องมีข้อความไทย`);
    }
  });
});

describe('checkVideoFile', () => {
  test('ไฟล์หาย → ข้อความบอกให้เลือกใหม่', () => {
    assert.ok(yt.checkVideoFile({ size: 10, mtimeOk: false }).includes('เลือกไฟล์ใหม่'));
  });
  test('ขนาด 0 หรือติดลบ → ถือว่าไฟล์หาย', () => {
    assert.ok(yt.checkVideoFile({ size: 0 }));
    assert.ok(yt.checkVideoFile({ size: -5 }));
  });
  test('ใหญ่เกิน 128 GB → ปฏิเสธ', () => {
    assert.ok(yt.checkVideoFile({ size: yt.MAX_BYTES + 1 }).includes('128'));
  });
  test('ไฟล์ปกติ → ผ่าน (null)', () => {
    assert.equal(yt.checkVideoFile({ size: 5 * 1024 * 1024 }), null);
  });
});

describe('planChunks / contentRange — หัวใจของ resumable upload', () => {
  test('chunk ต้องเป็นพหุคูณ 256 KiB (ไม่งั้น YouTube ตอบ 400 ทุกครั้ง)', () => {
    const chunks = yt.planChunks(yt.CHUNK * 2 + 5);
    for (const c of chunks.slice(0, -1)) {
      assert.equal(c.length % yt.CHUNK_STEP, 0, `chunk ยาว ${c.length} ต้องหาร 262144 ลงตัว`);
    }
  });
  test('ครอบคลุมทุก byte ต่อเนื่องกัน ไม่ขาดไม่ทับ', () => {
    const total = 20 * 1024 * 1024 + 123;
    const chunks = yt.planChunks(total);
    assert.equal(chunks[0].start, 0);
    assert.equal(chunks[chunks.length - 1].end, total - 1);
    for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].start, chunks[i - 1].end + 1);
    assert.equal(chunks.reduce((n, c) => n + c.length, 0), total);
  });
  test('ไฟล์เล็กกว่า 1 chunk → ได้ 1 chunk', () => {
    const c = yt.planChunks(1000);
    assert.equal(c.length, 1);
    assert.equal(c[0].length, 1000);
  });
  test('ไฟล์ 0 byte → ไม่คืนอาเรย์ว่าง (กันลูปไม่ทำงานแล้วค้าง)', () => {
    assert.equal(yt.planChunks(0).length, 1);
  });
  test('chunkSize ที่หาร 256KiB ไม่ลงตัว → ถูกปัดลงให้ปลอดภัย', () => {
    const c = yt.planChunks(3 * 1024 * 1024, 300 * 1024);
    assert.equal(c[0].length % yt.CHUNK_STEP, 0);
  });
  test('content-range รูปแบบถูกต้อง', () => {
    assert.equal(yt.contentRange({ start: 0, end: 1023, total: 5000 }), 'bytes 0-1023/5000');
    assert.equal(yt.contentRange({ start: 4096, end: 4999, total: 5000 }), 'bytes 4096-4999/5000');
  });
});

describe('makeStore — เก็บความลับ', () => {
  const file = path.join(tmp, 'cred.bin');
  const store = yt.makeStore({
    filePath: file,
    encrypt: (s) => Buffer.from('ENC:' + Buffer.from(s, 'utf8').toString('base64'), 'utf8'),
    decrypt: (b) => Buffer.from(String(b).replace(/^ENC:/, ''), 'base64').toString('utf8'),
  });

  test('ไฟล์ยังไม่มี → คืน null ไม่ throw', () => {
    assert.equal(store.load(), null);
  });
  test('บันทึกแล้วอ่านกลับได้ครบ', () => {
    store.save({ clientId: 'cid', refreshToken: 'rt' });
    const back = store.load();
    assert.equal(back.clientId, 'cid');
    assert.equal(back.refreshToken, 'rt');
  });
  test('บนดิสก์ต้องเป็นข้อความเข้ารหัส ไม่ใช่ plaintext', () => {
    store.save({ clientSecret: 'GOCSPX-ลับมาก' });
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('ลับมาก'), 'ต้องไม่เห็น secret ในไฟล์ดิบ');
    assert.ok(raw.startsWith('ENC:'));
  });
  test('ไม่มีไฟล์ .tmp ค้างหลังบันทึก (เขียนแบบ atomic)', () => {
    store.save({ a: 1 });
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  });
  test('ไฟล์เสียหาย → คืน null ไม่ทำให้แอปพัง', () => {
    fs.writeFileSync(file, Buffer.from('ไม่ใช่ของที่ถอดได้'));
    assert.equal(store.load(), null);
  });
  test('clear ลบไฟล์ทิ้ง', () => {
    store.save({ a: 1 });
    assert.equal(store.clear(), true);
    assert.equal(fs.existsSync(file), false);
  });
  test('clear ตอนไม่มีไฟล์ก็ไม่ throw', () => {
    assert.equal(store.clear(), true);
  });
});

describe('parseClientSecretFile — นำเข้าไฟล์ที่ดาวน์โหลดจาก Google', () => {
  test('รูปแบบ installed (Desktop app) → อ่านได้', () => {
    const r = yt.parseClientSecretFile(JSON.stringify({
      installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-xyz' },
    }));
    assert.equal(r.ok, true);
    assert.equal(r.clientId, '123-abc.apps.googleusercontent.com');
    assert.equal(r.clientSecret, 'GOCSPX-xyz');
  });
  test('รูปแบบ web → อ่านได้เช่นกัน', () => {
    const r = yt.parseClientSecretFile(JSON.stringify({ web: { client_id: '1-x.apps.googleusercontent.com', client_secret: 's' } }));
    assert.equal(r.ok, true);
  });
  test('JSON เสีย → ปฏิเสธพร้อมข้อความไทย', () => {
    const r = yt.parseClientSecretFile('{ไม่ใช่ json');
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });
  test('ขาด client_secret → ปฏิเสธ', () => {
    assert.equal(yt.parseClientSecretFile(JSON.stringify({ installed: { client_id: '1-x.apps.googleusercontent.com' } })).ok, false);
  });
  test('client_id ที่หน้าตาไม่ใช่ของ Google → ปฏิเสธ (กันนำเข้าไฟล์ผิด)', () => {
    assert.equal(yt.parseClientSecretFile(JSON.stringify({ installed: { client_id: 'evil.com', client_secret: 's' } })).ok, false);
  });
});

describe('loadEmbeddedClient — credential ที่ฝังมากับแอป (zero-setup)', () => {
  const GOOD = JSON.stringify({ installed: { client_id: '1-x.apps.googleusercontent.com', client_secret: 'GOCSPX-aaa' } });
  const EMB = 'C:' + path.sep + 'app' + path.sep + 'electron';
  const PRIMARY = path.join(EMB, 'youtube-client.json');
  const EXTRA = path.join('C:' + path.sep, 'ud', 'youtube-client.json');

  /** fs ปลอมจาก Map path→content (ไม่แตะดิสก์จริง) */
  function fake(files) {
    return {
      exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
      read: (p) => files[p],
    };
  }

  test('เจอไฟล์ข้างแอป → คืน client พร้อม source', () => {
    const f = fake({ [PRIMARY]: GOOD });
    const r = yt.loadEmbeddedClient({ dir: EMB, readFile: f.read, exists: f.exists });
    assert.ok(r);
    assert.equal(r.ok, true);
    assert.equal(r.clientId, '1-x.apps.googleusercontent.com');
    assert.equal(r.clientSecret, 'GOCSPX-aaa');
    assert.equal(r.source, PRIMARY);
  });

  test('ไม่มีไฟล์ข้างแอป → ไปหาที่ path สำรอง (userData)', () => {
    const f = fake({ [EXTRA]: GOOD });
    const r = yt.loadEmbeddedClient({ dir: EMB, extra: [EXTRA], readFile: f.read, exists: f.exists });
    assert.ok(r);
    assert.equal(r.source, EXTRA);
  });

  test('ไฟล์ข้างแอปเสีย → ตกไปใช้ตัวสำรอง', () => {
    const f = fake({ [PRIMARY]: '{ ไม่ใช่ json', [EXTRA]: GOOD });
    const r = yt.loadEmbeddedClient({ dir: EMB, extra: [EXTRA], readFile: f.read, exists: f.exists });
    assert.ok(r);
    assert.equal(r.source, EXTRA);
  });

  test('ไม่มีไฟล์เลย → คืน null (ไม่ throw)', () => {
    const f = fake({});
    assert.equal(yt.loadEmbeddedClient({ dir: EMB, readFile: f.read, exists: f.exists }), null);
  });

  test('ไฟล์เสียทั้งหมด → คืน null', () => {
    const f = fake({ [PRIMARY]: 'nope', [EXTRA]: '{"installed":{"client_id":"evil.com"}}' });
    assert.equal(yt.loadEmbeddedClient({ dir: EMB, extra: [EXTRA], readFile: f.read, exists: f.exists }), null);
  });

  test('exists/readFile โยน exception → ไม่ทำให้แอปพัง', () => {
    const r = yt.loadEmbeddedClient({
      dir: EMB,
      exists: () => { throw new Error('EACCES'); },
      readFile: () => { throw new Error('EIO'); },
    });
    assert.equal(r, null);
  });
});

describe('exchangeCode / refreshAccessToken', () => {
  test('สำเร็จ → ได้ access + refresh + เวลาหมดอายุ', async () => {
    const t = fakeTransport([{ status: 200, headers: {}, text: JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) }]);
    const r = await yt.exchangeCode({ clientId: 'c', clientSecret: 's', code: 'code1', redirectUri: 'http://127.0.0.1:1', transport: t });
    assert.equal(r.ok, true);
    assert.equal(r.accessToken, 'AT');
    assert.equal(r.refreshToken, 'RT');
    assert.ok(r.expiresAt > Date.now());
  });
  test('ส่ง code_verifier ไปด้วยเมื่อใช้ PKCE', async () => {
    const t = fakeTransport([{ status: 200, headers: {}, text: '{"access_token":"AT"}' }]);
    await yt.exchangeCode({ clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r', codeVerifier: 'VER', transport: t });
    assert.ok(String(t.seen[0].body).includes('code_verifier=VER'));
  });
  test('⭐ รอบต่ออายุไม่คืน refresh_token → ต้องได้ null (ห้ามใส่ค่าเดา) เพื่อให้ผู้เรียกเก็บของเดิมไว้', async () => {
    const t = fakeTransport([{ status: 200, headers: {}, text: '{"access_token":"AT2","expires_in":3600}' }]);
    const r = await yt.refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'OLD', transport: t });
    assert.equal(r.ok, true);
    assert.equal(r.refreshToken, null);
  });
  test('Google ตอบ error → แปลงเป็นข้อความไทย', async () => {
    const t = fakeTransport([{ status: 400, headers: {}, text: '{"error":"invalid_grant"}' }]);
    const r = await yt.refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'X', transport: t });
    assert.equal(r.ok, false);
    assert.match(r.message, /[\u0E00-\u0E7F]/);
  });
  test('ตอบ 200 แต่ไม่มี access_token → ถือว่าไม่สำเร็จ', async () => {
    const t = fakeTransport([{ status: 200, headers: {}, text: '{}' }]);
    assert.equal((await yt.refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'X', transport: t })).ok, false);
  });
});

describe('uploadVideo', () => {
  const size = 1000;
  const file = path.join(tmp, 'clip.bin');
  fs.writeFileSync(file, Buffer.alloc(size, 7));
  const meta = yt.buildVideoMetadata({ title: 'ทดสอบ' });

  test('ไฟล์เล็ก → 1 PUT แล้วสำเร็จ พร้อมส่ง videoId กลับ', async () => {
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://upload.example/session' }, text: '' },
      { status: 200, headers: {}, text: JSON.stringify({ id: 'VID123' }) },
    ]);
    const r = await yt.uploadVideo({ accessToken: 'AT', filePath: file, size, metadata: meta, transport: t });
    assert.equal(r.ok, true);
    assert.equal(r.videoId, 'VID123');
    assert.equal(t.seen.length, 2);
  });
  test('request แรกต้องเป็น resumable + ส่งขนาดไฟล์/ชนิดไฟล์ไปด้วย', async () => {
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://upload.example/s' }, text: '' },
      { status: 201, headers: {}, text: '{"id":"V"}' },
    ]);
    await yt.uploadVideo({ accessToken: 'AT', filePath: file, size, metadata: meta, transport: t });
    const init = t.seen[0];
    assert.ok(String(init.url).includes('uploadType=resumable'));
    assert.equal(init.headers['x-upload-content-length'], String(size));
    assert.equal(init.headers.authorization, 'Bearer AT');
  });
  test('308 = ยังไม่จบ ต้องส่งช่วงถัดไปต่อ ไม่ใช่ล้มเหลว', async () => {
    const big = yt.CHUNK * 3; // 3 chunk → ต้องยิง 3 PUT (สองอันแรกตอบ 308 อันสุดท้ายจบ)
    const bigFile = path.join(tmp, 'big.bin');
    fs.writeFileSync(bigFile, Buffer.alloc(big, 1));
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://upload.example/s' }, text: '' },
      { status: 308, headers: {}, text: '' },
      { status: 308, headers: {}, text: '' },
      { status: 200, headers: {}, text: '{"id":"BIG"}' },
    ]);
    const r = await yt.uploadVideo({ accessToken: 'AT', filePath: bigFile, size: big, metadata: meta, transport: t });
    assert.equal(r.ok, true);
    assert.equal(r.videoId, 'BIG');
    assert.equal(t.seen.length, 4, 'init 1 ครั้ง + PUT 3 ครั้ง');
    fs.unlinkSync(bigFile);
  });
  test('content-range ของแต่ละ chunk ต้องต่อเนื่องกันจริง', async () => {
    const big = 3 * 1024 * 1024;
    const f = path.join(tmp, 'rng.bin');
    fs.writeFileSync(f, Buffer.alloc(big, 2));
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://u/s' }, text: '' },
      { status: 308, headers: {}, text: '' },
      { status: 308, headers: {}, text: '' },
      { status: 200, headers: {}, text: '{"id":"X"}' },
    ]);
    await yt.uploadVideo({ accessToken: 'AT', filePath: f, size: big, metadata: meta, transport: t, chunkSize: 1024 * 1024 });
    const ranges = t.seen.slice(1).map((r) => r.headers['content-range']);
    assert.deepEqual(ranges, [`bytes 0-1048575/${big}`, `bytes 1048576-2097151/${big}`, `bytes 2097152-3145727/${big}`]);
    fs.unlinkSync(f);
  });
  test('รายงานความคืบหน้าจนถึง 100%', async () => {
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://u/s' }, text: '' },
      { status: 200, headers: {}, text: '{"id":"X"}' },
    ]);
    const seen = [];
    await yt.uploadVideo({ accessToken: 'AT', filePath: file, size, metadata: meta, transport: t, onProgress: (p) => seen.push(p) });
    assert.equal(seen[seen.length - 1].sent, size);
    assert.equal(seen[seen.length - 1].total, size);
  });
  test('onProgress ที่ throw ต้องไม่ทำให้อัปโหลดพัง', async () => {
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://u/s' }, text: '' },
      { status: 200, headers: {}, text: '{"id":"X"}' },
    ]);
    const r = await yt.uploadVideo({ accessToken: 'AT', filePath: file, size, metadata: meta, transport: t, onProgress: () => { throw new Error('UI พัง'); } });
    assert.equal(r.ok, true);
  });
  test('กดยกเลิกกลางทาง → หยุดทันที ไม่ยิง chunk ถัดไป', async () => {
    const big = yt.CHUNK * 4;
    const f = path.join(tmp, 'abort.bin');
    fs.writeFileSync(f, Buffer.alloc(big, 3));
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://u/s' }, text: '' },
      { status: 308, headers: {}, text: '' },
      { status: 308, headers: {}, text: '' },
      { status: 308, headers: {}, text: '' },
      { status: 200, headers: {}, text: '{"id":"ไม่ควรถึง"} ' },
    ]);
    let n = 0;
    const r = await yt.uploadVideo({
      accessToken: 'AT', filePath: f, size: big, metadata: meta, transport: t,
      shouldAbort: () => n++ >= 1, // ปล่อย chunk แรกผ่าน แล้วยกเลิก
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'aborted');
    assert.equal(t.seen.length, 2, 'init + PUT 1 ครั้ง เท่านั้น');
    fs.unlinkSync(f);
  });
  test('ไม่ได้ session URI กลับมา → ไม่พยายามอัปโหลดต่อ', async () => {
    const t = fakeTransport([{ status: 200, headers: {}, text: '' }]);
    const r = await yt.uploadVideo({ accessToken: 'AT', filePath: file, size, metadata: meta, transport: t });
    assert.equal(r.ok, false);
    assert.equal(t.seen.length, 1);
  });
  test('โควตาหมดกลางทาง → ข้อความโควตา ไม่ใช่ error ดิบ', async () => {
    const t = fakeTransport([
      { status: 200, headers: { location: 'https://u/s' }, text: '' },
      { status: 403, headers: {}, text: '{"error":{"errors":[{"reason":"quotaExceeded"}]}}' },
    ]);
    const r = await yt.uploadVideo({ accessToken: 'AT', filePath: file, size, metadata: meta, transport: t });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'quota');
    assert.ok(r.message.includes('โควตา'));
  });
  test('ไฟล์หาย → ตรวจเจอก่อนเริ่มอัปโหลด (ไม่เสียเวลา/โควตา)', async () => {
    const t = fakeTransport([]);
    const r = await yt.uploadVideo({ accessToken: 'AT', filePath: path.join(tmp, 'ไม่มีจริง.mp4'), size: 100, metadata: meta, transport: t });
    assert.equal(r.ok, false);
    assert.equal(t.seen.length, 0, 'ยังไม่ควรยิง request ใด ๆ');
  });
  test('ไฟล์ถูกลบ "หลัง" ตรวจขนาด (race) → คืนข้อความบอกให้เลือกใหม่ ไม่ throw', async () => {
    // exists() ผ่านแล้ว แต่เปิดไฟล์ไม่ติดจริง — ต้องไม่ทำให้แอปพัง และต้องปิด session ทิ้งอย่างเรียบร้อย
    const t = fakeTransport([{ status: 200, headers: { location: 'https://u/s' }, text: '' }]);
    const boom = () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; };
    const r = await yt.uploadVideo({
      accessToken: 'AT', filePath: path.join(tmp, 'ก.mp4'), size: 100, metadata: meta,
      transport: t, exists: () => true, openFile: boom,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'file');
    assert.ok(r.message.includes('เลือกไฟล์ใหม่'));
  });
});

describe('startLoopback — รับ code จาก Google', () => {
  test('เปิดบน 127.0.0.1 พอร์ตว่าง และรับ callback ได้จริง', async () => {
    let got = null;
    const srv = await yt.startLoopback({ onResult: (u) => { got = u; }, timeoutMs: 8000 });
    assert.equal(srv.redirectUri.startsWith('http://127.0.0.1:'), true);
    assert.ok(srv.port > 0);

    const res = await fetch(`${srv.redirectUri}/?code=ABC&state=S`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('เชื่อมต่อเรียบร้อย'));

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(got, '/?code=ABC&state=S');
  });

  test('หน้าปิด (timeout) → แจ้ง null และปิด server ให้', async () => {
    let got = 'ยังไม่ถูกเรียก';
    const srv = await yt.startLoopback({ onResult: (u) => { got = u; }, timeoutMs: 80 });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(got, null);
    srv.close();
  });
});
