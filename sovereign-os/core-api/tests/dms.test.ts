// tests/dms.test.ts — Series 🔴 External Dead-Man Switch
// ครอบ: rolling-key HMAC (หมุน 5 นาที + ยอมรับ ±1 window), timestamp window,
// replay (seq monotonic), unknown device, WoL magic packet, state machine บันได 90s/180s,
// cooldown anti-flap, dry-run, persistence, HTTP routes (/ping 401-503, /status 401-403)
import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  DMS_KEY_ROTATION_SEC,
  rollingKey,
  signDmsPing,
  verifyDmsPing,
  buildWolMagicPacket,
  sendWolMagicPacket,
  DmsService,
} from '../src/services/dms.service';
import { createDmsRouter } from '../src/modules/dms/dms.routes';
import { createTestServer, makeToken } from './helpers';

const SECRET = 'test-dms-master-secret-0123456789abcdef0123456789abcdef';
const DEVICE = 'dms-esp32s3-01';
const OTHER_DEVICE = 'dms-pizero-02';

function baseCfg(overrides: Record<string, any> = {}) {
  return {
    enabled: true,
    masterSecret: SECRET,
    missedMs: 90000,
    failoverMs: 180000,
    autoFailover: false,
    wolMac: '',
    wolBroadcast: '192.168.1.255',
    failoverCooldownMs: 300000,
    allowedDevices: [DEVICE, OTHER_DEVICE],
    dryRun: false,
    clockToleranceMs: 60000,
    ...overrides,
  };
}

function makeEventRecorder() {
  const events: Array<{ event_type: string; severity: string; description: string }> = [];
  return {
    events,
    prisma: { securityEvent: { create: async ({ data }: any) => { events.push(data); return data; } } },
  };
}

function makeDeps(overrides: Record<string, any> = {}) {
  const recorder = makeEventRecorder();
  const calls: any[] = [];
  return {
    recorder,
    calls,
    deps: {
      now: () => 1_800_000_000_000,
      prisma: recorder.prisma,
      sendWol: async (mac: string, bc: string) => { calls.push({ kind: 'wol', mac, bc }); return true; },
      sendTelegram: async (p: any) => { calls.push({ kind: 'telegram', ...p }); return { sent: true, reason: 'test' }; },
      stateFile: path.join(os.tmpdir(), `dms-test-${Date.now()}.json`),
      ...overrides,
    },
  };
}

describe('rolling key + HMAC', () => {
  test('rollingKey หมุนทุก 5 นาที — ค่าเดียวกันใน window, ต่างกันข้าม window', () => {
    const t0 = 1_800_000_000; // unix วินาที
    const keyA = rollingKey(SECRET, t0);
    const keyB = rollingKey(SECRET, t0 + 100);
    const keyC = rollingKey(SECRET, t0 + DMS_KEY_ROTATION_SEC);
    const keyD = rollingKey(SECRET, t0 - DMS_KEY_ROTATION_SEC);
    assert.deepEqual(keyA, keyB);
    assert.notDeepEqual(keyA, keyC);
    assert.notDeepEqual(keyA, keyD);
  });

  test('signDmsPing → 64 hex deterministic', () => {
    const sig = signDmsPing(SECRET, DEVICE, 1_800_000_000, 1);
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(sig, signDmsPing(SECRET, DEVICE, 1_800_000_000, 1));
    assert.notEqual(sig, signDmsPing(SECRET, DEVICE, 1_800_000_000, 2));
  });
});

