import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS, LEVELS, readConfig, writeConfig, normalize, shouldSend, cooldownMs, CONFIG_PATH,
} from '../machine-alert.config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const tmp = (obj) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alertcfg-'));
  const f = path.join(dir, 'alert-settings.json');
  if (obj !== undefined) fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return { f, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

describe('ค่าเริ่มต้น — เจ้าของสั่งปิดไว้ก่อน (12/10/69)', () => {
  test('ต้องปิดเป็นค่าเริ่มต้น ไม่ใช่เปิด', () => {
    assert.equal(DEFAULTS.enabled, false, 'เจ้าของบอก "อย่าพึ่งให้ทำงานพื้นหลังก็ได้"');
  });

  test('ค่าเริ่มต้นส่งเฉพาะวิกฤต (อย่าส่งทุกเรื่อง = รก)', () => {
    assert.equal(DEFAULTS.minLevel, 'critical');
    assert.ok(DEFAULTS.cooldownMin >= 60, 'ต้องกันส่งซ้ำถี่เกินไป');
  });

  test('ไฟล์ตั้งค่าที่ส่งมาต้องตรงกับค่าเริ่มต้น (ไม่ใช่เปิดทับไว้เงียบๆ)', () => {
    const onDisk = readConfig();
    assert.equal(onDisk.enabled, false);
    assert.equal(onDisk.minLevel, 'critical');
  });
});

describe('readConfig — ไฟล์เพี้ยนต้องไม่ทำให้ส่งรัว', () => {
  test('ไม่มีไฟล์ = ใช้ค่าเริ่มต้น (ปิด)', () => {
    const t = tmp(undefined);
    try {
      assert.equal(readConfig(t.f).enabled, false);
    } finally { t.cleanup(); }
  });

  test('JSON พัง = ใช้ค่าเริ่มต้น (ปิด) ไม่ใช่ error', () => {
    const t = tmp('{ พัง');
    try {
      const c = readConfig(t.f);
      assert.equal(c.enabled, false);
      assert.equal(c.minLevel, 'critical');
    } finally { t.cleanup(); }
  });

  test('enabled เป็น "true" (สตริง) = ต้องยังปิด ไม่ใช่เปิด', () => {
    // "true" ไม่ใช่ boolean true → ถือว่าปิด ปลอดภัยกว่าส่งรัวโดยเจ้าของไม่ได้สั่ง
    const t = tmp({ enabled: 'true' });
    try {
      assert.equal(readConfig(t.f).enabled, false);
    } finally { t.cleanup(); }
  });

  test('minLevel แปลกปลอม = บังคับกลับเป็น critical', () => {
    const t = tmp({ enabled: true, minLevel: 'ทุกอย่าง' });
    try {
      assert.equal(readConfig(t.f).minLevel, 'critical');
    } finally { t.cleanup(); }
  });

  test('cooldown ติดลบ/ไม่ใช่เลข = ใช้ค่าเริ่มต้น', () => {
    const t = tmp({ enabled: true, cooldownMin: -5 });
    try {
      assert.equal(readConfig(t.f).cooldownMin, DEFAULTS.cooldownMin);
    } finally { t.cleanup(); }
  });
});

describe('normalize / writeConfig', () => {
  test('เขียนแล้วอ่านกลับได้ค่าเดิม', () => {
    const t = tmp(undefined);
    try {
      const saved = writeConfig({ enabled: true, minLevel: 'warn', cooldownMin: 30 }, t.f);
      assert.deepEqual(readConfig(t.f), saved);
      assert.equal(saved.minLevel, 'warn');
      assert.equal(saved.cooldownMin, 30);
    } finally { t.cleanup(); }
  });

  test('ค่าเพี้ยนที่เขียนเข้าไป = ถูกแก้ก่อนบันทึก', () => {
    const t = tmp(undefined);
    try {
      const saved = writeConfig({ enabled: true, minLevel: 'โหด', cooldownMin: 'x' }, t.f);
      assert.equal(saved.minLevel, 'critical');
      assert.equal(saved.cooldownMin, DEFAULTS.cooldownMin);
    } finally { t.cleanup(); }
  });
});

describe('shouldSend — กรองตามระดับ', () => {
  test('ปิดอยู่ = ไม่ส่งแม้แต่วิกฤต (นี่คือสิ่งที่เจ้าของขอ)', () => {
    assert.equal(shouldSend('critical', { enabled: false, minLevel: 'critical', cooldownMin: 60 }), false);
  });

  test('เปิด + critical = ส่งวิกฤต �ไม่ส่ง warn/info', () => {
    const cfg = { enabled: true, minLevel: 'critical', cooldownMin: 60 };
    assert.equal(shouldSend('critical', cfg), true);
    assert.equal(shouldSend('warn', cfg), false);
    assert.equal(shouldSend('info', cfg), false);
  });

  test('เปิด + warn = ส่งวิกฤตและเตือน แต่ไม่ส่ง info', () => {
    const cfg = { enabled: true, minLevel: 'warn', cooldownMin: 60 };
    assert.equal(shouldSend('critical', cfg), true);
    assert.equal(shouldSend('warn', cfg), true);
    assert.equal(shouldSend('info', cfg), false);
  });

  test('ระดับที่ไม่รู้จัก = ไม่ส่ง', () => {
    assert.equal(shouldSend('banana', { enabled: true, minLevel: 'info', cooldownMin: 0 }), false);
  });
});

describe('cooldownMs', () => {
  test('0 = ไม่ส่งซ้ำเลยจนกว่าจะหายแล้วกลับมา', () => {
    assert.equal(cooldownMs({ enabled: true, minLevel: 'critical', cooldownMin: 0 }), 0);
  });

  test('ค่าปกติแปลงเป็นมิลลิวินาที', () => {
    assert.equal(cooldownMs({ enabled: true, minLevel: 'critical', cooldownMin: 90 }), 90 * 60_000);
  });
});

describe('machine-alert.mjs ต้องเคารพสวิตช์', () => {
  const src = () => fs.readFileSync(path.join(REPO, 'tools', 'machine-alert.mjs'), 'utf8');

  test('ต้องอ่านค่าตั้งจากไฟล์ config', () => {
    assert.match(src(), /readAlertConfig|machine-alert\.config\.mjs/);
  });

  test('canSend ต้องรวมเงื่อนไข "สวิตช์เปิด" (ไม่งั้น config เป็นของตาย)', () => {
    assert.match(src(), /canSend\s*=.*alertCfg\.enabled/, 'canSend ต้องเช็ค enabled');
  });

  test('ปิดสวิตช์ = ห้ามมาร์คว่าส่งแล้ว (ไม่งั้นเปิดกลับมาไม่ส่งซ้ำเลย)', () => {
    const s = src();
    const mark = /if \(!DRY && sent\) state\.alerts\[/.test(s);
    assert.ok(mark, 'ต้องมีการมาร์ค state');
    // state.alerts ต้องถูกลบตอนปิดสวิตช์
    assert.match(s, /!DRY && alertCfg\.enabled\) delete state\.alerts/, 'ห้ามลบ state ตอนปิดสวิตช์');
  });

  test('ต้องบันทึกเหตุผลว่าถูกระงับ (suppressed) เพื่อให้ดูย้อนหลังได้', () => {
    assert.match(src(), /alerts-off/);
  });
});

describe('ต้องสั่งถึงจะส่ง — ไม่ใช่รันเองอัตโนมัติ (เจ้าของสั่ง 12/10/69)', () => {
  const src = () => fs.readFileSync(path.join(REPO, 'tools', 'machine-alert.mjs'), 'utf8');

  test('ต้องมี --send เป็นเงื่อนไขบังคับ', () => {
    assert.match(src(), /--send/, 'ต้องอ่านธง --send');
    assert.match(src(), /&& SEND/, 'canSend ต้องรวมเงื่อนไข --send');
  });

  test('canSend ต้องไม่มีทางเป็นจริงถ้าไม่ได้สั่ง --send', () => {
    const m = /const canSend = ([^;]+);/.exec(src());
    assert.ok(m, 'ต้องมี canSend');
    assert.match(m[1], /SEND/, `canSend ต้องเช็ค SEND: ${m[1]}`);
  });

  test('ต้องแยกเหตุผลได้: ไม่ได้สั่ง ≠ สวิตช์ปิด (ไม่งั้นหาสาเหตุยาก)', () => {
    assert.match(src(), /not-requested/);
    assert.match(src(), /alerts-off/);
  });

  test('ต้องบอกคำสั่งที่ใช้สั่งเอง', () => {
    assert.match(src(), /alerts\.mjs now/);
  });

  test('งานตั้งเวลาต้องไม่ใส่ --send (ถ้าใส่ = กลับไปยิงเองอัตโนมัติ)', () => {
    const cmd = path.join(REPO, 'tools', 'hidden-tasks', 'sovereign-machine-watch.cmd');
    assert.ok(fs.existsSync(cmd), 'ต้องมีไฟล์คำสั่งของงาน');
    const body = fs.readFileSync(cmd, 'ascii');
    assert.ok(!/--send\b/.test(body), 'งานตั้งเวลาห้ามใส่ --send — เจ้าของสั่งให้รันเมื่อสั่งเท่านั้น');
    assert.match(body, /machine-alert\.mjs/, 'ต้องยังตรวจสุขภาพต่อ (หน้า /system-health ใช้)');
  });

  test('alerts.mjs ต้องมีคำสั่ง now', () => {
    const s = fs.readFileSync(path.join(REPO, 'tools', 'alerts.mjs'), 'utf8');
    assert.match(s, /cmd === 'now'/, 'ต้องมี now');
    assert.match(s, /'--send'/, 'now ต้องส่งแฟล็ก --send');
  });

  test('ค่าเริ่มต้นต้องปิด เพื่อให้ต่อให้ไม่ส่งเอง', () => {
    const onDisk = readConfig();
    assert.equal(onDisk.enabled, false);
  });
});

describe('ปุ่มสลับใช้งาน', () => {
  test('คำสั่ง on/off/critical/warn/cooldown ต้องมีอยู่จริง', () => {
    const s = fs.readFileSync(path.join(REPO, 'tools', 'alerts.mjs'), 'utf8');
    for (const c of ["'on'", "'off'", "'critical'", "'warn'", "'cooldown'"]) {
      assert.ok(s.includes(c), `ต้องรองรับ ${c}`);
    }
  });

  test('LEVELS ต้องเรียงจากไม่ร้ายแรงไปร้ายแรง (เทียบระดับถูกต้อง)', () => {
    assert.deepEqual(LEVELS, ['info', 'warn', 'critical']);
  });

  test('ไฟล์ตั้งค่าต้องอยู่ในตำแหน่งที่ค่าเริ่มต้นชี้', () => {
    assert.ok(fs.existsSync(CONFIG_PATH), 'ต้องมีไฟล์ตั้งค่าอยู่จริง');
  });
});