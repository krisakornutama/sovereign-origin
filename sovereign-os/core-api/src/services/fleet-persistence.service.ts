// src/services/fleet-persistence.service.ts
//
// ── Fleet Phase 2: DB persistence layer ──────────────────────────────────────
// แยกจาก fleet-policy.service เพื่อไม่ให้ไฟล์นโยบายโตเกินเพดาน และเพื่อให้
// pure policy functions ยังทดสอบได้โดยไม่ต้องมี DB
//
// กติกา:
//   • ตาราง fleet_* เป็นของโมดูล fleet (tools/module-owners.json)
//   • ไม่ query AgentMachine โดยตรง — route ตรวจสิทธิ์/มีอยู่ก่อนเรียก service นี้
//   • actor ที่ไม่ใช่ UUID ถูกเก็บเป็น NULL (กัน P2023 จากคอลัมน์ @db.Uuid)
//   • tags เก็บเป็น JSON array ของ string เท่านั้น
import { prisma } from '../lib/prisma';
import { sanitizeText } from './fleet-store.service';
import type {
  FleetChannel,
  FleetMachineOverride,
  FleetMachineOverrideInput,
  FleetPolicy,
} from './fleet-policy.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS: FleetChannel[] = ['stable', 'beta', 'canary'];
const MAX_SITE = 64;
const MAX_GROUP = 64;
const MAX_NOTES = 500;

export function uuidOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

function iso(value: Date | null | undefined): string | undefined {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
}

function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, 12);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function overrideFromRow(row: {
  machine_id: string;
  channel: string | null;
  tags: unknown;
  notes: string | null;
  updated_at: Date;
  updated_by: string | null;
  site: { name: string } | null;
  group: { name: string } | null;
}): [string, FleetMachineOverride] | null {
  const out: FleetMachineOverride = {};
  if (row.channel === 'stable' || row.channel === 'beta' || row.channel === 'canary') {
    out.channel = row.channel;
  }
  if (row.site?.name) out.site = row.site.name;
  if (row.group?.name) out.group = row.group.name;
  const tags = tagsOf(row.tags);
  if (tags.length) out.tags = tags;
  if (row.notes) out.notes = row.notes;
  out.updatedAt = iso(row.updated_at) ?? new Date(0).toISOString();
  out.updatedBy = row.updated_by ?? undefined;
  return Object.keys(out).length > 2 ? [row.machine_id, out] : null;
}

/**
 * อ่าน policy จาก DB แล้ว merge ทับ base (base = default จาก policy service)
 * ไม่ normalize ที่นี่ — ให้ policy service เป็นคน normalize/validate ค่าเดียว
 */
export async function loadFleetPolicyFromDb(base: FleetPolicy): Promise<FleetPolicy> {
  const [settings, channels, overrides] = await Promise.all([
    prisma.fleetSetting.findUnique({ where: { id: 1 } }),
    prisma.fleetChannel.findMany(),
    prisma.fleetMachineOverride.findMany({ include: { site: true, group: true } }),
  ]);

  const next: FleetPolicy = {
    ...base,
    channels: {
      stable: { ...base.channels.stable },
      beta: { ...base.channels.beta },
      canary: { ...base.channels.canary },
    },
    machines: {},
  };

  if (settings) {
    next.defaultChannel = settings.default_channel as FleetChannel;
    next.requireLanVerification = settings.require_lan_verification;
    next.notes = settings.notes;
    next.updatedAt = iso(settings.updated_at) ?? base.updatedAt;
    next.updatedBy = settings.updated_by;
  }

  for (const row of channels) {
    if (!CHANNELS.includes(row.channel as FleetChannel)) continue;
    next.channels[row.channel as FleetChannel] = {
      label: row.label || base.channels[row.channel as FleetChannel].label,
      rolloutPercent: row.rollout_percent,
    };
  }

  for (const row of overrides) {
    const pair = overrideFromRow(row);
    if (pair) next.machines[pair[0]] = pair[1];
  }

  return next;
}

/** เขียน policy + channel rollout history ใน transaction เดียว */
export async function saveFleetPolicyToDb(
  next: FleetPolicy,
  previous: FleetPolicy,
  actor: string | null,
): Promise<void> {
  const actorId = uuidOrNull(actor);
  await prisma.$transaction(async (tx) => {
    await tx.fleetSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        default_channel: next.defaultChannel,
        require_lan_verification: next.requireLanVerification,
        notes: next.notes,
        updated_by: actorId,
      },
      update: {
        default_channel: next.defaultChannel,
        require_lan_verification: next.requireLanVerification,
        notes: next.notes,
        updated_by: actorId,
      },
    });

    for (const channel of CHANNELS) {
      const row = next.channels[channel];
      await tx.fleetChannel.upsert({
        where: { channel },
        create: {
          channel,
          label: row.label,
          rollout_percent: row.rolloutPercent,
          updated_by: actorId,
        },
        update: {
          label: row.label,
          rollout_percent: row.rolloutPercent,
          updated_by: actorId,
        },
      });
      if (previous.channels[channel]?.rolloutPercent !== row.rolloutPercent) {
        await tx.fleetRollout.create({
          data: {
            channel,
            rollout_percent: row.rolloutPercent,
            changed_by: actorId,
          },
        });
      }
    }
  });
}

