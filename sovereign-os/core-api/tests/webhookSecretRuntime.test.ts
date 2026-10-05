// ────────────────────────────────────────────────────────────────────────────
// ตอนบูต ระบบต้องพูดได้ว่า "ค่าที่รันอยู่ตรงกับไฟล์เจ้าของไหม"
// ────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert';
import {
  evaluateWebhookSecretProvenance,
  reportWebhookSecretProvenance,
} from '../src/services/webhook-secret-source.runtime';
import { fingerprintSecret } from '../src/services/webhook-secret-source.service';

// ค่าปลอมเท่านั้น — ห้ามใช้ค่าจริงแม้แต่ในเทสต์
const OLD = 'whsec_test_runtime_old_placeholder';
const NEW = 'whsec_test_runtime_new_placeholder';

test('ตรงกัน → comparable=true และไม่มีคำเตือน', () => {
  const r = evaluateWebhookSecretProvenance({ ownerFileValue: NEW, runtimeValue: NEW });
  assert.strictEqual(r.comparable, true);
  assert.strictEqual(r.warning, undefined, 'ตรงกันแล้วห้ามเตือน (ถ้าเตือนทุกบูต คนจะชินจนมองข้ามคำเตือนจริง)');
  assert.strictEqual(r.ownerFingerprint, r.runtimeFingerprint);
});

test('ไม่ตรง (หมุนแล้วค่าไม่ถึง container) → ต้องเตือนพร้อมบอกคำสั่งแก้', () => {
  const r = evaluateWebhookSecretProvenance({ ownerFileValue: NEW, runtimeValue: OLD });
  assert.strictEqual(r.comparable, true);
  assert.ok(r.warning, 'ต้องเตือน');
  assert.match(String(r.warning), /docker compose/);
  assert.match(String(r.warning), /--no-deps/);
  // ห้ามรั่วค่า
  assert.ok(!String(r.warning).includes(NEW), 'ห้ามรั่วค่าฝั่งไฟล์เจ้าของ');
  assert.ok(!String(r.warning).includes(OLD), 'ห้ามรั่วค่าฝั่ง runtime');
});

test('อ่านไฟล์เจ้าของไม่ได้ (ownerFileValue=null) → comparable=false และบอกตรง ๆ ว่าตรวจไม่ได้', () => {
  const r = evaluateWebhookSecretProvenance({ ownerFileValue: null, runtimeValue: NEW });
  assert.strictEqual(r.comparable, false, 'ต้องแยก "ตรวจไม่ได้" ออกจาก "ตรงกัน"');
  assert.ok(r.warning, 'ต้องบอกว่าตรวจเทียบไม่ได้ (ไม่ใช่เงียบ)');
  assert.match(String(r.warning), /ไม่พบ|อ่าน.*ไม่ได้|ตรวจเทียบไม่ได้/);
  assert.ok(!String(r.warning).includes(NEW), 'ห้ามรั่วค่า');
});

test('ทั้งสองฝั่งยังไม่ได้ตั้ง → เตือนว่ายังไม่ได้ตั้ง ไม่ใช่ว่าไม่ตรง', () => {
  const r = evaluateWebhookSecretProvenance({ ownerFileValue: '', runtimeValue: '' });
  assert.strictEqual(r.comparable, true);
  assert.ok(r.warning);
  assert.match(String(r.warning), /ยังไม่ได้ตั้ง|ยังไม่มีค่า/);
  assert.strictEqual(r.runtimeUsable, false);
});

test('ค่าที่ใช้อยู่ไม่ใช่ whsec_ (เช่นคัด sk_live มาวางผิดช่อง) → runtimeUsable=false', () => {
  const r = evaluateWebhookSecretProvenance({ ownerFileValue: NEW, runtimeValue: 'sk_live_wrongkind' });
  assert.strictEqual(r.runtimeUsable, false, 'ต้องจับได้ว่าค่าผิดชนิด ไม่ใช่แค่ตรงกับไฟล์');
});

test('runtimeUsable=true เมื่อค่าเป็น whsec_ ที่ยาวพอ', () => {
  const r = evaluateWebhookSecretProvenance({ ownerFileValue: NEW, runtimeValue: NEW });
  assert.strictEqual(r.runtimeUsable, true);
});

test('reportWebhookSecretProvenance ต้องไม่โยน error แม้อ่านไฟล์ไม่ได้ (บูตต้องได้เสมอ)', () => {
  // บนเครื่อง dev ไม่มี /app/host-infra.env → ต้องยังคืนค่า ไม่ throw
  const r = reportWebhookSecretProvenance();
  assert.ok(typeof r.comparable === 'boolean');
  assert.ok(typeof r.runtimeUsable === 'boolean');
  assert.ok(typeof r.runtimeFingerprint === 'string');
  // fingerprint ของค่าที่รันอยู่ต้องไม่ใช่ค่าดิบ
  assert.notStrictEqual(r.runtimeFingerprint, process.env.STRIPE_WEBHOOK_SECRET ?? '');
});

test('fingerprint ที่ log ออกไปต้องไม่มีส่วนของค่า secret หลุดออกไป', () => {
  const fp = fingerprintSecret(NEW);
  for (let n = 4; n <= NEW.length; n += 4) {
    assert.ok(!fp.includes(NEW.slice(0, n)), `fingerprint ห้ามมี prefix ${n} ตัวของค่า`);
  }
});