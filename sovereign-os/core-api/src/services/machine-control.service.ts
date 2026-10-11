// src/services/machine-control.service.ts
//
// ช่องควบคุมเครื่องระยะไกล (remote control channel) — HUB เป็นตัวกลาง relay
// ระหว่าง 2 ฝั่งที่ใช้โปรโตคอลต่างกันโดยตั้งใจ:
//
//   browser ──socket.io (JWT + MFA ที่มีอยู่แล้ว)──▶ HUB
//   runner  ──HTTP long-poll ด้วย fetch──▶ HUB
//
// ทำไมฝั่ง runner ไม่ใช้ socket.io:
//   agent-runner ตั้งใจให้ "ไม่มี dependency ภายนอกเลย" (ต้อง copy เป็นโฟลเดอร์
//   ไปวางเครื่องที่ 2) และต้องเป็น outbound-only ⇒ ไม่ต้องเปิดพอร์ตรับ/แก้ firewall
//   Node มี fetch + LONG-POLL ของ Express 4 ก็พอ ⇒ ไม่ต้องเพิ่มอะไรเลย
//
// ทำไมเก็บในหน่วยความจำ ไม่ลง DB:
//   session ควบคุมเป็นของชั่วคราว (ตายเมื่อปิดหน้า/ปิดเครื่อง) และการไม่แตะตารางเลย
//   ทำให้ arch-gate ไม่เห็น "เส้นข้ามโมดูล" ใหม่ (ดู tools/arch-gate.mjs เฟส 1)
//   ส่วนการกระทำที่ควรมีร่องรอย (เปิด session / เขียน-ลบไฟล์) บันทึกผ่าน
//   AuditService ที่ชั้น route/socket ซึ่งมี userId ของคนจริง ไม่ใช่ที่ service นี้
import { randomUUID } from 'node:crypto';

/** ระยะที่ long-poll ค้างไว้ต่อ 1 request — สั้นพอให้ proxy ไม่ตัด, ยาวพอลดจำนวนรอบ */
export const DEFAULT_POLL_WAIT_MS = 25_000;

/** ถ้า runner ไม่มารับคำสั่งภายในเวลานี้ = ถือว่าหลงทาง ทิ้งแล้วบอกผู้ใช้ */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/** เพดานขนาดเฟรม — กันคนยิง JSON ก้อนโตจน HUB หมดหน่วยความจำ */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** ชื่อห้อง socket.io ของเครื่องหนึ่ง ๆ — ที่เดียวที่รู้จักรูปแบบนี้ */
export function machineRoom(machineId: string): string {
  return `mc:${machineId}`;
}

/**
 * คำสั่งชนิดไหนที่ควรมีร่องรอยใน audit log
 *
 * หลักคิด: บันทึก "การกระทำที่ย้อนกลับไม่ได้ หรือเริ่ม/จบการควบคุม"
 *   ไม่บันทึก: ทุกเฟรมภาพ, ทุกครั้งที่เมาส์ขยับ (ถี่เป็นสิบครั้ง/วินาที
 *   ⇒ audit จะกลายเป็นขยะหลายแสนแถวต่อวันและไม่มีใครตรวจได้จริง)
 */
export function isAuditableCommandType(type: string): boolean {
  return AUDITABLE_COMMAND_TYPES.has(type);
}

const AUDITABLE_COMMAND_TYPES = new Set([
  // เปิด/ปิดการควบคุมเครื่อง = ช่วงเวลาที่เครื่องถูกสั่งการได้ทั้งเครื่อง
  'screen.start',
  'screen.stop',
  // เปลี่ยนไฟล์บนเครื่องปลายทาง — ย้อนกลับไม่ได้ถ้าทับ/ลบ
  'fs.write',
  'fs.delete',
  'fs.mkdir',
  'fs.rename',
  'fs.upload',
  // พิมพ์ข้อความจำนวนมากเข้าคีย์บอร์ด = เทียบเท่าสั่งงานด้วยมือ
  'input.text',
]);

export interface ControlCommand {
  id: string;
  machineId: string;
  /** เช่น screen.start · input.mouse · fs.write — runner เป็นคนตีความ */
  type: string;
  payload: Record<string, unknown>;
  issuedAt: number;
  timeoutMs: number;
}

