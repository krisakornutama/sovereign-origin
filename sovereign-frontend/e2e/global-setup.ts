// e2e/global-setup.ts — เปิดบัญชี e2e เฉพาะช่วงที่เทสต์กำลังวิ่ง (คู่กับ global-teardown ที่ล็อกกลับ)
//
// ที่มา: runbook §๖ "ปิดบัชี e2e-bot" (รหัสผ่านอยู่ใน repo) → nightly verify:full ล้มทุกคืนที่ e2e (401)
//   แก้โดยไม่ผ่อนเส้นตาย: สุ่มรหัสผ่านใหม่ทุกรอบ (ไม่มีใน repo ไม่มีในไฟล์ .env) ให้เฉพาะตอนรัน
//   แล้ว global-teardown ล็อกกลับทันที — นอกช่วงเทสต์บัญชีนี้ล็อกเหมือนเดิม
//
// หมายเหตุ (9 พ.ย. 69): เคยมีบล็อก seed ข้อมูลตัวอย่างให้หน้า /community ผ่าน `e2e-fixture.ts`
//   แต่สคริปต์+หน้า+spec ถูกถอดตอนแยก CE → เรียกไฟล์ที่ไม่มีอยู่ทุกครั้ง (Linux ERR_MODULE_NOT_FOUND,
//   Windows npx ENOENT) ลบออกแล้ว และย้ายการเรียกสคริปต์ไปที่ helpers/core-script (รันด้วย process.execPath)
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runCoreScript } from './helpers/core-script';

const USERNAME = process.env.E2E_BOT_USER || 'e2e-bot';
const CREDS_PATH = path.resolve('e2e/.auth/creds.json');

export default async function globalSetup(): Promise<void> {
  // เคารพค่าที่ runner ยัดมา (ทดสอบเอง) — ถ้าไม่มีค่า = ปล่อยบัญชีให้เทสต์
  if (process.env.E2E_SKIP_ACCOUNT_SETUP === '1') {
    console.log('[e2e-global] E2E_SKIP_ACCOUNT_SETUP=1 — ไม่แตะบัญชี (ต้องมี E2E_BOT_USER/PASS ที่ใช้ได้เอง)');
    return;
  }
  const password = randomBytes(18).toString('base64url');
  try {
    console.log(`[e2e-global] เปิดบัญชี ${USERNAME} ชั่วคราว (รหัสสุ่มรอบนี้)…`);
    console.log('  ' + runCoreScript('e2e-account', ['grant', USERNAME, password], 120_000));
    mkdirSync(path.dirname(CREDS_PATH), { recursive: true });
    writeFileSync(CREDS_PATH, JSON.stringify({ username: USERNAME, password, at: new Date().toISOString() }), { encoding: 'utf8' });
    process.env.E2E_BOT_USER = USERNAME;
    process.env.E2E_BOT_PASS = password;
  } catch (e) {
    // ไม่ throw: ให้ auth.setup ลองด้วยค่าที่มีอยู่ (หรือรายงาน 401 ให้ชัดเจน) — ไม่ทำให้ทุกเทสต์พังก่อนจะได้ login
    console.error('[e2e-global] เปิดบัญชีไม่สำเร็จ:', e instanceof Error ? e.message : e);
    try { if (existsSync(CREDS_PATH)) writeFileSync(CREDS_PATH, JSON.stringify({ error: 'grant-failed' })); } catch { /* soft */ }
  }
}
