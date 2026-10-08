import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptureScript, createFrameParser, fpsToIntervalMs, startScreenStream } from '../src/screen.mjs';
import { buildCSharp, buildInputScript, createInputHost, resolveKeyCode, toHostCommand, MOUSE_BUTTONS } from '../src/input.mjs';

// ── ฝั่งเครื่องที่ 2: ตัวจับภาพ + ตัวฉีดอินพุต ────────────────────────────────
//
// เทสต์ชุดนี้คุม "รูปร่างของสคริปต์" และ "การแปลงคำสั่ง" ซึ่งเป็นจุดที่พังเงียบ
// มากที่สุด เพราะไม่มี error ให้เห็นเมื่อสคริปต์ที่ส่งให้ PowerShell ผิดไวยากรณ์
// หรือ AV บล็อกทั้งก้อน (เจอจริงมาแล้วทั้งสองแบบ)
//
// จึงมีสองด่านที่ต้องยืนยันทุกครั้งที่แก้สคริปต์:
//   1) ห้ามมีอักขระที่ทำให้ quoting พัง (double quote ใน PS, single quote ใน C#)
//   2) ห้ามมีไวยากรณ์ที่พังเมื่อถูก join ด้วย '; ' (เช่น elseif ที่ต่อจาก })

describe('screen — สคริปต์จับภาพต้องปลอดกับ PowerShell และ AV', () => {
  const script = buildCaptureScript({ intervalMs: 250, maxWidth: 1024 });

  test('เป็นบรรทัดเดียว (ส่งทาง -Command เท่านั้น)', () => {
    assert.equal(script.includes('\n'), false, 'มี newline = ต้องใช้ -EncodedCommand ซึ่ง AV บล็อก');
  });

  test('ห้ามมี double quote — ใช้ single quote ของ PowerShell แทน', () => {
    assert.equal(script.includes('"'), false, `พบ " ในสคริปต์: ${script.slice(0, 120)}`);
  });

  test('ห้ามใช้ GetImageEncoders/EncoderParameters (ถูก AV บล็อกเมื่อรวมกับจับจอ)', () => {
    assert.equal(script.includes('GetImageEncoders'), false);
    assert.equal(script.includes('EncoderParameters'), false);
    assert.ok(script.includes('[System.Drawing.Imaging.ImageFormat]::Jpeg'), 'ต้องบันทึกเป็น JPEG จาก ImageFormat ในตัว');
  });

  test('ฝังค่า interval และความกว้างสูงสุดตามที่ขอ', () => {
    assert.ok(script.includes('$maxW = 1024'));
    assert.ok(script.includes('Start-Sleep -Milliseconds 250'));
  });

  test('ค่าที่ผิดรูปต้องถูกตัดให้อยู่ในกรอบ ไม่ส่งค่าขยะไปให้ PowerShell', () => {
    const weird = buildCaptureScript({ intervalMs: -50, maxWidth: 0 });
    assert.ok(weird.includes('$maxW = 1280'), 'maxWidth 0 → ใช้ค่าเริ่มต้น');
    assert.ok(weird.includes('Start-Sleep -Milliseconds 0'), 'interval ติดลบ → 0 (ไม่ค้างติดลบ)');
  });

  test('มี try/catch ในลูป — จอถูกล็อกต้องไม่ฆ่าลูปทิ้ง', () => {
    assert.ok(script.includes('} catch {'), 'ต้องมี catch ในลูป');
    assert.ok(script.includes('capture-failed'), 'ต้องรายงานความล้มเหลวให้เห็น');
  });
});

