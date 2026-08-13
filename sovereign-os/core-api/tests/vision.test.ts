import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer, mockModel, makeToken } from './helpers';
import {
  normalizeLabel,
  parseVisionResponse,
  callVision,
  runVisionAnalysis,
  prisma,
  VISION_MODEL,
  OLLAMA_URL,
} from '../src/services/vision.service';
import visionRoutes from '../src/modules/vision/vision.routes';

// ────────────────────────────────────────────────
// normalizeLabel
// ────────────────────────────────────────────────
describe('normalizeLabel', () => {
  test('maps english labels', () => {
    assert.equal(normalizeLabel('person'), 'person');
    assert.equal(normalizeLabel('Human'), 'person');
    assert.equal(normalizeLabel('intruder'), 'person');
    assert.equal(normalizeLabel('car'), 'vehicle');
    assert.equal(normalizeLabel('Motorcycle'), 'vehicle');
    assert.equal(normalizeLabel('dog'), 'animal');
    assert.equal(normalizeLabel('snake'), 'venomous');
    assert.equal(normalizeLabel('scorpion'), 'venomous');
    assert.equal(normalizeLabel('table'), 'other');
  });

  test('maps thai labels', () => {
    assert.equal(normalizeLabel('คน'), 'person');
    assert.equal(normalizeLabel('โจร'), 'person');
    assert.equal(normalizeLabel('รถ'), 'vehicle');
    assert.equal(normalizeLabel('มอเตอร์ไซค์'), 'vehicle');
    assert.equal(normalizeLabel('แมว'), 'animal');
    assert.equal(normalizeLabel('งู'), 'venomous');
  });

  test('venomous takes priority over animal', () => {
    assert.equal(normalizeLabel('spider'), 'venomous');
  });

  test('non-string / empty -> other', () => {
    assert.equal(normalizeLabel(undefined), 'other');
    assert.equal(normalizeLabel(''), 'other');
    assert.equal(normalizeLabel(null), 'other');
  });
});

// ────────────────────────────────────────────────
// parseVisionResponse
// ────────────────────────────────────────────────
describe('parseVisionResponse', () => {
  test('parses JSON inside ```json fence', () => {
    const text = 'Here you go:\n```json\n{"summary": "มีคน 1 คน", "detections": [{"label": "person", "confidence": 0.94, "bbox": [0.1, 0.2, 0.5, 0.8]}]}\n```';
    const r = parseVisionResponse(text);
    assert.equal(r.summary, 'มีคน 1 คน');
    assert.equal(r.labels.length, 1);
    assert.equal(r.labels[0].object_type, 'person');
    assert.equal(r.labels[0].confidence, 0.94);
    assert.deepEqual(r.labels[0].bbox, [0.1, 0.2, 0.5, 0.8]);
  });

  test('parses bare JSON object', () => {
    const r = parseVisionResponse('{"summary":"dog","detections":[{"label":"dog","confidence":0.8,"bbox":[0,0,1,1]}]}');
    assert.equal(r.summary, 'dog');
    assert.equal(r.labels[0].object_type, 'animal');
  });

  test('parses bare array at root', () => {
    const r = parseVisionResponse('[{"label":"snake","confidence":0.7}]');
    assert.equal(r.labels[0].object_type, 'venomous');
  });

  test('parses JSON with noise around it (extract braces)', () => {
    const text = 'Sure: {"summary":"x","detections":[{"label":"car","conf":0.6}]} trailing';
    const r = parseVisionResponse(text);
    assert.equal(r.labels[0].object_type, 'vehicle');
    assert.equal(r.labels[0].confidence, 0.6);
  });

  test('supports alternate keys (object_type/class/name/score)', () => {
    const r = parseVisionResponse('{"detections":[{"class":"woman","score":0.9},{"name":"owl"},{"object_type":"venomous","conf":0.5}]}');
    assert.equal(r.labels[0].object_type, 'person');
    assert.equal(r.labels[0].confidence, 0.9);
    assert.equal(r.labels[1].object_type, 'animal');
    assert.equal(r.labels[2].object_type, 'venomous');
    assert.equal(r.labels[2].confidence, 0.5);
  });

  test('confidence is clamped to 0..1', () => {
    const r = parseVisionResponse('{"detections":[{"label":"person","confidence":1.5},{"label":"car","confidence":-2},{"label":"dog","confidence":"0.7"}]}');
    assert.equal(r.labels[0].confidence, 1);
    assert.equal(r.labels[1].confidence, 0);
    assert.equal(r.labels[2].confidence, 0.7);
  });

  test('missing confidence -> null, invalid bbox -> null', () => {
    const r = parseVisionResponse('{"detections":[{"label":"person"},{"label":"car","bbox":[1,2,3]}]}');
    assert.equal(r.labels[0].confidence, null);
    assert.equal(r.labels[0].bbox, null);
    assert.equal(r.labels[1].bbox, null);
  });

  test('non-JSON text -> empty labels + raw as summary', () => {
    const r = parseVisionResponse('I see a dog and a cat.');
    assert.equal(r.labels.length, 0);
    assert.match(r.summary, /dog/);
  });

  test('empty/whitespace -> empty result', () => {
    const r = parseVisionResponse('   ');
    assert.equal(r.labels.length, 0);
    assert.equal(r.summary, '');
  });
});