/** เฟรมล่าสุดที่ runner ส่งเข้ามา (เก็บไว้ให้คนที่เพิ่งเปิดหน้าดูเห็นภาพทันที) */
export interface LatestFrame {
  buffer: Buffer;
  mime: string;
  at: number;
  seq: number;
  width: number | null;
  height: number | null;
}

interface Waiter {
  resolve: (command: ControlCommand | null) => void;
  timer: NodeJS.Timeout;
}

interface Channel {
  queue: ControlCommand[];
  waiter: Waiter | null;
  latestFrame: LatestFrame | null;
  frameSeq: number;
  lastPollAt: number | null;
  lastFrameAt: number | null;
  viewers: number;
  /** fps ที่ผู้ชมขอไว้ล่าสุด — null = ไม่มีใครดูอยู่ */
  requestedFps: number | null;
  framesReceived: number;
}

const channels = new Map<string, Channel>();

/** ผู้รับผลลัพธ์ที่กำลังรออยู่ (commandId → ข้อมูลที่ต้องใช้ตอบกลับ) */
const inflight = new Map<string, { machineId: string; issuedAt: number; timer: NodeJS.Timeout }>();

function channelOf(machineId: string): Channel {
  let ch = channels.get(machineId);
  if (!ch) {
    ch = {
      queue: [],
      waiter: null,
      latestFrame: null,
      frameSeq: 0,
      lastPollAt: null,
      lastFrameAt: null,
      viewers: 0,
      requestedFps: null,
      framesReceived: 0,
    };
    channels.set(machineId, ch);
  }
  return ch;
}

/**
 * ส่งคำสั่งไปให้เครื่องหนึ่ง
 * - ถ้ามี long-poll ค้างอยู่ → ตอบกลับทันที (latency ≈ 0 บน LAN)
 * - ถ้าไม่มี → เข้า queue รอรอบถัดไป
 * คำสั่งที่ไม่มีใครมารับภายใน timeoutMs จะถูกทิ้ง (ไม่ค้างสะสมจนหน่วยความจำบวม)
 */
