import { defineConfig } from "vitest/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read .env.local into a plain object.
 *
 * Vitest does not populate process.env from .env files — it only exposes
 * VITE_-prefixed vars on import.meta.env, which is useless for a node-environment
 * test that needs the Supabase URL and service key. `loadEnv` would do this, but
 * it lives in `vite`, not `vitest/config`, and reaching into a transitive
 * dependency to get it is a worse trade than ten lines of parsing.
 */
function readEnvFile(file: string): Record<string, string> {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return {};

  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip matching surrounding quotes, if any.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

// Integration tests talk to the LOCAL Supabase stack over HTTP. Separate project
// from the unit tests because they need a node environment, a running database,
// and much longer timeouts.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    // Serial: these create and delete real rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: readEnvFile(".env.local"),
  },
  resolve: {
    alias: { "@": root },
  },
});
