import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import healthRoutes from '../src/modules/health/health.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Health Screening — Herbal Safety & Action Engine (mock suite, ไม่แตะ DB จริง)
// ครอบ: validation อาการ · เกณฑ์ ≥3 ครั้ง/14 วัน → flag · consent ·
// contraindication (ขมิ้นชัน×โรคไต ฯลฯ) · export CSV/HTML
// ────────────────────────────────────────────────────────────────────────────

const TOKEN = makeToken('SUPERADMIN');
const H = { Authorization: `Bearer ${TOKEN}` };

// ── in-memory stores ──
const observations = new Map<string, any>();
const flags = new Map<string, any>();
const consents = new Map<string, any>();
let profile: any = null;
let seq = 0;
const nid = () => `row-${++seq}`;

before(async () => {
  (prisma as any).healthObservation = {
    create: async ({ data }: any) => {
      const row = { id: nid(), created_at: new Date(), ...data };
      observations.set(row.id, row);
      return row;
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let list = [...observations.values()];
      if (where?.category) list = list.filter((r) => r.category === where.category);
      if (where?.observed_at?.gte) list = list.filter((r) => r.observed_at >= where.observed_at.gte);
      if (orderBy?.observed_at === 'desc') list = list.sort((a, b) => b.observed_at - a.observed_at);
      if (orderBy?.observed_at === 'asc') list = list.sort((a, b) => a.observed_at - b.observed_at);
      return list.slice(0, take ?? list.length);
    },
    groupBy: async ({ where }: any) => {
      const counts = new Map<string, number>();
      for (const r of observations.values()) {
        if (where?.observed_at?.gte && r.observed_at < where.observed_at.gte) continue;
        counts.set(r.category, (counts.get(r.category) || 0) + 1);
      }
      return [...counts.entries()].map(([category, n]) => ({ category, _count: { _all: n } }));
    },
    delete: async ({ where }: any) => {
      const row = observations.get(where.id);
      if (!row) throw new Error('Record to delete does not exist');
      observations.delete(where.id);
      return row;
    },
  };

  (prisma as any).healthFlag = {
    create: async ({ data }: any) => {
      const row = { id: nid(), status: 'PENDING', created_at: new Date(), cleared_at: null, ...data };
      flags.set(row.id, row);
      return row;
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let list = [...flags.values()];
      if (where?.status) list = list.filter((f) => f.status === where.status);
      if (orderBy?.created_at === 'desc') list = list.sort((a, b) => b.created_at - a.created_at);
      return list.slice(0, take ?? list.length);
    },
    update: async ({ where, data }: any) => {
      const row = flags.get(where.id);
      if (!row) throw new Error('Record to update not found');
      const merged = { ...row, ...data };
      flags.set(row.id, merged);
      return merged;
    },
  };

  (prisma as any).healthConsent = {
    findMany: async () => [...consents.values()],
    create: async ({ data }: any) => {
      const row = { id: nid(), created_at: new Date(), ...data };
      consents.set(row.id, row);
      return row;
    },
    upsert: async ({ where, update, create }: any) => {
      const key = where.user_id_category
        ? `${where.user_id_category.user_id}:${where.user_id_category.category}`
        : `global:${where.category}`;
      const existing = [...consents.values()].find(
        (c) => (where.user_id_category ? `${c.user_id}:${c.category}` === key : c.user_id == null && c.category === where.category)
      );
      if (existing) {
        const merged = { ...existing, ...update };
        consents.set(existing.id, merged);
        return merged;
      }
      const row = { id: nid(), created_at: new Date(), ...create };
      consents.set(row.id, row);
      return row;
    },
  };

  (prisma as any).healthProfile = {
    findFirst: async ({ where }: any = {}) => {
      if (profile && where?.user_id && profile.user_id !== where.user_id) return null;
      return profile;
    },
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
});

let ts: TestServer;
before(async () => {
  ts = await createTestServer((app) => app.use('/api/health', healthRoutes));
});
after(async () => {
  await ts.close(); // ปิด server — ไม่งั้น event loop ค้าง ตัวรันเทสไม่ยอมจบ
});

// ─── Observations: validation + บันทึก ───

test('POST /observations ปฏิเสธหมวดที่ไม่รู้จักด้วย 400 + รายการหมวดที่มี', async () => {
  const res = await fetch(`${ts.baseUrl}/api/health/observations`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'LOVE_LIFE' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.includes('SLEEP'), 'error ต้องบอกหมวดที่ใช้ได้');
});

test('POST /observations ต้องมี token → 401', async () => {
  const res = await fetch(`${ts.baseUrl}/api/health/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'SLEEP' }),
  });
  assert.equal(res.status, 401);
});

test('POST /observations ตัด detail เกิน 500 ตัวอักษร + จำกัด severity 1-5 + default source=manual', async () => {
  const res = await fetch(`${ts.baseUrl}/api/health/observations`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'SLEEP', detail: 'x'.repeat(900), severity: 99, source: '   ' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.observation.detail.length, 500);
  assert.equal(body.observation.severity, 5);
  assert.equal(body.observation.source, 'manual');
  assert.equal(body.flag, null, 'ครั้งเดียวยังไม่ถึงเกณฑ์ → ไม่มี flag');
});

test('อาการซ้ำครบ 3 ครั้งใน 14 วัน → สร้าง flag PENDING พร้อมโน้ตภาษาไทย (ครั้งถัดไปไม่ซ้ำ)', async () => {
  // SLEEP มีอยู่ 1 ครั้งจากเทสก่อนหน้า — เติมอีก 2 ให้ถึงเกณฑ์ (ครั้งที่ 3 = ครั้งสุดท้ายของลูป)
  let last: any;
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${ts.baseUrl}/api/health/observations`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'SLEEP', detail: `นอนไม่หลับคืนที่ ${i + 2}` }),
    });
    assert.equal(r.status, 201);
    last = await r.json();
  }
  // ครั้งที่ 3 ถึงเกณฑ์ → flag ถูกสร้างพร้อมคำตอบของครั้งนั้นเอง
  assert.equal(last.count, 3);
  assert.equal(last.triggered, true);
  assert.ok(last.flag, 'ต้องสร้าง flag ครั้งแรกที่ถึงเกณฑ์');
  assert.equal(last.flag.flag_type, 'CHECK_SLEEP');
  assert.ok(last.flag.note.includes('การนอนหลับ'));
  assert.equal(last.flag.status, 'PENDING');

  // ครั้งที่ 4 — มี pending อยู่แล้ว → ไม่สร้างซ้ำ
  const again = await fetch(`${ts.baseUrl}/api/health/observations`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'SLEEP' }),
  });
  const body2 = await again.json();
  assert.equal(body2.flag, null, 'pending ซ้ำห้ามสร้าง flag ทับ');
  assert.equal(body2.pendingFlag, true);
  assert.equal(body2.count, 4);
});

