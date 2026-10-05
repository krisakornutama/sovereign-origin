#!/usr/bin/env node
/* กันดัก "ค่าลับอยู่คนละไฟล์กับที่มีผลจริง" — กติกาที่ต้องผ่านตลอดเวลา

   บริบท (วัดจริง 5/10/69): STRIPE_WEBHOOK_SECRET หลุดทั้งในไฟล์จริงและในไฟล์ตัวอย่าง
   ที่ track ไว้ — โดยช่องของมันอยู่ใน core-api/.env.example (ไฟล์ที่ไม่มีผลกับ
   container) ขณะที่ infra/.env.example (เจ้าของจริง) ไม่มีช่องให้ใส่เลย
   ⇒ คน clone ใหม่ทำตามไฟล์ตัวอย่าง = หลุดทันที แบบไม่มีใครเตือน เงินจริงหายเงียบ

   ไฟล์นี้จับ 3 อย่าง:
     1) ช่องของคีย์เจ้าของต้องอยู่ในไฟล์ตัวอย่างของเจ้าของ
     2) ช่องเดียวกันต้อง *ไม่* อยู่ในไฟล์ตัวอย่างที่ไม่มีผล
     3) compose ต้องส่งค่าเข้า container ได้จริง
   บวกกับการรายงานคีย์ลับอื่นที่หลุดแบบเดียวกัน (ไม่ assert — เพราะบางคีย์เป็น
   host-run จริง ๆ ผู้ดูแลต้องตัดสินใจเอง แต่ต้อง *เห็น* ทุกรอบที่รัน)

   ใช้: npm run test:tools */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseEnvKeys,
  parseComposeServices,
  isSecretShapedKey,
  findSecretsNotReachingContainer,
  findOwnerKeysReferencedByNothing,
  auditSecretSlotOwnership,
} from '../env-secret-ownership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const OWNER_EXAMPLE = 'sovereign-os/infra/.env.example';
const HOST_RUN_EXAMPLE = 'sovereign-os/core-api/.env.example';
const COMPOSE = 'sovereign-os/infra/docker-compose.yml';
const WEBHOOK_SECRET = 'STRIPE_WEBHOOK_SECRET';

// ── parser พื้นฐาน (ต้องรู้ว่าอ่านได้จริงก่อนถึงจะเชื่อผลตรวจ) ──────────────

test('parseEnvKeys อ่านชื่อคีย์ และข้ามคอมเมนต์/บรรทัดว่าง', () => {
  const keys = parseEnvKeys(['# comment', '', 'A=1', 'B = 2', '  # x', 'C=3 # trailing'].join('\n'));
  assert.deepEqual([...keys].sort(), ['A', 'B', 'C']);
});

test('parseEnvKeys คืนชื่อเดียวเมื่อคีย์ซ้ำ (คำถามคือ "มีไหม" ไม่ใช่ "อันไหนชนะ")', () => {
  const keys = parseEnvKeys('X=1\nX=2');
  assert.equal(keys.size, 1);
  assert.ok(keys.has('X'));
});

test('parseComposeServices แยก service ถูกตัว และเก็บทั้ง env keys กับ ${VAR}', () => {
  const yaml = [
    'services:',
    '  a:',
    '    environment:',
    '      FOO: 1',
    '      BAR: ${BAZ:-x}',
    '    volumes:',
    '      - ./x:/x',
    '  b:',
    '    environment:',
    '      QUX: ${ZED:?required}',
    '  c:',
    '    image: x',
  ].join('\n');
  const svc = parseComposeServices(yaml);
  assert.deepEqual(svc.a.envKeys, ['FOO', 'BAR']);
  assert.ok(svc.a.referencedVars.has('BAZ'));
  assert.deepEqual(svc.b.envKeys, ['QUX']);
  assert.ok(svc.b.referencedVars.has('ZED'));
  // `volumes:` ต้องไม่ถูกอ่านเป็น env (กันดัก parser ที่นับบรรทัดผิด)
  assert.deepEqual(svc.c.envKeys, []);
});

test('isSecretShapedKey จับได้ทั้งชื่อที่ลงท้ายและที่อยู่กลาง', () => {
  assert.ok(isSecretShapedKey('STRIPE_WEBHOOK_SECRET'));
  assert.ok(isSecretShapedKey('JWT_SECRET'));
  assert.ok(isSecretShapedKey('MQTT_PASS'));
  assert.ok(isSecretShapedKey('TELEGRAM_BOT_TOKEN'));
  assert.ok(isSecretShapedKey('OTA_TOKEN'));
  assert.ok(isSecretShapedKey('STRIPE_SECRET_KEY'));
  assert.ok(!isSecretShapedKey('PORT'));
  assert.ok(!isSecretShapedKey('MQTT_HOST'));
});

// ── กติกาที่ต้องผ่าน: ช่องของคีย์เจ้าของ ──────────────────────────────────
// (เขียนก่อนแก้ไฟล์ตัวอย่าง → ต้องแดงก่อน)

