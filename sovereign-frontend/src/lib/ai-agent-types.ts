// ── Types + ค่าคงที่ + ฟังก์ชันฟอร์แมตของหน้า AI Agent ──
// ย้ายจาก pages/ai-agent.tsx ตามเดิมทุกบรรทัด (FE-005) — ห้ามแก้ค่า/ข้อความ/รูปแบบโดยตรง
import { fmtLocale } from './formatDate';

export type AutonomyLevel = 'view' | 'suggest' | 'autonomous';
export type ToolKind = 'read-only' | 'action';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AiToolInfo {
  name: string;
  kind: ToolKind;
  description: string;
  available: boolean;
}

export interface AiPolicy {
  autonomy: AutonomyLevel;
  approvalTtlMs: number;
  protectedIps: string[];
  protectedProcesses: string[];
  tools: AiToolInfo[];
}

export interface Approval {
  id: string;
  tool: string;
  args: any;
  reason: string;
  createdAt: number;
  status: ApprovalStatus;
  result?: string;
  decidedAt?: number;
}

export interface AiStatus {
  ollamaOnline: boolean;
  ollamaUrl: string;
  currentModel: string;
  models: Array<{ name: string; size: string }>;
  resources: {
    cpuCores: number;
    cpuUsagePercent: number | null;
    memoryTotalGb: number;
    memoryFreeGb: number;
    memoryUsedPercent: number | null;
  };
  uptimeSeconds: number;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export const AUTONOMY_META: Record<AutonomyLevel, { label: string; desc: string; color: string; active: string }> = {
  view: {
    label: 'ดูอย่างเดียว',
    desc: 'AI อ่านข้อมูลได้อย่างเดียว — คำสั่ง action (blockIP / unblockIP / killProcess) ถูกปิดทั้งหมด',
    color: 'text-gray-400 border-gray-600',
    active: 'bg-gray-600 text-white',
  },
  suggest: {
    label: 'แนะนำ + ขออนุมัติ',
    desc: 'AI เสนอคำสั่ง action แล้วรอ Superadmin อนุมัติก่อนดำเนินการ (ค่าเริ่มต้น)',
    color: 'text-amber-300 border-amber-600',
    active: 'bg-amber-600 text-white',
  },
  autonomous: {
    label: 'ลงมือเอง',
    desc: 'AI ดำเนินการ action ทันที — ระบบยัง guard คำสั่งวิกฤตเสมอ (ห้าม block IP ตัวเอง / kill process ระบบ)',
    color: 'text-emerald-400 border-emerald-600',
    active: 'bg-green-600 text-white',
  },
};

export function fmtTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString(fmtLocale());
}

export function fmtArgs(args: any): string {
  if (!args || Object.keys(args).length === 0) return '{}';
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
