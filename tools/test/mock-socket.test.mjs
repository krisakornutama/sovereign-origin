// เทส Socket.IO ของ mock preview (tools/mock-api-preview.mjs) — ปิดหางงาน A1 ให้จบด้วยหลักฐาน:
// dashboard ต่อ ws://…:3101 บนสแตก preview ต้อง handshake ผ่าน และได้ snapshot event ครบตาม allowlist
// พูดโปรโตคอล Socket.IO (EIO=4) ตรงผ่าน ws — เทคนิคเดียวกับ core-api/tests/socketAuth.test.ts (ไม่เพิ่ม dependency)
//   ใช้: node --test tools/test/   (หรือ npm run test:tools)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const WebSocket = require(join(ROOT, 'sovereign-os', 'core-api', 'node_modules', 'ws'));

// พอร์ตเทสของตัวเอง — ห่าง 3101 ของสแตก preview จริง กันชนตอนรันคู่กัน
const PORT = 3181;
const BASE = `http://127.0.0.1:${PORT}`;

/** fake JWT โครงเดียวกับที่ e2e บนสแตก preview ใช้ (client-side decode — ไม่มี signature) */
function makeToken(payload = {}) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: 'mock-socket-test', role: 'SUPERADMIN', mfa_verified: true, exp: now + 600, ...payload })}.`;
}

/** เปิด websocket + จบ handshake engine.io + ส่ง CONNECT พร้อม auth — คืนตัวอ่าน packet ทีละข้อความ */
function wsHandshake(url, auth) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}/socket.io/?EIO=4&transport=websocket`);
    const queue = [];
    let waiter = null;
    const fail = (e) => { try { ws.close(); } catch { /* ignore */ } reject(e); };
    ws.on('message', (data) => {
      const m = String(data);
      if (waiter) { const w = waiter; waiter = null; w(m); } else queue.push(m);
    });
    ws.on('error', fail);
    ws.on('open', () => {
      const take = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((res) => (waiter = res)));
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
/** อ่าน packet ถัดไปพร้อม timeout (ms) — หมดเวลาคืน null (ไม่ค้างทั้งเทส) */
function nextTimeout(session, ms = 3000) {
  return Promise.race([session.next(), new Promise((res) => setTimeout(() => res(null), ms))]);
}
/** แยก packet `42[...]` เป็น [event, payload] — ไม่ใช่ event packet คืน null */
function parseEvent(packet) {
  if (!packet || !packet.startsWith('42')) return null;
  try { return JSON.parse(packet.slice(2)); } catch { return null; }
}

let child;
let wsOk; // session ที่ handshake ผ่าน (เคส token ถูกต้อง) — ใช้ตรวจ snapshot events

before(async () => {
  child = spawn(process.execPath, [join(ROOT, 'tools', 'mock-api-preview.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write('[mock] ' + String(d)));
  // รอ mock ฟังพอร์ตจริงก่อน (probe ต้องแนบ Authorization — mock gate 401 ของไม่แนบ)
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/ai/policy`, { headers: { Authorization: 'Bearer probe' } });
      if (r.ok) break;
    } catch { /* ยังไม่ฟัง */ }
    if (Date.now() - t0 > 15000) throw new Error('mock ไม่ยอมฟังพอร์ตเทส :3181 ใน 15 วิ');
    await new Promise((res) => setTimeout(res, 300));
  }
});

after(() => { try { child.kill(); } catch { /* ignore */ } });

test('gate REST เดิมไม่พัง — GET ไม่แนบ Authorization ยังได้ 401 แบบเดิม', async () => {
  const r = await fetch(`${BASE}/api/energy/summary`);
  assert.equal(r.status, 401, 'gate 401 ของ mock ต้องคงเดิมหลังเติม socket.io');
});

test('token ถูกต้อง (mfa_verified) → handshake ผ่าน (`40`) + ได้ snapshot event ครบ 4 ตาม allowlist', async () => {
  wsOk = await wsHandshake(BASE, { token: makeToken() });
  const ack = await nextTimeout(wsOk);
  assert.ok(ack && ack.startsWith('40'), 'ต้องได้ namespace CONNECT ผ่าน แต่ได้: ' + ack);

  // snapshot ที่ server emit ทันทีที่ต่อ — เรียงตามโค้ด: telemetry → threat → defcon → wealth
  const seen = {};
  for (let i = 0; i < 4; i++) {
    const ev = parseEvent(await nextTimeout(wsOk));
    assert.ok(ev, `ควรได้ event packet ตัวที่ ${i + 1} ภายใน 3 วิ (ได้: ${ev})`);
    const [name, payload] = ev;
    seen[name] = payload;
  }
  // ฟิลด์ตรง EVENT_FIELD_ALLOWLIST ของ core-api/src/realtime/socket.ts — หน้าเว็บต้องอ่านได้เหมือนของจริง
  assert.equal(seen.telemetry_update?.node_id, 'node-01');
  assert.equal(seen.telemetry_update?.status, 'ONLINE');
  assert.equal(typeof seen.telemetry_update?.battery_soc, 'number');
  assert.equal(typeof seen.threat_update?.overall, 'number');
  assert.ok(seen.threat_update?.categories, 'threat_update ต้องมี categories');
  assert.ok(['up', 'down'].includes(seen.defcon_update?.direction), 'defcon_update ต้องมี direction up/down');
  assert.equal(typeof seen.wealth_update?.totalUsd, 'number');
  assert.equal(typeof seen.wealth_update?.grandTotalUsd, 'number');
  assert.ok(seen.wealth_update?.timestamp, 'wealth_update ต้องมี timestamp');
});

test('token ไม่มี mfa_verified → ถูกปฏิเสธ (`44`) ด้วยข้อความ MFA verification required', async () => {
  const s = await wsHandshake(BASE, { token: makeToken({ mfa_verified: false }) });
  try {
    const reply = await nextTimeout(s);
    assert.ok(reply && reply.startsWith('44'), 'ต้องได้ CONNECT_ERROR (44) แต่ได้: ' + reply);
    assert.ok(reply.includes('MFA verification required'), 'ข้อความต้องตรงด่านของจริง: ' + reply);
  } finally { s.close(); }
});

test('ไม่ส่ง token → ถูกปฏิเสธ (`44`) แบบ Unauthorized (fail-closed เหมือนของจริง)', async () => {
  const s = await wsHandshake(BASE, undefined);
  try {
    const reply = await nextTimeout(s);
    assert.ok(reply && reply.startsWith('44'), 'ต้องได้ CONNECT_ERROR (44) แต่ได้: ' + reply);
  } finally { s.close(); }
});
