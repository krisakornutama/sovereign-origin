import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SILENT_FAILURES, createControlClient } from '../src/control.mjs';

// ── ช่องควบคุม: ลูปของเครื่องที่ถูกควบคุม ──────────────────────────────────────
//
// ช่องนี้เป็นที่ที่ "คำสั่งของผู้ใช้" กลายเป็นการกระทำจริงบนเครื่องคนอื่น
// ⇒ เทสต์ชุดนี้คุมสัญญาสี่ข้อที่ผิดแล้วพังเงียบที่สุด:
//   1) ทุกคำสั่งต้องมีผลลัพธ์รายงานกลับ HUB เสมอ (ห้ามเงียบ — ไม่งั้นผู้ใช้รอจน timeout)
//   2) คำสั่งที่ไม่รู้จัก / ค่าที่ผิดรูป ต้องไม่ถูกตีความเป็นอย่างอื่น
//   3) HUB ล่มต้องวนลองใหม่ ไม่ทำให้โปรเซสตาย (เครื่องต้องยังรับงาน AI ได้)
//   4) เฟรมภาพต้องถูกส่งออกทาง hub.sendFrame จริง ไม่ใช่จับทิ้ง

/** HUB ปลอม — เก็บสิ่งที่ถูกเรียกทั้งหมดเพื่อตรวจย้อนหลัง */
function fakeHub(commands = []) {
  const sent = [];
  const results = [];
  let nextError = null;
  return {
    sent,
    results,
    /** ให้เทสต์สั่งว่า "รอบต่อไปให้ล้ม" */
    failNext(err) {
      nextError = err;
    },
    async nextCommand() {
      if (nextError) {
        const err = nextError;
        nextError = null;
        throw err;
      }
      return commands.shift() ?? null;
    },
    async sendFrame(frame) {
      sent.push(frame);
    },
    async reportResult(id, outcome) {
      results.push({ id, outcome });
    },
  };
}

/** เครื่องมือจำลองที่บันทึกว่าถูกเรียกยังไง */
function fakeDeps({ frames = [] } = {}) {
  const calls = { setFps: [], screenStop: 0, input: [], fs: [] };
  const screen = {
    isRunning: () => true,
    setFps: (fps) => calls.setFps.push(fps),
    stop: () => {
      calls.screenStop += 1;
    },
  };
  const input = {
    applyEvent: async (event) => {
      calls.input.push(event);
      return event?.fail ? { ok: false, error: 'fake-input-fail' } : { ok: true };
    },
    stop: () => {},
  };
  return {
    calls,
    frames,
    createScreen: (opts) => {
      // เก็บ callback ไว้ให้เทสต์ยิงเฟรมเข้าจริงผ่านเส้นทางของ control
      calls.onFrame = opts.onFrame;
      return screen;
    },
    createInput: () => input,
    fsRunner: async (command, opts) => {
      calls.fs.push({ command, opts });
      if (command.payload?.boom) throw new Error('fs ระเบิด');
      return { ok: true, path: command.payload?.path };
    },
  };
}

