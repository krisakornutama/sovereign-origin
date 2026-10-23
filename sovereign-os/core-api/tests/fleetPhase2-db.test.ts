// tests/fleetPhase2-db.test.ts
//
// Fleet Phase 2 — persisted model on real Postgres.
// สัญญาที่ต้องคงอยู่:
//   • policy/channels/rollouts/settings อยู่ใน DB (ไม่ใช่ไฟล์)
//   • machine override มี FK ไป agent_machines + site/group เป็นตารางจริง
//   • enrollment token เก็บ hash เท่านั้น + use log ตรวจย้อนหลังได้
//   • audit อ่านจาก audit_logs ผ่าน fleet_audit_view
//
// Gated: RUN_DB_TESTS=1 + TEST_DATABASE_URL (เหมือนชุด DB อื่น)
import './setup-env';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, type CoreCtx } from './db-harness';

describe('fleet phase 2 — persisted model', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  let machineId = '';

  before(async () => {
    ctx = await setupCore();
    await ctx.prisma.fleetEnrollmentUse.deleteMany({});
    await ctx.prisma.fleetEnrollmentToken.deleteMany({});
    await ctx.prisma.fleetMachineOverride.deleteMany({});
    await ctx.prisma.fleetGroup.deleteMany({});
    await ctx.prisma.fleetSite.deleteMany({});
    await ctx.prisma.fleetRollout.deleteMany({});
    await ctx.prisma.fleetChannel.deleteMany({});
    await ctx.prisma.fleetSetting.deleteMany({});

    const machine = await ctx.prisma.agentMachine.create({
      data: {
        name: 'fleet-phase2-dbtest',
        token_hash: crypto.randomBytes(32).toString('hex'),
      },
    });
    machineId = machine.id;
  });

  after(async () => {
    await ctx.prisma.agentMachine.delete({ where: { id: machineId } }).catch(() => {});
    await teardownCore(ctx);
  });

  test('ตารางและ view ถูกสร้างจริง', async () => {
    const tables = [
      'fleet_sites',
      'fleet_groups',
      'fleet_channels',
      'fleet_rollouts',
      'fleet_settings',
      'fleet_machine_overrides',
      'fleet_enrollment_tokens',
      'fleet_enrollment_uses',
    ];
    for (const table of tables) {
      const rows = await ctx.prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
        'SELECT to_regclass($1)::text AS name',
        table,
      );
      assert.equal(rows[0]?.name, table, `ต้องมีตาราง ${table}`);
    }
    const view = await ctx.prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
      "SELECT to_regclass('fleet_audit_view')::text AS name",
    );
    assert.equal(view[0]?.name, 'fleet_audit_view', 'ต้องมี view fleet_audit_view');
  });

  test('policy อ่าน/เขียนจาก DB และเก็บ rollout history', async () => {
    const { loadFleetPolicy, updateFleetPolicy } = await import('../src/services/fleet-policy.service');
    const initial = await loadFleetPolicy();
    assert.equal(initial.defaultChannel, 'stable');
    assert.equal(initial.channels.stable.rolloutPercent, 100);

    await updateFleetPolicy(
      {
        defaultChannel: 'beta',
        channels: { beta: { rolloutPercent: 40 }, canary: { rolloutPercent: 1 } },
        requireLanVerification: false,
        notes: 'fleet phase 2 dbtest',
      },
      ctx.userId,
    );

    const reloaded = await loadFleetPolicy();
    assert.equal(reloaded.defaultChannel, 'beta');
    assert.equal(reloaded.channels.beta.rolloutPercent, 40);
    assert.equal(reloaded.channels.canary.rolloutPercent, 1);
    assert.equal(reloaded.requireLanVerification, false);
    assert.equal(reloaded.notes, 'fleet phase 2 dbtest');

    const channel = await ctx.prisma.fleetChannel.findUnique({ where: { channel: 'beta' } });
    assert.equal(channel?.rollout_percent, 40);
    const history = await ctx.prisma.fleetRollout.findMany({ where: { channel: 'beta' } });
    assert.ok(history.length >= 1, 'ต้องมี rollout history ของ beta');
  });

  test('machine override มี FK จริงและล้างได้', async () => {
    const { loadFleetPolicy, setMachineOverride } = await import('../src/services/fleet-policy.service');
    const saved = await setMachineOverride(
      machineId,
      { channel: 'canary', site: 'Fleet Site', group: 'Fleet Group', tags: ['pos', 'pos'], notes: 'ชั้น 2' },
      ctx.userId,
    );
    assert.equal(saved.override?.channel, 'canary');
    assert.deepEqual(saved.override?.tags, ['pos']);

    const dbRow = await ctx.prisma.fleetMachineOverride.findUnique({
      where: { machine_id: machineId },
      include: { site: true, group: true },
    });
    assert.equal(dbRow?.channel, 'canary');
    assert.equal(dbRow?.site?.name, 'Fleet Site');
    assert.equal(dbRow?.group?.name, 'Fleet Group');
    assert.equal(dbRow?.machine_id, machineId);

    const policy = await loadFleetPolicy();
    assert.equal(policy.machines[machineId]?.site, 'Fleet Site');
    assert.equal(policy.machines[machineId]?.group, 'Fleet Group');

    const cleared = await setMachineOverride(
      machineId,
      { channel: null, site: null, group: null, tags: null, notes: null },
      ctx.userId,
    );
    assert.equal(cleared.override, null);
    assert.equal(await ctx.prisma.fleetMachineOverride.count({ where: { machine_id: machineId } }), 0);
  });

  test('enrollment token เก็บ hash + use log และคืนสิทธิ์ได้', async () => {
    const {
      consumeEnrollToken,
      createEnrollToken,
      releaseEnrollTokenUse,
      revokeEnrollToken,
    } = await import('../src/services/fleet-enrollment.service');

    const created = await createEnrollToken(
      { label: 'DB fleet token', maxUses: 1, expiresInHours: 1 },
      ctx.userId,
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const row = await ctx.prisma.fleetEnrollmentToken.findFirst({
      where: { id: created.record.id },
    });
    assert.ok(row);
    assert.notEqual(row.token_hash, created.token, 'ห้ามเก็บ token จริง');
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);

    const first = await consumeEnrollToken(created.token, { id: machineId, name: 'fleet-phase2-dbtest' });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.usesRemaining, 0);

    const uses = await ctx.prisma.fleetEnrollmentUse.findMany({ where: { token_id: created.record.id } });
    assert.equal(uses.length, 1);
    assert.equal(uses[0]?.machine_id, machineId);

    const second = await consumeEnrollToken(created.token, { id: machineId, name: 'fleet-phase2-dbtest' });
    assert.deepEqual(second, { ok: false, reason: 'exhausted' });

    assert.equal(await releaseEnrollTokenUse(created.record.id), true);
    const released = await ctx.prisma.fleetEnrollmentToken.findUnique({ where: { id: created.record.id } });
    assert.equal(released?.used_count, 0);

    assert.equal((await revokeEnrollToken(created.record.id, undefined, 'dbtest revoke')).ok, true);
    const afterRevoke = await consumeEnrollToken(created.token, { id: machineId, name: 'fleet-phase2-dbtest' });
    assert.deepEqual(afterRevoke, { ok: false, reason: 'revoked' });
  });

  test('audit อ่านจาก audit_logs ผ่าน view ได้', async () => {
    const { AuditService } = await import('../src/services/audit.service');
    await AuditService.logAction({
      userId: ctx.userId,
      actionType: 'FLEET_MACHINE_POLICY_UPDATE',
      payload: { machineId, override: { channel: 'canary' } },
    });
    const events = await AuditService.listFleetEvents({ limit: 10, machineId });
    assert.ok(events.length >= 1);
    assert.equal(events[0]?.action_type, 'FLEET_MACHINE_POLICY_UPDATE');
    assert.equal((events[0]?.payload as { machineId?: string })?.machineId, machineId);
  });
});
