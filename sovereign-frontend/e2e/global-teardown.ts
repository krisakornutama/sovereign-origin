// e2e/global-teardown.ts — ล็อกบัญชี e2e กลับทันทีหลังเทสต์จบ (คู่กับ global-setup)
// เหตุผลด้านความปลอดภัย: รหัสที่ใช้ตอนรันเป็นของสุ่มและมีอายุแค่ช่วงเทสต์ — นอกช่วงนั้นบัญชีต้องล็อก
// (runbook §๖: ห้ามเปิดบัญชี SUPERADMIN ที่รหัสอยู่ใน repo)
//
// หมายเหตุ (9 พ.ย. 69): บล็อกลบข้อมูลตัวอย่าง /community (e2e-fixture) ถูกลบพร้อมสคริปต์ที่หายไปตอนแยก CE
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { runCoreScript } from './helpers/core-script';

const CREDS_PATH = path.resolve('e2e/.auth/creds.json');

export default async function globalTeardown(): Promise<void> {
  let username = process.env.E2E_BOT_USER || 'e2e-bot';
  try {
    if (existsSync(CREDS_PATH)) {
      const j = JSON.parse(readFileSync(CREDS_PATH, 'utf8')) as { username?: string };
      if (j.username) username = j.username;
      unlinkSync(CREDS_PATH); // รหัสสุ่มต้องหายจากดิสก์ทันที ไม่ใช่รอให้ gitignore ช่วย
    }
  } catch { /* soft */ }
  try {
    runCoreScript('e2e-account', ['revoke', username], 120_000);
    console.log(`[e2e-global] ล็อกบัญชี ${username} กลับแล้ว`);
  } catch (e) {
    console.error('[e2e-global] ล็อกบัญชีไม่สำเร็จ:', e instanceof Error ? e.message : e);
  }
}
