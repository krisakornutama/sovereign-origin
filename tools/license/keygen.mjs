#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/license/keygen.mjs — สร้างคู่กุญแจสำหรับเซ็นไลเซนส์ออฟไลน์
//
// ที่มา: `tools/license/issue.mjs` ต้องมี `--key` (ไพรเวต) และ `--public-key` (พับลิก)
// แต่ทั้งโปรเจกต์ไม่มีคู่กุญแจนี้เลย และไม่มีคำสั่งสร้าง ⇒ `npm run license:sell`
// ล้มทุกครั้ง ⇒ ถ้ามีคนโอนเงินจริง จะส่งของไม่ได้ตามสัญญา 24 ชั่วโมงที่ประกาศบนหน้าเว็บ
//
// หลักการ:
//   • ไพรเวตอยู่นอก repo (`.secrets/` ระดับเดียวกับกุญแจ release ของ Seal) — ไม่มีทางหลุดเข้า git
//   • พับลิกอยู่บนเว็บ (`portfolio/license-pub.txt`) เพื่อให้ผู้ซื้อตรวจไลเซนส์เองได้
//     (ไม่ใช้ `.pem` เพราะ `*.pem` ถูก .gitignore ⇒ จะไม่ขึ้นเว็บ)
//   • รันซ้ำได้ปลอดภัย: มีกุญแจอยู่แล้ว = รายงานของเดิม ไม่เขียนทับ (ต้องสั่ง --force เอง)
//
// ใช้:
//   node tools/license/keygen.mjs            # สร้างถ้ายังไม่มี / รายงานของเดิม
//   node tools/license/keygen.mjs --force    # สร้างใหม่ (ของเดิมถูกเขียนทับ — ใบเก่าตรวจไม่ผ่าน)
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PRIVATE_KEY_PATH = path.resolve(ROOT, '..', '.secrets', 'license-priv.pem');
export const PUBLIC_KEY_PATH = path.join(ROOT, 'portfolio', 'license-pub.txt');

/**
 * ลายนิ้วมือ = SHA-256 ของ DER (SPKI) 32 ตัวแรก
 * ระบุวิธีคิดให้ผู้ซื้อคิดตามได้เอง — ไม่ใช่ค่าที่ผมบอกอย่างเดียว
 */
export function fingerprintOfPublicPem(publicPem) {
  const der = createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 32);
}

function main() {
  const force = process.argv.includes('--force');

  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH) && !force) {
    const publicPem = readFileSync(PUBLIC_KEY_PATH, 'utf8');
    process.stdout.write(
      [
        '• มีคู่กุญแจอยู่แล้ว — ไม่เขียนทับ',
        `  ไพรเวต: ${path.relative(ROOT, PRIVATE_KEY_PATH)}`,
        `  พับลิก: ${path.relative(ROOT, PUBLIC_KEY_PATH)}`,
        `  ลายนิ้วมือ: ${fingerprintOfPublicPem(publicPem)}`,
        '',
      ].join('\n')
    );
    return;
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

  mkdirSync(path.dirname(PRIVATE_KEY_PATH), { recursive: true });
  writeFileSync(PRIVATE_KEY_PATH, privatePem, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(PRIVATE_KEY_PATH, 0o600);
  writeFileSync(PUBLIC_KEY_PATH, publicPem, 'utf8');

  process.stdout.write(
    [
      '✓ สร้างคู่กุญแจไลเซนส์ใหม่',
      `  ไพรเวต: ${path.relative(ROOT, PRIVATE_KEY_PATH)} (นอก repo, โหมด 600)`,
      `  พับลิก: ${path.relative(ROOT, PUBLIC_KEY_PATH)} (ขึ้นเว็บได้)`,
      `  ลายนิ้วมือ: ${fingerprintOfPublicPem(publicPem)}`,
      '',
    ].join('\n')
  );
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) main();
