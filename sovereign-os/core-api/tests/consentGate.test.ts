import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import healthRoutes from '../src/modules/health/health.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';
import { CONSENT_POLICY_VERSION } from '../src/services/consent.service';

// ────────────────────────────────────────────────────────────────────────────
// ด่านความยินยอมจริง (PDPA) — ข้อมูลสุขภาพเขียนไม่ได้ถ้ายังไม่ยินยอม
//
// ทำไมต้องมี: ศูนย์ความยินยอม + หลักฐานมีอยู่แล้ว แต่ไม่มีจุดใด *บล็อก* การเขียน
// ⇒ ระบบเก็บข้อมูลอ่อนไดส้วยอยู่ได้แม้ผู้ใช้ไม่เคยยินยอม = ขายไม่ได้/ผิดกฎหมาย
//
// กติกาที่เทสต์นี้ล็อกไว้:
//   · ไม่มีแถวความยินยอม = 403 `consent_required` (ค่าเริ่มต้นคือ "ไม่ยินยอม")
//   · ให้ความยินยอมแล้วเขียนได้ · ถอนแล้วเขียนอีก = 403
//   · แถวที่เป็นของนโยบายเวอร์ชันเก่า = 403 `consent_version_stale` (ต้องขอใหม่)
//   · สวิตช์เก่าของโมดูลสุขภาพ (health_consents.conversation=false) ยังถอนได้
//   · ลบข้อมูล (DELETE) ยังทำได้เสมอ — สิทธิ์ของเจ้าของข้อมูล
// ────────────────────────────────────────────────────────────────────────────

const TOKEN = makeToken('SUPERADMIN');
const H = { Authorization: `Bearer ${TOKEN}` };
// id ของผู้ใช้จาก makeToken (SUPERADMIN = 'test-user') — ต้องตรงกับ req.user.id
const USER_ID = 'test-user';

let seq = 0;
const nid = () => `row-${++seq}`;

const observations = new Map<string, any>();
const flags = new Map<string, any>();
const legacyConsents = new Map<string, any>();
/** key = `${user_id}:${purpose}` */
const pdpaConsents = new Map<string, any>();
const consentEvents: any[] = [];
let profile: any = null;

function seedConsent(purpose: string, granted: boolean, policyVersion = CONSENT_POLICY_VERSION) {
  pdpaConsents.set(`${USER_ID}:${purpose}`, {
    id: nid(),
    user_id: USER_ID,
    purpose,
    granted,
    policy_version: policyVersion,
    updated_at: new Date(),
    granted_at: granted ? new Date() : null,
    revoked_at: granted ? null : new Date(),
  });
}

function clearConsent(purpose: string) {
  pdpaConsents.delete(`${USER_ID}:${purpose}`);
}

before(async () => {
  (prisma as any).healthObservation = {
    create: async ({ data }: any) => {
      const row = { id: nid(), created_at: new Date(), ...data };
      observations.set(row.id, row);
      return row;
    },
    findMany: async ({ take }: any = {}) => [...observations.values()].slice(0, take ?? 50),
    groupBy: async () => [],
    delete: async ({ where }: any) => {
      const row = observations.get(where.id);
      if (!row) throw new Error('Record to delete does not exist');
      observations.delete(where.id);
      return row;
    },
  };

  (prisma as any).healthFlag = {
    create: async ({ data }: any) => {
      const row = { id: nid(), status: 'PENDING', created_at: new Date(), ...data };
      flags.set(row.id, row);
      return row;
    },
    findMany: async () => [...flags.values()],
  };

  (prisma as any).healthConsent = {
    findMany: async () => [...legacyConsents.values()],
    findFirst: async ({ where }: any = {}) => {
      if (!where) return null;
      return [...legacyConsents.values()].find(
        (c) => c.category === where.category && (where.user_id ? c.user_id === where.user_id : c.user_id == null)
      ) ?? null;
    },
    create: async ({ data }: any) => {
      const row = { id: nid(), created_at: new Date(), ...data };
      legacyConsents.set(row.id, row);
      return row;
    },
    upsert: async ({ where, update, create }: any) => {
      const key = where.user_id_category
        ? `${where.user_id_category.user_id}:${where.user_id_category.category}`
        : `global:${where.category}`;
      const existing = [...legacyConsents.values()].find((c) =>
        where.user_id_category
          ? `${c.user_id}:${c.category}` === key
          : c.user_id == null && c.category === where.category
      );
      if (existing) {
        const merged = { ...existing, ...update };
        legacyConsents.set(existing.id, merged);
        return merged;
      }
      const row = { id: nid(), created_at: new Date(), ...create };
      legacyConsents.set(row.id, row);
      return row;
    },
  };

  (prisma as any).healthProfile = {
    findFirst: async () => profile,
    create: async ({ data }: any) => {
      profile = { id: nid(), ...data };
      return profile;
    },
    update: async ({ where, data }: any) => {
      if (profile?.id !== where.id) throw new Error('Record to update not found');
      profile = { ...profile, ...data };
      return profile;
    },
  };

  (prisma as any).userConsent = {
    findMany: async ({ where }: any = {}) =>
      [...pdpaConsents.values()].filter((row) => (where?.user_id ? row.user_id === where.user_id : true)),
    findUnique: async ({ where }: any) => {
      const key = where.user_id_purpose;
      return pdpaConsents.get(`${key.user_id}:${key.purpose}`) ?? null;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.user_id_purpose;
      const mapKey = `${key.user_id}:${key.purpose}`;
      const existing = pdpaConsents.get(mapKey);
      const row = existing ? { ...existing, ...update } : { id: nid(), ...create };
      pdpaConsents.set(mapKey, row);
      return row;
    },
  };

  (prisma as any).consentEvent = {
    create: async ({ data }: any) => {
      const row = { id: nid(), created_at: new Date(), ...data };
      consentEvents.push(row);
      return row;
    },
  };
});

