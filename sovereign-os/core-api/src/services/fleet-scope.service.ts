// src/services/fleet-scope.service.ts
//
// ── ขอบเขตการเห็นฝูงเครื่องตามบทบาท (site scoping) ──────────────────────────
// เป้าหมาย: SITE_ADMIN เห็นเฉพาะเครื่องของสาขาที่ตัวเองผูกไว้ และเห็นแบบอ่านอย่างเดียว
//
// กติกาความปลอดภัย (สำคัญ — ห้ามผ่อนโดยไม่ตั้งใจ):
//   1) fail closed — SITE_ADMIN ที่ไม่มีสาขา/สาขาถูกลบ = 403 ไม่ใช่ "เห็นทั้งฝูง"
//   2) เครื่องที่ site ว่างหรือ site เป็นชื่อที่ไม่ตรงกับสาขาของผู้ใช้ = มองไม่เห็น
//   3) ตัวเลขสรุป (summary/channels) ต้องคิดใหม่จากชุดที่กรองแล้ว — ถ้าส่งของเดิมไป
//      ผู้ใช้จะรู้จำนวนเครื่อง/สถานะของสาขาอื่นผ่าน API (ข้อมูลรั่วทางอ้อม)
//   4) role ที่ไม่อยู่ใน ALLOWED_ROLES ต้องไม่ผ่าน แม้จะแนบ assigned_site_id มา
//
// ไฟล์นี้เป็น pure logic (ไม่แตะ DB/HTTP) เพื่อให้เทสต์ได้โดยไม่ต้องมีฐานข้อมูล
import { isRolloutEligible } from './fleet-policy.service';
import type { FleetOverview } from './fleet-overview.service';

export interface FleetActor {
  role: string;
  assigned_site_id?: string | null;
}

export interface FleetSiteRef {
  id: string;
  name: string;
}

export type FleetScope = { kind: 'all' } | { kind: 'site'; siteId: string; siteName: string };

export type FleetScopeCode = 'SITE_SCOPE_MISSING' | 'SITE_SCOPE_UNKNOWN' | 'ROLE_NOT_ALLOWED';

export type FleetScopeResult =
  | { ok: true; scope: FleetScope }
  | { ok: false; status: 403; code: FleetScopeCode; error: string };

/** บทบาทที่ผ่านประตู fleet ได้ — ที่เหลือถูกปฏิเสธแม้จะแนบ site มา */
export const FLEET_READ_ROLES = ['SUPERADMIN', 'SITE_ADMIN'] as const;

/**
 * ตัดสินขอบเขตของผู้เรียก
 * @param actor ผู้ใช้ที่ผ่าน authenticate แล้ว (role/assigned_site_id จาก DB)
 * @param site แถว fleet_sites ของ assigned_site_id (null = ไม่ได้ผูกหรือถูกลบไปแล้ว)
 */
export function resolveFleetScope(actor: FleetActor | null | undefined, site: FleetSiteRef | null): FleetScopeResult {
  if (!actor || !(FLEET_READ_ROLES as readonly string[]).includes(actor.role)) {
    return { ok: false, status: 403, code: 'ROLE_NOT_ALLOWED', error: 'บทบาทนี้ไม่มีสิทธิ์ดูข้อมูลฝูงเครื่อง' };
  }
  if (actor.role === 'SUPERADMIN') {
    return { ok: true, scope: { kind: 'all' } };
  }
  const assigned = actor.assigned_site_id ?? null;
  if (!assigned) {
    return {
      ok: false,
      status: 403,
      code: 'SITE_SCOPE_MISSING',
      error: 'บัญชีนี้ยังไม่ได้ผูกสาขา — ผู้ดูแลระบบต้องกำหนดสาขาก่อน',
    };
  }
  // แถวที่โหลดมาต้องเป็นสาขาเดียวกันจริง (กันการส่งค่าผิด/ถูกแก้ระหว่างทาง)
  if (!site || site.id !== assigned) {
    return {
      ok: false,
      status: 403,
      code: 'SITE_SCOPE_UNKNOWN',
      error: 'ไม่พบสาขาที่ผูกกับบัญชีนี้ — อาจถูกลบไปแล้ว',
    };
  }
  return { ok: true, scope: { kind: 'site', siteId: site.id, siteName: site.name } };
}

/** เครื่องนี้อยู่ในขอบเขตหรือไม่ (เทียบชื่อสาขา เพราะ override เก็บเป็นชื่อ) */
export function machineInScope(machine: { site: string | null }, scope: FleetScope): boolean {
  if (scope.kind === 'all') return true;
  return machine.site === scope.siteName;
}

/**
 * กรองภาพรวมตามขอบเขต แล้วคิด summary/channels ใหม่จากชุดที่กรองแล้ว
 * (โครงสร้างอื่นคงเดิม — UI ยังใช้ policy/published/enrollment ได้)
 */
export function filterFleetOverviewForScope(overview: FleetOverview, scope: FleetScope): FleetOverview {
  if (scope.kind === 'all') return overview;

  const machines = overview.machines.filter((m) => machineInScope(m, scope));
  const inCompliance = (state: string) => machines.filter((m) => m.compliance === state).length;

  const summary = {
    total: machines.length,
    online: machines.filter((m) => m.status === 'online').length,
    offline: machines.filter((m) => m.status === 'offline').length,
    disabled: machines.filter((m) => m.status === 'disabled').length,
    unverified: machines.filter((m) => !m.lanVerified && m.status !== 'disabled').length,
    ok: inCompliance('ok'),
    updateAvailable: machines.filter((m) => m.updateAvailable).length,
    updateEligible: machines.filter((m) => m.updateAvailable && m.updateEligible).length,
    held: inCompliance('held'),
    unknownVersion: inCompliance('unknown-version'),
    attention: machines.filter((m) => !['ok', 'disabled'].includes(m.compliance)).length,
  };

  const channels = overview.channels.map((channel) => {
    const inChannel = machines.filter((m) => m.channel === channel.id);
    return {
      ...channel,
      machines: inChannel.length,
      eligible: inChannel.filter((m) => isRolloutEligible(m.id, channel.id, channel.rolloutPercent)).length,
    };
  });

  return { ...overview, summary, channels, machines };
}

/** id ของเครื่องในขอบเขต — null = ไม่ต้องกรอง (SUPERADMIN) */
export function machineIdsForScope(
  machines: Array<{ id: string; site: string | null }>,
  scope: FleetScope,
): string[] | null {
  if (scope.kind === 'all') return null;
  return machines.filter((m) => machineInScope(m, scope)).map((m) => m.id);
}