test('GET /observations กรองตาม category + จำกัด limit', async () => {
  const res = await fetch(`${ts.baseUrl}/api/health/observations?category=SLEEP&limit=2`, { headers: H });
  const rows = await res.json();
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.category, 'SLEEP');
});

test('DELETE /observations/:id ลบจริง + ไม่พบ → 404', async () => {
  const created = await fetch(`${ts.baseUrl}/api/health/observations`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'FEVER' }),
  });
  const { observation } = await created.json();

  const del = await fetch(`${ts.baseUrl}/api/health/observations/${observation.id}`, { method: 'DELETE', headers: H });
  assert.equal(del.status, 200);

  const delAgain = await fetch(`${ts.baseUrl}/api/health/observations/${observation.id}`, { method: 'DELETE', headers: H });
  assert.equal(delAgain.status, 404);
});

// ─── Flags: micro-triage ───

test('POST /flags ปฏิเสธ category นอกระบบ + สร้างด้วยมือได้ (flag_type default)', async () => {
  const bad = await fetch(`${ts.baseUrl}/api/health/flags`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'NOT_REAL' }),
  });
  assert.equal(bad.status, 400);

  const res = await fetch(`${ts.baseUrl}/api/health/flags`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'FATIGUE', note: 'AI Agent แจ้ง' }),
  });
  assert.equal(res.status, 201);
  const flag = await res.json();
  assert.equal(flag.flag_type, 'CHECK_FATIGUE', 'ไม่ส่ง flag_type → ใช้ CHECK_<category>');
  assert.equal(flag.flag_type.length <= 50, true);

  const manual = await fetch(`${ts.baseUrl}/api/health/flags`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'MOOD', flag_type: 'x'.repeat(80), note: 'n'.repeat(400) }),
  });
  const mflag = await manual.json();
  assert.equal(mflag.flag_type.length, 50, 'flag_type ถูกตัดที่ 50');
  assert.equal(mflag.note.length, 300, 'note ถูกตัดที่ 300');
});

