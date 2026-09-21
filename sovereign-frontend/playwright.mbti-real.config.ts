import { defineConfig, devices } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// A5 — config สำหรับ mbti-real-backend.spec.ts (backend จริง :3001)
// รัน: cd sovereign-frontend
//      MBTI_E2E_USER=... MBTI_E2E_PASS=... npx playwright test --config=playwright.mbti-real.config.ts
// หน้าเว็บชี้ API จริง: ต้องเริ่ม dev ด้วย NEXT_PUBLIC_API_URL=http://localhost:3001
// (ถ้า dev :3100 ชี้ mock อยู่ ให้รัน dev ปกติ :3000 ที่ชี้ :3001 แล้วส่ง PLAYWRIGHT_TEST_BASE_URL)
// ────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  testDir: './e2e',
  testMatch: /mbti-real-backend\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'th-TH',
    ...devices['Desktop Chrome'],
  },
});
