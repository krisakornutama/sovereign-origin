import { defineConfig, devices } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// E2E ของ Sovereign Frontend — รันด้วย `npm run e2e` (หรือ `npm run verify:full` ที่ root)
// ต้องมี backend (:3001) + DB รันอยู่ก่อน และ user e2e-bot (สร้างครั้งแรกด้วย psql)
// ────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
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
      testMatch: /pages\.spec\.ts|pos-flow\.spec\.ts|spa-nav\.spec\.ts|trace-community\.spec\.ts/,
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
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});