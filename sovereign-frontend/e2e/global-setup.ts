// e2e/global-setup.ts — เปิดบัญชี e2e เฉพาะช่วงที่เทสต์กำลังวิ่ง (คู่กับ global-teardown ที่ล็อกกลับ)
//
// ที่มา: runbook §๖ "ปิดบัชี e2e-bot" (รหัสผ่านอยู่ใน repo) → nightly verify:full ล้มทุกคืนที่ e2e (401)
//   แก้โดยไม่ผ่อนเส้นตาย: สุ่มรหัสผ่านใหม่ทุกรอบ (ไม่มีใน repo ไม่มีในไฟล์ .env) ให้เฉพาะตอนรัน
//   แล้ว global-teardown ล็อกกลับทันที — นอกช่วงเทสต์บัญชีนี้ล็อกเหมือนเดิม
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const USERNAME = process.env.E2E_BOT_USER || 'e2e-bot';
const CREDS_PATH = path.resolve('e2e/.auth/creds.json');

// worktree (Freebuff) → core-api อยู่ที่ MAIN เหมือนกัน เพราะโครงสร้างเหมือนกันทั้งสองที่
const CORE_API = path.resolve('..', 'sovereign-os', 'core-api');
const DIST = path.join(CORE_API, 'dist', 'scripts', 'e2e-account.js');
const SRC = path.join(CORE_API, 'src', 'scripts', 'e2e-account.ts');
const FIXTURE_DIST = path.join(CORE_API, 'dist', 'scripts', 'e2e-fixture.js');
const FIXTURE_SRC = path.join(CORE_API, 'src', 'scripts', 'e2e-fixture.ts');

function accountScript(args: string[]): string {
  if (existsSync(DIST)) return execFileSync('node', [DIST, ...args], { cwd: CORE_API, encoding: 'utf8', timeout: 120_000, windowsHide: true }).trim();
  // ยังไม่ได้ build (รัน e2e ตรง ๆ โดยไม่ผ่าน verify) → ใช้ tsx ของ devDependency
  return execFileSync('npx', ['tsx', SRC, ...args], { cwd: CORE_API, encoding: 'utf8', timeout: 180_000, windowsHide: true }).trim();
}

/** รันสคริปต์ฝั่ง backend (dist ถ้ามี ไม่งั้น tsx) — ใช้ร่วมกับ account + fixture */
export function coreScript(distPath: string, srcPath: string, args: string[]): string {
  const cmd = existsSync(distPath) ? 'node' : 'npx';
  const argv = existsSync(distPath) ? [distPath, ...args] : ['tsx', srcPath, ...args];
  return execFileSync(cmd, argv, { cwd: CORE_API, encoding: 'utf8', timeout: 180_000, windowsHide: true }).trim();
}

export default async function globalSetup(): Promise<void> {
  // ข้อมูลจำลองสำหรับหน้า /community (สร้างตอนรัน · ลบตอนจบที่ global-teardown)
  // ปกติเทสต์ไม่ต้องการข้อมูลปลอม แต่ถ้าล้มจะได้แก้ทีหลัง — จึงล้มเหลวแบบ soft
  if (process.env.E2E_SKIP_FIXTURE !== '1') {
    try {
      console.log('[e2e-global] สร้างข้อมูลตัวอย่าง /community…');
      console.log('  ' + coreScript(FIXTURE_DIST, FIXTURE_SRC, ['seed']));
    } catch (e) {
      console.error('[e2e-global] seed fixture ไม่สำเร็จ:', e instanceof Error ? e.message : e);
    }
  }
  // เคารพค่าที่ runner ยัดมา (ทดสอบเอง) — ถ้าไม่มีค่า = ปล่อยบัญชีให้เทสต์
  if (process.env.E2E_SKIP_ACCOUNT_SETUP === '1') {
    console.log('[e2e-global] E2E_SKIP_ACCOUNT_SETUP=1 — ไม่แตะบัญชี (ต้องมี E2E_BOT_USER/PASS ที่ใช้ได้เอง)');
    return;
  }
  const password = randomBytes(18).toString('base64url');
  try {
    console.log(`[e2e-global] เปิดบัญชี ${USERNAME} ชั่วคราว (รหัสสุ่มรอบนี้)…`);
    console.log('  ' + accountScript(['grant', USERNAME, password]));
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
