import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer, mockModel, makeToken } from './helpers';
import {
  extractExpiry,
  mapCategory,
  parseLabelResponse,
  extractJsonObject,
  analyzeProductLabel,
  createInventoryItem,
  prisma,
} from '../src/services/documents.service';
import documentsRoutes, { visionDeps } from '../src/modules/documents/documents.routes';

// ────────────────────────────────────────────────
// extractExpiry
// ────────────────────────────────────────────────
describe('extractExpiry', () => {
  test('parses ISO YYYY-MM-DD', () => {
    assert.equal(extractExpiry('2026-08-12'), '2026-08-12');
    assert.equal(extractExpiry('2026/8/3'), '2026-08-03');
  });

  test('parses DD/MM/YYYY and DD/MM/YY', () => {
    assert.equal(extractExpiry('12/08/2026'), '2026-08-12');
    assert.equal(extractExpiry('12.08.26'), '2026-08-12');
  });

  test('parses Thai month with Buddhist era (พ.ศ.)', () => {
    assert.equal(extractExpiry('15 ส.ค. 2569'), '2026-08-15');
    assert.equal(extractExpiry('31 ธันวาคม 2569'), '2026-12-31');
    assert.equal(extractExpiry('1 ม.ค. 2026'), '2026-01-01');
  });

  test('parses English month names', () => {
    assert.equal(extractExpiry('15 Aug 2026'), '2026-08-15');
    assert.equal(extractExpiry('Aug 15, 2026'), '2026-08-15');
  });

  test('month/year -> end of month', () => {
    assert.equal(extractExpiry('08/2026'), '2026-08-31');
    assert.equal(extractExpiry('2026-08'), '2026-08-31');
    assert.equal(extractExpiry('Feb 2026'), '2026-02-28');
    assert.equal(extractExpiry('ก.พ. 2569'), '2026-02-28');
  });

  test('invalid dates -> null', () => {
    assert.equal(extractExpiry(''), null);
    assert.equal(extractExpiry('garbage text'), null);
    assert.equal(extractExpiry('31/13/2026'), null); // เดือน 13
    assert.equal(extractExpiry('2026-02-31'), null); // ก.พ. ไม่มี 31
    assert.equal(extractExpiry(null), null);
    assert.equal(extractExpiry(undefined), null);
  });
});

// ────────────────────────────────────────────────
// mapCategory
// ────────────────────────────────────────────────
describe('mapCategory', () => {
  test('english categories', () => {
    assert.equal(mapCategory('FOOD'), 'FOOD');
    assert.equal(mapCategory('Water'), 'WATER');
    assert.equal(mapCategory('diesel'), 'FUEL');
    assert.equal(mapCategory('gold'), 'PRECIOUS_METAL');
    assert.equal(mapCategory('battery'), 'MATERIAL');
    assert.equal(mapCategory('spoon'), 'OTHER');
  });

  test('thai categories', () => {
    assert.equal(mapCategory('ข้าว'), 'FOOD');
    assert.equal(mapCategory('น้ำมัน'), 'FUEL');
    assert.equal(mapCategory('น้ำดื่ม'), 'WATER');
    assert.equal(mapCategory('ยา'), 'MEDICINE');
  });

  test('fuel wins over water (น้ำมัน has น้ำ)', () => {
    assert.equal(mapCategory('น้ำมัน'), 'FUEL');
  });
});

