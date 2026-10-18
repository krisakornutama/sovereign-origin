// tools/test/youtube-bridge.test.mjs
//
// ── เทสต์: สะพานหน้าเว็บ ↔ Electron สำหรับ YouTube (bridge.ts) ──
//
// ทำไมต้องมี
//   1) ⭐ ความลับห้ามหลุดขึ้นหน้าเว็บ — เทสต์จะจับทันทีถ้ามีคนเขียน `return v` (ส่งทั้งก้อนกลับ)
//      แทนที่จะคัดเฉพาะฟิลด์ที่อนุญาต
//   2) แอปที่ติดตั้งไว้ก่อนอัปเดตไม่มีฟังก์ชันเหล่านี้ — ถ้าเรียกตรง ๆ หน้าโพสต์พังทั้งหน้า
//      เทสต์บังคับว่า "ไม่มีฟังก์ชัน" ต้องได้ available=false + ข้อความไทย ไม่ใช่ TypeError
//   3) ⭐ สองฝั่งต้องตรงกัน: ทุกช่องที่ preload เปิด ต้องมี handler ใน main และกลับกัน
//      (ลืมฝั่งใดฝั่งหนึ่ง = กดแล้วเงียบ ซึ่งหาสาเหตุยากมาก)
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POST_DIR = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'business', 'post');
const ELECTRON_DIR = path.join(ROOT, 'sovereign-frontend', 'electron');

const bridgeMod = await import(`file:///${path.join(POST_DIR, 'bridge.ts').replace(/\\/g, '/')}`);
const { youtubeBridge, postBridge } = bridgeMod;
const NO_YOUTUBE = bridgeMod.NO_YOUTUBE;

/** หน้าต่างของ Electron รุ่นใหม่ (มีฟังก์ชัน YouTube ครบ) */
function modernSovereign(over = {}) {
  return {
    youtubeStatus: async () => ({ ok: true, secure: true, hasClient: true, connected: true, channelTitle: 'ช่องทดสอบ', clientHint: 'abc...', freePerDay: 6 }),
    youtubeImportDialog: async () => ({ ok: true, clientHint: 'abc...' }),
    youtubeImportText: async (t) => ({ ok: typeof t === 'string' && t.length > 0 }),
    youtubeConnect: async () => ({ ok: true, channelTitle: 'ช่องทดสอบ' }),
    youtubeDisconnect: async () => ({ ok: true }),
    youtubeCancel: async () => ({ ok: true }),
    youtubeUpload: async (req) => ({ ok: true, videoId: 'VID-' + (req && req.title ? 'T' : 'X') }),
    ...over,
  };
}

describe('youtubeBridge — ตรวจสภาพแวดล้อม', () => {
  test('ไม่ใช่แอปเดสก์ท็อป (ไม่มี window) → null', () => {
    assert.equal(youtubeBridge(undefined), null);
    assert.equal(youtubeBridge(null), null);
    assert.equal(youtubeBridge({}), null);
  });

  test('⭐ แอปเวอร์ชันเก่า (ไม่มีฟังก์ชัน YouTube) → available=false ไม่ใช่ TypeError', () => {
    const b = youtubeBridge({ sovereign: { pickVideo: async () => null } });
    assert.ok(b, 'ยังต้องคืนอ็อบเจ็กต์ให้ UI ตัดสินใจได้');
    assert.equal(b.available, false);
  });

  test('แอปเวอร์ชันใหม่ → available=true', () => {
    assert.equal(youtubeBridge({ sovereign: modernSovereign() }).available, true);
  });

  test('มีไม่ครบ (ขาด youtubeUpload) → ถือว่าใช้ไม่ได้ (ไม่ให้กดครึ่ง ๆ)', () => {
    const s = modernSovereign();
    delete s.youtubeUpload;
    assert.equal(youtubeBridge({ sovereign: s }).available, false);
  });

  test('⭐ postBridge เดิมต้องไม่ถูกกระทบ (ของที่เคยใช้ได้ต้องใช้ได้เหมือนเดิม)', () => {
    const b = postBridge({ sovereign: { pickVideo: async () => ({ path: 'C:\\a.mp4', name: 'a.mp4', size: 5 }) } });
    assert.equal(typeof b.pickVideo, 'function');
    assert.equal(b.hasPickVideo, true);
  });
});