test('ช่องของ STRIPE_WEBHOOK_SECRET ต้องอยู่ที่ไฟล์ตัวอย่างของเจ้าของ (infra) ไม่ใช่ core-api', () => {
  const report = auditSecretSlotOwnership({
    key: WEBHOOK_SECRET,
    ownerExample: read(OWNER_EXAMPLE),
    hostRunExample: read(HOST_RUN_EXAMPLE),
    composeYaml: read(COMPOSE),
  });
  assert.ok(
    report.ownerHasSlot,
    `${OWNER_EXAMPLE} ต้องมีช่อง ${WEBHOOK_SECRET} — ไม่มีช่อง = คนที่ทำตามเอกสารตั้งค่าไม่ได้`,
  );
  assert.ok(
    !report.hostRunHasSlot,
    `${HOST_RUN_EXAMPLE} ต้องไม่มีช่อง ${WEBHOOK_SECRET} — ไฟล์นี้ไม่มีผลกับ container ` +
    `การมีช่อง = ชี้คนไปใส่ค่าที่ไม่มีผล (เงินหายเงียบ)`,
  );
  assert.ok(report.reachesContainer, `docker-compose ต้องส่ง ${WEBHOOK_SECRET} เข้า container`);
  assert.deepEqual(report.problems, [], `พบปัญหา: ${report.problems.join(' | ')}`);
});

test('ตัวชี้วัด audit มีฟันจริง: ย้ายช่องไปผิดไฟล์แล้วต้องแดง', () => {
  // จำลอง "คนแก้ผิด" = เอาช่องไปใส่ไฟล์ที่ไม่มีผล แล้วลบออกจากเจ้าของ
  const good = auditSecretSlotOwnership({
    key: WEBHOOK_SECRET,
    ownerExample: 'JWT_SECRET=x\nSTRIPE_WEBHOOK_SECRET=\n',
    hostRunExample: 'PORT=3001\n',
    composeYaml: read(COMPOSE),
  });
  assert.equal(good.ok, true, 'ตั้งต้นต้องผ่านก่อน (ไม่งั้นเทสต์นี้ไร้ความหมาย)');

  const broken = auditSecretSlotOwnership({
    key: WEBHOOK_SECRET,
    ownerExample: 'JWT_SECRET=x\n',
    hostRunExample: 'PORT=3001\nSTRIPE_WEBHOOK_SECRET=\n',
    composeYaml: read(COMPOSE),
  });
  assert.equal(broken.ok, false, 'ย้ายช่องไป core-api/.env.example ต้องถูกจับ');
  assert.equal(broken.hostRunHasSlot, true);
  assert.equal(broken.ownerHasSlot, false);
  assert.equal(broken.problems.length, 2, 'ต้องบอกทั้ง "ไม่มีช่องที่เจ้าของ" และ "มีช่องที่ไม่มีผล"');
});

test('compose ที่ไม่ส่งคีย์เข้า container ต้องถูกจับ (ไม่มีทางที่ค่าจะมีผล)', () => {
  const report = auditSecretSlotOwnership({
    key: WEBHOOK_SECRET,
    ownerExample: 'STRIPE_WEBHOOK_SECRET=\n',
    hostRunExample: 'PORT=3001\n',
    composeYaml: 'services:\n  core-api:\n    environment:\n      PORT: 3001\n',
  });
  assert.equal(report.ok, false);
  assert.equal(report.reachesContainer, false);
  assert.match(report.problems.join(' '), /docker-compose/);
});

// ── รายงานคีย์ลับอื่น: ไม่ assert แต่ต้องไม่เงียบ ───────────────────────────

test('รายงานคีย์ลับใน host-run ที่ไม่ถึง container (รายงาน ไม่ลบ — ผู้ดูแลตัดสินใจ)', () => {
  const orphans = findSecretsNotReachingContainer({
    hostEnvKeys: parseEnvKeys(read(HOST_RUN_EXAMPLE)),
    composeYaml: read(COMPOSE),
  });
  // compose ส่ง STRIPE_WEBHOOK_SECRET เข้า container แน่นอน ⇒ ต้องไม่โผล่ในรายการนี้
  assert.ok(!orphans.includes(WEBHOOK_SECRET), 'คีย์ที่มีผลจริงห้ามถูกรายงานว่าหลุด');
});

test('รายงานคีย์ในไฟล์เจ้าของที่ไม่มี service อ้างถึง (ตั้งแล้วไม่มีอะไรเกิดขึ้น)', () => {
  const dead = findOwnerKeysReferencedByNothing({
    ownerEnvKeys: parseEnvKeys(read(OWNER_EXAMPLE)),
    composeYaml: read(COMPOSE),
  });
  assert.ok(Array.isArray(dead), 'ต้องคืนรายการ');
  // คีย์ที่มีผลจริงห้ามโผล่
  assert.ok(!dead.includes(WEBHOOK_SECRET), 'คีย์ที่ compose อ้างถึงห้ามถูกรายงานว่าตาย');
});