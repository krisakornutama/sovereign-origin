import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ── F2 (28/9/69): เข้ารหัส field อ่อนไหว (AES-256-GCM) ก่อนเก็บ system_settings ──
// เคยเป็น: telegram.botToken / router.adminPassword อยู่ plaintext ใน DB
// → DB ถูกยก = token ระบบ + รหัสเราเตอร์หลุดทันที
//
// แนวทาง (เลือกตามข้อจำกัดจริงของเครื่องนี้):
//   · key อยู่ data/field-crypto.key (32B สุ่ม, chmod เท่าที่ Windows ทำได้) — data/ เป็น mount
//     ที่ core-api ใช้อยู่แล้ว → เปลี่ยน key ไม่ต้อง recreate container
//   · key หาย/เปลี่ยน = field เข้ารหัสอ่านไม่ได้ → ผู้ใช้ตั้งค่าใหม่ผ่าน UI ได้ (ค่าพวกนี้รีเซ็ตได้)
//     เพราะฉะนั้น "กันยก DB" คือเป้าหมายหลัก ไม่ใช่ "กันคนลบ key" (คนลบ key = คนคุมเครื่องอยู่แล้ว)
//   · รูปแบบใน DB: "enc:v1:" + base64(iv[12]) + ":" + base64(ciphertext+tag) — prefix ใช้แยก plaintext เก่า
//   · migrate ตอนอ่าน: เจอ plaintext เก่า → คืนค่าตามปกติ (ผู้เรียกใช้งานได้เหมือนเดิม) — การย้ายเป็น enc เกิดตอน "ตั้งค่าใหม่"
//   · export/import clone ต้องใช้ได้ทั้งสองรูปแบบ (ค่า enc ต้องมี key เดิมจึงถอดได้ — จงใจ)

const KEY_FILE = process.env.FIELD_CRYPTO_KEY_FILE
  || path.resolve(process.cwd(), 'data', 'field-crypto.key');
const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    const k = fs.readFileSync(KEY_FILE);
    if (k.length === 32) {
      cachedKey = k;
      return cachedKey;
    }
  } catch { /* ไม่มีไฟล์ = สร้างด้านล่าง */ }
  const k = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, k);
  cachedKey = k;
  return cachedKey;
}

/** เข้ารหัสค่าที่จะเก็บลง DB — คืน "enc:v1:..." (ค่าว่างผ่านทะลุ) */
export function encryptField(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(PREFIX)) return plain; // เข้ารหัสซ้ำไม่ได้
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return PREFIX + iv.toString('base64') + ':' + enc.toString('base64');
}

/** ถอดค่าจาก DB — plaintext เก่า (ยังไม่ migrate) ผ่านกลับได้ตามปกติ · ถอดไม่ได้ = คืน '' (ให้ผู้ใช้ตั้งใหม่) */
export function decryptField(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try {
    const [ivB64, dataB64] = value.slice(PREFIX.length).split(':');
    const raw = Buffer.from(dataB64, 'base64'); // [ciphertext][tag 16 ไบต์ท้าย]
    const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    // key เปลี่ยน/ไฟล์หาย = ค่านั้นอ่านไม่ได้อีก — คืนว่างให้ผู้ใช้ตั้งค่าใหม่ผ่าน UI (ไม่ crash)
    return '';
  }
}
