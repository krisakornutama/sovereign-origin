// src/services/fleet-policy.service.ts
//
// ── นโยบายระดับฝูงเครื่อง (Fleet Policy) ─────────────────────────────────────
// ตอบคำถามที่ระบบเดิมตอบไม่ได้:
//   • เครื่องนี้อยู่ช่องทางไหน (stable / beta / canary)
//   • ช่องทางนี้ปล่อยอัปเดตให้กี่เปอร์เซ็นต์ของเครื่อง (staged rollout)
//   • เครื่องนี้อยู่ site/group ไหน (สำหรับองค์กรที่มีหลายสาขา)
//   • เครื่องนี้ "พร้อม/ต้องอัปเดต/ถูกกัก/ออฟไลน์/ยังไม่ยืนยัน" อะไร
//
// หลักการ:
//   • deterministic: bucket ของเครื่องคำนวณจาก sha256(channel:machineId)
//     ⇒ เครื่องเดิมได้ค่าเดิมเสมอ ไม่ว่าใครเรียก / ไม่ต้องเก็บสถานะ rollout ใน DB
//   • fail-closed: ค่าแปลกปลอมถูก normalize เป็นค่าที่ปลอดภัย (stable/100)
//   • ไม่แตะ DB: เก็บใน data/fleet/policy.json (ดู fleet-store.service.ts)
import crypto from 'node:crypto';
import {
  createLock,
  fleetFile,
  isSafeKey,
  readJsonFile,
  sanitizeText,
  writeJsonAtomic,
} from './fleet-store.service';

export const FLEET_CHANNELS = ['stable', 'beta', 'canary'] as const;
export type FleetChannel = (typeof FLEET_CHANNELS)[number];

export const FLEET_CHANNEL_LABELS: Record<FleetChannel, string> = {
  stable: 'Stable',
  beta: 'Beta',
  canary: 'Canary',
};

export interface FleetChannelPolicy {
  label: string;
  /** 0–100 — เปอร์เซ็นต์ของเครื่องในช่องทางนี้ที่ได้รับอัปเดต */
  rolloutPercent: number;
}

