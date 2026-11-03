// tests/consentPolicyVersion.test.ts
//
// ── ความยินยอมหมดอายุตามเวอร์ชันนโยบาย (re-consent) ─────────────────────────
// ทำไมต้องมี: เวอร์ชันนโยบาย bump ได้ แต่ถ้าทุกอย่างถูกตัดสินด้วย "เวอร์ชันเท่ากันเป๊ะ"
// ผู้ใช้จะถูกขอความยินยอมใหม่ *ทุกวัตถุประสงค์* ทุกครั้งที่แก้ข้อความจุดเดียว
// (กดยอมรับรัว ๆ จนเลิกอ่าน = ความยินยอมกลายเป็นพิธีกรรม) และถ้าไม่มีการขอใหม่เลย
// ผู้ใช้ก็ผูกอยู่กับถ้อยคำที่ไม่เคยเห็น
//
// กติกาที่เทสต์นี้ล็อก:
//   · แต่ละวัตถุประสงค์มี "เวอร์ชันที่ถูกแก้ล่าสุด" (CONSENT_PURPOSE_REVISED_IN)
//   · แถวที่ยอมรับไว้ >= เวอร์ชันนั้น = ยังใช้ได้ · เก่ากว่า = ต้องขอใหม่ (เฉพาะวัตถุประสงค์นั้น)
//   · ประวัติเป็น append-only: ยืนยันใหม่ = event ใหม่ที่อ้างเวอร์ชันใหม่ ของเก่าไม่ถูกทับ
//   · API ต้องบอกได้ว่า "ตัวไหนต้องขอใหม่" ไม่ใช่ให้ UI เดา
import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';
import {
  CONSENT_POLICY_VERSION,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_REVISED_IN,
  isConsentCurrent,
} from '../src/services/consent.service';
import { checkSensitiveConsent } from '../src/services/consent-gate.service';

const USER_ID = 'test-user'; // makeToken() ให้ req.user.id = 'test-user'
const AUTH = { authorization: `Bearer ${makeToken('SUPERADMIN')}` };

interface FakeState {
  consents: Map<string, any>;
  events: any[];
}

let state: FakeState;

function mockModels() {
  mockModel(prisma as any, 'userConsent', {
    findMany: async (args: any = {}) =>
      [...state.consents.values()].filter((row) => (args?.where?.user_id ? row.user_id === args.where.user_id : true)),
    findUnique: async (args: any) => {
      const { user_id, purpose } = args?.where?.user_id_purpose ?? {};
      return state.consents.get(`${user_id}:${purpose}`) ?? null;
    },
    upsert: async (args: any) => {
      const key = `${args.where.user_id_purpose.user_id}:${args.where.user_id_purpose.purpose}`;
      const row = { id: 'c-1', ...args.create, ...args.update, updated_at: new Date() };
      state.consents.set(key, row);
      return row;
    },
  } as any);

  mockModel(prisma as any, 'consentEvent', {
    create: async (args: any) => {
      const row = { id: `e-${state.events.length + 1}`, created_at: new Date(), ...args.data };
      state.events.push(row);
      return row;
    },
    findMany: async () => state.events,
  } as any);

  // ด่านข้อมูลสุขภาพอ่านสวิตช์เดิมของโมดูล health ด้วย — ที่นี่ไม่มีแถว = ไม่บล็อก
  mockModel(prisma as any, 'healthConsent', { findFirst: async () => null } as any);
}

function loadRouter() {
  const mod = require('../src/modules/consent/consent.routes');
  return mod.default;
}

async function withServer(fn: (base: string) => Promise<void>) {
  const router = loadRouter();
  const srv = await createTestServer((app) => app.use('/api/consent', router));
  try {
    await fn(srv.baseUrl);
  } finally {
    await srv.close();
  }
}

const purposeOf = (body: any, key: string) => body.purposes.find((p: any) => p.key === key);

function seedConsent(purpose: string, granted: boolean, policyVersion: string) {
  state.consents.set(`${USER_ID}:${purpose}`, {
    id: `c-${purpose}`,
    user_id: USER_ID,
    purpose,
    granted,
    policy_version: policyVersion,
    updated_at: new Date(),
  });
}

beforeEach(() => {
  state = { consents: new Map(), events: [] };
  mockModels();
});

