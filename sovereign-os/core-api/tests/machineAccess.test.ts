// tests/machineAccess.test.ts — กติกา "ใครคุมเครื่องไหนได้" (เจ้าของสั่ง 11/10/69)
//
// ข้อที่เทสต์นี้ล็อกไว้ (ทั้ง 3 ข้อคุณยืนยันด้วยคำพูด):
//   1) เครื่อง USER  "สั่งงาน AI ได้"  → แต่ "คุมเครื่องอื่นไม่ได้"
//   2) เครื่องหนึ่งอยู่ใต้ SUPERADMIN ได้หลายคนพร้อมกัน (มีได้ 1–2 คน)
//      ⇒ ความสัมพันธ์เป็น many-to-many ไม่ใช่ parent เดียว
//   3) ยืนยัน "อยู่ LAN เดียวกัน" ต้อง "กดยืนยันบนเครื่องเป้าหมาย"
//      ⇒ การคุมจริงต้องรอคอนเฟิร์มจากเครื่องนั้น ไม่ใช่แค่ดู IP
//
// ไฟล์นี้เป็นชั้น "ตัดสินใจ" ล้วน (pure) — ไม่ต้องมี DB และไม่ต้องแตะของจริง
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canControlMachine,
  canReceiveCommands,
  canRunAiJobs,
  isLanVerified,
  MACHINE_ROLES,
  decidePairApproval,
  listControllableMachines,
} from '../src/services/machine-access.service';

/** แทน expect(...) ของ vitest — โปรเจกต์นี้ใช้ node:test + assert/strict */
const expect = (actual: unknown) => ({
  toBe: (expected: unknown, msg?: string) => assert.strictEqual(actual, expected, msg),
  toEqual: (expected: unknown, msg?: string) => assert.deepStrictEqual(actual, expected, msg),
  toContain: (needle: unknown, msg?: string) => {
    assert.ok(
      Array.isArray(actual) && actual.includes(needle),
      msg ?? `คาดว่า ${JSON.stringify(actual)} จะมี ${JSON.stringify(needle)}`,
    );
  },
  toMatch: (re: RegExp, msg?: string) => assert.match(String(actual), re, msg),
  toBeTruthy: (msg?: string) => assert.ok(actual, msg ?? `คาดว่า ${JSON.stringify(actual)} จะเป็นค่าจริง`),
  not: {
    toBe: (expected: unknown, msg?: string) => assert.notStrictEqual(actual, expected, msg),
  },
});

describe('บทบาทของเครื่อง (ข้อที่ 1 — USER สั่งงาน AI ได้ แต่คุมเครื่องอื่นไม่ได้)', () => {
  const userMachine = { id: 'm-user', name: 'คอมเครื่องที่ 2', role: MACHINE_ROLES.USER, lanVerified: false };
  const hubMachine = { id: 'm-hub', name: 'โน้ตบุ๊ค', role: MACHINE_ROLES.HUB, lanVerified: true };

  it('เครื่อง USER สั่งงาน AI ได้ (ห้ามบล็อกข้อนี้ — เจ้าของยืนยัน)', () => {
    expect(canRunAiJobs(userMachine)).toBe(true);
  });

  it('เครื่อง USER รับคำสั่งควบคุมจาก HUB ได้ (คือเป้าหมายของการคุม)', () => {
    expect(canReceiveCommands(userMachine)).toBe(true);
  });

  it('เครื่อง USER คุมเครื่องอื่นไม่ได้ — ต้องตอบ false เสมอ', () => {
    expect(canControlMachine(userMachine, userMachine)).toBe(false);
    expect(canControlMachine(userMachine, hubMachine)).toBe(false);
  });

  it('เครื่อง HUB คุมเครื่องอื่นได้ (แต่ต้องผ่านการยืนยันด้วย — ข้อ 3)', () => {
    // ยังไม่ยืนยัน LAN = ยังคุมไม่ได้ แม้เป็น HUB
    expect(canControlMachine({ ...hubMachine, lanVerified: false }, userMachine)).toBe(false);
    // ยืนยันแล้ว = คุมได้
    expect(canControlMachine(hubMachine, userMachine)).toBe(true);
  });

  it('เครื่องที่ยังไม่ผ่านการยืนยัน LAN ถือว่า "ยังไม่มีสิทธิ์" ไม่ใช่ "ไม่มีสิทธิ์ถาวร"', () => {
    expect(isLanVerified({ lanVerified: false })).toBe(false);
    expect(isLanVerified({ lanVerified: true })).toBe(true);
    expect(isLanVerified({})).toBe(false); // ไม่มีฟิลด์ = ยังไม่ยืนยัน (fail-closed)
  });

  it('เครื่องคุมตัวเองไม่ได้ (กันลูป เช่นส่งคำสั่งคุมตัวเองค้าง)', () => {
    expect(canControlMachine(hubMachine, hubMachine)).toBe(false);
  });
});