describe('youtubeBridge.status — ด่านกันข้อมูลเกินจำเป็น', () => {
  test('⭐ ต้องคืนเฉพาะฟิลด์ที่อนุญาต แม้ main ส่งอะไรมาเกิน', async () => {
    const b = youtubeBridge({ sovereign: modernSovereign({
      youtubeStatus: async () => ({
        ok: true, secure: true, hasClient: true, connected: true,
        channelTitle: 'ช่อง', clientHint: 'h...', freePerDay: 6,
        clientSecret: 'GOCSPX-ห้ามหลุด', refreshToken: 'RT-ห้ามหลุด', accessToken: 'AT-ห้ามหลุด',
      }),
    }) });
    const s = await b.status();
    assert.deepEqual(Object.keys(s).sort(), ['channelTitle', 'clientHint', 'connected', 'freePerDay', 'hasClient', 'secure']);
    assert.ok(!JSON.stringify(s).includes('ห้ามหลุด'));
  });

  test('payload เพี้ยน (ฟิลด์หาย/ผิดชนิด) → ได้ค่าปลอดภัย ไม่ throw', async () => {
    const b = youtubeBridge({ sovereign: modernSovereign({ youtubeStatus: async () => ({ ok: true, secure: 'yes', freePerDay: 0 }) }) });
    const s = await b.status();
    assert.equal(s.secure, false, 'ต้องเป็น false เมื่อค่าไม่ใช่ boolean จริง');
    assert.equal(s.connected, false);
    assert.equal(s.freePerDay, 6, 'freePerDay 0/ไม่ถูกต้อง → ใช้ค่าเริ่มต้น');
  });

  test('IPC ตอบ null (แอปเก่า) → status คืน null ไม่ throw', async () => {
    const b = youtubeBridge({ sovereign: modernSovereign({ youtubeStatus: async () => null }) });
    assert.equal(await b.status(), null);
  });

  test('⭐ IPC reject → ไม่ปล่อย rejection ลอย (จะทำให้หน้าโพสต์พังทั้งหน้า)', async () => {
    const b = youtubeBridge({ sovereign: modernSovereign({ youtubeStatus: async () => { throw new Error('พัง'); } }) });
    assert.equal(await b.status(), null);
  });
});

describe('youtubeBridge — ฟังก์ชันที่เหลือ', () => {
  test('importDialog ส่งต่อ cancelled ถูกต้อง', async () => {
    const yes = youtubeBridge({ sovereign: modernSovereign({ youtubeImportDialog: async () => ({ ok: false, cancelled: true }) }) });
    assert.equal((await yes.importDialog()).cancelled, true);
    const no = youtubeBridge({ sovereign: modernSovereign() });
    assert.equal((await no.importDialog()).cancelled, false);
  });

  test('importText ส่งข้อความไปตามที่พิมพ์ (ไม่ตัด/ไม่แปลง)', async () => {
    let seen = null;
    const b = youtubeBridge({ sovereign: modernSovereign({ youtubeImportText: async (t) => { seen = t; return { ok: true }; } }) });
    await b.importText('  {"installed":{}}  ');
    assert.equal(seen, '  {"installed":{}}  ');
  });

  test('upload ส่งคำขอครบทุกฟิลด์ตามที่ UI ตั้งใจ', async () => {
    let seen = null;
    const b = youtubeBridge({ sovereign: modernSovereign({ youtubeUpload: async (r) => { seen = r; return { ok: true, videoId: 'V' }; } }) });
    const req = { filePath: 'C:\\v.mp4', title: 'ชื่อ', description: 'คำอธิบาย', privacy: 'unlisted' };
    const r = await b.upload(req);
    assert.equal(r.ok, true);
    assert.equal(r.videoId, 'V');
    assert.deepEqual(seen, req);
  });

  test('ฟังก์ชันที่ไม่มีในแอปเก่า → ข้อความไทย ไม่ใช่ TypeError', async () => {
    const b = youtubeBridge({ sovereign: { pickVideo: async () => null } });
    for (const fn of ['importText', 'connect', 'disconnect']) {
      const r = await b[fn]('x');
      assert.equal(r.ok, false);
      assert.equal(r.message, NO_YOUTUBE);
    }
    assert.equal((await b.upload({})).message, NO_YOUTUBE);
    assert.equal((await b.cancel()).ok, false);
  });

  test('disconnect ที่ IPC reject → คืน ok:false ไม่ทำให้หน้าพัง', async () => {
    const b = youtubeBridge({ sovereign: modernSovereign({ youtubeDisconnect: async () => { throw new Error('x'); } }) });
    assert.equal((await b.disconnect()).ok, false);
  });
});