describe('verifyDmsPing (pure)', () => {
  const now = 1_800_000_000_000;
  const ts = Math.floor(now / 1000);
  const sig = signDmsPing(SECRET, DEVICE, ts, 5);
  const opts = { allowedDevices: [DEVICE] };

  test('signature ถูก → ok', () => {
    assert.deepEqual(verifyDmsPing({ deviceId: DEVICE, ts, seq: 5, sig }, SECRET, now, opts), {
      ok: true,
      reason: 'signature_ok',
    });
  });

  test('ยอมรับ ts ที่ข้ามขอบ key window (drift ภายใน tolerance, sig ใช้ key ของ ts เอง)', () => {
    // ts = 1_800_000_000 อยู่ที่ขอบพอดี (หาร 300 ลงตัว) — พอ ts−1 จะตก window ก่อนหน้า
    // drift −1s อยู่ใน tolerance 60s → ต้องผ่าน (server คำนวณ key จาก ts ±300 ครอบทั้ง 2 window)
    const t2 = ts - 1;
    const sig2 = signDmsPing(SECRET, DEVICE, t2, 5);
    assert.equal(verifyDmsPing({ deviceId: DEVICE, ts: t2, seq: 5, sig: sig2 }, SECRET, now, opts).ok, true);
  });

  test('ts เกิน tolerance 60s → bad_timestamp (แม้ sig ถูก) — ±1 key window ไม่ bypass tolerance', () => {
    for (const drift of [61, -61, 301, -301]) {
      const t2 = ts + drift;
      const sig2 = signDmsPing(SECRET, DEVICE, t2, 5);
      assert.deepEqual(verifyDmsPing({ deviceId: DEVICE, ts: t2, seq: 5, sig: sig2 }, SECRET, now, opts), {
        ok: false,
        reason: 'bad_timestamp',
      });
    }
  });

  test('device ไม่อยู่ในรายการ → unknown_device (และ secret ว่าง)', () => {
    assert.deepEqual(
      verifyDmsPing({ deviceId: 'hacker-device', ts, seq: 1, sig }, SECRET, now, opts),
      { ok: false, reason: 'unknown_device' }
    );
    assert.deepEqual(verifyDmsPing({ deviceId: DEVICE, ts, seq: 1, sig }, '', now, opts), {
      ok: false,
      reason: 'unknown_device',
    });
  });

  test('seq ≤ ล่าสุด → replay', () => {
    assert.deepEqual(
      verifyDmsPing({ deviceId: DEVICE, ts, seq: 5, sig }, SECRET, now, { ...opts, lastSeq: 5 }),
      { ok: false, reason: 'replay' }
    );
    assert.deepEqual(
      verifyDmsPing({ deviceId: DEVICE, ts, seq: 4, sig }, SECRET, now, { ...opts, lastSeq: 7 }),
      { ok: false, reason: 'replay' }
    );
  });

  test('sig ผิด / รูปแบบไม่ถูก → bad_signature', () => {
    assert.deepEqual(verifyDmsPing({ deviceId: DEVICE, ts, seq: 5, sig: '0'.repeat(64) }, SECRET, now, opts), {
      ok: false,
      reason: 'bad_signature',
    });
    assert.deepEqual(verifyDmsPing({ deviceId: DEVICE, ts, seq: 5, sig: 'short' }, SECRET, now, opts), {
      ok: false,
      reason: 'bad_signature',
    });
  });
});

