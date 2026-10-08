import './setup-env';
import { describe, test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  awaitCommand,
  controlState,
  dispatchCommand,
  getLatestFrame,
  getViewers,
  isAuditableCommandType,
  machineRoom,
  resetMachineControl,
  setRequestedFps,
  setViewers,
  submitFrame,
  submitResult,
} from '../src/services/machine-control.service';

// ── ช่องควบคุมเครื่องระยะไกล — state machine ของ HUB ─────────────────────────
//
// เทสต์ชุดนี้คุม "สัญญา" ระหว่าง browser กับ runner โดยไม่พึ่ง DB/HTTP/socket:
//   · คำสั่งต้องถึง runner ทันทีถ้ามี long-poll ค้างอยู่ และไม่หายถ้าไม่มี
//   · คำสั่งที่ไม่มีใครมารับต้องหมดอายุเอง ไม่ค้างสะสมจนหน่วยความจำบวม
//   · runner ที่รีสตาร์ทต้องไม่ทิ้ง poll เก่าค้างจน proxy ตัด (ค้างไม่ตอบ)
//   · เฟรมใหญ่เกินเพดานต้องถูกปฏิเสธ — HUB ห้ามหมดหน่วยความจำเพราะ client
//
// ทำไมต้องมี: พฤติกรรมพวกนี้ "พังเงียบ" ได้ง่ายมาก (ค้างไม่ตอบ = ไม่มี error ให้เห็น)
// และเป็นทางที่คำสั่งของผู้ใช้ไปลงบนเครื่องอื่นจริง

const MACHINE = 'machine-test-1';

beforeEach(() => {
  resetMachineControl();
});

after(() => {
  resetMachineControl();
});

describe('machine-control: การส่งคำสั่ง', () => {
  test('คำสั่งที่ส่งขณะมี long-poll ค้างอยู่ ถึงมือทันที', async () => {
    const waiting = awaitCommand(MACHINE, 5000);
    const dispatched = dispatchCommand(MACHINE, 'screen.snapshot', { reason: 'user' });

    const received = await waiting;
    assert.ok(received, 'ต้องได้คำสั่ง ไม่ใช่ null');
    assert.equal(received!.id, dispatched.id);
    assert.equal(received!.type, 'screen.snapshot');
    assert.deepEqual(received!.payload, { reason: 'user' });
  });

  test('คำสั่งที่ส่งตอนยังไม่มีใครรอ เข้าคิวและได้ตอน poll รอบถัดไป', async () => {
    const dispatched = dispatchCommand(MACHINE, 'fs.list', { path: 'E:\\' });

    const received = await awaitCommand(MACHINE, 1000);
    assert.ok(received);
    assert.equal(received!.id, dispatched.id);
    assert.equal(received!.type, 'fs.list');
    assert.equal(received!.payload.path, 'E:\\');
  });

  test('ไม่มีคำสั่ง = คืน null ตามเวลา (ไม่ใช่ error)', async () => {
    const started = Date.now();
    const received = await awaitCommand(MACHINE, 60);
    assert.equal(received, null);
    // ต้องค้างจริงตามเวลาที่ขอ ไม่ใช่ตอบทันที (ตอบทันที = runner วนถี่เป็นลูปเผา CPU)
    assert.ok(Date.now() - started >= 40, 'ต้องค้างรอตาม waitMs จริง');
  });

  test('คำสั่งที่ไม่มีใครมารับภายในเวลาที่กำหนด ถูกทิ้ง (ไม่ค้างในคิว)', async () => {
    dispatchCommand(MACHINE, 'screen.stop', {}, 20);
    await new Promise((r) => setTimeout(r, 60));

    const late = await awaitCommand(MACHINE, 60);
    assert.equal(late, null, 'คำสั่งที่หมดอายุต้องไม่ถูกส่งมอบย้อนหลัง');
    const state = controlState().find((c) => c.machineId === MACHINE);
    assert.equal(state?.queued ?? 0, 0);
  });

  test('runner เปิดซ้ำ (poll ใหม่) ปลด poll เก่าด้วย null ไม่ปล่อยค้าง', async () => {
    const stale = awaitCommand(MACHINE, 5000);
    // poll ตัวใหม่แซงขึ้นมา (เช่น runner รีสตาร์ทแล้วต่อใหม่ก่อน poll เก่าหมดเวลา)
    const fresh = awaitCommand(MACHINE, 5000);

    assert.equal(await stale, null, 'poll เก่าต้องได้ null ไม่ค้างจน proxy ตัด');
    const dispatched = dispatchCommand(MACHINE, 'screen.start', { fps: 5 });
    const received = await fresh;
    assert.equal(received?.id, dispatched.id);
  });
});

