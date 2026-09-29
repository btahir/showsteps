import { defineConfig } from "@playwright/test";

// Run only through the shared limiter:
//   research/heavy.sh pnpm --filter @stepsnap/dom exec playwright test --workers=2
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  workers: 2,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:4517", headless: true, channel: "chrome" },
  projects: [{ name: "chrome", use: { channel: "chrome" } }],
  webServer: {
    command: "node ../../apps/fixtures/server.mjs",
    url: "http://127.0.0.1:4517/index.html",
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
