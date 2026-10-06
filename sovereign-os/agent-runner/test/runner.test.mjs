// test/runner.test.mjs — เทสต์ runner โดยไม่ต้องต่อ HUB จริง
//
// red-first ตามกฎข้อ 8 ของ AGENTS.md: เขียนเทสต์นี้ก่อนแล้วค่อยเขียนโค้ด
//
// รัน: node --test sovereign-os/agent-runner/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommand,
  supportsExecutor,
  parseOpencodeOutput,
  runJob,
  pollOnce,
  createRunner,
  resolveCaptureScreenshot,
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