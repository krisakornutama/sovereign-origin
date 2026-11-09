// tools/test/uninstall-clean.test.mjs — เทสต์แผนถอนที่ "สะอาด" ตาม acceptance ของคิว install-uninstall-clean
//
// ทดสอบ buildUninstallPlan() แบบ pure: ฉีด platform/hasCompose เข้าไปได้
// จึงรันได้ทั้ง Windows และ Linux โดยไม่ต้องมี Docker/schtasks จริง
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUninstallPlan } from '../install/uninstall.mjs';

const stepsOf = (plan, id) => plan.steps.filter((s) => s.id === id || s.id.startsWith(`${id}:`));
const commands = (plan) => plan.steps.filter((s) => s.command);
const composeStep = (plan) => plan.steps.find((s) => s.id === 'compose-down');

test('U1: ค่าเริ่มต้น (Windows) — หยุด task + container แต่ไม่ลบ volume', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true });

  const stopTask = stepsOf(plan, 'stop-task')[0];
  assert.ok(stopTask, 'ต้องมีขั้นหยุด scheduled task บน Windows');
  assert.equal(stopTask.command, 'schtasks');
  assert.deepEqual(stopTask.args, ['/Delete', '/TN', 'Sovereign Agent Runner', '/F']);
  assert.equal(stopTask.tolerateFailure, true, 'task ไม่มีอยู่ = ต้องไม่ทำให้ exit ไม่ใช่ 0');

  const down = composeStep(plan);
  assert.equal(down.command, 'docker');
  assert.deepEqual(down.args.slice(-1), ['down'], 'ต้องเป็น compose down เปล่า ๆ');
  assert.ok(!down.args.includes('-v'), 'ห้ามลบ volume เว้นแต่ --purge-data');

  assert.equal(stepsOf(plan, 'purge-backups').length, 0, 'ไม่ลบ backup โดยไม่สั่ง');
  assert.deepEqual(plan.warnings, [], 'การถอนแบบเก็บข้อมูลต้องไม่มีคำเตือนเรื่องลบถาวร');
});

test('U2: Linux/macOS ไม่แตะ schtasks เลย', () => {
  for (const platform of ['linux', 'darwin']) {
    const plan = buildUninstallPlan({ platform, hasCompose: true });
    assert.equal(
      commands(plan).filter((s) => s.command === 'schtasks').length,
      0,
      `${platform}: ต้องไม่มีคำสั่ง schtasks`
    );
    assert.equal(stepsOf(plan, 'stop-task').length, 0, `${platform}: ต้องไม่มีขั้น stop-task`);
    assert.equal(composeStep(plan).command, 'docker');
  }
});

test('U3: --purge-data ลบ volume + backup พร้อมคำเตือนว่ากู้คืนไม่ได้', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true, purgeData: true });

  const down = composeStep(plan);
  assert.ok(down.args.includes('-v'), '--purge-data ต้องสั่งลบ volume (-v)');
  assert.ok(down.args.includes('--remove-orphans'));

  const backups = stepsOf(plan, 'purge-backups')[0];
  assert.ok(backups, 'ต้องมีขั้นลบ backup');
  assert.equal(backups.tolerateFailure, true, 'ถอนซ้ำ (ไม่มีโฟลเดอร์แล้ว) ต้องไม่ล้ม');
  assert.equal(backups.command, 'cmd');
  assert.deepEqual(backups.args.slice(0, 4), ['/c', 'rmdir', '/s', '/q']);

  assert.ok(
    plan.warnings.some((w) => w.includes('กู้คืนไม่ได้')),
    'ต้องเตือนว่ากู้คืนไม่ได้'
  );

  const linux = buildUninstallPlan({ platform: 'linux', hasCompose: true, purgeData: true });
  const linuxBackups = stepsOf(linux, 'purge-backups')[0];
  assert.equal(linuxBackups.command, 'rm');
  assert.equal(linuxBackups.args[0], '-rf');
});