describe('control — เส้นทางคำสั่งไปสู่การกระทำจริง', () => {
  test('screen.start → ตั้ง fps และรายงานผลกลับ', async () => {
    const hub = fakeHub([{ id: 'c1', type: 'screen.start', payload: { fps: 7 } }]);
    const deps = fakeDeps();
    const control = createControlClient({ hub, ...deps });

    await control.runOnce();

    assert.deepEqual(deps.calls.setFps, [7]);
    assert.equal(hub.results.length, 1);
    assert.equal(hub.results[0].id, 'c1');
    assert.equal(hub.results[0].outcome.ok, true);
  });

  test('screen.stop → หยุดสตรีม', async () => {
    const hub = fakeHub([{ id: 'c2', type: 'screen.stop', payload: {} }]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps }).runOnce();
    assert.equal(deps.calls.screenStop, 1);
  });

  test('screen.snapshot → ส่งภาพเดียวออกทาง hub.sendFrame', async () => {
    const frame = { buffer: Buffer.from('one-shot'), width: 10, height: 10 };
    const hub = fakeHub([{ id: 'c3', type: 'screen.snapshot', payload: {} }]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps, capture: async () => frame }).runOnce();

    assert.equal(hub.sent.length, 1);
    assert.equal(hub.sent[0], frame);
    assert.equal(hub.results[0].outcome.ok, true);
  });

  test('จับภาพไม่ได้ → รายงานความล้มเหลว ไม่แอบบอกว่าสำเร็จ', async () => {
    const hub = fakeHub([{ id: 'c4', type: 'screen.snapshot', payload: {} }]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps, capture: async () => null }).runOnce();

    assert.equal(hub.sent.length, 0);
    assert.equal(hub.results[0].outcome.ok, false);
    assert.match(hub.results[0].outcome.error, /จับภาพ/);
  });

  test('คำสั่งอินพุต → ส่งต่อให้ host ด้วย payload เดิม', async () => {
    const hub = fakeHub([
      { id: 'c5', type: 'input.mouse', payload: { kind: 'mouse', action: 'move', x: 5, y: 6 } },
      { id: 'c6', type: 'input.key', payload: { kind: 'key', key: 'Enter' } },
    ]);
    const deps = fakeDeps();
    const control = createControlClient({ hub, ...deps });
    await control.runOnce();
    await control.runOnce();

    assert.equal(deps.calls.input.length, 2);
    assert.equal(deps.calls.input[0].kind, 'mouse');
    assert.equal(deps.calls.input[1].key, 'Enter');
    assert.equal(hub.results[1].outcome.ok, true);
  });

  test('อินพุตที่ host ปฏิเสธ → รายงานเหตุผลนั้น ไม่กลืนเป็นสำเร็จ', async () => {
    const hub = fakeHub([{ id: 'c7', type: 'input.text', payload: { kind: 'text', fail: true } }]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps }).runOnce();

    const outcome = hub.results[0].outcome;
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /fake-input-fail/);
  });

  test('คำสั่ง fs → ส่งต่อพร้อมขอบเขตที่อนุญาต', async () => {
    const hub = fakeHub([{ id: 'c8', type: 'fs.list', payload: { path: 'E:\\' } }]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps, roots: ['E:\\allowed'] }).runOnce();

    assert.equal(deps.calls.fs.length, 1);
    assert.equal(deps.calls.fs[0].command.type, 'fs.list');
    assert.deepEqual(deps.calls.fs[0].opts.roots, ['E:\\allowed']);
  });

  test('fs ที่ throw → รายงานเป็นความล้มเหลว (ไม่ปล่อยให้ HUB รอจน timeout)', async () => {
    const hub = fakeHub([{ id: 'c9', type: 'fs.write', payload: { path: 'E:\\x', boom: true } }]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps }).runOnce();

    assert.equal(hub.results[0].outcome.ok, false);
    assert.match(hub.results[0].outcome.error, /fs ระเบิด/);
  });

  test('คำสั่งที่ไม่อยู่ในรายการ → ปฏิเสธ ไม่ตีความเป็นอย่างอื่น', async () => {
    const hub = fakeHub([{ id: 'c10', type: 'shell.exec', payload: { cmd: 'rm -rf /' } }]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps }).runOnce();

    assert.equal(hub.results[0].outcome.ok, false);
    assert.match(hub.results[0].outcome.error, /ไม่รู้จัก/);
    assert.equal(deps.calls.fs.length, 0, 'คำสั่งที่ไม่ขึ้นต้นด้วย fs. ต้องไม่หลุดเข้า fsRunner');
  });
});

