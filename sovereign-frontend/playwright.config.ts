import { defineConfig, devices } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// E2E ของ Sovereign Frontend — รันด้วย `npm run e2e` (หรือ `npm run verify:full` ที่ root)
// ต้องมี backend (:3001) + DB รันอยู่ก่อน — บัญชี e2e เปิด/ล็อกอัตโนมัติที่ globalSetup/globalTeardown
// (สุ่มรหัสตอนรัน · ไม่มีรหัสที่รู้อยู่ใน repo · ล็อกกลับทันทีหลังจบ = ไม่ขัดกับ runbook §๖)
// ────────────────────────────────────────────────────────────────────────────
// ใช้ port/โดเมนอื่นได้เมื่อ 3000 ไม่ว่าง (เช่น เครื่อง dev ที่มี production serve อยู่)
// CI ไม่ได้ตั้ง env นี้ ⇒ ใช้ค่าเริ่มต้น 3000 เหมือนเดิม
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'th-TH',
    // ใช้ Chrome ที่ติดตั้งในเครื่อง (channel) — เลี่ยงดาวน์โหลด browser binary ทั้งชุด
    // (เคสจริง 23-09-26: playwright install ล้ม/ช้า + กติกาโปรเจ็กไม่กินพื้นที่ C:)
    channel: 'chrome',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, timeout: 180_000 },
    {
      name: 'authenticated',
      testMatch: /pages\.spec\.ts|spa-nav\.spec\.ts|farm-executive\.spec\.ts|settings\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/state.json' },
      dependencies: ['setup'],
    },
    {
      name: 'anonymous',
      testMatch: /login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});