test('U4: ถอนซ้ำได้ — ทุกคำสั่งที่แตะระบบถูกทำเครื่องหมาย tolerateFailure', () => {
  const plan = buildUninstallPlan({ platform: 'win32', hasCompose: true, purgeData: true, purgeImages: true });
  const runnable = plan.steps.filter((s) => s.command && !s.manual);
  assert.ok(runnable.length > 0, 'ต้องมีขั้นที่รันได้จริงให้ตรวจ');
  for (const step of runnable) {
    assert.equal(step.tolerateFailure, true, `${step.id}: ต้อง tolerateFailure เพื่อให้ถอนซ้ำได้`);
  }
  // แผนต้อง deterministic — รันซ้ำได้ผลเหมือนเดิม
  assert.deepEqual(buildUninstallPlan({ platform: 'win32', hasCompose: true, purgeData: true, purgeImages: true }), plan);
});

test('U5: ไม่มี docker-compose.yml → ข้ามขั้น container โดยไม่ทำให้ล้ม', () => {
  const plan = buildUninstallPlan({ platform: 'linux', hasCompose: false });
  const down = composeStep(plan);
  assert.equal(down.skip, true);
  assert.equal(down.command, '');
  assert.equal(down.tolerateFailure, undefined);
  assert.equal(commands(plan).filter((s) => s.command === 'docker').length, 0);
});

test('U6: --purge-images ลบ image ที่ชุดนี้ดึงมา (และไม่ลบถ้าไม่สั่ง)', () => {
  const kept = buildUninstallPlan({ platform: 'linux', hasCompose: true });
  assert.equal(stepsOf(kept, 'rmi').length, 0, 'ค่าเริ่มต้นต้องไม่ลบ image');

  const purged = buildUninstallPlan({ platform: 'linux', hasCompose: true, purgeImages: true });
  const rmis = stepsOf(purged, 'rmi');
  assert.ok(rmis.length >= 2, 'ต้องลบทั้ง api และ web image');
  for (const step of rmis) {
    assert.equal(step.command, 'docker');
    assert.deepEqual(step.args.slice(0, 1), ['rmi']);
    assert.equal(step.tolerateFailure, true);
  }
});

test('U7: --remove-files เป็นคำสั่ง manual ตาม OS (ไม่ลบซอร์สเอง)', () => {
  const win = buildUninstallPlan({ platform: 'win32', hasCompose: true, removeFiles: true });
  const winStep = win.steps.find((s) => s.id === 'remove-files');
  assert.equal(winStep.command, '', 'ห้ามลบโฟลเดอร์ที่กำลังรันอยู่เอง');
  assert.match(winStep.manual, /rmdir \/s \/q/);
  assert.ok(win.warnings.some((w) => w.includes('--remove-files')));

  const nix = buildUninstallPlan({ platform: 'linux', hasCompose: true, removeFiles: true });
  assert.match(nix.steps.find((s) => s.id === 'remove-files').manual, /rm -rf/);
});

test('U8: บอกรายการที่ "ไม่ถอน" ครบและตรงกับตัวเลือก', () => {
  const plain = buildUninstallPlan({ platform: 'win32', hasCompose: true });
  const keptText = plain.kept.join(' | ');
  assert.match(keptText, /volume/, 'ต้องบอกว่า volume ข้อมูลยังอยู่');
  assert.match(keptText, /backups/, 'ต้องบอกว่า backup ยังอยู่');
  assert.match(keptText, /Docker image/, 'ต้องบอกว่า image ยังอยู่');
  assert.match(keptText, /ชุดติดตั้ง/, 'ต้องบอกว่าโฟลเดอร์ติดตั้งยังอยู่');
  assert.match(keptText, /\.env/, 'ต้องบอกว่า .env ยังอยู่');

  const purged = buildUninstallPlan({ platform: 'win32', hasCompose: true, purgeData: true, purgeImages: true, removeFiles: true });
  const purgedText = purged.kept.join(' | ');
  assert.doesNotMatch(purgedText, /Docker volume/, 'ลบข้อมูลแล้วต้องไม่บอกว่าเก็บ volume');
  assert.doesNotMatch(purgedText, /backups/, 'ลบ backup แล้วต้องไม่บอกว่าเก็บไว้');
  assert.match(purgedText, /\.env/, 'ยังต้องบอกว่า .env ไม่ได้ถูกลบ');
});