export interface FleetMachineOverride {
  channel?: FleetChannel;
  site?: string;
  group?: string;
  tags?: string[];
  notes?: string;
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface FleetPolicy {
  version: 1;
  updatedAt: string;
  updatedBy: string | null;
  defaultChannel: FleetChannel;
  channels: Record<FleetChannel, FleetChannelPolicy>;
  requireLanVerification: boolean;
  notes: string | null;
  machines: Record<string, FleetMachineOverride>;
}

export interface FleetChannelPatch {
  rolloutPercent?: number;
}

export interface FleetPolicyPatch {
  defaultChannel?: FleetChannel;
  channels?: Partial<Record<FleetChannel, FleetChannelPatch>>;
  requireLanVerification?: boolean;
  notes?: string | null;
}

export interface FleetMachineOverrideInput {
  channel?: FleetChannel | null;
  site?: string | null;
  group?: string | null;
  tags?: string[] | null;
  notes?: string | null;
}

export type FleetComplianceState =
  | 'ok'
  | 'update'
  | 'held'
  | 'offline'
  | 'disabled'
  | 'unverified'
  | 'unknown-version';

export interface FleetComplianceInput {
  machineId: string;
  status: string;
  lastHeartbeat: Date | string | null | undefined;
  version: string | null | undefined;
  lanVerified: boolean;
  channel: FleetChannel;
  rolloutPercent: number;
  publishedVersion: string | null | undefined;
  now?: number;
  staleMs?: number;
}

export interface FleetComplianceResult {
  state: FleetComplianceState;
  reasons: string[];
  updateAvailable: boolean;
  updateEligible: boolean;
  staleSec: number | null;
}

const POLICY_FILE = 'policy.json';
const MAX_SITE = 64;
const MAX_GROUP = 64;
const MAX_NOTES = 500;
const MAX_POLICY_NOTES = 1000;
const MAX_TAGS = 12;
const MAX_TAG = 32;
const DEFAULT_STALE_MS = 90_000;

const policyLock = createLock();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isFleetChannel(value: unknown): value is FleetChannel {
  return typeof value === 'string' && (FLEET_CHANNELS as readonly string[]).includes(value);
}

function clampPercent(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    const tag = sanitizeText(item, MAX_TAG);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function normalizeOverride(raw: unknown): FleetMachineOverride {
  if (!isPlainObject(raw)) return {};
  const out: FleetMachineOverride = {};
  if (isFleetChannel(raw.channel)) out.channel = raw.channel;
  const site = sanitizeText(raw.site, MAX_SITE);
  if (site) out.site = site;
  const group = sanitizeText(raw.group, MAX_GROUP);
  if (group) out.group = group;
  const tags = normalizeTags(raw.tags);
  if (tags && tags.length) out.tags = tags;
  const notes = sanitizeText(raw.notes, MAX_NOTES);
  if (notes) out.notes = notes;
  if (typeof raw.updatedAt === 'string' && raw.updatedAt) out.updatedAt = raw.updatedAt;
  if (typeof raw.updatedBy === 'string') out.updatedBy = raw.updatedBy;
  return out;
}

export function defaultFleetPolicy(now = new Date()): FleetPolicy {
  return {
    version: 1,
    updatedAt: now.toISOString(),
    updatedBy: null,
    defaultChannel: 'stable',
    channels: {
      stable: { label: FLEET_CHANNEL_LABELS.stable, rolloutPercent: 100 },
      beta: { label: FLEET_CHANNEL_LABELS.beta, rolloutPercent: 25 },
      canary: { label: FLEET_CHANNEL_LABELS.canary, rolloutPercent: 5 },
    },
    requireLanVerification: true,
    notes: null,
    machines: {},
  };
}

/** อ่านค่าจากไฟล์แล้ว normalize — เสีย/ไม่มี = ค่าเริ่มต้น (ไม่ throw) */
export function normalizeFleetPolicy(raw: unknown, now = new Date()): FleetPolicy {
  const base = defaultFleetPolicy(now);
  if (!isPlainObject(raw)) return base;

  const channels: Record<FleetChannel, FleetChannelPolicy> = {
    stable: { ...base.channels.stable },
    beta: { ...base.channels.beta },
    canary: { ...base.channels.canary },
  };
  if (isPlainObject(raw.channels)) {
    for (const channel of FLEET_CHANNELS) {
      const row = raw.channels[channel];
      if (!isPlainObject(row)) continue;
      channels[channel] = {
        label: FLEET_CHANNEL_LABELS[channel],
        rolloutPercent: clampPercent(row.rolloutPercent, channels[channel].rolloutPercent),
      };
    }
  }

  const machines: Record<string, FleetMachineOverride> = {};
  if (isPlainObject(raw.machines)) {
    for (const [id, value] of Object.entries(raw.machines)) {
      if (!isSafeKey(id)) continue;
      const override = normalizeOverride(value);
      if (Object.keys(override).length) machines[id] = override;
    }
  }

  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : base.updatedAt,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
    defaultChannel: isFleetChannel(raw.defaultChannel) ? raw.defaultChannel : base.defaultChannel,
    channels,
    requireLanVerification: raw.requireLanVerification === false ? false : true,
    notes: sanitizeText(raw.notes, MAX_POLICY_NOTES),
    machines,
  };
}

export function readFleetPolicy(root?: string, now = new Date()): FleetPolicy {
  const raw = readJsonFile<unknown>(fleetFile(POLICY_FILE, root), null);
  // ไฟล์ยังไม่มี = ใช้ค่าเริ่มต้นและบอกว่ายังไม่เคยตั้ง (epoch) ไม่ใช่ "เพิ่งแก้เมื่อกี้"
  return normalizeFleetPolicy(raw, raw ? now : new Date(0));
}

export function writeFleetPolicy(policy: FleetPolicy, root?: string): FleetPolicy {
  const normalized = normalizeFleetPolicy(policy);
  writeJsonAtomic(fleetFile(POLICY_FILE, root), normalized);
  return normalized;
}

export type FleetPolicyValidation =
  | { ok: true; patch: FleetPolicyPatch }
  | { ok: false; error: string };

/** ตรวจ patch จาก PUT /policy — เข้มเรื่อง key แปลกปลอมเพื่อจับพิมพ์ผิด */
export function validatePolicyPatch(raw: unknown): FleetPolicyValidation {
  if (!isPlainObject(raw)) return { ok: false, error: 'body ต้องเป็น object' };
  const allowed = new Set(['defaultChannel', 'channels', 'requireLanVerification', 'notes']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { ok: false, error: `ไม่รู้จักฟิลด์ ${key}` };
  }
  if (!Object.keys(raw).length) return { ok: false, error: 'ไม่มีค่าที่จะอัปเดต' };

  const patch: FleetPolicyPatch = {};

  if (hasOwn(raw, 'defaultChannel')) {
    if (!isFleetChannel(raw.defaultChannel)) {
      return { ok: false, error: 'defaultChannel ต้องเป็น stable|beta|canary' };
    }
    patch.defaultChannel = raw.defaultChannel;
  }

  if (hasOwn(raw, 'channels')) {
    if (!isPlainObject(raw.channels)) return { ok: false, error: 'channels ต้องเป็น object' };
    const channels: Partial<Record<FleetChannel, FleetChannelPatch>> = {};
    for (const [key, value] of Object.entries(raw.channels)) {
      if (!isFleetChannel(key)) return { ok: false, error: `ไม่รู้จักช่องทาง ${key}` };
      if (!isPlainObject(value)) return { ok: false, error: `channels.${key} ต้องเป็น object` };
      for (const field of Object.keys(value)) {
        if (field !== 'rolloutPercent') {
          return { ok: false, error: `ไม่รู้จักฟิลด์ channels.${key}.${field}` };
        }
      }
      if (hasOwn(value, 'rolloutPercent')) {
        const n = Number(value.rolloutPercent);
        if (!Number.isFinite(n) || n < 0 || n > 100 || Math.round(n) !== n) {
          return { ok: false, error: `channels.${key}.rolloutPercent ต้องเป็นจำนวนเต็ม 0–100` };
        }
        channels[key] = { rolloutPercent: n };
      }
    }
    if (Object.keys(channels).length) patch.channels = channels;
  }

  if (hasOwn(raw, 'requireLanVerification')) {
    if (typeof raw.requireLanVerification !== 'boolean') {
      return { ok: false, error: 'requireLanVerification ต้องเป็น true/false' };
    }
    patch.requireLanVerification = raw.requireLanVerification;
  }

  if (hasOwn(raw, 'notes')) {
    if (raw.notes !== null && typeof raw.notes !== 'string') {
      return { ok: false, error: 'notes ต้องเป็นข้อความหรือ null' };
    }
    if (typeof raw.notes === 'string' && !raw.notes.trim()) {
      return { ok: false, error: 'notes ว่างไม่ได้ — ใช้ null เพื่อล้าง' };
    }
    if (typeof raw.notes === 'string' && raw.notes.length > MAX_POLICY_NOTES) {
      return { ok: false, error: `notes ยาวเกิน ${MAX_POLICY_NOTES} ตัวอักษร` };
    }
    patch.notes = raw.notes === null ? null : String(raw.notes);
  }

  if (!Object.keys(patch).length) return { ok: false, error: 'ไม่มีค่าที่จะอัปเดต' };
  return { ok: true, patch };
}

export function applyPolicyPatch(
  policy: FleetPolicy,
  patch: FleetPolicyPatch,
  actor: string | null,
  now = new Date(),
): FleetPolicy {
  const next: FleetPolicy = {
    ...policy,
    channels: {
      stable: { ...policy.channels.stable },
      beta: { ...policy.channels.beta },
      canary: { ...policy.channels.canary },
    },
    machines: { ...policy.machines },
    updatedAt: now.toISOString(),
    updatedBy: actor,
  };
  if (patch.defaultChannel) next.defaultChannel = patch.defaultChannel;
  if (patch.channels) {
    for (const channel of FLEET_CHANNELS) {
      const row = patch.channels[channel];
      if (row?.rolloutPercent != null) {
        next.channels[channel] = {
          label: FLEET_CHANNEL_LABELS[channel],
          rolloutPercent: clampPercent(row.rolloutPercent, next.channels[channel].rolloutPercent),
        };
      }
    }
  }
  if (patch.requireLanVerification != null) next.requireLanVerification = patch.requireLanVerification;
  if (hasOwn(patch, 'notes')) next.notes = sanitizeText(patch.notes, MAX_POLICY_NOTES);
  return next;
}

/** อัปเดตนโยบายแบบมี lock — คืนค่าที่เขียนจริง */
export async function updateFleetPolicy(
  patch: FleetPolicyPatch,
  actor: string | null,
  root?: string,
): Promise<FleetPolicy> {
  return policyLock(() => {
    const current = readFleetPolicy(root);
    const next = applyPolicyPatch(current, patch, actor);
    return writeFleetPolicy(next, root);
  });
}

export type MachineOverrideValidation =
  | { ok: true; input: FleetMachineOverrideInput }
  | { ok: false; error: string };

/** ตรวจ patch ของเครื่องหนึ่ง — null = ล้างค่านั้น */
export function validateMachineOverride(raw: unknown): MachineOverrideValidation {
  if (!isPlainObject(raw)) return { ok: false, error: 'body ต้องเป็น object' };
  const allowed = new Set(['channel', 'site', 'group', 'tags', 'notes']);
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (!allowed.has(key)) return { ok: false, error: `ไม่รู้จักฟิลด์ ${key}` };
  }
  if (!keys.length) return { ok: false, error: 'ไม่มีค่าที่จะอัปเดต' };