describe('control — สตรีมภาพและการทน HUB ล่ม', () => {
  test('เฟรมที่สตรีมจับได้ → ส่งออกทาง hub.sendFrame พร้อมขนาด', async () => {
    const hub = fakeHub([]);
    const deps = fakeDeps();
    createControlClient({ hub, ...deps });

    // เรียก callback ที่ control ผูกไว้กับสตรีม (จำลองว่าจับภาพได้) แล้วรอให้ส่งจบ
    await deps.calls.onFrame({ buffer: Buffer.from('jpeg-bytes'), width: 800, height: 450 });

    assert.equal(hub.sent.length, 1);
    assert.equal(hub.sent[0].buffer.toString(), 'jpeg-bytes');
    assert.equal(hub.sent[0].width, 800);
  });

  test('ส่งเฟรมล้ม → รายงานผ่าน onError แต่ไม่ทำให้ลูปตาย', async () => {
    const errors = [];
    const hub = fakeHub([]);
    hub.sendFrame = async () => {
      throw new Error('เน็ตหลุด');
    };
    const deps = fakeDeps();
    createControlClient({ hub, ...deps, onError: (m) => errors.push(String(m)) });

    // ต้องไม่ throw ออกมา (promise ที่ reject ลอย ๆ = unhandledRejection ในโปรเซสจริง)
    await deps.calls.onFrame({ buffer: Buffer.from('x') });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /เน็ตหลุด/);
  });

  test('HUB ล่ม → วนลองใหม่ ไม่ throw และไม่ออก error ทุกรอบ (กัน log ท่วม)', async () => {
    const errors = [];
    const hub = fakeHub([]);
    const deps = fakeDeps();
    const control = createControlClient({ hub, ...deps, onError: (m) => errors.push(String(m)) });

    for (let i = 0; i < MAX_SILENT_FAILURES; i += 1) {
      hub.failNext(new Error('HUB ล่ม'));
      await control.runOnce();
    }

    assert.equal(errors.length, 1, 'ต้องเงียบจนครบเพดานก่อน แล้วบอกครั้งเดียว');
    assert.match(errors[0], new RegExp(String(MAX_SILENT_FAILURES)));
    assert.equal(hub.results.length, 0, 'ไม่มีคำสั่งก็ไม่ต้องรายงานผล');
  });

  test('ล้มแล้วกลับมาติดได้ → ตัวนับล้มถูกรีเซ็ต (ไม่เตือนซ้ำโดยไม่จำเป็น)', async () => {
    const errors = [];
    const hub = fakeHub([{ id: 'ok1', type: 'screen.stop', payload: {} }]);
    const deps = fakeDeps();
    const control = createControlClient({ hub, ...deps, onError: (m) => errors.push(String(m)) });

    hub.failNext(new Error('ล่ม 1'));
    await control.runOnce();
    await control.runOnce(); // รอบนี้สำเร็จ (มีคำสั่ง screen.stop) ⇒ รีเซ็ต
    hub.failNext(new Error('ล่ม 2'));
    await control.runOnce();

    assert.equal(errors.length, 0, 'ยังไม่ครบ 3 รอบติดกัน ⇒ ไม่ต้องเตือน');
    assert.equal(hub.results.length, 1);
  });

  test('ไม่มีคำสั่งตามเวลา (คืน null) → ไม่รายงานผลอะไรเลย', async () => {
    const hub = fakeHub([]);
    const deps = fakeDeps();
    await createControlClient({ hub, ...deps }).runOnce();
    assert.equal(hub.results.length, 0);
  });
});

describe('control — start/stop', () => {
  test('ยังไม่เรียก start → ยังไม่ทำงาน', () => {
    const hub = fakeHub([]);
    const control = createControlClient({ hub, ...fakeDeps() });
    assert.equal(control.isRunning(), false);
  });

  test('stop() ปิดสตรีมเสมอ แม้ยังไม่เริ่ม', () => {
    const hub = fakeHub([]);
    const deps = fakeDeps();
    const control = createControlClient({ hub, ...deps });
    control.stop();
    assert.equal(deps.calls.screenStop, 1, 'ต้องสั่งหยุดสตรีมเพื่อไม่กิน CPU ค้าง');
    assert.equal(control.isRunning(), false);
  });

  test('start() เรียกซ้ำไม่ทำให้มีสองลูป', async () => {
    const hub = fakeHub([]);
    const control = createControlClient({ hub, ...fakeDeps(), config: { intervalMs: 5 } });
    await control.start();
    const first = control.isRunning();
    await control.start();
    assert.equal(first, true);
    assert.equal(control.isRunning(), true);
    control.stop();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(control.isRunning(), false);
  });
});
