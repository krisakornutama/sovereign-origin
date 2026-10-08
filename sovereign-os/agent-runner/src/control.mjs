// src/control.mjs — ช่องควบคุมเครื่องระยะไกล (ฝั่งเครื่องที่ถูกควบคุม)
//
// วน long-poll ไปที่ HUB แล้วทำตามคำสั่งที่ได้:
//   screen.start/fps/stop/snapshot → เปิด/ปรับ/ปิดสตรีมภาพหน้าจอ
//   input.mouse/key/text           → ฉีดเมาส์/คีย์บอร์ด
//   fs.*                           → อ่าน/เขียน/ลบไฟล์
//
// ทำไม long-poll ไม่ใช่ websocket:
//   agent-runner ต้อง "ไม่มี dependency ภายนอก" และออกขาออกเท่านั้น ⇒ ใช้ fetch
//   ที่มีใน Node ยิง HTTP ค้างไว้ (HUB หน่วงคำตอบจนกว่าจะมีคำสั่ง) ⇒ latency บน LAN
//   ใกล้เคียง websocket โดยไม่ต้องเพิ่มอะไรเลย
//
// หลักการที่ยึด:
// - หนึ่งรอบ = หนึ่งคำสั่ง แล้วรายงานผลกลับเสมอ (สำเร็จหรือล้ม) — ห้ามเงียบ
// - HUB ล่ม/เน็ตขาด ต้องวนลองใหม่ ไม่ crash และไม่ทำให้ช่อง AI job ที่มีอยู่พัง
// - สตรีมภาพต้องหยุดทันทีที่ไม่มีใครดู (ไม่กิน CPU/แบนด์วิดท์ค้าง)
import { startScreenStream } from './screen.mjs';
import { createInputHost } from './input.mjs';
import { resolveAllowedRoots, runFsCommand, writeFile, readFile } from './fsops.mjs';

/** HUB หน่วงคำตอบได้นานสุดเท่านี้ (ต้อง ≤ เพดานของ HUB) */
export const POLL_WAIT_MS = 25_000;

/** จำนวนรอบที่ยอมให้ล้มติดกันก่อนขึ้นข้อความเตือน (แล้ววนต่อ ไม่หยุด) */
export const MAX_SILENT_FAILURES = 3;

/** ภาพเดียวสำหรับคำสั่ง snapshot — ใช้ PowerShell ครั้งเดียว (ไม่เริ่มสตรีมค้าง) */
export async function captureOnce({ maxWidth = 1280 } = {}) {
  // ใช้สตรีมแล้วหยุดทันที: ได้ภาพเดียวโดยไม่ต้องมีโค้ดจับภาพชุดที่สองให้ต้องดูแล
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      stream.stop();
      resolve(value);
    };
    const stream = startScreenStream({
      fps: 1,
      maxWidth,
      onFrame: (frame) => finish(frame),
      onError: () => {}, // ภาพเดียวไม่ได้ = ไม่มีภาพ ไม่ต้องรายงานซ้ำซ้อน
    });
    // เพดานเวลา: ถ้าจอถูกบล็อก (UAC/ล็อก) ต้องไม่ค้างรอตลอดกาล
    setTimeout(() => finish(null), 8000);
  });
}

/**
 * สร้างช่องควบคุม — ต้องเรียก start() จึงจะเริ่มวน
 * ทุกอย่างที่พึ่งของนอก (hub/screen/input/fs) ส่งเข้ามาได้ ⇒ เทสต์ได้โดยไม่ต้องมี HUB จริง
 */