describe('youtubeBridge.onProgress', () => {
  test('สมัครรับแล้วได้ความคืบหน้าจริง และถอนการสมัครได้', () => {
    let handler = null;
    let removed = 0;
    const b = youtubeBridge({ sovereign: modernSovereign({
      onYoutubeProgress: (cb) => { handler = cb; return () => { removed++; }; },
    }) });
    const got = [];
    const off = b.onProgress((p) => got.push(p));
    assert.equal(typeof handler, 'function');
    handler({ sent: 10, total: 100 });
    assert.deepEqual(got, [{ sent: 10, total: 100 }]);
    off();
    assert.equal(removed, 1);
  });

  test('แอปเก่าไม่มี onYoutubeProgress → คืน no-op ไม่ throw', () => {
    const b = youtubeBridge({ sovereign: { pickVideo: async () => null } });
    const off = b.onProgress(() => {});
    assert.equal(typeof off, 'function');
    off();
  });

  test('callback ที่ throw ต้องไม่ลามออกไป (UI พังห้ามทำให้ IPC พัง)', () => {
    let handler = null;
    const b = youtubeBridge({ sovereign: modernSovereign({ onYoutubeProgress: (cb) => { handler = cb; return () => {}; } }) });
    b.onProgress(() => { throw new Error('UI พัง'); });
    assert.doesNotThrow(() => handler({ sent: 1, total: 2 }));
  });

  test('payload ที่ไม่ใช่อ็อบเจ็กต์ → ไม่เรียก callback', () => {
    let handler = null;
    const b = youtubeBridge({ sovereign: modernSovereign({ onYoutubeProgress: (cb) => { handler = cb; return () => {}; } }) });
    let n = 0;
    b.onProgress(() => { n++; });
    handler(null);
    handler('ข้อความ');
    handler(42);
    assert.equal(n, 0);
  });
});

describe('⭐ สองฝั่งต้องตรงกัน (preload ↔ main) — ลืมข้างใดข้างหนึ่ง = กดแล้วเงียบ', () => {
  const preload = fs.readFileSync(path.join(ELECTRON_DIR, 'preload.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(ELECTRON_DIR, 'main.js'), 'utf8')
    + fs.readFileSync(path.join(ELECTRON_DIR, 'youtube-ipc.js'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(POST_DIR, 'bridge.ts'), 'utf8');

  const preloadChannels = [...preload.matchAll(/invoke\(\s*'(sovereign:youtube[A-Za-z]+)'/g)].map((m) => m[1]);
  const handledChannels = [...mainSrc.matchAll(/ipcMain\.handle\(\s*'(sovereign:youtube[A-Za-z]+)'/g)].map((m) => m[1]);
  const bridgeFns = [...bridgeSrc.matchAll(/call\(\s*'(youtube[A-Za-z]+)'/g)].map((m) => m[1]);

  test('ทุกช่องที่ preload เปิด ต้องมีคนรับใน main', () => {
    assert.ok(preloadChannels.length >= 7, `พบช่องใน preload แค่ ${preloadChannels.length} — regex เพี้ยน?`);
    const missing = preloadChannels.filter((c) => !handledChannels.includes(c));
    assert.deepEqual(missing, [], `preload เปิดช่องที่ไม่มีคนรับ: ${missing.join(', ')}`);
  });

  test('ทุกช่องที่ main รับ ต้องถูกเปิดใน preload ด้วย', () => {
    const extra = handledChannels.filter((c) => !preloadChannels.includes(c));
    assert.deepEqual(extra, [], `main รับช่องที่ preload ไม่เปิด: ${extra.join(', ')}`);
  });

  test('ทุกฟังก์ชันที่ bridge เรียก ต้องมีอยู่ใน preload', () => {
    assert.ok(bridgeFns.length >= 6, `พบฟังก์ชันใน bridge แค่ ${bridgeFns.length} — regex เพี้ยน?`);
    const missing = bridgeFns.filter((fn) => !new RegExp(`\\b${fn}\\s*:`).test(preload));
    assert.deepEqual(missing, [], `bridge เรียกฟังก์ชันที่ preload ไม่มี: ${missing.join(', ')}`);
  });

  test('⭐ preload ต้องไม่ส่งค่าลับกลับไปที่ renderer (ไม่มี getSecret/getToken)', () => {
    assert.ok(!/getSecret|getToken|readCredential/i.test(preload), '❌ preload เปิดทางให้ renderer ขอความลับ');
  });

  test('main ต้องไม่ log ค่าลับ', () => {
    assert.ok(!/log\([^)]*clientSecret/.test(mainSrc.replace(/\s+/g, ' ')), '❌ มีการ log clientSecret');
  });
});