describe('machine-control: ผลลัพธ์และร่องรอยคำสั่ง', () => {
  test('submitResult คืน machineId เพื่อให้รู้ว่า emit ไปห้องไหน', () => {
    const cmd = dispatchCommand(MACHINE, 'fs.read', { path: 'E:\\a.txt' });
    const routed = submitResult(cmd.id, true, { content: 'hi' });
    assert.ok(routed);
    assert.equal(routed!.machineId, MACHINE);
    assert.equal(routed!.ok, true);
    assert.deepEqual(routed!.result, { content: 'hi' });
    assert.equal(routed!.error, null);
  });

  test('submitResult ของคำสั่งที่ไม่รู้จัก/หมดอายุ คืน null (ไม่ throw)', () => {
    assert.equal(submitResult('does-not-exist', true), null);
  });

  test('คำสั่งที่รายงานผลแล้ว รายงานซ้ำไม่ได้อีก', () => {
    const cmd = dispatchCommand(MACHINE, 'fs.mkdir', { path: 'E:\\new' });
    assert.ok(submitResult(cmd.id, true));
    assert.equal(submitResult(cmd.id, true), null, 'ต้องกันการรายงานผลซ้ำ');
  });

  test('คำสั่งที่รายงานผลแล้ว ไม่โผล่ในคิวอีก', async () => {
    const cmd = dispatchCommand(MACHINE, 'fs.delete', { path: 'E:\\tmp' }, 60_000);
    submitResult(cmd.id, true);
    const late = await awaitCommand(MACHINE, 60);
    assert.equal(late, null);
  });
});

describe('machine-control: เฟรมภาพหน้าจอ', () => {
  test('เก็บเฟรมล่าสุด + เลขลำดับเพิ่มขึ้นทุกเฟรม', () => {
    const first = submitFrame(MACHINE, Buffer.from('aaa'), { mime: 'image/jpeg', width: 100, height: 50 });
    const second = submitFrame(MACHINE, Buffer.from('bb'), { mime: 'image/jpeg' });

    assert.ok(first && second);
    assert.equal(first!.seq, 1);
    assert.equal(second!.seq, 2);
    assert.equal(getLatestFrame(MACHINE)!.buffer.toString(), 'bb', 'ต้องเหลือเฟรมล่าสุดเท่านั้น');
    assert.equal(getLatestFrame(MACHINE)!.width, null, 'เฟรมหลังไม่ส่งขนาด ⇒ ต้องเป็น null ไม่ใช่ค่าของเฟรมก่อน');
  });

  test('ปฏิเสธเฟรมว่างและเฟรมที่ใหญ่เกินเพดาน (HUB ต้องไม่หมดหน่วยความจำ)', () => {
    assert.equal(submitFrame(MACHINE, Buffer.alloc(0)), null, 'เฟรมว่างต้องถูกปฏิเสธ');
    assert.equal(submitFrame(MACHINE, Buffer.alloc(MAX_FRAME_BYTES + 1)), null, 'เกินเพดานต้องถูกปฏิเสธ');
    assert.equal(getLatestFrame(MACHINE), null);
  });

  test('ยังไม่มีเฟรม = null (ไม่ใช่ object เปล่า)', () => {
    assert.equal(getLatestFrame('machine-never-seen'), null);
  });
});

describe('machine-control: จำนวนผู้ชมและ fps', () => {
  test('ผู้ชม = 0 แล้ว requestedFps ต้องถูกล้าง (ไม่มีใครดู = ไม่ต้องสตรีม)', () => {
    setViewers(MACHINE, 2);
    setRequestedFps(MACHINE, 5);
    assert.equal(getViewers(MACHINE), 2);

    setViewers(MACHINE, 0);
    const state = controlState().find((c) => c.machineId === MACHINE);
    assert.equal(state?.requestedFps, null);
  });

  test('จำนวนผู้ชมติดลบถูกตัดเป็น 0', () => {
    setViewers(MACHINE, -3);
    assert.equal(getViewers(MACHINE), 0);
  });
});

