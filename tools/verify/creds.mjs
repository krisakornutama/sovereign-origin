// ────────────────────────────────────────────────────────────────────────────
// tools/verify/creds.mjs — เจ้าของเดียวของการอ่าน secret จากไฟล์ env (H3)
//
// ทำไมต้องมี: JWT_SECRET ถูกอ่านซ้ำ 3 ที่ (full-system-check / security-audit /
// ui-sweep) ด้วยโค้ดเดียวกันที่พังเงียบ — `.find(...)` คืน undefined แล้ว `.slice`
// โยน TypeError "Cannot read properties of undefined" ซึ่งไม่บอกว่าอะไรหาย/ไฟล์ไหน
//
// กติกา:
//   · ค่าดีฟอลต์อ่านจาก sovereign-os/infra/.env (ที่เดียวกับที่ core-api ใช้)
//   · ไฟล์หาย/คีย์หาย = คืน '' (ผู้เรียกเลือกเองว่าจะข้ามหรือหยุด)
//   · requireSecret() = โยน MissingSecretError ที่บอกชื่อคีย์ + ไฟล์ + ทางแก้
//   · ห้าม log ค่าจริง — ใช้ maskSecret()
// ────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const INFRA_ENV = path.join(ROOT, 'sovereign-os', 'infra', '.env');
export const CORE_ENV = path.join(ROOT, 'sovereign-os', 'core-api', '.env');

export class MissingSecretError extends Error {
  constructor(key, file, hint = '') {
    super(
      `ไม่พบ ${key} ใน ${file} — ตรวจว่าไฟล์ .env ถูกสร้างและมีคีย์นี้` +
        (hint ? ` · ${hint}` : ''),
    );
    this.name = 'MissingSecretError';
    this.key = key;
    this.file = file;
  }
}

/** อ่านข้อความ .env เป็น object (คีย์ตัวใหญ่เท่านั้น · คีย์ซ้ำ = ค่าสุดท้ายชนะ) */
export function parseEnvText(text) {
  const env = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

/** อ่านไฟล์ env — ไฟล์หาย = {} (ไม่ throw) */
export function readEnvFile(file) {
  try {
    return parseEnvText(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function readInfraEnv() {
  return readEnvFile(INFRA_ENV);
}

/**
 * อ่าน secret หนึ่งตัว
 * @param key   ชื่อคีย์ (เช่น JWT_SECRET)
 * @param file  ไฟล์ env (ดีฟอลต์ = infra/.env)
 * @param env   แหล่ง override (ดีฟอลต์ = process.env) — ใช้เมื่อ preferEnv = true เท่านั้น
 */
export function readSecret(key, { file = INFRA_ENV, env = process.env, preferEnv = false } = {}) {
  const fromEnv = String(env?.[key] ?? '').trim();
  if (preferEnv && fromEnv) return fromEnv;
  const fromFile = String(readEnvFile(file)[key] ?? '').trim();
  return fromFile || (preferEnv ? '' : fromEnv);
}

/** เหมือน readSecret แต่ไม่มีค่า = โยน MissingSecretError (ข้อความบอกทางแก้) */
export function requireSecret(key, { file = INFRA_ENV, env = process.env, preferEnv = false, hint = '' } = {}) {
  const value = readSecret(key, { file, env, preferEnv });
  if (!value) throw new MissingSecretError(key, file, hint);
  return value;
}

export function requireJwtSecret(opts = {}) {
  return requireSecret('JWT_SECRET', {
    hint: 'ถ้าเป็น clone ใหม่ ให้คัดลอก sovereign-os/infra/.env.example → .env แล้วตั้งค่า',
    ...opts,
  });
}

/** แสดงค่าแบบไม่เปิดเผย (ใช้ใน log ได้) */
export function maskSecret(value) {
  const s = String(value ?? '');
  if (!s) return '(ว่าง)';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 2)}••••${s.slice(-2)}`;
}
