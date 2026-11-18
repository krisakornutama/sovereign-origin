// ─────────────────────────────────────────────────────────────────────────────
//  security-posture.service — รวม "ภาพรวมความปลอดภัย" จากแหล่งจริงใน DB
//
//  หลักการ (บทเรียน SEC-027/029/052): "อ่านไม่ได้" ≠ "ปกติ"
//  แต่ละแหล่งถูกอ่านแยกกัน — แหล่งที่ล้มต้องเป็น `unavailable` + เหตุผล
//  และต้องไม่ถูกนับเป็น "ผ่าน" · ถ้าทุกแหล่งล้ม overall = `unavailable` (ไม่ใช่ ok)
//
//  ขอบเขต: อ่าน DB อย่างเดียว (ไม่ exec netsh/tasklist/สคริปต์โฮสต์)
//  ⇒ สิ่งที่ Dashboard เห็นคือ "สิ่งที่ระบบรู้จริง" ไม่ใช่ค่าที่เดาจากโฮสต์ที่มองไม่เห็น
//
//  ที่ตั้งไฟล์: modules/security/ — ตาราง firewall_*/threat_intel_* เป็นของโมดูลนี้
//  ส่วน users/audit_logs เป็นของ auth ⇒ อ่านผ่าน services/account-posture.service
//  (service ของเจ้าของตาราง) ไม่ยิง prisma ข้ามโมดูลเอง
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../../lib/prisma';
import {
  readAccountSecurityCounts,
  readAuditTrailCounts,
  readRateLimitBlocks,
} from '../../services/account-posture.service';

export type PostureState = 'ok' | 'unavailable';
export type PostureOverall = 'ok' | 'degraded' | 'unavailable';

export interface PostureSource<T> {
  state: PostureState;
  /** null เมื่อ state = ok */
  reason: string | null;
  /** รหัส error ของ Prisma (เช่น P2010) หรือ 'unknown' — ไม่มีข้อความดิบ */
  code: string | null;
  /** รายละเอียดที่ปิดความลับแล้ว (≤160 ตัว) — ช่วยผู้ปฏิบัติการโดยไม่รั่ว DSN/คอลัมน์ลับ */
  detail: string | null;
  metrics: T | null;
}

export interface SecurityPosture {
  checkedAt: string;
  overall: PostureOverall;
  available: number;
  unavailable: number;
  sources: {
    accounts: PostureSource<{ total: number; withoutMfa: number; mustChangePassword: number }>;
    bruteForce24h: PostureSource<{ blocks: number }>;
    securityEvents24h: PostureSource<{ critical: number; warning: number; total: number }>;
    firewall: PostureSource<{ rulesEnabled: number; rulesTotal: number; defaultPolicy: string | null }>;
    threatIntel: PostureSource<{ active: number; lastUpdated: string | null }>;
    auditTrail: PostureSource<{ entries: number; oldest: string | null }>;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** ปิดความลับในข้อความ error ก่อนส่งออก (DSN / ค่าที่ชื่อขึ้นต้นด้วย password, secret, token, key) */
export function redactDetail(message: string): string {
  return String(message || '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[dsn]')
    .replace(/(password|secret|token|api[_-]?key|private[_-]?key)[\w-]*\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

async function sourceOf<T>(fn: () => Promise<T>): Promise<PostureSource<T>> {
  try {
    return { state: 'ok', reason: null, code: null, detail: null, metrics: await fn() };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    return {
      state: 'unavailable',
      reason: 'อ่านข้อมูลจากฐานข้อมูลไม่ได้',
      code: typeof e?.code === 'string' ? e.code : 'unknown',
      detail: redactDetail(String(e?.message ?? '')) || null,
      metrics: null,
    };
  }
}

export async function collectSecurityPosture(now: Date = new Date()): Promise<SecurityPosture> {
  const since = new Date(now.getTime() - DAY_MS);

  const [accounts, bruteForce24h, securityEvents24h, firewall, threatIntel, auditTrail] = await Promise.all([
    sourceOf(async () => readAccountSecurityCounts()),

    sourceOf(async () => ({ blocks: await readRateLimitBlocks(since) })),

    sourceOf(async () => {
      const [critical, warning, total] = await Promise.all([
        prisma.securityEvent.count({ where: { timestamp: { gte: since }, severity: 'critical' } }),
        prisma.securityEvent.count({ where: { timestamp: { gte: since }, severity: 'warning' } }),
        prisma.securityEvent.count({ where: { timestamp: { gte: since } } }),
      ]);
      return { critical, warning, total };
    }),

    sourceOf(async () => {
      const [rulesEnabled, rulesTotal, config] = await Promise.all([
        prisma.firewallRule.count({ where: { enabled: true } }),
        prisma.firewallRule.count(),
        prisma.firewallConfig.findUnique({ where: { id: 1 } }),
      ]);
      return { rulesEnabled, rulesTotal, defaultPolicy: config?.default_policy ?? null };
    }),

    sourceOf(async () => {
      const [active, agg] = await Promise.all([
        prisma.threatIntelItem.count({ where: { active: true } }),
        prisma.threatIntelItem.aggregate({ where: { active: true }, _max: { updated_at: true } }),
      ]);
      const last = agg?._max?.updated_at ?? null;
      return { active, lastUpdated: last ? new Date(last).toISOString() : null };
    }),

    sourceOf(async () => readAuditTrailCounts()),
  ]);

  const sources = { accounts, bruteForce24h, securityEvents24h, firewall, threatIntel, auditTrail };
  const states = Object.values(sources).map((s) => s.state);
  const unavailable = states.filter((s) => s === 'unavailable').length;
  const available = states.length - unavailable;
  const overall: PostureOverall = unavailable === 0 ? 'ok' : available === 0 ? 'unavailable' : 'degraded';

  return { checkedAt: now.toISOString(), overall, available, unavailable, sources };
}