describe('screen — fps และตัวแยกเฟรม', () => {
  test('fps → ช่วงเวลา และถูกตัดเพดานเสมอ', () => {
    assert.equal(fpsToIntervalMs(5), 200);
    assert.equal(fpsToIntervalMs(10), 100);
    assert.equal(fpsToIntervalMs(999), 67, 'เพดาน 15 fps → 67ms');
    assert.equal(fpsToIntervalMs(0), 200, 'fps 0 = ไม่ระบุ → 5 fps');
    assert.equal(fpsToIntervalMs('abc'), 200);
    assert.equal(fpsToIntervalMs(-1), 200);
  });

  test('แยกเฟรมจาก chunk ที่ตัดกลางบรรทัดได้', () => {
    const parser = createFrameParser();
    const b64 = 'A'.repeat(80);

    // ครึ่งแรกของบรรทัดขนาด — ยังไม่ครบ ต้องไม่ปล่อยอะไรออกมา
    assert.deepEqual(parser.push('W=800 H=4'), []);
    // ต่อให้ครบ + ตามด้วยข้อมูลภาพที่ยังไม่มี newline ปิดท้าย
    assert.deepEqual(parser.push('50\n' + b64), []);
    // ปิดบรรทัดภาพ → ได้ 1 เฟรม พร้อมขนาดที่จำไว้
    const frames = parser.push('\n');
    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, b64);
    assert.deepEqual(frames[0].meta, { width: 800, height: 450 });
  });

  test('หลายเฟรมใน chunk เดียวได้ครบ และขนาดไม่ตกไปเฟรมถัดไป', () => {
    const parser = createFrameParser();
    const a = 'B'.repeat(70);
    const b = 'C'.repeat(70);
    const frames = parser.push(`W=100 H=100\n${a}\n${b}\n`);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].meta.width, 100);
    assert.equal(frames[1].meta, null, 'เฟรมที่ไม่มีบรรทัดขนาดต้องได้ meta = null ไม่ใช่ค่าของเฟรมก่อน');
  });

  test('บรรทัดที่ไม่ใช่ภาพถูกข้าม (เช่น warning ของ PowerShell ปนมา)', () => {
    const parser = createFrameParser();
    const frames = parser.push('WARNING: something happened\nW=10 H=10\n' + 'D'.repeat(90) + '\n');
    assert.equal(frames.length, 1);
  });

  test('แพลตฟอร์มที่ไม่รองรับ → คืนตัวไม่ทำงาน + บอกสาเหตุ ไม่ทำเป็นสำเร็จเงียบ', () => {
    const errors = [];
    const stream = startScreenStream({ platform: 'linux', onError: (e) => errors.push(e.message) });
    assert.equal(stream.isRunning(), false);
    assert.equal(stream.pid(), null);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Windows/);
    // ต้องเรียกใช้ได้โดยไม่ throw แม้ไม่รองรับ
    stream.setFps(5);
    stream.stop();
  });
});

describe('input — สคริปต์ฉีดอินพุตต้องปลอดกับ PowerShell', () => {
  test('C# ห้ามมี single quote (ถูกครอบด้วย single quote ของ PowerShell)', () => {
    const cs = buildCSharp();
    assert.equal(cs.includes("'"), false, `พบ ' ใน C# — จะทำให้ Add-Type พัง: ${cs.slice(0, 120)}`);
    assert.ok(cs.includes('SendInput'), 'ต้องมีการเรียก SendInput จริง');
  });

  test('สคริปต์เป็นบรรทัดเดียวและไม่มี elseif (พังเมื่อ join ด้วย ;)', () => {
    const script = buildInputScript();
    assert.equal(script.includes('\n'), false);
    assert.equal(script.includes('elseif'), false, 'if/elseif จะกลายเป็น } ; elseif ที่ PowerShell แยก statement');
    assert.ok(script.includes("Add-Type -TypeDefinition '"), 'ต้องฝัง C# ทาง Add-Type ทางเดียว');
  });

  test('มีคำสั่ง noop/ready สำหรับทดสอบโดยไม่ต้องยึดเมาส์ของคนที่อยู่หน้าเครื่อง', () => {
    const script = buildInputScript();
    assert.ok(script.includes("'noop'"), 'ต้องมี noop');
    assert.ok(script.includes("'ready'"), 'ต้องมี ready');
  });

  test('ผลลัพธ์ทุกบรรทัดแนบ id กลับ รวมทั้งตอน error', () => {
    const script = buildInputScript();
    assert.ok(script.includes("$r['id']=$id"), 'ผลสำเร็จต้องแนบ id');
    assert.ok(script.includes('id=$id'), 'ผล error ต้องแนบ id — ไม่งั้นฝั่ง Node รอจน timeout');
  });

  test('แพลตฟอร์มที่ไม่รองรับ → บอกสาเหตุและไม่ throw', async () => {
    const errors = [];
    const host = createInputHost({ platform: 'linux', onError: (e) => errors.push(e.message) });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Windows/);
    const out = await host.applyEvent({ kind: 'mouse', action: 'move', x: 1, y: 1 });
    assert.equal(out.ok, false);
    host.stop();
  });
});

