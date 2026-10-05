// ────────────────────────────────────────────────────────────────────────────
// เจ้าของของ STRIPE_WEBHOOK_SECRET มีคนเดียว — พิสูจน์ได้ ไม่ต้องเดา
//
// กับดักที่ทำให้รอบก่อน ๆ ล้มตั้งแต่แรก: ค่านี้มีอยู่หลายไฟล์ แต่**มีผลจริงกับ
// container ที่เดียว** คือ infra/.env ที่ docker-compose อ่านไปแทนที่ ${…}
// ส่วน core-api/.env เป็นของ host-run (dotenv ในโปรเซสต์บน host) และ
// **ไม่มีผลกับ container เลย** เพราะ .dockerignore ตัด .env ออกจาก image
// และไม่มี mount ให้ด้วย
//
// ผลคือ: เจ้าของหมุน secret ใส่ core-api/.env (ตามที่เอกสารเดิมบอก) แล้ว
// หน้าเว็บยังปกติ แต่ webhook ปฏิเสธทุก delivery เงียบ ๆ ไม่มีอะไรเตือน
//
// ไฟล์นี้พิสูจน์ 3 อย่าง:
//   1) ค่าที่ "มีผลจริง" มาจากไฟล์เดียว และบอกชื่อไฟล์นั้นได้
//   2) fingerprint ของ secret เทียบกันได้โดยไม่ต้องเปิดเผยค่า
//      (หมุนแล้ว fingerprint เปลี่ยน = พิสูจน์ได้ว่ามีผลจริง ไม่ต้องเดา)
//   3) ถ้าไฟล์เจ้าของกับค่าที่ process ใช้อยู่ไม่ตรงกัน → ต้องบอกเสียงดัง
//
// ⚠️ ห้ามพิมพ์ค่า secret จริงลงที่ไหนในเทสต์นี้ — ใช้ค่าปลอมเท่านั้น
// ────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert';
import {
  WEBHOOK_SECRET_OWNER_FILE,
  HOST_RUN_ENV_FILE,
  fingerprintSecret,
  isUsableWebhookSecret,
  compareWebhookSecretSources,
  formatSecretDivergenceWarning,
} from '../src/services/webhook-secret-source.service';

// ค่าปลอมที่ไม่ใช่ของจริง (ห้ามใช้ค่าจริงแม้แต่ในเทสต์)
const OLD = 'whsec_test_old_value_placeholder_a';
const NEW = 'whsec_test_new_value_placeholder_b';

// ── 1) เจ้าของของค่า: ต้องมีข้อเดียว และชี้ไปไฟล์ที่มีผลจริง ────────────────

test('เจ้าของค่าคือ infra/.env ไฟล์เดียว (ไม่ใช่ core-api/.env ที่ไม่มีผลกับ container)', () => {
  assert.strictEqual(WEBHOOK_SECRET_OWNER_FILE, 'sovereign-os/infra/.env');
  // ต้องบอกเป็นคำ ๆ ว่า core-api/.env ไม่มีผล ไม่ใช่แค่ไม่เอ่ย
  assert.ok(HOST_RUN_ENV_FILE.includes('core-api/.env'),
    'ต้องระบุชื่อไฟล์ที่ "ดูเหมือนใช้" แต่ไม่มีผลจริง เพื่อกันคนไปแก้มัน');
});

// ── 2) fingerprint: เทียบได้ แต่เปิดเผยค่าไม่ได้ ─────────────────────────────

test('fingerprint ของค่าเดียวกัน = เท่ากัน และของค่าต่างกัน = ต่างกัน (พิสูจน์ว่าหมุนแล้วมีผล)', () => {
  assert.strictEqual(fingerprintSecret(OLD), fingerprintSecret(OLD), 'ค่าเดียวกันต้องได้ fingerprint เดียวกัน');
  assert.notStrictEqual(fingerprintSecret(OLD), fingerprintSecret(NEW), 'หมุนแล้ว fingerprint ต้องเปลี่ยน');
});

test('fingerprint ห้ามรั่วค่า secret (ไม่มีทั้งค่าเต็มและไม่มี prefix ของมัน)', () => {
  const fp = fingerprintSecret(OLD);
  assert.ok(!fp.includes(OLD), 'ห้ามมีค่าเต็ม');
  assert.ok(!OLD.startsWith(fp), 'ห้ามเป็น prefix ของค่า (เดา secret ที่ขึ้นต้นด้วยชื่อเดิมได้)');
  assert.ok(!OLD.includes(fp), 'ห้ามเป็น substring ของค่า');
  assert.ok(/^[0-9a-f]{8,}$/.test(fp), `ต้องเป็น hex hash เท่านั้น แต่ได้ ${fp}`);
});

test('fingerprint ของค่าว่าง = บอกว่าไม่ได้ตั้ง (ไม่ใช่ hash ของค่าว่างที่ดูเหมือนใช้ได้)', () => {
  const fp = fingerprintSecret('');
  assert.ok(!/^[0-9a-f]{8,}$/.test(fp), 'ค่าว่างต้องไม่ให้ fingerprint ที่ดูเหมือนมีค่าจริง');
  assert.match(fp, /ว่าง|empty|ไม่ได้ตั้ง/i);
});

test('fingerprint ต้องกันการเดาด้วย salt — secret คนละตัวให้ hash คนละตัวแม้ค่าจะเท่ากัน', () => {
  // กันกรณีถ้าวันหนึ่งมีคนเผลอ log ค่า fingerprint คงที่ข้ามคนละเจ้าของ
  assert.strictEqual(fingerprintSecret(OLD, 'ownerA'), fingerprintSecret(OLD, 'ownerA'));
  assert.notStrictEqual(fingerprintSecret(OLD, 'ownerA'), fingerprintSecret(OLD, 'ownerB'));
});

