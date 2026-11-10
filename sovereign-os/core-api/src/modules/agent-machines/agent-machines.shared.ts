// src/modules/agent-machines/agent-machines.shared.ts
// ────────────────────────────────────────────────────────────────────────────
// ของกลางของโมดูล agent-machines — แยกออกมาเพราะไฟล์ routes เดิมยาวเกือบ 1000 บรรทัด
// (arch-gate file-budget 800) และเพราะตัวตนของผู้เรียกต้องตัดสินที่เดียว:
//   • ผู้ใช้ (หน้าเว็บ)      → JWT
//   • runner (เครื่องคอม)  → x-machine-token เท่านั้น
// callerIp() อยู่ในนี้เพื่อให้ทุก route ใช้คำตอบเดียวกันเรื่อง "ใครคือผู้เรียก"
// ────────────────────────────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { hardenUpload, IMAGE_MIME } from '../../lib/harden-upload';
import { normalizePeerAddress } from '../../lib/net';
import { authenticateToken, type MachineRow } from '../../services/agent-machines.service';
import { safeEqual } from '../../services/machine-enroll.service';
import { isEnrollTokenFormat, verifyEnrollToken } from '../../services/fleet-enrollment.service';
import { currentFleetPolicy, decideUpdateGate, type FleetChannel } from '../../services/fleet-policy.service';

/**
 * จำนวนครั้งที่ลงทะเบียนแล้วล้มเหลว ต่อ IP — กันเดารหัสเชิญทีละตัว
 * เก็บในหน่วยความจำเท่านั้น (พอกันการเดา) ไม่ต้องเขียนลง DB
 */
export const enrollFailures = new Map<string, number>();

/**
 * ด่านชุดติดตั้งเครื่องใหม่: เดิมสามเส้นนี้เปิดให้ใครก็โหลดได้ (รู้ URL = ได้ชุดระบบทั้งชุด)
 * ผ่านได้สองทางเท่านั้น:
 *   • machine token ของเครื่องที่ลงทะเบียนแล้ว (เครื่องเดิมดึงชุดใหม่)
 *   • รหัสเชิญ MACHINE_ENROLL_CODE หรือรหัสฝูง enr_... ที่ยังใช้ได้ — ตรวจแบบไม่กินโควตา
 * ไม่มีทั้งสอง = 401 เสมอ (fail-closed แม้ HUB ไม่ได้ตั้งรหัสเชิญ)
 */
export async function authorizeNodeKitAccess(req: Request, res: Response): Promise<boolean> {
  const machineToken = String(req.get('x-machine-token') ?? '').trim();
  if (machineToken) {
    const machine = await authenticateToken(machineToken);
    if (machine) return true;
  }

  const headerCode = String(req.get('x-enroll-code') ?? '').trim();
  const queryCode = typeof req.query?.code === 'string' ? String(req.query.code).trim() : '';
  const code = headerCode || queryCode;
  if (code) {
    const expected = String(process.env.MACHINE_ENROLL_CODE ?? '').trim();
    if (expected && safeEqual(code, expected)) return true;
    if (isEnrollTokenFormat(code)) {
      const verdict = await verifyEnrollToken(code);
      if (verdict.ok) return true;
    }
  }

  res.status(401).json({
    error: 'ต้องมีสิทธิ์ก่อนดาวน์โหลดชุดติดตั้ง',
    hint: 'แนบ header x-enroll-code (หรือ query ?code=) ด้วยรหัสเชิญที่ยังใช้ได้ หรือใช้ x-machine-token ของเครื่องที่ลงทะเบียนแล้ว',
    decision: 'access_denied',
  });
  return false;
}


/** hash ของไฟล์ที่ให้บริการ — เทียบกับ manifest ก่อนส่งออกทุกครั้ง (ไฟล์บนดิสก์อาจถูกแก้/หาย) */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface FleetUpdateGate {
  channel: FleetChannel;
  rolloutPercent: number;
}

/**
 * ด่านช่องทางอัปเดตของเครื่องหนึ่ง:
 *   • disabled = หยุดทันที (403) — เครื่องที่ถูกระงับต้องไม่ดึงโค้ดใหม่
 *   • ไม่อยู่ในเปอร์เซ็นต์ rollout = ตอบ 404 แบบ "ยังไม่มีชุดอัปเดต"
 *     (runner/desktop updater เดิมตีความ 404 เป็น "ไม่มีอะไรใหม่" อยู่แล้ว)
 *   • ผ่าน = คืน channel/percent ให้ route ใส่ใน body (client เก่ามองข้ามได้)
 */
