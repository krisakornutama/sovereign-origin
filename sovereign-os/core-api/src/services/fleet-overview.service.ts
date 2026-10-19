// src/services/fleet-overview.service.ts
//
// ── ประกอบภาพรวมฝูงเครื่องสำหรับหน้า Fleet ────────────────────────────────
// อ่านจากแหล่งเดิมทั้งหมด (ไม่สร้างสำเนาข้อมูล):
//   • เครื่อง + heartbeat + version        → agent-machines.service (DB)
//   • นโยบายช่องทาง / site / group        → fleet-policy.service (ไฟล์)
//   • รหัสเชิญที่ยังใช้ได้                 → fleet-enrollment.service (ไฟล์)
//   • เวอร์ชันที่เผยแพร่จริง               → agent-update / desktop-update / node-kit
//
// จุดสำคัญ: ห้ามส่ง token_hash ออกไปเด็ดขาด — จึงคัดฟิลด์ทีละตัว
// (ของเดิม GET /api/agent-machines ส่ง row ทั้งก้อนรวม token_hash ซึ่งไม่ควรทำ)
import {
  listMachines,
  type MachineRow,
} from './agent-machines.service';
import {
  channelForMachine,
  evaluateMachineCompliance,
  fleetPolicyForClient,
  isRolloutEligible,
  readFleetPolicy,
  rolloutBucket,
  type FleetChannel,
  type FleetComplianceState,
} from './fleet-policy.service';
import { enrollTokenSummary, type EnrollTokenSummary } from './fleet-enrollment.service';
import { readUpdateManifest } from './agent-update.service';
import { readDesktopManifest } from './desktop-update.service';
import { readNodeKitManifest } from './node-kit.service';

export interface FleetMachineView {
  id: string;
  name: string;
  os: string;
  role: string | null;
  status: string;
  version: string | null;
  lastHeartbeat: string | null;
  staleSec: number | null;
  note: string | null;
  lanVerified: boolean;
  capabilities: string[];
  executors: string[];
  channel: FleetChannel;
  channelSource: 'override' | 'default';
  rolloutPercent: number;
  rolloutBucket: number;
  site: string | null;
  group: string | null;
  tags: string[];
  overrideNotes: string | null;
  updateAvailable: boolean;
  updateEligible: boolean;
  compliance: FleetComplianceState;
  reasons: string[];
}

export interface FleetOverview {
  generatedAt: string;
  policy: ReturnType<typeof fleetPolicyForClient>;
  summary: {
    total: number;
    online: number;
    offline: number;
    disabled: number;
    unverified: number;
    ok: number;
    updateAvailable: number;
    updateEligible: number;
    held: number;
    unknownVersion: number;
    attention: number;
  };
  channels: Array<{
    id: FleetChannel;
    label: string;
    rolloutPercent: number;
    machines: number;
    eligible: number;
  }>;
  enrollment: EnrollTokenSummary;
  published: {
    runner: { published: boolean; version: string | null; generatedAt: string | null; files: number };
    desktop: { published: boolean; version: string | null; generatedAt: string | null; asset: string | null };
    nodeKit: { published: boolean; version: string | null; generatedAt: string | null; asset: string | null };
  };
  machines: FleetMachineView[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, 32);
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const at = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function toView(
  row: MachineRow,
  policy: ReturnType<typeof readFleetPolicy>,
  now: number,
  publishedVersion: string | null,
): FleetMachineView {
  const { channel, source } = channelForMachine(policy, row.id);
  const channelPolicy = policy.channels[channel];
  const override = policy.machines[row.id] ?? {};
  const compliance = evaluateMachineCompliance({
    machineId: row.id,
    status: String(row.status ?? 'offline'),
    lastHeartbeat: row.last_heartbeat,
    version: row.version,
    lanVerified: Boolean(row.lan_confirmed_at),
    channel,
    rolloutPercent: channelPolicy.rolloutPercent,
    publishedVersion,
    now,
  });

  return {
    id: row.id,
    name: row.name,
    os: row.os ?? 'unknown',
    role: row.role ?? null,
    status: String(row.status ?? 'offline'),
    version: row.version ?? null,
    lastHeartbeat: iso(row.last_heartbeat),
    staleSec: compliance.staleSec,
    note: row.note ?? null,
    lanVerified: Boolean(row.lan_confirmed_at),
    capabilities: asStringArray(row.capabilities),
    executors: asStringArray(row.executors),
    channel,
    channelSource: source,
    rolloutPercent: channelPolicy.rolloutPercent,
    rolloutBucket: rolloutBucket(row.id, channel),
    site: override.site ?? null,
    group: override.group ?? null,
    tags: Array.isArray(override.tags) ? override.tags : [],
    overrideNotes: override.notes ?? null,
    updateAvailable: compliance.updateAvailable,
    updateEligible: compliance.updateEligible,
    compliance: compliance.state,
    reasons: compliance.reasons,
  };
}

export async function buildFleetOverview(now = Date.now()): Promise<FleetOverview> {
  const [machines, policy] = await Promise.all([listMachines(), Promise.resolve(readFleetPolicy())]);
  const runner = readUpdateManifest();
  const desktop = readDesktopManifest();
  const nodeKit = readNodeKitManifest();
  const runnerVersion = runner?.version ?? null;

  const views = machines.map((row) => toView(row, policy, now, runnerVersion));

  const summary = {
    total: views.length,
    online: views.filter((m) => m.status === 'online').length,
    offline: views.filter((m) => m.status === 'offline').length,
    disabled: views.filter((m) => m.status === 'disabled').length,
    unverified: views.filter((m) => !m.lanVerified && m.status !== 'disabled').length,
    ok: views.filter((m) => m.compliance === 'ok').length,
    updateAvailable: views.filter((m) => m.updateAvailable).length,
    updateEligible: views.filter((m) => m.updateAvailable && m.updateEligible).length,
    held: views.filter((m) => m.compliance === 'held').length,
    unknownVersion: views.filter((m) => m.compliance === 'unknown-version').length,
    attention: views.filter((m) => !['ok', 'disabled'].includes(m.compliance)).length,
  };

  const channels = (['stable', 'beta', 'canary'] as FleetChannel[]).map((id) => {
    const row = policy.channels[id];
    const inChannel = views.filter((m) => m.channel === id);
    return {
      id,
      label: row.label,
      rolloutPercent: row.rolloutPercent,
      machines: inChannel.length,
      eligible: inChannel.filter((m) => isRolloutEligible(m.id, id, row.rolloutPercent)).length,
    };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    policy: fleetPolicyForClient(policy),
    summary,
    channels,
    enrollment: enrollTokenSummary(undefined, now),
    published: {
      runner: {
        published: Boolean(runner),
        version: runner?.version ?? null,
        generatedAt: runner?.generatedAt ?? null,
        files: runner?.files?.length ?? 0,
      },
      desktop: {
        published: Boolean(desktop),
        version: desktop?.version ?? null,
        generatedAt: desktop?.generatedAt ?? null,
        asset: desktop?.asset?.name ?? null,
      },
      nodeKit: {
        published: Boolean(nodeKit),
        version: nodeKit?.version ?? null,
        generatedAt: nodeKit?.generatedAt ?? null,
        asset: nodeKit?.asset?.name ?? null,
      },
    },
    machines: views,
  };
}