// ────────────────────────────────────────────────
// extractJsonObject + parseLabelResponse
// ────────────────────────────────────────────────
describe('parseLabelResponse', () => {
  const fullJson =
    'Here:\n```json\n{"name":"ปาสคอล นมสด","category":"FOOD","quantity":2,"unit":"piece","unit_price_usd":1.5,"expiry_date":"2026-08-15","shelf_life_days":365,"notes":"เก็บในที่เย็น"}\n```';

  test('extracts JSON from fence and fills all fields', () => {
    assert.ok(extractJsonObject(fullJson));
    const label = parseLabelResponse(fullJson);
    assert.equal(label.name, 'ปาสคอล นมสด');
    assert.equal(label.category, 'FOOD');
    assert.equal(label.quantity, 2);
    assert.equal(label.unit, 'piece');
    assert.equal(label.unit_price_usd, 1.5);
    assert.equal(label.expiry_date, '2026-08-15');
    assert.equal(label.shelf_life_days, 365);
    assert.equal(label.notes, 'เก็บในที่เย็น');
    assert.equal(label.warnings.length, 0);
  });

  test('missing name -> warning', () => {
    const label = parseLabelResponse('{"name":"","category":"OTHER"}');
    assert.equal(label.name, '');
    assert.ok(label.warnings.some((w) => w.includes('ชื่อสินค้า')));
  });

  test('invalid category -> OTHER + warning', () => {
    const label = parseLabelResponse('{"name":"x","category":"SNACKS"}');
    assert.equal(label.category, 'OTHER');
    assert.ok(label.warnings.some((w) => w.includes('หมวด')));
  });

  test('unparseable expiry -> null + warning', () => {
    const label = parseLabelResponse('{"name":"x","expiry_date":"ta thae"}');
    assert.equal(label.expiry_date, null);
    assert.ok(label.warnings.some((w) => w.includes('หมดอายุ')));
  });

  test('cleans numeric fields', () => {
    const label = parseLabelResponse('{"name":"x","quantity":-3,"unit_price_usd":"abc","shelf_life_days":0.5}');
    assert.equal(label.quantity, null);
    assert.equal(label.unit_price_usd, null);
    assert.equal(label.shelf_life_days, null); // < 1 วัน ไม่เข้าข่าย
  });

  test('non-JSON response -> empty label + warning', () => {
    const label = parseLabelResponse('I cannot read the label clearly.');
    assert.equal(label.name, '');
    assert.ok(label.warnings.length > 0);
  });
});

// ────────────────────────────────────────────────
// analyzeProductLabel (vitest-free: mock post)
// ────────────────────────────────────────────────
describe('analyzeProductLabel', () => {
  test('calls vision model and maps result', async () => {
    let calledWith: any = null;
    const post = async (_url: string, body: unknown, _opts: unknown) => {
      calledWith = body;
      return { data: { response: '{"name":"ปลากระป๋อง","category":"food","quantity":1,"expiry_date":"12/08/2026"}' } };
    };
    const label = await analyzeProductLabel('data:image/jpeg;base64,XYZ', { post });
    assert.equal(label.name, 'ปลากระป๋อง');
    assert.equal(label.category, 'FOOD');
    assert.equal(label.expiry_date, '2026-08-12');
    assert.ok(calledWith.images.length === 1);
    assert.equal(calledWith.images[0], 'data:image/jpeg;base64,XYZ');
  });
});

// ────────────────────────────────────────────────
// createInventoryItem
// ────────────────────────────────────────────────
describe('createInventoryItem', () => {
  test('creates item with computed expiry from shelf_life_days', async () => {
    let data: any = null;
    mockModel(prisma, 'inventoryItem', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'item-1', ...args.data };
      },
    });
    const id = await createInventoryItem({
      name: 'ข้าวหอมมะลิ 5kg',
      category: 'FOOD',
      quantity: 1,
      unit: 'bag',
      unit_price_usd: 12,
      expiry_date: null,
      shelf_life_days: 365,
      notes: null,
      warnings: [],
    });
    assert.equal(id, 'item-1');
    assert.equal(data.name, 'ข้าวหอมมะลิ 5kg');
    assert.equal(data.category, 'FOOD');
    assert.equal(data.shelf_life_days, 365);
    assert.ok(data.expiry_date instanceof Date);
    assert.equal(data.location, null);
  });

  test('uses explicit expiry_date when given', async () => {
    let data: any = null;
    mockModel(prisma, 'inventoryItem', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'item-2', ...args.data };
      },
    });
    await createInventoryItem({
      name: 'นมสด',
      category: 'FOOD',
      quantity: 2,
      unit: 'piece',
      unit_price_usd: 0,
      expiry_date: '2026-09-01',
      shelf_life_days: null,
      notes: null,
      warnings: [],
    });
    assert.equal(data.expiry_date.toISOString(), '2026-09-01T00:00:00.000Z');
  });
});