describe('ผู้ใช้คุมเครื่องได้ (ข้อที่ 2 — เครื่องอยู่ใต้ SUPERADMIN ได้หลายคน)', () => {
  const machineB = { id: 'm-b', name: 'คอมเครื่องที่ 2', role: MACHINE_ROLES.USER, lanVerified: true };
  const machineD = { id: 'm-d', name: 'คอมห้องนั่งเล่น', role: MACHINE_ROLES.USER, lanVerified: true };

  // เครื่อง B และ D ผูกกับทั้ง admin และ krisakorn (many-to-many)
  const all = [
    { ...machineB, hubUserIds: ['u-admin', 'u-krisakorn'] },
    { ...machineD, hubUserIds: ['u-krisakorn'] },
  ];

  it('SUPERADMIN ที่เป็นเจ้าของเครื่อง คุมได้', () => {
    const seen = listControllableMachines('u-krisakorn', all);
    expect(seen.map((m) => m.id)).toEqual(['m-b', 'm-d']);
    expect(seen.map((m) => m.id)).toContain('m-b');
  });

  it('SUPERADMIN คนที่สองที่ผูกกับเครื่องนั้นเหมือนกัน คุมได้ (หลายคนคุมเครื่องเดียวกันได้)', () => {
    const seen = listControllableMachines('u-admin', all);
    expect(seen.map((m) => m.id)).toEqual(['m-b'], 'admin ผูกเฉพาะเครื่อง B');
  });

  it('ผู้ใช้ที่ไม่ได้ผูก = คุมไม่ได้แม้เป็นคนเดียวกันในระบบ', () => {
    expect(listControllableMachines('u-คนอื่น', all)).toEqual([]);
  });

  it('เครื่องที่ยังไม่ยืนยัน LAN ยังไม่โผล่ในรายการที่คุมได้ (fail-closed — ข้อ 3)', () => {
    const pending = [{ ...machineB, hubUserIds: ['u-krisakorn'], lanVerified: false }];
    expect(listControllableMachines('u-krisakorn', pending)).toEqual([]);
  });
});

