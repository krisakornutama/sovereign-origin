// tools/test/social-post.test.mjs
//
// ── เทสต์ของแท็บ "📣 โพสต์" (โพสต์คลิปเดียว → YouTube / Facebook / TikTok / Instagram) ──
//
// บริบทที่ต้องรู้ก่อนอ่านเทสต์ชุดนี้:
//   1) โหมด A (เปิดหน้าเว็บของแพลตฟอร์ม) ทำงานได้ทุกแพลตฟอร์มโดยไม่ต้องขอ API
//      แต่ "เลือกไฟล์วิดีโอให้" ทำอัตโนมัติไม่ได้ — browser บล็อก file input ข้ามแอป
//      → สิ่งที่แอปต้องรับผิดชอบจึงเป็น: ข้อความ + เปิดหน้าที่ถูก + ชี้ไฟล์ให้
//   2) ตัวเลขเพดาน (ชื่อคลิป/คำอธิบาย/ขนาดไฟล์) เป็น "สัญญา" ระหว่าง UI กับแพลตฟอร์ม
//      ถ้าไม่มีเทสต์คุม คนแก้ทีหลังจะเผลอตั้ง 1000 แล้วผู้ใช้อัปโหลดไม่ผ่านโดยไม่รู้สาเหตุ
//   3) ⚠ ความปลอดภัย: ปุ่ม "เปิดหน้าเว็บ" รับ URL ที่ผู้ใช้แก้ได้
//      ถ้าไม่ตรวจ host แบบ "ตรงตัว" ผู้ใช้วางลิงก์ปลอมได้ (youtube.com.evil.com)
//      → มีเทสต์คุมทั้งฝั่ง UI (ไฟล์นี้) และฝั่ง Electron shell (VM ด้านล่าง)
//
// รัน: npm run test:tools  (หรือ node --test tools/test/social-post.test.mjs)
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POST_DIR = path.join(ROOT, 'sovereign-frontend/src/components/business/post');
const ELECTRON_DIR = path.join(ROOT, 'sovereign-frontend/electron');
const MAIN = path.join(ELECTRON_DIR, 'main.js');

// ⚠ ต้องเป็น pathToFileURL(...).href ไม่ใช่ new URL().pathname
//   เพราะโปรเจ็กอยู่บน "E:\My work\..." ที่มีเว้นวรรค (%20) — pathname จะได้ %20 ติดมา
const dir = pathToFileURL(POST_DIR).href;

const model = await import(`${dir}/post-model.ts`);
const validate = await import(`${dir}/post-validate.ts`);
const clip = await import(`${dir}/post-clipboard.ts`);
const bridge = await import(`${dir}/bridge.ts`);

const fsReadFile = (p) => fs.readFileSync(p, 'utf8');