describe('re-consent — ตรรกะต่อวัตถุประสงค์', () => {
  test('แถวที่ยอมรับใต้นโยบายเวอร์ชันเก่า → ต้องขอใหม่', () => {
    assert.equal(isConsentCurrent('health', { granted: true, policy_version: '2000-01-01' }), false);
  });

  test('แถวที่ยอมรับเวอร์ชันปัจจุบัน → ยังใช้ได้ (ไม่ต้องรบกวนผู้ใช้)', () => {
    assert.equal(isConsentCurrent('health', { granted: true, policy_version: CONSENT_POLICY_VERSION }), true);
  });

  test('ถอนไว้ (granted=false) ไม่ใช่ "ต้องขอใหม่" และไม่ใช่ "ใช้ได้"', () => {
    assert.equal(isConsentCurrent('marketing', { granted: false, policy_version: CONSENT_POLICY_VERSION }), false);
  });

  test('ไม่มีแถว = ยังไม่เคยยินยอม', () => {
    assert.equal(isConsentCurrent('telemetry', null), false);
  });

  test('เวอร์ชันที่อ่านไม่ได้ (ข้อมูลเพี้ยน) = fail closed (ต้องขอใหม่)', () => {
    assert.equal(isConsentCurrent('analytics', { granted: true, policy_version: 'not-a-date' }), false);
  });

  test('bump นโยบายที่แตะเฉพาะ health → ขอใหม่เฉพาะ health (marketing ไม่ถูกถามซ้ำ)', () => {
    // จำลอง: นโยบายใหม่ 2027-01-01 แก้เฉพาะถ้อยคำสุขภาพ
    const nextVersion = '2027-01-01';
    const row = { granted: true, policy_version: CONSENT_POLICY_VERSION };
    assert.equal(isConsentCurrent('health', row, nextVersion), false, 'health ถูกแก้ → ต้องขอใหม่');
    assert.equal(
      isConsentCurrent('marketing', row, CONSENT_PURPOSE_REVISED_IN.marketing),
      true,
      'marketing ไม่ถูกแก้ → ไม่ต้องรบกวนผู้ใช้'
    );
  });

  test('ทุกวัตถุประสงค์ประกาศเวอร์ชันที่แก้ล่าสุดครบ และไม่ล้ำหน้าเวอร์ชันนโยบาย', () => {
    for (const spec of CONSENT_PURPOSES) {
      const revisedIn = CONSENT_PURPOSE_REVISED_IN[spec.key];
      assert.ok(revisedIn, `${spec.key} ต้องมีเวอร์ชันที่แก้ล่าสุด`);
      assert.ok(
        Date.parse(revisedIn) <= Date.parse(CONSENT_POLICY_VERSION),
        `${spec.key}: ${revisedIn} ล้ำหน้าเวอร์ชันนโยบาย ${CONSENT_POLICY_VERSION} (จะกลายเป็นขอใหม่ทั้งระบบ)`
      );
    }
  });
});

describe('re-consent — GET /api/consent บอกว่าตัวไหนต้องขอใหม่', () => {
  test('แยกวัตถุประสงค์: ของเก่า = needsReconsent, ของปัจจุบัน = ไม่ต้อง, ยังไม่เคยยอม = ไม่ใช่ "ขอใหม่"', async () => {
    seedConsent('marketing', true, '2000-01-01'); // ยอมรับใต้นโยบายเก่า
    seedConsent('analytics', true, CONSENT_POLICY_VERSION); // ยอมรับเวอร์ชันปัจจุบัน

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`, { headers: AUTH });
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;

      assert.equal(body.reconsentRequired, true, 'ต้องมีสัญญาณระดับบนให้ UI ขึ้นแบนเนอร์');
      assert.equal(purposeOf(body, 'marketing').needsReconsent, true);
      assert.equal(purposeOf(body, 'marketing').granted, true, 'ยังนับว่ายินยอมอยู่ แต่ต้องยืนยันฉบับใหม่');
      assert.equal(purposeOf(body, 'marketing').revisedIn, CONSENT_PURPOSE_REVISED_IN.marketing);
      assert.equal(purposeOf(body, 'analytics').needsReconsent, false);
      assert.equal(purposeOf(body, 'telemetry').needsReconsent, false, 'ยังไม่เคยยอม = ครั้งแรก ไม่ใช่ขอใหม่');
    });
  });

  test('ไม่มีใครต้องขอใหม่ → reconsentRequired false', async () => {
    seedConsent('analytics', true, CONSENT_POLICY_VERSION);
    await withServer(async (base) => {
      const body = (await (await fetch(`${base}/api/consent`, { headers: AUTH })).json()) as any;
      assert.equal(body.reconsentRequired, false);
    });
  });
});

describe('re-consent — ยืนยันใหม่ต้องเหลือหลักฐานครบ', () => {
  test('PUT granted=true เขียนเวอร์ชันใหม่ลงแถว + event ใหม่ และของเก่าไม่หาย', async () => {
    seedConsent('marketing', true, '2000-01-01');
    state.events.push({
      id: 'e-old',
      user_id: USER_ID,
      purpose: 'marketing',
      action: 'granted',
      policy_version: '2000-01-01',
      source: 'web',
      created_at: new Date('2000-01-01T00:00:00Z'),
    });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`, {
        method: 'PUT',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'marketing', granted: true }),
      });
      assert.equal(res.status, 200);

      assert.equal(
        state.consents.get(`${USER_ID}:marketing`)?.policy_version,
        CONSENT_POLICY_VERSION,
        'แถวปัจจุบันต้องอ้างเวอร์ชันที่ผู้ใช้เพิ่งยอมรับ'
      );
      assert.equal(state.events.length, 2, 'append-only: ของเก่าต้องไม่ถูกทับ');
      assert.equal(state.events[0].policy_version, '2000-01-01', 'หลักฐานเดิมต้องคงเวอร์ชันเดิม');
      assert.equal(state.events[1].policy_version, CONSENT_POLICY_VERSION, 'หลักฐานใหม่ต้องอ้างเวอร์ชันใหม่');
      assert.equal(state.events[1].action, 'granted');

      const after = (await (await fetch(`${base}/api/consent`, { headers: AUTH })).json()) as any;
      assert.equal(purposeOf(after, 'marketing').needsReconsent, false, 'ยืนยันใหม่แล้วต้องหลุดจากสถานะขอใหม่');
      assert.equal(after.reconsentRequired, false);
    });
  });
});

describe('re-consent — ด่านข้อมูลสุขภาพใช้กติกาเดียวกัน', () => {
  test('แถวเวอร์ชันเก่า → consent_version_stale', async () => {
    seedConsent('health', true, '2000-01-01');
    const result = await checkSensitiveConsent(USER_ID, 'health');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'consent_version_stale');
  });

  test('แถวเวอร์ชันปัจจุบัน → ผ่าน', async () => {
    seedConsent('health', true, CONSENT_POLICY_VERSION);
    const result = await checkSensitiveConsent(USER_ID, 'health');
    assert.equal(result.ok, true);
  });
});
