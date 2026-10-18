import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
process.env.E2E_DATABASE_URL ||= `file:/private/tmp/supper-e2e-${Date.now()}.db`;
export default defineConfig({
  testDir: "tests/browser",
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync(chrome) ? chrome : undefined),
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    env: {
      APP_URL: "http://localhost:3100",
      APP_PASSWORD: "",
      AUTH_SECRET: "browser-test-signing-secret-not-for-production-12345",
      GOOGLE_ALLOWED_EMAILS: "member@example.com",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      OPENAI_API_KEY: "",
      KROGER_CLIENT_ID: "",
      KROGER_CLIENT_SECRET: "",
      TURSO_AUTH_TOKEN: "",
      TURSO_DATABASE_URL: process.env.E2E_DATABASE_URL,
    },
    timeout: 120000,
  },
  reporter: "list",
});
