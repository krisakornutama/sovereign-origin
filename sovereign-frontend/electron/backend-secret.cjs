// sovereign-frontend/electron/backend-secret.cjs
// ─────────────────────────────────────────────────────────────────────────────
// JWT_SECRET ของ sidecar — ต้องมี "ต่อเครื่อง" และต้องไม่หายเมื่อเปิดแอปใหม่
//
// ปัญหาที่กัน: sidecar (`core-api/dist/server.js`) โยน error ทันทีถ้าไม่มี
// JWT_SECRET แต่แอปที่แพ็กไม่ได้เตรียมอะไรให้เลย ⇒ พอร์ตสำรองที่ประกาศไปแล้ว
// ว่างเปล่า และผู้ใช้ไม่เห็นสาเหตุ
//
// กติกา:
//   · ค่าที่ผู้ปฏิบัติการตั้งใน env ชนะเสมอ (ไม่เขียนไฟล์ทับ และไม่เก็บสำเนา)
//   · ไม่มีใน env → อ่าน/สร้างไฟล์ใน userData ของแอป (โหมด 0600)
//   · ไฟล์ที่สั้นเกินไป/ว่าง/มีช่องว่าง = ใช้ไม่ได้ → สร้างใหม่ (token เดิมใช้ไม่ได้อยู่แล้ว)
//   · ค่า secret ต้องไม่ถูก log หรือส่งเข้า renderer ที่ไหนเลย
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = 'jwt-secret';
const SECRET_BYTES = 32;
const MIN_LENGTH = 32;

/** secret ที่ใช้ได้: ยาวพอและไม่มีช่องว่าง (env ที่มี newline/space หลุดมาคือค่าเสีย) */
function isValidSecret(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < MIN_LENGTH) return false;
  if (/\s/.test(trimmed)) return false;
  return true;
}

function readSecretFile(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function writeSecretFile(file, secret) {
  // เขียนไฟล์ชั่วคราวแล้ว rename — เปิดแอปสองครั้งพร้อมกันต้องไม่ได้ไฟล์ครึ่งท่อน
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, secret, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * คืน { secret, created, source } โดย source = 'env' | 'file'
 * envSecret ส่งเข้ามาเพื่อให้เทสต์ได้โดยไม่ต้องแตะ process.env
 */
function loadOrCreateJwtSecret(options) {
  const opts = options || {};
  const dir = opts.dir;
  if (!dir) throw new Error('loadOrCreateJwtSecret: ต้องระบุ dir (userData)');
  const file = path.join(dir, SECRET_FILE);

  if (isValidSecret(opts.envSecret)) {
    return { secret: opts.envSecret.trim(), created: false, source: 'env', file: null };
  }

  const existing = readSecretFile(file);
  if (isValidSecret(existing)) {
    return { secret: existing, created: false, source: 'file', file: file };
  }

  const secret = crypto.randomBytes(SECRET_BYTES).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeSecretFile(file, secret);
  } catch (err) {
    // เขียนไม่ได้ (สิทธิ์/ดิสก์เต็ม) — คืนค่าในหน่วยความจำไปก่อน แล้วให้ผู้เรียก log เอง
    return { secret: secret, created: true, source: 'memory', file: null, error: err.message };
  }
  return { secret: secret, created: true, source: 'file', file: file };
}

exports.SECRET_FILE = SECRET_FILE;
exports.isValidSecret = isValidSecret;
exports.loadOrCreateJwtSecret = loadOrCreateJwtSecret;
