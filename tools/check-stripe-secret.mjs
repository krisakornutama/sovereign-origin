#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// check-stripe-secret.mjs — พิสูจน์ว่า "หมุน secret แล้ว" มีผลจริงหรือยัง
//
// ปัญหาที่คำสั่งนี้มีไว้แก้ (วัดจริง 4/10/69):
//   STRIPE_WEBHOOK_SECRET มีอยู่ใน core-api/.env ซึ่ง*ไม่มีผลกับ container*
//   ค่าที่มีผลจริงอยู่ใน infra/.env (docker-compose อ่านแล้วส่งเข้า container)
//   เจ้าของจึงหมุนค่าใส่ไฟล์ผิด → หน้าเว็บปกติ แต่ webhook ปฏิเสธทุก delivery
//   แบบเงียบ ไม่มีอะไรเตือนจนกว่าลูกค้าจ่ายเงินจริง
//
// คำสั่งนี้เทียบ 4 อย่างโดยพิมพ์แค่ fingerprint (hash 12 ตัว) ไม่เคยพิมพ์ค่าจริง:
//   1. ค่าในไฟล์เจ้าของ  sovereign-os/infra/.env      ← สิ่งที่เจ้าของแก้
//   2. ค่าที่ core-api/.env  (ไฟล์ที่ไม่มีผลกับ container — เทียบให้เห็นว่าหลุด)
//   3. ค่าที่ container เห็นจากไฟล์เจ้าของที่ mount เข้าไป
//   4. ค่าที่ container ใช้จริงตอนนี้                    ← สิ่งที่ "มีผล"
//
// ผ่าน = 1 ตรงกับ 4 ⇒ หมุนแล้วมีผลจริง  ไม่ต้องเดา
//
// กติกาการรายงาน (สำคัญกว่าตัวตรวจ): ต้องแยกให้ออกว่า
//   · "อ่านไฟล์ไม่ได้" (ปัญหาเครื่อง/สิทธิ์) กับ
//   · "อ่านได้ แต่ไม่มีคีย์นี้" (สถานะที่ถูกต้องหลังลบคีย์หลุดออกแล้ว)
// สองอย่างนี้คนละเรื่องกัน — ถ้าสับสน คนจะหยุดเชื่อผลลัพธ์ทั้งหมด ซึ่งแย่กว่า
// การไม่มีเครื่องมือเลย
//
// ใช้: npm run check:stripe-secret        (จากราก repo)
// หรือ: node tools/check-stripe-secret.mjs
//
// ⚠️ ไม่แก้/ไม่หมุน/ไม่เขียนค่าใด ๆ — คำสั่งนี้อ่านอย่างเดียว (ปลอดภัยพอจะรันได้ทันที
//    ทั้งก่อนและหลังเปิดขายจริง) · ไม่แตะ container · ไม่ยิง Stripe
// ────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvKeyState } from './env-secret-ownership.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_FILE = join(ROOT, 'sovereign-os', 'infra', '.env');
const HOST_RUN_FILE = join(ROOT, 'sovereign-os', 'core-api', '.env');
const CONTAINER = 'sovereign-core-api';
const KEY = 'STRIPE_WEBHOOK_SECRET';
const MOUNTED_OWNER_FILE = '/app/host-infra.env';

/** fingerprint 12 ตัว — เทียบกันได้ แต่เอาไปเซ็นอะไรไม่ได้ (จึงไม่อันตรายเท่าค่าจริง) */
function fingerprint(secret) {
  const s = String(secret ?? '').trim();
  if (!s) return 'ว่าง (ไม่ได้ตั้ง)';
  return createHash('sha256').update(`sovereign-webhook:${s}`).digest('hex').slice(0, 12);
}

function usable(s) {
  const t = String(s ?? '').trim();
  return t.startsWith('whsec_') && t.length - 'whsec_'.length >= 16;
}