test('GET /flags?status=PENDING กรองเฉพาะ pending + clear/address เปลี่ยนสถานะจริง', async () => {
  const list = await (await fetch(`${ts.baseUrl}/api/health/flags?status=PENDING`, { headers: H })).json();
  assert.ok(list.length >= 1);
  assert.ok(list.every((f: any) => f.status === 'PENDING'));

  const target = list[0];
  const cleared = await (await fetch(`${ts.baseUrl}/api/health/flags/${target.id}/clear`, { method: 'POST', headers: H })).json();
  assert.equal(cleared.status, 'CLEARED');
  assert.ok(cleared.cleared_at);

  const addressed = await (await fetch(`${ts.baseUrl}/api/health/flags/${list[1].id}/address`, { method: 'POST', headers: H })).json();
  assert.equal(addressed.status, 'ADDRESSED');

  const missing = await fetch(`${ts.baseUrl}/api/health/flags/nope/clear`, { method: 'POST', headers: H });
  assert.equal(missing.status, 404);
});

// ─── Consents: privacy control ───

test('GET /consents สร้าง default ครบ 3 หมวดครั้งแรก และไม่ซ้ำครั้งที่สอง', async () => {
  const first = await (await fetch(`${ts.baseUrl}/api/health/consents`, { headers: H })).json();
  assert.deepEqual(first.map((c: any) => c.category).sort(), ['conversation', 'export', 'telemetry']);
  assert.ok(first.every((c: any) => c.granted === true));

  const second = await (await fetch(`${ts.baseUrl}/api/health/consents`, { headers: H })).json();
  assert.equal(second.length, first.length, 'ครั้งที่สองต้องไม่เพิ่มแถว');
});