// ────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────
describe('documents routes', () => {
  const token = makeToken('SUPERADMIN');

  test('POST /analyze without file -> 400', async () => {
    const ts = await createTestServer((app) => app.use('/', documentsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'No image file uploaded');
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze rejects non-image -> 400', async () => {
    const ts = await createTestServer((app) => app.use('/', documentsRoutes));
    try {
      const form = new FormData();
      form.append('image', new Blob(['hi'], { type: 'text/plain' }), 'a.txt');
      const res = await fetch(`${ts.baseUrl}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'Invalid image upload');
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze with image runs AI and returns label', async () => {
    visionDeps.post = async (_url: string, _body: unknown, _opts: unknown) => ({
      data: { response: '{"name":"น้ำเปล่า 1.5L","category":"water","quantity":6,"unit":"bottle","expiry_date":"2027-01-01"}' },
    });
    const ts = await createTestServer((app) => app.use('/', documentsRoutes));
    try {
      const form = new FormData();
      form.append('image', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'label.jpg');
      const res = await fetch(`${ts.baseUrl}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.name, 'น้ำเปล่า 1.5L');
      assert.equal(body.category, 'WATER');
      assert.equal(body.expiry_date, '2027-01-01');
    } finally {
      visionDeps.post = undefined;
      await ts.close();
    }
  });

  test('POST /scan-to-inventory with JSON parsed saves item', async () => {
    let data: any = null;
    mockModel(prisma, 'inventoryItem', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'inv-1', ...args.data };
      },
    });
    const ts = await createTestServer((app) => app.use('/', documentsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/scan-to-inventory`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parsed: {
            name: 'ปลากระป๋อง 3 ภาษา',
            category: 'FOOD',
            quantity: 12,
            unit: 'can',
            unit_price_usd: 2.5,
            expiry_date: '2027-06-30',
            shelf_life_days: null,
            notes: 'จากสแกนฉลาก',
          },
        }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.id, 'inv-1');
      assert.equal(data.name, 'ปลากระป๋อง 3 ภาษา');
      assert.equal(data.quantity, 12);
      assert.equal(data.expiry_date.toISOString(), '2027-06-30T00:00:00.000Z');
    } finally {
      await ts.close();
    }
  });

  test('POST /scan-to-inventory rejects missing name', async () => {
    let createCalls = 0;
    mockModel(prisma, 'inventoryItem', {
      create: async () => {
        createCalls++;
        return { id: 'x' };
      },
    });
    const ts = await createTestServer((app) => app.use('/', documentsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/scan-to-inventory`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed: { category: 'FOOD', quantity: 1 } }),
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'name is required');
      assert.equal(createCalls, 0);
    } finally {
      await ts.close();
    }
  });

  test('POST /scan-to-inventory multipart: AI + overrides + save', async () => {
    visionDeps.post = async () => ({ data: { response: '{"name":"ข้าวหอมมะลิ","category":"FOOD","shelf_life_days":365}' } });
    let data: any = null;
    mockModel(prisma, 'inventoryItem', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'inv-2', ...args.data };
      },
    });
    const ts = await createTestServer((app) => app.use('/', documentsRoutes));
    try {
      const form = new FormData();
      form.append('image', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'rice.jpg');
      form.append('quantity', '3');
      const res = await fetch(`${ts.baseUrl}/scan-to-inventory`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      assert.equal(res.status, 201);
      assert.equal(data.name, 'ข้าวหอมมะลิ');
      assert.equal(data.quantity, 3); // override 11 -> 3?  AI ปล่อย quantity null -> override 3
      assert.equal(data.shelf_life_days, 365);
      assert.ok(data.expiry_date instanceof Date);
    } finally {
      visionDeps.post = undefined;
      await ts.close();
    }
  });

  test('scan-to-inventory requires write role', async () => {
    const viewer = makeToken('VIEWER');
    const ts = await createTestServer((app) => app.use('/', documentsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/scan-to-inventory`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${viewer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed: { name: 'x', category: 'OTHER' } }),
      });
      assert.equal(res.status, 403);
    } finally {
      await ts.close();
    }
  });
});