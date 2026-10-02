import './setup-env';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import sensorRoutes from '../src/modules/sensors/sensor.routes';
import sensorDataRoutes from '../src/modules/sensors/sensor-data.routes';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Sensors — อุปกรณ์ IoT + ค่าจากเซนเซอร์ (mock suite, ไม่แตะ DB จริง)
//
// ครอบ: ลิสต์อุปกรณ์พร้อมสถานะ online (heartbeat 2 นาที) · อ่านค่าล่าสุดต่อ metric
//        สร้าง/ลบอุปกรณ์ (default node/topic) · validation metric/value ก่อนแตะ TimescaleDB
//        ลิสต์ metric · อ่านย้อนหลัง + default limit · ลบแบบ single/all
//        สร้างโค้ด firmware ESP32/ESP8266 และเคสชนิดที่ยังไม่รองรับ
//
// ทำไมต้องมี (audit 3/10/69): sensors เป็น 0% coverage ทั้งที่หน้า /sensors/ เปิดสาธารณะ
// และเป็นทางเข้าของ device heartbeats ทั้งระบบ
// ────────────────────────────────────────────────────────────────────────────

let server: TestServer;
let dataServer: TestServer;
const TOKEN = makeToken('SUPERADMIN');
const AUTH = { Authorization: `Bearer ${TOKEN}` };

const nowMs = Date.now();
const devices: any[] = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    node_id: 'bbbbbbbb-0000-4000-8000-000000000001',
    name: 'SENSOR-SHOP-1',
    type: 'ESP32',
    mqtt_topic: 'sovereign/SENSOR-SHOP-1/sensor/+',
    is_active: true,
    // heartbeat ใหม่มาก = online
    last_heartbeat: new Date(nowMs - 30_000),
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    node_id: 'bbbbbbbb-0000-4000-8000-000000000001',
    name: 'SENSOR-GREENHOUSE-1',
    type: 'ESP8266',
    mqtt_topic: 'sovereign/SENSOR-GREENHOUSE-1/sensor/+',
    is_active: true,
    // heartbeat เก่า = offline
    last_heartbeat: new Date(nowMs - 30 * 60_000),
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    name: 'RETIRED',
    is_active: false,
    last_heartbeat: new Date(nowMs - 1000),
  },
];

const rawCalls: Array<{ sql: string; params: any[] }> = [];
let rawHandler: (sql: string, params: any[]) => any = () => [];

before(async () => {
  mockModel(prisma, 'device', {
    findMany: async ({ where }: any = {}) => {
      if (where?.is_active) return devices.filter((d) => d.is_active);
      return devices;
    },
    create: async ({ data }: any) => {
      const row = { id: `dev-${devices.length + 1}`, last_heartbeat: null, ...data };
      devices.push(row);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = devices.findIndex((d) => d.id === where.id);
      if (i < 0) throw new Error('device not found');
      return devices.splice(i, 1)[0];
    },
  });

  // $queryRawUnsafe: sensors route อ่านค่าล่าสุด, sensor-data route เขียน/ลบ
  (prisma as any).$queryRawUnsafe = async (sql: string, ...params: any[]) => {
    rawCalls.push({ sql, params });
    return rawHandler(sql, params);
  };

  server = await createTestServer((app) => app.use('/api/sensors', sensorRoutes));
  dataServer = await createTestServer((app) => app.use('/api/sensors', sensorDataRoutes));
});

after(async () => {
  if (server) await server.close();
  if (dataServer) await dataServer.close();
});

before(() => {
  rawHandler = (sql) => {
    if (sql.includes('DISTINCT ON (metric)')) {
      return [
        { metric: 'temperature', value: 31.4 },
        { metric: 'humidity', value: 68 },
      ];
    }
    if (sql.includes('DISTINCT metric')) return [{ metric: 'temperature' }, { metric: 'humidity' }];
    if (sql.startsWith('SELECT time')) {
      return [{ time: new Date('2026-10-03T02:00:00Z'), node_id: 'n1', device_id: 'manual-input', metric: 'temperature', value: 31.4 }];
    }
    return [];
  };
});

function authed(url: string) {
  return fetch(url, { headers: AUTH });
}