  const input: FleetMachineOverrideInput = {};
  if (hasOwn(raw, 'channel')) {
    if (raw.channel !== null && !isFleetChannel(raw.channel)) {
      return { ok: false, error: 'channel ต้องเป็น stable|beta|canary หรือ null' };
    }
    input.channel = raw.channel === null ? null : (raw.channel as FleetChannel);
  }
  for (const field of ['site', 'group'] as const) {
    if (!hasOwn(raw, field)) continue;
    if (raw[field] !== null && typeof raw[field] !== 'string') {
      return { ok: false, error: `${field} ต้องเป็นข้อความหรือ null` };
    }
    if (typeof raw[field] === 'string' && raw[field].length > (field === 'site' ? MAX_SITE : MAX_GROUP)) {
      return { ok: false, error: `${field} ยาวเกิน ${field === 'site' ? MAX_SITE : MAX_GROUP} ตัวอักษร` };
    }
    input[field] = raw[field] === null ? null : String(raw[field]);
  }
  if (hasOwn(raw, 'tags')) {
    if (raw.tags !== null && !Array.isArray(raw.tags)) {
      return { ok: false, error: 'tags ต้องเป็น array หรือ null' };
    }
    if (Array.isArray(raw.tags)) {
      if (raw.tags.length > MAX_TAGS) return { ok: false, error: `tags เกิน ${MAX_TAGS} รายการ` };
      const tags: string[] = [];
      for (const tag of raw.tags) {
        const clean = sanitizeText(tag, MAX_TAG);
        if (!clean) return { ok: false, error: 'tag ว่างหรือยาวเกินกำหนด' };
        if (!tags.includes(clean)) tags.push(clean);
      }
      input.tags = tags;
    } else {
      input.tags = null;
    }
  }
  if (hasOwn(raw, 'notes')) {
    if (raw.notes !== null && typeof raw.notes !== 'string') {
      return { ok: false, error: 'notes ต้องเป็นข้อความหรือ null' };
    }
    if (typeof raw.notes === 'string' && raw.notes.length > MAX_NOTES) {
      return { ok: false, error: `notes ยาวเกิน ${MAX_NOTES} ตัวอักษร` };
    }
    input.notes = raw.notes === null ? null : String(raw.notes);
  }
  return { ok: true, input };
}

