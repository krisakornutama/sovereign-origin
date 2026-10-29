// test/runner.test.mjs — เทสต์ runner โดยไม่ต้องต่อ HUB จริง
//
// red-first ตามกฎข้อ 8 ของ AGENTS.md: เขียนเทสต์นี้ก่อนแล้วค่อยเขียนโค้ด
//
// รัน: node --test sovereign-os/agent-runner/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildCommand,
  supportsExecutor,
  parseOpencodeOutput,
  runJob,
  pollOnce,
  createRunner,
  resolveCaptureScreenshot,
  killProcessTree,
} from '../src/runner.mjs';
import { captureScreenshot } from '../src/screenshot.mjs';

test('supportsExecutor กรองเฉพาะ executor ที่เครื่องนี้เปิดใช้', () => {
  assert.equal(supportsExecutor(['echo', 'opencode'], 'echo'), true);
  assert.equal(supportsExecutor(['echo'], 'opencode'), false);
  assert.equal(supportsExecutor([], 'opencode'), false, 'ไม่ได้ตั้งค่าเลย = ปิดหมด');
});

test('buildCommand — echo ไม่ต้อง spawn อะไรเลย', () => {
  const cmd = buildCommand({ executor: 'echo', prompt: 'ทดสอบ' }, { machineName: 'runner-a' });
  assert.equal(cmd.kind, 'inline');
  assert.match(cmd.stdout, /ทดสอบ/);
});

test('buildCommand — opencode ใส่ flag ครบ (json/auto/dir)', () => {
  const cmd = buildCommand(
    { executor: 'opencode', prompt: 'แก้บั๊ก', model: 'ollama/gemma3', agent: 'coder-full', workspace: 'E:/work' },
    { machineName: 'runner-a', opencodeBin: 'opencode' },
  );
  assert.equal(cmd.kind, 'spawn');
  assert.equal(cmd.bin, 'opencode');
  assert.ok(cmd.args.includes('--format'));
  assert.ok(cmd.args.includes('json'));
  assert.ok(cmd.args.includes('--auto'), 'ต้อง auto ไม่ใช่ค้างรอถาม permission');
  assert.ok(cmd.args.includes('--dir'));
  assert.ok(cmd.args.includes('E:/work'));
  assert.ok(cmd.args.includes('ollama/gemma3'));
  assert.equal(cmd.timeoutMs, 30 * 60 * 1000, 'งาน agent ต้องได้เวลานานพอสมควร');
});

test('buildCommand — ถ้าไม่ระบุ model ห้ามใส่ --model (ให้ opencode ใช้ค่าเริ่มต้นของเครื่อง)', () => {
  const cmd = buildCommand({ executor: 'opencode', prompt: 'x' }, { machineName: 'r' });
  assert.equal(cmd.args.includes('--model'), false);
});

test('parseOpencodeOutput — ดึงข้อความผลลัพธ์จาก JSON events', () => {
  const lines = [
    JSON.stringify({ type: 'text', text: 'แก้เสร็จแล้ว' }),
    JSON.stringify({ type: 'tool', name: 'edit' }),
    JSON.stringify({ type: 'done' }),
  ].join('\n');
  const out = parseOpencodeOutput(lines);
  assert.equal(out.summary, 'แก้เสร็จแล้ว');
  assert.equal(out.hadError, false);
});

test('parseOpencodeOutput — จับ error ได้และไม่ทับด้วยข้อความสำเร็จ', () => {
  const lines = [
    JSON.stringify({ type: 'text', text: 'เริ่มทำ' }),
    JSON.stringify({ type: 'error', error: { message: 'Model not found' } }),
  ].join('\n');
  const out = parseOpencodeOutput(lines);
  assert.equal(out.hadError, true);
  assert.match(out.summary, /Model not found/);
});

test('parseOpencodeOutput — ข้อความที่ไม่ใช่ JSON ต้องไม่ทำให้พัง', () => {
  const out = parseOpencodeOutput('not json\nalso not json');
  assert.equal(out.hadError, false);
  assert.ok(typeof out.summary === 'string');
});

test('runJob — echo คืนผลสำเร็จพร้อม exitCode 0', async () => {
  const result = await runJob({ id: 'j-1', executor: 'echo', prompt: 'สวัสดี' }, { machineName: 'r' });
  assert.equal(result.status, 'done');
  assert.equal(result.exitCode, 0);
  assert.match(result.summary, /สวัสดี/);
});

