// ────────────────────────────────────────────────────────────────────────────
// webhook-secret-source.service.ts — ใครเป็นเจ้าของ STRIPE_WEBHOOK_SECRET
//
// กับดักที่ทำให้รอบก่อนล้มตั้งแต่แรก (วัดจริง 5/10/69):
//   ค่านี้มีอยู่ 2 ไฟล์ แต่**มีผลจริงกับ container ที่เดียว**
//
//   ✅ sovereign-os/infra/.env   → docker-compose อ่าน ${STRIPE_WEBHOOK_SECRET:-}
//                                 แล้วส่งเข้า container ผ่าน `environment:`
//                                 = เจ้าของจริง แก้ที่นี่แล้วมีผลกับที่รันจริง
//
//   ❌ sovereign-os/core-api/.env → ใช้ได้เฉพาะตอนรันบน host (npm run dev บนเครื่อง)
//                                 ไม่มีผลกับ container เพราะ
//                                   · .dockerignore ตัด `.env` ออกจาก image
//                                   · ไม่มี mount ให้ /app/.env
//                                 dotenv ใน src/config/index.ts จึงไม่มีอะไรให้อ่าน
//
// ผลของกับดัก: เจ้าของหมุน secret ใส่ core-api/.env (ตามที่เอกสารเดิมบอก) →
// หน้าเว็บปกติ แต่ webhook ปฏิเสธทุก delivery แบบเงียบ ไม่มีอะไรเตือน
//
// สิ่งที่ไฟล์นี้ทำ: ทำให้ "หมุนแล้วมีผลจริง" **พิสูจน์ได้โดยไม่ต้องเดา** โดย
//   · บอกชื่อไฟล์เจ้าของ (จุดเดียว ทั้งระบบอ้างที่นี่)
//   · fingerprint ค่า secret เพื่อเทียบ "หมุนแล้วหรือยัง" โดยไม่ต้องเปิดเผยค่า
//   · ตรวจว่าค่าที่ process ใช้จริง ตรงกับไฟล์เจ้าของไหม (จุดที่เงียบได้)
//
// ⚠️ ห้ามคืนค่า secret ดิบจากฟังก์ชันใดเลยที่จะถูก log — คืน fingerprint เท่านั้น
// ────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';

/**
 * ไฟล์เดียวที่มีผลจริงกับ container
 *
 * เปลี่ยนชื่อที่นี่ = เปลี่ยนคำตอบของคำถามนี้ทั้งระบบ (มีที่อื่นอ้างถึงไฟล์นี้
 * เพื่อให้ไม่มีที่ไหนตอบว่า "ใส่ .env" โดยไม่ระบุว่าไฟล์ไหน)
 */
export const WEBHOOK_SECRET_OWNER_FILE = 'sovereign-os/infra/.env';

/**
 * ไฟล์ที่ "ดูเหมือนใช้" แต่ไม่มีผลกับ container — ต้องเอ่ยชื่อเสมอ
 *
 * เหตุผลที่ต้องมีค่านี้ (ไม่ใช่แค่ comment): เอกสารรุ่นก่อนบอกให้ "ใส่ .env"
 * โดยไม่ระบุไฟล์ คนจึงเลือกที่ใกล้สุดทางสายตา = ไฟล์ผิด แล้วเงินหายเงียบ
 * การมีชื่อไฟล์ที่ไม่มีผลอยู่ในโค้ด ทำให้ตอบคำถามนี้ได้โดยไม่ต้องค้นเอกสาร
 */
export const HOST_RUN_ENV_FILE = 'sovereign-os/core-api/.env';

/** ที่ที่ container เห็นไฟล์เจ้าของ (docker mount infra/.env → /app/host-infra.env:ro) */
export const OWNER_FILE_MOUNTED_AT_IN_CONTAINER = '/app/host-infra.env';