async function resolveSite(tx: any, name: string | null): Promise<string | null> {
  if (!name) return null;
  const row = await tx.fleetSite.upsert({
    where: { name },
    create: { name },
    update: {},
  });
  return row.id as string;
}

async function resolveGroup(tx: any, name: string | null, siteId: string | null): Promise<string | null> {
  if (!name) return null;
  const row = await tx.fleetGroup.upsert({
    where: { name },
    create: { name, site_id: siteId },
    update: siteId ? { site_id: siteId } : {},
  });
  return row.id as string;
}

/**
 * บันทึก override ของเครื่องหนึ่ง — คืนค่าที่อ่านกลับจาก DB
 * ถ้าทุกฟิลด์ว่าง ให้ลบ override (เหมือน file-backed v1)
 */
export async function saveMachineOverrideToDb(
  machineId: string,
  input: FleetMachineOverrideInput,
  actor: string | null,
): Promise<FleetMachineOverride | null> {
  const actorId = uuidOrNull(actor);
  const saved = await prisma.$transaction(async (tx) => {
    const current = await tx.fleetMachineOverride.findUnique({
      where: { machine_id: machineId },
      include: { site: true, group: true },
    });

    let siteId = current?.site_id ?? null;
    let groupId = current?.group_id ?? null;
    if (hasOwn(input, 'site')) {
      const siteName = sanitizeText(input.site, MAX_SITE);
      siteId = await resolveSite(tx, siteName);
      if (!siteId) groupId = null;
    }
    if (hasOwn(input, 'group')) {
      const groupName = sanitizeText(input.group, MAX_GROUP);
      groupId = await resolveGroup(tx, groupName, siteId);
    }

    const channel = hasOwn(input, 'channel')
      ? input.channel ?? null
      : current?.channel ?? null;
    const tags = hasOwn(input, 'tags')
      ? Array.from(new Set(input.tags ?? []))
      : tagsOf(current?.tags);
    const notes = hasOwn(input, 'notes')
      ? sanitizeText(input.notes, MAX_NOTES)
      : current?.notes ?? null;

    const meaningful = Boolean(channel) || Boolean(siteId) || Boolean(groupId) || tags.length > 0 || Boolean(notes);
    if (!meaningful) {
      if (current) await tx.fleetMachineOverride.delete({ where: { machine_id: machineId } });
      return null;
    }

    return tx.fleetMachineOverride.upsert({
      where: { machine_id: machineId },
      create: {
        machine_id: machineId,
        channel,
        site_id: siteId,
        group_id: groupId,
        tags,
        notes,
        updated_by: actorId,
      },
      update: {
        channel,
        site_id: siteId,
        group_id: groupId,
        tags,
        notes,
        updated_by: actorId,
      },
      include: { site: true, group: true },
    });
  });

  if (!saved) return null;
  const pair = overrideFromRow(saved);
  return pair ? pair[1] : null;
}

export async function listFleetSites() {
  return prisma.fleetSite.findMany({ orderBy: { name: 'asc' } });
}

export async function listFleetGroups() {
  return prisma.fleetGroup.findMany({ orderBy: { name: 'asc' }, include: { site: true } });
}

/**
 * อ่านสาขาตาม id — ใช้ทั้งฝั่ง fleet (resolveFleetScope) และ users (ตรวจก่อนผูกบัญชี)
 * คืน null เมื่อ id ไม่ใช่ UUID (กัน P2023 จากคอลัมน์ @db.Uuid) หรือไม่พบแถว
 */
export async function getFleetSiteById(id: string | null | undefined): Promise<{ id: string; name: string } | null> {
  if (typeof id !== 'string') return null;
  const safe = uuidOrNull(id);
  if (!safe) return null;
  return prisma.fleetSite.findUnique({ where: { id: safe }, select: { id: true, name: true } });
}

/**
 * รายการสาขาตามขอบเขต — siteId = null คือทั้งหมด (SUPERADMIN)
 * SITE_ADMIN เห็นเฉพาะสาขาของตัวเอง: ไม่เห็นแม้แต่ "ชื่อ" สาขาอื่นผ่าน API
 */
export async function listFleetSitesScoped(siteId: string | null) {
  if (siteId !== null) {
    const safe = uuidOrNull(siteId);
    if (!safe) return [];
    return prisma.fleetSite.findMany({ where: { id: safe }, orderBy: { name: 'asc' } });
  }
  return prisma.fleetSite.findMany({ orderBy: { name: 'asc' } });
}

/**
 * รายการกลุ่มตามขอบเขต — siteId = null คือทั้งหมด
 * กลุ่มที่ไม่ได้ผูกสาขา (site_id NULL) ต้องไม่โผล่ให้ SITE_ADMIN (fail closed)
 */
export async function listFleetGroupsScoped(siteId: string | null) {
  if (siteId !== null) {
    const safe = uuidOrNull(siteId);
    if (!safe) return [];
    return prisma.fleetGroup.findMany({
      where: { site_id: safe },
      orderBy: { name: 'asc' },
      include: { site: true },
    });
  }
  return prisma.fleetGroup.findMany({ orderBy: { name: 'asc' }, include: { site: true } });
}
