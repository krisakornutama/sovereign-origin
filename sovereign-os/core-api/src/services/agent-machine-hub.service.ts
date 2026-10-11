// src/services/agent-machine-hub.service.ts
//
// ชั้นที่อ่าน/เขียน DB สำหรับกติกา "ใครคุมเครื่องไหนได้" — เจ้าของสั่ง 11/10/69
//
// แยกจาก machine-access.service.ts เป็นโดยตั้งใจ:
//   - machine-access = ตัดสินใจล้วน (pure) เทสต์ได้เร็ว ไม่ต้องมี DB
//   - ไฟล์นี้ = ต่อฐานข้อมูล + ตัดสินใจด้วย ใช้ใน route เท่านั้น
//
// ข้อ 2 (เครื่องอยู่ใต้ SUPERADMIN ได้หลายคน) ทำด้วยตาราง agent_machine_hubs
// ที่ผูกได้ทั้งสองทาง — เครื่องหนึ่งมีผู้ใช้หลายคน, ผู้ใช้หนึ่งคุมหลายเครื่อง
import crypto from 'crypto';
import { prisma } from './agent-machines.service';
import {
  MACHINE_ROLES,
  normalizeRole,
  isLanVerified,
  listControllableMachines,
  makePairCode,
  decidePairApproval,
  type MachineWithHubs,
} from './machine-access.service';

