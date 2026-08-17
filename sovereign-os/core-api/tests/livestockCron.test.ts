// tests/livestockCron.test.ts — งานประจำวัน: ปลดล็อก withdrawal + เตือนวัคซีน
import './setup-env';
import { test, before, after, mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  prisma as cronPrisma,
  runDailyLivestockMaintenance,
  livestockMaintenanceTask,
} from '../src/services/livestock-cron.service';
import { getTelegramAlertDispatcher } from '../src/services/telegram-alert.service';
import { mockModel } from './helpers';

let sentAlerts: any[] = [];
let updatedGroups: any[] = [];
let lockedGroups: any[] = [];
let vaccineGroups: any[] = [];

before(async () => {
  sentAlerts = [];
  updatedGroups = [];
  lockedGroups = [];
  vaccineGroups = [];

  mock.method(getTelegramAlertDispatcher(), 'send', async (payload: any) => {
    sentAlerts.push(payload);
    return { sent: true, reason: 'mock' };
  });

  mockModel(cronPrisma, 'livestockGroup', {
    findMany: async ({ where }: any = {}) =>
      where?.status === 'LOCKED_WITHDRAWAL' ? lockedGroups : vaccineGroups,
    update: async ({ where, data }: any) => {
      updatedGroups.push({ id: where.id, data });
      return { id: where.id, ...data };
    },
  });
});

after(() => {
  mock.restoreAll();
  // หยุด cron ที่ start ตอน import — ไม่ให้ interval ค้าง
  livestockMaintenanceTask.stop();
});

describe('daily maintenance — withdrawal unlock', () => {
  test('พ้นระยะหยุดยา (safeHarvestDate ผ่านแล้ว) → ปลดล็อก ACTIVE + alert info', async () => {
    lockedGroups = [
      {
        id: 'g-lock-1',
        code: 'BROILER-02',
        records: [{ safeHarvestDate: new Date(Date.now() - 2 * 86_400_000) }],
      },
    ];
    vaccineGroups = [];
    await runDailyLivestockMaintenance();

    assert.equal(updatedGroups.length, 1);
    assert.equal(updatedGroups[0].id, 'g-lock-1');
    assert.equal(updatedGroups[0].data.status, 'ACTIVE');
    const alert = sentAlerts.find((a) => a.eventKey === 'withdrawal-unlock-g-lock-1');
    assert.ok(alert);
    assert.equal(alert.severity, 'info');
  });

  test('ยังไม่พ้นระยะ (safeHarvestDate อนาคต) → ไม่แตะกลุ่ม', async () => {
    updatedGroups = [];
    sentAlerts = [];
    lockedGroups = [
      {
        id: 'g-lock-2',
        code: 'SWINE-05',
        records: [{ safeHarvestDate: new Date(Date.now() + 5 * 86_400_000) }],
      },
    ];
    await runDailyLivestockMaintenance();

    assert.equal(updatedGroups.length, 0);
    assert.equal(sentAlerts.length, 0);
  });
});

describe('daily maintenance — vaccine due', () => {
  test('วัคซีนครบกำหนด (อายุ ≥ targetAgeDays) → alert warn ต่อตัววัคซีน', async () => {
    updatedGroups = [];
    sentAlerts = [];
    lockedGroups = [];
    vaccineGroups = [
      {
        id: 'g-v-1',
        code: 'LAYER-01',
        birthDate: new Date(Date.now() - 100 * 86_400_000), // อายุ 100 วัน
        schedules: [
          { id: 's-due', vaccineName: 'ND', targetAgeDays: 21, isCompleted: false },
          { id: 's-also-due', vaccineName: 'IB', targetAgeDays: 42, isCompleted: false },
        ],
      },
      {
        id: 'g-v-2',
        code: 'DUCK-03',
        birthDate: new Date(Date.now() - 10 * 86_400_000), // อายุ 10 วัน
        schedules: [{ id: 's-not-due', vaccineName: 'Cholera', targetAgeDays: 21, isCompleted: false }],
      },
    ];
    await runDailyLivestockMaintenance();

    const keys = sentAlerts.map((a) => a.eventKey);
    assert.ok(keys.includes('vaccine-due-s-due'));
    assert.ok(keys.includes('vaccine-due-s-also-due'));
    assert.ok(!keys.includes('vaccine-due-s-not-due'));
    assert.equal(sentAlerts.every((a) => a.severity === 'warn'), true);
  });

  test('ไม่มีกลุ่ม → ไม่มี alert', async () => {
    sentAlerts = [];
    lockedGroups = [];
    vaccineGroups = [];
    await runDailyLivestockMaintenance();
    assert.equal(sentAlerts.length, 0);
  });
});