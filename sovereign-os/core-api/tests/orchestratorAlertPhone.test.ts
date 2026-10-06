import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel } from './helpers';
import { prisma } from '../src/lib/prisma';
import {
  ALERT_PHONE_KEY,
  getAlertPhone,
  setAlertPhone,
  clearAlertPhone,
  maskPhone,
  normalizeAlertPhone,
  __resetAlertPhoneCache,
} from '../src/services/orchestrator-alert-phone.service';

// ── red-first ──────────────────────────────────────────────────────────────
// ก่อนมี service นี้ ชั้น call ใน orchestrator-notify รับ callTo แต่ "ไม่มีที่ไหนส่งค่า"
// ⇒ เปิด CALL_PROVIDER=bland ก็โทรไม่ออก เพราะไม่มีเบอร์ให้โทร
// เทสต์ชุดนี้จึงพิสูจน์ว่าเบอร์โทรถูกหามาจริง เก็บเข้ารหัส และไม่รั่วออกมา

function settingsMock(rows: Record<string, string>) {
  const written: Record<string, string>[] = [];
  __resetAlertPhoneCache(); // cache 5 วินาทีเป็นของจริงใน production — แต่ทำให้เทสต์อ่านค่าของเคสก่อน
  mockModel(prisma as any, 'systemSetting', {
    findMany: async (args: any) => {
      const keys: string[] = args?.where?.key?.in ?? [];
      return keys
        .filter((k) => k in rows)
        .map((key) => ({ key, value: rows[key] }));
    },
    findUnique: async (args: any) =>
      args?.where?.key in rows ? { key: args.where.key, value: rows[args.where.key] } : null,
    upsert: async (args: any) => {
      written.push(args);
      return { key: args.where.key, value: args.create?.value ?? args.update?.value };
    },
    deleteMany: async (args: any) => {
      for (const k of args?.where?.key?.in ?? []) delete rows[k];
      return { count: 1 };
    },
  } as any);
  return written;
}

describe('orchestrator-alert-phone — ที่เก็บเบอร์โทร', () => {
  test('คีย์ที่ใช้เก็บเบอร์ต้องเป็นชื่อที่กลางตัวเองเข้าใจ', () => {
    assert.equal(ALERT_PHONE_KEY, 'orchestrator.callPhone');
  });

  test('เบอร์ที่บันทึกไว้ต้องถูกถอดออกมาใช้ได้ (db override ชนะ env)', async () => {
    const { encryptField } = await import('../src/services/field-crypto.service');
    const prev = process.env.CALLER_ALERT_PHONE;
    process.env.CALLER_ALERT_PHONE = '+66900000000';
    try {
      settingsMock({ 'orchestrator.callPhone': encryptField('+66812345678') });
      const got = await getAlertPhone();
      assert.equal(got, '+66812345678', 'ต้องอ่านค่าจาก DB ไม่ใช่ env');
    } finally {
      if (prev === undefined) delete process.env.CALLER_ALERT_PHONE;
      else process.env.CALLER_ALERT_PHONE = prev;
    }
  });

  test('ไม่มีใน DB ต้อง fallback ไป env แทน (ไม่ error)', async () => {
    const prev = process.env.CALLER_ALERT_PHONE;
    process.env.CALLER_ALERT_PHONE = '+66900000000';
    try {
      settingsMock({});
      assert.equal(await getAlertPhone(), '+66900000000');
    } finally {
      if (prev === undefined) delete process.env.CALLER_ALERT_PHONE;
      else process.env.CALLER_ALERT_PHONE = prev;
    }
  });

  test('ไม่มีทั้ง DB และ env ต้องคืน null ไม่ throw (ชั้น call ข้ามเป็น no-op)', async () => {
    const prev = process.env.CALLER_ALERT_PHONE;
    delete process.env.CALLER_ALERT_PHONE;
    try {
      settingsMock({});
      assert.equal(await getAlertPhone(), null);
    } finally {
      if (prev !== undefined) process.env.CALLER_ALERT_PHONE = prev;
    }
  });

  test('DB ล้มต้องคืน null ไม่ throw — งานที่เพิ่งเสร็จต้องไม่กลายเป็น error', async () => {
    const prev = process.env.CALLER_ALERT_PHONE;
    delete process.env.CALLER_ALERT_PHONE;
    try {
      __resetAlertPhoneCache();
      mockModel(prisma as any, 'systemSetting', {
        findMany: async () => {
          throw new Error('DB down');
        },
      } as any);
      assert.equal(await getAlertPhone(), null);
    } finally {
      if (prev !== undefined) process.env.CALLER_ALERT_PHONE = prev;
    }
  });
});