/** sha256 ของรหัสคู่ — เก็บแฮชเหมือน machine token ไม่เก็บรหัสจริงลง DB */
export function hashPairCode(code: string): string {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

export interface MachineWithAccess extends MachineWithHubs {
  id: string;
  name: string;
  role: string;
  lanVerified: boolean;
  ownerUserId: string | null;
  hubUserIds: string[];
  status: string;
  version: string | null;
  lastHeartbeat: Date | null;
}

/** แปลงแถวจาก DB → รูปแบบที่ชั้นตัดสินใจใช้ */
function toAccess(row: {
  id: string; name: string; role?: string | null; lan_confirmed_at?: Date | null;
  owner_user_id?: string | null; status?: string | null; version?: string | null;
  last_heartbeat?: Date | null; hub_users?: { user_id: string }[];
}): MachineWithAccess {
  return {
    id: row.id,
    name: row.name,
    role: normalizeRole(row.role),
    lanVerified: row.lan_confirmed_at != null,
    ownerUserId: row.owner_user_id ?? null,
    hubUserIds: (row.hub_users ?? []).map((h) => h.user_id),
    status: row.status ?? 'offline',
    version: row.version ?? null,
    lastHeartbeat: row.last_heartbeat ?? null,
  };
}

const WITH_HUBS = { hub_users: { select: { user_id: true } } } as const;

/** ทุกเครื่องพร้อมผู้ใช้ที่ผูก (ใช้คำนวณสิทธิ์ฝั่ง server — ห้ามเชื่อค่าที่ส่งมาจาก client) */
export async function listMachinesWithAccess(): Promise<MachineWithAccess[]> {
  const rows = await prisma.agentMachine.findMany({ include: WITH_HUBS, orderBy: { created_at: 'asc' } });
  return rows.map(toAccess);
}

/** เครื่องเดียว + ผู้ใช้ที่ผูก (null = ไม่พบ) */
export async function getMachineWithAccess(machineId: string): Promise<MachineWithAccess | null> {
  const row = await prisma.agentMachine.findUnique({ where: { id: machineId }, include: WITH_HUBS });
  return row ? toAccess(row) : null;
}

/**
 * ข้อ 2 + 3: เครื่องที่ผู้ใช้คนนี้คุมได้จริง
 * fail-closed: ยังไม่ยืนยัน LAN = ไม่โผล่ในรายการ
 */
export async function listMachinesForUser(userId: string): Promise<MachineWithAccess[]> {
  const all = await listMachinesWithAccess();
  const allowed = listControllableMachines(userId, all as unknown as MachineWithHubs[]);
  const allowedIds = new Set(allowed.map((m) => m.id));
  return all.filter((m) => allowedIds.has(m.id));
}

/** ผู้ใช้คนนี้คุมเครื่องนี้ได้ไหม — ใช้เป็นด่านในทุก route ที่สั่งควบคุม */
export async function userCanControl(userId: string, machineId: string): Promise<boolean> {
  const machine = await getMachineWithAccess(machineId);
  if (!machine) return false;
  const allowed = listControllableMachines(userId, [machine] as unknown as MachineWithHubs[]);
  return allowed.length > 0;
}

/**
 * ช่องควบคุมของเครื่องที่ผู้ใช้คนนี้คุมได้เท่านั้น
 * ใช้ใน GET /machine-control/state — SUPERADMIN คนหนึ่งต้องไม่เห็นช่องของเครื่องที่ไม่ใช่ของเขา
 * @param allChannels ผล controlState() เดิม (array ที่มี machineId)
 */
export async function controlStateForUser(
  userId: string,
  allChannels: readonly { machineId?: string }[],
): Promise<typeof allChannels> {
  const mine = await listMachinesForUser(userId);
  const ids = new Set(mine.map((m) => m.id));
  return (allChannels || []).filter((ch) => !!ch.machineId && ids.has(ch.machineId));
}

// ─────────────────────────────────────────────────────────────
//  ผูก/ถอดเครื่องออกจากผู้ใช้ (หลายคนได้ — ข้อ 2)
// ─────────────────────────────────────────────────────────────

/** ผูกเครื่องให้อยู่ใต้ผู้ใช้ (ทำซ้ำได้ ไม่ error) */
export async function linkMachineToUser(machineId: string, userId: string): Promise<void> {
  await prisma.agentMachineHub.upsert({
    where: { machine_id_user_id: { machine_id: machineId, user_id: userId } },
    create: { machine_id: machineId, user_id: userId },
    update: {},
  });
}

/** ถอดเครื่องออกจากผู้ใช้คนหนึ่ง (คนอื่นยังคุมได้ต่อ — หลายคนคุมเครื่องเดียวกันได้) */
export async function unlinkMachineFromUser(machineId: string, userId: string): Promise<boolean> {
  const r = await prisma.agentMachineHub.deleteMany({ where: { machine_id: machineId, user_id: userId } });
  return r.count > 0;
}

/** ผูกกลับ: ผู้ใช้นี้คุมเครื่องไหนบ้าง (จากฝั่งผู้ใช้) */
export async function listUserIdsForMachine(machineId: string): Promise<string[]> {
  const rows = await prisma.agentMachineHub.findMany({ where: { machine_id: machineId }, select: { user_id: true } });
  return rows.map((r) => r.user_id);
}

// ─────────────────────────────────────────────────────────────
//  บทบาทของเครื่อง (HUB/USER)
// ─────────────────────────────────────────────────────────────

/**
 * เลื่อนเครื่องเป็น HUB หรือลดกลับเป็น USER
 * ค่าแปลกปลอม = USER เสมอ (fail-closed) — พิมพ์ผิดแล้วเครื่องหลุดสิทธิ์ ไม่ใช่หลุดเป็น HUB
 */
export async function setMachineRole(machineId: string, role: string): Promise<MachineWithAccess> {
  const next = normalizeRole(role);
  await prisma.agentMachine.update({ where: { id: machineId }, data: { role: next } });
  const machine = await getMachineWithAccess(machineId);
  if (!machine) throw new Error('machine not found');
  return machine;
}

/** ตั้งเจ้าของเครื่อง (คนที่กดผูก) — แยกจาก hub_users เพราะคนละความหมาย */
export async function setMachineOwner(machineId: string, userId: string | null): Promise<void> {
  await prisma.agentMachine.update({ where: { id: machineId }, data: { owner_user_id: userId || null } });
}

// ─────────────────────────────────────────────────────────────
//  ข้อ 3 — ยืนยัน "อยู่ LAN เดียวกัน" ด้วยการกดบนเครื่องเป้าหมาย
// ─────────────────────────────────────────────────────────────

/**
 * รอบที่ 1: เจ้าของเครื่องกด "ขอคู่" → ได้รหัส 6 หลักไปแสดงบนหน้าจอเครื่องนั้น
 * เก็บแค่ hash — รหัสจริงอยู่ในคำตอบครั้งเดียว
 */
export async function requestPairing(machineId: string, userId: string): Promise<{ code: string; machine: MachineWithAccess }> {
  const code = makePairCode();
  await prisma.agentMachine.update({
    where: { id: machineId },
    data: { pair_code_hash: hashPairCode(code), pair_code_at: new Date() },
  });
  // ผูกให้อยู่ใต้ผู้ใช้ที่กดขอ (ยังไม่ยืนยัน = ยังคุมไม่ได้ รอข้อ 3)
  await linkMachineToUser(machineId, userId);
  const machine = await getMachineWithAccess(machineId);
  if (!machine) throw new Error('machine not found');
  return { code, machine };
}

/**
 * รอบที่ 2: เครื่องเป้าหมายพิมพ์รหัสกลับมายืนยัน
 * @param approve false = เจ้าของเครื่องกด "ไม่ใช่เครื่องผม"
 */
export async function confirmPairing(
  machineId: string,
  input: { code?: string | null; approve?: boolean },
): Promise<{ approved: boolean; lanVerified: boolean; reason?: string }> {
  const row = await prisma.agentMachine.findUnique({ where: { id: machineId } });
  if (!row) return { approved: false, lanVerified: false, reason: 'ไม่พบเครื่อง' };

  // ยังไม่มีคำขอค้าง = ยืนยันไม่ได้ (ไม่ใช่ "เริ่มคู่ใหม่" — กันเดารหัสเอง)
  if (!row.pair_code_hash) {
    return { approved: false, lanVerified: false, reason: 'ยังไม่มีคำขอคู่ที่ค้างอยู่' };
  }
  if (input.approve === false) {
    await prisma.agentMachine.update({ where: { id: machineId }, data: { pair_code_hash: null, pair_code_at: null } });
    return { approved: false, lanVerified: false, reason: 'เจ้าของเครื่องปฏิเสธ' };
  }

  const given = String(input.code ?? '').trim();
  const ok = /^\d{6}$/.test(given) && hashPairCode(given) === row.pair_code_hash;
  if (!ok) {
    return { approved: false, lanVerified: false, reason: 'รหัสคู่ไม่ถูกต้อง' };
  }

  // ผ่านแล้ว: ยืนยัน LAN + ล้างรหัส (ใช้ครั้งเดียว)
  await prisma.agentMachine.update({
    where: { id: machineId },
    data: { lan_confirmed_at: new Date(), pair_code_hash: null, pair_code_at: null },
  });
  return { approved: true, lanVerified: true };
}

/** เจ้าของเครื่องถอนการยืนยัน (กดผิดไป) — คุมไม่ได้ทันที */
export async function revokeLanPairing(machineId: string): Promise<void> {
  await prisma.agentMachine.update({
    where: { id: machineId },
    data: { lan_confirmed_at: null, pair_code_hash: null, pair_code_at: null },
  });
}

export { MACHINE_ROLES, isLanVerified };