// ────────────────────────────────────────────────
// callVision
// ────────────────────────────────────────────────
describe('callVision', () => {
  test('posts base64 image to ollama /api/generate and returns response', async () => {
    let captured: any = null;
    const post = async (url: string, body: unknown, _opts: unknown) => {
      captured = { url, body };
      return { data: { response: '{"summary":"ok","detections":[]}' } };
    };
    const text = await callVision('data:image/jpeg;base64,AAAA', 'prompt-x', { post });
    assert.equal(text, '{"summary":"ok","detections":[]}');
    assert.equal(captured.url, `${OLLAMA_URL}/api/generate`);
    assert.equal(captured.body.model, VISION_MODEL);
    assert.deepEqual(captured.body.images, ['data:image/jpeg;base64,AAAA']);
    assert.equal(captured.body.stream, false);
  });

  test('throws on empty response', async () => {
    const post = async () => ({ data: { response: '' } });
    await assert.rejects(() => callVision('AA', 'p', { post }), /empty ollama response/);
  });

  test('throws on network failure', async () => {
    const post = async () => { throw new Error('ECONNREFUSED'); };
    await assert.rejects(() => callVision('AA', 'p', { post }), /ECONNREFUSED/);
  });
});

// ────────────────────────────────────────────────
// runVisionAnalysis (saves DetectionEvent)
// ────────────────────────────────────────────────
describe('runVisionAnalysis', () => {
  test('saves one DetectionEvent per label + updates camera last_event_at', async () => {
    mockModel(prisma, 'camera', {
      findUnique: async () => ({ id: 'c1' }),
      update: async (args: any) => {
        assert.equal(args.where.id, 'c1');
        assert.ok(args.data.last_event_at instanceof Date);
        return { id: 'c1' };
      },
    });
    const created: any[] = [];
    mockModel(prisma, 'detectionEvent', {
      create: async (args: any) => {
        created.push(args.data);
        return {
          id: `evt-${created.length}`,
          object_type: args.data.object_type,
          confidence: args.data.confidence,
          detected_at: new Date('2026-08-12T10:00:00Z'),
        };
      },
    });
    const post = async () => ({
      data: {
        response: '{"summary":"เจอคน 1 และงู 1","detections":[{"label":"person","confidence":0.95},{"label":"snake","confidence":0.8}]}',
      },
    });
    const result = await runVisionAnalysis('data:image/jpeg;base64,ABC', { cameraId: 'c1', post });
    assert.equal(result.saved, 2);
    assert.equal(result.savedEvents.length, 2);
    assert.equal(created.length, 2);
    assert.equal(created[0].camera_id, 'c1');
    assert.equal(created[0].object_type, 'person');
    assert.equal(created[1].object_type, 'venomous');
    assert.equal(created[1].confidence, 0.8);
    assert.equal(result.model, VISION_MODEL);
  });

  test('skips saving when no cameraId', async () => {
    let createCalls = 0;
    mockModel(prisma, 'detectionEvent', {
      create: async () => {
        createCalls++;
        return { id: 'x', object_type: 'person', confidence: 1, detected_at: new Date() };
      },
    });
    const post = async () => ({ data: { response: '{"summary":"s","detections":[{"label":"person"}]}' } });
    const result = await runVisionAnalysis('AA', { post });
    assert.equal(result.saved, 0);
    assert.equal(createCalls, 0);
    assert.equal(result.labels.length, 1);
  });

  test('rejects when camera not found and does not create events', async () => {
    let createCalls = 0;
    mockModel(prisma, 'camera', { findUnique: async () => null });
    mockModel(prisma, 'detectionEvent', {
      create: async () => {
        createCalls++;
        return { id: 'x', object_type: 'person', confidence: 1, detected_at: new Date() };
      },
    });
    const post = async () => ({ data: { response: '{"detections":[{"label":"person"}]}' } });
    await assert.rejects(() => runVisionAnalysis('AA', { cameraId: 'missing', post }), /camera_id not found/);
    assert.equal(createCalls, 0);
  });
});

// ────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────
describe('vision routes', () => {
  const token = makeToken();

  test('GET /history returns detection rows', async () => {
    mockModel(prisma, 'detectionEvent', {
      findMany: async (args: any) => {
        assert.equal(args.orderBy.detected_at, 'desc');
        return [{ id: 'e1', object_type: 'person', confidence: 0.9, camera: { name: 'กล้องหน้า', location: 'หน้าบ้าน' } }];
      },
    });
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/history?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.length, 1);
      assert.equal(body[0].camera.name, 'กล้องหน้า');
    } finally {
      await ts.close();
    }
  });

  test('GET /history requires auth', async () => {
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/history`);
      assert.equal(res.status, 401);
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze without file -> 400', async () => {
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'No image file uploaded');
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze rejects non-image mime -> 400', async () => {
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const form = new FormData();
      form.append('image', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
      const res = await fetch(`${ts.baseUrl}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'Invalid image upload');
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze rejects malformed camera_id -> 400', async () => {
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const form = new FormData();
      form.append('image', new Blob([Buffer.from([0xff, 0xd8, 0xff]), 'jpg'], { type: 'image/jpeg' }), 'a.jpg');
      form.append('camera_id', 'not-a-uuid');
      const res = await fetch(`${ts.baseUrl}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'Invalid camera_id format');
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze-url rejects non-http url', async () => {
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/analyze-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'file:///etc/passwd' }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'url must be http(s)');
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze-url rejects overlong url', async () => {
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/analyze-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `http://x/${'a'.repeat(3000)}` }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'url too long');
    } finally {
      await ts.close();
    }
  });

  test('POST /analyze-url with bad camera_id -> 400', async () => {
    const ts = await createTestServer((app) => app.use('/', visionRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/analyze-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://camera/snap.jpg', camera_id: 'zzz' }),
      });
      assert.equal(res.status, 400);
    } finally {
      await ts.close();
    }
  });
});