describe('Wake-on-LAN', () => {
  test('buildWolMagicPacket = FF×6 + MAC×16', () => {
    const packet = buildWolMagicPacket('AA:BB:CC:DD:EE:FF');
    assert.equal(packet.length, 6 + 16 * 6);
    assert.deepEqual([...packet.subarray(0, 6)], Array(6).fill(0xff));
    assert.deepEqual([...packet.subarray(6, 12)], [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    assert.deepEqual(packet.subarray(6, 12), packet.subarray(12, 18));
  });

  test('MAC ผิด format → throw', () => {
    assert.throws(() => buildWolMagicPacket('not-a-mac'));
  });

  test('sendWolMagicPacket → true (UDP ยิงออกหลุมดำ ไม่ต้องมี server)', async () => {
    const ok = await sendWolMagicPacket('AA:BB:CC:DD:EE:FF', '127.0.0.1', 9);
    assert.equal(ok, true);
  });

  test('MAC ไม่ถูก → false ไม่ throw', async () => {
    const ok = await sendWolMagicPacket('bogus', '127.0.0.1', 9);
    assert.equal(ok, false);
  });
});

describe('DmsService — ladder & state machine', () => {
  test('constructor ปฏิเสธ failoverMs <= missedMs', () => {
    assert.throws(() => new DmsService(baseCfg({ failoverMs: 50000 }), {}));
  });

  test('init() สร้าง state ของ device ที่ขึ้นทะเบียนไว้', () => {
    const { deps } = makeDeps();
    const svc = new DmsService(baseCfg(), deps);
    svc.init();
    assert.deepEqual(svc.status().level, { [DEVICE]: 'ALIVE', [OTHER_DEVICE]: 'ALIVE' });
  });

  test('ping ผ่าน → ALIVE + lastSeen/lastSeq อัปเดต; seq ซ้ำ → replay', async () => {
    const { deps } = makeDeps();
    const svc = new DmsService(baseCfg(), deps);
    svc.init();
    const now = deps.now();
    const ts = Math.floor(now / 1000);

    const good = await svc.handlePing({ deviceId: DEVICE, ts, seq: 1, sig: signDmsPing(SECRET, DEVICE, ts, 1) }, { batPct: 82 });
    assert.equal(good.ok, true);
    const replay = await svc.handlePing({ deviceId: DEVICE, ts, seq: 1, sig: signDmsPing(SECRET, DEVICE, ts, 1) });
    assert.deepEqual(replay, { ok: false, reason: 'replay' });

    const st = svc.status().devices.find((d) => d.deviceId === DEVICE)!;
    assert.equal(st.level, 'ALIVE');
    assert.equal(st.lastSeen, now);
    assert.equal(st.lastSeq, 1);
    assert.equal(st.lastBatteryPct, 82);
  });

  test('HMAC ผิด → DMS_SIGNATURE_FAIL (critical, rate-limit 60s ต่อ device)', async () => {
    const { deps, recorder, calls } = makeDeps();
    const svc = new DmsService(baseCfg(), deps);
    svc.init();
    const now = deps.now();
    const ts = Math.floor(now / 1000);

    const r1 = await svc.handlePing({ deviceId: DEVICE, ts, seq: 1, sig: '0'.repeat(64) }, {});
    assert.deepEqual(r1, { ok: false, reason: 'bad_signature' });
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_SIGNATURE_FAIL').length, 1);
    assert.equal(calls.some((c) => c.kind === 'telegram' && c.severity === 'critical'), true);

    // ยิงซ้ำภายใน 60s → ไม่ duplicate event
    await svc.handlePing({ deviceId: DEVICE, ts, seq: 2, sig: '0'.repeat(64) }, {});
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_SIGNATURE_FAIL').length, 1);
  });

  test('หาย 91s → SUSPECT + DMS_PING_MISSED (warning) ครั้งเดียว; กลับมา → RECOVERED + ALL CLEAR', async () => {
    const mutable: any = { now: 1_800_000_000_000 };
    const { recorder, calls, deps } = makeDeps({ now: () => mutable.now });
    const svc = new DmsService(baseCfg(), deps);
    svc.init();
    const ts = () => Math.floor(mutable.now / 1000);

    await svc.handlePing({ deviceId: DEVICE, ts: ts(), seq: 1, sig: signDmsPing(SECRET, DEVICE, ts(), 1) }, {});
    mutable.now += 91_000; // > MISSED_MS (90s)
    await svc.checkLadder();

    let dev = svc.status().devices.find((d) => d.deviceId === DEVICE)!;
    assert.equal(dev.level, 'SUSPECT');
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_PING_MISSED').length, 1);
    assert.equal(calls.some((c) => c.kind === 'telegram' && c.severity === 'warn'), true);

    // worker tick ซ้ำ → ไม่ duplicate
    await svc.checkLadder();
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_PING_MISSED').length, 1);

    // กลับมา ping → RECOVERED + ALL CLEAR
    mutable.now += 10_000;
    await svc.handlePing({ deviceId: DEVICE, ts: ts(), seq: 2, sig: signDmsPing(SECRET, DEVICE, ts(), 2) }, {});
    dev = svc.status().devices.find((d) => d.deviceId === DEVICE)!;
    assert.equal(dev.level, 'ALIVE');
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_PING_RECOVERED').length, 1);
    assert.ok(calls.some((c) => c.kind === 'telegram' && c.text.includes('ALL CLEAR')));
  });

  test('หาย 181s → FAILOVER_ACTIVE + DMS_FAILOVER_TRIGGERED (critical); cooldown กันยิงซ้ำ', async () => {
    const mutable: any = { now: 1_800_000_000_000 };
    const { recorder, calls, deps } = makeDeps({ now: () => mutable.now });
    const svc = new DmsService(baseCfg({ autoFailover: true, wolMac: 'AA:BB:CC:DD:EE:FF' }), deps);
    svc.init();
    const ts = () => Math.floor(mutable.now / 1000);

    await svc.handlePing({ deviceId: DEVICE, ts: ts(), seq: 1, sig: signDmsPing(SECRET, DEVICE, ts(), 1) }, {});
    mutable.now += 181_000; // > FAILOVER_MS (180s)
    await svc.checkLadder();

    let dev = svc.status().devices.find((d) => d.deviceId === DEVICE)!;
    assert.equal(dev.level, 'FAILOVER_ACTIVE');
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_FAILOVER_TRIGGERED').length, 1);
    assert.equal(calls.some((c) => c.kind === 'wol'), true); // autoFailover + MAC → ยิง WoL

    // cooldown ยังไม่หมด → ไม่ยิงซ้ำ
    mutable.now += 10_000;
    await svc.checkLadder();
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_FAILOVER_TRIGGERED').length, 1);
    assert.equal(calls.filter((c) => c.kind === 'wol').length, 1);

    // ผ่าน cooldown แล้วยังเงียบ → ย้ำ (รอบที่ 2)
    mutable.now += 300_000;
    await svc.checkLadder();
    assert.equal(recorder.events.filter((e) => e.event_type === 'DMS_FAILOVER_TRIGGERED').length, 2);
    assert.equal(calls.filter((c) => c.kind === 'wol').length, 2);
  });

  test('autoFailover=false → แจ้งเตือนอย่างเดียว ไม่ยิง WoL ต่อให้ตั้ง MAC', async () => {
    const mutable: any = { now: 1_800_000_000_000 };
    const { calls, deps } = makeDeps({ now: () => mutable.now });
    const svc = new DmsService(baseCfg({ autoFailover: false, wolMac: 'AA:BB:CC:DD:EE:FF' }), deps);
    svc.init();
    const ts = () => Math.floor(mutable.now / 1000);
    await svc.handlePing({ deviceId: DEVICE, ts: ts(), seq: 1, sig: signDmsPing(SECRET, DEVICE, ts(), 1) }, {});
    mutable.now += 200_000;
    await svc.checkLadder();
    assert.equal(calls.some((c) => c.kind === 'wol'), false);
    assert.equal(calls.some((c) => c.kind === 'telegram' && c.severity === 'critical'), true);
  });

  test('dry-run=true → ไม่ยิง WoL/Telegram จริง แต่นับลาดเดอร์ครบ', async () => {
    const mutable: any = { now: 1_800_000_000_000 };
    const { calls, deps } = makeDeps({ now: () => mutable.now });
    const svc = new DmsService(baseCfg({ autoFailover: true, wolMac: 'AA:BB:CC:DD:EE:FF', dryRun: true }), deps);
    svc.init();
    const ts = () => Math.floor(mutable.now / 1000);
    await svc.handlePing({ deviceId: DEVICE, ts: ts(), seq: 1, sig: signDmsPing(SECRET, DEVICE, ts(), 1) }, {});
    mutable.now += 200_000;
    await svc.checkLadder();
    assert.equal(calls.some((c) => c.kind === 'wol'), false);
    assert.equal(calls.some((c) => c.kind === 'telegram'), false);
    assert.equal(svc.status().devices.find((d) => d.deviceId === DEVICE)!.level, 'FAILOVER_ACTIVE');
  });

  test('persistence — state รอดข้าม restart (reboot DMS ไม่ลืม)', async () => {
    const stateFile = path.join(os.tmpdir(), `dms-persist-${Date.now()}.json`);
    const { deps, recorder } = makeDeps({ stateFile });
    const svcA = new DmsService(baseCfg(), deps);
    svcA.init();
    const now = deps.now();
    const ts = Math.floor(now / 1000);
    await svcA.handlePing({ deviceId: DEVICE, ts, seq: 3, sig: signDmsPing(SECRET, DEVICE, ts, 3) }, {});
    const fileExists = fs.existsSync(stateFile);
    assert.equal(fileExists, true);

    // instance ใหม่ อ่านจากไฟล์ — seq ต่อเนื่องจากเดิม (seq 3 แล้ว → 3/2 = replay)
    const svcB = new DmsService(baseCfg(), { ...deps, stateFile, prisma: recorder.prisma });
    svcB.init();
    const st = svcB.status().devices.find((d) => d.deviceId === DEVICE)!;
    assert.equal(st.lastSeq, 3);
    assert.equal(st.lastSeen, now);
    const replay = await svcB.handlePing({ deviceId: DEVICE, ts, seq: 3, sig: signDmsPing(SECRET, DEVICE, ts, 3) });
    assert.deepEqual(replay, { ok: false, reason: 'replay' });
  });

  test('status() shape ครบ', () => {
    const { deps } = makeDeps();
    const svc = new DmsService(baseCfg(), deps);
    svc.init();
    const s = svc.status();
    assert.equal(s.enabled, true);
    assert.equal(s.dryRun, false);
    assert.ok(Array.isArray(s.devices));
    assert.ok('level' in s);
  });
});

describe('HTTP routes', () => {
  let server: any;

  after(async () => {
    if (server) await server.close();
  });

  test('POST /ping: ถูก → 200 / HMAC ผิด → 401 / device ผิด → 401 / ปิด → 503', async () => {
    const { deps } = makeDeps();
    const svc = new DmsService(baseCfg(), deps);
    svc.init();
    const server1 = await createTestServer((app) => app.use('/api/v1/dms', createDmsRouter(svc)));
    server = server1;

    const now = deps.now();
    const ts = Math.floor(now / 1000);

    let res = await fetch(`${server.baseUrl}/api/v1/dms/ping`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dms-device': DEVICE,
        'x-dms-timestamp': String(ts),
        'x-dms-signature': signDmsPing(SECRET, DEVICE, ts, 1),
      },
      body: JSON.stringify({ seq: 1, uptime: 4567, bat_pct: 82 }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);

    res = await fetch(`${server.baseUrl}/api/v1/dms/ping`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dms-device': DEVICE,
        'x-dms-timestamp': String(ts),
        'x-dms-signature': '0'.repeat(64),
      },
      body: JSON.stringify({ seq: 2 }),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).reason, 'bad_signature');

    res = await fetch(`${server.baseUrl}/api/v1/dms/ping`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dms-device': 'hacker-device',
        'x-dms-timestamp': String(ts),
        'x-dms-signature': signDmsPing(SECRET, 'hacker-device', ts, 1),
      },
      body: JSON.stringify({ seq: 1 }),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).reason, 'unknown_device');

    // disabled → 503
    const off = new DmsService(baseCfg({ enabled: false, masterSecret: '' }), makeDeps().deps);
    const server2 = await createTestServer((app) => app.use('/api/v1/dms', createDmsRouter(off)));
    res = await fetch(`${server2.baseUrl}/api/v1/dms/ping`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dms-device': DEVICE,
        'x-dms-timestamp': String(ts),
        'x-dms-signature': signDmsPing(SECRET, DEVICE, ts, 1),
      },
      body: JSON.stringify({ seq: 1 }),
    });
    assert.equal(res.status, 503);
    await server2.close();
    await server1.close(); // ปิด server ตัวแรก — กัน test runner ค้าง (after() ปิดแค่ตัวล่าสุด)
  }, { timeout: 15000 });

  test('GET /status: ไม่มี token → 401 / member → 403 / SUPERADMIN → 200', async () => {
    const { deps } = makeDeps();
    const svc = new DmsService(baseCfg(), deps);
    svc.init();
    server = await createTestServer((app) => app.use('/api/v1/dms', createDmsRouter(svc)));

    let res = await fetch(`${server.baseUrl}/api/v1/dms/status`);
    assert.equal(res.status, 401);

    res = await fetch(`${server.baseUrl}/api/v1/dms/status`, {
      headers: { authorization: `Bearer ${makeToken('MEMBER')}` },
    });
    assert.equal(res.status, 403);

    res = await fetch(`${server.baseUrl}/api/v1/dms/status`, {
      headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.ok(body.devices.some((d: any) => d.deviceId === DEVICE));
  }, { timeout: 15000 });
});