/** อ่านค่าหนึ่งคีย์จากไฟล์บนเครื่อง — แยก 3 สถานะ (ดู readEnvKeyState) */
function readLocalEnvKey(file, key) {
  if (!existsSync(file)) return { state: 'unreadable' };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return { state: 'unreadable' }; }
  return readEnvKeyState(text, key);
}

/** ค่าที่ container ใช้จริง — อ่านจาก process ที่รันอยู่ ไม่ใช่จากไฟล์ */
function containerRuntimeValue() {
  try {
    const out = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c',
      `printenv ${KEY} || true`], { encoding: 'utf8', timeout: 15000 });
    return out.trim();
  } catch {
    return null;
  }
}

/** ไฟล์เจ้าของที่ container เห็น (mount เป็น :ro) — ใช้ยืนยันว่า compose อ่านไฟล์ไหนจริง */
function containerMountedOwnerValue() {
  try {
    const out = execFileSync('docker', ['exec', CONTAINER, 'sh', '-c',
      `grep "^${KEY}=" ${MOUNTED_OWNER_FILE} 2>/dev/null | cut -d= -f2- || true`],
      { encoding: 'utf8', timeout: 15000 });
    return out.trim();
  } catch {
    return null;
  }
}

function containerRunning() {
  try {
    return execFileSync('docker', ['inspect', '-f', '{{.State.Status}}', CONTAINER],
      { encoding: 'utf8', timeout: 15000 }).trim();
  } catch {
    return null;
  }
}

/** ข้อความของแต่ละสถานะ — ต้องบอกคนได้ว่าควรทำอะไรต่อ ไม่ใช่แค่บอกชื่อสถานะ */
function describe(result, { expectPresent }) {
  if (result.state === 'present') return fingerprint(result.value);
  if (result.state === 'absent') {
    return expectPresent
      ? 'ไม่มีคีย์นี้ในไฟล์'
      : 'ไม่มีคีย์นี้แล้ว (ถูกต้อง — มีเจ้าของค่าไฟล์เดียว)';
  }
  return 'อ่านไฟล์ไม่ได้';
}

// ── รายงาน ─────────────────────────────────────────────────────────────────
console.log('ตรวจ STRIPE_WEBHOOK_SECRET — เจ้าของค่าคือไฟล์เดียว: sovereign-os/infra/.env\n');

const ownerState = readLocalEnvKey(OWNER_FILE, KEY);
const hostRunState = readLocalEnvKey(HOST_RUN_FILE, KEY);
const status = containerRunning();
const runtimeValue = status ? containerRuntimeValue() : null;
const mountedOwnerValue = status ? containerMountedOwnerValue() : null;

const rows = [
  ['ไฟล์เจ้าของ (มีผลจริง)', 'sovereign-os/infra/.env', ownerState, true],
  ['ไฟล์ที่มักถูกแก้ผิด', 'sovereign-os/core-api/.env', hostRunState, false],
  ['ไฟล์ที่ container เห็น', `${MOUNTED_OWNER_FILE} (mount แบบอ่านอย่างเดียว)`,
    mountedOwnerValue === null || mountedOwnerValue === ''
      ? (status ? { state: 'absent' } : { state: 'unreadable' })
      : { state: 'present', value: mountedOwnerValue }, true],
  ['ค่าที่ container ใช้จริง', `${CONTAINER} (${status ?? 'ไม่ได้รัน'})`,
    runtimeValue === null ? { state: 'unreadable' }
      : (runtimeValue ? { state: 'present', value: runtimeValue } : { state: 'present', value: '' }), true],
];

console.log('  ' + 'ช่องที่อ่านค่าได้'.padEnd(26) + 'fingerprint (ไม่เผยค่าจริง)');
console.log('  ' + '─'.repeat(66));
for (const [label, , result, expectPresent] of rows) {
  console.log(`  ${label.padEnd(26)}${describe(result, { expectPresent })}`);
}
console.log('');

// ── ตัดสินใจ ───────────────────────────────────────────────────────────────
let exitCode = 0;