export function createControlClient({
  config = {},
  hub,
  createScreen = startScreenStream,
  createInput = createInputHost,
  fsRunner = runFsCommand,
  // ฉีดเข้ามาได้เพื่อให้เทสต์คุมเส้นทาง snapshot ได้โดยไม่ต้องจับจอจริง
  capture = captureOnce,
  roots,
  onLog = console.log,
  onError = console.error,
} = {}) {
  const allowedRoots = roots ?? resolveAllowedRoots(process.env);
  let running = false;
  let timer = null;
  let failureStreak = 0;
  let stopRequested = false;

  const screen = createScreen({
    fps: 5,
    onFrame: async (frame) => {
      // ส่งเฟรมแบบ "ไม่รอ" — ถ้าตั้งใจส่งพลาด รอบถัดไปยังมีโอกาส ไม่ต้องรอค้าง
      // แต่ต้องไม่ทิ้ง promise ที่ reject ลอย ๆ (จะกลายเป็น unhandledRejection)
      try {
        await hub.sendFrame(frame);
      } catch (err) {
        onError(`[control] ส่งเฟรมไม่สำเร็จ: ${err?.message || err}`);
      }
    },
    onError: (err) => onError(`[control] สตรีมภาพ: ${err?.message || err}`),
  });

  const input = createInput({
    onError: (err) => onError(`[control] input host: ${err?.message || err}`),
  });

  /** ทำตามคำสั่งหนึ่งคำสั่ง → คืนผลที่จะรายงานกลับ HUB */
  const handle = async (command) => {
    const payload = command?.payload ?? {};
    switch (command?.type) {
      case 'screen.start':
        screen.setFps(payload.fps ?? 5);
        return { ok: true, note: `stream เริ่มที่ ${payload.fps ?? 5} fps` };

      case 'screen.fps':
        screen.setFps(payload.fps ?? 5);
        return { ok: true, note: `stream ปรับเป็น ${payload.fps ?? 5} fps` };

      case 'screen.stop':
        screen.stop();
        return { ok: true, note: 'stream หยุด' };

      case 'screen.snapshot': {
        const frame = await capture();
        if (!frame) return { ok: false, error: 'จับภาพหน้าจอไม่ได้' };
        await hub.sendFrame(frame);
        return { ok: true, note: `ส่งภาพเดียว ${frame.buffer.length} bytes` };
      }

      case 'input.mouse':
      case 'input.key':
      case 'input.text': {
        const result = await input.applyEvent(payload);
        if (!result?.ok) return { ok: false, error: result?.error || 'ฉีดอินพุตไม่สำเร็จ' };
        return { ok: true };
      }

      default: {
        if (String(command?.type ?? '').startsWith('fs.')) {
          return await fsRunner(command, { roots: allowedRoots });
        }
        return { ok: false, error: `ไม่รู้จักคำสั่ง: ${command?.type ?? '(ว่าง)'}` };
      }
    }
  };

  const tick = async () => {
    let command;
    try {
      command = await hub.nextCommand(POLL_WAIT_MS);
      failureStreak = 0;
    } catch (err) {
      failureStreak += 1;
      if (failureStreak === MAX_SILENT_FAILURES) {
        onError(`[control] ติดต่อ HUB ไม่ได้ติดกัน ${failureStreak} รอบ: ${err?.message || err}`);
      }
      return;
    }

    if (!command) return; // ครบเวลา ไม่มีคำสั่ง — ปกติ ไม่ใช่ error

    let outcome;
    try {
      outcome = await handle(command);
    } catch (err) {
      // คำสั่งที่ทำแล้ว throw ต้องรายงานกลับเป็นความล้มเหลว ไม่ปล่อยให้ HUB รอจน timeout
      outcome = { ok: false, error: err?.message || String(err) };
    }

    try {
      await hub.reportResult(command.id, outcome);
    } catch (err) {
      onError(`[control] รายงานผลไม่สำเร็จ: ${err?.message || err}`);
    }
  };

  const loop = async () => {
    if (!running) return;
    if (stopRequested) return;
    await tick();
    if (!running) return;
    timer = setTimeout(loop, config.intervalMs ?? 0);
    if (typeof timer.unref === 'function') timer.unref();
  };

  return {
    isRunning: () => running,
    isStreaming: () => screen.isRunning(),
    /** เปิดให้ช่องนี้ทำงาน — ต้องเรียกหลังสร้างเสร็จเสมอ */
    async start() {
      if (running) return;
      running = true;
      stopRequested = false;
      await loop();
    },
    /** หยุดและปิดสตรีมทั้งหมด — ใช้ตอนปิดโปรเซส */
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      screen.stop();
      input.stop();
    },
    /** ให้เทสต์เรียกทีละรอบได้โดยไม่ต้องมี timer */
    async runOnce() {
      await tick();
    },
    screen,
    input,
  };
}
