#!/usr/bin/env node
// เทสต์ของ tools/runtime-layers.mjs — ตัวตัดสิน "ชั้นไหนควรทำงาน" แบบ pure
// เป้าหมาย: เปลี่ยนโหมดได้โดยไม่ต้องเดาว่าอะไรจะถูก stop/start และลำดับต้องปลอดภัย
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPO_ROOT,
  DEFAULT_MODE,
  loadRegistry,
  serviceIdsForMode,
  watchContainerNamesForMode,
  modeHasWeb,
  readRuntimeMode,
  writeRuntimeMode,
  planTransitions,
  stoppingEmqxNeedsConfirmation,
} from '../runtime-layers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const registry = loadRegistry();

function tempRoot() {
  const base = path.join(ROOT, '.freebuff');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'layers-test-'));
}

function writeModeFile(root, value) {
  const dir = path.join(root, 'sovereign-os', 'core-api', 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'runtime-mode.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

const allRunning = {
  db: 'running', api: 'running', web: 'running', tunnel: 'running', emqx: 'running', wazuh: 'running',
};

describe('registry', () => {
  test('มี mode ครบและทุก service ที่อ้างถึงมีจริง', () => {
    assert.equal(registry.defaultMode, DEFAULT_MODE);
    for (const [name, mode] of Object.entries(registry.modes)) {
      assert.ok(Array.isArray(mode.services) && mode.services.length > 0, `mode ${name} ต้องมี services`);
      for (const id of mode.services) assert.ok(registry.services[id], `mode ${name} อ้าง service ที่ไม่มี: ${id}`);
    }
    for (const essential of ['db', 'api', 'web']) {
      for (const [name, mode] of Object.entries(registry.modes)) {
        assert.ok(mode.services.includes(essential), `mode ${name} ต้องมี ${essential}`);
      }
    }
  });

  test('core ไม่มีบริการภายนอก และ full มีทุกตัว', () => {
    assert.deepEqual(serviceIdsForMode(registry, 'core'), ['db', 'api', 'web']);
    assert.ok(serviceIdsForMode(registry, 'full').includes('wazuh'));
  });

  test('watchdog รู้จักเฉพาะ container ที่ mode เปิด', () => {
    assert.deepEqual(watchContainerNamesForMode('core', { registry }), ['sovereign-db', 'sovereign-core-api']);
    assert.deepEqual(watchContainerNamesForMode('connected', { registry }), ['sovereign-db', 'sovereign-core-api']);
    assert.ok(watchContainerNamesForMode('iot', { registry }).includes('sovereign-emqx'));
    assert.ok(!watchContainerNamesForMode('connected', { registry }).includes('sovereign-emqx'));
  });

  test('mode ที่มี web / ไม่มี web', () => {
    assert.equal(modeHasWeb('core', { registry }), true);
    assert.equal(modeHasWeb('connected', { registry }), true);
    assert.equal(modeHasWeb('full', { registry }), true);
    assert.equal(modeHasWeb('unknown-mode', { registry }), true, 'โหมดไม่รู้จัก = fail-safe ให้เว็บทำงาน');
  });
});

describe('planTransitions', () => {
  test('full → connected: stop wazuh ก่อน emqx และไม่แตะ core', () => {
    const plan = planTransitions({ registry, fromMode: 'full', toMode: 'connected', states: allRunning });
    assert.deepEqual(plan.stop, ['wazuh', 'emqx']);
    assert.deepEqual(plan.start, []);
    assert.deepEqual(plan.keep, ['db', 'api', 'web', 'tunnel']);
  });

  test('connected → full: start emqx ก่อน wazuh', () => {
    const plan = planTransitions({
      registry, fromMode: 'connected', toMode: 'full',
      states: { ...allRunning, emqx: 'exited', wazuh: 'exited' },
    });
    assert.deepEqual(plan.start, ['emqx', 'wazuh']);
    assert.deepEqual(plan.stop, []);
  });

  test('ไม่ start ตัวที่ state เป็น unknown (กันไปยุ่งกับของที่ไม่ได้จัดการ)', () => {
    const plan = planTransitions({
      registry, fromMode: 'core', toMode: 'full', states: { ...allRunning, emqx: 'unknown', wazuh: 'unknown' },
    });
    assert.deepEqual(plan.start, []);
  });

  test('ไม่ stop ตัวที่หยุดอยู่แล้ว', () => {
    const plan = planTransitions({
      registry, fromMode: 'full', toMode: 'connected', states: { ...allRunning, wazuh: 'exited', emqx: 'exited' },
    });
    assert.deepEqual(plan.stop, []);
  });

  test('หยุด EMQX ต้องยืนยัน --force เมื่อ EMQX ยังรัน (core-api ที่รันอยู่ยังไม่มี listener ใหม่)', () => {
    assert.equal(stoppingEmqxNeedsConfirmation({ registry, toMode: 'connected', states: allRunning }), true);
    assert.equal(stoppingEmqxNeedsConfirmation({ registry, toMode: 'iot', states: allRunning }), false);
    assert.equal(stoppingEmqxNeedsConfirmation({ registry, toMode: 'connected', states: { ...allRunning, emqx: 'exited' } }), false);
  });
});

describe('runtime-mode.json', () => {
  test('ไม่มีไฟล์ → default mode', () => {
    const root = tempRoot();
    assert.deepEqual(readRuntimeMode({ root, registry }), { mode: DEFAULT_MODE, source: 'default', updatedAt: null });
  });

  test('JSON เสีย → default mode (ไม่โยน error)', () => {
    const root = tempRoot();
    writeModeFile(root, '{not-json');
    assert.equal(readRuntimeMode({ root, registry }).mode, DEFAULT_MODE);
  });

  test('mode ไม่รู้จัก → default mode', () => {
    const root = tempRoot();
    writeModeFile(root, { mode: 'nope' });
    assert.equal(readRuntimeMode({ root, registry }).mode, DEFAULT_MODE);
  });

  test('อ่านไฟล์ที่ถูกต้องได้', () => {
    const root = tempRoot();
    writeModeFile(root, { mode: 'connected', updatedAt: '2026-10-22T00:00:00.000Z' });
    const got = readRuntimeMode({ root, registry });
    assert.equal(got.mode, 'connected');
    assert.equal(got.source, 'file');
    assert.equal(got.updatedAt, '2026-10-22T00:00:00.000Z');
  });

  test('เขียนแล้วอ่านกลับได้ + เขียนแบบ atomic (ไม่มีไฟล์ .tmp ค้าง)', () => {
    const root = tempRoot();
    writeRuntimeMode('core', { root, registry, updatedBy: 'test' });
    assert.equal(readRuntimeMode({ root, registry }).mode, 'core');
    const dir = path.join(root, 'sovereign-os', 'core-api', 'data');
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  });

  test('เขียน mode ที่ไม่รู้จักต้อง throw (กันพิมพ์ผิดแล้วระบบหยุดทั้งชุด)', () => {
    const root = tempRoot();
    assert.throws(() => writeRuntimeMode('typo', { root, registry }), /mode/i);
  });
});
