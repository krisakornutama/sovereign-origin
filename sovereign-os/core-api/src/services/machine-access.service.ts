// src/services/machine-access.service.ts
//
// กติกา "ใครคุมเครื่องไหนได้" — เจ้าของสั่ง 11/10/69 ชัดเจนด้วยคำพูด 3 ข้อ:
//
//   1) เครื่องที่เป็นผู้ใช้ธรรมดา "สั่งงาน AI ได้" แต่ "คุมเครื่องอื่นไม่ได้"
//      ⇒ role ของ *เครื่อง* (ไม่ใช่ของคน) คือตัวตัดสิน ไม่ใช่ role ของผู้ใช้ที่ล็อกอิน
//
//   2) เครื่องหนึ่งอยู่ใต้ SUPERADMIN ได้หลายคน (เจ้าของบอกว่ามีได้ 1–2 คน)
//      ⇒ ความสัมพันธ์เป็น many-to-many (ตาราง agent_machine_hubs) ไม่ใช่ parent_id เดียว
//
//   3) การยืนยัน "อยู่ LAN เดียวกัน" ต้อง "กดยืนยันบนเครื่องเป้าหมาย"
//      ⇒ ดู IP อย่างเดียวไม่พอ เครื่องต้องส่งรหัสมายืนยันเองก่อนจึงคุมได้จริง
//
// ── หลักการที่ฝังไว้ตั้งแต่แรก ────────────────────────────────────
// • เครื่องใหม่ทุกเครื่องเริ่มเป็น USER ไม่ใช่ HUB — ไม่มีทางที่เครื่องที่เพิ่งลงทะเบียน
//   จะกลายเป็นผู้คุมคนอื่นเอง ต้องให้ SUPERADMIN อัปเกรดอย่างเดียว
// • ค่าแปลกปลอม (role ที่ไม่รู้จัก / ไม่มีฟิลด์ / ยังไม่ยืนยัน) = ปฏิเสธ — fail-closed
//   ดีกว่า fail-open: ค่าที่ไม่รู้จักต้องไม่ให้สิทธิ์ ไม่ใช่ให้สิทธิ์เต็ม
// • ชั้นนี้เป็น "ตัดสินใจล้วน" ไม่แตะ DB ⇒ เทสต์ได้เร็ว ไม่ต้องมีฐานข้อมูล
//   (ชั้นที่อ่าน/เขียน DB อยู่ที่ agent-machine-hub.service.ts)

/** บทบาทของเครื่อง — ต่างจาก role ของผู้ใช้ที่ล็อกอิน */
export const MACHINE_ROLES = {
  /** คุมเครื่องอื่นได้ (หัวใจ: "ทุกเครื่องที่เป็น superadmin เป็น hub ได้") */
  HUB: 'HUB',
  /** รับคำสั่งได้ · สั่งงาน AI ได้ · คุมใครไม่ได้ */
  USER: 'USER',
  /** เครื่องใหม่เริ่มต้นเป็น USER เสมอ — กันช่องโหว่ตอนลงทะเบียน */
  DEFAULT: 'USER' as const,
} as const;

export type MachineRole = 'HUB' | 'USER';

/** สถานะที่รับคำสั่งได้ */
const COMMANDABLE_STATUSES = new Set(['online', 'offline']);

/** รหัสคู่เครื่อง: 6 หลัก (อ่านง่าย/พิมพ์ได้บนมือถือ ไม่ต้องแวนต่นแบบยาว) */
const PAIR_CODE_LENGTH = 6;

export interface MachineAccess {
  id: string;
  name?: string;
  /** role ของเครื่อง — undefined/แปลกปลอม = USER */
  role?: string | null;
  /** ผ่านการกดยืนยันบนตัวเครื่องแล้วหรือยัง (ข้อ 3) */
  lanVerified?: boolean | null;
  /** สถานะจากระบบ — disabled = เจ้าของสั่งปิดใช้ */
  status?: string | null;
}

export interface MachineWithHubs extends MachineAccess {
  /** id ผู้ใช้ที่ผูกกับเครื่องนี้ (SUPERADMIN ได้หลายคน — ข้อ 2) */
  hubUserIds?: readonly string[];
}

/** role ที่ถูกต้องเท่านั้นถึงจะนับเป็น HUB — ค่าอื่นทั้งหมด = USER */
export function normalizeRole(raw: unknown): MachineRole {
  return String(raw ?? '').trim().toUpperCase() === MACHINE_ROLES.HUB ? MACHINE_ROLES.HUB : MACHINE_ROLES.USER;
}

/** ข้อ 3: ยืนยัน LAN ด้วยการกดบนเครื่องเป้าหมาย — ไม่มีข้อมูล = ยังไม่ยืนยัน */
export function isLanVerified(machine: Pick<MachineAccess, 'lanVerified'> | null | undefined): boolean {
  return machine?.lanVerified === true;
}

/** เครื่องที่สถานะเป็น disabled = ไม่รับคำสั่ง (แม้เป็น HUB และยืนยันแล้ว) */
export function canReceiveCommands(machine: MachineAccess | null | undefined): boolean {
  if (!machine) return false;
  const status = String(machine.status ?? 'online').toLowerCase();
  return COMMANDABLE_STATUSES.has(status);
}

/**
 * ข้อ 1: เครื่อง USER "สั่งงาน AI ได้"
 * คงเป็นจริงเสมอทุกบทบาท — เครื่องเป็นแค่ที่รันงาน ไม่ควรถูกลิดสิทธิ์เพราะเป็น USER
 */