/** ค่าที่ถือว่าใช้ได้จริง — ขั้นต่ำ 16 ตัวอักษรหลัง prefix (Stripe ออกยาวกว่านี้มาก) */
const MIN_SECRET_LENGTH = 16;

/**
 * ค่าที่ process ใช้ "ใช้ได้" จริงไหม
 *
 * กันกรณีที่จะเกิดจริงและเคยเกิดจริง:
 *   · ว่าง / ช่องว่างล้วน → ปฏิเสธทุก delivery (401) โดยเจ้าของไม่รู้
 *   · คัดลอก `sk_live_…`/`rk_live_…` (secret key) มาวางผิดช่อง → ไม่ใช่ signing secret
 *   · ค่าสั้นผิดปกติ → น่าจะเป็นตัวอย่าง/placeholder ที่หลงเหลือมา
 */
export function isUsableWebhookSecret(value: string | undefined | null): boolean {
  const s = String(value ?? '').trim();
  if (!s.startsWith('whsec_')) return false;
  return s.length - 'whsec_'.length >= MIN_SECRET_LENGTH;
}

/**
 * fingerprint ของ secret — ใช้เทียบว่า "หมุนแล้วจริงไหม" โดยไม่เปิดเผยค่า
 *
 * ข้อดีที่ทำให้พิสูจน์ได้แทนการเดา: หลังหมุนแล้ว fingerprint เปลี่ยนเสมอ
 * แต่ตัวเลขนี้ไม่ใช่ secret — แม้รั่วไปก็เอาไปเซ็นอะไรไม่ได้
 *
 * salt: กันการเทียบข้าม "เจ้าของ" (คนละเครื่อง/คนละระบบ) ที่อาจใช้ค่าเดียวกัน
 * ค่า default คือชื่อไฟล์เจ้าของ ซึ่งเปลี่ยนตามการย้ายระบบ ไม่ใช่ค่าลับ
 */
export function fingerprintSecret(secret: string | undefined | null, salt = 'sovereign-webhook'): string {
  const s = String(secret ?? '').trim();
  if (!s) return 'ว่าง (ไม่ได้ตั้ง)';
  const hash = crypto.createHash('sha256').update(`${salt}:${s}`).digest('hex');
  // 12 ตัวอักษร = มากพอให้คนตรวจว่าเปลี่ยน/ไม่เปลี่ยน · ยาวเกินขำเป็นเดายาก
  return hash.slice(0, 12);
}

export interface SecretComparison {
  /** ค่าทั้งสองฝั่งตรงกันไหม */
  matches: boolean;
  /** ทั้งสองฝั่งยังไม่ได้ตั้งเลย (คนละเรื่องกับ "หมุนแล้วไม่ถึง") */
  bothUnset: boolean;
  /** fingerprint ฝั่งไฟล์เจ้าของ */
  ownerFingerprint: string;
  /** fingerprint ฝั่งที่ process ใช้จริง */
  runtimeFingerprint: string;
  /** คำเตือนสำหรับคนดูแล — undefined เมื่อไม่มีอะไรต้องเตือน */
  warning?: string;
}

/**
 * เทียบค่าในไฟล์เจ้าของ กับค่าที่ process ใช้จริงตอนนี้
 *
 * นี่คือหัวใจของงาน: ถ้าไฟล์เจ้าของกับค่าที่รันอยู่ไม่ตรงกัน แปลว่า
 * "หมุน secret แล้ว" **ไม่มีผลจริง** — ซึ่งเดิมไม่มีอะไรเตือนเลย
 */
