#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// audit-env-secrets.mjs — "ค่าลับอื่นหลุดแบบเดียวกันไหม"
//
// คำถามที่คำสั่งนี้ตอบ (คำถามเดียวกับที่ทำให้ STRIPE_WEBHOOK_SECRET หลุด):
//   "คีย์ที่ดูเป็นค่าลับ เขียนไว้แล้วมีผลจริงไหม — หรือเป็นแค่ตัวหนังสาวที่ไม่มีผล?"
//
// ทำไมต้องเป็นคำสั่งแยก (ไม่ใช่แค่เทสต์):
//   เทสต์บอกได้แค่ "ผ่าน/ไม่ผ่าน" แต่เจ้าของต้อง**เห็นรายชื่อ** เพื่อตัดสินใจว่าจะย้าย
//   ค่าไหน และค่าไหนตั้งไว้เพื่อการพัฒนาบนเครื่อง คำสั่งนี้พิมพ์รายชื่อพร้อม
//   เหตุผล และ**ไม่เคยพิมพ์ค่า** (เห็นแต่ชื่อคีย์)
//
// ปลอดภัยพอจะรันได้ทันทีทั้งก่อนและหลังเปิดขายจริง:
//   อ่านอย่างเดียว · ไม่แก้ไฟล์ · ไม่ยิง Stripe · ไม่แตะ container
//
// ใช้: npm run audit:env-secrets
// ────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseEnvKeys,
  findSecretsNotReachingContainer,
  findOwnerKeysReferencedByNothing,
  auditSecretSlotOwnership,
} from './env-secret-ownership.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_FILE = join(ROOT, 'sovereign-os', 'infra', '.env');
const OWNER_EXAMPLE = join(ROOT, 'sovereign-os', 'infra', '.env.example');
const HOST_RUN_FILE = join(ROOT, 'sovereign-os', 'core-api', '.env');
const HOST_RUN_EXAMPLE = join(ROOT, 'sovereign-os', 'core-api', '.env.example');
const COMPOSE = join(ROOT, 'sovereign-os', 'infra', 'docker-compose.yml');

const readOrNull = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const composeYaml = readOrNull(COMPOSE) ?? '';
let exitCode = 0;

console.log('ตรวจค่าลับทุกตัวว่า "ตั้งแล้วมีผลจริง" หรือเป็นตัวหนังสาวที่ไม่มีผล');
console.log('(พิมพ์แค่ชื่อคีย์ ไม่เคยพิมพ์ค่า)\n');

// ── 1) กติกาที่ต้องผ่านเสมอ: ช่องของเจ้าของถูกที่ ───────────────────────────
const examples = {
  owner: readOrNull(OWNER_EXAMPLE),
  hostRun: readOrNull(HOST_RUN_EXAMPLE),
};
if (examples.owner && examples.hostRun) {
  const report = auditSecretSlotOwnership({
    key: 'STRIPE_WEBHOOK_SECRET',
    ownerExample: examples.owner,
    hostRunExample: examples.hostRun,
    composeYaml,
  });
  if (report.ok) {
    console.log('✅ ช่องของ STRIPE_WEBHOOK_SECRET อยู่ที่ไฟล์ตัวอย่างของเจ้าของถูกที่แล้ว');
    console.log('   (sovereign-os/infra/.env.example มีช่อง · core-api/.env.example ไม่มีช่อง)');
    console.log('   ⇒ clone ใหม่จะไม่หลุดอีก\n');
  } else {
    console.log('❌ กับดักยังอยู่ — คนที่ตั้งค่าใหม่จะหลุดอีก:');
    for (const p of report.problems) console.log(`   · ${p}`);
    console.log('');
    exitCode = 1;
  }
} else {
  console.log('⚠️  อ่านไฟล์ตัวอย่างไม่ครบ — ข้ามการตรวจช่องของเจ้าของ\n');
}

// ── 2) คีย์ลับในไฟล์ host-run ที่ไม่ถึง container ───────────────────────
const hostRunText = readOrNull(HOST_RUN_FILE);
if (hostRunText) {
  const orphans = findSecretsNotReachingContainer({
    hostEnvKeys: parseEnvKeys(hostRunText),
    composeYaml,
  });
  console.log(`คีย์ที่ดูเป็นค่าลับใน core-api/.env แต่ไม่มีผลกับ container (${orphans.length}):`);
  if (orphans.length === 0) {
    console.log('   (ไม่มี)');
  } else {
    for (const k of orphans) {
      console.log(`   · ${k}`);
      console.log('     → ถ้าตั้งค่านี้เพื่อให้ "ระบบทำงาน" ค่าจะไม่มีผลกับเว็บจริง');
    }
    console.log('   → ต้องตัดสินใจทีละตัว: ย้ายไป sovereign-os/infra/.env (มีผล) หรือยอมเป็น host-only');
    console.log('   → คำสั่งนี้รายงานเท่านั้น ไม่ลบ ไม่ย้ายให้ (ค่าลับต้องให้คนดูแลตัดสินใจเอง)');
  }
  console.log('');
} else {
  console.log('⚠️  ไม่พบ sovereign-os/core-api/.env (ไฟล์นี้ไม่ถูก track) — ข้ามการตรวจฝั่ง host-run\n');
}

// ── 3) คีย์ในไฟล์เจ้าของที่ไม่มี service อ้างถึง ────────────────────────
const ownerText = readOrNull(OWNER_FILE);
if (ownerText) {
  const dead = findOwnerKeysReferencedByNothing({
    ownerEnvKeys: parseEnvKeys(ownerText),
    composeYaml,
  });
  console.log(`คีย์ใน sovereign-os/infra/.env ที่ไม่มี service ไหนอ้างถึง (${dead.length}):`);
  if (dead.length === 0) {
    console.log('   (ไม่มี)');
  } else {
    for (const k of dead) console.log(`   · ${k}`);
    console.log('   → ตั้งไว้แต่ไม่มีอะไรอ่าน = ไม่มีผล (อาจเป็นของเครื่องมือนอก compose ด้วย — ตรวจก่อนลบ)');
  }
  console.log('');
}

process.exitCode = exitCode;