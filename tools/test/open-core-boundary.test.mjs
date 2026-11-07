// Open-core boundary — ด่านกัน Pro หลุดเข้า CE (และกัน CE ไป import Pro)
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPath, findViolations, PRO_AREAS } from '../verify/open-core-boundary.mjs';

test('จัดประเภท path ของ backend module ได้', () => {
  assert.equal(classifyPath('sovereign-os/core-api/src/modules/business/business.routes.ts'), 'pro:business');
  assert.equal(classifyPath('sovereign-os/core-api/src/modules/fleet/fleet.service.ts'), 'pro:fleet');
  assert.equal(classifyPath('sovereign-os/core-api/src/modules/telemetry/ingest.ts'), 'ce');
  assert.equal(classifyPath('sovereign-frontend/src/pages/treasury.tsx'), 'pro:treasury');
  assert.equal(classifyPath('sovereign-frontend/src/pages/dashboard.tsx'), 'ce');
});

test('จัดประเภท components ของ Pro ฝั่ง frontend ได้', () => {
  assert.equal(classifyPath('sovereign-frontend/src/components/fleet/FleetPolicyPanel.tsx'), 'pro:fleet');
  assert.equal(classifyPath('sovereign-frontend/src/components/treasury/SignalsCard.tsx'), 'pro:treasury');
  assert.equal(classifyPath('sovereign-frontend/src/components/restaurant/MenuGrid.tsx'), 'pro:restaurant');
  // โฟลเดอร์ component ทั่วไปต้องยังเป็น CE
  assert.equal(classifyPath('sovereign-frontend/src/components/ui/PageHeader.tsx'), 'ce');
  assert.equal(classifyPath('sovereign-frontend/src/components/layout/Sidebar.tsx'), 'ce');
});

test('จัดประเภท e2e spec ของ Pro ได้', () => {
  assert.equal(classifyPath('sovereign-frontend/e2e/pos-flow.spec.ts'), 'pro:restaurant');
  assert.equal(classifyPath('sovereign-frontend/e2e/pages.spec.ts'), 'ce');
});

test('ทุก Pro area มีคำนิยามครบ (modules/pages/components/e2e/routes)', () => {
  for (const [area, def] of Object.entries(PRO_AREAS)) {
    assert.ok(Array.isArray(def.modules), `${area} ต้องมี modules`);
    assert.ok(Array.isArray(def.pages), `${area} ต้องมี pages`);
    assert.ok(Array.isArray(def.components), `${area} ต้องมี components (ว่างได้)`);
    assert.ok(Array.isArray(def.e2e), `${area} ต้องมี e2e (ว่างได้)`);
    assert.ok(Array.isArray(def.routes), `${area} ต้องมี routes`);
  }
});

test('จับได้เมื่อไฟล์ CE import ของ Pro', () => {
  const fakeRead = (p) => {
    if (p.endsWith('src/modules/telemetry/telemetry.routes.ts')) {
      return "import { BusinessService } from '../business/business.service';";
    }
    return '';
  };
  const v = findViolations({
    files: ['sovereign-os/core-api/src/modules/telemetry/telemetry.routes.ts'],
    readFile: fakeRead,
  });
  assert.equal(v.length, 1);
  assert.equal(v[0].file, 'sovereign-os/core-api/src/modules/telemetry/telemetry.routes.ts');
  assert.match(v[0].reason, /business/);
});

test('ไฟล์ CE ฝั่ง frontend ที่ import component ของ Pro = violation', () => {
  const file = 'sovereign-frontend/src/pages/dashboard.tsx';
  const v = findViolations({
    files: [file],
    readFile: () => "import SignalsCard from '../components/treasury/SignalsCard';",
  });
  assert.equal(v.length, 1);
  assert.match(v[0].reason, /treasury/);
});

test('ไฟล์ Pro อ้างของ Pro ด้วยกันเอง = ไม่ใช่ violation', () => {
  const v = findViolations({
    files: ['sovereign-os/core-api/src/modules/business/business.routes.ts'],
    readFile: () => "import { TreasuryService } from '../treasury/treasury.service';",
  });
  assert.equal(v.length, 0);
});
