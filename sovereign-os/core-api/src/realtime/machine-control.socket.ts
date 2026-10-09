// src/realtime/machine-control.socket.ts
//
// ฝั่ง browser ของ "ช่องควบคุมเครื่องระยะไกล"
//
// ผู้ใช้เปิดหน้า console → socket.join ห้องของเครื่อง → HUB relay ภาพ/ผลลัพธ์เข้ามา
// และรับคำสั่ง (เมาส์/คีย์บอร์ด/ไฟล์) จากหน้าเว็บส่งต่อไปให้ runner ผ่าน long-poll
//
// แยกจาก realtime/socket.ts (ที่ทำ auth + broadcast ระบบ) เพราะไฟล์นั้นเป็นด่าน
// ความปลอดภัยของทั้งระบบ — งานควบคุมเครื่องควรอยู่ไฟล์ของตัวเอง อ่าน/ตรวจง่ายกว่า
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { AuditService } from '../services/audit.service';
import {
  dispatchCommand,
  getViewers,
  isAuditableCommandType,
  machineRoom,
  setRequestedFps,
  setViewers,
} from '../services/machine-control.service';

/** fps เริ่มต้นตอนเปิดดูจอ — สูงพอให้ควบคุมได้ แต่ไม่กินแบนด์วิดท์ LAN เกินจำเป็น */
export const DEFAULT_SCREEN_FPS = 5;

/** เพดาน fps ที่ยอมให้ผู้ใช้ขอ — เกินกว่านี้ภาพจะกองที่ HUB โดยไม่ได้ช่วยอะไร */
export const MAX_SCREEN_FPS = 15;

interface ControlUser {
  id: string;
  role: string;
}

/** ผู้ใช้ที่ผูกกับ socket นี้ (socket.ts เก็บ decoded JWT ไว้ตอน handshake) */
function controlUser(socket: Socket): ControlUser | null {
  const user = (socket.data as { user?: ControlUser } | undefined)?.user;
  if (!user || typeof user.id !== 'string') return null;
  return user;
}

/**
 * จำนวนผู้ชมห้องนี้จริง ณ ตอนนี้ (นับจาก adapter ของ socket.io = ความจริงเดียว)
 * ใช้ตัดสินว่าต้องสั่ง runner "เริ่ม/หยุดสตรีม" หรือยัง
 */
function roomViewers(io: SocketIOServer, room: string): number {
  return io.sockets.adapter.rooms.get(room)?.size ?? 0;
}

/** ตัดตัวเลข fps ให้อยู่ในกรอบที่ยอมรับ (ค่าที่ส่งมาจาก client ห้ามเชื่อตรง ๆ) */
export function normalizeFps(raw: unknown, fallback: number = DEFAULT_SCREEN_FPS): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(1, Math.round(n)), MAX_SCREEN_FPS);
}

/** อ่าน machineId จาก payload ของ client — คืน '' เมื่อไม่ใช่สตริงที่ใช้ได้ */
function readMachineId(msg: unknown): string {
  const id = (msg as { machineId?: unknown } | undefined)?.machineId;
  return typeof id === 'string' ? id.trim() : '';
}

/** ack แบบปลอดภัย — client อาจไม่ส่ง callback มา และห้ามเรียกซ้ำ */
function reply(ack: unknown, payload: Record<string, unknown>): void {
  if (typeof ack === 'function') (ack as (p: unknown) => void)(payload);
}

/**
 * ผูก handler ทั้งหมดของช่องควบคุมไว้กับ io ที่สร้างแล้ว
 * เรียกจาก createSocketServer — ไม่สร้าง io เอง (io ต้องมีตัวเดียวทั้งระบบ)
 */