describe('machine-control: ชนิดคำสั่งที่ต้องมีร่องรอยใน audit', () => {
  test('คำสั่งที่เปลี่ยนสถานะ/เปิดการควบคุม = ต้องบันทึก', () => {
    for (const type of ['screen.start', 'screen.stop', 'fs.write', 'fs.delete', 'fs.mkdir', 'fs.rename', 'input.text']) {
      assert.equal(isAuditableCommandType(type), true, `${type} ต้องถูกบันทึก`);
    }
  });

  test('คำสั่งที่วิ่งถี่มาก = ห้ามบันทึก (ไม่งั้น audit กลายเป็นขยะ)', () => {
    for (const type of ['input.mouse', 'input.key', 'fs.list', 'fs.read', 'screen.fps', 'screen.snapshot']) {
      assert.equal(isAuditableCommandType(type), false, `${type} ต้องไม่ถูกบันทึก`);
    }
  });
});

describe('machine-control: สถานะและการล้างค่า', () => {
  test('controlState: คำสั่งที่ยังไม่มีใครมารับ = นับอยู่ในคิว', () => {
    dispatchCommand(MACHINE, 'fs.list', { path: 'E:\\' });
    setViewers(MACHINE, 1);
    submitFrame(MACHINE, Buffer.from('x'));

    const state = controlState().find((c) => c.machineId === MACHINE);
    assert.ok(state);
    assert.equal(state!.viewers, 1);
    assert.equal(state!.framesReceived, 1);
    assert.equal(state!.queued, 1);
    assert.equal(state!.polling, false, 'ยังไม่มีใคร poll ⇒ คำสั่งต้องค้างในคิว');
  });

  test('controlState: มี poll ค้างอยู่ = polling true · พอ dispatch แล้วส่งมอบทันที (คิวว่าง)', async () => {
    const waiting = awaitCommand(MACHINE, 5000);

    const whilePolling = controlState().find((c) => c.machineId === MACHINE);
    assert.ok(whilePolling);
    assert.equal(whilePolling!.polling, true);
    assert.ok(whilePolling!.lastPollAt !== null);

    const dispatched = dispatchCommand(MACHINE, 'screen.start', { fps: 5 });
    // โดยดีไซน์: dispatch ที่เจอ waiter จะตอบทันที ไม่ผ่านคิว (⇒ queued=0, polling=false)
    const afterDispatch = controlState().find((c) => c.machineId === MACHINE);
    assert.equal(afterDispatch!.queued, 0);
    assert.equal(afterDispatch!.polling, false);

    assert.equal((await waiting)?.id, dispatched.id);
  });

  test('room ของเครื่องใช้ชื่อเดียวกันเสมอ (browser กับ route ต้องตรงกัน)', () => {
    assert.equal(machineRoom('abc'), 'mc:abc');
    assert.equal(machineRoom(MACHINE), machineRoom(MACHINE));
  });

  test('resetMachineControl ปลด poll ที่ค้างด้วย null และล้างเครื่องอื่นด้วย', async () => {
    // poll ค้างอยู่บนเครื่องนี้ (ยังไม่มีคำสั่ง — ถ้ามี คำสั่งจะตอบ waiter ทันทีและ promise จบไปแล้ว)
    const waiting = awaitCommand(MACHINE, 5000);
    // คำสั่งที่ค้างอยู่บน "อีกเครื่อง" — ต้องถูกล้างไปด้วยตรี reset
    dispatchCommand('machine-other', 'fs.list', {});
    setViewers(MACHINE, 3);
    submitFrame(MACHINE, Buffer.from('x'));

    resetMachineControl();

    assert.equal(await waiting, null, 'poll ที่ค้างต้องถูกปลดด้วย null');
    assert.equal(controlState().length, 0, 'ทุกเครื่องต้องถูกล้าง รวมคำสั่งที่ค้างในคิว');
    assert.equal(getLatestFrame(MACHINE), null);
    assert.equal(getViewers(MACHINE), 0);
  });

  test('ค่าคงที่ของช่องตรงกับที่เอกสาร/runner อ้าง', () => {
    assert.equal(typeof DEFAULT_COMMAND_TIMEOUT_MS, 'number');
    assert.ok(DEFAULT_COMMAND_TIMEOUT_MS > 0);
    assert.ok(MAX_FRAME_BYTES >= 1024 * 1024, 'เพดานเฟรมต้องรับภาพจริงได้ ไม่ใช่เล็กจนใช้ไม่ได้');
  });
});