export async function gateFleetUpdate(machine: MachineRow, res: Response): Promise<FleetUpdateGate | null> {
  const decision = decideUpdateGate(machine, currentFleetPolicy());
  res.set('X-Fleet-Channel', decision.channel);
  res.set('X-Fleet-Rollout', String(decision.rolloutPercent));

  if (decision.reason === 'machine_disabled') {
    res.status(403).json({
      error: 'machine is disabled',
      channel: decision.channel,
      reason: decision.reason,
    });
    return null;
  }
  if (decision.reason === 'rollout_hold') {
    res.set('X-Fleet-Hold', 'rollout');
    res.status(404).json({
      error: 'update held by rollout policy',
      channel: decision.channel,
      rolloutPercent: decision.rolloutPercent,
      reason: decision.reason,
    });
    return null;
  }
  return { channel: decision.channel, rolloutPercent: decision.rolloutPercent };
}

/**
 * คัดฟิลด์เครื่องสำหรับหน้าเว็บ — ห้ามส่ง token_hash / pair_code_hash ออกไป
 * ของเดิม GET /api/agent-machines ใช้ spread ทั้ง row ทำให้แฮช token รั่วให้ผู้ใช้ที่ล็อกอินทุกคน
 */
export function publicMachine(m: MachineRow) {
  return {
    id: m.id,
    name: m.name,
    os: m.os ?? 'unknown',
    capabilities: m.capabilities ?? [],
    executors: m.executors ?? [],
    status: m.status ?? 'offline',
    last_heartbeat: m.last_heartbeat ?? null,
    version: m.version ?? null,
    note: m.note ?? null,
    role: m.role ?? null,
    owner_user_id: m.owner_user_id ?? null,
    lan_confirmed_at: m.lan_confirmed_at ?? null,
    created_at: m.created_at ?? null,
    updated_at: m.updated_at ?? null,
    stale_sec: m.stale_sec ?? null,
  };
}

/** นามสกุลภาพหน้าจอที่ยอมรับ — runner ส่ง PNG เสมอ แต่เปิดรับ jpeg/webp ด้วย */
export const SCREENSHOT_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

// รับภาพเข้าหน่วยความจำก่อน — service เป็นคนเขียนดิสก์ด้วยชื่อไฟล์สุ่มของตัวเอง
export const screenshotUpload = hardenUpload({
  allowedExtensions: SCREENSHOT_EXTS,
  maxSizeMB: 10,
  mode: 'memory',
  mimeAllow: IMAGE_MIME,
});

/**
 * IP ล่าสุดที่เครื่องแต่ละตัวติดต่อเข้ามา — เก็บในหน่วยความจำ ไม่แตะ DB
 *
 * ทำไมไม่เพิ่มคอลัมน์ในตาราง: การเพิ่มคอลัมน์ต้อง migrate และเครื่องลูกที่อัปเดตโค้ดตัวเองได้
 * ต้องไม่ค้างรอ migration ของ HUB · เจตนาคือ "เห็นเครื่อง 2 3 4 พร้อม IP เดี๋ยวนี้"
 * ⇒ ค่าว่างหลังรีสตาร์ท API จนกว่าเครื่องนั้นจะ heartbeat รอบถัดไป (ทุก ~30 วิ)
 */
export const machineIps = new Map<string, { ip: string; at: number }>();

/**
 * IP ของผู้เรียก — ใช้ค่าที่ Express คิดจาก peer จริง (`req.ip`) เท่านั้น
 *
 * ห้ามอ่าน `x-forwarded-for` เอง: ตัวแรกใน header นั้น client ใส่เข้ามาได้เสมอ
 * ⇒ IP ที่โชว์ใน HUB และตัวนับล้มเหลวของ /enroll จะกลายเป็นอะไรก็ได้ (และเมื่อ
 * ผู้ดูแลตั้ง TRUST_PROXY แล้ว Express เลือก hop ที่ควรเชื่อให้เรียบร้อย)
 */
export function callerIp(req: Request): string {
  return normalizePeerAddress(req.ip || req.socket?.remoteAddress);
}

/** ดึง machine จาก x-machine-token หรือ Authorization: Bearer <token> */
export async function authenticateMachineToken(req: Request, res: Response): Promise<MachineRow | null> {
  const header = req.header('x-machine-token') || '';
  const auth = req.header('authorization') || '';
  const token = header || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const machine = await authenticateToken(token);
  if (!machine) {
    res.status(401).json({ error: 'invalid or missing machine token' });
    return null;
  }
  return machine;
}

/** middleware: บังคับ machine token แล้วฝาก machine ไว้บน request (handler ใช้ต่อ) */
export function requireMachineToken(req: Request, res: Response, next: NextFunction) {
  authenticateMachineToken(req, res)
    .then((machine) => {
      if (!machine) return; // 401 ถูกส่งไปแล้วใน authenticateMachineToken
      (req as Request & { machine?: MachineRow }).machine = machine;
      next();
    })
    .catch((err) => {
      console.error('machine token auth error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Machine auth failed' });
    });
}

