import './setup-env';
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mockModel } from './helpers';

describe('Relay Anti-Chatter Guard (Phase 6 — Hardware Chatter / Relay Chattering)', () => {
  async function setup() {
    const mod = await import('../src/services/relay-guard.service');
    mockModel(mod.prisma, 'securityEvent', { create: async (a: any) => ({ id: 'e', ...a.data }) });
    return mod.relayGuard;
  }

  test('check: สั่งซ้ำใน 3 วิ → ถูกปฏิเสธ (RC-filter เทียบเท่า)', async () => {
    const relayGuard = await setup();
    const first = relayGuard.check('relay1');
    assert.equal(first.allowed, true, 'คำสั่งแรกต้องผ่าน');
    const second = relayGuard.check('relay1');
    assert.equal(second.allowed, false, 'สั่งทันทีซ้ำต้องโดนกัน');
    assert.match(second.reason || '', /anti-chatter/);
  });

  test('lock: สั่งถี่ 10 ครั้งใน 60 วิ → relay ถูกล็อก (ฟิวส์ตัด)', async () => {
    const relayGuard = await setup();
    const id = `lock-${Date.now()}`;
    relayGuard.check(id); // first pass
    for (let i = 0; i < 12; i++) {
      relayGuard.check(id);
    }
    const after = relayGuard.check(id);
    assert.equal(after.allowed, false);
    assert.equal(after.locked, true, 'ต้องล็อกเมื่อสั่งถี่เกินเกณฑ์');
    const st = relayGuard.status();
    assert.ok(st.locks.some((l: any) => l.relayId === id), 'lock ต้องอยู่ในสถานะ');
  });

  test('unlock: SUPERADMIN ปลดล็อกได้', async () => {
    const relayGuard = await setup();
    const id = `unlock-${Date.now()}`;
    relayGuard.check(id);
    for (let i = 0; i < 12; i++) relayGuard.check(id);
    assert.equal(relayGuard.check(id).locked, true);
    const released = relayGuard.unlock(id);
    assert.equal(released, true);
    relayGuard.check(id);
    assert.equal(relayGuard.check(id).allowed, false); // ผ่าน gate ปกติ (ยังเร็วไป)
    assert.equal(relayGuard.check(id).locked, false, 'ไม่โดนล็อกอีกแล้ว');
  });

  test('onDeviceState: ชิปสับ relay 8+ ครั้งใน 3 วิ → RELAY_CHATTER (hardware glitch)', async () => {
    const relayGuard = await setup();
    const key = `chatter-${Date.now()}`;
    let chatter = false;
    for (let i = 0; i < 9; i++) {
      if (await relayGuard.onDeviceState('node-x', key)) chatter = true;
    }
    assert.equal(chatter, true, 'ต้องจับ relay chattering จากอุปกรณ์');
    assert.equal(relayGuard.check(key).locked, true, 'relay ต้องโดนล็อกเมื่อชิปรวน');
  });
});