// ══════════════════════════════════════════════════════════════════════════
// ── 1) แพลตฟอร์ม + เพดาน ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('นิยามแพลตฟอร์ม', () => {
  test('มีครบ 4 แพลตฟอร์มที่เจ้าของขอ และเรียงลำดับคงที่', () => {
    assert.deepEqual(model.PLATFORM_KEYS, ['youtube', 'facebook', 'tiktok', 'instagram']);
    assert.equal(model.PLATFORMS.length, 4);
  });

  test('ทุกแพลตฟอร์มมีเพดานเป็นตัวเลขจริง ไม่ใช่ 0/undefined', () => {
    for (const p of model.PLATFORMS) {
      assert.ok(p.titleMax > 0 && p.titleMax <= 200, `${p.key}: titleMax ต้องสมเหตุสมผล (ได้ ${p.titleMax})`);
      assert.ok(p.descMax > 0, `${p.key}: descMax ต้องมีค่า (ได้ ${p.descMax})`);
      assert.ok(p.fileMaxBytes > 0, `${p.key}: fileMaxBytes ต้องมีค่า (ได้ ${p.fileMaxBytes})`);
      assert.ok(/^https:\/\//.test(p.uploadUrl), `${p.key}: หน้าอัปโหลดต้องเป็น https (ได้ ${p.uploadUrl})`);
      assert.ok(p.hosts.length > 0, `${p.key}: ต้องประกาศ host ที่อนุญาต`);
    }
  });

  test('เพดานตรงกับที่แพลตฟอร์มประกาศจริง', () => {
    // YouTube: ชื่อคลิป 100 ตัวอักษร · คำอธิบาย 5,000
    assert.equal(model.platformByKey('youtube').titleMax, 100);
    assert.equal(model.platformByKey('youtube').descMax, 5000);
    // TikTok: แคปชัน 2,200
    assert.equal(model.platformByKey('tiktok').descMax, 2200);
    // Facebook: ยาวกว่าเพื่อน แต่ต้องไม่เกิน 63,206 ของโพสต์
    assert.equal(model.platformByKey('facebook').descMax, 5000);
    // Instagram: แคปชัน 2,200 ตัวอักษร (รวมแฮชแท็ก) · ไฟล์วิดีโอสูงสุด 4 GB
    assert.equal(model.platformByKey('instagram').descMax, 2200);
    assert.equal(model.platformByKey('instagram').fileMaxBytes, 4 * 1024 ** 3);
  });

  test('แพลตฟอร์มที่ไม่รู้จักต้องคืน null ไม่ใช่เดา', () => {
    assert.equal(model.platformByKey('twitter'), null);
    assert.equal(model.platformByKey(''), null);
    assert.equal(model.platformByKey(null), null);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 2) URL หน้าอัปโหลด: ต้องไม่เปิดโดเมนมั่ว ─────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('URL หน้าอัปโหลด (ความปลอดภัย)', () => {
  test('ว่าง = ใช้ค่าเริ่มต้นของแพลตฟอร์ม', () => {
    assert.equal(model.effectiveUploadUrl('youtube', ''), model.platformByKey('youtube').uploadUrl);
    assert.equal(model.effectiveUploadUrl('youtube', '   '), model.platformByKey('youtube').uploadUrl);
    assert.equal(model.effectiveUploadUrl('tiktok'), model.platformByKey('tiktok').uploadUrl);
  });

  test('URL ที่ผู้ใช้แก้เองได้ ถ้าอยู่ในโดเมนของแพลตฟอร์มนั้น', () => {
    const mine = 'https://www.facebook.com/MyShopPage/videos';
    assert.equal(model.effectiveUploadUrl('facebook', mine), mine, 'หน้าร้านของตัวเองต้องใช้ได้');
    assert.equal(model.isAllowedUploadUrl('youtube', 'https://studio.youtube.com/channel/UC123/videos/upload'), true);
  });

  test('⛔ โดเมนปลอมต้องไม่ผ่าน — youtube.com.evil.com คือกับดักคลาสสิก', () => {
    assert.equal(model.isAllowedUploadUrl('youtube', 'https://youtube.com.evil.com/upload'), false);
    assert.equal(model.isAllowedUploadUrl('youtube', 'https://www.youtube.com.evil.com/'), false);
    assert.equal(model.effectiveUploadUrl('youtube', 'https://youtube.com.evil.com/upload'), null,
      'ต้องคืน null ให้ UI เตือน ไม่ใช่คืนค่าเริ่มต้นเงียบ ๆ');
  });

  test('⛔ โปรโตคอลอื่น/http ธรรมดา ไม่ผ่าน', () => {
    assert.equal(model.isAllowedUploadUrl('youtube', 'http://www.youtube.com/upload'), false, 'http ไม่เข้ารหัส');
    assert.equal(model.isAllowedUploadUrl('youtube', 'javascript:alert(1)'), false);
    assert.equal(model.isAllowedUploadUrl('youtube', 'file:///C:/evil.html'), false);
    assert.equal(model.isAllowedUploadUrl('youtube', 'not a url'), false);
  });

  test('⛔ ข้ามแพลตฟอร์มไม่ได้ (เอา host ของ TikTok ไปใส่ช่อง YouTube)', () => {
    assert.equal(model.isAllowedUploadUrl('facebook', 'https://www.tiktok.com/upload'), false);
    assert.equal(model.isAllowedUploadUrl('tiktok', 'https://www.facebook.com/'), false);
    assert.equal(model.isAllowedUploadUrl('instagram', 'https://www.tiktok.com/upload'), false, 'host ของ TikTok ใช้กับ Instagram ไม่ได้');
    assert.equal(model.isAllowedUploadUrl('tiktok', 'https://www.instagram.com/'), false, 'host ของ Instagram ใช้กับ TikTok ไม่ได้');
  });

  test('⛔ ยัดชื่อโดเมนไว้ใน userinfo ก็ไม่ผ่าน', () => {
    assert.equal(model.isAllowedUploadUrl('youtube', 'https://www.youtube.com@evil.com/'), false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 3) นับตัวอักษรให้ตรงกับที่แพลตฟอร์มนับ ───────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('นับตัวอักษร', () => {
  test('นับเป็นตัวอักษรจริง (code point) — อีโมจิ 1 ตัวต้องไม่ถูกนับเป็น 2', () => {
    assert.equal(model.textStatus('สมชาย', 100).len, 5);
    assert.equal(model.textStatus('😀', 100).len, 1, 'อีโมจิ 1 ตัว = 1 ตัวอักษร ไม่ใช่ 2');
    assert.equal(model.textStatus('ก😀ข', 100).len, 3);
  });

  test('บอกจำนวนที่เกิน เพื่อให้ UI บอกได้ว่า "เกินอีกกี่ตัว"', () => {
    assert.deepEqual(model.textStatus('abc', 5), { len: 3, over: 0, ok: true });
    assert.deepEqual(model.textStatus('abcdefg', 5), { len: 7, over: 2, ok: false });
    assert.equal(model.textStatus('', 5).ok, true);
  });

  test('clipToLimit ตัดพอดีเพดานและไม่ทำให้ยาวเกิน', () => {
    assert.equal(model.clipToLimit('abcdefg', 5), 'abcde');
    assert.equal(model.clipToLimit('abc', 5), 'abc', 'สั้นกว่าเพดานต้องไม่ถูกแตะ');
    assert.equal([...model.clipToLimit('😀😀😀', 2)].length, 2, 'ต้องนับอีโมจิเป็นตัว ไม่ตัดกลางตัว');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 4) ตรวจไฟล์วิดีโอ ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('ตรวจไฟล์วิดีโอ', () => {
  const yt = () => model.platformByKey('youtube');
  const tiktok = () => model.platformByKey('tiktok');

  test('นามสกุลวิดีโอรู้จักทั้งตัวพิมพ์เล็กและใหญ่', () => {
    for (const n of ['a.mp4', 'a.MP4', 'a.Mov', 'a.webm', 'a.mkv', 'a.avi', 'a.m4v']) {
      assert.equal(validate.isVideoFile(n), true, `${n} ต้องถือเป็นวิดีโอ`);
    }
    assert.equal(validate.videoExt('a.MP4'), 'mp4');
  });

  test('ไฟล์ที่ไม่ใช่วิดีโอต้องไม่ผ่าน', () => {
    for (const n of ['a.jpg', 'a.pdf', 'a.zip', 'noext', 'a.mp4.exe']) {
      assert.equal(validate.isVideoFile(n), false, `${n} ต้องไม่ถือเป็นวิดีโอ`);
    }
  });

  test('ไฟล์วิดีโอปกติผ่าน', () => {
    const r = validate.videoCheck('คลิป.mp4', 500 * 1024 * 1024, yt());
    assert.equal(r.ok, true, r.reason);
  });

  test('ไฟล์ 0 ไบต์ = ยังไม่ได้เลือกจริง ต้องไม่ผ่าน', () => {
    assert.equal(validate.videoCheck('a.mp4', 0, yt()).ok, false);
  });

  test('เกินเพดานของแพลตฟอร์มที่เลือกต้องไม่ผ่าน และบอกเหตุผลที่อ่านรู้เรื่อง', () => {
    const r = validate.videoCheck('big.mp4', tiktok().fileMaxBytes + 1, tiktok());
    assert.equal(r.ok, false);
    assert.match(r.reason, /ใหญ่เกิน/, 'ต้องบอกว่าใหญ่เกิน');
    assert.match(r.reason, /TikTok/, 'ต้องบอกว่าเกินของแพลตฟอร์มไหน');
  });

  test('ไฟล์เดียวกันอาจผ่าน YouTube แต่ไม่ผ่าน TikTok (เพดานต่างกันจริง)', () => {
    const size = tiktok().fileMaxBytes + 1024 * 1024;
    assert.equal(validate.videoCheck('a.mp4', size, yt()).ok, true, 'ยังไม่เกินเพดาน YouTube');
    assert.equal(validate.videoCheck('a.mp4', size, tiktok()).ok, false, 'เกินเพดาน TikTok');
  });

  test('formatBytes อ่านรู้เรื่องและไม่โชว์ทศนิยมเฟ้อ', () => {
    assert.equal(validate.formatBytes(0), '0 B');
    assert.equal(validate.formatBytes(512), '512 B');
    assert.equal(validate.formatBytes(1024 * 1024), '1 MB');
    assert.equal(validate.formatBytes(1536 * 1024), '1.5 MB');
    assert.equal(validate.formatBytes(4 * 1024 ** 3), '4 GB');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 5) ร่างงาน (จำสิ่งที่เจ้าของพิมพ์ไว้ ไม่ให้หาย) ───────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('ร่างงาน', () => {
  const KEYS = model.PLATFORM_KEYS;

  test('ร่างว่างมีครบทุกช่องของทุกแพลตฟอร์ม', () => {
    const d = model.emptyDraft(KEYS);
    for (const k of KEYS) {
      assert.equal(d.captions[k], '');
      assert.equal(d.hashtags[k], '');
      assert.equal(d.uploadUrls[k], '');
    }
    assert.deepEqual(d.targets, []);
  });

  test('ไฟล์เพี้ยน/ว่าง/null ต้องกู้เป็นร่างว่าง ไม่ใช่ throw', () => {
    for (const bad of [null, undefined, 0, 'x', [], { captions: 'nope' }]) {
      const d = model.normalizeDraft(bad, KEYS);
      assert.equal(typeof d.title, 'string');
      assert.deepEqual(d.targets, []);
    }
  });

  test('ไฟล์ร่างที่ขาดช่อง (ของเวอร์ชันเก่า) ต้องเติมให้ครบ ไม่ทำให้หน้าพัง', () => {
    const d = model.normalizeDraft({ title: 'คลิปใหม่', captions: { youtube: 'สวัสดี' } }, KEYS);
    assert.equal(d.title, 'คลิปใหม่');
    assert.equal(d.captions.youtube, 'สวัสดี');
    assert.equal(d.captions.tiktok, '', 'ช่องที่ไม่มีต้องกลายเป็นสตริงว่าง');
  });

  test('ปลายทางที่ไม่รู้จักถูกตัดทิ้ง และตัดตัวซ้ำ', () => {
    const d = model.normalizeDraft({ targets: ['youtube', 'youtube', 'twitter', 5] }, KEYS);
    assert.deepEqual(d.targets, ['youtube']);
  });

  test('ขนาดไฟล์เพี้ยน (ค่าติดลบ/NaN/สตริง) ต้องถูกทำให้เป็น 0 ไม่ใช่พา NaN ไปทั้งหน้า', () => {
    for (const bad of [-5, Number.NaN, 'big', Infinity, null]) {
      const d = model.normalizeDraft({ videoSize: bad }, KEYS);
      assert.equal(d.videoSize, 0, `videoSize=${String(bad)} ต้องกลายเป็น 0`);
    }
    assert.equal(model.normalizeDraft({ videoSize: 1234 }, KEYS).videoSize, 1234);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 6) ประกอบคำอธิบาย (เจ้าของขอ "แยกแก้ต่อ platform") ──────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('ประกอบคำอธิบาย', () => {
  const KEYS = model.PLATFORM_KEYS;
  // ⚠ ต้องรับ key เข้ามาด้วย — ถ้าตั้งค่าให้ youtube แล้วเรียกด้วย tiktok
  //   จะได้สตริงว่างแล้วเทสต์ล้มด้วยเหตุผลผิด ๆ (เจอจริงตอนเขียนเทสต์ชุดนี้)
  const withText = (cap, tags, key = 'youtube') => {
    const d = model.emptyDraft(KEYS);
    d.captions[key] = cap;
    d.hashtags[key] = tags;
    return d;
  };

  test('คำอธิบาย + แฮชแท็ก ต่อกันด้วยบรรทัดว่าง', () => {
    assert.equal(model.buildCaption(withText('รีวิวเซนเซอร์', '#iot #esp32'), 'youtube'), 'รีวิวเซนเซอร์\n\n#iot #esp32');
  });

  test('แฮชแท็กที่ลืมใส่ # ต้องเติมให้เอง', () => {
    assert.equal(model.buildCaption(withText('ก', 'iot esp32'), 'youtube'), 'ก\n\n#iot #esp32');
  });

  test('แฮชแท็กคั่นด้วยลูกน้ำ/เว้นวรรคซ้ำ ก็ยังออกมาสวย', () => {
    assert.equal(model.buildCaption(withText('ก', 'iot, esp32  ,smartfarm'), 'youtube'), 'ก\n\n#iot #esp32 #smartfarm');
  });

  test('ไม่มีแฮชแท็ก = ได้แค่คำอธิบาย (ห้ามมีบรรทัดว่างหาง)', () => {
    assert.equal(model.buildCaption(withText('ก', ''), 'youtube'), 'ก');
    assert.equal(model.buildCaption(withText('ก', '   '), 'youtube'), 'ก');
  });

  test('ไม่มีคำอธิบาย = ได้แค่แฮชแท็ก (ห้ามมีบรรทัดว่างหัว)', () => {
    assert.equal(model.buildCaption(withText('', '#iot'), 'youtube'), '#iot');
  });

  test('ว่างทั้งคู่ = สตริงว่าง (ให้ UI เตือนได้ ไม่ใช่ส่งช่องว่างเปล่า)', () => {
    assert.equal(model.buildCaption(withText('', ''), 'youtube'), '');
  });

  test('คำอธิบายที่ลงท้ายด้วยบรรทัดว่างอยู่แล้ว ต้องไม่กลายเป็น 3 บรรทัด', () => {
    assert.equal(model.buildCaption(withText('ก\n\n', '#iot'), 'youtube'), 'ก\n\n#iot');
  });

  test('แฮชแท็กยาวไม่จำกัดจำนวน (TikTok ชอบเยอะ) — ต้องคงไว้ครบ', () => {
    const many = Array.from({ length: 30 }, (_, i) => `tag${i}`).join(' ');
    const out = model.buildCaption(withText('ก', many, 'tiktok'), 'tiktok');
    assert.equal(out.split('\n\n')[1].split(' ').length, 30, 'ต้องไม่ตัดแฮชแท็กของเจ้าของทิ้ง');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 7) คัดลอกข้อความ ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('คัดลอกข้อความ', () => {
  test('คัดลอกผ่านเมื่อเบราว์เซอร์มี clipboard API', async () => {
    let got = null;
    const ok = await clip.copyVia({ clipboard: { writeText: async (t) => { got = t; } } }, 'สวัสดี');
    assert.equal(ok, true);
    assert.equal(got, 'สวัสดี');
  });

  test('เบราว์เซอร์ไม่มี clipboard (http/ใน Electron บางโหมด) = คืน false ไม่ใช่ throw', async () => {
    assert.equal(await clip.copyVia({}, 'x'), false);
    assert.equal(await clip.copyVia(undefined, 'x'), false);
  });

  test('clipboard โยน error (ไม่ได้โฟกัส/ไม่ได้รับอนุญาต) = คืน false ให้ UI บอกผู้ใช้ได้', async () => {
    const nav = { clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } };
    assert.equal(await clip.copyVia(nav, 'x'), false);
  });

  test('ไม่คัดลอกสตริงว่าง (ผู้ใช้จะคิดว่าคัดลอกแล้วทั้งที่ไม่มีอะไร)', async () => {
    let called = false;
    const nav = { clipboard: { writeText: async () => { called = true; } } };
    assert.equal(await clip.copyVia(nav, '   '), false);
    assert.equal(called, false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 7.5) สะพานไป Electron shell ────────────────────────────────────────
//    ⚠ เคสสำคัญ: แอปที่ติดตั้งไว้แล้วอาจเป็นเวอร์ชันเก่าที่ยังไม่มี pickVideo
//      ถ้าเรียกฟังก์ชันที่ไม่มีแล้วปล่อยให้โยน error "ทั้งหน้าโพสต์จะพัง"
//      → ต้องคืนค่าที่ UI เอาไปบอกผู้ใช้ได้ ไม่ใช่พัง
// ══════════════════════════════════════════════════════════════════════════
describe('สะพานไป Electron shell', () => {
  test('เว็บเพลน ๆ (ไม่มี window.sovereign) = คืน null ไม่ใช่ throw', () => {
    assert.equal(bridge.postBridge(undefined), null);
    assert.equal(bridge.postBridge(null), null);
    assert.equal(bridge.postBridge({}), null);
    assert.equal(bridge.postBridge({ sovereign: 'yes' }), null);
  });

  test('ส่งคำสั่งเปิดลิงก์ต่อได้ และคืนผลลัพธ์ตามที่ shell ตอบ', async () => {
    const seen = [];
    const b = bridge.postBridge({ sovereign: { openExternal: (u) => { seen.push(u); return { ok: true }; } } });
    assert.equal((await b.openExternal('https://www.youtube.com/upload')).ok, true);
    assert.deepEqual(seen, ['https://www.youtube.com/upload']);
  });

  test('แอปเก่าที่ไม่มี showItemInFolder ต้องคืนข้อความ ไม่ใช่พังทั้งหน้า', async () => {
    const b = bridge.postBridge({ sovereign: { openExternal: () => ({ ok: true }) } });
    const r = await b.showItemInFolder('E:\\clip.mp4');
    assert.equal(r.ok, false);
    assert.ok(r.message && r.message.length > 0, 'ต้องมีข้อความให้ UI แสดง');
    assert.equal(r.message, bridge.NO_REVEAL_FOLDER);
  });

  test('บอกได้ว่าแอปนี้มีปุ่มเลือกวิดีโอในตัวไหม (แอปเก่า → UI ต้องถอยไปใช้ <input type=file>)', () => {
    const withPick = bridge.postBridge({ sovereign: { openExternal: () => ({ ok: true }), pickVideo: () => null } });
    assert.equal(withPick.hasPickVideo, true);

    const old = bridge.postBridge({ sovereign: { openExternal: () => ({ ok: true }) } });
    assert.equal(old.hasPickVideo, false, 'ถ้าไม่รู้ว่ามีปุ่มเลือก ต้องไม่โชว์ปุ่มที่กดแล้วเงียบ');
  });

  test('⛔ shell โยน error (หรือ reject) ต้องกลายเป็น ok:false ไม่ใช่ UnhandledRejection', async () => {
    const b = bridge.postBridge({ sovereign: { openExternal: () => { throw new Error('boom'); } } });
    const r = await b.openExternal('https://www.youtube.com/upload');
    assert.equal(r.ok, false);
    assert.equal(r.message, bridge.NO_OPEN_EXTERNAL);

    const b2 = bridge.postBridge({ sovereign: { openExternal: () => Promise.reject(new Error('boom')) } });
    assert.equal((await b2.openExternal('https://x/')).ok, false);
  });

  test('pickVideo ปรับข้อมูลให้สะอาดก่อนส่งเข้า UI', async () => {
    const b = bridge.postBridge({
      sovereign: { openExternal: () => ({ ok: true }), pickVideo: () => ({ path: 'E:\\a\\clip.mp4', name: 'clip.mp4', size: 1234 }) },
    });
    assert.deepEqual(await b.pickVideo(), { path: 'E:\\a\\clip.mp4', name: 'clip.mp4', size: 1234 });
  });

  test('pickVideo: กดยกเลิก → null · ขนาดเพี้ยน → 0 · ชื่อว่าง → อนุมานจากพาธ', async () => {
    const mk = (ret) => bridge.postBridge({ sovereign: { openExternal: () => ({ ok: true }), pickVideo: () => ret } });
    assert.equal(await mk(null).pickVideo(), null);
    assert.equal(await mk({ canceled: true }).pickVideo(), null);

    const noName = await mk({ path: 'E:\\a\\b\\clip.mp4', name: '', size: 'big' }).pickVideo();
    assert.equal(noName.name, 'clip.mp4', 'ชื่อว่างต้องอนุมานจากพาธ ไม่ใช่ปล่อยให้ UI โชว์ช่องว่าง');
    assert.equal(noName.size, 0, 'ขนาดที่ไม่ใช่ตัวเลขต้องกลายเป็น 0');

    const noSize = await mk({ path: 'E:\\a\\clip.mp4', size: Number.NaN }).pickVideo();
    assert.equal(noSize.size, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 7.6) Facebook/TikTok vs ช่องชื่อคลิป ───────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('ช่องชื่อคลิปของแต่ละแพลตฟอร์ม', () => {
  test('TikTok ไม่มีช่องชื่อคลิปแยก (ชื่ออยู่ในแคปชัน) — YouTube/Facebook มี', () => {
    assert.equal(model.platformByKey('youtube').hasTitleField, true);
    assert.equal(model.platformByKey('facebook').hasTitleField, true);
    assert.equal(model.platformByKey('tiktok').hasTitleField, false);
    assert.equal(model.platformByKey('instagram').hasTitleField, false, 'Instagram ไม่มีช่องชื่อคลิปแยก — ชื่ออยู่ในแคปชัน');
  });

  test('ปุ่ม "คัดลอกชื่อคลิป" ควรโผล่เฉพาะแพลตฟอร์มที่มีช่องชื่อจริง', () => {
    const ui = fsReadFile(path.join(POST_DIR, 'PostTargets.tsx'));
    assert.match(ui, /spec\.hasTitleField\s*&&/, 'ต้องผูกการแสดงปุ่มกับ hasTitleField ไม่ใช่ชื่อแพลตฟอร์มตรง ๆ');
    assert.doesNotMatch(ui, /===\s*'tiktok'/, 'ห้าม hardcode ชื่อแพลตฟอร์มใน UI');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 8) Electron shell: allowlist + IPC ใหม่ ─────────────────────────────
//    เทสต์แบบรัน main.js จริงใน VM (Electron ถูก stub) — ไม่ใช่ source assertion
// ══════════════════════════════════════════════════════════════════════════
function loadShell(opts = {}) {
  const require = createRequire(import.meta.url);
  const handlers = new Map();
  const calls = { openExternal: [], showItemInFolder: [], openPath: [], dialogs: [] };
  const mkWin = () => ({
    once() {}, on() {}, show() {}, hide() {}, focus() {}, restore() {}, close() {},
    isMinimized: () => false, isDestroyed: () => false,
    loadURL: () => Promise.resolve(), loadFile: () => Promise.resolve(),
    webContents: { send() {}, on() {} },
  });
  const app = {
    isPackaged: false, getVersion: () => '1.1.1', getName: () => 'Sovereign OS',
    getPath: () => opts.userData || os.tmpdir(),
    whenReady: () => new Promise(() => {}),   // ไม่ให้ boot() ทำงานระหว่างเทสต์
    on() {}, quit() {}, setLoginItemSettings() {}, requestSingleInstanceLock: () => true,
  };
  const electron = {
    app,
    BrowserWindow: class { constructor() { return mkWin(); } },
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on() {} },
    dialog: {
      showOpenDialog: async () => { calls.dialogs.push('open'); return opts.openResult || { canceled: true, filePaths: [] }; },
      showMessageBox: async () => ({ response: 0 }),
    },
    shell: {
      openExternal: (u) => calls.openExternal.push(u),
      openPath: (p) => calls.openPath.push(p),
      showItemInFolder: (p) => calls.showItemInFolder.push(p),
    },
    Menu: { buildFromTemplate: (t) => t },
    // main.js ส่งต่อให้ youtube-ipc ตอนเริ่ม — ต้องมี ไม่งั้นโหลด main.js ใน VM ไม่ผ่าน
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from('ENC|' + Buffer.from(String(s), 'utf8').toString('base64'), 'utf8'),
      decryptString: (b) => Buffer.from(String(b).slice(4), 'base64').toString('utf8'),
    },
    Tray: class { constructor() { return { setToolTip() {}, setContextMenu() {}, on() {} }; } },
  };
  const sandbox = {
    require: (id) => {
      if (id === 'electron') return electron;
      // โมดูลในเครื่องของ shell (./x) ทุกตัว resolve จากโฟลเดอร์ electron เสมอ
      // ⚠ อย่ากลับไปไล่ชื่อทีละตัว — เพิ่มโมดูลใหม่แล้วเทสต์ทั้งไฟล์จะล้มโดยไม่เกี่ยวกับบั๊กจริง
      if (typeof id === 'string' && id.startsWith('./')) return require(path.join(ELECTRON_DIR, `${id.slice(2)}.js`));
      return require(id);
    },
    console: { log() {}, error() {}, warn() {} },
    process: { ...process, env: { ...process.env } },
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    URL, Promise, Date, Math, JSON, RegExp, Error,
    __dirname: ELECTRON_DIR, __filename: MAIN,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fsReadFile(MAIN), sandbox, { filename: 'main.js' });
  return { handlers, calls };
}

describe('Electron shell — เปิดหน้าเว็บ', () => {
  test('เปิดหน้าของแพลตฟอร์มได้จริง', () => {
    const { handlers, calls } = loadShell();
    const open = handlers.get('sovereign:openExternal');
    assert.ok(open, 'ต้องมี sovereign:openExternal');
    for (const u of ['https://www.youtube.com/upload', 'https://www.facebook.com/', 'https://www.tiktok.com/tiktokstudio/upload', 'https://www.instagram.com/']) {
      assert.equal(open(null, u).ok, true, `${u} ต้องเปิดได้`);
      assert.equal(calls.openExternal.at(-1), u);
    }
  });

  test('⛔ ยังคงกันโดเมนมั่วเหมือนเดิม (ห้ามเผลอเปิดกว้างทั้ง https)', () => {
    const { handlers, calls } = loadShell();
    const open = handlers.get('sovereign:openExternal');
    const before = calls.openExternal.length;
    for (const u of ['https://evil.com/', 'https://youtube.com.evil.com/', 'http://www.youtube.com/', 'file:///C:/x.html']) {
      assert.equal(open(null, u).ok, false, `${u} ต้องถูกปฏิเสธ`);
    }
    assert.equal(calls.openExternal.length, before, 'ห้ามมี URL ที่ถูกปฏิเสธหลุดไปถึง shell.openExternal');
  });

  test('ยังเปิด localhost ได้เหมือนเดิม (offline page ใช้อยู่)', () => {
    const { handlers, calls } = loadShell();
    const open = handlers.get('sovereign:openExternal');
    assert.equal(open(null, 'http://localhost:4100/').ok, true);
    assert.equal(calls.openExternal.at(-1), 'http://localhost:4100/');
  });
});

describe('Electron shell — IPC สำหรับวิดีโอ', () => {
  test('มี IPC ใหม่ครบและ preload เปิดให้ renderer ใช้', () => {
    const { handlers } = loadShell();
    assert.ok(handlers.get('sovereign:pickVideo'), 'ต้องมี sovereign:pickVideo');
    assert.ok(handlers.get('sovereign:showItemInFolder'), 'ต้องมี sovereign:showItemInFolder');
    const preload = fsReadFile(path.join(ELECTRON_DIR, 'preload.js'));
    assert.match(preload, /pickVideo:/, 'preload ต้องเปิด pickVideo');
    assert.match(preload, /showItemInFolder:/, 'preload ต้องเปิด showItemInFolder');
  });

  test('pickVideo คืนแค่ metadata — ⛔ ห้ามอ่านไฟล์ทั้งก้อน (วิดีโอ 1GB จะทำแอปตาย)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-pickvid-'));
    const vid = path.join(tmp, 'clip.mp4');
    fs.writeFileSync(vid, Buffer.alloc(2048));
    try {
      const { handlers } = loadShell({ openResult: { canceled: false, filePaths: [vid] } });
      const src = fsReadFile(MAIN);
      const fn = /ipcMain\.handle\('sovereign:pickVideo'[\s\S]*?\n\}\);/.exec(src);
      assert.ok(fn, 'ต้องมี handler sovereign:pickVideo');
      assert.doesNotMatch(fn[0], /readFileSync/, 'pickVideo ห้าม readFileSync ทั้งไฟล์');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('showItemInFolder ปฏิเสธพาธที่ไม่ใช่ไฟล์จริง (ไม่เปิด Explorer มั่ว)', () => {
    const { handlers, calls } = loadShell();
    const reveal = handlers.get('sovereign:showItemInFolder');
    assert.equal(reveal(null, 'C:\\does\\not\\exist\\nope.mp4').ok, false);
    assert.equal(reveal(null, '').ok, false, 'สตริงว่างต้องไม่ผ่าน');
    assert.equal(reveal(null, 12345).ok, false, 'ไม่ใช่สตริงต้องไม่ผ่าน');
    assert.equal(calls.showItemInFolder.length, 0, 'ห้ามเรียก shell จริงเมื่อพาธไม่ผ่าน');
  });

  test('showItemInFolder เปิดโฟลเดอร์ได้เมื่อมีไฟล์จริง', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-reveal-'));
    const vid = path.join(tmp, 'clip.mp4');
    fs.writeFileSync(vid, 'x');
    try {
      const { handlers, calls } = loadShell();
      assert.equal(handlers.get('sovereign:showItemInFolder')(null, vid).ok, true);
      assert.equal(calls.showItemInFolder.at(-1), vid);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('ความสอดคล้องระหว่าง UI กับ Electron', () => {
  test('host ที่ UI อนุญาต ต้องอยู่ใน allowlist ของ main.js ด้วย (ไม่งั้นกดเปิดแล้วเงียบ)', () => {
    const src = fsReadFile(MAIN);
    const declared = new Set(
      [...src.matchAll(/^\s*'([a-z0-9.-]+)',\s*$/gmi)].map((m) => m[1].toLowerCase())
    );
    for (const p of model.PLATFORMS) {
      for (const h of p.hosts) {
        assert.ok(declared.has(h.toLowerCase()),
          `${p.key}: host "${h}" ผ่านด่าน UI แต่ไม่มีใน main.js → ผู้ใช้กดแล้วไม่มีอะไรเกิดขึ้น`);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ── 9) วินัยของไฟล์ logic (เจอจริง 17/10/69) ────────────────────────────
// ══════════════════════════════════════════════════════════════════════════
describe('วินัยของไฟล์ logic', () => {
  test('ไฟล์ logic ที่เทสต์เรียกตรงต้องใช้ import type เท่านั้น', () => {
    for (const f of ['post-model.ts', 'post-validate.ts', 'post-clipboard.ts', 'bridge.ts']) {
      const src = fsReadFile(path.join(POST_DIR, f));
      // ⚠ ต้องดูที่ "หัวประโยค import" ไม่ใช่ที่ path — `import type { X } from './y'`
      //   ถ้าไปดูแค่ path จะเห็น './y' แล้วสรุปผิดว่าเป็น value import
      const bad = [...src.matchAll(/^\s*import\s+([\s\S]+?)\s+from\s+'([^']+)'/gm)]
        .filter((m) => !/^type\b/.test(m[1].trim()))
        .map((m) => `${m[1].trim()} ← ${m[2]}`);
      assert.deepEqual(bad, [], `${f}: ห้ามมี value import เพราะ Node เรียกตรง ๆ ไม่ได้ — เจอ ${bad.join(' | ')}`);
    }
  });

  test('UI ของโพสต์ต้องไม่ข้ามไปหยิบของจากโฟลเดอร์ feature อื่น (frontend-gate import-layers)', () => {
    for (const f of fs.readdirSync(POST_DIR)) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = fsReadFile(path.join(POST_DIR, f));
      const rel = [...src.matchAll(/from\s+'(\.\.\/[^']+)'/g)].map((m) => m[1]);
      const crossFeature = rel.filter((r) => !r.startsWith('../../../lib') && !r.startsWith('../../ui') && !r.startsWith('../../layout'));
      assert.deepEqual(crossFeature, [], `${f}: ห้าม import ข้ามโฟลเดอร์ feature — เจอ ${crossFeature.join(', ')}`);
    }
  });
});