describe('input — แปลงชื่อปุ่มเป็น virtual-key', () => {
  test('ปุ่มที่หน้าเว็บส่งมาจริง', () => {
    assert.equal(resolveKeyCode('Enter'), 0x0d);
    assert.equal(resolveKeyCode('Escape'), 0x1b);
    assert.equal(resolveKeyCode('ArrowUp'), 0x26);
    assert.equal(resolveKeyCode('F5'), 0x74);
  });

  test('รับได้ทั้ง KeyboardEvent.code และ .key', () => {
    assert.equal(resolveKeyCode('KeyA'), 0x41);
    assert.equal(resolveKeyCode('a'), 0x41);
    assert.equal(resolveKeyCode('A'), 0x41, 'พิมพ์ใหญ่/เล็กใช้รหัสเดียวกัน — shift จัดการแยก');
    assert.equal(resolveKeyCode('Digit7'), 0x37);
    assert.equal(resolveKeyCode('7'), 0x37);
  });

  test('ปุ่มที่ไม่รู้จัก → null (ห้ามเดาสุ่ม)', () => {
    assert.equal(resolveKeyCode('Unidentified'), null);
    assert.equal(resolveKeyCode(''), null);
    assert.equal(resolveKeyCode(null), null);
    assert.equal(resolveKeyCode('vk:999'), null, 'รหัสนอกช่วงต้องถูกปฏิเสธ');
  });

  test('รับรหัสตรง ๆ ได้เมื่อไม่มีชื่อในตาราง', () => {
    assert.equal(resolveKeyCode('vk:13'), 13);
  });
});

describe('input — แปลง event จาก HUB เป็นคำสั่งของ host', () => {
  test('เมาส์ขยับ → move พร้อมพิกัดที่ปัดเป็นจำนวนเต็ม', () => {
    assert.deepEqual(toHostCommand({ kind: 'mouse', action: 'move', x: 10.6, y: 20.2 }, 1), {
      command: { id: 1, kind: 'move', x: 11, y: 20 },
    });
  });

  test('คลิก → ยิงสองครั้งตามลำดับ down→up (ต้องไม่ยิงขนาน)', () => {
    assert.deepEqual(toHostCommand({ kind: 'mouse', action: 'click', button: 'right' }, 2), {
      command: { id: 2, kind: 'buttonSequence', flags: [MOUSE_BUTTONS.right.down, MOUSE_BUTTONS.right.up] },
    });
  });

  test('ล้อเมาส์ → พลิกเครื่องหมายให้ตรงกับ scroll ของเบราว์เซอร์', () => {
    const down = toHostCommand({ kind: 'mouse', action: 'wheel', deltaY: 120 }, 3);
    assert.equal(down.command.delta, -120, 'เลื่อนลงต้องเป็นค่าลบตามสัญญาของ Windows');
    const up = toHostCommand({ kind: 'mouse', action: 'wheel', deltaY: -120 }, 4);
    assert.equal(up.command.delta, 120);
  });

  test('ปุ่มเมาส์ที่ไม่รู้จัก → ปฏิเสธ ไม่ส่ง flag มั่ว', () => {
    const out = toHostCommand({ kind: 'mouse', action: 'down', button: 'hyper' }, 5);
    assert.ok(out.error);
  });

  test('พิกัดที่ผิดรูป → ปฏิเสธ (ไม่ขยับเมาส์ไปที่ 0,0 เงียบ ๆ)', () => {
    assert.ok(toHostCommand({ kind: 'mouse', action: 'move', x: 'zz', y: 1 }, 6).error);
    assert.ok(toHostCommand({ kind: 'mouse', action: 'move', y: 1 }, 7).error);
  });

  test('คีย์บอร์ด → vk + ทิศทางการกด', () => {
    assert.deepEqual(toHostCommand({ kind: 'key', action: 'down', key: 'Enter' }, 8), {
      command: { id: 8, kind: 'key', vk: 0x0d, down: true },
    });
    assert.deepEqual(toHostCommand({ kind: 'key', action: 'up', key: 'a' }, 9), {
      command: { id: 9, kind: 'key', vk: 0x41, down: false },
    });
    // ไม่ระบุ action = ถือว่ากดค้างไว้ (พฤติกรรมเดียวกับ keydown)
    assert.equal(toHostCommand({ kind: 'key', key: 'b' }, 10).command.down, true);
  });

  test('ปุ่มที่ไม่รู้จัก → ปฏิเสธ ไม่ส่ง vk 0 ที่ไปกดอะไรก็ไม่รู้', () => {
    const out = toHostCommand({ kind: 'key', action: 'down', key: 'Hyper' }, 11);
    assert.ok(out.error);
  });

  test('ข้อความ: ปกติผ่าน · ยาวเกินเพดานถูกปฏิเสธ · ว่างถูกปฏิเสธ', () => {
    assert.equal(toHostCommand({ kind: 'text', text: 'สวัสดี' }, 12).command.text, 'สวัสดี');
    assert.ok(toHostCommand({ kind: 'text', text: 'x'.repeat(2001) }, 13).error);
    assert.ok(toHostCommand({ kind: 'text', text: '' }, 14).error);
  });

  test('kind ที่ไม่รู้จัก / event ว่าง → ปฏิเสธ', () => {
    assert.ok(toHostCommand({ kind: 'teleport' }, 15).error);
    assert.ok(toHostCommand(null, 16).error);
    assert.ok(toHostCommand(undefined, 17).error);
  });
});