export function registerMachineControl(io: SocketIOServer): void {
  io.on('connection', (socket: Socket) => {
    // ห้องที่ socket นี้เข้าไปดูอยู่ — ใช้ตอน disconnect เพื่อรู้ว่าต้องปิด session ไหน
    const joined = new Set<string>();

    /** ออกจากห้อง + ถ้าไม่มีใครดูเหลือแล้ว สั่ง runner หยุดสตรีม */
    const leaveRoom = (machineId: string, reason: string, user: ControlUser | null) => {
      const room = machineRoom(machineId);
      if (!joined.has(machineId)) return;
      joined.delete(machineId);
      socket.leave(room);
      const remaining = roomViewers(io, room);
      setViewers(machineId, remaining);
      if (remaining === 0) {
        setRequestedFps(machineId, null);
        // "หยุดสตรีม" ไม่ผูกกับ timeout ยาว: ถ้าเครื่องออฟไลน์ คำสั่งนี้จะถูกทิ้งเอง
        dispatchCommand(machineId, 'screen.stop', { reason }, 15_000);
        if (user) {
          AuditService.logAction({
            userId: user.id,
            actionType: `MACHINE_CONTROL screen.stop ${machineId}`,
            payload: { machineId, reason, remaining },
          }).catch(console.error);
        }
      }
      return remaining;
    };

    socket.on('control:join', (msg: unknown, ack: unknown) => {
      const user = controlUser(socket);
      if (!user) {
        reply(ack, { ok: false, error: 'not authenticated' });
        return;
      }
      // ช่องนี้สั่งเมาส์/คีย์บอร์ด/ไฟล์บนเครื่องอื่นได้ ⇒ SUPERADMIN เท่านั้น
      if (user.role !== 'SUPERADMIN') {
        reply(ack, { ok: false, error: 'SUPERADMIN required' });
        return;
      }
      const machineId = readMachineId(msg);
      if (!machineId) {
        reply(ack, { ok: false, error: 'machineId required' });
        return;
      }

      const fps = normalizeFps((msg as { fps?: unknown } | undefined)?.fps);
      const room = machineRoom(machineId);
      socket.join(room);
      joined.add(machineId);
      const viewers = roomViewers(io, room);
      setViewers(machineId, viewers);
      setRequestedFps(machineId, fps);

      // คนแรกที่เปิดดู = สั่งเริ่มสตรีม · คนที่สองเป็นต้นไปแค่ขอ fps ซ้ำ
      // (สั่ง start ทุกครั้งก็ได้ผลเหมือนกัน แต่จะทำให้ runner รีสตาร์ทสตรีมโดยไม่จำเป็น)
      const type = viewers === 1 ? 'screen.start' : 'screen.fps';
      const command = dispatchCommand(machineId, type, { fps }, 15_000);

      if (viewers === 1) {
        AuditService.logAction({
          userId: user.id,
          actionType: `MACHINE_CONTROL screen.start ${machineId}`,
          payload: { machineId, fps, commandId: command.id },
        }).catch(console.error);
      }

      reply(ack, { ok: true, machineId, viewers, fps, commandId: command.id });
    });

    socket.on('control:leave', (msg: unknown, ack: unknown) => {
      const machineId = readMachineId(msg);
      if (!machineId) {
        reply(ack, { ok: false, error: 'machineId required' });
        return;
      }
      const remaining = leaveRoom(machineId, 'client-leave', controlUser(socket));
      reply(ack, { ok: true, machineId, viewers: remaining ?? getViewers(machineId) });
    });

    /**
     * เมาส์/คีย์บอร์ด — ส่งต่อไปให้ runner ฉีดเข้าที่เครื่องปลายทาง
     * ตรวจรูปทรงของ event ที่นี่ ไม่ปล่อยให้ payload มั่วไปถึง runner
     * (runner เป็น Node ธรรมดา ไม่มี schema validator ให้พึ่ง)
     */
    socket.on('control:input', (msg: unknown, ack: unknown) => {
      const user = controlUser(socket);
      if (!user || user.role !== 'SUPERADMIN') {
        reply(ack, { ok: false, error: 'SUPERADMIN required' });
        return;
      }
      const machineId = readMachineId(msg);
      const event = (msg as { event?: { kind?: unknown } } | undefined)?.event;
      const kind = typeof event?.kind === 'string' ? event.kind : '';
      if (!machineId || !event || (kind !== 'mouse' && kind !== 'key' && kind !== 'text')) {
        reply(ack, { ok: false, error: 'machineId and event.kind (mouse|key|text) required' });
        return;
      }
      if (!joined.has(machineId)) {
        // ออกแบบโดยเจตนา: บังคับให้ "เปิดดูจอก่อน" จึงจะสั่งได้
        // ⇒ ไม่มีทางฉีดอินพุตเข้าหน้าจอที่ไม่มีใครเห็นว่าเกิดอะไรขึ้น
        reply(ack, { ok: false, error: 'join the machine first' });
        return;
      }

      const type = kind === 'mouse' ? 'input.mouse' : kind === 'key' ? 'input.key' : 'input.text';
      const command = dispatchCommand(machineId, type, event as Record<string, unknown>, 10_000);

      if (isAuditableCommandType(type)) {
        AuditService.logAction({
          userId: user.id,
          actionType: `MACHINE_CONTROL ${type} ${machineId}`,
          payload: { machineId, event, commandId: command.id },
        }).catch(console.error);
      }
      reply(ack, { ok: true, commandId: command.id });
    });

    /** ไฟล์บนเครื่องปลายทาง — op กำหนดคำสั่งที่ runner จะรัน */
    socket.on('control:fs', (msg: unknown, ack: unknown) => {
      const user = controlUser(socket);
      if (!user || user.role !== 'SUPERADMIN') {
        reply(ack, { ok: false, error: 'SUPERADMIN required' });
        return;
      }
      const machineId = readMachineId(msg);
      const op = (msg as { op?: unknown } | undefined)?.op;
      const ALLOWED = ['list', 'read', 'write', 'mkdir', 'delete', 'rename'];
      if (!machineId || typeof op !== 'string' || !ALLOWED.includes(op)) {
        reply(ack, { ok: false, error: `machineId and op (${ALLOWED.join('|')}) required` });
        return;
      }

      const payload = ((msg as { payload?: unknown }).payload || {}) as Record<string, unknown>;
      const type = `fs.${op}`;
      const command = dispatchCommand(machineId, type, payload, 30_000);

      if (isAuditableCommandType(type)) {
        AuditService.logAction({
          userId: user.id,
          actionType: `MACHINE_CONTROL ${type} ${machineId}`,
          payload: { machineId, type, path: payload.path, commandId: command.id },
        }).catch(console.error);
      }
      reply(ack, { ok: true, commandId: command.id });
    });

    /** เปลี่ยน fps ของสตรีมที่กำลังดูอยู่ */
    socket.on('control:fps', (msg: unknown, ack: unknown) => {
      const user = controlUser(socket);
      if (!user || user.role !== 'SUPERADMIN') {
        reply(ack, { ok: false, error: 'SUPERADMIN required' });
        return;
      }
      const machineId = readMachineId(msg);
      if (!machineId) {
        reply(ack, { ok: false, error: 'machineId required' });
        return;
      }
      const fps = normalizeFps((msg as { fps?: unknown } | undefined)?.fps);
      setRequestedFps(machineId, fps);
      dispatchCommand(machineId, 'screen.fps', { fps }, 15_000);
      reply(ack, { ok: true, machineId, fps });
    });

    /** ขอภาพเดียว (เช่นกดปุ่ม "จับภาพ") — ไม่ต้องรอรอบสตรีมถัดไป */
    socket.on('control:snapshot', (msg: unknown, ack: unknown) => {
      const user = controlUser(socket);
      if (!user || user.role !== 'SUPERADMIN') {
        reply(ack, { ok: false, error: 'SUPERADMIN required' });
        return;
      }
      const machineId = readMachineId(msg);
      if (!machineId) {
        reply(ack, { ok: false, error: 'machineId required' });
        return;
      }
      const command = dispatchCommand(machineId, 'screen.snapshot', {}, 15_000);
      reply(ack, { ok: true, commandId: command.id });
    });

    socket.on('disconnect', () => {
      const user = controlUser(socket);
      for (const machineId of [...joined]) leaveRoom(machineId, 'socket-disconnect', user);
    });
  });
}