export function dispatchCommand(
  machineId: string,
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
): ControlCommand {
  const ch = channelOf(machineId);
  const command: ControlCommand = {
    id: randomUUID(),
    machineId,
    type,
    payload,
    issuedAt: Date.now(),
    timeoutMs,
  };

  if (ch.waiter) {
    const waiter = ch.waiter;
    ch.waiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(command);
  } else {
    ch.queue.push(command);
  }

  // หนึ่งคำสั่ง = หนึ่ง timer ที่ผูกกับ inflight เสมอ ⇒ ล้างครบทั้งตอน submitResult,
  // ตอนหมดเวลาเอง, และตอน reset (ไม่มี timer ตัวที่สองที่ต้องตามเก็บให้สับสน)
  const timer = setTimeout(() => {
    inflight.delete(command.id);
    const idx = ch.queue.findIndex((c) => c.id === command.id);
    if (idx >= 0) ch.queue.splice(idx, 1);
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  inflight.set(command.id, { machineId, issuedAt: command.issuedAt, timer });

  return command;
}

/**
 * runner เรียกค้างไว้ (long-poll) เพื่อรอคำสั่ง
 * คืน null เมื่อครบเวลา — runner ต้องวนเรียกใหม่ (ไม่ใช่ error)
 * ถ้ามี poll เก่าค้างอยู่ (เช่น runner เปิดซ้ำ) → ปลดอันเก่าด้วย null ก่อน
 */
export function awaitCommand(
  machineId: string,
  waitMs: number = DEFAULT_POLL_WAIT_MS,
): Promise<ControlCommand | null> {
  const ch = channelOf(machineId);
  ch.lastPollAt = Date.now();

  // runner ตัวใหม่แซงตัวเก่า — อันเก่าต้องได้ null กลับ ไม่ใช่ค้างจน proxy ตัด
  if (ch.waiter) {
    const stale = ch.waiter;
    ch.waiter = null;
    clearTimeout(stale.timer);
    stale.resolve(null);
  }

  const queued = ch.queue.shift();
  if (queued) return Promise.resolve(queued);

  return new Promise<ControlCommand | null>((resolve) => {
    const timer = setTimeout(() => {
      if (ch.waiter && ch.waiter.resolve === resolve) ch.waiter = null;
      resolve(null);
    }, waitMs);
    if (typeof timer.unref === 'function') timer.unref();
    ch.waiter = { resolve, timer };
  });
}

/**
 * runner รายงานผลของคำสั่งกลับ — คืน machineId เพื่อให้ชั้นบนรู้ว่าต้อง emit ไปห้องไหน
 * (คืน null = คำสั่งนี้ไม่รู้จัก/หมดเวลาไปแล้ว — ไม่ใช่ error ของ runner)
 */
export function submitResult(commandId: string, ok: boolean, result?: unknown, error?: string) {
  const entry = inflight.get(commandId);
  if (!entry) return null;
  inflight.delete(commandId);
  clearTimeout(entry.timer);

  // คำสั่งที่รายงานผลแล้วต้องไม่ถูกส่งมอบย้อนหลัง — ถอดออกจากคิวด้วย ไม่พึ่ง timeout
  // (timeout ก็ถอดออกอยู่แล้ว แต่รอถึง 30 วิ — ช่วงนั้น runner ที่มา poll จะได้คำสั่ง
  //  ที่ปิดไปแล้วไปรันซ้ำ = สั่งลบไฟล์ครั้งเดียวได้สองครั้ง)
  const ch = channels.get(entry.machineId);
  if (ch) {
    const idx = ch.queue.findIndex((c) => c.id === commandId);
    if (idx >= 0) ch.queue.splice(idx, 1);
  }

  return { machineId: entry.machineId, ok, result: result ?? null, error: error ?? null };
}

/**
 * เก็บเฟรมล่าสุดของเครื่อง
 * ปฏิเสธ (คืน false) เมื่อ payload ใหญ่เกินเพดาน — กัน HUB หมดหน่วยความจำ
 */
export function submitFrame(
  machineId: string,
  buffer: Buffer,
  meta: { mime?: string; width?: number | null; height?: number | null } = {},
): LatestFrame | null {
  if (!buffer || buffer.length === 0 || buffer.length > MAX_FRAME_BYTES) return null;
  const ch = channelOf(machineId);
  ch.frameSeq += 1;
  const frame: LatestFrame = {
    buffer,
    mime: meta.mime || 'image/jpeg',
    at: Date.now(),
    seq: ch.frameSeq,
    width: meta.width ?? null,
    height: meta.height ?? null,
  };
  ch.latestFrame = frame;
  ch.lastFrameAt = frame.at;
  ch.framesReceived += 1;
  return frame;
}

export function getLatestFrame(machineId: string): LatestFrame | null {
  return channels.get(machineId)?.latestFrame ?? null;
}

/** นับจำนวนผู้ชมเครื่องนี้ — 0 = ไม่มีใครดูอยู่ runner ควรหยุดสตรีม */
export function setViewers(machineId: string, viewers: number): void {
  const ch = channelOf(machineId);
  ch.viewers = Math.max(0, Math.floor(viewers));
  if (ch.viewers === 0) ch.requestedFps = null;
}

export function getViewers(machineId: string): number {
  return channels.get(machineId)?.viewers ?? 0;
}

export function setRequestedFps(machineId: string, fps: number | null): void {
  channelOf(machineId).requestedFps = fps;
}

/** สถานะของทุกเครื่อง — ใช้ทั้งหน้าเว็บ (แถบสถานะ) และเทสต์ */
export function controlState() {
  return [...channels.entries()].map(([machineId, ch]) => ({
    machineId,
    queued: ch.queue.length,
    polling: Boolean(ch.waiter),
    viewers: ch.viewers,
    requestedFps: ch.requestedFps,
    framesReceived: ch.framesReceived,
    lastPollAt: ch.lastPollAt,
    lastFrameAt: ch.lastFrameAt,
    frameBytes: ch.latestFrame?.buffer.length ?? 0,
  }));
}

/** ล้างทุกอย่าง — เทสต์เรียกใน after() เพื่อไม่ให้ state รั่วข้ามเคส */
export function resetMachineControl(): void {
  for (const ch of channels.values()) {
    if (ch.waiter) {
      clearTimeout(ch.waiter.timer);
      ch.waiter.resolve(null);
      ch.waiter = null;
    }
    ch.queue = [];
    ch.latestFrame = null;
  }
  channels.clear();
  for (const entry of inflight.values()) clearTimeout(entry.timer);
  inflight.clear();
}
