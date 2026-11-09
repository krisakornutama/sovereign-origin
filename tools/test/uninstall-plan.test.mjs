// แผนถอนติดตั้ง — ต้องปลอดภัยโดยค่าเริ่มต้น (ไม่ลบข้อมูลเงียบ ๆ)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUninstallPlan } from '../install/uninstall.mjs';

test('ค่าเริ่มต้น: หยุด task + หยุด container แต่ไม่ลบ volume', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true });
  const ids = plan.steps.map((s) => s.id);
  assert.ok(ids.includes('stop-task'));
  assert.ok(ids.includes('compose-down'));
  const down = plan.steps.find((s) => s.id === 'compose-down');
  assert.ok(!down.args.includes('-v'), 'ห้ามลบ volume ถ้าไม่ได้สั่ง --purge-data');
  assert.ok(!ids.some((id) => id.startsWith('rmi:')), 'ห้ามลบ image โดยไม่สั่ง');
  assert.equal(plan.warnings.length, 0);
});

test('--purge-data: ลบ volume และ backup พร้อมเตือน', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true, purgeData: true });
  const down = plan.steps.find((s) => s.id === 'compose-down');
  assert.ok(down.args.includes('-v'));
  assert.ok(plan.steps.some((s) => s.id === 'purge-backups'));
  assert.ok(plan.warnings.some((w) => w.includes('กู้คืนไม่ได้')));
});

test('--purge-images: ลบ image ที่ระบุ', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true, purgeImages: true });
  const rmi = plan.steps.filter((s) => s.id.startsWith('rmi:'));
  assert.equal(rmi.length, 2);
  assert.ok(rmi.every((s) => s.command === 'docker' && s.args[0] === 'rmi'));
});

test('ไม่มี compose = ข้ามขั้นนั้น ไม่ล้มทั้งแผน', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: false });
  const down = plan.steps.find((s) => s.id === 'compose-down');
  assert.equal(down.skip, true);
  assert.equal(down.command, '');
});

test('Linux/macOS ไม่แตะ schtasks', () => {
  const plan = buildUninstallPlan({ platform: 'linux', hasCompose: true });
  assert.ok(!plan.steps.some((s) => s.id === 'stop-task'));
});

test('--remove-files ให้คำสั่งมือ ไม่รันลบโฟลเดอร์ที่กำลังใช้งานเอง', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true, removeFiles: true });
  const step = plan.steps.find((s) => s.id === 'remove-files');
  assert.ok(step.manual, 'ต้องเป็นคำสั่งที่ผู้ใช้รันเองหลังปิดเชลล์');
  assert.equal(step.command, '');
  assert.ok(plan.warnings.some((w) => w.includes('ซอร์ส')));
});

test('ถอนซ้ำได้: คำสั่งที่อาจล้มเหลวต้องไม่ทำให้ทั้งแผนล้ม', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true, purgeData: true });
  for (const id of ['stop-task', 'purge-backups']) {
    assert.equal(plan.steps.find((s) => s.id === id)?.tolerateFailure, true, `${id} ต้องไม่ทำให้ถอนซ้ำล้ม`);
  }
  // compose-down ใช้ classifyFailure แทน tolerateFailure: "ไม่มี project/container แล้ว" ถือว่าผ่าน
  // แต่ error จริง (เช่น env ไม่ครบจนหยุดไม่ได้) ต้องล้มให้เห็น — เดิม tolerateFailure กลืนจนรายงาน "ถอนเสร็จ"
  const down = plan.steps.find((s) => s.id === 'compose-down');
  assert.equal(typeof down?.classifyFailure, 'function', 'compose-down ต้องใช้ classifyFailure');
  assert.equal(down?.tolerateFailure, undefined, 'compose-down ต้องไม่กลืน error จริง');
  assert.equal(down?.classifyFailure('no such project: sovereign'), true, 'ถอนซ้ำ (ไม่มีแล้ว) ต้องผ่าน');
  assert.equal(down?.classifyFailure('required variable POSTGRES_PASSWORD is missing a value'), false);
});
