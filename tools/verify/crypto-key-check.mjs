// tools/verify/crypto-key-check.mjs
//
// ── ด่านตรวจ "กุญแจเข้ารหัส field" (field-crypto.key) ────────────────────────
// ทำไมต้องมี:
//   field-crypto.service สร้าง key ใหม่ "เงียบ ๆ" เมื่อไฟล์หาย และ decryptField
//   คืนสตริงว่างเมื่อถอดไม่ได้ ⇒ ข้อมูลที่เคยเก็บ (รหัส Ecosystem / Telegram /
//   router / เบอร์ลูกค้า) กลายเป็นค่าว่างโดยไม่มี error ให้ใครเห็น
//
// ใช้:
//   node tools/verify/crypto-key-check.mjs
//   node tools/verify/crypto-key-check.mjs --json
//   node tools/verify/crypto-key-check.mjs --backup
//   node tools/verify/crypto-key-check.mjs --backup --to "E:\safe\field-crypto.key"
//
// --backup = สำเนาแบบ explicit เท่านั้น (ไม่ผูก schedule) — เจ้าของต้องเอาไฟล์
// ไปเก็บนอกเครื่องเอง (password manager / สื่อ offline) ไฟล์อยู่ใน backups/ ซึ่ง gitignore
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_KEY = path.join(ROOT, 'sovereign-os', 'core-api', 'data', 'field-crypto.key');
const BACKUP_DIR = path.join(ROOT, 'backups', 'keys');

/** ลายนิ้วมือของ key — ใช้เทียบสำเนาโดยไม่เปิดเผยตัว key */
export function keyFingerprint(keyBytes) {
  return crypto.createHash('sha256').update(keyBytes).digest('hex').slice(0, 16);
}

/**
 * ตัดสินสถานะกุญแจ
 * @param {{ keyBytes: Buffer|null, encryptedCount: number|null }} input
 *   encryptedCount = null หมายถึง "ตรวจ DB ไม่ได้" (ห้ามสรุปว่าปลอดภัย)
 */
export function assessCryptoKey({ keyBytes, encryptedCount }) {
  const size = keyBytes ? keyBytes.length : 0;

  if (size !== 32) {
    const hasData = encryptedCount == null || encryptedCount > 0;
    if (hasData) {
      return {
        ok: false,
        level: 'critical',
        message:
          `ไม่พบกุญแจที่ใช้ได้ (${size} ไบต์) แต่ยังมีข้อมูล enc:v1: อยู่ — ` +
          'ถ้าระบบสร้างกุญแจใหม่ ข้อมูลเดิมจะอ่านไม่ได้ตลอดกาล. ' +
          'ให้กู้ไฟล์ field-crypto.key จากสำเนาก่อน แล้วค่อยเริ่มระบบ',
      };
    }
    return {
      ok: false,
      level: 'warn',
      message:
        `ยังไม่มีกุญแจ (${size} ไบต์) และยังไม่พบข้อมูล enc:v1: — ` +
        'ระบบจะสร้างกุญแจใหม่เมื่อใช้งานครั้งแรก (ยังไม่เสียหาย แต่ควรสำรองทันทีที่เกิด)',
    };
  }

  if (encryptedCount == null) {
    return {
      ok: true,
      level: 'warn',
      message: 'กุญแจครบ 32 ไบต์ แต่ตรวจฐานข้อมูลไม่ได้ — ยังไม่ยืนยันว่ามีข้อมูลที่ต้องใช้กุญแจนี้',
    };
  }

  return {
    ok: true,
    level: 'ok',
    message: `กุญแจพร้อมใช้ (32 ไบต์) · พบข้อมูลเข้ารหัส ${encryptedCount} รายการ`,
  };
}

/**
 * คัดลอกกุญแจไปปลายทาง — ไม่ทับไฟล์ปลายทางที่มีอยู่แล้วด้วยกุญแจคนละตัว
 * (กันสำเนาดีถูกทับด้วยของใหม่โดยไม่ตั้งใจ)
 */