test('PUT /consents เปลี่ยน granted จริง + ข้ามค่าที่ไม่ใช่ boolean', async () => {
  const res = await fetch(`${ts.baseUrl}/api/health/consents`, {
    method: 'PUT',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation: false, telemetry: 'yes', bogus: false }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  const conv = updated.find((c: any) => c.category === 'conversation');
  assert.equal(conv.granted, false, 'conversation ต้องถูกปิด');
  assert.equal(updated.filter((c: any) => c.category === 'telemetry').length, 0, 'granted ไม่ใช่ boolean → ข้าม');
});

// ─── Profile + contraindication ───

test('PUT/GET /profile เก็บ conditions/medications + contraindication บล็อกขมิ้นชันเมื่อมีโรคไต', async () => {
  const put = await fetch(`${ts.baseUrl}/api/health/profile`, {
    method: 'PUT',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ conditions: ['kidney_disease'], medications: [] }),
  });
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.deepEqual(saved.conditions, ['kidney_disease']);

  const got = await (await fetch(`${ts.baseUrl}/api/health/profile`, { headers: H })).json();
  assert.deepEqual(got.conditions, ['kidney_disease']);

  // ทำให้ DIGESTION ถึงเกณฑ์ → คำแนะนำคือขมิ้นชัน แต่โรคไต = ห้ามใช้
  for (let i = 0; i < 3; i++) {
    await fetch(`${ts.baseUrl}/api/health/observations`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'DIGESTION' }),
    });
  }
  const recs = await (await fetch(`${ts.baseUrl}/api/health/herbal-recommendations`, { headers: H })).json();
  const turmeric = recs.recommendations.find((r: any) => r.herbId === 'turmeric');
  assert.ok(turmeric, 'ขมิ้นชันต้องถูกแนะนำเมื่อท้องอืดซ้ำ 3 ครั้ง');
  assert.equal(turmeric.recommended, false, 'แต่โรคไต → ห้ามใช้');
  assert.ok(turmeric.blockedReasons.includes('โรคไต'));
  assert.ok(turmeric.disclaimer.includes('ไม่ใช่การวินิจฉัยโรค'));
});

test('herbal-recommendations ไม่บล็อกเมื่อไม่มีโรคประจำตัว + ไม่แนะนำหมวด OTHER', async () => {
  const recs = await (await fetch(`${ts.baseUrl}/api/health/herbal-recommendations`, { headers: H })).json();
  const sleep = recs.recommendations.find((r: any) => r.herbId === 'safflower');
  assert.ok(sleep);
  assert.equal(sleep.recommended, true);
  assert.deepEqual(sleep.blockedReasons, []);
  assert.ok(!recs.recommendations.some((r: any) => r.herbId === 'none'), 'หมวด OTHER ไม่มีสมุนไพร → ไม่อยู่ในคำแนะนำ');
});

// ─── Overview + Export ───

test('GET /overview รวม counts/observations/flags/consents/profile ในคำตอบเดียว', async () => {
  const res = await fetch(`${ts.baseUrl}/api/health/overview`, { headers: H });
  const body = await res.json();
  assert.equal(body.counts.length, 8, 'ครบ 8 หมวด (รวมหมวดที่นับ 0)');
  const sleep = body.counts.find((c: any) => c.category === 'SLEEP');
  assert.ok(sleep.count >= 4);
  assert.equal(sleep.threshold, 3);
  assert.equal(sleep.triggered, true);
  assert.ok(body.profile.conditions.includes('kidney_disease'));
  assert.ok(Array.isArray(body.flags) && body.flags.length >= 2);
  assert.ok(Array.isArray(body.consents));
});

test('GET /export?format=csv ต้อง escape quote + แนบ Content-Disposition', async () => {
  await fetch(`${ts.baseUrl}/api/health/observations`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'APPETITE', detail: 'กิน"จัง' }),
  });
  const res = await fetch(`${ts.baseUrl}/api/health/export?format=csv&days=30`, { headers: H });
  assert.ok(res.headers.get('content-type').includes('text/csv'));
  assert.ok(res.headers.get('content-disposition').includes('health-report-30d.csv'));
  const csv = await res.text();
  assert.ok(csv.startsWith('observed_at,category,severity,source,detail'));
  assert.ok(csv.includes('"กิน""จัง"'), 'quote ใน detail ต้องถูก escape เป็น ""');
});

test('GET /export (html) มี disclaimer + ห้าม days เกิน 90', async () => {
  const res = await fetch(`${ts.baseUrl}/api/health/export?format=html&days=999`, { headers: H });
  assert.ok(res.headers.get('content-type').includes('text/html'));
  const html = await res.text();
  assert.ok(html.includes('รายงานสุขภาพย้อนหลัง 90 วัน'), 'days=999 ถูก clamp เหลือ 90');
  assert.ok(html.includes('ไม่ใช่การวินิจฉัย'));
});