let ts: TestServer;
before(async () => {
  ts = await createTestServer((app) => app.use('/api/health', healthRoutes));
});
after(async () => {
  await ts.close();
});

// ทุกเทสต์เริ่มจาก "ยังไม่เคยให้ความยินยอม" — สถานะจริงของผู้ใช้ใหม่
beforeEach(() => {
  clearConsent('health');
  legacyConsents.clear();
  observations.clear();
  flags.clear();
  profile = null;
});

const post = (path: string, body: unknown) =>
  fetch(`${ts.baseUrl}${path}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const put = (path: string, body: unknown) =>
  fetch(`${ts.baseUrl}${path}`, {
    method: 'PUT',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ─── ด่านหลัก: ไม่ยินยอม = เขียนไม่ได้ ───

test('POST /observations ไม่มีแถวความยินยอม → 403 consent_required + ไม่บันทึกแถว', async () => {
  const res = await post('/api/health/observations', { category: 'SLEEP', detail: 'นอนไม่หลับ' });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'consent_required');
  assert.equal(body.purpose, 'health');
  assert.equal(body.policyVersion, CONSENT_POLICY_VERSION);
  assert.ok(body.consentUrl, 'ต้องบอกทางไปให้ความยินยอม');
  assert.equal(observations.size, 0, 'ห้ามเขียนข้อมูลลงตารางก่อนได้รับความยินยอม');
});

test('POST /observations ให้ความยินยอมแล้ว → 201 (ของเดิมต้องไม่พัง)', async () => {
  seedConsent('health', true);
  const res = await post('/api/health/observations', { category: 'SLEEP', detail: 'นอนไม่หลับ' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.observation.category, 'SLEEP');
  assert.equal(observations.size, 1);
});

test('ถอนความยินยอมแล้วเขียนใหม่ → 403 และไม่มีแถวใหม่', async () => {
  seedConsent('health', true);
  const granted = await post('/api/health/observations', { category: 'SLEEP' });
  assert.equal(granted.status, 201);

  seedConsent('health', false); // ถอน (granted=false)
  const denied = await post('/api/health/observations', { category: 'SLEEP' });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'consent_required');
  assert.equal(observations.size, 1, 'แถวเดิมยังอยู่ ไม่มีแถวใหม่');
});

test('ความยินยอมนโยบายเวอร์ชันเก่า → 403 consent_version_stale (ต้องขอความยินยอมใหม่)', async () => {
  seedConsent('health', true, '2025-01-01');
  const res = await post('/api/health/observations', { category: 'SLEEP' });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'consent_version_stale');
  assert.equal(body.policyVersion, CONSENT_POLICY_VERSION);
  assert.equal(observations.size, 0);
});

test('POST /flags และ PUT /profile ก็ถูกด่านเดียวกันกั้น', async () => {
  const flag = await post('/api/health/flags', { category: 'FATIGUE', note: 'AI แจ้ง' });
  assert.equal(flag.status, 403);
  const saveProfile = await put('/api/health/profile', { conditions: ['kidney_disease'] });
  assert.equal(saveProfile.status, 403);
  assert.equal(flags.size, 0);
  assert.equal(profile, null);
});

test('ให้ความยินยอมแล้ว POST /flags + PUT /profile ผ่าน', async () => {
  seedConsent('health', true);
  const flag = await post('/api/health/flags', { category: 'FATIGUE' });
  assert.equal(flag.status, 201);
  const saved = await put('/api/health/profile', { conditions: ['kidney_disease'] });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).conditions, ['kidney_disease']);
});

// ─── สิทธิ์ของเจ้าของข้อมูล: ลบได้แม้ไม่ยินยอม ───

test('DELETE /observations/:id ยังทำได้แม้ไม่มีความยินยอม (สิทธิ์ลบข้อมูล)', async () => {
  // สร้างแถวตรงในหน่วยความจำ — จำลองข้อมูลเก่าที่มีอยู่ก่อนมีด่าน
  const row = { id: 'old-row', category: 'SLEEP', severity: 1, source: 'manual', observed_at: new Date(), created_at: new Date() };
  observations.set(row.id, row);

  const res = await fetch(`${ts.baseUrl}/api/health/observations/${row.id}`, { method: 'DELETE', headers: H });
  assert.equal(res.status, 200);
  assert.equal(observations.size, 0);
});

// ─── สวิตช์เก่าของโมดูลสุขภาพยังถอนได้ (ผูกกับด่านเดียว) ───

test('health_consents.conversation=false กั้นการเขียนถึงแม้ PDPA ยังบอกว่ายินยอม', async () => {
  seedConsent('health', true);
  legacyConsents.set('legacy-1', { id: 'legacy-1', user_id: USER_ID, category: 'conversation', granted: false });

  const res = await post('/api/health/observations', { category: 'SLEEP' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'consent_legacy_revoked');
});

test('PUT /health/consents {conversation:false} ถอน PDPA health จริง และ {conversation:true} ให้คืน', async () => {
  seedConsent('health', true);

  const revoke = await put('/api/health/consents', { conversation: false });
  assert.equal(revoke.status, 200);
  assert.equal(pdpaConsents.get(`${USER_ID}:health`)?.granted, false, 'ต้องเขียนลงตาราง PDPA ด้วย');
  assert.ok(consentEvents.some((e) => e.purpose === 'health' && e.action === 'revoked'));

  const blocked = await post('/api/health/observations', { category: 'SLEEP' });
  assert.equal(blocked.status, 403);

  const grant = await put('/api/health/consents', { conversation: true });
  assert.equal(grant.status, 200);
  assert.equal(pdpaConsents.get(`${USER_ID}:health`)?.granted, true);
  const allowed = await post('/api/health/observations', { category: 'SLEEP' });
  assert.equal(allowed.status, 201);
});

test('GET /health/consents แสดง conversation ตามความยินยอม PDPA จริง (ไม่ใช่ค่า default ของตารางเก่า)', async () => {
  const before = await (await fetch(`${ts.baseUrl}/api/health/consents`, { headers: H })).json();
  assert.equal(
    before.find((c: any) => c.category === 'conversation').granted,
    false,
    'ยังไม่เคยยินยอม = ต้องโชว์ปิด ไม่ใช่โชว์เปิดตามค่า default'
  );

  seedConsent('health', true);
  const after = await (await fetch(`${ts.baseUrl}/api/health/consents`, { headers: H })).json();
  assert.equal(after.find((c: any) => c.category === 'conversation').granted, true);
});

// ─── ฐานกฎหมายอื่น: วัตถุประสงค์จำเป็นไม่ต้องมีแถว ───

test('วัตถุประสงค์จำเป็น (essential) ไม่ต้องมีแถวก็ผ่าน — ไม่ใช่ด่านเดียวกัน', async () => {
  const { checkSensitiveConsent } = await import('../src/services/consent-gate.service');
  const result = await checkSensitiveConsent(USER_ID, 'essential');
  assert.equal(result.ok, true);
});

test('อ่านอย่างเดียวไม่ถูกกั้น (GET observations/profile) แม้ไม่ยินยอม', async () => {
  const list = await fetch(`${ts.baseUrl}/api/health/observations`, { headers: H });
  assert.equal(list.status, 200);
  const prof = await fetch(`${ts.baseUrl}/api/health/profile`, { headers: H });
  assert.equal(prof.status, 200);
});
