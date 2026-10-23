#!/usr/bin/env node
// scripts/fleet-backfill.mjs
//
// ย้าย state จาก Fleet v1 (JSON) เข้า DB หลังรัน migration Phase 2
//   • idempotent: upsert ตามชื่อ/ hash — รันซ้ำได้
//   • dry-run เป็นค่าเริ่มต้น; ต้องใส่ --apply จึงเขียน
//   • ไม่พิมพ์ token/hash ลง stdout
//
// ใช้:
//   node scripts/fleet-backfill.mjs
//   node scripts/fleet-backfill.mjs --apply
//   node scripts/fleet-backfill.mjs --root data/fleet --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rootArg = args.indexOf('--root');
const root = rootArg >= 0 && args[rootArg + 1]
  ? path.resolve(process.cwd(), args[rootArg + 1])
  : path.resolve(HERE, '..', 'data', 'fleet');

const prisma = new PrismaClient();

function readJson(name) {
  const file = path.join(root, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err?.code !== 'ENOENT') console.error(`[fleet-backfill] อ่าน ${name} ไม่ได้: ${err.message}`);
    return null;
  }
}

function uuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function text(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function tags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().slice(0, 32)))].slice(0, 12);
}

function channel(value) {
  return ['stable', 'beta', 'canary'].includes(value) ? value : null;
}

async function run(tx) {
  const policy = readJson('policy.json');
  const store = readJson('enrollment-tokens.json');
  const counts = { settings: 0, channels: 0, sites: 0, groups: 0, overrides: 0, skippedOverrides: 0, tokens: 0, skippedTokens: 0 };

  if (policy && typeof policy === 'object') {
    const defaultChannel = channel(policy.defaultChannel) || 'stable';
    const notes = text(policy.notes, 1000);
    await tx.fleetSetting.upsert({
      where: { id: 1 },
      create: { id: 1, default_channel: defaultChannel, require_lan_verification: policy.requireLanVerification !== false, notes },
      update: { default_channel: defaultChannel, require_lan_verification: policy.requireLanVerification !== false, notes },
    });
    counts.settings = 1;

    for (const key of ['stable', 'beta', 'canary']) {
      const row = policy.channels?.[key];
      if (!row || typeof row !== 'object') continue;
      const pct = Math.max(0, Math.min(100, Math.round(Number(row.rolloutPercent))));
      if (!Number.isFinite(pct)) continue;
      await tx.fleetChannel.upsert({
        where: { channel: key },
        create: { channel: key, label: String(row.label || key), rollout_percent: pct },
        update: { rollout_percent: pct },
      });
      counts.channels += 1;
    }

    for (const [machineId, raw] of Object.entries(policy.machines || {})) {
      if (!uuid(machineId) || !raw || typeof raw !== 'object') {
        counts.skippedOverrides += 1;
        continue;
      }
      const machine = await tx.agentMachine.findUnique({ where: { id: machineId }, select: { id: true } });
      if (!machine) {
        counts.skippedOverrides += 1;
        continue;
      }
      let siteId = null;
      let groupId = null;
      const site = text(raw.site, 64);
      const group = text(raw.group, 64);
      if (site) {
        const row = await tx.fleetSite.upsert({ where: { name: site }, create: { name: site }, update: {} });
        siteId = row.id;
        counts.sites += 1;
      }
      if (group) {
        const row = await tx.fleetGroup.upsert({ where: { name: group }, create: { name: group, site_id: siteId }, update: siteId ? { site_id: siteId } : {} });
        groupId = row.id;
        counts.groups += 1;
      }
      const rowTags = tags(raw.tags);
      const notes = text(raw.notes, 500);
      const ch = channel(raw.channel);
      if (!ch && !siteId && !groupId && !rowTags.length && !notes) {
        counts.skippedOverrides += 1;
        continue;
      }
      await tx.fleetMachineOverride.upsert({
        where: { machine_id: machineId },
        create: { machine_id: machineId, channel: ch, site_id: siteId, group_id: groupId, tags: rowTags, notes },
        update: { channel: ch, site_id: siteId, group_id: groupId, tags: rowTags, notes },
      });
      counts.overrides += 1;
    }
  }

  if (store && Array.isArray(store.tokens)) {
    for (const raw of store.tokens) {
      const hash = typeof raw?.tokenHash === 'string' ? raw.tokenHash.toLowerCase() : '';
      if (!/^[a-f0-9]{64}$/.test(hash)) {
        counts.skippedTokens += 1;
        continue;
      }
      const label = text(raw.label, 64);
      if (!label) {
        counts.skippedTokens += 1;
        continue;
      }
      const expiresAt = typeof raw.expiresAt === 'string' && Number.isFinite(Date.parse(raw.expiresAt))
        ? new Date(raw.expiresAt)
        : null;
      const existing = await tx.fleetEnrollmentToken.findUnique({ where: { token_hash: hash }, select: { id: true } });
      if (existing) continue;
      await tx.fleetEnrollmentToken.create({
        data: {
          label,
          prefix: text(raw.prefix, 20) || `enr_${hash.slice(0, 8)}`,
          token_hash: hash,
          created_by: uuid(raw.createdBy),
          expires_at: expiresAt,
          max_uses: Math.max(1, Math.min(1000, Math.round(Number(raw.maxUses) || 1))),
          used_count: Math.max(0, Math.min(1000, Math.round(Number(raw.usedCount) || 0))),
          last_used_at: typeof raw.lastUsedAt === 'string' && Number.isFinite(Date.parse(raw.lastUsedAt)) ? new Date(raw.lastUsedAt) : null,
          last_machine_id: text(raw.lastMachineId, 64),
          last_machine_name: text(raw.lastMachineName, 64),
          revoked_at: typeof raw.revokedAt === 'string' && Number.isFinite(Date.parse(raw.revokedAt)) ? new Date(raw.revokedAt) : null,
        },
      });
      counts.tokens += 1;
    }
  }

  return counts;
}

try {
  if (apply) {
    const counts = await prisma.$transaction(run);
    console.log('[fleet-backfill] applied', counts);
  } else {
    // dry-run: อ่าน/ตรวจโดยไม่เขียน — ใช้ transaction แล้ว rollback
    const counts = await prisma.$transaction(async (tx) => {
      const out = await run(tx);
      throw Object.assign(new Error('dry-run'), { dryRun: out });
    }).catch((err) => {
      if (err?.dryRun) return err.dryRun;
      throw err;
    });
    console.log('[fleet-backfill] dry-run', counts, '(ใช้ --apply เพื่อเขียน)');
  }
} catch (err) {
  console.error('[fleet-backfill] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
