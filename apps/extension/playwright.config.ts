import { defineConfig } from "@playwright/test";

// Extension e2e. Loads the unpacked `--mode e2e` build (host access granted at install, because
// Playwright cannot click Chrome's permission prompt) into Playwright's bundled Chromium:
// branded Chrome (137+) ignores --load-extension, see e2e/README.md.
// Run through the machine-wide limiter:
//   ../../../research/heavy.sh pnpm --filter @stepsnap/extension build:e2e
//   ../../../research/heavy.sh pnpm --filter @stepsnap/extension e2e
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "e2e/.artifacts/test-results",
  webServer: {
    command: "node ../fixtures/server.mjs --port 4517",
    url: "http://127.0.0.1:4517/index.html",
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
