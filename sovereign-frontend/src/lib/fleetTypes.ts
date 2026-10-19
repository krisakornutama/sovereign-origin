// src/lib/fleetTypes.ts
//
// ชนิดข้อมูล + ตัวช่วยแสดงผลของหน้า Fleet
// แยกออกจาก pages/fleet.tsx เพื่อให้แต่ละ component อยู่ในเพดานบรรทัดของ frontend-gate
// (pages ≤ 800 / components ≤ 400) และให้หน้าเพจอ่านง่าย

export type Channel = "stable" | "beta" | "canary";
export type Compliance =
  | "ok"
  | "update"
  | "held"
  | "offline"
  | "disabled"
  | "unverified"
  | "unknown-version";

export interface ChannelPolicy {
  label: string;
  rolloutPercent: number;
}

export interface FleetPolicyView {
  version: 1;
  updatedAt: string;
  updatedBy: string | null;
  defaultChannel: Channel;
  channels: Record<Channel, ChannelPolicy>;
  requireLanVerification: boolean;
  notes: string | null;
  machineOverrideCount: number;
}

export interface FleetMachine {
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
  channel: Channel;
  channelSource: "override" | "default";
  rolloutPercent: number;
  rolloutBucket: number;
  site: string | null;
  group: string | null;
  tags: string[];
  overrideNotes: string | null;
  updateAvailable: boolean;
  updateEligible: boolean;
  compliance: Compliance;
  reasons: string[];
}

export interface FleetOverview {
  generatedAt: string;
  policy: FleetPolicyView;
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
    id: Channel;
    label: string;
    rolloutPercent: number;
    machines: number;
    eligible: number;
  }>;
  enrollment: { total: number; usable: number; exhausted: number; expired: number; revoked: number };
  published: {
    runner: { published: boolean; version: string | null; generatedAt: string | null; files: number };
    desktop: { published: boolean; version: string | null; generatedAt: string | null; asset: string | null };
    nodeKit: { published: boolean; version: string | null; generatedAt: string | null; asset: string | null };
  };
  machines: FleetMachine[];
}

export interface EnrollToken {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
  usesRemaining: number;
  lastUsedAt: string | null;
  lastMachineId: string | null;
  lastMachineName: string | null;
  revokedAt: string | null;
  expired: boolean;
  usable: boolean;
}

export interface MachineOverrideInput {
  site: string | null;
  group: string | null;
  tags: string[] | null;
  notes: string | null;
}

export const CHANNELS: Channel[] = ["stable", "beta", "canary"];

export const CHANNEL_COPY: Record<Channel, { th: string; hint: string }> = {
  stable: { th: "Stable", hint: "เครื่องใช้งานจริงส่วนใหญ่" },
  beta: { th: "Beta", hint: "ทดสอบก่อนปล่อยจริง" },
  canary: { th: "Canary", hint: "เครื่องนำร่องจำนวนน้อย" },
};

export function complianceView(state: Compliance): {
  label: string;
  variant: "ok" | "warn" | "err" | "off";
} {
  switch (state) {
    case "ok":
      return { label: "ปกติ", variant: "ok" };
    case "update":
      return { label: "ควรอัปเดต", variant: "warn" };
    case "held":
      return { label: "ถูกกักตาม rollout", variant: "warn" };
    case "offline":
      return { label: "ออฟไลน์", variant: "off" };
    case "disabled":
      return { label: "ปิดใช้งาน", variant: "off" };
    case "unverified":
      return { label: "ยังไม่ยืนยัน LAN", variant: "warn" };
    case "unknown-version":
      return { label: "ไม่ทราบเวอร์ชัน", variant: "warn" };
    default:
      return { label: state, variant: "off" };
  }
}

export function statusView(m: FleetMachine): { label: string; variant: "ok" | "warn" | "err" | "off" } {
  if (m.status === "online") return { label: "ออนไลน์", variant: "ok" };
  if (m.status === "disabled") return { label: "ปิดใช้งาน", variant: "err" };
  return { label: "ออฟไลน์", variant: "off" };
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || at <= 0) return "ยังไม่เคยตั้ง";
  return new Date(at).toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ago(sec: number | null): string {
  if (sec == null) return "ยังไม่เคยส่งสัญญาณ";
  if (sec < 60) return `${sec} วินาทีที่แล้ว`;
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`;
  return `${Math.floor(sec / 86400)} วันที่แล้ว`;
}
