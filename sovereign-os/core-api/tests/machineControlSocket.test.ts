import './setup-env';
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import WebSocket from 'ws';
import { makeToken } from './helpers';
import { createSocketServer } from '../src/realtime/socket';
import { resetIo } from '../src/realtime/io-registry';
import { normalizeFps, MAX_SCREEN_FPS } from '../src/realtime/machine-control.socket';
import { awaitCommand, getViewers, resetMachineControl } from '../src/services/machine-control.service';

// ── ช่องควบคุมเครื่องระยะไกล — สัญญาระหว่าง browser กับ HUB ──────────────────
//
// เทสต์ชุดนี้พูดโปรโตคอล Socket.IO ตรง ๆ ผ่าน ws (แบบเดียวกับ socketAuth.test.ts)
// เพื่อพิสูจน์เส้นทางจริงที่ผู้ใช้กด: เปิดดูเครื่อง → runner ต้องได้คำสั่งเริ่มสตรีม
//
// สิ่งที่ต้องคุมให้ได้ (พังเงียบได้ทั้งหมดถ้าไม่เทสต์):
//   · ไม่ใช่ SUPERADMIN = ห้ามได้คำสั่งหลุดไปถึงเครื่อง (เมาส์/คีย์บอร์ด/ไฟล์)
//   · ต้อง \"เปิดดูจอก่อน\" จึงสั่งอินพุตได้ — กันการฉีดคำสั่งเข้าจอที่ไม่มีใครเห็น
//   · ปิดหน้า/หลุดการเชื่อมต่อ = ต้องสั่ง runner หยุดสตรีม (ไม่กินแบนด์วิดท์ค้าง)

const MACHINE = 'm-socket-1';

interface Session {
  /** รอ packet ที่เข้าเงื่อนไข แล้วคืนค่า (ตัว packet ดิบ) */
  waitFor: (predicate: (msg: string) => boolean, timeoutMs?: number) => Promise<string>;
  emit: (ackId: number, event: string, payload: unknown) => void;
  close: () => void;
}

