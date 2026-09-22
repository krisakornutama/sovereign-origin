// เทส Socket.IO ของ mock preview (tools/mock-api-preview.mjs) — หลักฐานของสแตก preview:
//   1) dashboard ต่อ ws://…:3101 handshake ผ่าน + ได้ snapshot telemetry/threat/defcon/wealth ตาม allowlist
//   2) alert สด: mock ฉีด new_alert/critical_alert ตามรอบ + ประวัติ REST /api/automation/alerts มาจากที่เดียวกัน
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
const AUTH = { Authorization: 'Bearer probe' };

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

/** เก็บ event ตามชื่อที่สนใจจากสาย packet (tolerant — event อื่นแทรกระหว่างทางได้ ไม่พังการนับ) */
async function collectEvents(session, wanted, { perPacketMs = 2000, deadlineMs = 8000 } = {}) {
  const seen = {};
  const missing = () => wanted.filter((n) => !(n in seen));
  const t0 = Date.now();
  while (missing().length > 0 && Date.now() - t0 < deadlineMs) {
    const ev = parseEvent(await nextTimeout(session, perPacketMs));
    if (ev) seen[ev[0]] = ev[1];
  }
  return { seen, missing: missing() };
}

let child;
let wsOk; // session ที่ handshake ผ่าน (เคส token ถูกต้อง)

before(async () => {
  child = spawn(process.execPath, [join(ROOT, 'tools', 'mock-api-preview.mjs')], {
    env: { ...process.env, MOCK_PORT: String(PORT), MOCK_ALERT_INTERVAL_MS: '1200' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write('[mock] ' + String(d)));
  // รอ mock ฟังพอร์ตจริงก่อน (probe ต้องแนบ Authorization — mock gate 401 ของไม่แนบ)
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/ai/policy`, { headers: AUTH });
      if (r.ok) break;
    } catch { /* ยังไม่ฟัง */ }
    if (Date.now() - t0 > 15000) throw new Error('mock ไม่ยอมฟังพอร์ตเทส :3181 ใน 15 วิ');
    await new Promise((res) => setTimeout(res, 300));
  }
});

after(() => { try { wsOk?.close(); } catch { /* ignore */ } try { child.kill(); } catch { /* ignore */ } });

test('gate REST เดิมไม่พัง — GET ไม่แนบ Authorization ยังได้ 401 แบบเดิม', async () => {
  const r = await fetch(`${BASE}/api/energy/summary`);
  assert.equal(r.status, 401, 'gate 401 ของ mock ต้องคงเดิมหลังเติม socket.io');
});

test('token ถูกต้อง (mfa_verified) → handshake ผ่าน (`40`) + snapshot 4 events ตาม allowlist', async () => {
  wsOk = await wsHandshake(BASE, { token: makeToken() });
  const ack = await nextTimeout(wsOk);
  assert.ok(ack && ack.startsWith('40'), 'ต้องได้ namespace CONNECT ผ่าน แต่ได้: ' + ack);

  // snapshot แรกทันทีที่ต่อ — เก็บแบบ tolerant (alert สดอาจแทรกระหว่าง snapshot ได้)
  const { seen, missing } = await collectEvents(wsOk, ['telemetry_update', 'threat_update', 'defcon_update', 'wealth_update']);
  assert.deepEqual(missing, [], 'ต้องได้ snapshot ครบ 4 events');

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

test('alert สด: new_alert ถูก push ผ่าน socket + payload ตรง allowlist + REST ประวัติตัวเดียวกัน', async () => {
  // session ใหม่ (mock ยิง alert เป็นรอบทุก 1.2 วิในเทส — ต้องได้ภายใน ~3 วิ)
  const s = await wsHandshake(BASE, { token: makeToken() });
  try {
    const ack = await nextTimeout(s);
    assert.ok(ack && ack.startsWith('40'), 'handshake ผ่านก่อน');
    const { seen, missing } = await collectEvents(s, ['new_alert'], { deadlineMs: 6000 });
    assert.deepEqual(missing, [], 'ต้องได้ new_alert จากรอบฉีด');

    const a = seen.new_alert;
    for (const key of ['id', 'type', 'severity', 'message', 'metric', 'value', 'threshold', 'ruleId', 'timestamp']) {
      assert.ok(key in a, `new_alert ต้องมีฟิลด์ ${key} (ตาม allowlist ของจริง)`);
    }

    // REST ประวัติต้องมีตัวเดียวกันที่หัว list — socket กับ REST มาจากที่เดียวกันเสมอ
    const r = await fetch(`${BASE}/api/automation/alerts`, { headers: AUTH });
    assert.equal(r.status, 200);
    const rows = await r.json();
    assert.ok(Array.isArray(rows) && rows.length >= 2, 'ประวัติต้องมี seed + ตัว inject แล้ว');
    assert.equal(rows[0]?.id, a.id, 'หัวประวัติ REST ต้องเป็น alert ที่เพิ่ง push ทาง socket');
    assert.ok(['critical', 'warning', 'info'].includes(rows[0]?.severity));
  } finally { s.close(); }
});

test('alert สด: critical scenario ยิง critical_alert คู่กับ new_alert (ครบใน ~3 รอบสลับฉาก)', async () => {
  const s = await wsHandshake(BASE, { token: makeToken() });
  try {
    const ack = await nextTimeout(s);
    assert.ok(ack && ack.startsWith('40'), 'handshake ผ่านก่อน');
    // ฉากวน 3 แบบ (critical/warning/info) — ภายใน ~4 รอบ (≈5 วิ) ต้องเจอ critical_alert แน่
    const { seen, missing } = await collectEvents(s, ['critical_alert'], { deadlineMs: 8000 });
    assert.deepEqual(missing, [], 'ต้องได้ critical_alert ภายในรอบ critical');
    for (const key of ['id', 'type', 'severity', 'message', 'nodeId', 'battery_soc', 'level', 'timestamp']) {
      assert.ok(key in seen.critical_alert, `critical_alert ต้องมีฟิลด์ ${key}`);
    }
    assert.equal(seen.critical_alert.severity, 'critical');
  } finally { s.close(); }
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
