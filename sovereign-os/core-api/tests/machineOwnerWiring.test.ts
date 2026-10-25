// sovereign-os/core-api/tests/machineOwnerWiring.test.ts
//
// ── "เครื่องนี้เป็นลูกของใคร" ถูกตั้งตอนแพ็กชุดติดตั้ง ─────────────────────────────
// เจ้าของสั่ง 25/10/69: "พอติดตั้งเสร็จ ระบบจะขึ้นข้อมูลในเครื่องเลยว่าเครื่องนี้
// เป็นลูกของเครื่องไหน และมีสิทธิ์เชื่อมเข้าควบคุมเครื่องลูกได้ทันที"
//
// ทำได้โดยไม่ต้อง migration: คอลัมน์ที่มีอยู่แล้ว (owner_user_id / lan_confirmed_at)
// + ตาราง agent_machine_hubs ⇒ พอเครื่องลูก heartbeat ครั้งแรก HUB ก็คุมได้เลย
//
// เทสต์นี้ล็อกว่า:
//   · ตั้งเจ้าของได้เฉพาะบัญชี SUPERADMIN (OPERATOR/NODE_ADMIN ตั้งไม่ได้)
//   · ชื่อผู้ใช้ที่ไม่มีจริง = ปฏิเสธ ก่อนจะเขียนอะไรลง DB
//   · lan_confirmed_at ถูกตั้งเฉพาะเมื่อสั่งยืนยันชัดเจน (ไม่ใช่ผลข้างเคียงเงียบ ๆ)
//   · ผูก hub แบบ upsert (แพ็กซ้ำ = ไม่พัง)
import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import { prisma } from '../src/services/agent-machines.service';
import { resolveOwnerUser, wireMachineOwner } from '../src/services/agent-machine-hub.service';

/** db ปลอมที่บันทึกทุกคำสั่ง — ใช้แทน prisma จริงเพื่อไม่ต้องมี DB */
function fakeDb(over: { user?: (args: any) => Promise<any> } = {}) {
  const calls: Array<{ model: string; method: string; args: any }> = [];
  const record = (model: string, method: string, impl?: (args: any) => Promise<any>) => async (args: any) => {
    calls.push({ model, method, args });
    return impl ? impl(args) : {};
  };
  return {
    calls,
    db: {
      user: { findUnique: record('user', 'findUnique', over.user) },
      agentMachine: { update: record('agentMachine', 'update') },
      agentMachineHub: { upsert: record('agentMachineHub', 'upsert') },
    } as any,
  };
}

const SUPERADMIN = { id: '11111111-1111-1111-1111-111111111111', username: 'krisakorn', role: 'SUPERADMIN' };

describe('resolveOwnerUser: เลือกเจ้าของเครื่อง (พ่อ/แม่ที่คุมเครื่องลูก)', () => {
  test('บัญชี SUPERADMIN = ผ่าน และคืน id/username จริง', async () => {
    const f = fakeDb({ user: async () => SUPERADMIN });
    const r = await resolveOwnerUser('krisakorn', f.db);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.user.id, SUPERADMIN.id);
    assert.equal(f.calls[0].model, 'user');
  });

  test('ไม่มีชื่อนี้ในระบบ = owner_not_found และไม่เขียนอะไรเลย', async () => {
    const f = fakeDb({ user: async () => null });
    const r = await resolveOwnerUser('ไม่มีคนนี้', f.db);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'owner_not_found');
    assert.equal(f.calls.length, 1, 'ต้องไม่มีการเขียนหลังหาผู้ใช้ไม่เจอ');
  });

  test('OPERATOR / NODE_ADMIN ตั้งเป็นเจ้าของเครื่องไม่ได้', async () => {
    for (const role of ['OPERATOR', 'NODE_ADMIN', 'SYSTEM_AI']) {
      const f = fakeDb({ user: async () => ({ ...SUPERADMIN, role }) });
      const r = await resolveOwnerUser('someone', f.db);
      assert.equal(r.ok, false, `${role} ต้องไม่ผ่าน`);
      assert.equal(!r.ok && r.code, 'owner_not_superadmin');
      assert.ok(!f.calls.some((c) => c.model !== 'user'), 'ห้ามเขียนก่อนตรวจสิทธิ์');
    }
  });

  test('ไม่ระบุเจ้าของ = owner_required (ไม่เรียก DB)', async () => {
    for (const input of ['', '   ', null, undefined]) {
      const f = fakeDb({ user: async () => SUPERADMIN });
      const r = await resolveOwnerUser(input as any, f.db);
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.code, 'owner_required');
      assert.equal(f.calls.length, 0);
    }
  });

  test('ตัดช่องว่างหัวท้ายก่อนค้นหา (พิมพ์ " krisakorn " ก็ใช้ได้)', async () => {
    const f = fakeDb({ user: async () => SUPERADMIN });
    await resolveOwnerUser('  krisakorn  ', f.db);
    assert.equal(f.calls[0].args.where.username, 'krisakorn');
  });
});

