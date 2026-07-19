import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the HoldemCoach smoke test. Boots the Vite dev server
 * and drives the real app in headless Chromium. Kept lean: one project, no
 * retries, whole run budgeted well under two minutes.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
