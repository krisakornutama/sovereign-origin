#!/usr/bin/env node
// ── Fleet Control Plane — UI/route wiring guards ──────────────────────────────
// กันของที่พังเงียบ ๆ:
//   • หน้าลืม Sidebar หรือโตเกินเพดาน frontend-gate
//   • เมนู/i18n หาย
//   • route ใหม่ไม่ได้ mount (ตอบ 404 ทั้งที่โค้ดมี)
//   • ด่าน rollout ถูกถอดออกจาก manifest/asset (เครื่องที่ถูกกักยังดึงโค้ดได้)
//   • GET /api/agent-machines กลับไป spread row ทั้งก้อน (token_hash รั่ว)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const lines = (p) => read(p).split(/\r?\n/).length;

const PAGE = 'sovereign-frontend/src/pages/fleet.tsx';
const COMPONENTS = [
  'sovereign-frontend/src/components/fleet/FleetPolicyPanel.tsx',
  'sovereign-frontend/src/components/fleet/FleetEnrollmentPanel.tsx',
  'sovereign-frontend/src/components/fleet/FleetMachinesTable.tsx',
];

describe('Fleet Control Plane — frontend', () => {
  test('หน้า /fleet มี Sidebar และอยู่ใต้เพดาน 800 บรรทัด', () => {
    const page = read(PAGE);
    assert.ok(page.includes('<Sidebar />'), 'หน้าต้อง import/ใช้ Sidebar');
    assert.ok(lines(PAGE) <= 800, `fleet.tsx มี ${lines(PAGE)} บรรทัด (เพดาน 800)`);
  });

  test('component ย่อยอยู่ใต้เพดาน 400 บรรทัด', () => {
    for (const file of COMPONENTS) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `ไม่พบ ${file}`);
      assert.ok(lines(file) <= 400, `${file} มี ${lines(file)} บรรทัด (เพดาน 400)`);
    }
  });

  test('หน้ามี API ครบ: overview / policy / enroll-tokens / machines / rotate-token', () => {
    const page = read(PAGE);
    for (const part of [
      '/api/fleet/overview',
      '/api/fleet/policy',
      '/api/fleet/enroll-tokens',
      '/api/fleet/machines/',
      '/rotate-token',
    ]) {
      assert.ok(page.includes(part), `หน้า fleet ต้องเรียก ${part}`);
    }
  });

  test('เมนู + i18n มี /fleet ทั้งไทยและอังกฤษ', () => {
    const nav = read('sovereign-frontend/src/lib/navigation.ts');
    assert.ok(nav.includes("href: '/fleet'"), 'navigation.ts ต้องมี /fleet');
    assert.ok(nav.includes("labelKey: 'common.nav.fleet'"), 'ต้องใช้ labelKey common.nav.fleet');
    assert.ok(nav.includes('ฝูงเครื่อง'), 'label ไทยต้องสื่อความ');
    assert.ok(read('sovereign-frontend/src/i18n/th/common.ts').includes('fleet:'));
    assert.ok(read('sovereign-frontend/src/i18n/en/common.ts').includes('fleet:'));
  });
});

describe('Fleet Control Plane — backend wiring', () => {
  test('mount /api/fleet และบังคับ SUPERADMIN', () => {
    const routes = read('sovereign-os/core-api/src/routes.ts');
    assert.ok(routes.includes("app.use('/api/fleet', fleetRoutes)"), 'routes.ts ต้อง mount /api/fleet');
    assert.ok(routes.includes("from './modules/fleet/fleet.routes'"), 'routes.ts ต้อง import fleet.routes');

    const fleet = read('sovereign-os/core-api/src/modules/fleet/fleet.routes.ts');
    assert.ok(fleet.includes("requireRole('SUPERADMIN')"), 'ทุก route ต้องเป็น SUPERADMIN');
    for (const route of ['/overview', '/policy', '/enroll-tokens', '/machines/:id', '/rotate-token']) {
      assert.ok(fleet.includes(route), `fleet.routes ต้องมี ${route}`);
    }
  });

  test('ด่าน rollout ถูกใช้ทั้ง manifest และ asset (runner + desktop)', () => {
    const agent = read('sovereign-os/core-api/src/modules/agent-machines/agent-machines.routes.ts');
    const calls = agent.split('gateFleetUpdate(machine, res)').length - 1;
    // update/manifest · update/file · desktop-update/manifest · desktop-update/asset
    assert.ok(calls >= 4, `ต้องเรียก gateFleetUpdate อย่างน้อย 4 จุด (พบ ${calls})`);
    assert.ok(agent.includes("reason === 'rollout_hold'"), 'ต้องแยกเหตุผล rollout_hold');
    assert.ok(agent.includes("reason === 'machine_disabled'"), 'ต้องแยกเหตุผล machine_disabled');
  });

  test('GET /api/agent-machines ไม่ spread row ทั้งก้อน (กัน token_hash รั่ว)', () => {
    const agent = read('sovereign-os/core-api/src/modules/agent-machines/agent-machines.routes.ts');
    assert.ok(agent.includes('function publicMachine'), 'ต้องมี publicMachine helper');
    assert.ok(!agent.includes('return { ...m, ip:'), 'ห้าม spread row เดิม');
    assert.ok(agent.includes('...publicMachine(m)'), 'ต้องใช้ publicMachine');
  });

  test('มีเทสต์ policy/enrollment ที่ commit ไว้', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'sovereign-os/core-api/tests/fleetPolicy.test.ts')));
    assert.ok(fs.existsSync(path.join(ROOT, 'sovereign-os/core-api/tests/fleetEnrollment.test.ts')));
  });
});
