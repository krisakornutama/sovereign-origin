import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { createSocketServer, sanitizeSocketEvent } from '../src/realtime/socket';

// ── ด่าน Socket.IO: handshake ต้องมี JWT (mfa_verified) + payload ถูกตัดตาม allowlist ──
// พูดโปรโตคอล Socket.IO (EIO=4) ตรงผ่าน ws — ไม่ต้องเพิ่ม dependency ใหม่:
//   รอ OPEN (`0...`) → ส่ง CONNECT+auth (`40{...}`) → ผลลัพธ์ `40` (ผ่าน) หรือ `44` (ถูกปฏิเสธ)

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { userId: 'socket-test', role: 'SUPERADMIN', assigned_node_id: null, mfa_verified: true, ...overrides },
    process.env.JWT_SECRET as string
  );
}

interface WsSession {
  next: () => Promise<string>;
  close: () => void;
}

/** เปิด websocket + จบ handshake ด้าน engine.io แล้วส่ง CONNECT พร้อม auth payload */
function wsHandshake(url: string, auth: unknown): Promise<WsSession> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}/socket.io/?EIO=4&transport=websocket`);
    const queue: string[] = [];
    let waiter: ((m: string) => void) | null = null;
    const fail = (e: Error) => { try { ws.close(); } catch { /* ignore */ } reject(e); };
    ws.on('message', (data) => {
      const m = String(data);
      if (waiter) { const w = waiter; waiter = null; w(m); } else queue.push(m);
    });
    ws.on('error', fail);
    ws.on('open', () => {
      const take = (): Promise<string> =>
        queue.length ? Promise.resolve(queue.shift()!) : new Promise<string>((res) => (waiter = res));
      take()
        .then((open) => {
          if (!open.startsWith('0')) return fail(new Error('no engine.io OPEN: ' + open));
          ws.send('40' + (auth === undefined ? '' : JSON.stringify(auth)));
          resolve({ next: take, close: () => ws.close() });
        })
        .catch(fail);
    });
  });
}

describe('realtime/socket — ด่าน handshake + sanitize payload', () => {
  let httpServer: http.Server;
  let io: ReturnType<typeof createSocketServer>;
  let url: string;
  const sessions: WsSession[] = [];

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
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  test('token ถูกต้อง (mfa_verified) → server ตอบ CONNECT ผ่าน (`40`)', async () => {
    const s = await wsHandshake(url, { token: makeToken() });
    sessions.push(s);
    const reply = await s.next();
    assert.ok(reply.startsWith('40'), 'ต้องได้ namespace CONNECT ผ่าน แต่ได้: ' + reply);
  });

  test('ไม่ส่ง token → CONNECT_ERROR (`44`)', async () => {
    const s = await wsHandshake(url, undefined);
    sessions.push(s);
    const reply = await s.next();
    assert.ok(reply.startsWith('44'), 'ต้องถูกปฏิเสธ แต่ได้: ' + reply);
  });

  test('token ปลอม → CONNECT_ERROR (`44`)', async () => {
    const s = await wsHandshake(url, { token: 'not-a-jwt' });
    sessions.push(s);
    const reply = await s.next();
    assert.ok(reply.startsWith('44'), 'ต้องถูกปฏิเสธ แต่ได้: ' + reply);
  });

  test('token ที่ยังไม่ verify MFA → CONNECT_ERROR พร้อมข้อความ MFA', async () => {
    const s = await wsHandshake(url, { token: makeToken({ mfa_verified: false }) });
    sessions.push(s);
    const reply = await s.next();
    assert.ok(reply.startsWith('44'), 'ต้องถูกปฏิเสธ แต่ได้: ' + reply);
    assert.ok(reply.includes('MFA'), 'ข้อความต้องบอกเรื่อง MFA: ' + reply);
  });

  test('sanitizeSocketEvent — ตัดเหลือเฉพาะฟิลด์ allowlist ของ event นั้น', () => {
    const out = sanitizeSocketEvent('telemetry_update', {
      node_id: 'n1', battery_soc: 88, status: 'ONLINE',
      internal_note: 'telegram-chat-999', audit_payload: { password: 'x' },
    }) as Record<string, unknown>;
    assert.equal(out.node_id, 'n1');
    assert.equal(out.battery_soc, 88);
    assert.equal(out.internal_note, undefined);
    assert.equal(out.audit_payload, undefined);
  });

  test('event ที่ไม่อยู่ใน allowlist → ผ่านตามเดิม (ไม่ตัด)', () => {
    const payload = { anything: true, nested: { a: 1 } };
    assert.deepEqual(sanitizeSocketEvent('custom_event', payload), payload);
  });

  test('broadcast จริงผ่าน io.emit → client ได้เฉพาะฟิลด์ที่อนุญาต', async () => {
    const s = await wsHandshake(url, { token: makeToken() });
    sessions.push(s);
    await s.next(); // กลืน reply CONNECT

    const got = s.next().then((m) => {
      assert.ok(m.startsWith('42'), 'ต้องเป็น EVENT packet: ' + m);
      const [event, payload] = JSON.parse(m.slice(2)) as [string, Record<string, unknown>];
      return { event, payload };
    });
    io.emit('telemetry_update', {
      node_id: 'n1', battery_soc: 88, power_kw: 1.5, status: 'ONLINE',
      secret_note: 'should-not-leak', telegram_context: { chat_id: 999 },
    });
    const { event, payload } = await got;
    assert.equal(event, 'telemetry_update');
    assert.equal(payload.node_id, 'n1');
    assert.equal(payload.battery_soc, 88);
    assert.equal(payload.status, 'ONLINE');
    assert.equal(payload.secret_note, undefined);
    assert.equal(payload.telegram_context, undefined);
  });
});
