// tests/fleetScope.test.ts
//
// Fleet — การจำกัดสิทธิ์ตามสาขา (SITE_ADMIN)
// เน้นพฤติกรรมที่พลาดแล้วเจ็บ:
//   • SITE_ADMIN ที่ไม่มีสาขา/สาขาถูกลบ → ต้องปฏิเสธ (fail closed) ไม่ใช่เห็นทั้งฝูง
//   • เครื่องที่ไม่ระบุสาขา (หรือสาขาอื่น) ต้องไม่โผล่ในผลลัพธ์
//   • สรุปตัวเลข (summary/channels) ต้องคิดจากชุดที่ถูกกรองแล้ว ไม่ใช่ของทั้งระบบ
//   • role อื่นทั้งหมดต้องไม่ผ่านประตูนี้
import './setup-env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterFleetOverviewForScope,
  machineIdsForScope,
  resolveFleetScope,
  type FleetScope,
} from '../src/services/fleet-scope.service';
import type { FleetMachineView, FleetOverview } from '../src/services/fleet-overview.service';

const SITE = { id: '11111111-1111-1111-1111-111111111111', name: 'สาขาเชียงใหม่' };
const OTHER_SITE = { id: '22222222-2222-2222-2222-222222222222', name: 'สาขากรุงเทพ' };

function view(over: Partial<FleetMachineView> & { id: string; name: string }): FleetMachineView {
  return {
    os: 'windows',
    role: null,
    status: 'online',
    version: 'abc',
    lastHeartbeat: '2026-10-24T05:00:00.000Z',
    staleSec: 10,
    note: null,
    lanVerified: true,
    capabilities: [],
    executors: [],
    channel: 'stable',
    channelSource: 'default',
    rolloutPercent: 100,
    rolloutBucket: 1,
    site: null,
    group: null,
    tags: [],
    overrideNotes: null,
    updateAvailable: false,
    updateEligible: false,
    compliance: 'ok',
    reasons: [],
    ...over,
  };
}

function overview(machines: FleetMachineView[]): FleetOverview {
  const channelRows = [
    { id: 'stable' as const, label: 'Stable', rolloutPercent: 100 },
    { id: 'beta' as const, label: 'Beta', rolloutPercent: 50 },
    { id: 'canary' as const, label: 'Canary', rolloutPercent: 10 },
  ];
  return {
    generatedAt: '2026-10-24T05:00:00.000Z',
    policy: {
      version: 1,
      updatedAt: '2026-10-24T05:00:00.000Z',
      updatedBy: null,
      defaultChannel: 'stable',
      channels: { stable: { label: 'Stable', rolloutPercent: 100 }, beta: { label: 'Beta', rolloutPercent: 50 }, canary: { label: 'Canary', rolloutPercent: 10 } },
      requireLanVerification: true,
      notes: null,
      machineOverrideCount: machines.length,
    } as unknown as FleetOverview['policy'],
    summary: {
      total: machines.length,
      online: machines.filter((m) => m.status === 'online').length,
      offline: machines.filter((m) => m.status === 'offline').length,
      disabled: machines.filter((m) => m.status === 'disabled').length,
      unverified: machines.filter((m) => !m.lanVerified && m.status !== 'disabled').length,
      ok: machines.filter((m) => m.compliance === 'ok').length,
      updateAvailable: machines.filter((m) => m.updateAvailable).length,
      updateEligible: machines.filter((m) => m.updateAvailable && m.updateEligible).length,
      held: machines.filter((m) => m.compliance === 'held').length,
      unknownVersion: machines.filter((m) => m.compliance === 'unknown-version').length,
      attention: machines.filter((m) => !['ok', 'disabled'].includes(m.compliance)).length,
    },
    channels: channelRows.map((row) => ({
      ...row,
      machines: machines.filter((m) => m.channel === row.id).length,
      eligible: machines.filter((m) => m.channel === row.id && m.rolloutBucket < row.rolloutPercent).length,
    })),
    enrollment: { total: 5, usable: 2, exhausted: 1, expired: 1, revoked: 1 },
    published: {
      runner: { published: true, version: 'abc', generatedAt: '2026-10-24T05:00:00.000Z', files: 20 },
      desktop: { published: false, version: null, generatedAt: null, asset: null },
      nodeKit: { published: false, version: null, generatedAt: null, asset: null },
    },
    machines,
  };
}

describe('resolveFleetScope — ใครเห็นอะไร', () => {
  it('SUPERADMIN เห็นทั้งฝูง (ไม่สน assigned_site_id)', () => {
    const r = resolveFleetScope({ role: 'SUPERADMIN', assigned_site_id: null }, null);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.scope, { kind: 'all' });
  });

  it('SITE_ADMIN ที่มีสาขา → จำกัดเฉพาะสาขานั้น', () => {
    const r = resolveFleetScope({ role: 'SITE_ADMIN', assigned_site_id: SITE.id }, SITE);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.scope, { kind: 'site', siteId: SITE.id, siteName: SITE.name });
  });

  it('SITE_ADMIN ที่ยังไม่ผูกสาขา → ปฏิเสธ (ไม่ใช่เห็นหมด)', () => {
    const r = resolveFleetScope({ role: 'SITE_ADMIN', assigned_site_id: null }, null);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 403);
    assert.equal(r.ok === false && r.code, 'SITE_SCOPE_MISSING');
  });

  it('SITE_ADMIN ที่สาขาถูกลบไปแล้ว → ปฏิเสธ (fail closed)', () => {
    const r = resolveFleetScope({ role: 'SITE_ADMIN', assigned_site_id: SITE.id }, null);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, 'SITE_SCOPE_UNKNOWN');
  });

  it('แถวสาขาที่โหลดมาไม่ตรงกับที่ผูกไว้ → ปฏิเสธ', () => {
    const r = resolveFleetScope({ role: 'SITE_ADMIN', assigned_site_id: SITE.id }, OTHER_SITE);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, 'SITE_SCOPE_UNKNOWN');
  });

  it('role อื่นทั้งหมด (รวม NODE_ADMIN/OPERATOR) ผ่านประตูนี้ไม่ได้', () => {
    for (const role of ['NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'KID', '']) {
      const r = resolveFleetScope({ role, assigned_site_id: SITE.id }, SITE);
      assert.equal(r.ok, false, `${role} ต้องถูกปฏิเสธ`);
      assert.equal(r.ok === false && r.code, 'ROLE_NOT_ALLOWED');
    }
    const none = resolveFleetScope(null, null);
    assert.equal(none.ok, false);
  });
});

