import { defineConfig, devices } from "@playwright/test";
import { SAFE_ENV } from "./tests/e2e/safe-env.mjs";

const PORT = Number(process.env.E2E_PORT || 3200);
const BASE_URL = `http://localhost:${PORT}`;
// verify.mjs builds first and sets E2E_PREBUILT=1 so we don't build twice.
const serverCmd = process.env.E2E_PREBUILT
  ? `npx next start -p ${PORT}`
  : `npx next build && npx next start -p ${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  // Artifacts live under node_modules/.cache (already gitignored) to keep git status clean.
  outputDir: "node_modules/.cache/playwright/test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "node_modules/.cache/playwright/report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: serverCmd,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { ...SAFE_ENV, PORT: String(PORT) },
    stdout: "ignore",
    stderr: "pipe",
  },
});