test('runJob — executor ที่ไม่รู้จักต้องรายงาน error ไม่ใช่เงียบไป', async () => {
  const result = await runJob({ id: 'j-2', executor: 'made-up' }, { machineName: 'r' });
  assert.equal(result.status, 'error');
  assert.match(result.summary, /executor/i);
});

test('pollOnce — heartbeat แล้ว pull แล้วรันและรายงานผลครบวงจร', async () => {
  const calls = [];
  const hub = {
    heartbeat: async () => { calls.push('heartbeat'); return { status: 'online' }; },
    pullJobs: async () => { calls.push('pull'); return [{ id: 'j-9', executor: 'echo', prompt: 'งานทดสอบ' }]; },
    reportResult: async (_id, r) => { calls.push(`report:${r.status}`); },
  };
  const out = await pollOnce({ machineName: 'r', hub, runner: { machineName: 'r' } });
  assert.deepEqual(calls, ['heartbeat', 'pull', 'report:done']);
  assert.equal(out.dispatched, 1);
  assert.equal(out.failed, 0);
});

test('pollOnce — งานที่พังต้องรายงาน error (ห้ามกลืนเงียบ)', async () => {
  const reports = [];
  const hub = {
    heartbeat: async () => ({ status: 'online' }),
    pullJobs: async () => [{ id: 'j-10', executor: 'made-up', prompt: 'x' }],
    reportResult: async (_id, r) => { reports.push(r); },
  };
  const out = await pollOnce({ machineName: 'r', hub, runner: { machineName: 'r' } });
  assert.equal(out.dispatched, 1);
  assert.equal(out.failed, 1);
  assert.equal(reports[0].status, 'error');
});

test('pollOnce — HUB ล่มต้องไม่ทำให้ runner ตาย (คืน error ให้ลองรอบหน้า)', async () => {
  const hub = {
    heartbeat: async () => { throw new Error('ECONNREFUSED'); },
    pullJobs: async () => [],
    reportResult: async () => {},
  };
  const out = await pollOnce({ machineName: 'r', hub, runner: { machineName: 'r' } });
  assert.equal(out.dispatched, 0);
  assert.match(out.error, /ECONNREFUSED/);
});

test('pollOnce — ไม่มีงานคือสถานะปกติ ไม่ใช่ error', async () => {
  const hub = {
    heartbeat: async () => ({ status: 'online' }),
    pullJobs: async () => [],
    reportResult: async () => { assert.fail('ไม่ควรรายงานผลเมื่อไม่มีงาน'); },
  };
  const out = await pollOnce({ machineName: 'r', hub, runner: { machineName: 'r' } });
  assert.equal(out.dispatched, 0);
  assert.equal(out.error, undefined);
});

test('createRunner — คืนฟังก์ชัน start/stop ได้ และไม่ยิงออกไปเองตอนสร้าง', () => {
  let ticks = 0;
  const runner = createRunner({
    config: { machineName: 'r', intervalMs: 5 },
    hub: {
      heartbeat: async () => ({ status: 'online' }),
      pullJobs: async () => [],
      reportResult: async () => {},
    },
    runner: { machineName: 'r' },
    runOnce: async () => { ticks++; },
  });
  assert.equal(ticks, 0, 'ต้องไม่ทำงานจนกว่าจะ start');
  assert.equal(typeof runner.start, 'function');
  assert.equal(typeof runner.stop, 'function');
  assert.equal(runner.isRunning(), false);
});

// ── ภาพหน้าจอตอนจบงาน (chunk 2) ──
// red-first: ก่อนหน้านี้ runner ไม่จับภาพเลย ⇒ ภาพจบงานไม่มีทางถึงผู้ใช้

test('resolveCaptureScreenshot — เปิดเป็นค่าเริ่มต้น ปิดได้เมื่อสั่งชัด', () => {
  assert.equal(resolveCaptureScreenshot(undefined), true, 'ไม่ตั้งค่า = เปิด (ตามแผนงาน)');
  assert.equal(resolveCaptureScreenshot('true'), true);
  assert.equal(resolveCaptureScreenshot('1'), true);
  assert.equal(resolveCaptureScreenshot('false'), false);
  assert.equal(resolveCaptureScreenshot('0'), false);
  assert.equal(resolveCaptureScreenshot('no'), false);
  assert.equal(resolveCaptureScreenshot('off'), false);
});

test('captureScreenshot — แพลตฟอร์มที่ไม่ใช่ Windows คืน null (ไม่ทำให้ runner ตาย)', async () => {
  assert.equal(await captureScreenshot({ platform: 'linux' }), null);
});