describe('orchestrator-alert-phone — บันทึกเบอร์', () => {
  test('เบอร์ต้องเป็น E.164 ก่อนบันทึก ไม่งั้นปฏิเสธ', async () => {
    const written = settingsMock({});
    for (const bad of ['0812345678', '66812345678', '+668123', '', 'โทรหาฉัน', '+6681234567890123456']) {
      await assert.rejects(
        () => setAlertPhone(bad),
        /E\.164/,
        `ต้องปฏิเสธ: ${JSON.stringify(bad)}`,
      );
    }
    assert.equal(written.length, 0, 'เบอร์ผิดต้องไม่ต้องเขียนลง DB แม้แต่ครั้งเดียว');
  });

  test('เบอร์ที่ผ่านต้องถูกเข้ารหัสก่อนลง DB (ไม่เก็บ plaintext เหมือน telegram.botToken)', async () => {
    const written = settingsMock({});
    await setAlertPhone('+66812345678');
    assert.equal(written.length, 1);
    assert.equal(written[0].create.key, 'orchestrator.callPhone');
    assert.match(written[0].create.value, /^enc:v1:/, 'ต้องเข้ารหัส ไม่ใช่เก็บเบอร์ดิบ');
    assert.ok(!String(written[0].create.value).includes('66812345678'), 'เลขเบอร์ต้องไม่โผล่ในค่าที่เก็บ');
  });

  test('บันทึกซ้ำต้องเป็น upsert คีย์เดิม ไม่สร้างซ้ำ', async () => {
    const written = settingsMock({});
    await setAlertPhone('+66812345678');
    await setAlertPhone('+66987654321');
    assert.equal(written.length, 2);
    assert.ok(written.every((w) => w.create.key === 'orchestrator.callPhone' && w.where.key === 'orchestrator.callPhone'));
  });

  test('ล้างเบอร์แล้วต้องกลับไปใช้ env ได้', async () => {
    const prev = process.env.CALLER_ALERT_PHONE;
    process.env.CALLER_ALERT_PHONE = '+66900000000';
    try {
      settingsMock({ 'orchestrator.callPhone': 'enc:v1:xx' });
      await clearAlertPhone();
      assert.equal(await getAlertPhone(), '+66900000000');
    } finally {
      if (prev === undefined) delete process.env.CALLER_ALERT_PHONE;
      else process.env.CALLER_ALERT_PHONE = prev;
    }
  });
});

describe('orchestrator-alert-phone — ไม่รั่วเบอร์เต็มออกไปที่ UI', () => {
  test('mask เบอร์ต้องเหลือท้ายไม่เกิน 4 ตัว', () => {
    assert.equal(maskPhone(''), '');
    assert.equal(maskPhone('+66812345678'), '+66…5678');
    assert.equal(maskPhone('+6681'), '••••');
    assert.ok(!maskPhone('+66812345678').includes('8123'), 'ไม่ให้ตัวกลางหลุด');
  });

  test('normalize ตัดช่องว่าง/ขีดออก แต่ยังต้องผ่าน E.164', () => {
    assert.equal(normalizeAlertPhone(' +66812345678 '), '+66812345678');
    assert.equal(normalizeAlertPhone('0812345678'), null, 'เบอร์ไทยเปลี่ยนเป็น E.164 ไม่ได้โดยอัตโนมัติ ต้องให้ผู้ใช้ยืนยัน');
  });
});
