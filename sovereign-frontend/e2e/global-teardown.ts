// e2e/global-teardown.ts — ล็อกบัญชี e2e กลับทันทีหลังเทสต์จบ (คู่กับ global-setup)
// เหตุผลด้านความปลอดภัย: รหัสที่ใช้ตอนรันเป็นของสุ่มและมีอายุแค่ช่วงเทสต์ — นอกช่วงนั้นบัญชีต้องล็อก
// (runbook §๖: ห้ามเปิดบัญชี SUPERADMIN ที่รหัสอยู่ใน repo)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const CREDS_PATH = path.resolve('e2e/.auth/creds.json');
const CORE_API = path.resolve('..', 'sovereign-os', 'core-api');
const DIST = path.join(CORE_API, 'dist', 'scripts', 'e2e-account.js');
const SRC = path.join(CORE_API, 'src', 'scripts', 'e2e-account.ts');

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
    const args = ['revoke', username];
    if (existsSync(DIST)) execFileSync('node', [DIST, ...args], { cwd: CORE_API, encoding: 'utf8', timeout: 120_000, windowsHide: true });
    else execFileSync('npx', ['tsx', SRC, ...args], { cwd: CORE_API, encoding: 'utf8', timeout: 180_000, windowsHide: true });
    console.log(`[e2e-global] ล็อกบัญชี ${username} กลับแล้ว`);
  } catch (e) {
    console.error('[e2e-global] ล็อกบัญชีไม่สำเร็จ:', e instanceof Error ? e.message : e);
  }
}