export function compareWebhookSecretSources(input: {
  ownerFileValue: string | undefined | null;
  runtimeValue: string | undefined | null;
  ownerFile?: string;
}): SecretComparison {
  const ownerFile = input.ownerFile ?? WEBHOOK_SECRET_OWNER_FILE;
  const owner = String(input.ownerFileValue ?? '').trim();
  const runtime = String(input.runtimeValue ?? '').trim();
  const ownerFingerprint = fingerprintSecret(owner);
  const runtimeFingerprint = fingerprintSecret(runtime);
  const bothUnset = !isUsableWebhookSecret(owner) && !isUsableWebhookSecret(runtime);

  // ยังไม่ได้ตั้งที่ไหนเลย = เป็นเรื่องเดียวกัน (ยังไม่ได้หมุน) ไม่ใช่หมุนแล้วไม่ถึง
  if (bothUnset) {
    return {
      matches: true,
      bothUnset: true,
      ownerFingerprint,
      runtimeFingerprint,
      warning:
        `[stripe] STRIPE_WEBHOOK_SECRET ยังไม่ได้ตั้งที่ไหนเลย — ตั้งที่ ${ownerFile} ` +
        `(webhook จะปฏิเสธทุก delivery ด้วย 401 จนกว่าจะตั้ง)`,
    };
  }

  const matches = owner === runtime;
  if (matches) {
    return { matches: true, bothUnset: false, ownerFingerprint, runtimeFingerprint };
  }

  // ไม่ตรง = เจ้าของแก้ไฟล์แล้ว แต่ process ที่รันอยู่ยังใช้ค่าเก่า
  return {
    matches: false,
    bothUnset: false,
    ownerFingerprint,
    runtimeFingerprint,
    warning: formatSecretDivergenceWarning({
      ownerFileValue: owner,
      runtimeValue: runtime,
      ownerFile,
    }),
  };
}

/**
 * ข้อความสำหรับคนดูแล — ต้องบอก "ตอนนี้เป็นแบบไหน" และ "แก้ยังไง" ไม่ใช่แค่บอกว่าผิด
 *
 * ห้ามมีค่า secret ดิบแม้แต่ตัวเดียวในข้อความนี้ (ข้อความนี้จะไปโผล่ใน log)
 */
export function formatSecretDivergenceWarning(input: {
  ownerFileValue: string | undefined | null;
  runtimeValue: string | undefined | null;
  ownerFile?: string;
}): string {
  const ownerFile = input.ownerFile ?? WEBHOOK_SECRET_OWNER_FILE;
  const ownerFp = fingerprintSecret(input.ownerFileValue);
  const runtimeFp = fingerprintSecret(input.runtimeValue);

  const emptySide = !isUsableWebhookSecret(input.ownerFileValue)
    ? `${ownerFile} ยังไม่มีค่า`
    : !isUsableWebhookSecret(input.runtimeValue)
      ? 'container ยังไม่ได้รับค่า'
      : null;

  return (
    `[stripe] ⚠️ STRIPE_WEBHOOK_SECRET ไม่ตรงกัน — ค่าที่รันอยู่ไม่ใช่ค่าที่เพิ่งหมุน\n` +
    `        ไฟล์เจ้าของ (${ownerFile}): ${ownerFp}\n` +
    `        ค่าที่ process ใช้จริง:            ${runtimeFp}\n` +
    (emptySide ? `        หมายเหตุ: ${emptySide}\n` : '') +
    `        ⇒ "หมุน secret แล้ว" ยังไม่มีผลกับ container — webhook จะปฏิเสธทุก delivery (401)\n` +
    `        แก้โดย: ค่าต้องอยู่ที่ ${ownerFile} แล้วสั่ง (จำเป็นต้อง recreate ไม่ใช่ restart เฉย ๆ —\n` +
    `        ค่าใน environment ถูกอ่านตอนสร้าง container ไม่ใช่ตอน restart)\n` +
    `          cd sovereign-os/infra && docker compose up -d --no-deps core-api\n` +
    `        ⚠️ ${HOST_RUN_ENV_FILE} แก้แล้วไม่มีผลกับ container (ใช้ได้เฉพาะตอนรันบน host) — ` +
    `อย่าใช้ไฟล์นั้นเป็นที่เก็บค่าที่มีผล`
  );
}