export function applyMachineOverride(
  policy: FleetPolicy,
  machineId: string,
  input: FleetMachineOverrideInput,
  actor: string | null,
  now = new Date(),
): { policy: FleetPolicy; override: FleetMachineOverride | null } {
  const next: FleetPolicy = {
    ...policy,
    channels: { ...policy.channels },
    machines: { ...policy.machines },
    updatedAt: now.toISOString(),
    updatedBy: actor,
  };
  const current: FleetMachineOverride = { ...(policy.machines[machineId] ?? {}) };

  if (hasOwn(input, 'channel')) {
    if (input.channel) current.channel = input.channel;
    else delete current.channel;
  }
  if (hasOwn(input, 'site')) {
    if (input.site) current.site = sanitizeText(input.site, MAX_SITE) ?? undefined;
    else delete current.site;
  }
  if (hasOwn(input, 'group')) {
    if (input.group) current.group = sanitizeText(input.group, MAX_GROUP) ?? undefined;
    else delete current.group;
  }
  if (hasOwn(input, 'tags')) {
    if (input.tags && input.tags.length) current.tags = Array.from(new Set(input.tags));
    else delete current.tags;
  }
  if (hasOwn(input, 'notes')) {
    const notes = sanitizeText(input.notes, MAX_NOTES);
    if (notes) current.notes = notes;
    else delete current.notes;
  }

  const meaningful =
    Boolean(current.channel) ||
    Boolean(current.site) ||
    Boolean(current.group) ||
    Boolean(current.tags?.length) ||
    Boolean(current.notes);
  if (!meaningful) {
    delete next.machines[machineId];
    return { policy: next, override: null };
  }
  current.updatedAt = now.toISOString();
  current.updatedBy = actor;
  next.machines[machineId] = current;
  return { policy: next, override: current };
}

/** ตั้ง override ของเครื่องแบบมี lock */
export async function setMachineOverride(
  machineId: string,
  input: FleetMachineOverrideInput,
  actor: string | null,
  root?: string,
): Promise<{ policy: FleetPolicy; override: FleetMachineOverride | null }> {
  return policyLock(() => {
    const current = readFleetPolicy(root);
    const out = applyMachineOverride(current, machineId, input, actor);
    const written = writeFleetPolicy(out.policy, root);
    return { policy: written, override: out.override };
  });
}

