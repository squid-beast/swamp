import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

// Playwright does not load .env files. The e2e suite needs the Supabase URL and
// service key to create and destroy its throwaway user, so load them here — the
// same ten lines the vitest integration config uses, and for the same reason.
for (const line of fs.existsSync(".env.local")
  ? fs.readFileSync(path.resolve(".env.local"), "utf8").split("\n")
  : []) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  if (!process.env[key]) process.env[key] = t.slice(eq + 1).trim();
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // these tests write to a shared local database
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuse a dev server if one is already up; otherwise start one.
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