function connect(url: string, token: string | null): Promise<Session> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}/socket.io/?EIO=4&transport=websocket`);
    const received: string[] = [];
    const waiters: Array<{ predicate: (m: string) => boolean; resolve: (m: string) => void }> = [];

    const deliver = (msg: string) => {
      const idx = waiters.findIndex((w) => w.predicate(msg));
      if (idx >= 0) {
        const w = waiters.splice(idx, 1)[0];
        w.resolve(msg);
        return;
      }
      received.push(msg);
    };

    ws.on('message', (data) => deliver(String(data)));
    ws.on('error', reject);
    ws.on('open', () => {
      const session: Session = {
        waitFor: (predicate, timeoutMs = 2000) => {
          const hit = received.findIndex(predicate);
          if (hit >= 0) return Promise.resolve(received.splice(hit, 1)[0]);
          return new Promise<string>((res, rej) => {
            const timer = setTimeout(() => rej(new Error('timeout waiting for packet')), timeoutMs);
            waiters.push({
              predicate,
              resolve: (m) => {
                clearTimeout(timer);
                res(m);
              },
            });
          });
        },
        emit: (ackId, event, payload) => ws.send(`42${ackId}${JSON.stringify([event, payload])}`),
        close: () => ws.close(),
      };
      // จบ engine.io handshake ก่อน แล้วค่อย CONNECT พร้อม token
      session
        .waitFor((m) => m.startsWith('0'))
        .then(() => {
          ws.send('40' + (token === null ? '' : JSON.stringify({ token })));
          return session.waitFor((m) => m.startsWith('40') || m.startsWith('44'));
        })
        .then((reply) => {
          if (!reply.startsWith('40')) {
            reject(new Error('connect rejected: ' + reply));
            return;
          }
          resolve(session);
        })
        .catch(reject);
    });
  });
}

/** รอ ack ของ event ที่ส่งไป (socket.io: ส่ง 42<id> → ตอบ 43<id>) */
async function ack(session: Session, id: number, timeoutMs = 2000): Promise<Record<string, any>> {
  const raw = await session.waitFor((m) => m.startsWith(`43${id}`), timeoutMs);
  const args = JSON.parse(raw.slice(2 + String(id).length)) as unknown[];
  return (args[0] ?? {}) as Record<string, any>;
}

describe('machine-control socket — เส้นทาง browser → HUB → runner', () => {
  let httpServer: http.Server;
  let io: ReturnType<typeof createSocketServer>;
  let url = '';
  const sessions: Session[] = [];

  const open = async (role = 'SUPERADMIN') => {
    const s = await connect(url, makeToken(role));
    sessions.push(s);
    return s;
  };

  before(async () => {
    const app = express();
    httpServer = http.createServer(app);
    io = createSocketServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const addr = httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    url = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    for (const s of sessions) s.close();
    resetMachineControl();
    io.close();
    resetIo();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  beforeEach(async () => {
    // ปิด socket ของเคสก่อนให้หมดก่อน — socket.io นับจำนวนผู้ชมจาก adapter ของ "ห้อง"
    // ไม่ใช่จาก state ของ service ⇒ socket ที่ค้างจากเคสก่อนทำให้ room size ผิด
    // (อาการ: เคสที่ควรได้ viewers=1 กลับเป็น 7 แล้วก็ไม่สั่ง screen.start)
    for (const s of sessions) {
      try {
        s.close();
      } catch {
        /* ปิดไปแล้วก็ข้าม */
      }
    }
    sessions.length = 0;
    // ให้ server ประมวลผล disconnect (แล้วสั่ง screen.stop) จบก่อนล้าง state
    await new Promise((r) => setTimeout(r, 60));
    resetMachineControl();
  });

  test('SUPERADMIN เปิดดูเครื่อง → runner ได้คำสั่ง screen.start พร้อม fps', async () => {
    const s = await open();
    s.emit(1, 'control:join', { machineId: MACHINE, fps: 4 });

    const joined = await ack(s, 1);
    assert.equal(joined.ok, true);
    assert.equal(joined.viewers, 1);
    assert.equal(joined.fps, 4);

    const command = await awaitCommand(MACHINE, 500);
    assert.ok(command, 'runner ต้องได้คำสั่ง ไม่ใช่ไม่มีอะไรเกิดขึ้น');
    assert.equal(command!.type, 'screen.start');
    assert.equal(command!.payload.fps, 4);
  });

  test('role อื่นเปิดดูเครื่อง → ถูกปฏิเสธ และไม่มีคำสั่งหลุดไปถึงเครื่อง', async () => {
    const s = await open('NODE_ADMIN');
    s.emit(1, 'control:join', { machineId: MACHINE });

    const joined = await ack(s, 1);
    assert.equal(joined.ok, false);
    assert.match(String(joined.error), /SUPERADMIN/);

    assert.equal(await awaitCommand(MACHINE, 80), null, 'คำสั่งต้องไม่หลุดเมื่อสิทธิ์ไม่พอ');
    assert.equal(getViewers(MACHINE), 0);
  });

  test('เปิดดูโดยไม่ระบุเครื่อง → ถูกปฏิเสธ', async () => {
    const s = await open();
    s.emit(1, 'control:join', {});
    const joined = await ack(s, 1);
    assert.equal(joined.ok, false);
    assert.match(String(joined.error), /machineId/);
  });

  test('คนดูคนที่สองได้รับ fps ไม่ใช่สั่ง start ซ้ำ (ไม่รีสตาร์ทสตรีมที่ไม่จำเป็น)', async () => {
    const first = await open();
    first.emit(1, 'control:join', { machineId: MACHINE, fps: 5 });
    await ack(first, 1);
    assert.equal((await awaitCommand(MACHINE, 500))!.type, 'screen.start');

    const second = await open();
    second.emit(1, 'control:join', { machineId: MACHINE, fps: 8 });
    const joined = await ack(second, 1);
    assert.equal(joined.viewers, 2);

    const command = await awaitCommand(MACHINE, 500);
    assert.equal(command!.type, 'screen.fps', 'คนที่สองต้องไม่ทำให้ runner สตาร์ทสตรีมใหม่');
    assert.equal(command!.payload.fps, 8);
  });

  test('สั่งอินพุตก่อนเปิดดูจอ → ปฏิเสธ (ต้องมีคนเห็นจอก่อนจึงสั่งได้)', async () => {
    const s = await open();
    s.emit(1, 'control:input', { machineId: MACHINE, event: { kind: 'mouse', x: 1, y: 2 } });

    const res = await ack(s, 1);
    assert.equal(res.ok, false);
    assert.match(String(res.error), /join/);
    assert.equal(await awaitCommand(MACHINE, 80), null, 'ต้องไม่มีอินพุตหลุดไปถึงเครื่อง');
  });

  test('สั่งเมาส์หลังเปิดดูจอ → runner ได้ input.mouse ตามที่ส่ง', async () => {
    const s = await open();
    s.emit(1, 'control:join', { machineId: MACHINE, fps: 3 });
    await ack(s, 1);
    await awaitCommand(MACHINE, 500); // กลืน screen.start

    s.emit(2, 'control:input', { machineId: MACHINE, event: { kind: 'mouse', x: 640, y: 360 } });
    assert.equal((await ack(s, 2)).ok, true);

    const command = await awaitCommand(MACHINE, 500);
    assert.equal(command!.type, 'input.mouse');
    assert.equal(command!.payload.x, 640);
    assert.equal(command!.payload.y, 360);
  });

  test('คีย์บอร์ดและข้อความ → แปลงเป็น input.key / input.text ให้ถูกชนิด', async () => {
    const s = await open();
    s.emit(1, 'control:join', { machineId: MACHINE });
    await ack(s, 1);
    await awaitCommand(MACHINE, 500);

    s.emit(2, 'control:input', { machineId: MACHINE, event: { kind: 'key', key: 'Enter' } });
    await ack(s, 2);
    assert.equal((await awaitCommand(MACHINE, 500))!.type, 'input.key');

    s.emit(3, 'control:input', { machineId: MACHINE, event: { kind: 'text', text: 'hello' } });
    await ack(s, 3);
    const text = await awaitCommand(MACHINE, 500);
    assert.equal(text!.type, 'input.text');
    assert.equal(text!.payload.text, 'hello');
  });

  test('event ที่ไม่รู้จักชนิด → ปฏิเสธ ไม่ส่งต่อไปให้ runner เดาเอาเอง', async () => {
    const s = await open();
    s.emit(1, 'control:input', { machineId: MACHINE, event: { kind: 'teleport' } });
    const res = await ack(s, 1);
    assert.equal(res.ok, false);
    assert.match(String(res.error), /mouse\|key\|text|kind/);
  });

  test('สั่งไฟล์ → runner ได้ fs.<op> พร้อม path', async () => {
    const s = await open();
    s.emit(1, 'control:fs', { machineId: MACHINE, op: 'write', payload: { path: 'E:\\a.txt', data: 'aGk=' } });

    const res = await ack(s, 1);
    assert.equal(res.ok, true);

    const command = await awaitCommand(MACHINE, 500);
    assert.equal(command!.type, 'fs.write');
    assert.equal(command!.payload.path, 'E:\\a.txt');
  });

  test('op ของไฟล์ที่ไม่รองรับ → ปฏิเสธ (ห้ามส่งอะไรก็ได้ไปให้ runner รัน)', async () => {
    const s = await open();
    s.emit(1, 'control:fs', { machineId: MACHINE, op: 'exec', payload: { cmd: 'rm -rf /' } });
    const res = await ack(s, 1);
    assert.equal(res.ok, false);
    assert.equal(await awaitCommand(MACHINE, 80), null, 'คำสั่งที่ไม่อยู่ในรายการต้องไม่หลุด');
  });

  test('ขอ fps เกินเพดาน → ถูกตัดให้อยู่ในกรอบ', async () => {
    const s = await open();
    s.emit(1, 'control:join', { machineId: MACHINE, fps: 999 });
    const joined = await ack(s, 1);
    assert.equal(joined.fps, MAX_SCREEN_FPS);

    s.emit(2, 'control:fps', { machineId: MACHINE, fps: 1000 });
    const changed = await ack(s, 2);
    assert.equal(changed.fps, MAX_SCREEN_FPS);
  });

  test('fps ที่ไม่ใช่ตัวเลข/ติดลบ → ใช้ค่าเริ่มต้น ไม่ทำให้คำสั่งเพี้ยน', async () => {
    const s = await open();
    s.emit(1, 'control:join', { machineId: MACHINE, fps: -5 });
    const joined = await ack(s, 1);
    assert.ok(joined.fps >= 1);
    assert.ok(joined.fps <= MAX_SCREEN_FPS);
  });

  test('ปิดการเชื่อมต่อ (ผู้ใช้ปิดหน้า) → runner ได้คำสั่ง screen.stop', async () => {
    const s = await open();
    s.emit(1, 'control:join', { machineId: MACHINE, fps: 5 });
    await ack(s, 1);
    await awaitCommand(MACHINE, 500); // กลืน screen.start
    assert.equal(getViewers(MACHINE), 1);

    s.close();

    const stop = await awaitCommand(MACHINE, 1500);
    assert.ok(stop, 'ปิดหน้าต้องสั่งหยุดสตรีม ไม่ปล่อยให้เครื่องสตรีมค้าง');
    assert.equal(stop!.type, 'screen.stop');
    assert.equal(getViewers(MACHINE), 0);
  });

  test('ออกจากห้องด้วยคำสั่งเอง → ได้ screen.stop เหมือนกัน', async () => {
    const s = await open();
    s.emit(1, 'control:join', { machineId: MACHINE });
    await ack(s, 1);
    await awaitCommand(MACHINE, 500);

    s.emit(2, 'control:leave', { machineId: MACHINE });
    const left = await ack(s, 2);
    assert.equal(left.ok, true);

    assert.equal((await awaitCommand(MACHINE, 500))!.type, 'screen.stop');
  });

  test('normalizeFps ตัดค่าที่ผิดรูปทุกทาง', () => {
    assert.equal(normalizeFps(0), 5, 'fps 0 = ไม่ระบุ → ใช้ค่าเริ่มต้น');
    assert.equal(normalizeFps('abc'), 5);
    assert.equal(normalizeFps(999), MAX_SCREEN_FPS);
    assert.equal(normalizeFps(3), 3);
    assert.equal(normalizeFps(2.4), 2);
  });
});