// ────────────────────────────────────────────────────────────────────────────
describe('GET /api/sensors/devices', () => {
  test('คืนเฉพาะอุปกรณ์ที่ active พร้อมสถานะ online จาก heartbeat', async () => {
    rawCalls.length = 0;
    const res = await authed(server.baseUrl + '/api/sensors/devices');
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.strictEqual(body.length, 2, 'ไม่ควรมีอุปกรณ์ is_active=false');
    assert.strictEqual(body[0].name, 'SENSOR-SHOP-1');
    assert.strictEqual(body[0].online, true, 'heartbeat 30 วิ = ออนไลน์');
    assert.strictEqual(body[1].online, false, 'heartbeat 30 นาที = ออฟไลน์');
  });

  test('แนบค่าล่าสุดต่อ metric ของอุปกรณ์นั้น', async () => {
    const res = await authed(server.baseUrl + '/api/sensors/devices');
    const body: any = await res.json();
    assert.deepStrictEqual(body[0].sensors, [
      { metric: 'temperature', value: 31.4 },
      { metric: 'humidity', value: 68 },
    ]);
    // query ต่ออุปกรณ์ = ผูกด้วย device_id จริง (ไม่ใช่ค่าว่าง)
    const deviceQuery = rawCalls.find((c) => c.sql.includes('DISTINCT ON (metric)'));
    assert.ok(deviceQuery, 'ต้องมี query อ่านค่าล่าสุด');
    assert.strictEqual(deviceQuery.params[0], 'aaaaaaaa-0000-4000-8000-000000000001');
  });

  test('DB ล้ม = 500 กับ array ว่าง (หน้าเว็บจะเห็น 0 อุปกรณ์ ไม่ใช่ error ดิบ)', async () => {
    const saved = (prisma as any).device.findMany;
    (prisma as any).device.findMany = async () => {
      throw new Error('db down');
    };
    const res = await authed(server.baseUrl + '/api/sensors/devices');
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(await res.json(), []);
    (prisma as any).device.findMany = saved;
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /api/sensors/devices', () => {
  test('สร้างได้ และเติม default mqtt_topic จากชื่อ', async () => {
    const res = await fetch(server.baseUrl + '/api/sensors/devices', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SENSOR-NEW', type: 'ESP32' }),
    });
    assert.strictEqual(res.status, 201);
    const body: any = await res.json();
    assert.strictEqual(body.mqtt_topic, 'sovereign/SENSOR-NEW/sensor/+');
    assert.strictEqual(body.is_active, true);
    assert.ok(body.node_id, 'ต้องมี node_id default จาก config');
    devices.pop();
  });

  test('สร้างไม่สำเร็จ = 500 พร้อมข้อความ ไม่ใช่ 200 เงียบ', async () => {
    const saved = (prisma as any).device.create;
    (prisma as any).device.create = async () => {
      throw new Error('violates constraint');
    };
    const res = await fetch(server.baseUrl + '/api/sensors/devices', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'BAD', type: 'ESP32' }),
    });
    assert.strictEqual(res.status, 500);
    assert.ok((await res.json()).error);
    (prisma as any).device.create = saved;
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/sensors/devices/:id', () => {
  test('ลบสำเร็จคืน { success: true }', async () => {
    devices.push({ id: 'temp-del', name: 'TEMP', is_active: true, last_heartbeat: null });
    const res = await fetch(server.baseUrl + '/api/sensors/devices/temp-del', { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { success: true });
  });

  test('ลบ id ที่ไม่มี = 500 (ไม่เงียบว่าสำเร็จ)', async () => {
    const res = await fetch(server.baseUrl + '/api/sensors/devices/nope', { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 500);
    assert.ok((await res.json()).error);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /api/sensors/generate-code', () => {
  test('ESP32 + temperature/humidity = โค้ดครบทั้ง WiFi, DHT และ publish', async () => {
    const res = await fetch(server.baseUrl + '/api/sensors/generate-code', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ESP32', sensors: ['temperature', 'humidity'], wifiSSID: 'FIELD-4G', wifiPass: 'pw' }),
    });
    assert.strictEqual(res.status, 200);
    const { code }: any = await res.json();
    assert.match(code, /#include <WiFi\.h>/);
    assert.match(code, /#include <DHT\.h>/);
    assert.match(code, /dht\.readTemperature\(\)/);
    assert.match(code, /dht\.readHumidity\(\)/);
    assert.match(code, /"FIELD-4G"/);
    assert.match(code, /DHT dht\(DHTPIN, DHTTYPE\)/);
  });

  test('ESP8266 + rain_detect = ไม่มี DHT แต่มี digitalRead(5)', async () => {
    const res = await fetch(server.baseUrl + '/api/sensors/generate-code', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ESP8266', sensors: ['rain_detect'] }),
    });
    const { code }: any = await res.json();
    assert.match(code, /#include <ESP8266WiFi\.h>/);
    assert.doesNotMatch(code, /#include <DHT\.h>/);
    assert.match(code, /digitalRead\(5\)/);
    assert.match(code, /rain_detect/);
  });

  test('metric ที่ไม่รู้จัก = ไม่สร้างบรรทัด publish ที่ค้างว่าง', async () => {
    const res = await fetch(server.baseUrl + '/api/sensors/generate-code', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ESP32', sensors: ['teleport'] }),
    });
    const { code }: any = await res.json();
    assert.doesNotMatch(code, /teleport/);
    // โครงหลักต้องยังอยู่
    assert.match(code, /void setup\(\)/);
  });

  test('ชนิดคอนโทรลที่ยังไม่รองรับ = ข้อความบอกตรง ๆ ไม่ใช่โค้ดเปล่า', async () => {
    const res = await fetch(server.baseUrl + '/api/sensors/generate-code', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'RPI-PICO', sensors: [] }),
    });
    const { code }: any = await res.json();
    assert.match(code, /not yet available/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /api/sensors/data — validation ก่อนแตะ TimescaleDB', () => {
  test('metric ที่ไม่ใช่ string = 400 และไม่ยิง SQL', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/data', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric: 123, value: 1 }),
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(rawCalls.length, 0, 'ห้ามแตะ DB ตอน input ผิด');
  });

  test('metric ยาวเกิน 60 = 400', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/data', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric: 'x'.repeat(61), value: 1 }),
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(rawCalls.length, 0);
  });

  test('value ที่แปลงเป็นตัวเลขไม่ได้ (เช่น "abc") = 400', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/data', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric: 'temperature', value: 'abc' }),
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(rawCalls.length, 0);
  });

  // ⚠️ บั๊กจริงที่เจอตอนเขียนเทสต์ (3/10/69) — ยังไม่แก้ เพราะแตะพฤติกรรมเดิมต้องได้รับอนุญาตจากเจ้าของ
  // Number(null) = 0 · Number('') = 0 · Number([]) = 0 · Number(false) = 0 → ผ่าน Number.isFinite
  // = ค่าที่ "ไม่ได้ส่งมา" ถูกเขียนลง TimescaleDB เป็นตัวเลข 0 (เช่น อุณหภูมิ 0°C ปลอม ๆ)
  // เทสต์นี้ล็อก "พฤติกรรมปัจจุบัน" ไว้ เพื่อให้ถ้าวันหนึ่งแก้แล้วเทสต์นี้จะแดง = สัญญาณว่าเปลี่ยนแล้ว
  test('⚠️ ข้อบกพร่อง: value=null เดินทางเป็นเลข 0 ได้ (Number(null)===0 ผ่าน isFinite)', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/data', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric: 'temperature', value: null }),
    });
    assert.strictEqual(res.status, 201, 'พฤติกรรมปัจจุบัน = รับได้ (ถ้าจะแก้ = 400)');
    assert.strictEqual(rawCalls[0].params[3], 0, 'ถูกเขียนลง DB เป็น 0 — นี่คือรูปรับปรุง');
  });

  test('⚠️ ข้อบกพร่องเดียวกัน: value="" และ value=false ก็กลายเป็น 0 เหมือนกัน', async () => {
    for (const bad of ['', false, []]) {
      rawCalls.length = 0;
      const res = await fetch(dataServer.baseUrl + '/api/sensors/data', {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric: 'temperature', value: bad }),
      });
      assert.strictEqual(res.status, 201, `value=${JSON.stringify(bad)}`);
      assert.strictEqual(rawCalls[0].params[3], 0);
    }
  });

  test('ข้อมูลถูกต้อง = INSERT พร้อม node/device default (manual-input) และ cast uuid', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/data', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metric: 'temperature', value: '31.4' }),
    });
    assert.strictEqual(res.status, 201);
    const sql = rawCalls[0].sql;
    assert.match(sql, /INSERT INTO sensor_telemetry/);
    assert.match(sql, /\$1::uuid/, 'node_id ต้อง cast เป็น uuid');
    assert.deepStrictEqual(rawCalls[0].params, [
      config.defaults.telemetryNodeId,
      'manual-input',
      'temperature',
      31.4,
    ], 'string "31.4" ต้องถูกแปลงเป็นตัวเลข 31.4');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('GET /api/sensors/metrics + /all', () => {
  test('/metrics คืนรายชื่อ metric เป็น array ของ string', async () => {
    const res = await authed(dataServer.baseUrl + '/api/sensors/metrics');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), ['temperature', 'humidity']);
  });

  test('/metrics ที่ DB ล้ม = 200 กับ array ว่าง (ไม่ throw)', async () => {
    const saved = (prisma as any).$queryRawUnsafe;
    (prisma as any).$queryRawUnsafe = async () => {
      throw new Error('db down');
    };
    const res = await authed(dataServer.baseUrl + '/api/sensors/metrics');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), []);
    (prisma as any).$queryRawUnsafe = saved;
  });

  test('/all ไม่ส่ง metric = LIMIT 50 default', async () => {
    rawCalls.length = 0;
    const res = await authed(dataServer.baseUrl + '/api/sensors/all');
    assert.strictEqual(res.status, 200);
    assert.match(rawCalls[0].sql, /LIMIT \$1/);
    assert.deepStrictEqual(rawCalls[0].params, [50]);
  });

  test('/all?metric=humidity = ผูก parameter แบบ positional', async () => {
    rawCalls.length = 0;
    const res = await authed(dataServer.baseUrl + '/api/sensors/all?metric=humidity&limit=5');
    assert.strictEqual(res.status, 200);
    assert.match(rawCalls[0].sql, /AND metric = \$1/);
    assert.match(rawCalls[0].sql, /LIMIT \$2/, 'limit ต้องเลื่อนเป็น $2 ไม่ชนกับ metric');
    assert.deepStrictEqual(rawCalls[0].params, ['humidity', 5]);
  });

  test('/all?metric=all = ไม่กรอง metric (ดูทั้งหมด)', async () => {
    rawCalls.length = 0;
    await authed(dataServer.baseUrl + '/api/sensors/all?metric=all');
    assert.doesNotMatch(rawCalls[0].sql, /AND metric/);
  });

  test('/all ที่ DB ล้ม = 500 กับ array ว่าง', async () => {
    const saved = (prisma as any).$queryRawUnsafe;
    (prisma as any).$queryRawUnsafe = async () => {
      throw new Error('db down');
    };
    const res = await authed(dataServer.baseUrl + '/api/sensors/all');
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(await res.json(), []);
    (prisma as any).$queryRawUnsafe = saved;
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/sensors/:metric', () => {
  test('ลบเฉพาะ record ของ manual-input เป็นค่าเริ่มต้น', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/temperature', { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.match(rawCalls[0].sql, /DELETE FROM sensor_telemetry WHERE metric = \$1 AND device_id = \$2/);
    assert.deepStrictEqual(rawCalls[0].params, ['temperature', 'manual-input']);
  });

  test('ส่ง device_id = ลบเฉพาะอุปกรณ์นั้น', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/temperature?device_id=SENSOR-SHOP-1', {
      method: 'DELETE',
      headers: AUTH,
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(rawCalls[0].params, ['temperature', 'SENSOR-SHOP-1']);
  });

  test('/:metric/all = ลบทั้ง metric ไม่กรอง device', async () => {
    rawCalls.length = 0;
    const res = await fetch(dataServer.baseUrl + '/api/sensors/humidity/all?device_id=ignored', {
      method: 'DELETE',
      headers: AUTH,
    });
    assert.strictEqual(res.status, 200);
    assert.match(rawCalls[0].sql, /DELETE FROM sensor_telemetry WHERE metric = \$1\s*$/);
    assert.deepStrictEqual(rawCalls[0].params, ['humidity']);
  });

  test('DB ล้มตอนลบ = 500 พร้อมข้อความ ไม่ใช่ success', async () => {
    const saved = (prisma as any).$queryRawUnsafe;
    (prisma as any).$queryRawUnsafe = async () => {
      throw new Error('db down');
    };
    const res = await fetch(dataServer.baseUrl + '/api/sensors/temperature', { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 500);
    (prisma as any).$queryRawUnsafe = saved;
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('auth gate', () => {
  test('ทุก endpoint ต้อง login (ไม่มี route ที่เปิดลอย)', async () => {
    const urls = [
      server.baseUrl + '/api/sensors/devices',
      dataServer.baseUrl + '/api/sensors/metrics',
      dataServer.baseUrl + '/api/sensors/all',
    ];
    for (const u of urls) {
      const res = await fetch(u);
      assert.strictEqual(res.status, 401, `ควรเป็น 401: ${u}`);
    }
  });
});
