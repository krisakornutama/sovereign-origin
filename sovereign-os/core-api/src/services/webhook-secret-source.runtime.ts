// ────────────────────────────────────────────────────────────────────────────
// webhook-secret-source.runtime.ts — ยืนยันตอนบูตว่า "ค่าที่รันอยู่" คือค่าที่
// เจ้าของเพิ่งแก้จริงหรือไม่ (จุดที่เงินหายเงียบในรอบก่อนเกิดตรงนี้)
//
// ทำไมต้องมีที่บูต ไม่ใช่ตอนมี webhook มา:
//   เหตุการณ์ที่ต้องจับคือ "เจ้าของหมุน secret ใส่ไฟล์ แล้วคิดว่าเสร็จ" —
//   ตอนนั้นยังไม่มีใครสังเกตอะไรผิดปกติ หน้าเว็บยังปกติ ทุกอย่างดูดี
//   ระบบจะรู้ก็ต่อเมื่อลูกค้าจ่ายเงินจริงแล้วถูกปฏิเสธเงียบ ๆ ซึ่งแก้ไม่ได้
//   ⇒ ต้องตรวจตั้งแต่บูต แล้วเตือนทันทีพร้อมบอกคำสั่งแก้
//
// ทำไมเทียบกับไฟล์ที่ mount เข้ามา (ไม่ใช่แค่ดู process.env ตัวเดียว):
//   container เห็น infra/.env ที่ /app/host-infra.env ⇒ เทียบได้ว่า
//   "ค่าที่รันอยู่" ตรงกับ "ค่าที่เจ้าของเพิ่งแก้ในไฟล์เจ้าของ" หรือไม่
//   ถ้าไม่มีไฟล์นี้ (รันบน host / ยังไม่ได้ recreate) → บอกว่าตรวจไม่ได้
//   อย่างไรก็ดี ไม่ทำให้บูตล้ม
//
// ข้อบังคับ: ห้ามโยน error ออกไป (บูตต้องได้เสมอ) · ห้ามพิมพ์ค่า secret ดิบ
// ────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import {
  compareWebhookSecretSources,
  fingerprintSecret,
  isUsableWebhookSecret,
  OWNER_FILE_MOUNTED_AT_IN_CONTAINER,
  WEBHOOK_SECRET_OWNER_FILE,
  formatSecretDivergenceWarning,
} from './webhook-secret-source.service';

/**
 * อ่านค่าของคีย์หนึ่งจากไฟล์ .env แบบไม่ต้องพึ่งไลเบอรีอื่น
 *
 * ทำเองแทน `dotenv.parse` เพราะ: (1) ไม่ต้องเพิ่ม dependency
 * (2) ไฟล์นี้คือหลักฐาน ไม่ใช่แค่ config — ต้องอ่านแบบเข้าใจได้ว่าทำไม
 * ตัด comment ท้ายบรรทัดและข้ามบรรทัดว่าง/มี # นำหน้าเหมือน dotenv
 */
