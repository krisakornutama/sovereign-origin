// ─────────────────────────────────────────────────────────────────────────────
// license-gate.service.ts — ชั้นบังคับสิทธิ์ของไลเซนส์ (ไม่ใช่แค่ซ่อนเมนู)
//
// กติกา 2 ข้อที่ต้องจำ:
//   1) ยังไม่ตั้งไลเซนส์ / ไลเซนส์ไม่ผ่าน (หมดอายุ, ผิดเครื่อง, ลายเซ็นพัง)
//      = โหมด CE → ปล่อยผ่านเสมอ ห้ามล็อกผู้ใช้เดิมออกจากข้อมูลของเขา
//   2) ไลเซนส์ "ผ่าน" แล้วเท่านั้นที่บังคับสิทธิ์: ฟีเจอร์นอก features = 403
//
// เหตุผลของข้อ 1: ระบบนี้เป็น appliance ในบ้านลูกค้า — ไลเซนส์หมดอายุต้องไม่ทำให้
// เขาดูข้อมูลตัวเองไม่ได้ (นั่นคือการถือข้อมูลเขาเป็นตัวประกัน) การขายใช้ tier
// เปิด-ปิดฟีเจอร์ใหม่ ไม่ใช่การปิดระบบที่เขาติดตั้งไว้แล้ว
// ─────────────────────────────────────────────────────────────────────────────

import type { NextFunction, Request, Response } from 'express';
import { arch, cpus, hostname, platform } from 'node:os';
import {
  hasFeature,
  licenseStatusFromEnv,
  type LicenseReason,
  type LicenseStatus,
  type LicenseTier,
} from './license.service';

/** ce = ยังไม่มีไลเซนส์ที่ใช้ได้ (ทุกฟีเจอร์เปิด) · licensed = มีไลเซนส์ผ่านและบังคับสิทธิ์ */
export type LicenseMode = 'ce' | 'licensed';
export type LicenseReasonCode = LicenseReason | 'not-configured';
export const LICENSE_FEATURE_DENIED = 'LICENSE_FEATURE_NOT_ENTITLED';

export interface LicenseView {
  mode: LicenseMode;
  configured: boolean;
  valid: boolean;
  reason: LicenseReasonCode;
  tier: LicenseTier | null;
  features: string[];
  expiresAt: string | null;
  daysLeft: number | null;
  licensee: string | null;
  licenseId: string | null;
  machineBound: boolean;
  expiringSoon: boolean;
}

/**
 * ค่า machine id ดิบของโปรเซสนี้ — ต้องตรงกับ `npm run license -- machine-id`
 * (hostname|platform|arch|cpu) เว้นแต่ตั้ง SOVEREIGN_MACHINE_ID เอง (ใช้ --raw ค่าเดียวกันตอนออกไลเซนส์)
 */
export function currentMachineId(env: Record<string, string | undefined> = process.env): string {
  const override = env.SOVEREIGN_MACHINE_ID;
  if (typeof override === 'string' && override.trim() !== '') return override.trim();
  return [hostname(), platform(), arch(), cpus()[0]?.model ?? 'unknown'].join('|');
}

/** ตรวจไลเซนส์ของเครื่องนี้จาก env (null = ยังไม่ได้ตั้งอะไรเลย) */
export function readLicenseStatus(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date()
): LicenseStatus | null {
  return licenseStatusFromEnv(env, currentMachineId(env), now);
}

/** แปลงสถานะเป็นสิ่งที่ API/UI ใช้ได้ — ไม่มี token, ไม่มี public key, ไม่มี machine hash */
export function licenseView(status: LicenseStatus | null): LicenseView {
  if (!status) {
    return {
      mode: 'ce',
      configured: false,
      valid: false,
      reason: 'not-configured',
      tier: null,
      features: [],
      expiresAt: null,
      daysLeft: null,
      licensee: null,
      licenseId: null,
      machineBound: false,
      expiringSoon: false,
    };
  }
  return {
    mode: status.valid ? 'licensed' : 'ce',
    configured: true,
    valid: status.valid,
    reason: status.reason,
    tier: status.tier,
    features: status.features,
    expiresAt: status.expiresAt,
    daysLeft: status.daysLeft,
    licensee: status.payload?.licensee ?? null,
    licenseId: status.payload?.id ?? null,
    machineBound: status.machineBound,
    expiringSoon: status.valid && status.daysLeft !== null && status.daysLeft <= 30,
  };
}

/**
 * middleware บังคับสิทธิ์ตามฟีเจอร์ — ใช้ต่อจาก authenticate ใน routes.ts
 * ติดตั้งเป็น `app.use('/api/x', featureGuard('/x'), licenseGuard('/x'), routes)`
 */
export function licenseGuard(feature: string | string[]) {
  const features = Array.isArray(feature) ? feature : [feature];
  return (_req: Request, res: Response, next: NextFunction) => {
    const status = readLicenseStatus();
    // โหมด CE (ไม่มีไลเซนส์ หรือไลเซนส์ไม่ผ่าน) = ไม่บังคับสิทธิ์
    if (!status || !status.valid) return next();
    if (features.some((f) => hasFeature(status, f))) return next();
    return res.status(403).json({
      error: 'This feature is not included in your license',
      code: LICENSE_FEATURE_DENIED,
      feature: features[0],
      tier: status.tier,
    });
  };
}
