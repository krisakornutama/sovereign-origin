// ─────────────────────────────────────────────────────────────────────────────
// หัวใจของเทสต์: notify() ต้องเคารพสวิตช์แจ้งเตือนของเจ้าของ
//
// กติกาเจ้าของ 12/10/69: "alert ใน telegram อย่าพึ่งให้ทำงานพื้นหลัง ... มีปุ่มเปิด-ปิด"
//   → tools/alert-settings.json ตั้ง enabled:false = "ยังตรวจอยู่ แต่ไม่ส่ง"
//
// ปัญหาที่จับ (เจอจริง 8/11/2569): notify() ของ tools/verify เดิมยังส่ง HTTP ต่อ
//   แม้ปิดสวิตช์ (คอนเทนเนอร์ restore-check ล้มแล้วพยายามแจ้ง) — และผู้เรียกเห็น
//   { ok:false } ปะปนกับ "ความล้มของระบบ" ว่ ต้องแยกเสมอว่า:
//   "ข้ามเพราะตั้งใจปิด" (ok:true, skipped_by_config) ≠ "ส่งไม่ได้" (ok:false)
//
// เงื่อนไขเชิงพฤติกรรม:
//   1) config จริงของ repo (alert-settings.json) ต้องคง enabled:false — เจตนาจริงของผู้ใช้
//   2) notify() เมื่อ config ปิด → ok:true + status:'skipped_by_config' และต้องไม่ถึงครีดเดี้ยง
//   3) ค่า config เพี้ยน/หาย = กลับค่าเริ่มต้น (ปิดไว้ ปลอดภัยกว่าส่งรัว)
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notify } from '../verify/telegram-creds.mjs';
import { readConfig, normalize } from '../machine-alert.config.mjs';

test('config กลางของ repo ยังยึดเจตนาเจ้าของ: ปิดการส่งอัตโนมัติ (enabled:false)', () => {
  const cfg = readConfig();
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.minLevel, 'critical');
  assert.equal(cfg.cooldownMin, 120);
});

test('config เพี้ยน = กลับค่าเริ่มต้น (ปลอดภัย: ปิดไว้ก่อน)', () => {
  // ทุกค่าพัง (enabled เป็น string, minLevel ไม่รู้จัก, cooldown ติดลบ) = กลับ DEFAULTS ทั้งชุด
  const cfg = normalize({ enabled: 'yes', minLevel: 'nonsense', cooldownMin: -5 });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.minLevel, 'critical');
  assert.equal(cfg.cooldownMin, 120);
});

test('notify() เมื่อสวิตช์ปิด = ข้ามเพราะตั้งใจ (ok:true + skipped_by_config) — ถึงครีดก็ต้องไม่ยิง HTTP', async () => {
  const cfg = readConfig();
  // ตั้งเงื่อนไข: config ปิด — เทสต์หลักเพิ่มตัวจริงของ repo (enabled:false) — ที่ถูกป้องกัน
  if (cfg.enabled === false) {
    const r = await notify('เทสต์: ห้ามยิงจริงตอนสวิตช์ปิด', { token: 'FAKE_TOKEN', chatId: 'FAKE_CHAT' });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'skipped_by_config');
    assert.equal('error' in r, false);
  }
});