function readEnvValue(filePath: string, key: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null; // ไม่มีไฟล์/อ่านไม่ได้ = ตรวจเทียบไม่ได้ (ไม่ใช่ "ค่าว่าง")
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    const value = line.slice(eq + 1).trim().replace(/\s+#.*$/, '').trim();
    // คืนค่าว่างเป็น '' ไม่ใช่ null — ต่างกันคนละเรื่อง:
    // null = ไม่มีคีย์นี้ในไฟล์, '' = มีคีย์แต่ค่าว่าง (ซึ่งแย่กว่าและต้องเตือน)
    return value.replace(/^["']|["']$/g, '');
  }
  return null;
}

/** ผลลัพธ์ของการตรวจ — คืนให้เทสต์อ่านได้ และให้คนดูแลเรียกใช้ซ้ำได้ */
export interface ProvenanceReport {
  /** ตรวจเทียบได้ไหม (ต้องมีไฟล์เจ้าของให้อ่าน) */
  comparable: boolean;
  /** ค่าที่ process ใช้จริงใช้ได้ไหม */
  runtimeUsable: boolean;
  ownerFingerprint: string;
  runtimeFingerprint: string;
  /** ข้อความที่ควรเตือน (undefined = ไม่มีอะไรต้องเตือน) */
  warning?: string;
}

/**
 * ตรวจว่าค่าที่รันอยู่ตรงกับไฟล์เจ้าของไหม (pure เทียบได้ ไม่แตะ I/O)
 *
 * แยกจาก reportWebhookSecretProvenance เพื่อให้เทสต์ยิงสถานการณ์ต่าง ๆ
 * ได้โดยไม่ต้องมีไฟล์จริงบนเครื่อง
 */
export function evaluateWebhookSecretProvenance(input: {
  ownerFileValue: string | null;
  runtimeValue: string | undefined | null;
  ownerFile?: string;
}): ProvenanceReport {
  const ownerFile = input.ownerFile ?? WEBHOOK_SECRET_OWNER_FILE;
  const runtimeFingerprint = fingerprintSecret(input.runtimeValue);

  // ไม่มีไฟล์เจ้าของให้อ่าน = ตรวจเทียบไม่ได้ (เช่นรันบน host ที่ไม่ได้ mount)
  // ไม่ใช่ "ค่าตรงกัน" — ต้องบอกตรง ๆ ไม่ให้เข้าใจว่าเพิ่งพิสูจน์แล้ว
  if (input.ownerFileValue === null) {
    return {
      comparable: false,
      runtimeUsable: isUsableWebhookSecret(input.runtimeValue),
      ownerFingerprint: 'อ่านไฟล์เจ้าของไม่ได้',
      runtimeFingerprint,
      warning:
        `[stripe] ตรวจเทียบ STRIPE_WEBHOOK_SECRET ไม่ได้ — ไม่พบ ${ownerFile} ` +
        `ที่ ${OWNER_FILE_MOUNTED_AT_IN_CONTAINER} (ปกติแปลว่ารันนอก container)\n` +
        `        ค่าที่ใช้อยู่ตอนนี้: ${runtimeFingerprint} · ยืนยันว่าตรงกับไฟล์เจ้าของหรือไม่ได้ในรอบนี้`,
    };
  }

  const cmp = compareWebhookSecretSources({
    ownerFileValue: input.ownerFileValue,
    runtimeValue: input.runtimeValue,
    ownerFile,
  });

  return {
    comparable: true,
    runtimeUsable: isUsableWebhookSecret(input.runtimeValue),
    ownerFingerprint: cmp.ownerFingerprint,
    runtimeFingerprint: cmp.runtimeFingerprint,
    // ตรงกันและ*ตั้งแล้ว* → ไม่ต้องเตือน (การเตือนทุกบูตทำให้ชินจนมองข้ามคำเตือนจริง)
    // แต่ "ทั้งสองฝั่งยังไม่ได้ตั้ง" ต้องเตือนเสมอ: มันผ่านเพราะ *เท่ากันว่าง*
    // ไม่ใช่เพราะถูกต้อง — ถ้าเงียบตรงนี้ webhook จะปฏิเสธทุก delivery
    // โดยไม่มีใครรู้ ซึ่งคือกับดับเดิมที่ต้องปิด
    warning: cmp.bothUnset ? cmp.warning : (cmp.matches ? undefined : cmp.warning),
  };
}

/**
 * ตรวจแล้วรายงานลง log ตอนบูต — ไม่เคยโยน error
 *
 * คืนผลให้เรียกใช้ซ้ำได้ (เทสต์/เครื่องมือ) · ถ้าอ่านไฟล์พังต้องยังบูตได้
 */
export function reportWebhookSecretProvenance(): ProvenanceReport {
  let ownerFileValue: string | null = null;
  try {
    ownerFileValue = readEnvValue(OWNER_FILE_MOUNTED_AT_IN_CONTAINER, 'STRIPE_WEBHOOK_SECRET');
  } catch {
    ownerFileValue = null; // ให้ evaluate จัดการต่อ (จะบอกว่าตรวจไม่ได้)
  }

  const report = evaluateWebhookSecretProvenance({
    ownerFileValue,
    runtimeValue: process.env.STRIPE_WEBHOOK_SECRET,
  });

  if (report.warning) {
    console.error(report.warning);
  } else if (report.comparable) {
    // ตรงกัน = หลักฐานว่า "หมุนแล้วมีผลจริง" — บันทึกไว้ให้คนเทียบรอบหมุนหน้า
    console.log(
      `[stripe] ✅ STRIPE_WEBHOOK_SECRET ตรงกับ ${WEBHOOK_SECRET_OWNER_FILE} ` +
      `(fingerprint ${report.runtimeFingerprint}) — ถ้าหมุนแล้วต้องเห็น fingerprint นี้เปลี่ยนด้วย`,
    );
  }
  return report;
}

/** คืนค่าเจ้าของที่อยู่ในไฟล์ (ใช้ตอน rotate เพื่อเทียบก่อน/หลัง โดยไม่ต้องเปิดไฟล์เอง) */
export function readOwnerFileSecret(): string | null {
  try {
    return readEnvValue(OWNER_FILE_MOUNTED_AT_IN_CONTAINER, 'STRIPE_WEBHOOK_SECRET');
  } catch {
    return null;
  }
}

export { formatSecretDivergenceWarning };