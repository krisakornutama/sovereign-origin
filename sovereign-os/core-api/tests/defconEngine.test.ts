import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import {
  classifyDefcon,
  DefconEngine,
  type DefconLevel,
  type DefconConfig,
  type DefconDeps,
} from '../src/services/defcon-engine.service';

// ─────────────────────────── classifyDefcon ───────────────────────────

test('classifyDefcon maps threat index to DEFCON level (strict > per spec)', () => {
  assert.strictEqual(classifyDefcon(0), 0);
  assert.strictEqual(classifyDefcon(50), 0); // ต้อง > 50 ถึงเป็น level 3
  assert.strictEqual(classifyDefcon(51), 3);
  assert.strictEqual(classifyDefcon(75), 3); // ต้อง > 75 ถึงเป็น level 2
  assert.strictEqual(classifyDefcon(76), 2);
  assert.strictEqual(classifyDefcon(90), 2); // ต้อง > 90 ถึงเป็น level 1
  assert.strictEqual(classifyDefcon(91), 1);
  assert.strictEqual(classifyDefcon(100), 1);
});

test('classifyDefcon treats NaN and negative as level 0', () => {
  assert.strictEqual(classifyDefcon(NaN), 0);
  assert.strictEqual(classifyDefcon(-10), 0);
});

// ─────────────────────────── engine ───────────────────────────

const DEFAULT_CFG: DefconConfig = {
  hysteresis: 10,
  actions: {
    3: [{ id: 'charge_battery' }, { id: 'telegram_stats' }],
    2: [{ id: 'backup_cold_storage' }, { id: 'relays_off' }],
    1: [{ id: 'wan_disconnect' }, { id: 'security_on' }],
  },
};

function makeEngine(overrides: Partial<DefconDeps> = {}, cfg: DefconConfig = DEFAULT_CFG) {
  const actions: Array<{ level: DefconLevel; action: string }> = [];
  const deps: DefconDeps = {
    async runAction(level, action) {
      actions.push({ level, action: action.id });
    },
    ...overrides,
  };
  const engine = new DefconEngine(deps, cfg);
  return { deps, engine, actions };
}

test('engine escalates to level 3 when crossing 50', async () => {
  const { engine, actions } = makeEngine();
  const result = await engine.check(55);
  assert.strictEqual(result.level, 3);
  assert.deepStrictEqual(
    result.actionsRun.map((a) => a.id),
    ['charge_battery', 'telegram_stats']
  );
  assert.deepStrictEqual(
    actions.map((a) => a.action),
    ['charge_battery', 'telegram_stats']
  );
});

test('engine escalates directly to the highest level crossed', async () => {
  const { engine, actions } = makeEngine();
  // ข้ามจาก 0 ตรงไป 1 (> 90) — ต้องยิง action ของทุก level ที่ข้าม (3, 2, 1)
  const result = await engine.check(95);
  assert.strictEqual(result.level, 1);
  assert.deepStrictEqual(
    result.actionsRun.map((a) => a.id),
    ['charge_battery', 'telegram_stats', 'backup_cold_storage', 'relays_off', 'wan_disconnect', 'security_on']
  );
});

test('engine does not re-run actions on consecutive checks at the same level', async () => {
  const { engine, actions } = makeEngine();
  await engine.check(55); // level 3
  await engine.check(60); // level 3 อีกครั้ง
  assert.strictEqual(actions.length, 2);
});

test('engine re-arms and fires actions again after returning to level 0', async () => {
  const { engine, actions } = makeEngine();
  await engine.check(55); // → 3
  await engine.check(10); // → 0
  await engine.check(55); // → 3 อีกครั้ง
  assert.strictEqual(actions.length, 4);
});

test('engine de-escalates only below threshold minus hysteresis', async () => {
  const { engine, actions } = makeEngine();
  await engine.check(80); // → level 2
  // อยู่ที่ 2: 72 ยังสูงเกิน (75 - 10 = 65) → ไม่ลด
  const staying = await engine.check(72);
  assert.strictEqual(staying.level, 2);
  // 60 → level 3 (ผ่าน hysteresis แล้ว)
  const dropping = await engine.check(60);
  assert.strictEqual(dropping.level, 3);
});

test('engine fires no new actions on de-escalation (actions are once per episode)', async () => {
  const { engine, actions } = makeEngine();
  await engine.check(95); // → 1 (ยิง 3+2+1)
  const before = actions.length; // 6
  const result = await engine.check(60); // → 3 (ผ่าน hysteresis)
  assert.strictEqual(result.level, 3);
  // ลดระดับไม่ยิง action ใหม่ — มาตรการเดิมยังค้างอยู่ ไม่ยกเลิกเอง
  assert.deepStrictEqual(result.actionsRun, []);
  assert.strictEqual(actions.length, before);
});

test('engine with no actions configured stays at correct level', async () => {
  const cfg: DefconConfig = { hysteresis: 10, actions: {} };
  const { engine } = makeEngine({}, cfg);
  const result = await engine.check(85);
  assert.strictEqual(result.level, 2);
  assert.deepStrictEqual(result.actionsRun, []);
});

test('engine.getLevel reflects current level without running actions', async () => {
  const { engine, actions } = makeEngine();
  await engine.check(95);
  assert.strictEqual(engine.getLevel(), 1);
  assert.strictEqual(actions.length, 6);
  assert.strictEqual(engine.getLevel(), 1); // ไม่มีการรัน action เพิ่ม
});