if (!status) {
  console.log('⚠️  คอนเทนเนอร์ sovereign-core-api ไม่ได้รัน — ตรวจเทียบค่าที่ "มีผลจริง" ไม่ได้');
  exitCode = 1;
} else if (ownerState.state === 'unreadable') {
  console.log(`❌ อ่าน ${OWNER_FILE} ไม่ได้ — ไฟล์เจ้าของหายไปหรืออ่านไม่ได้ (ไฟล์นี้ไม่ถูก track ใน git)`);
  exitCode = 1;
} else if (!ownerState.value || !usable(ownerState.value)) {
  console.log(`❌ ยังไม่ได้ตั้ง ${KEY} ใน sovereign-os/infra/.env — webhook จะปฏิเสธทุก delivery (401)`);
  console.log('   แก้ที่: sovereign-os/infra/.env แล้ว recreate:');
  console.log('     cd sovereign-os/infra && docker compose up -d --no-deps core-api');
  exitCode = 1;
} else if (!runtimeValue) {
  console.log(`❌ ค่าที่ container ใช้ยังว่าง — ไฟล์เจ้าของมีค่าแล้ว แต่ยังไม่ถึง container`);
  console.log('   ต้อง *recreate* (ไม่ใช่ restart) เพราะค่าถูกอ่านตอนสร้าง container:');
  console.log('     cd sovereign-os/infra && docker compose up -d --no-deps core-api');
  exitCode = 1;
} else if (ownerState.value !== runtimeValue) {
  console.log('❌ หมุน secret แล้ว แต่ยังไม่มีผลจริง — ค่าที่รันอยู่ไม่ตรงกับไฟล์เจ้าของ');
  console.log(`     ไฟล์เจ้าของ: ${fingerprint(ownerState.value)}`);
  console.log(`     ค่าที่รันอยู่: ${fingerprint(runtimeValue)}`);
  console.log('   แก้โดย (สำคัญ: recreate ไม่ใช่ restart):');
  console.log('     cd sovereign-os/infra && docker compose up -d --no-deps core-api');
  exitCode = 1;
} else {
  console.log(`✅ ตรงกัน — ค่าที่ container ใช้อยู่ตรงกับไฟล์เจ้าของจริง (${fingerprint(ownerState.value)})`);
  console.log('   ⇒ "ค่านี้ถูกตั้งแล้วและมีผลจริง" พิสูจน์แล้ว ไม่ต้องเดา');

  // สถานะปกติหลังแก้กับดัก: ไฟล์หลอกไม่มีคีย์นี้แล้ว = มีเจ้าของค่าไฟล์เดียวจริง
  if (hostRunState.state === 'absent') {
    console.log('');
    console.log('✅ มีค่านี้ที่ไฟล์เดียวจริง — core-api/.env ไม่มีคีย์นี้แล้ว (ไฟล์นั้นไม่มีผลกับ container อยู่แล้ว)');
  } else if (hostRunState.state === 'unreadable') {
    console.log('');
    console.log(`ℹ️  อ่าน ${HOST_RUN_FILE} ไม่ได้ — ตรวจว่าไฟล์หลอกยังมีค่าซ้ำอยู่หรือไม่ไม่ได้`);
  } else if (hostRunState.value !== ownerState.value) {
    console.log('');
    console.log(`ℹ️  ${HOST_RUN_FILE} ยังมีค่าต่างจากไฟล์เจ้าของ — ไม่มีผลกับ container สักอย่าง`);
    console.log('   (ใช้ได้เฉพาะตอนรันบน host) แต่เป็นกับดัก: ถ้าหมุนที่นั่นจะไม่มีผลกับเว็บจริง');
    console.log(`   ถ้าหมุน secret ครั้งหน้า ให้แก้ที่ sovereign-os/infra/.env จุดเดียว`);
  }
  console.log('');
  console.log('   หมุนครั้งหน้าแล้วพิสูจน์ซ้ำ: fingerprint ต้องเปลี่ยน ถ้าไม่เปลี่ยน = ยังใช้ค่าเก่า');
}

process.exitCode = exitCode;