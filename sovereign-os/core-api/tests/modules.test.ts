import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';

// ENABLED_MODULES — เปิด-ปิดโมดูลระดับ API (ต้อง import config แบบ dynamic
// เพื่อให้ env ที่ตั้งใน test นี้มีผลก่อน parse)
test('ENABLED_MODULES เปิดเฉพาะโมดูลที่ระบุ + ข้ามค่าที่ไม่รู้จัก', async () => {
  process.env.ENABLED_MODULES = 'inventory,not-a-module';
  const { config, AVAILABLE_MODULES } = await import('../src/config');

  assert.deepStrictEqual([...AVAILABLE_MODULES], ['inventory', 'farm', 'vision', 'documents']);
  assert.strictEqual(config.modules.isEnabled('inventory'), true);
  assert.strictEqual(config.modules.isEnabled('farm'), false);
  assert.deepStrictEqual([...config.modules.enabled], ['inventory']);
});

test('ไม่ตั้ง ENABLED_MODULES = เปิดทุกโมดูล (ค่าเริ่มต้นเข้ากันได้กับ config เก่า)', async () => {
  delete process.env.ENABLED_MODULES;
  // reload โมดูลใหม่เพื่อให้ parse ใหม่ (cache ถูกเก็บ — ใช้ query string หลอก import cache)
  const fresh = await import(`../src/config/index.ts?fresh-modules=${Date.now()}`);
  for (const name of fresh.AVAILABLE_MODULES) {
    assert.strictEqual(fresh.config.modules.isEnabled(name), true, `${name} should be enabled by default`);
  }
});