test('captureScreenshot — Windows เรียกคำสั่งจับภาพแล้วคืน Buffer', async () => {
  const b64 = Buffer.from('hello-png').toString('base64');
  let called = 0;
  const buf = await captureScreenshot({
    platform: 'win32',
    run: async () => {
      called += 1;
      return `${b64}\n`;
    },
  });
  assert.equal(called, 1);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString(), 'hello-png');
});

test('captureScreenshot — คำสั่งจับภาพล้มต้องคืน null ไม่โยน error', async () => {
  const buf = await captureScreenshot({
    platform: 'win32',
    run: async () => {
      throw new Error('powershell not found');
    },
  });
  assert.equal(buf, null);
});

test('pollOnce — เปิดจับภาพต้องอัปโหลดก่อนรายงานผล และแนบ URL กลับไป', async () => {
  const order = [];
  const hub = {
    heartbeat: async () => ({ status: 'online' }),
    pullJobs: async () => [{ id: 'j-1', executor: 'echo', prompt: 'x' }],
    uploadScreenshot: async (id) => {
      order.push(`upload:${id}`);
      return { screenshotUrl: '/api/agent-machines/screenshots/x.png' };
    },
    reportResult: async (_id, r) => {
      order.push(`report:${r.screenshotUrl}`);
    },
  };
  const out = await pollOnce({
    machineName: 'r',
    hub,
    runner: { machineName: 'r', captureScreenshot: true, capture: async () => Buffer.from('png') },
  });
  assert.deepEqual(order, ['upload:j-1', 'report:/api/agent-machines/screenshots/x.png']);
  assert.equal(out.dispatched, 1);
});

test('pollOnce — ปิดจับภาพต้องไม่จับและไม่อัปโหลดเลย', async () => {
  let uploaded = 0;
  const hub = {
    heartbeat: async () => ({ status: 'online' }),
    pullJobs: async () => [{ id: 'j-1', executor: 'echo', prompt: 'x' }],
    uploadScreenshot: async () => {
      uploaded += 1;
    },
    reportResult: async () => {},
  };
  await pollOnce({
    machineName: 'r',
    hub,
    runner: {
      machineName: 'r',
      captureScreenshot: false,
      capture: async () => {
        throw new Error('ต้องไม่ถูกเรียกเมื่อปิดจับภาพ');
      },
    },
  });
  assert.equal(uploaded, 0);
});

test('pollOnce — อัปโหลดภาพล้มต้องยังรายงานผลงานสำเร็จ (ห้ามกลืนงาน)', async () => {
  let reported = null;
  const hub = {
    heartbeat: async () => ({ status: 'online' }),
    pullJobs: async () => [{ id: 'j-1', executor: 'echo', prompt: 'x' }],
    uploadScreenshot: async () => {
      throw new Error('ECONNRESET');
    },
    reportResult: async (_id, r) => {
      reported = r;
    },
  };
  const out = await pollOnce({
    machineName: 'r',
    hub,
    runner: { machineName: 'r', captureScreenshot: true, capture: async () => Buffer.from('png') },
  });
  assert.equal(out.dispatched, 1);
  assert.equal(out.failed, 0, 'งานทำสำเร็จแล้ว ภาพส่งไม่ได้ต้องไม่ทำให้กลายเป็น error');
  assert.equal(reported.status, 'done');
  assert.equal(reported.screenshotUrl, null);
});

// ── งานค้างทั้งที่เครื่องยังทำงาน (29/10/69 — เจอจริงกับเครื่อง 2) ─────────────
// opencode `run` จะอ่าน stdin จนจบ (EOF) เมื่อ stdin ไม่ใช่ TTY
// runner เดิม spawn แบบ pipe ที่เปิดค้าง ⇒ opencode รอ EOF ตลอดไป ⇒ งานค้าง 30 นาที
// พิสูจน์ด้วยมือบน HUB: stdin เปิดค้าง = ไม่มี output 30 วิ · stdio ignore = ออกทันที
test('runJob — spawn ต้องปิด stdin + ซ่อนหน้าต่าง (opencode รอ EOF จาก pipe = งานค้าง)', async () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', '{"type":"text","text":"ok"}\n');
      child.emit('close', 0);
    });
    return child;
  };
  const res = await runJob({ executor: 'opencode', prompt: 'x' }, { spawnImpl: fakeSpawn, opencodeBin: 'fake-opencode-not-real-xyz' });
  assert.equal(res.status, 'done', res.summary);
  assert.equal(calls.length, 1, 'runJob ต้องใช้ spawnImpl ที่ฉีดเข้ามา (เทสต์ต้องไม่ spawn จริง)');
  assert.deepEqual(
    calls[0].opts.stdio,
    ['ignore', 'pipe', 'pipe'],
    'stdin ต้องเป็น ignore — pipe ที่เปิดค้างทำให้ opencode รอ EOF แล้วงานค้างทั้งที่เครื่องยังทำงาน',
  );
  assert.equal(calls[0].opts.windowsHide, true, 'ต้องซ่อนหน้าต่าง cmd ตอน spawn (runner ทำงานเบื้องหลัง)');
});