// ── 3) ค่าที่ใช้ได้จริง ──────────────────────────────────────────────────────

test('ค่าที่ถือว่า "ใช้ได้" = ขึ้นต้นด้วย whsec_ และยาวพอสมควร', () => {
  assert.strictEqual(isUsableWebhookSecret(NEW), true);
  assert.strictEqual(isUsableWebhookSecret(''), false, 'ว่าง = ใช้ไม่ได้');
  assert.strictEqual(isUsableWebhookSecret('   '), false, 'ช่องว่างล้วน = ใช้ไม่ไดะ (เคยพลาดเคยนี้)');
  assert.strictEqual(isUsableWebhookSecret('whsec_short'), false, 'whsec_ สั้นผิดปกติ = ไม่น่าเชื่อถือ');
  assert.strictEqual(isUsableWebhookSecret('sk_live_wrongprefix000000000000'), false, 'secret key ของ Stripe ไม่ใช่ signing secret');
  assert.strictEqual(isUsableWebhookSecret('rk_live_wrongprefix000000000000'), false);
});

// ── 4) การเทียบ: ไฟล์เจ้าของ vs ค่าที่ process ใช้จริง ─────────────────────

test('ตรงกัน → ไม่ต้องเตือน และบอกได้ว่าหมุนไปถึงจริงแล้ว', () => {
  const r = compareWebhookSecretSources({ ownerFileValue: NEW, runtimeValue: NEW });
  assert.strictEqual(r.matches, true);
  assert.strictEqual(r.warning, undefined, 'ตรงกันแล้วห้ามเตือนเปล่า ๆ (ทำให้ชินจนมองข้ามคำเตือนจริง)');
});

test('ไม่ตรงกัน → ต้องบอกชัดว่าหมุนไปไหนไม่ถึง (นี่คือกับดักของรอบก่อน)', () => {
  const r = compareWebhookSecretSources({ ownerFileValue: NEW, runtimeValue: OLD });
  assert.strictEqual(r.matches, false);
  assert.ok(r.warning, 'ไม่ตรงต้องมีคำเตือน');
  // คำเตือนต้องชี้ไฟล์ที่มีผลจริง ไม่ใช่ไฟล์ที่ไม่มีผล
  assert.match(String(r.warning), /infra\/\.env/);
  // คำเตือนต้องชี้ให้เห็น "ค่าที่ควรได้" โดยไม่เปิดเผยค่า — คือ fingerprint ของฝั่งไฟล์เจ้าของ
  assert.ok(r.warning.includes(r.ownerFingerprint), 'ต้องแสดง fingerprint ของค่าในไฟล์เจ้าของ ให้เทียบกับฝั่งที่รันอยู่');
  assert.ok(!String(r.warning).includes(NEW), 'คำเตือนห้ามรั่วค่า secret จริง');
});

test('ค่าว่างทั้งสองฝั่ง → ยังไม่ตั้ง (ต้องบอกต่างจาก "หมุนแล้วไม่ถึง")', () => {
  const r = compareWebhookSecretSources({ ownerFileValue: '', runtimeValue: '' });
  assert.strictEqual(r.matches, true, 'ยังไม่ได้ตั้ง = ตรงกันทั้งคู่ ไม่ใช่คนละเรื่องกับหมุนแล้วไม่ถึง');
  assert.match(String(r.warning ?? ''), /ยังไม่ได้ตั้ง|ยังไม่มีค่า/i, 'ต้องบอกว่ายังไม่ได้ตั้ง');
});

test('ไฟล์เจ้าของมีค่า แต่ค่าที่ process ใช้ว่าง → ต้องเตือนว่า container ยังไม่ได้รับ', () => {
  const r = compareWebhookSecretSources({ ownerFileValue: NEW, runtimeValue: '' });
  assert.strictEqual(r.matches, false);
  assert.ok(r.warning);
  assert.ok(!String(r.warning).includes(NEW), 'ห้ามรั่วค่า');
});

// ── 5) ข้อความที่คนดูแลจะเห็น: ต้องบอกทางแก้ ไม่ใช่แค่บอกว่าผิด ────────────────

test('ข้อความเตือนต้องมีคำสั่งที่แก้ได้จริง ไม่ใช่แค่บอกว่าไม่ตรง', () => {
  const w = formatSecretDivergenceWarning({
    ownerFileValue: NEW,
    runtimeValue: OLD,
    ownerFile: WEBHOOK_SECRET_OWNER_FILE,
  });
  assert.ok(w.includes('docker compose'), 'ต้องบอกคำสั่งที่ทำให้ค่ามีผลจริง');
  assert.ok(w.includes('--no-deps'), 'ต้องเติม --no-deps (ไม่แตะคอนเทนเนอร์อื่น)');
  assert.ok(w.includes('core-api'), 'ต้องเตือนว่า core-api/.env ไม่มีผลกับ container');
  assert.ok(!w.includes(NEW) && !w.includes(OLD), 'ข้อความห้ามรั่วค่า secret');
});

test('fingerprint ที่โชว์ต้องยาวพอใช้ตรวจ แต่สั้นพอไม่ใช่ secret', () => {
  const w = formatSecretDivergenceWarning({
    ownerFileValue: NEW,
    runtimeValue: OLD,
    ownerFile: WEBHOOK_SECRET_OWNER_FILE,
  });
  const fps = w.match(/[0-9a-f]{8,}/g) ?? [];
  assert.strictEqual(fps.length, 2, 'ต้องมี fingerprint ทั้งสองฝั่งให้เทียบกัน');
  assert.notStrictEqual(fps[0], fps[1], 'สองฝั่งนี้ต่างกันจริง (ไม่ใช่ค่าเดียวกัน)');
});