// ทำไมไฟล์นี้ถึงมี: CI matrix (ubuntu/windows) ของ core-api-tests เคยค้างชน timeout 25 นาที
// หลังเพิ่มเทสต์ role gate ของ relay — ต้นเหตุคือ `relay.routes.ts` เรียก `mqtt.connect()`
// ตอน import แล้ว mqtt.js reconnect ทุก 1 วิตลอดไป (log "Relay MQTT error: connect ECONNREFUSED")
// ⇒ ไฟล์เทสต์ที่ import router นั้นจบ assertion แล้วแต่ process ไม่ยอมจบ
//
// กติกาที่ต้องคงอยู่: ในชุดเทสต์ (MQTT_DISABLED=1) การ import router ต้องไม่เปิด socket
// และ process ต้องจบเองได้ — production ยังต่อ MQTT ตามปกติเมื่อไม่ได้ตั้ง flag
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMqttClient, isMqttDisabled } from '../src/lib/mqtt-client';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..');
const TSX = path.join(CORE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const LIMIT_MS = 12_000;

function runFixture(fixture: string): Promise<{ code: number | null; ms: number; stderr: string }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [TSX, path.join(HERE, 'fixtures', fixture)], {
      cwd: CORE,
      env: {
        ...process.env,
        JWT_SECRET: 'test-secret-0123456789abcdef',
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
        MQTT_HOST: '127.0.0.1',
        MQTT_PORT: '1883',
        MQTT_DISABLED: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += String(d); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, ms: Date.now() - started, stderr });
    }, LIMIT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - started, stderr });
    });
  });
}

test('setup-env ปิด MQTT ในชุด mock (ไม่ให้ socket ค้างขวาง process)', () => {
  assert.equal(process.env.RUN_DB_TESTS, undefined);
  assert.equal(isMqttDisabled(), true);
});

test('createMqttClient: เมื่อปิด MQTT ได้ client หลอกที่มี API ครบ (publish/on/end)', () => {
  const client: any = createMqttClient('unit-test');
  assert.equal(typeof client.publish, 'function');
  assert.equal(typeof client.on, 'function');
  assert.equal(typeof client.end, 'function');
  assert.equal(client.publish('topic', 'payload'), client, 'publish ต้องคืน client (chainable) เหมือน mqtt.js');
  assert.equal(client.connected, false);
});

test('import relay routes แล้ว process ต้องจบเอง (ไม่ค้างจาก MQTT reconnect)', async () => {
  const r = await runFixture('import-relay-routes.ts');
  assert.equal(r.code, 0, `process ต้องจบด้วย exit 0 (ได้ ${r.code}) — stderr: ${r.stderr.slice(0, 400)}`);
  assert.ok(r.ms < LIMIT_MS, `ต้องจบเร็วกว่า ${LIMIT_MS}ms (ใช้ ${r.ms}ms)`);
});

test('import OTA routes แล้ว process ต้องจบเอง', async () => {
  const r = await runFixture('import-ota-routes.ts');
  assert.equal(r.code, 0, `process ต้องจบด้วย exit 0 (ได้ ${r.code}) — stderr: ${r.stderr.slice(0, 400)}`);
  assert.ok(r.ms < LIMIT_MS, `ต้องจบเร็วกว่า ${LIMIT_MS}ms (ใช้ ${r.ms}ms)`);
});