describe('wireMachineOwner: ผูกเครื่องลูกให้เจ้าของ + เปิดสิทธิ์ควบคุม', () => {
  test('ตั้ง owner_user_id และผูก hub_users ให้เครื่องนี้', async () => {
    const f = fakeDb();
    await wireMachineOwner({ machineId: 'm-1', user: SUPERADMIN, db: f.db });
    const upd = f.calls.find((c) => c.model === 'agentMachine' && c.method === 'update');
    assert.ok(upd, 'ต้องตั้งเจ้าของเครื่อง');
    assert.equal(upd!.args.where.id, 'm-1');
    assert.equal(upd!.args.data.owner_user_id, SUPERADMIN.id);
    const link = f.calls.find((c) => c.model === 'agentMachineHub');
    assert.ok(link, 'ต้องผูกเครื่องกับผู้ใช้ (ไม่งั้น HUB เห็นเครื่องแต่กดคุมไม่ได้)');
    assert.deepEqual(link!.args.create, { machine_id: 'm-1', user_id: SUPERADMIN.id });
  });

  test('ไม่สั่งยืนยัน = ไม่แตะ lan_confirmed_at (ผู้ใช้ยังต้องกดยืนยันเองตามกติกาเดิม)', async () => {
    const f = fakeDb();
    await wireMachineOwner({ machineId: 'm-1', user: SUPERADMIN, db: f.db });
    const upd = f.calls.find((c) => c.model === 'agentMachine')!;
    assert.ok(!('lan_confirmed_at' in upd.args.data), 'ห้ามยืนยัน LAN ให้เองโดยไม่สั่ง');
  });

  test('สั่งยืนยัน = ตั้ง lan_confirmed_at ด้วยเวลาที่กำหนด (คุมได้ทันทีที่ออนไลน์)', async () => {
    const f = fakeDb();
    const now = new Date('2026-10-25T03:04:05.000Z');
    await wireMachineOwner({ machineId: 'm-1', user: SUPERADMIN, confirmLan: true, now, db: f.db });
    const upd = f.calls.find((c) => c.model === 'agentMachine')!;
    assert.equal(upd.args.data.lan_confirmed_at, now);
  });

  test('ผูกซ้ำได้ (upsert) — แพ็กชุดใหม่ให้เครื่องเดิมไม่ทำให้ hub_users พัง', async () => {
    const f = fakeDb();
    await wireMachineOwner({ machineId: 'm-1', user: SUPERADMIN, db: f.db });
    await wireMachineOwner({ machineId: 'm-1', user: SUPERADMIN, db: f.db });
    const links = f.calls.filter((c) => c.model === 'agentMachineHub');
    assert.equal(links.length, 2);
    for (const l of links) assert.equal(l.method, 'upsert');
  });

  test('End-to-end ด้วย prisma delegate ปลอม: เขียนลง "ตาราง" ที่ถูกต้อง', async () => {
    const writes: Array<{ data: any; where: any }> = [];
    mockModel(prisma as any, 'agentMachine', {
      update: async (args: any) => {
        writes.push(args);
        return { id: args.where.id, ...args.data };
      },
    });
    mockModel(prisma as any, 'agentMachineHub', { upsert: async () => ({}) });
    await wireMachineOwner({
      machineId: 'm-2',
      user: SUPERADMIN,
      confirmLan: true,
      now: new Date('2026-10-25T00:00:00.000Z'),
    });
    const hit = writes.find((w) => w.where.id === 'm-2');
    assert.ok(hit, 'ต้องเขียนแถวของเครื่อง m-2');
    assert.equal(hit!.data.owner_user_id, SUPERADMIN.id);
  });
});
