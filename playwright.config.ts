import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync(chrome) ? chrome : undefined),
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    env: {
      TURSO_DATABASE_URL: `file:/private/tmp/supper-e2e-${Date.now()}.db`,
    },
    timeout: 120000,
  },
  reporter: "list",
});