export function backupKey(src, dest, { force = false } = {}) {
  let bytes;
  try {
    bytes = fs.readFileSync(src);
  } catch {
    return { ok: false, message: `ไม่พบไฟล์กุญแจต้นทาง: ${src}` };
  }
  if (bytes.length !== 32) {
    return { ok: false, message: `ไฟล์ต้นทางไม่ใช่กุญแจ 32 ไบต์ (ได้ ${bytes.length})` };
  }
  try {
    if (fs.existsSync(dest) && !force) {
      const old = fs.readFileSync(dest);
      if (!old.equals(bytes)) {
        return {
          ok: false,
          message: `ปลายทางมีกุญแจคนละตัวอยู่แล้ว: ${dest} — ใช้ --force เฉพาะเมื่อแน่ใจ`,
        };
      }
      return { ok: true, bytes: bytes.length, dest, unchanged: true };
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes, { mode: 0o600 });
    return { ok: true, bytes: bytes.length, dest };
  } catch (err) {
    return { ok: false, message: `คัดลอกไม่สำเร็จ: ${err.message}` };
  }
}

/** นับเฉพาะตารางที่รู้จักและมีข้อมูลเข้ารหัสจริง — ไม่สแกนทั้งฐาน */
function countEncryptedFields() {
  const sql =
    'SELECT ' +
    "(SELECT count(*) FROM user_ecosystem_accounts WHERE password_enc LIKE 'enc:v1:%' OR login_id LIKE 'enc:v1:%')" +
    ' + ' +
    "(SELECT count(*) FROM system_settings WHERE value LIKE 'enc:v1:%');";
  try {
    const out = execFileSync(
      'docker',
      ['exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-t', '-A', '-c', sql],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true },
    ).trim();
    const n = Number(out);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const doBackup = args.includes('--backup');
  const toIndex = args.indexOf('--to');
  const keyFile = process.env.FIELD_CRYPTO_KEY_FILE || DEFAULT_KEY;

  let keyBytes = null;
  try {
    keyBytes = fs.readFileSync(keyFile);
  } catch {
    keyBytes = null;
  }

  const encryptedCount = countEncryptedFields();
  const verdict = assessCryptoKey({ keyBytes, encryptedCount });
  const fingerprint = keyBytes && keyBytes.length === 32 ? keyFingerprint(keyBytes) : null;

  let backup = null;
  if (doBackup) {
    const dest = toIndex >= 0 && args[toIndex + 1]
      ? path.resolve(args[toIndex + 1])
      : path.join(BACKUP_DIR, `field-crypto-${stamp()}.key`);
    backup = backupKey(keyFile, dest);
  }

  const result = {
    keyFile,
    exists: Boolean(keyBytes),
    bytes: keyBytes ? keyBytes.length : 0,
    fingerprint,
    encryptedCount,
    ...verdict,
    backup,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`🔑 กุญแจ: ${keyFile}`);
    console.log(`   มีอยู่: ${result.exists ? 'ใช่' : 'ไม่'} · ขนาด: ${result.bytes} ไบต์`);
    if (fingerprint) console.log(`   fingerprint: ${fingerprint} (ใช้เทียบสำเนา — ไม่ใช่ตัว key)`);
    console.log(`   ข้อมูล enc:v1: ที่ตรวจพบ: ${encryptedCount == null ? 'ตรวจ DB ไม่ได้' : `${encryptedCount} รายการ`}`);
    console.log(`${verdict.ok ? '✅' : '❌'} ${verdict.message}`);
    if (backup) {
      console.log(backup.ok ? `📦 สำเนา: ${backup.dest}` : `⚠️  สำเนาไม่สำเร็จ: ${backup.message}`);
      if (backup.ok) {
        console.log('   ⚠️  ไฟล์นี้คือกุญแจจริง — ย้ายไปเก็บนอกเครื่อง (password manager/สื่อ offline) และห้าม commit');
      }
    }
  }

  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
