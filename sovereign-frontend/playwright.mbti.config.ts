import { defineConfig, devices } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// Playwright config สำหรับ e2e/mbti-ai-chat.spec.ts — รันกับ preview ของโปรเจ็ก
//   1. node tools/mock-api-preview.mjs          (mock API :3101)
//   2. dev-themes-preview.cmd                   (next dev :3100 → API :3101)
//   3. npm run test:mbti                        (config นี้)
// baseURL :3100 (เปลี่ยนได้ด้วย PLAYWRIGHT_TEST_BASE_URL) — self-bootstrapping:
// ปลอม JWT + seed localStorage เอง จึงไม่ต้องมี DB/storageState
// ────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  testDir: './e2e',
  testMatch: /mbti-ai-chat\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3100',
    trace: 'retain-on-failure',
    locale: 'th-TH',
    ...devices['Desktop Chrome'],
  },
});