describe('ยืนยันคู่เครื่อง (ข้อ 3 — ต้องกดยืนยันบนเครื่องเป้าหมาย)', () => {
  const hubUserId = 'u-krisakorn';
  /** แหล่งสุ่มปลอม — ให้ผลลัพธ์เดิมทุกครั้ง (เทสต์ต้องไม่สุ่มเอง) */
  const fixedRandom = (digits: string) => {
    let i = 0;
    return { random: () => Number(digits[i++ % digits.length]) / 10 };
  };

  it('สร้างรหัสคู่ = ตัวเลข 6 หลัก อ่านง่ายพิมพ์ได้', () => {
    const code = decidePairApproval(fixedRandom('042731'), hubUserId).code;
    expect(code).toBe('042731');
  });

  it('สถานะเริ่มต้น = รอยืนยัน (ไม่ใช่ยืนยันอัตโนมัติ)', () => {
    const r = decidePairApproval(fixedRandom('123456'), hubUserId);
    expect(r.state).toBe('pending');
    expect(r.approved).toBe(false);
  });

  it('ยืนยันด้วยรหัสถูก = อนุมัติ', () => {
    const pending = decidePairApproval(fixedRandom('123456'), hubUserId);
    const done = decidePairApproval(fixedRandom('123456'), hubUserId, { code: '123456', approve: true, pending });
    expect(done.approved).toBe(true);
    expect(done.state).toBe('confirmed');
    expect(done.lanVerified).toBe(true);
  });

  it('ยืนยันด้วยรหัสผิด = ปฏิเสธ ไม่ให้ผ่าน (ข้อ 3 — กันคนอื่นกดแทน)', () => {
    const pending = decidePairApproval(fixedRandom('123456'), hubUserId);
    const done = decidePairApproval(fixedRandom('123456'), hubUserId, { code: '000000', approve: true, pending });
    expect(done.approved).toBe(false);
    expect(done.lanVerified).toBe(false);
    expect(done.reason).toMatch(/รหัส/);
  });

  it('เรียกยืนยันครั้งเดียวโดยไม่มีคำขอค้าง = ไม่ผ่าน (ไม่ใช่ "เริ่มคำขอใหม่")', () => {
    // กติกา: รอบแรก "ขอคู่" → ได้รหัส · รอบสอง "ยืนยันด้วยรหัส" → ผ่าน
    // ถ้ารอบเดียวส่ง approve+code มาเฉยๆ โดยไม่เคยขอคู่ = ไม่มีรหัสจริงให้เทียบ ⇒ ต้องไม่ผ่าน
    const firstCall = decidePairApproval(fixedRandom('123456'), hubUserId, { code: '123456', approve: true });
    expect(firstCall.state).toBe('pending', 'รอบแรกต้องเป็นการขอคู่ ไม่ใช่การยืนยัน');
    expect(firstCall.approved).toBe(false);
    expect(firstCall.lanVerified).toBe(false);
  });

  it('รหัสที่ "เดาเอง" ในรอบเดียวไม่ผ่าน — ต้องมีรหัสจริงค้างอยู่ก่อน', () => {
    const pending = decidePairApproval(fixedRandom('123456'), hubUserId);
    expect(pending.code).toBeTruthy();
    // ยืนยันด้วยรหัสที่ต่างจากที่ระบบสุ่มให้ = ไม่ผ่าน (กันเดารหัส)
    const guess = decidePairApproval(fixedRandom('123456'), hubUserId, { code: '999999', approve: true, pending });
    expect(guess.approved).toBe(false, 'รหัสที่เดาเองต้องไม่ผ่าน');
  });

  it('รหัสผิดรูป (ไม่ใช่ตัวเลข 6 หลัก) = ไม่ผ่าน', () => {
    const pending = decidePairApproval(fixedRandom('123456'), hubUserId);
    for (const bad of ['12345', '1234567', 'abcdef', '']) {
      const done = decidePairApproval(fixedRandom('123456'), hubUserId, { code: bad, approve: true, pending });
      expect(done.approved).toBe(false, `รหัส "${bad}" ต้องไม่ผ่าน`);
    }
  });
});

describe('กติกาความปลอดภัยที่ฝังไว้ตั้งแต่แรก (กันช่องโหว่ ไม่ต้องรอเจ็จ)', () => {
  it('เครื่องใหม่ทุกเครื่องเริ่มเป็น USER เสมอ (ไม่ใช่ HUB) — ต้องให้ SUPERADMIN อัปเกรดเอง', () => {
    expect(MACHINE_ROLES.DEFAULT).toBe(MACHINE_ROLES.USER);
    expect(MACHINE_ROLES.DEFAULT).not.toBe(MACHINE_ROLES.HUB);
  });

  it('ฟิลด์ role ที่แปลกปลอม = ถือว่า USER (fail-closed ไม่ใช่ HUB)', () => {
    expect(canControlMachine({ role: 'SUPERADMIN' as never, lanVerified: true }, { id: 'x' })).toBe(false);
    expect(canControlMachine({ role: 'root' as never, lanVerified: true }, { id: 'x' })).toBe(false);
    expect(canControlMachine({ role: '' as never, lanVerified: true }, { id: 'x' })).toBe(false);
  });

  it('canReceiveCommands ของเครื่องที่ถูกปิดใช้งาน = false (ไม่รับคำสั่งแม้เป็น HUB)', () => {
    expect(canReceiveCommands({ role: MACHINE_ROLES.HUB, lanVerified: true, status: 'disabled' })).toBe(false);
    expect(canReceiveCommands({ role: MACHINE_ROLES.HUB, lanVerified: true, status: 'online' })).toBe(true);
  });
});