/** ช่องทางที่มีผลกับเครื่องนี้ + ที่มา (override หรือ default) */
export function channelForMachine(
  policy: FleetPolicy,
  machineId: string,
): { channel: FleetChannel; source: 'override' | 'default' } {
  const override = policy.machines[machineId];
  if (override?.channel && isFleetChannel(override.channel)) {
    return { channel: override.channel, source: 'override' };
  }
  return { channel: policy.defaultChannel, source: 'default' };
}

/**
 * bucket 0–99 ของเครื่องในช่องทางหนึ่ง — deterministic
 * ใช้ sha256(channel:machineId) ไม่ใช้ Math.random ⇒ เครื่องเดิมอยู่กลุ่มเดิมตลอด
 */
export function rolloutBucket(machineId: string, channel: FleetChannel): number {
  const digest = crypto.createHash('sha256').update(`${channel}:${machineId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function isRolloutEligible(machineId: string, channel: FleetChannel, rolloutPercent: number): boolean {
  if (rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0) return false;
  return rolloutBucket(machineId, channel) < rolloutPercent;
}

export interface FleetUpdateGateDecision {
  allowed: boolean;
  channel: FleetChannel;
  rolloutPercent: number;
  reason: 'ok' | 'machine_disabled' | 'rollout_hold';
}

/**
 * ตัดสินว่าเครื่องนี้ควรได้รับชุดอัปเดตหรือไม่ — pure function
 * ใช้ทั้งใน route manifest/asset และเทสต์ (ไม่ต้องมี DB/Express)
 */
export function decideUpdateGate(
  machine: { id: string; status?: string | null },
  policy: FleetPolicy,
): FleetUpdateGateDecision {
  const { channel } = channelForMachine(policy, machine.id);
  const rolloutPercent = policy.channels[channel].rolloutPercent;
  if (machine.status === 'disabled') {
    return { allowed: false, channel, rolloutPercent, reason: 'machine_disabled' };
  }
  if (!isRolloutEligible(machine.id, channel, rolloutPercent)) {
    return { allowed: false, channel, rolloutPercent, reason: 'rollout_hold' };
  }
  return { allowed: true, channel, rolloutPercent, reason: 'ok' };
}

/**
 * ประเมินสถานะเครื่องสำหรับหน้า Fleet — pure function (ทดสอบได้ไม่ต้องมี DB)
 * ลำดับความสำคัญ: disabled → offline → ยังไม่ยืนยัน LAN → version → rollout
 */
export function evaluateMachineCompliance(input: FleetComplianceInput): FleetComplianceResult {
  const now = input.now ?? Date.now();
  const staleMs = input.staleMs ?? DEFAULT_STALE_MS;
  const at = input.lastHeartbeat ? new Date(input.lastHeartbeat).getTime() : NaN;
  const staleSec = Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 1000)) : null;
  const published = String(input.publishedVersion ?? '').trim();
  const current = String(input.version ?? '').trim();
  const updateAvailable = Boolean(published) && current !== published;
  const updateEligible =
    updateAvailable && isRolloutEligible(input.machineId, input.channel, input.rolloutPercent);

  if (input.status === 'disabled') {
    return { state: 'disabled', reasons: ['disabled'], updateAvailable, updateEligible, staleSec };
  }
  if (!Number.isFinite(at) || now - at > staleMs) {
    return { state: 'offline', reasons: ['heartbeat_stale'], updateAvailable, updateEligible, staleSec };
  }
  if (!input.lanVerified) {
    return { state: 'unverified', reasons: ['lan_not_verified'], updateAvailable, updateEligible, staleSec };
  }
  if (published && !current) {
    return {
      state: 'unknown-version',
      reasons: ['version_unknown'],
      updateAvailable: true,
      updateEligible,
      staleSec,
    };
  }
  if (updateAvailable) {
    return {
      state: updateEligible ? 'update' : 'held',
      reasons: [updateEligible ? 'update_available' : 'rollout_hold'],
      updateAvailable,
      updateEligible,
      staleSec,
    };
  }
  return { state: 'ok', reasons: [], updateAvailable: false, updateEligible: false, staleSec };
}

/** มุมมองนโยบายสำหรับ client — ไม่ส่ง override ทั้งก้อน (เครื่องแต่ละแถวมีอยู่แล้ว) */
export function fleetPolicyForClient(policy: FleetPolicy) {
  const { machines, ...rest } = policy;
  return { ...rest, machineOverrideCount: Object.keys(machines).length };
}