describe('filterFleetOverviewForScope — ตัดข้อมูลนอกสาขาและคิดสรุปใหม่', () => {
  const machines = [
    view({ id: 'm-cm-1', name: 'CM-1', site: SITE.name, status: 'online', compliance: 'ok' }),
    view({ id: 'm-cm-2', name: 'CM-2', site: SITE.name, status: 'offline', compliance: 'offline' }),
    view({ id: 'm-bk-1', name: 'BK-1', site: OTHER_SITE.name, updateAvailable: true, compliance: 'update' }),
    view({ id: 'm-none', name: 'NONE', site: null, compliance: 'unverified', lanVerified: false }),
    view({ id: 'm-bk-2', name: 'BK-2', site: OTHER_SITE.name, status: 'disabled', compliance: 'disabled' }),
  ];
  const base = overview(machines);
  const scope: FleetScope = { kind: 'site', siteId: SITE.id, siteName: SITE.name };

  it('เห็นเฉพาะเครื่องของสาขาตัวเอง — สาขาอื่น/ไม่ระบุสาขา ต้องหายไป', () => {
    const out = filterFleetOverviewForScope(base, scope);
    assert.deepEqual(out.machines.map((m) => m.id), ['m-cm-1', 'm-cm-2']);
  });

  it('summary คิดจากชุดที่กรองแล้ว (ไม่รั่วตัวเลขของทั้งระบบ)', () => {
    const out = filterFleetOverviewForScope(base, scope);
    assert.equal(out.summary.total, 2);
    assert.equal(out.summary.online, 1);
    assert.equal(out.summary.offline, 1);
    assert.equal(out.summary.ok, 1);
    assert.equal(out.summary.updateAvailable, 0, 'เครื่องสาขาอื่นอัปเดตไม่เกี่ยวกับสาขานี้');
    assert.equal(out.summary.attention, 1);
  });

  it('channels นับเฉพาะเครื่องในสาขา + eligible ตาม rollout ของช่องทางนั้น', () => {
    const out = filterFleetOverviewForScope(base, scope);
    const stable = out.channels.find((c) => c.id === 'stable');
    assert.ok(stable);
    assert.equal(stable.machines, 2);
    assert.equal(stable.eligible, 2, 'rolloutPercent 100 → ทุกเครื่องในชุดมีสิทธิ์');
    assert.equal(out.channels.reduce((sum, c) => sum + c.machines, 0), 2, 'ยอดรวมช่องทางต้องเท่ากับเครื่องที่เห็น');
  });

  it('ข้อมูลระดับระบบ (policy/published/enrollment) ไม่ถูกตัดทิ้ง — แต่ machineOverrideCount ยังเป็นของเดิม', () => {
    const out = filterFleetOverviewForScope(base, scope);
    assert.equal(out.published.runner.version, 'abc');
    assert.equal(out.enrollment.usable, 2);
    assert.deepEqual(out.policy, base.policy);
  });

  it('scope = all → คืนของเดิมทั้งก้อน', () => {
    const out = filterFleetOverviewForScope(base, { kind: 'all' });
    assert.deepEqual(out.machines.map((m) => m.id), machines.map((m) => m.id));
    assert.equal(out.summary.total, machines.length);
  });

  it('สาขาที่ไม่มีเครื่องเลย → ชุดว่าง แต่ยังคืนโครงสร้างครบ', () => {
    const empty: FleetScope = { kind: 'site', siteId: OTHER_SITE.id, siteName: 'สาขาที่ยังไม่มีเครื่อง' };
    const out = filterFleetOverviewForScope(base, empty);
    assert.equal(out.machines.length, 0);
    assert.equal(out.summary.total, 0);
    assert.equal(out.channels.length, 3, 'ยังต้องมี 3 ช่องทางให้ UI วาดได้');
    assert.ok(out.channels.every((c) => c.machines === 0));
  });
});

describe('machineIdsForScope — ใช้จำกัด audit', () => {
  const machines = [
    view({ id: 'm-cm-1', name: 'CM-1', site: SITE.name }),
    view({ id: 'm-bk-1', name: 'BK-1', site: OTHER_SITE.name }),
  ];

  it('site scope → เฉพาะ id ของสาขานั้น', () => {
    const ids = machineIdsForScope(machines, { kind: 'site', siteId: SITE.id, siteName: SITE.name });
    assert.deepEqual(ids, ['m-cm-1']);
  });

  it('all → null (แปลว่าไม่ต้องกรอง)', () => {
    assert.equal(machineIdsForScope(machines, { kind: 'all' }), null);
  });

  it('สาขาว่าง → คืนอาร์เรย์ว่าง (ไม่ใช่ null ที่แปลว่าเห็นหมด)', () => {
    const ids = machineIdsForScope(machines, { kind: 'site', siteId: OTHER_SITE.id, siteName: 'ไม่มีเครื่อง' });
    assert.deepEqual(ids, []);
  });
});