export function canRunAiJobs(machine: MachineAccess | null | undefined): boolean {
  if (!machine) return false;
  return canReceiveCommands(machine);
}

/**
 * ข้อ 1 + 3: "คุมเครื่องนี้ได้ไหม" = ต้องเป็น HUB + ผ่านกดยืนยัน + ไม่ใช่คุมตัวเอง
 * @param controller เครื่องที่สั่ง (หรือผู้ใช้ที่กำลังจะสั่ง — เส้นทางเว็บคุมจากผู้ใช้ ไม่ใช่จากเครื่อง)
 * @param target     เครื่องที่จะถูกคุม
 */
export function canControlMachine(
  controller: MachineAccess | null | undefined,
  target: MachineAccess | null | undefined,
): boolean {
  if (!controller || !target) return false;
  if (controller.id && target.id && controller.id === target.id) return false; // กันลูปคุมตัวเอง
  if (normalizeRole(controller.role) !== MACHINE_ROLES.HUB) return false;  // ข้อ 1
  if (!isLanVerified(controller)) return false;                           // ข้อ 3
  return true;
}

/**
 * ข้อ 2: ผู้ใช้คนนี้คุมเครื่องไหนได้ — ผูก many-to-many และกรองเฉพาะที่ยืนยันแล้ว
 * @returns เครื่องที่คุมได้จริง (fail-closed: ไม่ยืนยัน = ไม่โผล่)
 */
export function listControllableMachines(
  userId: string | null | undefined,
  machines: readonly MachineWithHubs[],
): MachineWithHubs[] {
  const uid = String(userId ?? '').trim();
  if (!uid) return [];
  return machines.filter(
    (m) => isLanVerified(m) && Array.isArray(m.hubUserIds) && m.hubUserIds.includes(uid),
  );
}

// ─────────────────────────────────────────────────────────────
//  ยืนยันคู่เครื่อง (ข้อ 3)
// ─────────────────────────────────────────────────────────────

export interface PairPending {
  /** เจ้าของเครื่องที่กดขอคู่ */
  hubUserId: string;
  /** รหัส 6 หลักที่เจ้าของเครื่องต้องพิมพ์กลับ */
  code: string;
  createdAt: number;
}

export interface PairInput {
  code?: string | null;
  approve?: boolean;
  /** รหัสคู่ที่ค้างอยู่ — ขาด = ยังไม่มีการขอคู่ */
  pending?: PairPending | null;
}

export interface PairResult {
  state: 'pending' | 'confirmed' | 'rejected';
  approved: boolean;
  /** ผลจริงที่จะบันทึกลงเครื่อง */
  lanVerified: boolean;
  code?: string;
  reason?: string;
}

/**
 * แหล่งสุ่มที่ inject ได้ (เทสต์ส่งตัวปลอมมาแทน Math ได้)
 * คืนค่าในช่วง [0,1) — เหมือน Math.random แต่แทนที่ได้
 */
export interface RngLike {
  random(): number;
}

/** ค่าเริ่มต้น = Math.random ของจริง */
const defaultRng: RngLike = { random: () => Math.random() };

/** รหัส 6 หลักจาก 0-9 — เลขล้วน พิมพ์ง่ายบนมือถือ (ปรับแหล่งสุ่มเพื่อทดสอบได้) */
export function makePairCode(rng: RngLike = defaultRng): string {
  let out = '';
  for (let i = 0; i < PAIR_CODE_LENGTH; i++) out += String(Math.floor(rng.random() * 10));
  return out;
}

/**
 * ข้อ 3: เครื่องเป้าหมายต้องพิมพ์รหัสกลับมายืนยันเอง
 * @param rng        แหล่งสุ่ม (แทนที่ได้ในเทสต์)
 * @param hubUserId  ผู้ใช้เจ้าของเครื่อง
 * @param input      คำสั่งจากเครื่องเป้าหมาย (approve + code)
 */
export function decidePairApproval(rng: RngLike, hubUserId: string, input: PairInput = {}): PairResult {
  // 1) ยังไม่มีการขอคู่ → สร้างคำขอใหม่ พร้อมรหัสให้เจ้าของเครื่องดู
  const pending = input.pending ?? { hubUserId, code: makePairCode(rng), createdAt: Date.now() };
  if (!input.pending) {
    return { state: 'pending', approved: false, lanVerified: false, code: pending.code };
  }

  // 2) ปฏิเสธ = จบ ไม่ผ่าน (ผู้ใช้กด "ไม่ใช่เครื่องผม")
  if (input.approve === false) {
    return { state: 'rejected', approved: false, lanVerified: false, reason: 'เจ้าของเครื่องปฏิเสธ' };
  }

  // 3) เทียบรหัส — ผิด/ไม่ครบ/ไม่มีคำขอ = ไม่ผ่าน (fail-closed)
  const given = String(input.code ?? '').trim();
  if (!/^\d{6}$/.test(given) || given !== pending.code) {
    return {
      state: 'rejected',
      approved: false,
      lanVerified: false,
      reason: 'รหัสคู่ไม่ถูกต้อง — ต้องพิมพ์รหัส 6 หลักที่แสดงบนหน้าจอเครื่องเป้าหมาย',
    };
  }

  return { state: 'confirmed', approved: true, lanVerified: true, code: pending.code };
}