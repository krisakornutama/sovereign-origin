import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createControlHub } from '../src/hub-control.mjs';

// ── สัญญาระหว่าง runner กับ HUB ───────────────────────────────────────────────
//
// สองครึ่งของช่องนี้ถูกเทสต์แยกกันคนละชุด (HUB ฝั่ง TypeScript, runner ฝั่งนี้)
// ⇒ ไม่มีอะไรพิสูจน์ว่า "คำขอที่ runner ส่ง" ตรงกับ "สิ่งที่ route ฝั่ง HUB อ่าน"
// เทสต์ชุดนี้จึงยิง HTTP จริงไปที่ server จำลอง แล้วตรวจ path + header + body เป๊ะ ๆ
//
// เคสที่สำคัญที่สุดคือ "ห้ามยิงผลลัพธ์คำสั่งไปที่เส้นทางของงาน AI":
//   /api/agent-machines/jobs/<id>/result คือของงาน AI — ถ้าผลลัพธ์ของช่องควบคุม
//   หลงไปที่นั่น HUB จะตอบ 400 และผู้ใช้เห็นแค่ "คำสั่งไม่ทำงาน" โดยไม่มีอะไรบอกสาเหตุ

const received = [];
let server;
let baseUrl = '';
let nextReply = { command: null };

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({
        url: req.url,
        method: req.method,
        token: req.headers['x-machine-token'],
        contentType: req.headers['content-type'],
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/api/machine-control/next' ? nextReply : { ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe('hub-control — รูปแบบคำขอที่ส่งไป HUB', () => {
  test('nextCommand → /api/machine-control/next พร้อม waitMs และ machine token', async () => {
    received.length = 0;
    nextReply = { command: { id: 'c1', type: 'screen.start', payload: { fps: 5 } } };
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok-abc' });

    const command = await hub.nextCommand(25_000);

    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/api/machine-control/next');
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].token, 'tok-abc');
    assert.match(received[0].contentType, /application\/json/);
    assert.deepEqual(received[0].body, { waitMs: 25_000 });
    assert.equal(command.id, 'c1');
  });

  test('ไม่มีคำสั่ง → คืน null (ไม่ใช่ throw) เพื่อให้ลูปวนต่อได้', async () => {
    received.length = 0;
    nextReply = { command: null };
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    assert.equal(await hub.nextCommand(1000), null);
  });

  test('sendFrame → base64 ในฟิลด์ data พร้อมขนาดภาพ', async () => {
    received.length = 0;
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    const buffer = Buffer.from('jpeg-bytes-here');

    await hub.sendFrame({ buffer, width: 1280, height: 720 });

    assert.equal(received[0].url, '/api/machine-control/frame');
    assert.equal(received[0].body.data, buffer.toString('base64'));
    assert.equal(received[0].body.width, 1280);
    assert.equal(received[0].body.height, 720);
    assert.equal(received[0].body.mime, 'image/jpeg');
  });

  test('sendFrame ที่ไม่มีขนาด → ส่ง null ไม่ใช่ undefined (JSON ต้องมีฟิลด์ครบ)', async () => {
    received.length = 0;
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    await hub.sendFrame({ buffer: Buffer.from('x') });
    assert.equal(received[0].body.width, null);
    assert.equal(received[0].body.height, null);
  });

  test('reportResult สำเร็จ → /api/machine-control/result และ ok:true', async () => {
    received.length = 0;
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    await hub.reportResult('cmd-1', { ok: true, note: 'สตรีมเริ่ม' });

    assert.equal(received[0].url, '/api/machine-control/result');
    assert.equal(received[0].body.commandId, 'cmd-1');
    assert.equal(received[0].body.ok, true);
    assert.equal(received[0].body.error, null);
  });

  test('ห้ามยิงผลลัพธ์คำสั่งไปเส้นทางของงาน AI เด็ดขาด', async () => {
    received.length = 0;
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    await hub.reportResult('cmd-2', { ok: true });

    const urls = received.map((r) => r.url);
    assert.equal(
      urls.some((u) => u.startsWith('/api/agent-machines/')),
      false,
      `ผลลัพธ์ช่องควบคุมต้องไม่ไปที่งาน AI แต่ไปที่: ${urls.join(', ')}`,
    );
  });

  test('ผลลัพธ์ของคำสั่งไฟล์ถูกส่งครบทั้งก้อน (หน้าเว็บอ่าน entries จาก result)', async () => {
    received.length = 0;
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    const fsOutcome = { ok: true, path: 'E:\\', parent: null, entries: [{ name: 'a.txt', isDir: false }] };

    await hub.reportResult('cmd-3', fsOutcome);

    assert.equal(received[0].body.ok, true);
    assert.deepEqual(received[0].body.result, fsOutcome, 'ต้องส่งก้อนผลลัพธ์เดิม ไม่ตัดฟิลด์ทิ้ง');
  });

  test('ความล้มเหลว → ok:false + ข้อความ error และ result เป็น null', async () => {
    received.length = 0;
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    await hub.reportResult('cmd-4', { ok: false, error: 'ไม่มีสิทธิ์เข้าถึง' });

    assert.equal(received[0].body.ok, false);
    assert.equal(received[0].body.error, 'ไม่มีสิทธิ์เข้าถึง');
    assert.equal(received[0].body.result, null);
  });

  test('ความล้มเหลวที่ไม่มีข้อความ → ต้องมี error อ่านรู้เรื่อง ไม่ปล่อยว่าง', async () => {
    received.length = 0;
    const hub = createControlHub({ hubUrl: baseUrl, token: 'tok' });
    await hub.reportResult('cmd-5', { ok: false });
    assert.equal(typeof received[0].body.error, 'string');
    assert.ok(received[0].body.error.length > 0);
  });

  test('HUB ตอบ error → throw ให้ผู้เรียกรู้ (ไม่กลืนเป็นความสำเร็จ)', async () => {
    const failing = http.createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    await new Promise((resolve) => failing.listen(0, '127.0.0.1', resolve));
    const addr = failing.address();
    const hub = createControlHub({ hubUrl: `http://127.0.0.1:${addr.port}`, token: 'tok' });

    await assert.rejects(() => hub.nextCommand(100), /HTTP 500/);
    await new Promise((resolve) => failing.close(() => resolve()));
  });

  test('hubUrl ที่มี / ปิดท้าย → ต้องไม่กลายเป็น // ใน path', async () => {
    received.length = 0;
    nextReply = { command: null };
    const hub = createControlHub({ hubUrl: `${baseUrl}/`, token: 'tok' });
    await hub.nextCommand(50);
    assert.equal(received[0].url, '/api/machine-control/next');
  });
});