test('pollOnce — งานยาวต้องไม่ขาด heartbeat (HUB ต้องไม่เห็นเครื่อง offline ระหว่างงาน)', async () => {
  let beats = 0;
  const hub = {
    heartbeat: async () => {
      beats += 1;
      return { status: 'online' };
    },
    pullJobs: async () => ({ jobs: [{ id: 'j-long', executor: 'opencode', prompt: 'x' }] }),
    reportResult: async () => ({}),
  };
  // งานจำลองใช้เวลา ~600ms — นานกว่าช่วง heartbeat ที่ตั้งไว้หลายเท่า
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit('data', '{"type":"text","text":"ok"}\n');
      child.emit('close', 0);
    }, 600);
    return child;
  };
  const out = await pollOnce({
    machineName: 'r',
    hub,
    runner: { spawnImpl: fakeSpawn, opencodeBin: 'fake-opencode-not-real-xyz' },
    heartbeatSec: 0.05,
  });
  assert.equal(out.dispatched, 1);
  assert.ok(
    beats >= 2,
    `ต้องมี heartbeat ระหว่างงานด้วย (ได้ ${beats} ครั้ง) — เดิม heartbeat อยู่นอก loop งาน ⇒ งาน 30 นาที = เครื่องดู offline 30 นาที`,
  );
});

// ── งานหมดเวลาแล้ว "ฆ่าไม่จริง" = opencode ค้างกิน CPU (30/10/69 — เจอจริงเครื่อง 2) ──
// child.kill() บน Windows ฆ่าแค่ cmd.exe ที่ห่อคำสั่ง — ตัวจริง (opencode.exe) รอดชีวิต
// เจอจริง: งาน timeout 21:31 แล้ว opencode ยังกิน CPU ต่ออีกกว่า 3 ชั่วโมง
test('killProcessTree — Windows ต้องฆ่าทั้ง tree ด้วย taskkill /T /F', () => {
  const calls = [];
  const fakeSpawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    return { on: () => {} };
  };
  const ok = killProcessTree(
    { pid: 4242, kill: () => { throw new Error('ห้ามใช้ child.kill บน Windows — มันฆ่าแค่ cmd.exe'); } },
    { platform: 'win32', spawnImpl: fakeSpawn },
  );
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, 'taskkill');
  assert.deepEqual(calls[0].args, ['/pid', '4242', '/T', '/F']);
  assert.equal(calls[0].opts.windowsHide, true, 'ต้องไม่เด้งหน้าต่างดำขึ้นมาบนเครื่องลูก');
  assert.equal(calls[0].opts.stdio, 'ignore');
});

test('killProcessTree — POSIX ใช้ SIGKILL กับ child ตรง ๆ (ไม่ต้อง spawn taskkill)', () => {
  let sig = null;
  const ok = killProcessTree(
    { pid: 7, kill: (s) => { sig = s; } },
    {
      platform: 'linux',
      spawnImpl: () => {
        throw new Error('ไม่ควร spawn อะไรบน POSIX');
      },
    },
  );
  assert.equal(ok, true);
  assert.equal(sig, 'SIGKILL');
});

test('runJob — หมดเวลาต้องเรียก killProcessTree (ไม่ทิ้ง opencode กิน CPU ค้าง)', async () => {
  const killCalls = [];
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.pid = 9001;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      throw new Error('ต้องฆ่าด้วย killProcessTree ไม่ใช่ child.kill ตรง ๆ');
    };
    return child; // ไม่มีวัน close ⇒ ต้องไปทาง timeout
  };
  const res = await runJob(
    { executor: 'opencode', prompt: 'x', timeoutMs: 60 },
    {
      spawnImpl: fakeSpawn,
      opencodeBin: 'fake-opencode-not-real-xyz',
      killTreeImpl: (child, opts) => {
        killCalls.push({ pid: child.pid, opts });
      },
    },
  );
  assert.equal(res.status, 'error');
  assert.match(res.summary, /หมดเวลา/);
  assert.equal(killCalls.length, 1, 'หมดเวลาแล้วต้องฆ่า process tree หนึ่งครั้ง');
  assert.equal(killCalls[0].pid, 9001);
});